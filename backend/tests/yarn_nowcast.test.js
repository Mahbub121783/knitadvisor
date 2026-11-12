const assert = require('assert');
const XLSX = require('xlsx');
const bench = require('../jobs/price-sources/benchmarks');
const { nowcast, fibreMix } = require('../engine/domain/yarn-nowcast');
const C = require('../engine/domain/costing-engine');

console.log('--- Running Yarn Nowcast and Benchmark Tests ---');
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// 1. the monthly workbook is read by its headers and units, never by position
{
  const rows = [
    ['World Bank Commodity Price Data (The Pink Sheet)'], ['monthly prices'], [''], ['Updated on November 03, 2026'],
    [null, 'Crude oil, average', 'Crude oil, Brent', 'Cocoa', 'Cotton, A Index'],
    [null, '($/bbl)', '($/bbl)', '($/kg)', '($/kg)'],
    ['2026M05', 100, 107.5, 8, 2.03], ['2026M09', 110, 116.8, 8, 2.10], ['2026M10', 120, 125, 8, 2.00], ['2026M11', '…', '…', '…', '…'],
  ];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Monthly Prices');
  const p = bench.parseMonthly(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  assert.deepStrictEqual(p.cotton_usd_kg, { '2026-05': 2.03, '2026-09': 2.10, '2026-10': 2.00 });
  assert.strictEqual(p.brent_usd_bbl['2026-10'], 125);
  assert.strictEqual(p.updated_on, '2026-11-03');
  const bad = rows.map((r) => r.slice()); bad[5][4] = '($/mt)';
  const wb2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(bad), 'Monthly Prices');
  assert.throws(() => bench.parseMonthly(XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' })), /units/, 'changed units are refused, not misread');
  console.log('  Monthly workbook read by header and unit; a changed unit is refused');
}

// 2. the daily page: value and date, or a loud failure
{
  const html = '<span class="show-for-sr">. Date of index value: </span>14:30 GMT 10th Nov, 2026 </strong><table><tr id="aIndex"><th scope="row">A Index</th>\n<td class="text-left">90.85</td><td>(+0.15)</td></tr></table>';
  const d = bench.parseDaily(html);
  assert.strictEqual(d.date, '2026-11-10');
  near(d.cotton_usd_kg, 0.9085 * 2.20462262185, 1e-4, 'cents per pound to dollars per kg');
  assert.throws(() => bench.parseDaily('<html>new design</html>'), /not found/);
  assert.throws(() => bench.parseDaily(html.replace('90.85', '9085')), /plausible/);
  console.log('  Daily benchmark: cents/lb → $/kg with its own date; a changed page throws');
}

// 3. levels: daily first, else the month, else the month before
bench.setSnapshot({
  monthly: { fetched_at: new Date().toISOString(), cotton_usd_kg: { '2026-05': 2.03, '2026-09': 2.10, '2026-10': 2.00 }, brent_usd_bbl: { '2026-05': 107.5, '2026-09': 116.8, '2026-10': 125 }, error: null },
  daily: { fetched_at: new Date().toISOString(), readings: [{ date: new Date().toISOString().slice(0, 10), cotton_usd_kg: 2.0029, cents_per_lb: 90.85 }], error: null },
});
{
  assert.strictEqual(bench.levelAt('cotton_usd_kg', '2026-09-16').value, 2.10);
  assert.strictEqual(bench.levelAt('cotton_usd_kg', '2026-08-29').value, 2.03, 'a month with no figure takes the month before');
  assert.strictEqual(bench.levelNow('cotton_usd_kg').basis, 'daily');
  assert.strictEqual(bench.levelNow('brent_usd_bbl').value, 125);
  console.log('  Levels: daily reading, else the month, else the month before');
}

// 4. the nowcast is the mass balance, with the numbers checkable by hand
{
  const carded = C.SM_PRICE_MATRIX.carded_regular, combed = C.SM_PRICE_MATRIX.combed_regular;
  const a = nowcast(carded, '2026-09-16', bench), b = nowcast(combed, '2026-09-16', bench);
  near(a.delta, 1 / (1 - 0.07) * (2.0029 - 2.10), 1e-3, 'carded: 1.075 kg lint × Δ cotton');
  near(b.delta, 1 / (1 - 0.20) * (2.0029 - 2.10), 1e-3, 'combed: 1.25 kg lint × Δ cotton');
  assert(Math.abs(b.delta) > Math.abs(a.delta), 'combed yarn holds more lint, so it moves more');
  const cvc = nowcast(C.SM_PRICE_MATRIX.cvc_60_40, '2026-09-16', bench);
  const polyMove = 1.05 * 0.45 * (125 / 116.8 - 1);
  near(cvc.delta, 0.6 * (1 / 0.93) * (2.0029 - 2.10) + 0.4 * (1 / 0.97) * polyMove, 1e-3, 'CVC: cotton share + modelled polyester share');
  assert.strictEqual(cvc.parts.find((p) => p.fibre === 'polyester').tier, 'MODELLED');
  assert.strictEqual(nowcast(C.SM_PRICE_MATRIX.viscose_regular, '2026-09-16', bench), null, 'no free benchmark: not moved');
  assert.deepStrictEqual(fibreMix(C.SM_PRICE_MATRIX.supima_combed), [], 'ELS cotton is not the A-index cotton');
  assert.strictEqual(nowcast(carded, '2026-09-16', null), null);
  console.log(`  Nowcast = share × kg fibre per kg yarn × Δ fibre: carded ${a.delta}, combed ${b.delta}, CVC ${cvc.delta}`);
}

// 5. the costing chain: fresh quote as printed, older quote moved, past the limit the list (moved), no bench as before
{
  const quote = (age, on) => { const f = () => ({ price_usd_kg: 3.20, quoted_on: on, age_days: age, label: '30/s carded', source: 't', country: 'BD' }); f.bench = bench; return f; };
  const today = new Date().toISOString().slice(0, 10);
  const fresh = C.resolveYarnPrice('carded_regular', 30, quote(1, today), 'BD');
  assert.strictEqual(fresh.price, 3.20, 'a fresh quote is used exactly as printed');
  const old = C.resolveYarnPrice('carded_regular', 30, quote(57, '2026-09-16'), 'BD');
  assert.strictEqual(old.price_source.kind, 'market');
  assert.strictEqual(old.price_source.freshness, 'nowcast');
  near(old.price, 3.20 + old.price_source.nowcast.delta, 1e-4, 'moved by its own nowcast');
  assert.strictEqual(old.price_source.quoted_price, 3.20);
  const tooOld = C.resolveYarnPrice('carded_regular', 30, quote(200, '2026-04-01'), 'BD');
  assert.strictEqual(tooOld.price_source.kind, 'reference_list');
  near(tooOld.price, C.SM_PRICE_MATRIX.carded_regular[30] + tooOld.price_source.nowcast.delta, 1e-4, 'the list is moved from its own date');
  const plain = () => ({ price_usd_kg: 3.20, quoted_on: '2026-09-16', age_days: 57 });
  assert.strictEqual(C.resolveYarnPrice('carded_regular', 30, plain, 'BD').price, 3.20, 'without benchmarks, behaviour is unchanged');
  assert.strictEqual(C.resolveYarnPrice('carded_regular', 30, null, 'BD').price_source.freshness, 'reference');
  console.log(`  Chain: fresh as printed, 57-day quote ${old.price}, 200-day falls to the list moved to ${tooOld.price}`);
}

// 6. duty, VAT and buying charges: none on a bonded export basis, each line otherwise
{
  const b = C.landedYarnPrice(3.5, {});
  assert.strictEqual(b.basis, 'bonded_export'); assert.strictEqual(b.added_usd_kg, 0); assert.strictEqual(b.price_after, 3.5);
  assert(/bonded warehouse/.test(b.note), 'says why nothing was added');
  const d = C.landedYarnPrice(3.5, { basis: 'domestic', freight_pct: 2, duty_pct: 5, lc_bank_pct: 1, vat_pct: 10, vat_recoverable: false });
  const fr = 3.5 * 0.02, duty = (3.5 + fr) * 0.05, bank = 3.5 * 0.01, vat = (3.5 + fr + duty + bank) * 0.10;
  near(d.added_usd_kg, fr + duty + bank + vat, 1e-3, 'freight, duty on CIF, LC on quote, VAT on all');
  const rec = C.landedYarnPrice(3.5, { basis: 'bonded_export', vat_pct: 15 });
  assert.strictEqual(rec.added_usd_kg, 0, 'recoverable VAT is not a cost');
  const cost = C.calculateCost({ fabric: 'single_jersey', gsm: 180, count_ne: 30, yarn_landed: { basis: 'domestic', duty_pct: 5, vat_recoverable: false } });
  const base = C.calculateCost({ fabric: 'single_jersey', gsm: 180, count_ne: 30 });
  assert(cost.yarn.final_price_usd > base.yarn.final_price_usd && cost.yarn.landed.lines.find((l) => l.name === 'Import duty').usd_kg > 0);
  assert.strictEqual(base.yarn.landed.added_usd_kg, 0);
  console.log('  Landed cost: bonded export adds nothing and says so; domestic duty and VAT appear as lines');
}

// 7. every caller shares one feed, with the benchmarks attached
{
  const repo = require('../db/repositories/yarn-price-repo');
  const f = repo.feed();
  assert.strictEqual(typeof f, 'function'); assert.strictEqual(f.bench, bench);
  assert(/\|/.test(repo.stamp()), 'the cache key carries the benchmark date too');
  const fs = require('fs'), path = require('path');
  const api = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');
  assert(!/yarnPrices\.lookup\(key, ne, undefined/.test(api), 'no route builds its own price lambda any more');
  console.log('  One feed for every costing; the cache key moves with the benchmarks');
}

console.log('\nAll Yarn Nowcast Tests Passed!');
