/**
 * ============================================================================
 * MARKET BENCHMARKS — what moves a yarn price between two quotes
 * ============================================================================
 *
 * A yarn quote is a snapshot: a dealer's list on one day. Between two lists the
 * yarn price moves mostly because the fibre inside it moves — a kilogram of
 * carded yarn holds about 1.08 kg of cotton lint, a kilogram of combed yarn
 * about 1.25 kg, because the comber takes the short fibre out. So when the last
 * quote is weeks old, the honest way to bring it forward is not to guess a
 * percentage: it is to measure how much the fibre has moved since that day and
 * pass exactly that through the mass balance. That is what these benchmarks are
 * for. They never replace a quote; they move an old one, and say by how much.
 *
 * TWO FREE SOURCES, EACH DOING ONE JOB
 * ------------------------------------
 *   monthly   international commodity prices, a public workbook updated in the
 *             first days of each month: the cotton benchmark in $/kg and Brent
 *             crude in $/bbl, every month since 1960. It gives the level on the
 *             day an old quote was taken.
 *   daily     the cotton benchmark as shown on a public home page, in US cents
 *             per pound with its date. It gives TODAY's level between monthly
 *             releases.
 *
 * Neither name is shown on the site (the user's rule: no outside source named
 * where a visitor sees it), so the publisher and the licence live here, in the
 * admin view, and in every snapshot. The monthly workbook is CC BY 4.0: its
 * figures are used to move prices and are not republished as figures. The daily
 * value is a proprietary index displayed publicly; it is used the same way.
 *
 * WHAT IT REFUSES
 * ---------------
 * Any reading outside a plausible band is dropped, not stored, and the reason
 * is kept. A page that changes its markup makes the parse find nothing, and
 * that THROWS rather than storing an empty reading — an empty refresh reporting
 * success would freeze the nowcast at an old level and call it today.
 *
 * Storage is a small JSON file in backend/cache. If it is lost (a deploy that
 * cleans the folder), the next refresh rebuilds it: the monthly workbook holds
 * its own history, so nothing of value lives only in the file.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const LB_PER_KG = 2.20462262185;
const CACHE_FILE = path.join(__dirname, '..', '..', 'cache', 'market-benchmarks.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const SOURCES = {
  monthly: {
    id: 'monthly',
    label: 'International commodity prices, monthly',
    publisher: 'World Bank Commodity Price Data (the Pink Sheet), monthly workbook',
    page: 'https://www.worldbank.org/en/research/commodity-markets',
    fallback_file: 'https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx',
    licence: 'CC BY 4.0. Used to move prices; the figures are not republished.',
    series: ['cotton_usd_kg', 'brent_usd_bbl'],
    refresh_hours: 20,
  },
  daily_cotton: {
    id: 'daily_cotton',
    label: 'International cotton benchmark, daily',
    publisher: 'Cotlook A Index as shown on the publisher home page',
    page: 'https://www.cotlook.com/',
    licence: 'Proprietary index displayed publicly. Used to move prices; never republished as a figure.',
    series: ['cotton_usd_kg'],
    refresh_hours: 6,
  },
};

// plausible bands; a reading outside is a misread, not a market
const BANDS = { cotton_usd_kg: [0.8, 6], brent_usd_bbl: [15, 250] };
const inBand = (k, v) => Number.isFinite(v) && v >= BANDS[k][0] && v <= BANDS[k][1];

let snap = {
  monthly: { fetched_at: null, updated_on: null, cotton_usd_kg: {}, brent_usd_bbl: {}, error: null, error_at: null },
  daily: { fetched_at: null, readings: [], error: null, error_at: null },
};

// ── fetching ────────────────────────────────────────────────────────────
async function get(url, ms, asBuffer) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 30000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ctl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
    return asBuffer ? Buffer.from(await r.arrayBuffer()) : await r.text();
  } finally { clearTimeout(t); }
}

// ── parsing (exported for the tests, which never touch the network) ─────
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** The monthly workbook: the cotton and Brent columns, by month. */
function parseMonthly(buf) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets['Monthly Prices'];
  if (!ws) throw new Error('the monthly workbook has no "Monthly Prices" sheet');
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  const hdrIx = rows.findIndex((r) => Array.isArray(r) && r.some((c) => /Crude oil, Brent/i.test(String(c))));
  if (hdrIx < 0) throw new Error('the monthly workbook header row was not found');
  const hdr = rows[hdrIx];
  const cottonCol = hdr.findIndex((c) => /^Cotton, A Index/i.test(String(c)));
  const brentCol = hdr.findIndex((c) => /Crude oil, Brent/i.test(String(c)));
  if (cottonCol < 0 || brentCol < 0) throw new Error('the cotton or Brent column is missing from the monthly workbook');
  const units = rows[hdrIx + 1] || [];
  if (!/\$\/kg/.test(String(units[cottonCol])) || !/\$\/bbl/.test(String(units[brentCol]))) throw new Error('the monthly workbook units have changed');
  const updated = rows.slice(0, hdrIx).map((r) => String((r || [])[0] || '')).find((s) => /Updated on/i.test(s));
  const out = { cotton_usd_kg: {}, brent_usd_bbl: {}, updated_on: null, rejected: [] };
  const um = updated && /Updated on\s+([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i.exec(updated);
  if (um && MONTHS[um[1].toLowerCase()]) out.updated_on = `${um[3]}-${String(MONTHS[um[1].toLowerCase()]).padStart(2, '0')}-${String(um[2]).padStart(2, '0')}`;
  for (const r of rows.slice(hdrIx + 2)) {
    const m = /^(\d{4})M(\d{2})$/.exec(String((r || [])[0] || ''));
    if (!m) continue;
    const period = `${m[1]}-${m[2]}`;
    for (const [k, col] of [['cotton_usd_kg', cottonCol], ['brent_usd_bbl', brentCol]]) {
      const v = typeof r[col] === 'number' ? r[col] : parseFloat(r[col]);
      if (!Number.isFinite(v)) continue;
      if (inBand(k, v)) out[k][period] = v;
      else if (period >= '2000-01') out.rejected.push({ series: k, period, value: v });
    }
  }
  if (!Object.keys(out.cotton_usd_kg).length) throw new Error('the monthly workbook gave no cotton prices');
  return out;
}

/** The daily cotton benchmark from the public page: cents per pound, and its date. */
function parseDaily(html) {
  const v = /<th[^>]*>\s*A Index\s*<\/th>\s*<td[^>]*>\s*([\d.]+)/i.exec(html);
  const d = /Date of index value:\s*(?:<\/[a-z]+>\s*)?(?:[\d:]+\s*GMT\s*)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*,?\s*(\d{4})/i.exec(html);
  if (!v || !d) throw new Error('the daily cotton benchmark was not found on the page (the markup may have changed)');
  const cents = parseFloat(v[1]);
  const mon = MONTHS[d[2].toLowerCase()];
  if (!mon) throw new Error('the daily cotton benchmark date could not be read');
  const date = `${d[3]}-${String(mon).padStart(2, '0')}-${String(d[1]).padStart(2, '0')}`;
  const usdKg = Math.round(cents / 100 * LB_PER_KG * 10000) / 10000;
  if (!inBand('cotton_usd_kg', usdKg)) throw new Error(`the daily cotton benchmark read ${cents} cents/lb, outside any plausible range`);
  return { date, cents_per_lb: cents, cotton_usd_kg: usdKg };
}

// ── the store ───────────────────────────────────────────────────────────
function save() {
  try { fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(snap)); } catch (e) { console.error('[benchmarks] could not save:', e.message); }
}
function load() {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (j && j.monthly && j.daily) snap = j;
  } catch (_) { /* first run, or the cache folder was cleaned: the next refresh rebuilds it */ }
  return status();
}
function setSnapshot(s) { snap = s; }       // for the tests

