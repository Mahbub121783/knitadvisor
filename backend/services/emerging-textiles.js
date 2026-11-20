/**
 * ============================================================================
 * EMERGING TEXTILES — the dashboard's service
 * ============================================================================
 *
 * What the admin enters is the API key. Everything else follows from it:
 *   1. the key is kept sealed (AES-256-GCM, key from API_KEY_ENCRYPTION_SECRET); only its last four characters are ever shown;
 *   2. "Find my tables" asks the API what the subscription contains and matches each table to its slot on the publisher's menu
 *      (engine/catalog/et-catalogue.js), so the dashboard has the same layout as the publisher's site;
 *   3. every table is fetched daily with the yarn price sync and its latest copy kept (et_snapshots), so the dashboard shows
 *      the whole table, its change and its history;
 *   4. a table whose columns are yarn counts can be switched on for costing: its newest price per count goes into the same quote
 *      store as every other source, merged by the same rule (fresher wins, same day goes to this source).
 *
 * The API's field names and table names are not published, so nothing here guesses them: discovery reads what the API says,
 * the table reader accepts the usual shapes, and the dashboard shows what came back when something does not match.
 */
'use strict';

const { query, queryOne } = require('../db/client');
const totp = require('../engine/domain/totp');
const ET = require('../jobs/price-sources/emergingtextiles');
const { SLOTS, CATEGORIES, COSTING_KEYS, slug } = require('../engine/catalog/et-catalogue');

class EtError extends Error {}

// ── the key ───────────────────────────────────────────────────────────────────────────────────────────────────
async function settings() {
  return (await queryOne('SELECT * FROM et_settings WHERE id = 1')) || {};
}

async function getKey() {
  const s = await settings();
  if (s.api_key_sealed) { try { return totp.open(s.api_key_sealed); } catch (_) { return null; } }
  return process.env.ET_API_KEY || null;
}

