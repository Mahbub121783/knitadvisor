// Charge book: the factory sheet, the resolver, vendors, search and the costing it feeds.
const assert = require('assert');
const book = require('../engine/domain/charge-book');
const { calculate } = require('../engine');
console.log('--- Running Charge Book Tests ---');

// 1. the whole sheet is there
{
  const items = book.listItems();
  assert(items.length >= 340, `${items.length} rows`);
  assert(new Set(items.map((i) => i.group_name)).size >= 80);
  const r = (key) => book.vendorRate('own', key).rate;
  assert.strictEqual(r('single_jersey').knit_above30, 0.23);
  assert.strictEqual(r('single_jersey').dye1_black, 1.75);
  assert.strictEqual(r('rib_2_x_2|elastane_full_feeder').knit_below30, 0.45);
  assert.strictEqual(r('rib_2_x_2|elastane_full_feeder').dye2_dark_navy, 2.2);
  assert.strictEqual(r('interlock|engineering_stripe').knit_above30, 3.05);
  assert.strictEqual(r('pique').dye1_neon, null, 'a 0.00 on the sheet is "not offered", never zero');
  assert.strictEqual(r('french_terry_loop_back_three_thread_inside_brush').dye1_light_medium, 1.65);
}
// 2. the resolver picks the right row
{
  const k = (o) => book.resolveItem({ fabricId: 'rib_2x2', fibers: { cotton: 100 }, ...o }).item.label;
  assert.strictEqual(k({}), 'RIB 2 x 2');
  assert.strictEqual(k({ fibers: { cotton: 95, elastane: 5 } }), 'RIB 2 x 2 — Elastane Half Feeder');
  assert.strictEqual(k({ fibers: { cotton: 95, elastane: 5 }, feederType: 'ff' }), 'RIB 2 x 2 — Elastane Full Feeder');
  assert.strictEqual(k({ yarnForm: 'slub' }), 'RIB 2 x 2 Slub');
  assert.strictEqual(k({ fibers: { viscose: 50, cotton: 50 } }), 'RIB 2 x 2 Viscose');
  assert.strictEqual(k({ stripeType: 'engineering' }), 'RIB 2 x 2 — Engineering Stripe');
  assert.strictEqual(k({ itemKey: 'interlock|feeder_stripe' }), 'Interlock — Feeder Stripe');
  assert.strictEqual(book.resolveItem({ fabricId: 'fleece_3_thread', brushed: true, fibers: { cotton: 100 } }).item.group_name, 'French Terry Loop Back Three Thread inside Brush');
  const u = book.resolveItem({ fabricId: 'some_new_structure', category: 'rib', fibers: { cotton: 100 }, _quiet: true });
  assert(u.approximate && u.item.group_name === 'RIB 1 x 1', 'an unknown fabric lands on its family and says so');
}
// 3. count tier and shade tier
{
  const q = (o) => book.quote({ fabricId: 'single_jersey', fibers: { cotton: 100 }, countNe: 30, shade: 'black', ...o });
  assert.strictEqual(q({ countNe: 30 }).knit.usd, 0.18, '30s is "30s and below"');
  assert.strictEqual(q({ countNe: 32 }).knit.usd, 0.23, '32s is "above 30s"');
  assert.strictEqual(q({ shade: 'melange' }).dye.usd, 0.8);
  assert.strictEqual(q({ shade: 'fluorescent' }).dye.usd, 2.6);
  assert.strictEqual(q({ twoPart: true, shade: 'dark_navy' }).dye.usd, 2.0);
  assert.strictEqual(book.quote({ fabricId: 'pique_single', fibers: { cotton: 100 }, countNe: 24, shade: 'fluorescent' }).dye, null, 'a tier the sheet does not offer is null, so the engine falls back and says so');
}
// 4. vendors: own prices, derived prices, cheapest
{
  const snap = book._snap();
  snap.vendors.set('abc', { code: 'abc', name: 'ABC Dyeing', kind: 'dyehouse', active: true, is_default: false, derived_from: 'own', adjust_pct: -10 });
  snap.vendors.set('xyz', { code: 'xyz', name: 'XYZ', kind: 'vendor', active: true, is_default: false, derived_from: null, adjust_pct: 0 });
  snap.rates.set('xyz', new Map([['single_jersey', { ...snap.rates.get('own').get('single_jersey'), dye1_black: 1.5 }]]));
  const q = (v) => book.quote({ fabricId: 'single_jersey', fibers: { cotton: 100 }, countNe: 28, shade: 'black', vendor: v });
  assert.strictEqual(q('abc').dye.usd, 1.575, 'derived: sheet minus 10%');
  assert.strictEqual(q('xyz').dye.usd, 1.5);
  assert.strictEqual(q('cheapest').vendor.code, 'xyz');
  assert.strictEqual(q('nope').vendor.code, 'own', 'an unknown vendor falls back to the default, with a note');
  assert.strictEqual(q().alternatives.length, 3);
  // through the whole costing
  const c = (v) => calculate({ fabric: 'single_jersey', gsm: 160, composition: '100% Cotton', color_shade: 'black', efficiency: 85, charge_vendor: v }).costing;
  assert(c('abc').dyeing_per_kg_usd < c('own').dyeing_per_kg_usd && c('abc').total_per_kg_usd < c('own').total_per_kg_usd);
  assert.strictEqual(c('abc').charges.vendor.code, 'abc');
  assert(c('own').charges.alternatives.length >= 3, 'every vendor price comes back beside the one used');
  snap.vendors.delete('abc'); snap.vendors.delete('xyz'); snap.rates.delete('xyz');
}
// 5. the costing is built on the sheet
{
  const c = calculate({ fabric: 'rib_2x2', gsm: 260, composition: '95% Cotton 5% Elastane', color_shade: 'dark_navy', efficiency: 85, feeder_type: 'ff' }).costing;
  assert.strictEqual(c.knitting_per_kg_usd, 0.45);
  assert.strictEqual(c.dyeing_per_kg_usd, 1.75);
  assert.strictEqual(c.dyeing_detail.source, 'charge_sheet');
  assert.strictEqual(c.charges.item.label, 'RIB 2 x 2 — Elastane Full Feeder');
  // a one-off knitting charge still wins
  const { calculateCost } = require('../engine/domain/costing-engine');
  assert.strictEqual(calculateCost({ fabric: 'single_jersey', gsm: 160, count_ne: 30, knitting_cost: 0.5 }).cost_breakdown_usd.knitting.per_kg, 0.5);
  // a stripe is yarn-dyed: only the wash
  const s = calculate({ fabric: 'rib_1x1', gsm: 200, composition: '95% Cotton 5% Elastane', color_shade: 'light_medium', efficiency: 85, stripe_type: 'feeder' }).costing;
  assert.strictEqual(s.dyeing_per_kg_usd, 0.5);
}
// 6. search by words and by count
{
  const s = book.search({ q: 'rib 2x2 lycra', count: 30, shade: 'black' });
  assert(s.rows.length >= 2 && s.rows.every((r) => /RIB 2 x 2/.test(r.label) && /Elastane/.test(r.label)), s.rows.map((r) => r.label).join('|'));
  const row = s.rows.find((r) => r.variant === 'Elastane Full Feeder' && r.group === 'RIB 2 x 2');
  assert.strictEqual(row.prices[0].at_count.knit, 0.45);
  assert(book.search({ q: 'double lacoste slub' }).rows[0].label.startsWith('Double Lacoste SLUB'));
  assert.strictEqual(book.search({ q: 'zzzz' }).total, 0);
}
// 7. every calculator fabric lands on a row; a plain jersey is exact
{
  const { FABRIC_DERIVATIVES } = require('../engine/catalog/fabric-derivatives');
  const cov = book.coverage(FABRIC_DERIVATIVES.filter((f) => f.category !== 'warp_knit'));
  assert(cov.every((c) => c.group), 'no fabric is left without a price');
  assert(!cov.find((c) => c.fabric_id === 'single_jersey').approximate);
}
// 8. gaps are reported, once per thing
{
  const got = []; book.setGapSink((g) => got.push(g));
  book.quote({ fabricId: 'brand_new_knit_xyz', category: 'interlock', fibers: { cotton: 100 }, countNe: 30, shade: 'black' });
  book.quote({ fabricId: 'brand_new_knit_xyz', category: 'interlock', fibers: { cotton: 100 }, countNe: 30, shade: 'black' });
  assert.strictEqual(got.filter((g) => g.kind === 'no_group').length, 1);
  book.setGapSink(null);
}
// 9. no sources on the API
assert(!/knitdyecharge|\.pdf|http/i.test(JSON.stringify(book.quote({ fabricId: 'single_jersey', fibers: { cotton: 100 }, countNe: 30, shade: 'black' }))));
console.log('All charge book tests passed.');
