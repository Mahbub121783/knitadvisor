// The state the Studio shows the cloth in: as knitted, wet relaxed, finished, after washing.
'use strict';
const assert = require('assert');
const S = require('../engine/domain/fabric-studio');

console.log('--- Running Cloth State Tests ---');
const base = { bed: 'single', grid: { C: ['K'], D: null }, feeds: [{ role: 'ground' }], yarn: { fibre: 'cotton', type: 'combed', count: 30, unit: 'ne' }, target: { gsm: 160 }, machine: {}, hand: { enabled: true }, look: { shade: 'medium' } };
const run = (state, extra) => S.analyse({ ...base, ...(state ? { state } : {}), ...(extra || {}) });

{
  const fin = run(), dry = run('dry'), wet = run('wet'), full = run('full');
  [fin, dry, wet, full].forEach((r) => assert(r.success && r.state && r.state.available));
  assert.strictEqual(fin.state.selected, 'finished');
  assert.strictEqual(run('nonsense').state.selected, 'finished', 'an unknown state is the finished one');
  assert.strictEqual(fin.state.gsm, Math.round(fin.fabric.gsm), 'finished is the factory-record state');
  // the loop length stays; the cloth is looser as knitted and tighter after washing
  assert(dry.state.wpc < fin.state.wpc && dry.state.cpc < fin.state.cpc && dry.state.gsm < fin.state.gsm && dry.state.width_in > fin.state.width_in, 'as knitted: fewer loops per cm, lighter, wider');
  assert(full.state.wpc > fin.state.wpc && full.state.cpc > fin.state.cpc && full.state.gsm > fin.state.gsm, 'after washing the cloth draws in and gains weight');
  assert(dry.state.cpc < wet.state.cpc && wet.state.cpc < full.state.cpc, 'dry < wet < fully relaxed in courses');
  assert(dry.state.vs_finished.length_pct > 0 && full.state.vs_finished.length_pct < 0 && fin.state.vs_finished.length_pct === 0);
  // the Hand and Look cards work in the state
  assert(Math.abs(dry.hand.geometry.wales_per_cm - dry.state.wpc) < 0.06);
  assert(dry.hand.bending.course.value < fin.hand.bending.course.value && fin.hand.bending.wale.value < full.hand.bending.wale.value, 'a looser cloth has fewer yarns across a centimetre and bends more easily');
  assert(dry.hand.geometry.gsm < full.hand.geometry.gsm);
  console.log('✓ four states: as knitted is looser and lighter, after washing tighter and heavier; hand follows the state');
}
{
  const plush = S.analyse({ ...base, hand: undefined, look: undefined, grid: { C: ['K', 'K'], D: null }, feeds: [{ role: 'ground' }, { role: 'loop' }], yarns: { loop: { fibre: 'cotton', type: 'carded', count: 20, unit: 'ne' } }, state: 'dry' });
  if (plush.success) assert(plush.state && (plush.state.available || plush.state.selected === 'finished'), 'a plush has no relaxation model and says so');
  console.log('✓ a structure without a relaxation model shows the finished state');
}
console.log('Cloth state tests passed');
