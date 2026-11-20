// Emerging Textiles dashboard service: the sealed key, finding the subscription's tables, the publisher's menu layout, the kept
// copy of every table, search, and the costing mapping. The database is a small in-memory stand-in that answers exactly the
// statements the service sends: it checks the service's logic, NOT the SQL (which has not been run on a real PostgreSQL here).
'use strict';
const assert = require('assert');
process.env.API_KEY_ENCRYPTION_SECRET = 'test-secret-for-the-sealed-key-0123456789';
delete process.env.ET_API_KEY;

// ── an in-memory stand-in for db/client.js ──────────────────────────────────────────────────────────────────────────
const db = { settings: { id: 1, api_key_sealed: null, key_last4: null, base_url: null, saved_at: null, tested_at: null, test_ok: null, test_note: null }, tables: [], snaps: new Map(), seq: 0 };
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
async function query(sql, p = []) {
  const s = norm(sql);
  if (/^SELECT \* FROM et_settings/.test(s)) return [{ ...db.settings }];
  if (/^UPDATE et_settings SET api_key_sealed = \$1/.test(s)) { Object.assign(db.settings, { api_key_sealed: p[0], key_last4: p[1], base_url: p[2], saved_at: new Date(), tested_at: null, test_ok: null, test_note: null }); return []; }
  if (/^UPDATE et_settings SET api_key_sealed = NULL/.test(s)) { Object.assign(db.settings, { api_key_sealed: null, key_last4: null, saved_at: null, tested_at: null, test_ok: null, test_note: null }); return []; }
  if (/^UPDATE et_settings SET tested_at/.test(s)) { Object.assign(db.settings, { tested_at: new Date(), test_ok: p[0], test_note: p[1] }); return []; }
  if (/^SELECT .* FROM et_tables ORDER BY/.test(s)) return db.tables.slice().sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : a.id - b.id));
  if (/^SELECT .* FROM et_tables WHERE id = \$1/.test(s)) return db.tables.filter((t) => t.id === p[0]);
  if (/^INSERT INTO et_tables/.test(s)) {
    let t = db.tables.find((x) => x.dataset === p[3] && x.sheet === p[4]);
    if (t) { t.catalogue_id = p[0] || t.catalogue_id; t.title = p[2]; t.category = p[1]; }
    else { t = { id: ++db.seq, catalogue_id: p[0], category: p[1], title: p[2], dataset: p[3], sheet: p[4], country: p[5], mapping: p[6] ? json(p[6]) : null, enabled: true, last_fetched_at: null, last_ok: null, last_error: null }; db.tables.push(t); }
    return [t];
  }
  if (/^UPDATE et_tables SET last_fetched_at = now\(\), last_ok = true/.test(s)) { const t = db.tables.find((x) => x.id === p[0]); Object.assign(t, { last_fetched_at: new Date(), last_ok: true, last_error: null }); return []; }
  if (/^UPDATE et_tables SET last_fetched_at = now\(\), last_ok = false/.test(s)) { const t = db.tables.find((x) => x.id === p[0]); Object.assign(t, { last_fetched_at: new Date(), last_ok: false, last_error: p[1] }); return []; }
  if (/^UPDATE et_tables SET .* WHERE id = \$\d+ RETURNING/.test(s)) {
    const t = db.tables.find((x) => x.id === p[p.length - 1]); if (!t) return [];
    const cols = [...s.matchAll(/(\w+) = \$(\d+)/g)].filter((m) => m[1] !== 'id');
    cols.forEach((m) => { const v = p[+m[2] - 1]; t[m[1]] = m[1] === 'mapping' ? (v ? json(v) : null) : v; });
    return [t];
  }
  if (/^DELETE FROM et_tables/.test(s)) { db.tables = db.tables.filter((t) => t.id !== p[0]); db.snaps.delete(p[0]); return []; }
  if (/^INSERT INTO et_snapshots/.test(s)) { db.snaps.set(p[0], { table_id: p[0], fetched_at: new Date(), header: json(p[1]), rows: json(p[2]), row_count: p[3] }); return []; }
  if (/^SELECT fetched_at, header, rows, row_count FROM et_snapshots/.test(s)) return db.snaps.has(p[0]) ? [db.snaps.get(p[0])] : [];
  if (/^SELECT table_id, fetched_at, row_count, header, rows FROM et_snapshots/.test(s)) return [...db.snaps.values()];
  if (/^SELECT table_id, header FROM et_snapshots/.test(s)) return [...db.snaps.values()].map((x) => ({ table_id: x.table_id, header: x.header }));
  throw new Error('the stand-in database was not taught this statement: ' + s.slice(0, 100));
}
const queryOne = async (sql, p) => (await query(sql, p))[0] || null;
const clientPath = require.resolve('../db/client');
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { query, queryOne } };

