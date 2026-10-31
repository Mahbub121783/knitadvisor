/**
 * Piqué structure engine (engine/domain/pique-engine.js).
 *
 * Pins the physics a viewer relies on: stacking tucks deepens the cell,
 * tucks spread the wales, the heavier quality weighs what was asked for, the
 * single-bed piqués are sold on the technical back, and no catalogue piqué
 * collapses into another one's needle programme.
 */

const { calculate } = require('../engine/index');
const { analyzePique, tuckStats, PIQUE_FAMILY } = require('../engine/domain/pique-engine');

let failed = 0;
const ok = (cond, msg) => {
  if (cond) console.log(`[PASS] ${msg}`);
  else { console.error(`[FAIL] ${msg}`); failed++; }
};

const run = (fabric, gsm, extra = {}) => calculate({ fabric, gsm, ...extra });

// 1. Every piqué in the family gets an analysis; a plain jersey does not.
for (const id of Object.keys(PIQUE_FAMILY)) {
  const r = run(id, 200);
  ok(r.success !== false && r.pique && r.pique.fabric_id === id, `${id}: pique analysis present`);
}
ok(run('single_jersey', 180).pique === null, 'single_jersey: no pique analysis');

// 2. Tuck statistics from the needle programme.
const sl = tuckStats([['K', 'T'], ['K', 'K'], ['T', 'K'], ['K', 'K']]);
ok(sl.n_tuck === 1 && sl.tuck_fraction === 0.25 && sl.plain_courses === 2, 'single Lacoste: 1 tuck per wale, 1/4 tuck, 2 plain courses');
const dl = tuckStats([['K', 'K'], ['K', 'T'], ['K', 'T'], ['K', 'K'], ['T', 'K'], ['T', 'K']]);
ok(dl.n_tuck === 2, 'double Lacoste: two stacked tucks');
// cyclic: a run that wraps over the repeat boundary still counts
ok(tuckStats([['T'], ['K'], ['T']]).n_tuck === 2, 'tuck run wraps over the repeat');

// 3. Stacked tucks give a longer held loop and a deeper cell.
const single = run('lacoste_single', 200).pique;
const dbl = run('lacoste_double', 200).pique;
ok(dbl.geometry.held_loop_elongation > single.geometry.held_loop_elongation, 'double Lacoste held loop longer than single');
ok(dbl.geometry.relief_mm > single.geometry.relief_mm, 'double Lacoste cell deeper than single');
// Calibrated against the published parameter sets (within ~15 %)
ok(Math.abs(single.geometry.held_loop_elongation - 1.75) < 0.2, `single Lacoste elongation ≈ 1.75 (${single.geometry.held_loop_elongation})`);
ok(Math.abs(single.geometry.wale_spread - 1.18) < 0.05, `single Lacoste wale spread ≈ 1.18 (${single.geometry.wale_spread})`);
ok(single.geometry.relief_mm > 0.3 && single.geometry.relief_mm < 0.55, `single Lacoste relief ≈ 0.42 mm (${single.geometry.relief_mm})`);
const polo = run('pique_single', 200).pique;
ok(Math.abs(polo.geometry.wale_spread - 1.34) < 0.06, `polo pique wale spread ≈ 1.34 (${polo.geometry.wale_spread})`);

// 4. More tucks per repeat spread the wales wider.
ok(polo.geometry.wale_spread > single.geometry.wale_spread, 'polo pique spreads wider than single Lacoste');

// 5. Density closes the mass balance at the requested GSM (single bed).
for (const gsm of [170, 200, 230]) {
  const r = run('lacoste_single', gsm);
  const q = r.pique;
  const tex = r.physical_constraints.tex;
  const ll = r.loop_length.value_mm / 10;
  const back = q.density.courses_per_cm * q.density.wales_per_cm * ll * tex / 10;
  ok(Math.abs(back - gsm) / gsm < 0.03, `lacoste_single ${gsm} GSM: density weighs ${back.toFixed(0)} g/m²`);
}

// 6. Selling face: single-bed piqués are sold on the technical back.
for (const id of ['lacoste_single', 'lacoste_double', 'pique_single', 'pique_double', 'single_cross_tuck']) {
  ok(run(id, 200).pique.selling_face === 'technical_back', `${id}: selling face is the technical back`);
}
ok(run('swiss_double_pique', 260).pique.behaviour.curl_vs_jersey === 0, 'double knit piqué does not curl');
ok(single.behaviour.curl_vs_jersey < 1, 'single Lacoste curls less than jersey');

// 7. No two single-bed piqués share a needle programme (pique_double used to
//    be single_cross_tuck under another name).
const sig = (id) => JSON.stringify(run(id, 200).pattern.pattern_cylinder);
const ids = ['lacoste_single', 'lacoste_double', 'pique_single', 'pique_double', 'single_cross_tuck'];
ok(new Set(ids.map(sig)).size === ids.length, 'single-bed piqués all have distinct programmes');
ok(run('pique_double', 200).pique.tuck.consecutive_tucks === 2, 'jump pique: needle pairs held two courses');

// 8. Swiss / French: the dial carries the cell, French by tucking.
const sw = run('swiss_double_pique', 260).pique;
const fr = run('french_double_pique', 260).pique;
ok(sw.tuck.consecutive_holds >= 2 && sw.tuck.consecutive_tucks === 0, 'Swiss: dial loops held by misses, no tucks');
ok(fr.tuck.consecutive_tucks >= 1, 'French: dial tucks');

// 9. Fibre: a smooth filament relaxes the cell; elastane deepens it.
const cot = analyzePique({ fabricId: 'lacoste_single', gsm: 200, countNe: 26, llMm: 2.6, tf: 18,
  composition: { fibers: { cotton: 100 } }, pattern: { pattern_cylinder: [['K', 'T'], ['K', 'K'], ['T', 'K'], ['K', 'K']] } });
const pes = analyzePique({ fabricId: 'lacoste_single', gsm: 200, countNe: 26, llMm: 2.6, tf: 18,
  composition: { fibers: { polyester: 100 } }, pattern: { pattern_cylinder: [['K', 'T'], ['K', 'K'], ['T', 'K'], ['K', 'K']] } });
const ela = analyzePique({ fabricId: 'lacoste_single', gsm: 200, countNe: 26, llMm: 2.6, tf: 18,
  composition: { fibers: { cotton: 95, elastane: 5 }, has_elastane: true }, pattern: { pattern_cylinder: [['K', 'T'], ['K', 'K'], ['T', 'K'], ['K', 'K']] } });
ok(pes.geometry.relief_mm < cot.geometry.relief_mm, 'polyester cell shallower than cotton');
ok(ela.geometry.relief_mm > cot.geometry.relief_mm && ela.geometry.wale_spread < cot.geometry.wale_spread, 'elastane: deeper, narrower cell');

// 10. Tightness: a tighter fabric buckles less.
const tight = analyzePique({ fabricId: 'lacoste_single', gsm: 200, countNe: 26, llMm: 2.6, tf: 21,
  composition: { fibers: { cotton: 100 } }, pattern: { pattern_cylinder: [['K', 'T'], ['K', 'K'], ['T', 'K'], ['K', 'K']] } });
ok(tight.geometry.relief_mm < cot.geometry.relief_mm, 'higher tightness factor, shallower cell');

// 11. No source attributions reach the API.
ok(!/spencer|leaf|sha et|http/i.test(JSON.stringify(single)), 'no source names or links in the pique output');

if (failed) {
  console.error(`\n${failed} pique test(s) failed`);
  process.exit(1);
}
console.log('\nAll pique tests passed.');
