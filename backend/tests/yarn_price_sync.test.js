const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  parse, translate, gate, toUsdKg, readPrice, readUnit, MAP, NOT_COSTED,
} = require('../jobs/yarn-price-sync');

console.log('--- Running Yarn Price Sync Tests ---');

// ============================================================================
// The published list is another company's web page, and this suite is the only
// thing standing between it and a quotation sent to a customer.
//
// Nothing here touches the network. A fixture captured from the real page on
// 2026-09-01 is checked in, so the parser is tested against real markup and
// the tests keep working when the publisher changes their site — at which
// point the FIXTURE stops matching the live page and the sync starts failing
// loudly, which is the correct outcome.
// ============================================================================

const FIXTURE = path.join(__dirname, 'fixtures', 'texbazar-2026-08-29.html');
const html = fs.readFileSync(FIXTURE, 'utf8');

// ── The page still parses ──────────────────────────────────────────────────
const published = parse(html);
assert(published.length >= 150,
  `only ${published.length} quotes read from the fixture; the parser has regressed`);
assert(published.every(r => r.count && r.price && r.unit && r.date),
  'every parsed quote must carry a count, a price, a unit and a date');

// An empty parse must THROW rather than return nothing. A sync that stores an
// empty list while reporting success freezes every price on the site.
assert.throws(() => parse('<html><body>nothing here</body></html>'),
  /no quotes could be read/,
  'a page with no quotes must fail loudly, not quietly store nothing');

// ── Two lists, not one ─────────────────────────────────────────────────────
// The page prints imported yarn against a letter of credit in USD/kg AND the
// domestic cash market in taka per pound. The first version of the sync merged
// them because a currency looked like just a currency; its own gate caught it,
// because prices stopped rising with count once two series were interleaved.
{
  const usdRow = translate({ count: '20/s PC', type: 'P-65% to C-35%', price: '$$ 2.75',
                             unit: 'KG', date: '2026-08-29' });
  const bdtRow = translate({ count: '20/s PC', type: 'P-65% to C-35%', price: '৳ 118.00',
                             unit: 'LBS/Pound', date: '2026-08-29' });
  assert.strictEqual(usdRow.row.market, 'lc_usd');
  assert.strictEqual(bdtRow.row.market, 'local_bdt');
  // Same product, same day, twenty-three per cent apart — and both correct.
  // That gap is the reason they cannot share an identity.
  const gap = (usdRow.row.price_usd_kg - bdtRow.row.price_usd_kg) / bdtRow.row.price_usd_kg;
  assert(gap > 0.15,
    `the LC and local prices for the same product should differ materially, got ${(gap * 100).toFixed(0)}%`);
}

// ── Currency and unit ──────────────────────────────────────────────────────
assert.deepStrictEqual(readPrice('$$ 3.60'), { amount: 3.6, currency: 'USD' });
assert.deepStrictEqual(readPrice('৳ 124.00'), { amount: 124, currency: 'BDT' });
assert.strictEqual(readPrice('3.60'), null,
  'a price with no currency mark must be refused, not assumed to be dollars');
assert.strictEqual(readUnit('KG'), 'KG');
assert.strictEqual(readUnit('LBS/Pound'), 'LB');
assert.strictEqual(readUnit('bale'), null);

// A price per POUND is a HIGHER price per kilogram — a pound is less yarn.
// Getting this backwards halves every taka-denominated quote and the number
// still looks entirely reasonable.
const perLb = toUsdKg(1, 'USD', 'LB').price_usd_kg;
const perKg = toUsdKg(1, 'USD', 'KG').price_usd_kg;
assert(perLb > perKg, 'a per-pound price must convert UP, not down');
assert(Math.abs(perLb - 2.2046) < 0.001, `expected 2.2046, got ${perLb}`);

// ৳124/lb at 122.5 to the dollar is about $2.23/kg. If this ever comes back as
// $124 or $0.45 the conversion has been dropped or inverted.
const taka = toUsdKg(124, 'BDT', 'LB');
assert(taka.price_usd_kg > 2.1 && taka.price_usd_kg < 2.4,
  `৳124/lb should be about $2.23/kg, got $${taka.price_usd_kg}`);
assert(taka.fx > 0, 'the rate used must come back with the converted figure, or it cannot be audited');

// ── Translation: an unmapped row is refused, never guessed ─────────────────
const known = translate({ count: '30/s Combed', type: '100% Cotton', price: '$$ 3.60',
                          unit: 'KG', date: '2026-08-29', percent: 0 });
