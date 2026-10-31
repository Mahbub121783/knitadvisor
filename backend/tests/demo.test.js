/**
 * Home-page live sample (routes/demo.js): the whitelist holds, and a valid
 * request is answered by the real engine with the costing breakdown trimmed.
 */
const { readInputs, trim } = require('../routes/demo');
const { calculate } = require('../engine/index');

let failed = 0;
const ok = (c, m) => { if (c) console.log(`[PASS] ${m}`); else { console.error(`[FAIL] ${m}`); failed++; } };

ok(readInputs({ fabric: 'single_jersey', gsm: 180 }).p, 'valid minimal input accepted');
ok(readInputs({ fabric: 'tricot_plain', gsm: 180 }).error, 'construction outside the sample refused');
ok(readInputs({ fabric: 'single_jersey', gsm: 900 }).error, 'GSM out of range refused');
ok(readInputs({ fabric: 'single_jersey', gsm: 180, composition: '50% Silk' }).error, 'composition outside the list refused');
ok(readInputs({ fabric: 'single_jersey', gsm: 180, color_input: '<script>' }).error, 'arbitrary shade text refused');
ok(readInputs({ fabric: 'single_jersey', gsm: 180, dyeing_method: 'x' }).error, 'unknown dyeing method refused');
ok(readInputs({ fabric: 'single_jersey', gsm: 180, gauge: 99 }).error, 'gauge out of range refused');
const full = readInputs({ fabric: 'pique_single', gsm: 220, composition: '60% Cotton 40% Polyester', color_input: '19-4052',
  finishing_route: 'compacted', dyeing_method: 'reactive', surface_finish: 'enzyme_wash', gauge: 24 });
ok(full.p && Object.keys(full.p).length === 9, 'every whitelisted field passes through');
// unknown fields are dropped, not forwarded
ok(!('garment_weight_g' in readInputs({ fabric: 'single_jersey', gsm: 180, garment_weight_g: 200 }).p), 'fields outside the whitelist are dropped');
// every listed fabric actually calculates
for (const f of ['single_jersey', 'rib_1x1', 'rib_2x2', 'interlock', 'lacoste_single', 'pique_single', 'french_terry', 'fleece_3_thread']) {
  const r = calculate({ fabric: f, gsm: 220, efficiency: 85 });
  ok(r && r.success !== false && r.yarn && r.yarn.count_ne > 0, `${f} calculates (${r.yarn && r.yarn.count_ne}/1)`);
}
// the public answer carries nothing from the locked set
{
  const full = calculate({ fabric: 'pique_single', gsm: 240, color_input: '19-4052', efficiency: 85 });
  const t = trim(full);
  const text = JSON.stringify(t);
  ok(t.costing === undefined && t.process_loss === undefined && t.garment_costing === undefined, 'no costing or process loss in the public answer');
  ok(t.warnings === undefined && t.formula_trace === undefined && t.critical_path === undefined, 'no warnings, trace or critical path');
  ok(!/grey_gsm|grey_gsm_target|total_per_kg/.test(text), 'no grey weights or price figures anywhere in the payload');
  ok(Array.isArray(t.locked) && ['grey', 'loss', 'price'].every(k => t.locked.includes(k)), 'locked list tells the page what is held back');
  ok(t.carbon && t.carbon.total > 0 && !/per_garment|total_co2e_per_m2|warnings|source_note/.test(JSON.stringify(t.carbon)), 'carbon headline is public, its detail is not');
  ok(t.yarn && t.loop_length && t.machine && t.physical_constraints && t.quality_prediction.shrinkage && t.pique, 'the figures the lab shows are still there');
}
if (failed) { console.error(`\n${failed} demo test(s) failed`); process.exit(1); }
console.log('\nAll demo tests passed.');
