// Knitting plan: width and stitch length calibrated on the factory records,
// structure notation checked rule by rule.
const assert = require('assert');
const { calculate } = require('../engine');
const { FABRIC_DERIVATIVES: F } = require('../engine/catalog/fabric-derivatives');
const { FACTORY_RECORDS } = require('../engine/catalog/factory-dataset');
const { CAL } = require('../engine/domain/knit-plan');
console.log('--- Running Knit Plan Tests ---');
const run = (fabric, gsm, comp = '100% Cotton', x = {}) => calculate({ fabric, gsm, composition: comp, efficiency: 85, ...x }).knit_plan;

// 1. width model reproduces the factory's own finished widths
for (const fab of ['single_jersey', 'pique', 'fleece', 'interlock']) {
  const e = [];
  for (const r of FACTORY_RECORDS) {
    if (r.fab !== fab || !(r.g > 0 && r.dia > 0 && r.sl > 0 && r.fdia > 0)) continue;
    const c = CAL.kw[`${fab}|${/lycra/.test(r.spin) ? 'L' : 'P'}`]; if (!c) continue;
    e.push(Math.abs(Math.PI * r.dia * r.g * (r.sl / 10) / (c.med * 2.54) / r.fdia - 1) * 100);
  }
  e.sort((a, b) => a - b);
  assert(e[e.length >> 1] < 6, `${fab} width median error ${e[e.length >> 1]}%`);
}
// 2. a plain 160 GSM jersey: sensible machine, SL and width
{
  const k = run('single_jersey', 160);
  assert.strictEqual(k.machine.gauge, 24);
  assert(k.stitch_length.used_mm > 2.5 && k.stitch_length.used_mm < 2.9);
  assert(k.fabric.finished_width_in > 55 && k.fabric.finished_width_in < 70, `width ${k.fabric.finished_width_in}`);
  assert(Math.abs(k.stitch_length.agreement_pct) < 10, 'record and GSM model agree');
}
// 3. a coarser dia gives a proportionally wider cloth
{
  const a = run('single_jersey', 160, '100% Cotton', { dia: 30, gauge: 24 }), b = run('single_jersey', 160, '100% Cotton', { dia: 34, gauge: 24 });
  assert(Math.abs(b.fabric.finished_width_in / a.fabric.finished_width_in - 34 / 30) < 0.02);
}
// 4. 2x2 rib is 2-in-1-out on each bed and narrower than 1x1
{
  const r = run('rib_2x2', 260, '95% Cotton 5% Elastane'), r1 = run('rib_1x1', 260, '95% Cotton 5% Elastane');
  assert.deepStrictEqual(r.structure.setout, { C: 'A A -', D: '- A A' });
  assert(r.fabric.finished_width_in < r1.fabric.finished_width_in * 0.8);
}
// 5. piqué takes less yarn per revolution than a jersey (tucks hold less)
assert(run('pique_single', 220).production.structure_share < 1);
// 6. a feeder count that is not a whole number of repeats is flagged
assert(run('pique_single', 220, '100% Cotton', { dia: 30, gauge: 24, feeders: 98, rpm: 25 }).notes.some(n => /whole number/.test(n)));
// 7. every catalogue structure casts off on every feed; none has a ragged grid
{
  const bad = [];
  for (const f of F) {
    if (f.category === 'warp_knit' || !f.structure || !f.structure.pattern) continue;
    const r = calculate({ fabric: f.id, gsm: f.gsm_range ? f.gsm_range.min + 40 : 200, composition: '100% Cotton', efficiency: 85 });
    if (!r.knit_plan || !r.knit_plan.structure) continue;
    r.knit_plan.structure.checks.filter(c => c.level === 'error').forEach(c => bad.push(f.id + ': ' + c.text));
  }
  assert.deepStrictEqual(bad, []);
}
// 8. the invented 12-feed popcorn and 6-fold-tuck knop are gone
assert(run('knop_honeycomb', 270).structure.checks.every(c => !/tucks [5-9] times/.test(c.text)));
console.log('All knit plan tests passed.');
