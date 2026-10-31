/**
 * Piqué structure engine (engine/domain/pique-engine.js).
 *
 * Pins the physics a viewer relies on: the factory records really do show a
 * piqué wider and more course-packed than jersey, the typical structure lands
 * on those measured values, stacking tucks deepens the cell, the density
 * weighs what was asked for, single-bed piqués are sold on the technical
 * back, and no catalogue piqué collapses into another one's needle programme.
 */

const { calculate } = require('../engine/index');
const { analyzePique, tuckStats, PIQUE_FAMILY, ANCHORS } = require('../engine/domain/pique-engine');

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
// Intermeshing geometry: a loop held one course is (1.41 + 1) / 1.41 tall.
ok(Math.abs(single.geometry.held_loop_elongation - 1.71) < 0.01, `single Lacoste held loop 1.71x (${single.geometry.held_loop_elongation})`);
ok(single.geometry.relief_mm > 0.1 && single.geometry.relief_mm < 0.35, `single Lacoste cell 0.1-0.35 mm deep (${single.geometry.relief_mm})`);
// Buckling: a half-sine bow of a leg squeezed from H to H' = H/k has extra
// arc length pi^2 a^2 / (4 H'); the relief must satisfy that exactly.
{
  const k = single.density.course_compression_vs_jersey;
  const H = 1.41 * (run('lacoste_single', 200).loop_length.value_mm / ANCHORS.jersey.Kc);
  const Hs = H / k, a = single.geometry.relief_buckle_mm;
  const excess = (Math.PI ** 2 * a * a) / (4 * Hs);
  ok(Math.abs(excess - (H - Hs)) / (H - Hs) < 0.05, `buckle amplitude closes the arc-length balance (${excess.toFixed(3)} vs ${(H - Hs).toFixed(3)} mm)`);
}
// Leave-one-out validation against the factory rows is reported, and good.
const v = single.basis.validation;
ok(v && v.rows >= 50 && v.width_error_median_pct < 6 && v.gsm_error_median_pct < 8,
  `factory leave-one-out: width ${v && v.width_error_median_pct}% / GSM ${v && v.gsm_error_median_pct}% median error`);
const polo = run('pique_single', 200).pique;

// 3b. The factory records: piqué measurably wider and more course-packed
//     than jersey at the same stitch length, with enough rows to mean it.
ok(ANCHORS.pique.n >= 50 && ANCHORS.jersey.n >= 500, `factory rows: ${ANCHORS.pique.n} piqué, ${ANCHORS.jersey.n} jersey`);
const spreadRef = ANCHORS.jersey.Kw / ANCHORS.pique.Kw;
const packRef = ANCHORS.pique.Kc / ANCHORS.jersey.Kc;
ok(spreadRef > 1.15 && spreadRef < 1.45, `measured wale spread ${spreadRef.toFixed(2)}`);
ok(packRef > 1.25 && packRef < 1.6, `measured course packing ${packRef.toFixed(2)}`);
// The reference-intensity structure (double Lacoste, I = 0.5) sits on them.
ok(Math.abs(dbl.geometry.wale_spread - spreadRef) < 0.02, `double Lacoste spread = measured typical (${dbl.geometry.wale_spread})`);
ok(Math.abs(dbl.density.expected_compression - dbl.density.factory_compression) < 0.02, `double Lacoste packing = measured typical at its weight (${dbl.density.expected_compression} vs ${dbl.density.factory_compression})`);

// 4. More tucks per repeat spread the wales wider.
ok(polo.geometry.wale_spread > single.geometry.wale_spread, 'polo pique spreads wider than single Lacoste');

