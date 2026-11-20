/**
 * ============================================================================
 * EMERGINGTEXTILES — the second yarn price source
 * ============================================================================
 *
 * EmergingTextiles publishes yarn and fibre prices for the countries this
 * engine cares about — China, India, Pakistan, Bangladesh, Turkey, Vietnam and
 * more — and unlike the free Bangladeshi list it is a real documented API:
 * every table on their site has a matching endpoint, authenticated with a
 * per-subscriber key (Corporate tier).
 *
 * Their documented form: https://api.emergingtextiles.com/api/sheets/{dataset}/{sheet},
 * HTTPS only, the key in an X-API-Key header, JSON out. A CSV form exists as well
 * (/api/csv/{dataset}/{sheet}); both are read here.
 *
 * It has one behaviour that matters more than the fetching: with no key
 * configured it reports NOT CONFIGURED, which is a different thing from
 * failing. A source that has never been connected must not appear on the
 * dashboard every week as a red error, and it must not be mistaken for a
 * source that is connected and returning nothing.
 *
 * TO TURN IT ON: put the subscriber key in ET_API_KEY and set ET_ENDPOINTS to
 * a JSON array. Each entry names a table either by `url` or by `dataset` +
 * `sheet` (built on ET_BASE, default https://api.emergingtextiles.com/api/sheets),
 * and says what it prices:
 *
 *   { "dataset": "Bangladesh-Yarn-Prices_Weekly", "sheet": "cotton-yarn-indicator",
 *     "country": "BD", "item_key": "cotton_carded", "count_ne": 30 }
 *
 * or, for a table with one column per count:
 *
 *   { "dataset": "...", "sheet": "...", "country": "BD",
 *     "columns": [ { "column": "30s Carded", "item_key": "cotton_carded", "count_ne": 30 }, ... ] }
 *
 * The admin screen's "Test a table" button shows what a table really returns
 * (JSON or CSV) and what this file made of it, so the endpoint list can be
 * written from the live response, not from a guess.
 *
 * THE LICENCE. This is paid, licensed data. Using it to cost inside the
 * business is what the subscription is for; publishing it to students on a
 * public site is redistribution, and that is a question for the publisher.
 * The `licence_note` below travels with every row so the question cannot be
 * forgotten.
 */

'use strict';

const SOURCE = 'emergingtextiles';

const LICENCE_NOTE = 'paid subscription data — cleared for internal costing; public '
  + 'redistribution needs the publisher\'s permission';

/**
 * Which endpoints to read, and what each one means. Held in the environment
 * rather than in code because the endpoint list is subscription-specific.
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

const DEFAULT_BASE = 'https://api.emergingtextiles.com/api/sheets';
const BASE = (b) => String(b || process.env.ET_BASE || DEFAULT_BASE).replace(/\/+$/, '');

/** The URL of an endpoint entry: a full `url`, or `dataset` + `sheet` on the API base. */
function urlOf(ep, base) {
  if (ep.url) return String(ep.url);
  // the CSV form lives beside the JSON one: /api/csv/{dataset}/{sheet}
  const root = ep.kind === 'csv' ? BASE(base).replace(/\/sheets$/, '/csv') : BASE(base);
  if (ep.dataset && ep.sheet) return `${root}/${encodeURIComponent(ep.dataset)}/${encodeURIComponent(ep.sheet)}`;
  return null;
}

function isConfigured() {
  return !!(process.env.ET_API_KEY && endpoints().length);
}

/**
 * Where the key and the table list come from. The admin dashboard registers a provider that reads them from the database
 * (the key sealed at rest); with none registered, or one that answers null, the environment (ET_API_KEY, ET_ENDPOINTS) is used.
 * The provider may also return `onTable(ep, table, url)`: called with every table fetched, so the dashboard can keep the whole
 * table, not just the one price the costing reads.
 */
