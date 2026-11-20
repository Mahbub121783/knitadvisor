// Emerging Textiles source: the documented JSON sheets API (and CSV), read into the engine's quote rows.
// NOTE: the response bodies below are assumed shapes written from the vendor's documentation (a JSON table; field names are
// not published). The adapter reads several shapes and the admin "Test a table" button shows the real one: when the real
// response is seen, add it here as a fixture.
'use strict';
const assert = require('assert');
const ET = require('../jobs/price-sources/emergingtextiles');
const { mergeRows } = require('../jobs/yarn-price-sync');

console.log('--- Running Emerging Textiles Source Tests ---');
const asRes = (body, ctype, status) => async () => ({ ok: (status || 200) < 400, status: status || 200, headers: { get: () => ctype }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const withEnv = async (env, fn) => {
  const keep = {};
  Object.keys(env).forEach((k) => { keep[k] = process.env[k]; if (env[k] == null) delete process.env[k]; else process.env[k] = env[k]; });
  try { return await fn(); } finally { Object.keys(keep).forEach((k) => { if (keep[k] == null) delete process.env[k]; else process.env[k] = keep[k]; }); }
};

(async () => {
  // not configured is not failed
  await withEnv({ ET_API_KEY: null, ET_ENDPOINTS: null }, async () => {
    const r = await ET.collect();
    assert.strictEqual(r.configured, false); assert.strictEqual(r.rows.length, 0); assert.strictEqual(ET.isConfigured(), false);
  });
  console.log('✓ no key: reported as not configured, not as a failure');

  const EPS = JSON.stringify([
    { dataset: 'Bangladesh-Yarn-Prices_Weekly', sheet: 'cotton-yarn-indicator', country: 'BD', item_key: 'cotton_carded', count_ne: 30 },
    { dataset: 'India-Yarn-Prices', sheet: 'weekly', country: 'IN', columns: [{ column: '30s Carded', item_key: 'cotton_carded', count_ne: 30 }, { column: '40s Combed', item_key: 'cotton_combed', count_ne: 40 }] },
  ]);
  await withEnv({ ET_API_KEY: 'k', ET_ENDPOINTS: EPS }, async () => {
    assert.strictEqual(ET.isConfigured(), true);
    let seenUrl, seenHeaders;
    const bodies = {
      'cotton-yarn-indicator': { data: [{ Date: '2026-07-06', 'Price (USD/kg)': '3.20' }, { Date: '2026-07-13', 'Price (USD/kg)': '3.25' }, { Date: 'source: ET', 'Price (USD/kg)': '' }] },
      weekly: { columns: ['Week', '30s Carded', '40s Combed'], rows: [['2026-07-06', 3.1, 3.7], ['2026-07-13', 3.15, 3.72]] },
    };
    const fetchImpl = async (url, opts) => { seenUrl = url; seenHeaders = opts.headers; const key = Object.keys(bodies).find((k) => url.endsWith('/' + k)); return asRes(bodies[key], 'application/json')(); };
    const r = await ET.collect({ fetchImpl });
    assert(r.configured && r.rows.length === 3, JSON.stringify(r.rejected));
    const bd = r.rows.find((x) => x.country === 'BD'), inn = r.rows.filter((x) => x.country === 'IN');
    assert.strictEqual(bd.price_usd_kg, 3.25); assert.strictEqual(bd.quoted_on, '2026-07-13'); assert.strictEqual(bd.item_key, 'cotton_carded');
    assert.deepStrictEqual(inn.map((x) => [x.item_key, x.count_ne, x.price_usd_kg]), [['cotton_carded', 30, 3.15], ['cotton_combed', 40, 3.72]]);
    assert(r.rows.every((x) => x.source === 'emergingtextiles' && x.market === 'lc_usd' && /redistribution/.test(x.licence_note)));
    assert(/^https:\/\/api\.emergingtextiles\.com\/api\/sheets\//.test(seenUrl), seenUrl);
    assert.strictEqual(seenHeaders['X-API-Key'], 'k'); assert(seenUrl.indexOf('key') < 0, 'the key is never in the URL');
    console.log('✓ the sheets API (JSON): one price per table or per column, the last dated numeric row (a footer is not a price), key in the header, HTTPS, licence note on every row');

    // CSV form, other date shapes
    const csv = 'Date,USD\n12 Jul 2026,3.10\nJul 2026,3.30\n';
    const rc = ET.rowsOf({ item_key: 'x', count_ne: 30, country: 'BD' }, ET.toTable(csv, 'text/csv'));
    assert.strictEqual(rc.rows[0].price_usd_kg, 3.3); assert.strictEqual(rc.rows[0].quoted_on, '2026-07-01');
    assert.strictEqual(ET.readDate('13/07/2026'), '2026-07-13'); assert.strictEqual(ET.readDate('Jul 13, 2026'), '2026-07-13'); assert.strictEqual(ET.readDate('nonsense'), null);
    assert(ET.toTable('[["Date","Price"],["2026-07-13",3.2]]', 'application/json').rows.length === 1);
    console.log('✓ CSV and the usual date shapes are read; arrays of arrays and {columns, rows} tables too');

    // refusals in words
    const refuse = async (status, re) => { const x = await ET.collect({ fetchImpl: asRes('x', 'text/plain', status) }); assert(x.rows.length === 0 && x.rejected.some((j) => re.test(j.why)), JSON.stringify(x.rejected)); };
    await refuse(401, /refused the key/); await refuse(404, /not found/); await refuse(500, /HTTP 500/);
    const odd = await ET.collect({ fetchImpl: asRes('<html>nope</html>', 'text/html') });
    assert(odd.rejected.every((j) => /not a table/.test(j.why)));
    const bad = ET.toRow({ item_key: 'x', currency: 'BDT' }, { price: 100, quoted_on: '2026-07-13' }); assert(bad.reject && /BDT/.test(bad.why));
    assert(ET.toRow({ item_key: 'x' }, { price: 90, quoted_on: '2026-07-13' }).reject, 'not a yarn price');
    console.log('✓ a refused key, a wrong sheet name, a server error, a web page, a non-USD table and an absurd price are each refused with the reason');

    // the probe: what the admin button shows
    const p = await ET.probe({ dataset: 'D', sheet: 'cotton-yarn-indicator', item_key: 'cotton_carded', count_ne: 30 }, { fetchImpl: asRes(bodies['cotton-yarn-indicator'], 'application/json') });
    assert(p.ok && p.table.date_column === 'Date' && p.table.price_columns.includes('Price (USD/kg)') && p.as_rows.rows[0].price_usd_kg === 3.25);
    assert(!JSON.stringify(p).includes('"k"'), 'the key is not echoed');
    console.log('✓ the probe reports columns, the date column, the price columns and the row it would store; the key is not echoed');

    // the merge: fresher wins, a same-day tie goes to Emerging Textiles
    const tex = { source: 'texbazar', market: 'lc_usd', country: 'BD', item_key: 'cotton_carded', count_ne: 30, price_usd_kg: 3.0, quoted_on: '2026-07-13' };
    const pick = (rows) => mergeRows(rows).rows.filter((x) => x.item_key === 'cotton_carded' && x.country === 'BD' && x.count_ne === 30);
    const m1 = pick([tex, bd]);
    assert(m1.length === 1 && m1[0].source === 'emergingtextiles', 'same day: the paid source is the one used');
    const m2 = pick([tex, { ...bd, quoted_on: '2026-07-01' }]);
    assert(m2.length === 1 && m2[0].source === 'texbazar', 'a fresher dealer list beats an older paid quote');
    console.log('✓ merged with the free list: fresher wins, a same-day tie goes to Emerging Textiles');
  });
  console.log('Emerging Textiles source tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