// 5. Density closes the mass balance at the requested GSM (single bed).
for (const gsm of [180, 200, 220]) {
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

// 9. Fibre, from the records: CVC packs more courses than cotton; lycra
//    spreads less.
const cot = analyzePique({ fabricId: 'lacoste_single', gsm: 200, countNe: 26, llMm: 2.6, tf: 18,
  composition: { fibers: { cotton: 100 } }, pattern: { pattern_cylinder: [['K', 'T'], ['K', 'K'], ['T', 'K'], ['K', 'K']] } });
const pes = analyzePique({ fabricId: 'lacoste_single', gsm: 200, countNe: 26, llMm: 2.6, tf: 18,
  composition: { fibers: { polyester: 100 } }, pattern: { pattern_cylinder: [['K', 'T'], ['K', 'K'], ['T', 'K'], ['K', 'K']] } });
const ela = analyzePique({ fabricId: 'lacoste_single', gsm: 200, countNe: 26, llMm: 2.6, tf: 18,
  composition: { fibers: { cotton: 95, elastane: 5 }, has_elastane: true }, pattern: { pattern_cylinder: [['K', 'T'], ['K', 'K'], ['T', 'K'], ['K', 'K']] } });
ok(pes.density.expected_compression > cot.density.expected_compression, 'polyester-rich piqué packs more courses (CVC records)');
ok(ela.geometry.wale_spread < cot.geometry.wale_spread, 'lycra piqué spreads less (lycra records)');

// 10. GSM: at the same count and stitch length a heavier quality packs more
//     courses, and its squeezed loops buckle deeper.
const at = (gsm) => analyzePique({ fabricId: 'lacoste_single', gsm, countNe: 26, llMm: 2.6,
  composition: { fibers: { cotton: 100 } }, pattern: { pattern_cylinder: [['K', 'T'], ['K', 'K'], ['T', 'K'], ['K', 'K']] } });
ok(at(215).geometry.relief_mm > at(185).geometry.relief_mm, 'heavier at same count/SL: deeper cell');
ok(!at(320).density.plausible, 'an unreachable GSM for the count/SL is flagged');

// 11. Count / stitch length for a single-bed pique: solved from the
//     finished-GSM balance, checked against what the factory ran.
{
  const counts = [160, 180, 200, 220, 240, 260].map(g => run('lacoste_single', g).yarn.count_ne);
  ok(counts.every((c, i) => i === 0 || c <= counts[i - 1]), `count never gets finer as GSM rises (${counts.join(', ')})`);
  const r200 = run('pique_single', 200), r240 = run('pique_single', 240);
  ok(r200.yarn.count_ne >= 22 && r200.yarn.count_ne <= 26, `200 GSM: ${r200.yarn.count_ne}/1 (factory rows at ~200 finished: median 24/1)`);
  ok(r240.yarn.count_ne >= 20 && r240.yarn.count_ne <= 22, `240 GSM: ${r240.yarn.count_ne}/1 (factory rows at 240-259: 20-22/1)`);
  const rc = r240.pique.recipe;
  ok(rc && rc.applied && r240.yarn.source === 'FACTORY_MODEL', 'solved recipe used, labelled as the factory-calibrated model');
  ok(rc.tightness_factor >= 17 && rc.tightness_factor <= 20, `recipe tightness in band (TF ${rc.tightness_factor})`);
  const heavy = run('pique_single', 280);
  ok(heavy.pique.recipe.gauge.ok === false && heavy.pique.recipe.gauge.suggested_gauge === 22, '280 GSM on 24G: gauge limit flagged, 22G suggested');
  ok(heavy.warnings.some(w => /22G/.test(w)), 'gauge advice reaches the warnings');
  ok(run('pique_single', 280, { gauge: 20 }).pique.recipe.gauge.ok, '280 GSM on 20G: within range');
}

// 12. Composition reaches the analysis (it used to receive the raw text and
//     read every blend as cotton).
ok(/cvc/.test(run('lacoste_single', 200, { composition: '60% Cotton 40% Polyester' }).pique.geometry.fibre), 'CVC composition reaches the pique analysis');
ok(/elastane/.test(run('lacoste_single', 200, { composition: '95% Cotton 5% Elastane' }).pique.geometry.fibre), 'elastane reaches the pique analysis');

// 13. No source attributions reach the API.
ok(!/spencer|leaf|sha et|http/i.test(JSON.stringify(single)), 'no source names or links in the pique output');

if (failed) {
  console.error(`\n${failed} pique test(s) failed`);
  process.exit(1);
}
console.log('\nAll pique tests passed.');