/** Save the key. It is checked for shape only (no spaces, 16+ characters): whether it works is what Test is for. */
async function saveKey(raw, baseUrl) {
  const key = String(raw || '').trim();
  if (key.length < 16 || /\s/.test(key)) throw new EtError('That does not look like an API key: it has no spaces and is at least 16 characters long. Paste it exactly as Emerging Textiles gave it.');
  if (key.length > 400) throw new EtError('That key is too long to be an API key.');
  const base = baseUrl ? String(baseUrl).trim() : null;
  if (base && !/^https:\/\//i.test(base)) throw new EtError('The API address must start with https://.');
  const sealed = totp.seal(key);
  await query(`UPDATE et_settings SET api_key_sealed = $1, key_last4 = $2, base_url = $3, saved_at = now(), tested_at = NULL, test_ok = NULL, test_note = NULL WHERE id = 1`,
    [sealed, key.slice(-4), base]);
  return status();
}

async function clearKey() {
  await query('UPDATE et_settings SET api_key_sealed = NULL, key_last4 = NULL, saved_at = NULL, tested_at = NULL, test_ok = NULL, test_note = NULL WHERE id = 1');
  return status();
}

// ── tables ────────────────────────────────────────────────────────────────────────────────────────────────────
const TABLE_COLS = `id, catalogue_id, category, title, dataset, sheet, country, mapping, enabled, last_fetched_at, last_ok, last_error`;
const CATS = new Set([...CATEGORIES.map((c) => c.id), 'other']);

async function listTables() { return query(`SELECT ${TABLE_COLS} FROM et_tables ORDER BY category, id`).then((r) => r.rows || r); }

function cleanMapping(m) {
  if (m == null) return null;
  const ok = (x) => x && COSTING_KEYS.includes(x.item_key) && +x.count_ne >= 4 && +x.count_ne <= 120;
  if (Array.isArray(m.columns)) {
    const cols = m.columns.filter((c) => c && c.column && ok(c)).map((c) => ({ column: String(c.column), item_key: c.item_key, count_ne: +c.count_ne }));
    if (!cols.length) throw new EtError('Choose at least one column with a product and a count.');
    return { columns: cols };
  }
  if (!ok(m)) throw new EtError(`A costing mapping needs a product (${COSTING_KEYS.join(', ')}) and a count between 4 and 120 Ne.`);
  return { item_key: m.item_key, count_ne: +m.count_ne };
}

async function addTable(b) {
  const dataset = String(b.dataset || '').trim(), sheet = String(b.sheet || '').trim();
  if (!dataset || !sheet) throw new EtError('Give the dataset and the sheet.');
  const category = CATS.has(b.category) ? b.category : 'other';
  const row = await queryOne(
    `INSERT INTO et_tables (catalogue_id, category, title, dataset, sheet, country, mapping)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (dataset, sheet) DO UPDATE SET catalogue_id = COALESCE(EXCLUDED.catalogue_id, et_tables.catalogue_id), title = EXCLUDED.title, category = EXCLUDED.category
     RETURNING ${TABLE_COLS}`,
    [b.catalogue_id || null, category, String(b.title || `${dataset} / ${sheet}`).slice(0, 160), dataset, sheet, b.country ? String(b.country).toUpperCase().slice(0, 2) : null, b.mapping ? JSON.stringify(cleanMapping(b.mapping)) : null]);
  return row;
}

async function updateTable(id, b) {
  const sets = [], vals = [];
  const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if ('enabled' in b) set('enabled', !!b.enabled);
  if ('mapping' in b) set('mapping', b.mapping ? JSON.stringify(cleanMapping(b.mapping)) : null);
  if ('country' in b) set('country', b.country ? String(b.country).toUpperCase().slice(0, 2) : null);
  if ('title' in b && b.title) set('title', String(b.title).slice(0, 160));
  if ('catalogue_id' in b) set('catalogue_id', b.catalogue_id || null);
  if ('category' in b && CATS.has(b.category)) set('category', b.category);
  if (!sets.length) throw new EtError('Nothing to change.');
  vals.push(id);
  const row = await queryOne(`UPDATE et_tables SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING ${TABLE_COLS}`, vals);
  if (!row) throw new EtError('No such table.');
  return row;
}

async function deleteTable(id) { await query('DELETE FROM et_tables WHERE id = $1', [id]); }

// ── snapshots: the whole table, kept ──────────────────────────────────────────────────────────────────────────
const MAX_ROWS = 400;        // the newest rows of a series: enough for a year of weekly prices, small enough to store and draw
async function saveSnapshot(id, table) {
  const rows = table.rows.slice(-MAX_ROWS);
  await query(
    `INSERT INTO et_snapshots (table_id, fetched_at, header, rows, row_count) VALUES ($1, now(), $2, $3, $4)
     ON CONFLICT (table_id) DO UPDATE SET fetched_at = now(), header = EXCLUDED.header, rows = EXCLUDED.rows, row_count = EXCLUDED.row_count`,
    [id, JSON.stringify(table.header), JSON.stringify(rows), table.rows.length]);
  await query('UPDATE et_tables SET last_fetched_at = now(), last_ok = true, last_error = NULL WHERE id = $1', [id]);
}
async function noteFailure(id, message) {
  await query('UPDATE et_tables SET last_fetched_at = now(), last_ok = false, last_error = $2 WHERE id = $1', [id, String(message).slice(0, 300)]);
}
async function getSnapshot(id) {
  const t = await queryOne(`SELECT ${TABLE_COLS} FROM et_tables WHERE id = $1`, [id]);
  if (!t) throw new EtError('No such table.');
  const s = await queryOne('SELECT fetched_at, header, rows, row_count FROM et_snapshots WHERE table_id = $1', [id]);
  return { table: t, snapshot: s || null, summary: s ? summarise(s.header, s.rows) : null, suggestions: s ? suggestMapping(s.header, t) : [] };
}

// ── reading a table for the dashboard ─────────────────────────────────────────────────────────────────────────
const isDateHead = (h) => /date|period|week|month|day/i.test(h);
const num = (c) => { const n = Number(String(c == null ? '' : c).replace(/[$,%\s]/g, '').replace(/^"|"$/g, '')); return Number.isFinite(n) && String(c).trim() !== '' ? n : NaN; };

/** For each numeric column: the latest value, the one before it, the change, and the last 60 points for a sparkline. */
function summarise(header, rows) {
  const dateAt = header.findIndex(isDateHead);
  const series = [];
  header.forEach((h, i) => {
    if (i === dateAt) return;
    const pts = [];
    rows.forEach((r) => { const v = num(r[i]); if (v > 0 || v < 0) pts.push({ d: dateAt >= 0 ? ET.readDate(r[dateAt]) || r[dateAt] : null, v }); });
    if (pts.length < 1) return;
    const last = pts[pts.length - 1], prev = pts.length > 1 ? pts[pts.length - 2] : null;
    const first = pts[Math.max(0, pts.length - 53)];
    series.push({
      column: h, latest: last.v, as_of: last.d, previous: prev ? prev.v : null,
      change_pct: prev && prev.v ? Math.round(((last.v - prev.v) / Math.abs(prev.v)) * 1000) / 10 : null,
      change_52_pct: first && first.v && pts.length > 1 ? Math.round(((last.v - first.v) / Math.abs(first.v)) * 1000) / 10 : null,
      spark: pts.slice(-60).map((p) => p.v),
    });
  });
  return { date_column: dateAt >= 0 ? header[dateAt] : null, series };
}

const PRODUCT_WORDS = [
  [/(\d{2})\s*s?\b[^a-z]*(?:ne\b|s\b)?[^a-z]*carded.*?(bci|organic)/i, 'carded_bci'], [/(\d{2})\s*s?\b[^a-z]*(?:ne\b|s\b)?[^a-z]*combed.*?(bci|organic)/i, 'combed_bci'],
  [/(\d{2})\s*s?\b[^a-z]*(?:ne\b|s\b)?[^a-z]*carded.*?slub/i, 'carded_slub'], [/(\d{2})\s*s?\b[^a-z]*(?:ne\b|s\b)?[^a-z]*combed.*?slub/i, 'combed_slub'],
  [/(\d{2})\s*s?\b[^a-z]*(?:ne\b|s\b)?[^a-z]*carded/i, 'carded_regular'], [/(\d{2})\s*s?\b[^a-z]*(?:ne\b|s\b)?[^a-z]*combed/i, 'combed_regular'],
];
/**
 * A suggestion, never a decision: columns whose names read as a yarn count of a known product ("30s Carded", "40/1 Combed")
 * are offered as a costing mapping. The admin accepts it, or writes their own.
 */
function suggestMapping(header, t) {
  const cols = [];
  header.forEach((h) => {
    const hit = PRODUCT_WORDS.find(([re]) => re.test(h));
    if (!hit) return;
    const ne = +hit[0].exec(h)[1];
    if (ne >= 4 && ne <= 120) cols.push({ column: h, item_key: hit[1], count_ne: ne });
  });
  return cols.length ? [{ columns: cols, note: 'Column names read as a yarn count and a product. Check them against the table before switching costing on.' }] : [];
}

// ── the daily sync's view of the subscription ─────────────────────────────────────────────────────────────────
function registerProvider() {
  ET.setProvider(async () => {
    const key = await getKey();
    if (!key) return null;
    const s = await settings();
    const tables = (await listTables()).filter((t) => t.enabled);
    const byUrl = new Map();
    const endpoints = tables.map((t) => {
      const ep = { dataset: t.dataset, sheet: t.sheet, country: t.country || undefined, _id: t.id, label: t.title, ...(t.mapping || {}) };
      byUrl.set(`${t.dataset}/${t.sheet}`, t);
      return ep;
    });
    return {
      key, base: s.base_url || undefined, endpoints,
      onTable: async (ep, table, url, error) => {
        try {
          if (error) await noteFailure(ep._id, error);
          else if (table) await saveSnapshot(ep._id, table);
        } catch (e) { console.error('[et] snapshot not saved:', e.message); }
      },
    };
  });
}

// ── finding the subscription's tables ─────────────────────────────────────────────────────────────────────────
const WORDS = (s) => String(s).toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !['the', 'and', 'of', 'in', 'prices', 'price', 'database', 'market', 'markets'].includes(w));
const COUNTRY_NAME = { CN: 'china', IN: 'india', PK: 'pakistan', BD: 'bangladesh', TR: 'turkey', VN: 'vietnam', KH: 'cambodia', ID: 'indonesia', LK: 'sri lanka', MM: 'myanmar' };
const CAT_WORDS = { cotton: ['cotton', 'carded', 'combed', 'cotlook'], polyester: ['polyester', 'psf', 'pta', 'meg', 'pet'], viscose: ['viscose', 'lyocell', 'modal', 'vsf', 'rayon'], nylon: ['nylon', 'spandex', 'elastane'], wool: ['wool', 'acrylic', 'linen', 'flax', 'cashmere', 'silk', 'down'], apparel: ['apparel', 'clothing', 'imports', 'exports', 'wages', 'currency', 'inflation'] };