const E = require('../services/emerging-textiles');
const ET = require('../jobs/price-sources/emergingtextiles');
const { SLOTS, CATEGORIES } = require('../engine/catalog/et-catalogue');

console.log('--- Running Emerging Textiles Dashboard Tests ---');
const asRes = (body, ctype, status) => ({ ok: (status || 200) < 400, status: status || 200, headers: { get: () => ctype || 'application/json' }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

(async () => {
  // the menu is the publisher's: six sections, each with database and report slots
  assert.deepStrictEqual(CATEGORIES.map((c) => c.id), ['cotton', 'polyester', 'viscose', 'nylon', 'wool', 'apparel']);
  assert(SLOTS.length > 100 && new Set(SLOTS.map((s) => s.id)).size === SLOTS.length, 'every slot has its own id');
  assert(SLOTS.filter((s) => s.category === 'cotton' && s.kind === 'database' && s.group === 'Yarns' && !s.sustainable).length === 7);
  assert(SLOTS.some((s) => s.title === 'Apparel Exports: Sri Lanka' && s.country === 'LK'));
  console.log('✓ the menu: six sections, database and report slots, fibres and yarns, sustainable lists, apparel exports by country');

  // before a key: nothing connected, and the whole menu is shown unmapped
  let ov = await E.overview();
  assert.strictEqual(ov.status.has_key, false); assert.strictEqual(ov.totals.tables, 0);
  assert(ov.categories.every((c) => c.slots.every((s) => s.table === null)));
  console.log('✓ no key: not connected, the whole menu shown as not found');

  // the key: sealed at rest, only the last four characters come back
  assert.rejects ? null : null;
  await assert.rejects(() => E.saveKey('short'), /does not look like an API key/);
  await assert.rejects(() => E.saveKey('has a space in it 1234567890'), /does not look like an API key/);
  await assert.rejects(() => E.saveKey('A'.repeat(30), 'http://insecure'), /https/);
  const KEY = 'et_live_ABCDEFGHIJKLMNOP1234567890wxyz';
  const st = await E.saveKey(KEY);
  assert(st.has_key && st.key_last4 === 'wxyz' && st.key_from === 'dashboard');
  assert(!JSON.stringify(st).includes(KEY) && !JSON.stringify(await E.overview()).includes(KEY), 'the key is never returned');
  assert(db.settings.api_key_sealed && !db.settings.api_key_sealed.includes(KEY) && /^v1\./.test(db.settings.api_key_sealed), 'sealed at rest');
  assert.strictEqual(await E.getKey(), KEY);
  console.log('✓ the key: refused if it is not shaped like one, sealed at rest, only its last four characters ever shown');

  // the daily sync reads the key and the tables through the provider; each fetched table is kept
  E.registerProvider();
  const LISTING = { datasets: [{ name: 'Bangladesh-Yarn-Prices_Weekly', sheets: ['cotton-yarn-indicator', 'polyester-yarn-indicator'] }, { name: 'US-Apparel-Imports', sheets: ['knit-apparel-products'] }, { name: 'Mystery-Data', sheets: ['x'] }] };
  const TABLES = {
    'cotton-yarn-indicator': { columns: ['Week', '30s Carded', '40s Combed'], rows: Array.from({ length: 30 }, (_, i) => [`2026-0${1 + Math.floor(i / 8)}-${String(1 + (i % 8) * 3).padStart(2, '0')}`, +(3 + i * 0.01).toFixed(2), +(3.6 + i * 0.012).toFixed(2)]) },
    'polyester-yarn-indicator': { data: [{ Date: '2026-07-06', 'Price USD': 2.1 }, { Date: '2026-07-13', 'Price USD': 2.05 }] },
    'knit-apparel-products': [['Month', 'Imports USD m'], ['Jun 2026', 910], ['Jul 2026', 950]],
    x: 'not a table at all <html>',
  };
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    seen.push([url, opts.headers['X-API-Key']]);
    if (/\/api\/sheets\/?$/.test(url)) return asRes(LISTING);
    const sheet = decodeURIComponent(url.split('/').pop());
    if (!(sheet in TABLES)) return asRes('nope', 'text/plain', 404);
    return asRes(TABLES[sheet], typeof TABLES[sheet] === 'string' ? 'text/html' : 'application/json');
  };
  try {
    const found = await E.discover();
    assert(found.ok && found.added === 4, JSON.stringify(found));
    assert(seen.every(([, k]) => k === KEY) && seen.every(([u]) => u.startsWith('https://')), 'the sealed key is the one sent, over HTTPS');
    const tables = await E.listTables();
    const cotton = tables.find((t) => t.sheet === 'cotton-yarn-indicator'), apparel = tables.find((t) => t.sheet === 'knit-apparel-products'), mystery = tables.find((t) => t.sheet === 'x');
    assert.strictEqual(cotton.category, 'cotton'); assert.strictEqual(cotton.catalogue_id, 'cotton:database:yarns:bangladesh-yarn-market'); assert.strictEqual(cotton.country, 'BD');
    assert.strictEqual(apparel.category, 'apparel'); assert.strictEqual(mystery.category, 'other'); assert(mystery.catalogue_id === null);
    console.log('✓ "Find my tables": the listing is read, each table is matched to its slot on the publisher\'s menu (Bangladesh cotton yarn -> Cotton / Yarns / Bangladesh Yarn Market), unknown ones go to "Other"');

    // refreshing keeps the whole table; a table that is not a table is a failure shown on that table only
    for (const t of tables) { try { await E.refreshTable(t.id); } catch (_) { /* recorded on the table */ } }
    const after = await E.listTables();
    assert(after.find((t) => t.sheet === 'cotton-yarn-indicator').last_ok === true);
    assert(after.find((t) => t.sheet === 'x').last_ok === false && /not a table/.test(after.find((t) => t.sheet === 'x').last_error));
    const snap = await E.getSnapshot(cotton.id);
    assert.strictEqual(snap.snapshot.row_count, 30); assert.deepStrictEqual(snap.snapshot.header, ['Week', '30s Carded', '40s Combed']);
    const c30 = snap.summary.series.find((x) => x.column === '30s Carded');
    assert.strictEqual(c30.latest, 3.29); assert.strictEqual(c30.previous, 3.28); assert(c30.change_pct > 0 && c30.spark.length === 30 && c30.change_52_pct > 0);
    const poly = (await E.getSnapshot(tables.find((t) => t.sheet === 'polyester-yarn-indicator').id)).summary.series[0];
    assert.strictEqual(poly.latest, 2.05); assert(poly.change_pct < 0 && poly.as_of === '2026-07-13');
    const ap = (await E.getSnapshot(apparel.id)).summary.series[0];
    assert.strictEqual(ap.latest, 950); assert.strictEqual(ap.as_of, '2026-07-01');
    console.log('✓ every table is kept whole (rows, columns); latest, previous, change, 52-point change and a trend are worked out for each numeric column; a response that is not a table fails on its own table');

    // the dashboard's menu: mapped slots carry their table and headline, the rest are not found
    ov = await E.overview();
    const cot = ov.categories.find((c) => c.id === 'cotton');
    const bdSlot = cot.slots.find((s) => s.id === 'cotton:database:yarns:bangladesh-yarn-market');
    assert(bdSlot.table && bdSlot.table.row_count === 30 && bdSlot.table.headline.latest === 3.29);
    assert(cot.slots.filter((s) => s.table).length === 1 && cot.slots.some((s) => !s.table));
    assert.strictEqual(ov.categories.find((c) => c.id === 'other').extra.length, 1);
    assert(ov.totals.tables === 4 && ov.totals.fetched === 3 && ov.totals.failing === 1 && ov.totals.costing === 0);
    console.log('✓ the menu fills from the subscription: the matched slot shows its table with latest value and trend, the others stay "not found", the totals add up');

    // find a price
    assert.deepStrictEqual((await E.search('bangladesh polyester')).map((t) => t.sheet), ['polyester-yarn-indicator']);
    assert((await E.search('combed')).some((t) => t.sheet === 'cotton-yarn-indicator'), 'a column name is searchable');
    assert.strictEqual((await E.search('zzzz')).length, 0);
    console.log('✓ "Find a price" searches titles, countries and column names');

    // costing: a suggestion from the column names, a mapping that is checked, and the rows the daily sync will store
    assert.deepStrictEqual(snap.suggestions[0].columns.map((c) => [c.item_key, c.count_ne]), [['carded_regular', 30], ['combed_regular', 40]]);
    await assert.rejects(() => E.updateTable(cotton.id, { mapping: { columns: [{ column: '30s Carded', item_key: 'gold', count_ne: 30 }] } }), /Choose at least one column/);
    await assert.rejects(() => E.updateTable(cotton.id, { mapping: { item_key: 'carded_regular', count_ne: 999 } }), /needs a product/);
    const mapped = await E.updateTable(cotton.id, { mapping: { columns: snap.suggestions[0].columns } });
    assert(mapped.mapping.columns.length === 2);
    const cfg = await ET.config();
    const ep = cfg.endpoints.find((x) => x.sheet === 'cotton-yarn-indicator');
    assert(cfg.key === KEY && ep.country === 'BD' && ep.columns.length === 2 && cfg.endpoints.length === 4);
    const col = await ET.collect();
    assert(col.configured && col.rows.length === 2, JSON.stringify(col.rejected));
    assert.deepStrictEqual(col.rows.map((r) => [r.item_key, r.count_ne, r.price_usd_kg, r.country]).sort(), [['carded_regular', 30, 3.29, 'BD'], ['combed_regular', 40, 3.95, 'BD']].sort());
    assert((await E.overview()).totals.costing === 1);
    console.log('✓ costing: column names are offered as a mapping, a bad product or count is refused, a saved mapping becomes the two quote rows the daily sync stores, and unmapped tables feed nothing');

    // pause, add by hand, remove
    await E.updateTable(apparel.id, { enabled: false });
    assert((await ET.config()).endpoints.length === 3, 'a paused table is not fetched');
    const hand = await E.addTable({ dataset: 'Custom-DS', sheet: 'my-sheet', title: 'My table', category: 'nylon' });
    assert.strictEqual(hand.category, 'nylon'); assert.strictEqual((await E.addTable({ dataset: 'Custom-DS', sheet: 'my-sheet', title: 'My table 2', category: 'nylon' })).id, hand.id, 'the same dataset and sheet is one table');
    await E.deleteTable(hand.id);
    assert(!(await E.listTables()).some((t) => t.id === hand.id));
    console.log('✓ a table can be paused (not fetched), added by hand (once per dataset and sheet) and removed');

    // test + remove the key
    const t1 = await E.testConnection();
    assert(t1.ok && /works/.test(t1.note));
    globalThis.fetch = async () => asRes('denied', 'text/plain', 401);
    const t2 = await E.testConnection();
    assert(!t2.ok && /refused/.test(t2.note));
    assert.strictEqual((await E.status()).test_ok, false);
    await E.clearKey();
    assert.strictEqual((await E.status()).has_key, false); assert.strictEqual(await E.getKey(), null);
    assert.strictEqual((await ET.collect()).configured, false, 'no key: the source is not configured, not failed');
    await assert.rejects(() => E.discover(), /Save the API key first/);
    console.log('✓ test: a working key is reported as such, a refused key says so and why; removing the key stops every fetch');
  } finally { globalThis.fetch = realFetch; ET.setProvider(null); }
  console.log('Emerging Textiles dashboard tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
