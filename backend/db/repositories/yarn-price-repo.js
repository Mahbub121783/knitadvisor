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
  by_country: {},    // 'BD' -> 'lc_usd' -> 'carded_regular' -> { 20: entry, ... }
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
  // Newest quote per (country, market, item, count), whichever source it came
  // from. The ordering is the merge policy in SQL: freshest date first, then
  // the source priority the sync job declares.
  const rows = await query(
    `SELECT DISTINCT ON (country, market, item_key, count_ne)
            country, market, item_key, count_ne, price_usd_kg, currency, unit, price,
            raw_label, quoted_on, percent_change, source, fx_bdt_per_usd
       FROM yarn_price_quotes
      ORDER BY country, market, item_key, count_ne, quoted_on DESC,
               CASE source WHEN 'emergingtextiles' THEN 1 WHEN 'texbazar' THEN 2 ELSE 9 END`);

  const sync = await query(
    `SELECT started_at, finished_at, ok, trigger, rows_stored, newest_quote, error
       FROM yarn_price_syncs
      ORDER BY started_at DESC LIMIT 1`);

  const byCountry = {};
  let newest = null;
  for (const r of rows) {
    const ctry = (byCountry[r.country] = byCountry[r.country] || {});
    const m = (ctry[r.market] = ctry[r.market] || {});
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
    by_country: byCountry,
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
    countries: Object.keys(byCountry),
    items: Object.keys(((byCountry.BD || {})[COSTING_MARKET]) || {}).length,
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
 * INTERPOLATION, AND WHY IT IS ALLOWED HERE BUT WAS NOT AT FIRST.
 *
 * The first version refused to interpolate at all, on the reasoning that a
 * filled-in number wearing a quote's date is worse than no quote. Measured
 * against realistic fabrics, that left 48% of costings on the reference list —
 * and the counts it was missing were 28Ne and 32Ne, which are ordinary counts,
 * falling back to a figure four months old and 3-7% out.
 *
 * The objection was to the BADGE, not to the arithmetic. Interpolating between
 * two real quotes taken on the same day is ordinary engineering; presenting the
 * result as a quote is not. So it interpolates, under four conditions:
 *
 *   - strictly BETWEEN two quotes, never beyond the ends of the range
 *   - the two must be close enough to interpolate across (8 Ne)
 *   - the two must carry the same date, or it is mixing two markets in time
 *   - the result is labelled `interpolated`, and the engine gives it its own
 *     badge and its own sentence — it never reads as a quote
 *
 * Extrapolation stays refused. Below the coarsest and above the finest quote
 * the price curve is not linear — carded cotton runs 3.15, 3.20, 3.25, 3.45,
 * 3.80 across 20 to 40Ne, so the last step is seven times the first — and
 * running that slope off the end of the table produces nonsense quickly.
 */
const MAX_INTERPOLATION_SPAN_NE = 8;

function lookup(itemKey, countNe, now, opts = {}) {
  if (!snapshot.loaded) return null;
  const ctry = snapshot.by_country[(opts.country || 'BD').toUpperCase()];
  if (!ctry) return null;
  const list = ctry[opts.market || COSTING_MARKET];
  if (!list) return null;
  const family = list[itemKey];
  if (!family) return null;

  const want = Number(countNe);
  const asked = (opts.country || 'BD').toUpperCase();
  const exact = family[want] || (countNe ? null : family[0]);
  if (exact) {
    return { ...exact, exact: true, country: asked,
             age_days: ageDays(exact.quoted_on, now) };
  }
  if (!want) return null;

  // The nearest quote on each side. Strictly each side: one-sided means the
  // wanted count is off the end of the table, and that is extrapolation.
  const counts = Object.keys(family).map(Number).filter(n => n > 0).sort((a, b) => a - b);
  const below = counts.filter(n => n < want).pop();
  const above = counts.find(n => n > want);
  if (below == null || above == null) return null;
  if (above - below > MAX_INTERPOLATION_SPAN_NE) return null;

  const lo = family[below];
  const hi = family[above];
  // Two quotes from different days are two different markets, and averaging
  // across them hides the movement between them.
  if (lo.quoted_on !== hi.quoted_on) return null;

  const t = (want - below) / (above - below);
  const price = lo.price_usd_kg + t * (hi.price_usd_kg - lo.price_usd_kg);

  return {
    price_usd_kg: Math.round(price * 10000) / 10000,
    quoted_on: lo.quoted_on,
    exact: false,
    country: asked,
    interpolated: { between: [below, above], prices: [lo.price_usd_kg, hi.price_usd_kg] },
    as_published: `between ${lo.as_published} at ${below}Ne and ${hi.as_published} at ${above}Ne`,
    label: `${want}Ne, read between ${lo.label} and ${hi.label}`,
    percent_change: null,
    source: lo.source,
    age_days: ageDays(lo.quoted_on, now),
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
    items: Object.keys(((snapshot.by_country.BD || {})[COSTING_MARKET]) || {}).length,
    countries: Object.keys(snapshot.by_country),
    attribution: snapshot.source,
    last_sync: snapshot.sync,
    loaded_at: snapshot.loaded_at,
  };
}

function isLoaded() { return snapshot.loaded; }

/** Countries that actually have live quotes right now. */
function quotedCountries() {
  return snapshot.loaded ? Object.keys(snapshot.by_country) : [];
}

module.exports = { load, lookup, status, isLoaded, ageDays, COSTING_MARKET, quotedCountries,
                   MAX_INTERPOLATION_SPAN_NE };