function categoryOf(text) {
  const w = new Set(WORDS(text));
  let best = 'other', score = 0;
  for (const [c, words] of Object.entries(CAT_WORDS)) { const n = words.filter((x) => w.has(x)).length; if (n > score) { best = c; score = n; } }
  return best;
}
/** The slot on the publisher's menu a dataset/sheet most likely is, or null: category words must agree and the title's words must show up. */
function matchSlot(dataset, sheet) {
  const text = `${dataset} ${sheet}`, w = new Set(WORDS(text));
  const cat = categoryOf(text);
  let best = null, bestScore = 0;
  for (const s of SLOTS) {
    if (cat !== 'other' && s.category !== cat) continue;
    const tw = WORDS(s.title + ' ' + (COUNTRY_NAME[s.country] || ''));
    const hit = tw.filter((x) => w.has(x)).length;
    const kindBonus = (s.kind === 'report') === /report|analysis/.test(text.toLowerCase()) ? 0.5 : 0;
    const score = tw.length ? (hit + kindBonus) / (tw.length + 0.5) : 0;
    if (hit >= 2 && score > bestScore) { best = s; bestScore = score; }
  }
  return bestScore >= 0.5 ? best : null;
}

/** Datasets and their sheets from a listing in whatever shape the API gives: names, {name: [sheets]}, [{dataset, sheets}]. */
function parseListing(text) {
  let v; try { v = JSON.parse(text); } catch (_) { return { datasets: [], pairs: [] }; }
  for (let k = 0; k < 3 && v && !Array.isArray(v) && typeof v === 'object'; k++) {
    const next = v.datasets || v.data || v.items || v.sheets || v.result || v.results;
    if (next) v = next; else break;
  }
  const datasets = new Set(), pairs = [];
  const nameOf = (x) => (typeof x === 'string' ? x : x && (x.name || x.dataset || x.id || x.slug || x.title)) || null;
  if (Array.isArray(v)) {
    v.forEach((x) => {
      const n = nameOf(x); if (n) datasets.add(String(n));
      const sh = x && (x.sheets || x.tables); if (n && Array.isArray(sh)) sh.forEach((s) => { const sn = nameOf(s); if (sn) pairs.push([String(n), String(sn)]); });
    });
  } else if (v && typeof v === 'object') {
    Object.entries(v).forEach(([k, val]) => { datasets.add(k); if (Array.isArray(val)) val.forEach((s) => { const sn = nameOf(s); if (sn) pairs.push([k, String(sn)]); }); });
  }
  return { datasets: [...datasets], pairs };
}

