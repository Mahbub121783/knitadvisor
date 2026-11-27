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
  assert(s.machine.vdq.groups.length >= 1 && s.machine.vdq.groups.every((g) => g.pulley_reading === null));
  assert(s.greige.gsm > 0 && s.greige.width_in > 0);
  assert(s.dyeing.shade === 'dark' && s.dyeing.route.length >= 5 && s.dyeing.dyes.length >= 1 && s.dyeing.route.some((r) => r.chemicals.length));
  assert(s.finishing.stenter.set_width_in > 0 && s.finishing.brushing && /peach/.test(s.finishing.brushing.side) && s.finishing.heat_set.temp_c > 0);
  assert(s.finished.gsm > 0 && s.finished.width_in > 0 && s.first_roll.length === 3);
  assert(/trial roll|Knit one roll/.test(s.accuracy.rule) && !/exact\b(?!ly)/.test(s.accuracy.weight), 'no claim of exactness');
  console.log('✓ the whole sheet: yarn with half/full feeder elastane, machine set-up, VDQ course length, greige, dyeing route with amounts, finishing, finished cloth, first-roll instructions');
}
{
  // a jersey: designed by the loop model where its (private) constants are present, by the family records otherwise; either way the sheet
  // carries the Studio's own stitch length, not a second solution of it
  const modelled = require('../engine/domain/universal-model').model().ok;
  const j = sheet('single_jersey');
  assert.strictEqual(j.weight_basis.path, modelled ? 'loop model' : 'family records');
  const studio = S.analyse({ ...design('single_jersey'), target: { gsm: 200, composition: '95% CO 5% EL' }, machine: { dia: 30 }, finish: { brush: 'face' } });
  assert(!!(studio.recipe && studio.recipe.model) === modelled && Math.abs(j.machine.stitch_length_mm - studio.fabric.sl_mm) < 0.02, j.machine.stitch_length_mm + ' ' + studio.fabric.sl_mm);
  assert(Math.abs(j.finished.gsm / 200 - 1) < 0.02 && j.weight_basis.band_pct >= 5 && j.weight_basis.band_pct <= 25);
  // a structure the records do not cover: the laws weigh the target, and are trusted only where they give a cloth the factory could knit;
  // where the two engines part, the family table is kept and the band is the gap between them
  const b = sheet('bourrelet');
  assert(/laws|DISAGREE/.test(b.weight_basis.path) && b.weight_basis.laws && b.weight_basis.band_pct >= 14, b.weight_basis.path);
  assert(Math.abs(b.finished.gsm / 200 - 1) < 0.02, 'the headline weight is the target: ' + b.finished.gsm);
  if (/DISAGREE/.test(b.weight_basis.path)) assert(b.weight_basis.band_pct >= Math.round(Math.abs(b.weight_basis.laws.difference_pct)) && /tightness factor/.test(b.weight_basis.why));
  // the Lacoste with elastane plated on every feeder is knitted often: the loop model or the records answer, not the laws, whose stitch length
  // would be far too loose (knitted settings at 200 GSM run from about 2.5 to 3.1 mm)
  const l = sheet('lacoste_single');
  assert(['loop model', 'family records'].includes(l.weight_basis.path) && l.machine.stitch_length_mm >= 2.45 && l.machine.stitch_length_mm <= 3.15, l.weight_basis.path + ' ' + l.machine.stitch_length_mm);
  const a = sheet('accordion_tuck');
  assert(a.weight_basis.band_pct >= 14, 'no law covers the stitches: a wide band');
  console.log('✓ weight: the loop model or the family records (±5 %), the stitch-graph laws where they do not (±14 %, the laws\' own weight), a wider band where no law covers the stitches');
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
{
  // the VDQ pulley: one or two of the machine's own reference settings turn course length into readings
  const v1 = sheet('single_jersey', { vdq_points: [{ reading: 40, course_length_m: 5 }] });
  assert(v1.machine.vdq.groups.every((g) => g.pulley_reading > 0) && /proportion/.test(v1.machine.vdq.pulley_method));
  const v2 = sheet('single_jersey', { vdq_points: [{ reading: 40, course_length_m: 5 }, { reading: 60, course_length_m: 7.5 }] });
  assert(v2.machine.vdq.groups.every((g) => g.pulley_reading > 0) && /straight line/.test(v2.machine.vdq.pulley_method));
  assert(sheet('single_jersey').machine.vdq.groups.every((g) => g.pulley_reading === null));
  // finishing: a real sequence with the water to evaporate, and the route's effect on size
  const f = sheet('single_jersey', { composition: '70% CO 30% CV', shade: 'dark' }).finishing;
  assert(f.sequence.length >= 6 && f.stenter.water_to_evaporate_g_m2 > 0 && f.stenter.pickup_pct > 0 && f.compaction.limit_pct === 5);
  assert(f.shrinkage_after_wash_pct.route_changes.some((c) => /viscose/.test(c.text)) && f.shrinkage_after_wash_pct.length < f.shrinkage_after_wash_pct.usual_route.length, 'viscose shrinks more than the usual route');
  const w = sheet('single_jersey', { composition: '60% WO 40% PES' }).finishing.shrinkage_after_wash_pct;
  assert(w.route_changes.some((c) => /wool/.test(c.text)) && w.length < w.usual_route.length, 'wool in an alkaline bath felts');
  const tight = sheet('single_jersey', { shrinkage_pct: 3 }).finishing;
  assert(tight.compaction.limit_pct === 3 && tight.compaction.shorten_pct >= sheet('single_jersey', { shrinkage_pct: 6 }).finishing.compaction.shorten_pct, 'a tighter buyer limit asks for more compaction');
  // the design says what the drawing decided
  const d = sheet('fleece_3_thread');
  assert(d.design.bed === 'single' && d.design.roles.includes('loop') && d.design.roles.includes('binder'));
  assert(sheet('rib_1x1').design.bed === 'double');
  // plush: with elastane the share is held (denier from a trial roll), without it a sheet with its own weight
  const pe = sheet('velour_plush', { brush: 'none' });
  assert(pe.success && pe.yarn.elastane && pe.yarn.elastane.denier === null && /trial roll/.test(pe.yarn.elastane.feeding) && Math.abs(pe.yarn.composition_solved.achieved.elastane - 5) <= 0.5);
  const p = sheet('velour_plush', { composition: '100% CO', brush: 'none' });
  assert(p.greige.gsm > 0 && /plush|relaxed/.test(p.greige.note));
  console.log('✓ VDQ pulley readings from one or two reference settings; a finishing sequence with the water to evaporate; the route (viscose, wool) moves the shrinkage; the design (bed, loop / binder roles) is stated; plush is handled');
}
console.log('Development sheet tests passed');