let provider = null;
function setProvider(fn) { provider = typeof fn === 'function' ? fn : null; }
async function config() {
  if (provider) { const c = await provider(); if (c && c.key) return c; }
  return { key: process.env.ET_API_KEY, endpoints: endpoints(), base: process.env.ET_BASE, onTable: null };
}

/**
 * One table, fetched. The key goes in the X-API-Key header (a key in a URL
 * ends up in proxy logs and browser history). HTTPS only: the API refuses plain HTTP.
 */
async function fetchOne(ep, fetchImpl, key, base) {
  const doFetch = fetchImpl || globalThis.fetch;
  const url = urlOf(ep, base);
  if (!url) throw new Error('endpoint needs a url, or a dataset and a sheet');
  if (!/^https:\/\//i.test(url)) throw new Error(`${url} is not HTTPS: the API rejects plain HTTP`);
  // the CSV form takes the key as a query parameter; it is added only to the request, never to the URL shown in a message
  const target = ep.kind === 'csv' ? url + (url.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(key) : url;
  const res = await doFetch(target, {
    headers: {
      'X-API-Key': key,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/csv',
      'User-Agent': 'KnitAdvisor/1.0 (+https://knitadvisor.onlinetextileschool.com)',
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${url} refused the key (HTTP ${res.status}): the subscription may not include API access or this table, or the key has expired`);
  }
  if (res.status === 404) throw new Error(`${url} was not found (HTTP 404): check the dataset and sheet names`);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  const ctype = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
  return { text: await res.text(), ctype, url };
}

// ── a response, whatever its shape, as one table: { header: [...], rows: [[...]] } ──────────────────
const clean = (c) => String(c == null ? '' : c).trim().replace(/^"|"$/g, '');

function csvTable(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const cells = (l) => l.split(',').map(clean);
  return { header: cells(lines[0]), rows: lines.slice(1).map(cells) };
}

/** JSON in the shapes a data API usually returns: an array of objects, {data|rows|records|values|result}, {columns, rows}, an array of arrays. */
function jsonTable(body) {
  let v = body;
  for (let k = 0; k < 3 && v && !Array.isArray(v) && typeof v === 'object'; k++) {
    if (Array.isArray(v.columns) && Array.isArray(v.rows)) {
      const header = v.columns.map((c) => clean(typeof c === 'object' && c ? (c.name || c.label || c.key) : c));
      const rows = v.rows.map((r) => (Array.isArray(r) ? r.map(clean) : header.map((h) => clean(r[h]))));
      return { header, rows };
    }
    const next = v.data || v.rows || v.records || v.values || v.result || v.results || v.items || v.sheet;
    if (!next) break;
    v = next;
  }
  if (!Array.isArray(v) || !v.length) return null;
  if (Array.isArray(v[0])) return { header: v[0].map(clean), rows: v.slice(1).map((r) => r.map(clean)) };
  if (v[0] && typeof v[0] === 'object') {
    const header = Object.keys(v[0]);
    return { header, rows: v.map((r) => header.map((h) => clean(r[h]))) };
  }
  return null;
}

function toTable(text, ctype) {
  const t = String(text).trim();
  if (/json/i.test(ctype || '') || /^[\[{]/.test(t)) {
    try { return jsonTable(JSON.parse(t)); } catch { /* not JSON after all: try CSV */ }
  }
  return csvTable(t);
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const two = (n) => String(n).padStart(2, '0');
/** A date cell as YYYY-MM-DD: ISO, DD/MM/YYYY, "12 Jul 2026", "Jul 12, 2026"; a bare month ("Jul 2026") is its first day. */
function readDate(c) {
  const s = clean(c);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s);
  if (m && +m[1] <= 31 && +m[2] <= 12) return `${m[3]}-${two(m[2])}-${two(m[1])}`;
  m = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*,?[ -](\d{4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${two(MONTHS[m[2].toLowerCase()])}-${two(m[1])}`;
  m = /^([A-Za-z]{3})[a-z]*[ -](\d{1,2}),? (\d{4})$/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${two(MONTHS[m[1].toLowerCase()])}-${two(m[2])}`;
  m = /^([A-Za-z]{3})[a-z]*[ -](\d{4})$/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[2]}-${two(MONTHS[m[1].toLowerCase()])}-01`;
  return null;
}
const readNum = (c) => { const n = Number(clean(c).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : NaN; };
const DATE_HEAD = /date|period|week|month|day/;

/**
 * The current value of one column of a table: the last row with a readable
 * date AND a numeric price (these series are newest-last; taking the last LINE
 * rather than the last valid ROW is how a footer becomes a price of zero).
 * `column` picks the column by name; without it the first price-looking column is used.
 */
function latest(table, column) {
  if (!table || !table.rows.length) return null;
  const h = table.header.map((x) => x.toLowerCase());
  const dateAt = h.findIndex((x) => DATE_HEAD.test(x));
  const priceAt = column ? h.findIndex((x) => x === String(column).toLowerCase())
    : h.findIndex((x) => /price|value|usd|index|rate|indicator/.test(x));
  if (dateAt < 0 || priceAt < 0) return null;
  for (let i = table.rows.length - 1; i >= 0; i--) {
    const r = table.rows[i], price = readNum(r[priceAt]), date = readDate(r[dateAt]);
    if (price > 0 && date) return { price, quoted_on: date };
  }
  return null;
}

/** CSV text straight in (kept for callers and tests). */
function parseCsv(text, ep) { return latest(csvTable(text), ep && ep.column); }

/** What a response looks like, for the admin "Test a table" button. */
function describe(table) {
  if (!table) return { shape: 'not a table this reader understands' };
  const h = table.header.map((x) => x.toLowerCase());
  const dateAt = h.findIndex((x) => DATE_HEAD.test(x));
  return {
    columns: table.header, row_count: table.rows.length,
    first_rows: table.rows.slice(0, 3), last_rows: table.rows.slice(-3),
    date_column: dateAt >= 0 ? table.header[dateAt] : null,
    price_columns: table.header.filter((x, i) => i !== dateAt && table.rows.some((r) => readNum(r[i]) > 0)),
  };
}

/** Their price into this engine's row shape. */
function toRow(ep, found) {
  // Their series are quoted USD per kilogram unless the endpoint says otherwise. An endpoint declaring something
  // else is converted by the caller, never guessed at here.
  const unit = (ep.unit || 'KG').toUpperCase();
  const currency = (ep.currency || 'USD').toUpperCase();
  if (currency !== 'USD' || unit !== 'KG') {
    return { reject: true, label: urlOf(ep) || ep.sheet,
      why: `endpoint declares ${currency}/${unit}; only USD/KG is read from this source until a dated exchange rate is wired in` };
  }
  if (!(found.price >= 0.5 && found.price <= 25)) {
    return { reject: true, label: urlOf(ep) || ep.sheet, why: `$${found.price}/kg is not a yarn price` };
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

/** One table, which may feed several rows (one `columns` entry per count) or one (item_key on the endpoint itself). */
function rowsOf(ep, table) {
  const parts = Array.isArray(ep.columns) && ep.columns.length
    ? ep.columns.map((c) => ({ ...ep, ...c, columns: undefined }))
    : [ep];
  const rows = [], rejected = [];
  for (const part of parts) {
    if (!part.item_key) { rejected.push({ label: part.column || urlOf(ep) || '?', why: 'needs an item_key' }); continue; }
    const found = latest(table, part.column);
    if (!found) { rejected.push({ label: part.column || urlOf(ep), why: 'no dated numeric row found in the response' }); continue; }
    const t = toRow(part, found);
    if (t.reject) rejected.push({ label: t.label, why: t.why }); else rows.push(t.row);
  }
  return { rows, rejected };
}

/**
 * Pull everything this subscription exposes. Returns the same shape the other
 * adapter does, so the orchestrator does not need to know which source it is
 * talking to.
 */
async function collect(opts = {}) {
  const cfg = await config();
  if (!cfg.key) {
    return { source: SOURCE, configured: false, rows: [], rejected: [],
      reason: 'no API key is set (admin dashboard, Emerging Textiles), so this source has never been connected' };
  }
  const eps = cfg.endpoints || [];
  if (!eps.length) {
    return { source: SOURCE, configured: false, rows: [], rejected: [],
      reason: 'a key is set but no table is chosen, so there is nothing to read' };
  }
  const rows = [], rejected = [], tables = [];
  for (const ep of eps) {
    const url = urlOf(ep, cfg.base);
    if (!url) { rejected.push({ label: JSON.stringify(ep).slice(0, 80), why: 'endpoint needs a url, or a dataset and a sheet' }); continue; }
    let got;
    try { got = await fetchOne(ep, opts.fetchImpl, cfg.key, cfg.base); } catch (e) {
      rejected.push({ label: url, why: e.message });
      if (cfg.onTable) await cfg.onTable(ep, null, url, e.message);
      continue;
    }
    const table = toTable(got.text, got.ctype);
    if (!table) {
      rejected.push({ label: url, why: 'the response is not a table this reader understands' });
      if (cfg.onTable) await cfg.onTable(ep, null, url, 'the response is not a table this reader understands');
      continue;
    }
    if (cfg.onTable) await cfg.onTable(ep, table, url, null);
    tables.push(url);
    // a table with no price mapping is kept for the dashboard only: it feeds no costing
    if (!(ep.item_key || (Array.isArray(ep.columns) && ep.columns.length))) continue;
    const r = rowsOf(ep, table);
    rows.push(...r.rows); rejected.push(...r.rejected);
  }
  return { source: SOURCE, configured: true, rows, rejected, tables: tables.length };
}

/**
 * The admin "Test a table" button: fetch ONE table with the configured key and
 * report what came back and what this reader made of it. Nothing is stored.
 */
async function probe(ep, opts = {}) {
  const cfg = await config();
  if (!cfg.key) return { ok: false, error: 'no API key is set: save the key first' };
  let got;
  try { got = await fetchOne(ep, opts.fetchImpl, cfg.key, cfg.base); } catch (e) { return { ok: false, error: e.message }; }
  const table = toTable(got.text, got.ctype);
  if (!table) return { ok: false, url: got.url, error: 'the response is not a table this reader understands', raw_start: String(got.text).slice(0, 400) };
  return { ok: true, url: got.url, table: describe(table), as_rows: ep.item_key || ep.columns ? rowsOf(ep, table) : null, _table: table };
}

/** Fetch one table with the configured key and hand back the table itself (the dashboard stores it). */
async function fetchTable(ep, opts = {}) {
  const cfg = await config();
  if (!cfg.key) throw new Error('no API key is set: save the key first');
  const got = await fetchOne(ep, opts.fetchImpl, cfg.key, cfg.base);
  const table = toTable(got.text, got.ctype);
  if (!table) throw new Error('the response is not a table this reader understands');
  return { table, url: got.url, raw: opts.raw ? got.text : undefined };
}

/** What a response of unknown shape contains, for finding the names of the datasets and sheets of a subscription. */
async function fetchRaw(url, opts = {}) {
  const cfg = await config();
  if (!cfg.key) throw new Error('no API key is set: save the key first');
  const doFetch = opts.fetchImpl || globalThis.fetch;
  if (!/^https:\/\//i.test(url)) throw new Error('only HTTPS');
  const res = await doFetch(url, { headers: { 'X-API-Key': cfg.key, 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'KnitAdvisor/1.0' } });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

module.exports = { SOURCE, DEFAULT_BASE, BASE, setProvider, config, fetchTable, fetchRaw, describe, collect, probe, isConfigured, parseCsv, toTable, latest, readDate, urlOf, toRow, rowsOf, LICENCE_NOTE };