async function discover() {
  if (!(await getKey())) throw new EtError('Save the API key first.');
  const s = await settings();
  const base = ET.BASE(s.base_url);
  const tried = [];
  const get = async (url) => { try { const r = await ET.fetchRaw(url); tried.push({ url, status: r.status }); return r; } catch (e) { tried.push({ url, error: e.message }); return null; } };
  let pairs = [], datasets = [];
  const root = await get(base);
  if (root && root.ok) { const p = parseListing(root.text); pairs = p.pairs; datasets = p.datasets; }
  // datasets named but their sheets not: ask each one
  const missing = datasets.filter((d) => !pairs.some((p) => p[0] === d)).slice(0, 60);
  for (const d of missing) {
    const r = await get(`${base}/${encodeURIComponent(d)}`);
    if (r && r.ok) parseListing(r.text).datasets.forEach((sh) => pairs.push([d, sh]));
  }
  let added = 0, matched = 0;
  const found = [];
  for (const [dataset, sheet] of pairs.slice(0, 600)) {
    const slot = matchSlot(dataset, sheet);
    const cat = slot ? slot.category : categoryOf(`${dataset} ${sheet}`);
    const row = await addTable({ dataset, sheet, category: cat, title: slot ? slot.title : `${dataset.replace(/[-_]/g, ' ')} / ${sheet.replace(/[-_]/g, ' ')}`, catalogue_id: slot ? slot.id : null, country: slot ? slot.country : null });
    added++; if (slot) matched++;
    found.push({ id: row.id, dataset, sheet, slot: slot ? slot.title : null });
  }
  const note = pairs.length ? `Found ${pairs.length} tables; ${matched} matched to the publisher's menu.`
    : 'The API did not list its tables at the address tried. Add a table by hand with its dataset and sheet name (the names on the publisher\'s API page, or in the Excel / API links of each table).';
  return { ok: pairs.length > 0, added, matched, tried, note, found: found.slice(0, 50) };
}