assert(known.row && known.row.item_key === 'combed_regular' && known.row.count_ne === 30);

const unknown = translate({ count: '30/s Compact', type: '100% Cotton', price: '$$ 3.90',
                            unit: 'KG', date: '2026-08-29' });
assert(unknown.reject, 'an unmapped description must be refused — compact is not combed, and ' +
  'costing one as the other is a silent error worth cents a kilo');

// Products the engine has no row for are SKIPPED on purpose, not rejected, so
// they do not appear every week in the rejection report as though broken.
const filament = translate({ count: '75D/36F DTY', type: 'FDY', price: '$$ 1.23',
                             unit: 'KG', date: '2026-08-29' });
assert(filament.skip, 'filament is priced by denier and must be skipped deliberately');

// The band that catches a misplaced decimal — the one error that leaves a
// perfectly plausible-looking number behind.
const silly = translate({ count: '30/s Combed', type: '100% Cotton', price: '$$ 360',
                          unit: 'KG', date: '2026-08-29' });
assert(silly.reject && /not a yarn price/.test(silly.why),
  '$360/kg must be refused');

// ── The real fixture, end to end ───────────────────────────────────────────
const rows = [];
const rejected = [];
let skipped = 0;
for (const o of published) {
  const t = translate(o);
  if (t.skip) { skipped++; continue; }
  if (t.reject) { rejected.push(t); continue; }
  rows.push(t.row);
}
assert(rows.length >= 60, `only ${rows.length} costable rows translated from the real page`);
assert.deepStrictEqual(gate(rows), [],
  'the real published list must pass its own gate:\n  ' + gate(rows).join('\n  '));

// Every quote in the fixture is USD per kg or taka per pound, and the USD ones
// are the cotton, CVC, PC and viscose the engine actually costs.
const usd = rows.filter(r => r.currency === 'USD');
assert(usd.length >= 25, 'the LC list should carry the bulk of the costable rows');
assert(usd.every(r => r.market === 'lc_usd'),
  'every dollar-denominated row belongs to the LC list');
assert(rows.every(r => r.price_usd_kg > 0.5 && r.price_usd_kg < 25),
  'every converted price must be a yarn price');

// ── The gate catches what a clean parse cannot ─────────────────────────────
// Each of these is a feed that has been restructured underneath us while still
// parsing perfectly, which is the failure that would otherwise ship.
// Restricted to the LC list: a check that compares across the two lists is
// the bug, not the test.
const clone = () => JSON.parse(JSON.stringify(rows.filter(r => r.market === 'lc_usd')));

{ // finer yarn always costs more — more drafting, more ends down, more waste
  const bad = clone();
  const fine = bad.filter(r => r.item_key === 'carded_regular')
    .sort((a, b) => b.count_ne - a.count_ne)[0];
  fine.price_usd_kg = 0.6;
  assert(gate(bad).some(p => /finer yarn always costs more/.test(p)),
    'a price falling as the count rises must be caught');
}

{ // combing removes a fifth of the fibre and cannot come out cheaper
  const bad = clone();
  for (const r of bad) if (r.item_key === 'combed_regular') r.price_usd_kg = 1.0;
  assert(gate(bad).some(p => /combing removes a fifth/.test(p)),
    'combed cheaper than carded must be caught');
}

{ // a blend contains the cheaper fibre and cannot cost more than pure cotton
  const bad = clone();
  for (const r of bad) if (r.item_key === 'cvc_60_40') r.price_usd_kg = 20;
  assert(gate(bad).some(p => /the blend contains the cheaper fibre/.test(p)),
    'a blend dearer than cotton must be caught');
}

{ // a page that is not one day's list
  const bad = clone();
  bad[0].quoted_on = '2025-01-01';
  bad[1].quoted_on = '2024-06-01';
  assert(gate(bad).some(p => /not one day/.test(p)),
    'a page carrying several quote dates must be caught');
}

{ // a feed that has been cut down to a handful of rows
  assert(gate(rows.slice(0, 5)).some(p => /restructured/.test(p)),
    'a feed that suddenly carries a fraction of its rows must be caught');
}

