/**
 * ============================================================================
 * EMERGINGTEXTILES — the second yarn price source
 * ============================================================================
 *
 * EmergingTextiles publishes yarn and fibre prices for the countries this
 * engine cares about — China, India, Pakistan, Bangladesh, Turkey, Vietnam and
 * more — and unlike the free Bangladeshi list it is a real documented API:
 * every table on their site has a matching endpoint, authenticated with a
 * per-subscriber key.
 *
 * WHY THIS FILE EXISTS BEFORE THE KEY DOES
 * ----------------------------------------
 * Access is included with a Corporate subscription and this account's
 * credentials did not authenticate when tried, so there is no key yet. The
 * adapter is written anyway, because the alternative — bolting a second source
 * on later — is how a "merge two sources" design quietly becomes "one source
 * with a special case".
 *
 * It therefore has one behaviour that matters more than the fetching: with no
 * key configured it reports NOT CONFIGURED, which is a different thing from
 * failing. A source that has never been connected must not appear on the
 * dashboard every week as a red error, and it must not be mistaken for a
 * source that is connected and returning nothing.
 *
 * TO TURN IT ON: put the subscriber key in ET_API_KEY and set ET_ENDPOINTS to
 * a JSON array of { url, country, item_key, count_ne } rows. Nothing else here
 * needs changing, and the merge picks it up on the next sync.
 *
 * ONE THING TO SETTLE BEFORE SWITCHING IT ON. This is paid, licensed data.
 * Using it to cost inside the business is what the subscription is for;
 * publishing it to students on a public site is redistribution, and that is a
 * question for the publisher, not for this file. The `licence_note` below
 * travels with every row so the question cannot be forgotten.
 */

'use strict';

const SOURCE = 'emergingtextiles';

const LICENCE_NOTE = 'paid subscription data — cleared for internal costing; public '
  + 'redistribution needs the publisher\'s permission';

/**
 * Which endpoints to read, and what each one means.
 *
 * Held in the environment rather than in code because the endpoint list is
 * subscription-specific: two subscribers see different tables, and hard-coding
 * one account's URLs would make this file wrong for anybody else.
 *
 * Each entry: { url, country, market, item_key, count_ne, currency, unit }
 */
function endpoints() {
  const raw = process.env.ET_ENDPOINTS;
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function isConfigured() {
  return !!(process.env.ET_API_KEY && endpoints().length);
}

/**
 * One CSV endpoint, read.
 *
 * Their CSV form takes the key as a query parameter and the JSON form as an
 * `x-api-key` header; the header is used because a key in a URL ends up in
 * proxy logs and browser history.
 */
async function fetchOne(ep, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  const res = await doFetch(ep.url, {
    headers: {
      'x-api-key': process.env.ET_API_KEY,
      'Accept': 'text/csv, application/json',
      'User-Agent': 'KnitAdvisor/1.0 (+https://knitadvisor.onlinetextileschool.com)',
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${ep.url} refused the key (HTTP ${res.status}) — the subscription may not `
      + 'include API access, or the key has expired');
  }
  if (!res.ok) throw new Error(`${ep.url} returned HTTP ${res.status}`);
  return res.text();
}

/**
 * Their CSV into quote rows.
 *
 * The last row with a parseable date and a numeric price is the current one:
 * these series are published newest-last, and taking the last LINE rather than
 * the last valid ROW is how a trailing blank or a footer becomes a price of
 * zero.
 */
function parseCsv(text, ep) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return null;

  const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  const dateAt = header.findIndex(h => /date|period|week|month/.test(h));
  const priceAt = header.findIndex(h => /price|value|usd|index|rate/.test(h));
  if (dateAt < 0 || priceAt < 0) return null;

  for (let i = lines.length - 1; i >= 1; i--) {
    const cell = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const price = Number(cell[priceAt]);
    const date = (cell[dateAt] || '').slice(0, 10);
    if (!(price > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    return { price, quoted_on: date };
  }
  return null;
}

/** Their price into this engine's row shape. */
function toRow(ep, found) {
  // Their series are quoted USD per kilogram unless the endpoint says
  // otherwise. An endpoint declaring something else is converted by the caller,
  // never guessed at here.
  const unit = (ep.unit || 'KG').toUpperCase();
  const currency = (ep.currency || 'USD').toUpperCase();
  if (currency !== 'USD' || unit !== 'KG') {
    return { reject: true, label: ep.url,
      why: `endpoint declares ${currency}/${unit}; only USD/KG is read from this source until a `
        + 'dated exchange rate is wired in' };
  }
  if (!(found.price >= 0.5 && found.price <= 25)) {
    return { reject: true, label: ep.url,
      why: `$${found.price}/kg is not a yarn price` };
  }
  return {
    row: {
      source: SOURCE,
      market: ep.market || 'lc_usd',
      country: (ep.country || 'BD').toUpperCase(),
      item_key: ep.item_key,
      count_ne: Number(ep.count_ne || 0),
      raw_label: ep.label || `${ep.item_key} ${ep.count_ne || ''}Ne`.trim(),
      price: found.price,
      currency: 'USD',
      unit: 'KG',
      price_usd_kg: found.price,
      fx_bdt_per_usd: null,
      fx_source: null,
      quoted_on: found.quoted_on,
      percent_change: null,
      licence_note: LICENCE_NOTE,
    },
  };
}

/**
 * Pull everything this subscription exposes.
 *
 * Returns the same shape the other adapter does, so the orchestrator does not
 * need to know which source it is talking to.
 */
async function collect(opts = {}) {
  if (!process.env.ET_API_KEY) {
    return { source: SOURCE, configured: false, rows: [], rejected: [],
      reason: 'no ET_API_KEY is set, so this source has never been connected' };
  }
  const eps = endpoints();
  if (!eps.length) {
    return { source: SOURCE, configured: false, rows: [], rejected: [],
      reason: 'ET_API_KEY is set but ET_ENDPOINTS is empty, so there is nothing to read' };
  }

  const rows = [];
  const rejected = [];
  for (const ep of eps) {
    if (!ep.url || !ep.item_key) {
      rejected.push({ label: JSON.stringify(ep).slice(0, 80),
                      why: 'endpoint needs at least a url and an item_key' });
      continue;
    }
    let found;
    try {
      found = parseCsv(await fetchOne(ep, opts.fetchImpl), ep);
    } catch (e) {
      rejected.push({ label: ep.url, why: e.message });
      continue;
    }
    if (!found) {
      rejected.push({ label: ep.url, why: 'no dated numeric row found in the response' });
      continue;
    }
    const t = toRow(ep, found);
    if (t.reject) { rejected.push({ label: t.label, why: t.why }); continue; }
    rows.push(t.row);
  }

  return { source: SOURCE, configured: true, rows, rejected };
}

module.exports = { SOURCE, collect, isConfigured, parseCsv, toRow, LICENCE_NOTE };
