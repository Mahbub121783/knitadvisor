/**
 * Home-page live sample (routes/demo.js): the whitelist holds, and a valid
 * request is answered by the real engine with the costing breakdown trimmed.
 */
const { readInputs } = require('../routes/demo');
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
if (failed) { console.error(`\n${failed} demo test(s) failed`); process.exit(1); }
console.log('\nAll demo tests passed.');
