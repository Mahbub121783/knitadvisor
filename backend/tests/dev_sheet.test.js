// Development sheet: the R&D inputs in, the whole development roll out (dev-sheet.js).
'use strict';
const assert = require('assert');
const S = require('../engine/domain/fabric-studio');
const DS = require('../engine/domain/dev-sheet');

console.log('--- Running Development Sheet Tests ---');
const T = S.listTemplates();
const design = (id) => { const t = T.find((x) => x.id === id); return { bed: t.bed, gating: t.gating, grid: t.grid, feeds: t.roles.map((r) => ({ role: r })) }; };
const sheet = (id, extra) => DS.build({ design: design(id), composition: '95% CO 5% EL', gsm: 200, shade: 'dark', brush: 'face', dia: 30, ...(extra || {}) }, S.analyse);

{
  const s = sheet('lacoste_single');
  assert(s.success && s.fabric.title && s.fabric.matches === 'Single Lacoste');
  assert(s.yarn.elastane && /feeder/.test(s.yarn.elastane.feeding) && s.yarn.elastane.draft >= 2 && s.yarn.elastane.draft <= 4.2);
  assert(s.yarn.composition_solved.achieved.elastane === 5);
  assert(s.machine.gauge > 0 && s.machine.dia === 30 && s.machine.stitch_length_mm > 0 && s.machine.kg_per_hour > 0 && s.machine.cam_chart.length === 4);
  assert(s.machine.vdq.groups.length >= 1 && s.machine.vdq.pulley_reading === null);
  assert(s.greige.gsm > 0 && s.greige.width_in > 0);
  assert(s.dyeing.shade === 'dark' && s.dyeing.route.length >= 5 && s.dyeing.dyes.length >= 1 && s.dyeing.route.some((r) => r.chemicals.length));
  assert(s.finishing.stenter.set_width_in > 0 && s.finishing.brushing && /peach/.test(s.finishing.brushing.side) && s.finishing.heat_set.temp_c > 0);
  assert(s.finished.gsm > 0 && s.finished.width_in > 0 && s.first_roll.length === 3);
  assert(/trial roll|Knit one roll/.test(s.accuracy.rule) && !/exact\b(?!ly)/.test(s.accuracy.weight), 'no claim of exactness');
  console.log('✓ the whole sheet: yarn with half/full feeder elastane, machine set-up, VDQ course length, greige, dyeing route with amounts, finishing, finished cloth, first-roll instructions');
}
{
  // a record-backed structure uses the family answer; the weight is the target
  const j = sheet('single_jersey');
  assert.strictEqual(j.weight_basis.path, 'family records');
  assert(Math.abs(j.finished.gsm / 200 - 1) < 0.02 && j.weight_basis.band_pct === 5);
  // a structure the records do not cover: the laws weigh the target, and are trusted only where they give a cloth the factory could knit;
  // where the two engines part, the family table is kept and the band is the gap between them
  const b = sheet('bourrelet');
  assert(/laws|DISAGREE/.test(b.weight_basis.path) && b.weight_basis.laws && b.weight_basis.band_pct >= 14, b.weight_basis.path);
  assert(Math.abs(b.finished.gsm / 200 - 1) < 0.02, 'the headline weight is the target: ' + b.finished.gsm);
  if (/DISAGREE/.test(b.weight_basis.path)) assert(b.weight_basis.band_pct >= Math.round(Math.abs(b.weight_basis.laws.difference_pct)) && /tightness factor/.test(b.weight_basis.why));
  // the Lacoste with elastane: the laws' stitch length would be far too loose; it is not used
  const l = sheet('lacoste_single');
  assert(/DISAGREE/.test(l.weight_basis.path) && l.machine.stitch_length_mm < 3.5, l.weight_basis.path + ' ' + l.machine.stitch_length_mm);
  const a = sheet('accordion_tuck');
  assert(a.weight_basis.band_pct >= 14, 'no law covers the stitches: a wide band');
  console.log('✓ weight: family records where they exist (±5 %), the stitch-graph laws where they do not (±14 %, the laws\' own weight), a wider band where no law covers the stitches');
}
{
  // shades, brushing words, bad input in words
  assert.strictEqual(sheet('single_jersey', { shade: 'navy' }).dyeing.shade, 'dark');
  assert.strictEqual(sheet('single_jersey', { brush: 'peach' }).finishing.brushing.side, 'face (peach)');
  assert.strictEqual(sheet('single_jersey', { brush: 'none' }).finishing.brushing, null);
  assert.throws(() => DS.build({ design: design('single_jersey'), composition: '100% CO', gsm: 20, shade: 'dark', brush: 'none' }, S.analyse), /GSM/);
  assert.throws(() => DS.build({ design: design('single_jersey'), composition: '100% CO', gsm: 180, shade: 'purple', brush: 'none' }, S.analyse), /Colour depth/);
  assert.throws(() => DS.build({ composition: '100% CO', gsm: 180, shade: 'dark', brush: 'none' }, S.analyse), /needle design/);
  assert.throws(() => DS.build({ design: design('single_jersey'), gsm: 180, shade: 'dark', brush: 'none' }, S.analyse), /composition/i);
  assert.throws(() => DS.build({ design: design('single_jersey'), composition: '95% CO 5% XYZ', gsm: 180, shade: 'dark', brush: 'none' }, S.analyse), /XYZ/);
  console.log('✓ navy is dark, peach is face brushing; a missing design, composition or a wrong weight, colour or fibre name is refused in words');
}
console.log('Development sheet tests passed');