// ── Two products may not share one key ─────────────────────────────────────
// This check found two real bugs in one afternoon, and both had passed every
// other check: BCI carded mapped onto plain carded, and combed slub mapped onto
// card slub. In each case the prices were individually plausible and each
// series rose properly with count — but the page prices them 10-35 cents apart,
// so they are separately traded products, and the loss happened silently at the
// INSERT where ON CONFLICT DO NOTHING keeps whichever row arrived first.
{
  const collided = [
    { market: 'lc_usd', item_key: 'carded_regular', count_ne: 40, quoted_on: '2026-08-29',
      raw_label: '40/s Card', price_usd_kg: 3.80 },
    { market: 'lc_usd', item_key: 'carded_regular', count_ne: 40, quoted_on: '2026-08-29',
      raw_label: '40/s Card (BCI)', price_usd_kg: 3.70 },
  ];
  assert(gate(collided).some(p => /both claim/.test(p)),
    'two published rows claiming one key must be caught before the insert');

  // And the real page must not do it. Every mapped key holds exactly one
  // product per count per list.
  const claimed = new Map();
  for (const r of rows) {
    const id = `${r.market}/${r.item_key}/${r.count_ne}`;
    assert(!claimed.has(id) || claimed.get(id) === r.raw_label,
      `${claimed.get(id)} and ${r.raw_label} both map to ${id}`);
    claimed.set(id, r.raw_label);
  }
}

// Nothing on the real page is refused any more: what is left over is skipped
// on purpose, by name, because the engine has no row for it.
assert.strictEqual(rejected.length, 0,
  `the published list should map cleanly: ${rejected.map(r => r.label + ' (' + r.why + ')').join(', ')}`);

// ── The engine reads it, and says which price it used ──────────────────────
const { calculateCost } = require('../engine/domain/costing-engine');

// With no feed the answer is unchanged from before this existed, and says so.
const listed = calculateCost({ gsm: 180, composition: '100% Cotton', count_ne: 30,
                               order_qty_kg: 1000 });
assert.strictEqual(listed.yarn.price_source.kind, 'reference_list');
assert(/no market feed/.test(listed.yarn.price_source.why),
  '"no feed connected" and "no quote for this item" must not read the same');

// With a feed, the quote wins and the drift against the typed list is stated.
const quote = { price_usd_kg: 3.25, quoted_on: '2026-08-29', age_days: 3,
                as_published: '$3.25 per KG', label: '30/s Card', source: 'texbazar' };
const live = calculateCost({ gsm: 180, composition: '100% Cotton', count_ne: 30,
                             order_qty_kg: 1000,
                             live_prices: (k, ne) => (k === 'carded_regular' && ne === 30 ? quote : null) });
assert.strictEqual(live.yarn.base_price_usd, 3.25);
assert.strictEqual(live.yarn.price_source.kind, 'market');
assert.strictEqual(live.yarn.price_source.last_updated, '2026-08-29');
assert(live.yarn.price_source.reference_gap_pct < 0,
  'the reference list was high, and by how much must be stated rather than implied');

// A quote from last year is not used. Sixty days is the line, and past it the
// typed list — which at least knows what it is — answers instead.
const ancient = { ...quote, quoted_on: '2025-08-29', age_days: 368 };
const old = calculateCost({ gsm: 180, composition: '100% Cotton', count_ne: 30,
                            order_qty_kg: 1000,
                            live_prices: () => ancient });
assert.strictEqual(old.yarn.price_source.kind, 'reference_list');
assert(/past the 60-day limit/.test(old.yarn.price_source.why));

// A quote inside the limit but well past a week is USED and WARNED about — a
// real price from six weeks ago beats a typed one from four months ago, but
// the reader has to be told which they are looking at.
const sixWeeks = calculateCost({ gsm: 180, composition: '100% Cotton', count_ne: 30,
                                 order_qty_kg: 1000,
                                 live_prices: () => ({ ...quote, quoted_on: '2026-07-20', age_days: 43 }) });
assert.strictEqual(sixWeeks.yarn.price_source.kind, 'market');
assert.strictEqual(sixWeeks.yarn.price_source.freshness, 'stale');
assert(sixWeeks.warnings.some(w => /published on 2026-07-20/.test(w)),
  'a stale market price must be used AND flagged, not used silently');

// A lookup that throws must never be able to fail a costing.
const brokenLookup = calculateCost({ gsm: 180, composition: '100% Cotton', count_ne: 30,
                                     order_qty_kg: 1000,
                                     live_prices: () => { throw new Error('database gone'); } });
assert.strictEqual(brokenLookup.yarn.price_source.kind, 'reference_list',
  'a broken price lookup must fall back, not throw');

console.log(`  ${published.length} quotes parsed, ${rows.length} costable, ` +
            `${skipped} not costed, ${rejected.length} refused`);
console.log('\n✓ All yarn price sync tests passed.');