/** Does the key work? The first enabled table is fetched; with none, the listing is asked for. */
async function testConnection() {
  const key = await getKey();
  if (!key) throw new EtError('Save the API key first.');
  const s = await settings();
  const tables = (await listTables()).filter((t) => t.enabled);
  let ok = false, note = '';
  try {
    if (tables.length) {
      const t = tables[0];
      await ET.fetchTable({ dataset: t.dataset, sheet: t.sheet });
      ok = true; note = `The key works: ${t.dataset} / ${t.sheet} was read.`;
    } else {
      const r = await ET.fetchRaw(ET.BASE(s.base_url));
      ok = r.ok || r.status === 404 ? r.status !== 401 && r.status !== 403 : false;
      note = r.status === 401 || r.status === 403 ? `Emerging Textiles refused the key (HTTP ${r.status}): check the key, and that the subscription is Corporate (API access).`
        : r.ok ? 'The key was accepted. Press "Find my tables".' : `The key was not refused (HTTP ${r.status}). Press "Find my tables", or add a table by hand.`;
    }
  } catch (e) { note = e.message; }
  await query('UPDATE et_settings SET tested_at = now(), test_ok = $1, test_note = $2 WHERE id = 1', [ok, note.slice(0, 300)]);
  return { ok, note };
}

/** Fetch one table now and keep it (no price is stored from this: the daily sync does that for mapped tables). */
async function refreshTable(id) {
  const t = await queryOne(`SELECT ${TABLE_COLS} FROM et_tables WHERE id = $1`, [id]);
  if (!t) throw new EtError('No such table.');
  try {
    const { table } = await ET.fetchTable({ dataset: t.dataset, sheet: t.sheet });
    await saveSnapshot(id, table);
    return getSnapshot(id);
  } catch (e) { await noteFailure(id, e.message); throw new EtError(e.message); }
}

