/**
 * ============================================================================
 * YARN PRICE REPOSITORY — the live list, and how old it is
 * ============================================================================
 *
 * The costing engine is synchronous and runs per request; it cannot await a
 * query in the middle of a calculation. So the quotes are loaded ONCE into a
 * snapshot at boot and refreshed after a sync, exactly as the fibre reference
 * layer is (see the reference-data-layer note). The engine reads the snapshot.
 *
 * WHICH LIST IT READS. The publisher prints two — imported yarn against a
 * letter of credit in USD/kg, and the domestic cash market in taka per pound.
 * They are twenty-three per cent apart on the same product and both correct.
 * The engine's matrix is denominated USD/kg FOB, so the LC list is the one it
 * costs from; the local list is loaded too, for the admin panel to show, and is
 * never silently substituted.
 *
 * WHAT THE SNAPSHOT CARRIES, AND WHY IT IS NOT JUST A NUMBER
 * ----------------------------------------------------------
 * Every entry is a price AND the date the publisher put on it. Those travel
 * together everywhere in this file, because the one thing that must never
 * happen is a price arriving somewhere without its date and being treated as
 * current. On 1 September 2026 the freshest quote available anywhere was dated
 * 29 August; a system that shipped the number alone would have said "live".
 */

const { query } = require('../client');

// The list the costing engine reads. USD per kilogram, which is what the
// engine's own matrix is denominated in, so no exchange rate enters a costing.
const COSTING_MARKET = 'lc_usd';

let snapshot = {
  loaded: false,
  loaded_at: null,
  by_market: {},     // 'lc_usd' -> { 'carded_regular': { 20: entry, ... } }
  newest_quote: null,
  source: null,
  sync: null,
};

/**
 * Newest quote per (item, count).
 *
 * DISTINCT ON is the right tool here and worth naming: the table appends
 * rather than updates, so an item has one row per day it was published, and
 * what the engine wants is the latest of each. Doing this in SQL rather than
 * in JavaScript keeps the whole history available for auditing a past costing
 * without loading it all into memory.
 */
async function load() {
  const rows = await query(
    `SELECT DISTINCT ON (market, item_key, count_ne)
            market, item_key, count_ne, price_usd_kg, currency, unit, price,
            raw_label, quoted_on, percent_change, source, fx_bdt_per_usd
       FROM yarn_price_quotes
      ORDER BY market, item_key, count_ne, quoted_on DESC`);

  const sync = await query(
    `SELECT started_at, finished_at, ok, trigger, rows_stored, newest_quote, error
       FROM yarn_price_syncs
      ORDER BY started_at DESC LIMIT 1`);

  const byMarket = {};
  let newest = null;
  for (const r of rows) {
    const m = (byMarket[r.market] = byMarket[r.market] || {});
    const key = r.item_key;
    const ne = Number(r.count_ne);
    (m[key] = m[key] || {})[ne] = {
      price_usd_kg: Number(r.price_usd_kg),
      quoted_on: toDate(r.quoted_on),
      as_published: `${r.currency === 'USD' ? '$' : '৳'}${Number(r.price)} per ${r.unit}`,
      label: r.raw_label,
      percent_change: r.percent_change == null ? null : Number(r.percent_change),
      source: r.source,
    };
    const d = toDate(r.quoted_on);
    if (!newest || d > newest) newest = d;
  }

  snapshot = {
    loaded: true,
    loaded_at: new Date().toISOString(),
    by_market: byMarket,
    newest_quote: newest,
    source: rows.length ? rows[0].source : null,
    sync: sync.length ? {
      at: sync[0].started_at,
      ok: sync[0].ok,
      trigger: sync[0].trigger,
      stored: sync[0].rows_stored,
      newest_quote: toDate(sync[0].newest_quote),
      error: sync[0].error || null,
    } : null,
  };
  return {
    markets: Object.keys(byMarket),
    items: Object.keys(byMarket[COSTING_MARKET] || {}).length,
    quotes: rows.length,
    newest,
  };
}

function toDate(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  return new Date(v).toISOString().slice(0, 10);
}

/** Whole days between a quote date and now. */
function ageDays(quotedOn, now) {
  if (!quotedOn) return null;
  const then = Date.parse(quotedOn + 'T00:00:00Z');
  const today = Date.parse((now || new Date()).toISOString().slice(0, 10) + 'T00:00:00Z');
  return Math.round((today - then) / 86400000);
}

/**
 * The live price for one matrix key and count, or null.
 *
 * Returns null in three different situations and the caller does not need to
 * tell them apart, because the answer is the same in all three: fall back to
 * the reference list and say so. What the caller DOES need is the age, which
 * comes back with every hit.
 *
 * There is no interpolation here on purpose. The feed prints nine counts and
 * the engine costs fifteen; filling the other six from neighbours would produce
 * a number that is not a quote, wearing a quote's date. The reference list
 * already covers those counts and covering them twice, worse, helps nobody.
 */
function lookup(itemKey, countNe, now, market) {
  if (!snapshot.loaded) return null;
  const list = snapshot.by_market[market || COSTING_MARKET];
  if (!list) return null;
  const family = list[itemKey];
  if (!family) return null;
  const entry = family[Number(countNe)] || (countNe ? null : family[0]);
  if (!entry) return null;
  return {
    ...entry,
    age_days: ageDays(entry.quoted_on, now),
  };
}

/**
 * What the results page prints beside a price.
 *
 * The user's instruction was: show when it was last updated, and do not make a
 * feature of which company it came from. So the DATE is the headline and the
 * publisher's name sits in `attribution` for the small print — kept rather than
 * dropped, because a price with no traceable origin would be the only number in
 * this system that cannot be checked, and every other one cites its page.
 */
function status(now) {
  if (!snapshot.loaded) {
    return { available: false, reason: 'the price list has not been loaded' };
  }
  const age = ageDays(snapshot.newest_quote, now);
  return {
    available: !!snapshot.newest_quote,
    last_updated: snapshot.newest_quote,
    age_days: age,
    // Bands, not a boolean, because "how stale" is the actual question. A
    // fortnight-old cotton price is usable with a caveat; a quarter-old one
    // is a different number from today's.
    freshness: age == null ? 'unknown'
             : age <= 7 ? 'current'
             : age <= 21 ? 'recent'
             : age <= 60 ? 'stale' : 'out of date',
    items: Object.keys(snapshot.by_market[COSTING_MARKET] || {}).length,
    markets: Object.keys(snapshot.by_market),
    attribution: snapshot.source,
    last_sync: snapshot.sync,
    loaded_at: snapshot.loaded_at,
  };
}

function isLoaded() { return snapshot.loaded; }

module.exports = { load, lookup, status, isLoaded, ageDays, COSTING_MARKET };
