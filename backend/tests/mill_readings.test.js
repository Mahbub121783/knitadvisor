// Mill readings: the tester's numbers replace the estimates they measure (mill-readings.js).
'use strict';
const assert = require('assert');
const S = require('../engine/domain/fabric-studio');
const RD = require('../engine/domain/mill-readings');

console.log('--- Running Mill Readings Tests ---');
const t = S.listTemplates().find((x) => x.id === 'single_jersey');
const base = () => ({ bed: t.bed, gating: t.gating, grid: t.grid, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', count: 30, unit: 'ne' }, target: { gsm: 180 }, machine: {}, hand: { enabled: true }, lab: { enabled: true } });

{
  const a = S.analyse(base());
  assert.strictEqual(a.readings, null, 'no readings, no report');
  assert.strictEqual(a.hand.compression.T0.basis, 'estimate');
  const b = S.analyse({ ...base(), readings: { thickness_mm: 0.7, air_perm_mm_s: 480, rct: 0.02 } });
  assert(b.success, b.error);
  assert.strictEqual(b.hand.compression.T0.value, 0.7);
  assert.strictEqual(b.hand.compression.T0.basis, 'measured');
  assert(b.hand.compression.T0.model_value > 0, 'the model\'s own thickness is kept');
  assert(b.feasibility.packing.thickness_mm === 0.7 && /measured/.test(b.feasibility.packing.thickness_basis));
  assert(b.feasibility.packing.phi < a.feasibility.packing.phi, 'a thicker measured cloth is less packed');
  assert.strictEqual(b.lab.air.air_permeability.value, 480);
  assert.strictEqual(b.lab.air.air_permeability.basis, 'measured');
  assert.strictEqual(b.lab.thermal.rct.value, 0.02);
  assert.strictEqual(b.lab.thermal.clo.basis, 'measured');
  assert(Math.abs(b.lab.thermal.clo.value - 0.02 / 0.155) < 0.002);
  assert.strictEqual(b.readings.applied.length, 3);
  assert(b.readings.applied.every((x) => x.basis === 'measured at your mill' && x.model != null && x.error_pct != null));
  assert.strictEqual(b.fabric.gsm, a.fabric.gsm, 'the weight has its own route (trial rolls) and is not moved');
  console.log('✓ thickness, air permeability and Rct replace the estimates, are tagged measured, keep the model beside them and report the gap');
}
{
  // empty fields are not readings; bad ones are refused in words
  const r = S.analyse({ ...base(), readings: { thickness_mm: '', air_perm_mm_s: null } });
  assert(r.success && r.readings === null);
  assert(/outside 0\.1–8 mm/.test(S.analyse({ ...base(), readings: { thickness_mm: 50 } }).error));
  assert(/not a reading/.test(S.analyse({ ...base(), readings: { colour: 1 } }).error));
  console.log('✓ empty fields are ignored; an out-of-range or unknown reading is refused with the reason');
}
{
  // the drape reading sits beside the model's coefficient
  const d = RD.drapeCheck({ drape_coefficient: { value: 52.4, unit: '%', basis: 'estimate' } }, { drape_dc_pct: 47 });
  assert.strictEqual(d.drape_coefficient.value, 47);
  assert.strictEqual(d.drape_coefficient.basis, 'measured');
  assert.strictEqual(d.drape_coefficient.model_value, 52.4);
  assert.strictEqual(d.reading.error_pct, 11.5);
  const same = { drape_coefficient: { value: 52.4 } };
  assert.strictEqual(RD.drapeCheck(same, {}), same);
  console.log('✓ the Cusick reading replaces the drape coefficient and keeps the model\'s figure');
}
console.log('Mill readings tests passed');