const hoursSince = (iso) => iso ? (Date.now() - Date.parse(iso)) / 3600000 : Infinity;

/** Fetch whatever is due. Each source on its own: one failing never stops the other. */
async function refresh(opts = {}) {
  const report = {};
  if (opts.force || hoursSince(snap.monthly.fetched_at) >= SOURCES.monthly.refresh_hours) {
    try {
      let file = SOURCES.monthly.fallback_file;
      try {
        const page = await get(SOURCES.monthly.page, 30000);
        const m = /https:\/\/thedocs\.worldbank\.org[^"'\s]*Monthly[^"'\s]*\.xlsx/i.exec(page);
        if (m) file = m[0];
      } catch (_) { /* the landing page is only where the link is found; the last known file still works */ }
      const p = parseMonthly(await get(file, 60000, true));
      snap.monthly = { fetched_at: new Date().toISOString(), updated_on: p.updated_on, cotton_usd_kg: p.cotton_usd_kg, brent_usd_bbl: p.brent_usd_bbl, file, rejected: p.rejected.slice(0, 20), error: null, error_at: null };
      report.monthly = { ok: true, latest: lastKey(p.cotton_usd_kg), updated_on: p.updated_on };
    } catch (e) {
      snap.monthly.error = e.message; snap.monthly.error_at = new Date().toISOString();
      report.monthly = { ok: false, error: e.message };
    }
  } else report.monthly = { ok: true, skipped: true };

  if (opts.force || hoursSince(snap.daily.fetched_at) >= SOURCES.daily_cotton.refresh_hours) {
    try {
      const r = parseDaily(await get(SOURCES.daily_cotton.page, 30000));
      const rs = snap.daily.readings.filter((x) => x.date !== r.date).concat([r]).sort((a, b) => a.date.localeCompare(b.date)).slice(-400);
      snap.daily = { fetched_at: new Date().toISOString(), readings: rs, error: null, error_at: null };
      report.daily_cotton = { ok: true, date: r.date };
    } catch (e) {
      snap.daily.error = e.message; snap.daily.error_at = new Date().toISOString();
      report.daily_cotton = { ok: false, error: e.message };
    }
  } else report.daily_cotton = { ok: true, skipped: true };
  save();
  return report;
}

// ── reading levels ──────────────────────────────────────────────────────
function lastKey(o) { const k = Object.keys(o || {}).sort(); return k.length ? k[k.length - 1] : null; }
const DAY = 86400000;

/**
 * The level of a series on a date. Daily readings first (within a week before
 * the date), else that month's average, else the latest month before it.
 * Returns { value, basis, on } or null.
 */
function levelAt(series, iso) {
  if (!iso) return null;
  const t = Date.parse(iso + 'T00:00:00Z');
  if (series === 'cotton_usd_kg') {
    const d = snap.daily.readings.filter((x) => Date.parse(x.date + 'T00:00:00Z') <= t && t - Date.parse(x.date + 'T00:00:00Z') <= 7 * DAY).pop();
    if (d) return { value: d.cotton_usd_kg, basis: 'daily', on: d.date };
  }
  const m = snap.monthly[series] || {};
  const month = iso.slice(0, 7);
  if (m[month] != null) return { value: m[month], basis: 'monthly', on: month };
  const before = Object.keys(m).filter((k) => k < month).sort().pop();
  return before ? { value: m[before], basis: 'monthly', on: before } : null;
}

/** Today's level: the newest daily reading if it is under ten days old, else the newest month. */
function levelNow(series, now) {
  const t = (now ? Date.parse(now) : Date.now());
  if (series === 'cotton_usd_kg') {
    const d = snap.daily.readings[snap.daily.readings.length - 1];
    if (d && t - Date.parse(d.date + 'T00:00:00Z') <= 10 * DAY) return { value: d.cotton_usd_kg, basis: 'daily', on: d.date };
  }
  const k = lastKey(snap.monthly[series]);
  return k ? { value: snap.monthly[series][k], basis: 'monthly', on: k } : null;
}

function status() {
  const lastDaily = snap.daily.readings[snap.daily.readings.length - 1] || null;
  return {
    monthly: { ...SOURCES.monthly, fetched_at: snap.monthly.fetched_at, updated_on: snap.monthly.updated_on,
      latest_month: lastKey(snap.monthly.cotton_usd_kg), ok: !!snap.monthly.fetched_at && !snap.monthly.error, error: snap.monthly.error, error_at: snap.monthly.error_at },
    daily_cotton: { ...SOURCES.daily_cotton, fetched_at: snap.daily.fetched_at, latest_date: lastDaily ? lastDaily.date : null,
      readings: snap.daily.readings.length, ok: !!snap.daily.fetched_at && !snap.daily.error, error: snap.daily.error, error_at: snap.daily.error_at },
  };
}
function snapshot() { return snap; }

module.exports = { refresh, load, levelAt, levelNow, status, snapshot, setSnapshot, parseMonthly, parseDaily, SOURCES, CACHE_FILE };