// ── the dashboard's one answer ────────────────────────────────────────────────────────────────────────────────
async function status() {
  const s = await settings();
  const hasKey = !!s.api_key_sealed || !!process.env.ET_API_KEY;
  return {
    has_key: hasKey, key_last4: s.key_last4 || (process.env.ET_API_KEY ? process.env.ET_API_KEY.slice(-4) : null), key_from: s.api_key_sealed ? 'dashboard' : process.env.ET_API_KEY ? 'server environment' : null,
    saved_at: s.saved_at || null, tested_at: s.tested_at || null, test_ok: s.test_ok, test_note: s.test_note || null, base_url: s.base_url || ET.DEFAULT_BASE,
  };
}

async function overview() {
  const st = await status();
  const tables = await listTables();
  const snaps = await query('SELECT table_id, fetched_at, row_count, header, rows FROM et_snapshots').then((r) => r.rows || r);
  const sn = new Map(snaps.map((x) => {
    // the headline of a table for the menu: its first numeric column's latest value, change and sparkline
    let head = null;
    try { const sm = summarise(x.header, (x.rows || []).slice(-70)); head = sm.series[0] ? { column: sm.series[0].column, ...sm.series[0] } : null; } catch (_) { /* a table that will not summarise shows no headline */ }
    return [x.table_id, { table_id: x.table_id, fetched_at: x.fetched_at, row_count: x.row_count, headline: head }];
  }));
  const byCat = (cat) => ({
    slots: SLOTS.filter((s) => s.category === cat).map((s) => {
      const t = tables.find((x) => x.catalogue_id === s.id);
      return { ...s, table: t ? { ...t, fetched_at: (sn.get(t.id) || {}).fetched_at || null, row_count: (sn.get(t.id) || {}).row_count || 0, headline: (sn.get(t.id) || {}).headline || null } : null };
    }),
    extra: tables.filter((t) => t.category === cat && !SLOTS.some((s) => s.id === t.catalogue_id)).map((t) => ({ ...t, fetched_at: (sn.get(t.id) || {}).fetched_at || null, row_count: (sn.get(t.id) || {}).row_count || 0, headline: (sn.get(t.id) || {}).headline || null })),
  });
  return {
    status: st,
    categories: CATEGORIES.map((c) => ({ ...c, ...byCat(c.id) })).concat([{ id: 'other', label: 'Other tables', slots: [], extra: tables.filter((t) => t.category === 'other').map((t) => ({ ...t, fetched_at: (sn.get(t.id) || {}).fetched_at || null, row_count: (sn.get(t.id) || {}).row_count || 0, headline: (sn.get(t.id) || {}).headline || null })) }]),
    totals: { tables: tables.length, enabled: tables.filter((t) => t.enabled).length, fetched: snaps.length, costing: tables.filter((t) => t.mapping).length, failing: tables.filter((t) => t.last_ok === false).length },
    costing_keys: COSTING_KEYS,
  };
}

/** "Find a price": every stored table whose title, columns or country matches the words. */
async function search(q) {
  const words = WORDS(q); if (!words.length) return [];
  const tables = await listTables();
  const snaps = await query('SELECT table_id, header FROM et_snapshots').then((r) => r.rows || r);
  const head = new Map(snaps.map((x) => [x.table_id, (x.header || []).join(' ')]));
  return tables.map((t) => {
    const hay = new Set(WORDS(`${t.title} ${t.dataset} ${t.sheet} ${t.country || ''} ${COUNTRY_NAME[t.country] || ''} ${head.get(t.id) || ''}`));
    const hit = words.filter((w) => hay.has(w)).length;
    return { t, hit };
  }).filter((x) => x.hit === words.length).map((x) => x.t).slice(0, 30);
}

module.exports = { EtError, getKey, saveKey, clearKey, status, overview, listTables, addTable, updateTable, deleteTable, getSnapshot, refreshTable, discover, testConnection, search,
  registerProvider, summarise, suggestMapping, matchSlot, parseListing, categoryOf, cleanMapping };
