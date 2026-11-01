// Terry engines — loopback terry (fleece-engine, its own factory rows) and
// sinker-loop plush terry / velour (terry-engine).
const assert = require('assert');
const { analyzeFleece, _model: fleeceModel } = require('../engine/domain/fleece-engine');
const { analyzePlushTerry, _model } = require('../engine/domain/terry-engine');
const { parseComposition } = require('../engine/domain/composition-engine');
const { calculate } = require('../engine');

console.log('--- Running Terry Engine Tests ---');
const PT = (fabricId, gsm, comp = '100% Cotton', extra = {}) =>
  analyzePlushTerry({ fabricId, gsm, gauge: 20, composition: parseComposition(comp), ...extra });
const FT = (gsm, extra = {}) => analyzeFleece({ fabricId: 'french_terry', gsm, gauge: 20, composition: parseComposition('100% Cotton'), ...extra });

// 1. loopback terry stands on its own factory rows, not the fleece's
{
  const m = fleeceModel();
  assert(m.terry.rows >= 100, 'loopback terry rows load from the snapshot');
  assert(m.terry.wpcPerG < m.wpcPerG - 0.02, `unraised terry finishes wider than fleece: fewer wales per cm (${m.terry.wpcPerG.toFixed(3)} vs ${m.wpcPerG.toFixed(3)})`);
  assert(m.terry.anchors.includes(47) && m.terry.anchors.length >= 5, 'record 47 and the industry chart rows anchor terry Kc');
  for (const l of m.terry.loo.filter(x => x.tier === 'industry chart')) assert(Math.abs(l.error_pct) <= 8, `chart row ${l.gsm} predicted within 8% (${l.error_pct}%)`);
  console.log(`  Loopback terry: ${m.terry.rows} rows, wpc ${m.terry.wpcPerG.toFixed(3)}·G, Kc ${m.KC.terry.toFixed(2)}; LOO ${m.terry.loo.map(l => l.error_pct + '%').join(', ')}`);
}

// 2. loopback terry: the chart's loop yarns come back within a count step or two
{
  const chart = [[260, 30, 24], [280, 30, 20], [300, 30, 16]];
  for (const [gsm, face, loop] of chart) {
    const r = FT(gsm, { faceNe: face });
    const got = r.yarns.find(y => y.role === 'loop').ne;
    assert(Math.abs(got - loop) <= 6, `${gsm} GSM, ${face}/1 face: loop ${got}/1 vs chart ${loop}/1`);
    assert(!r.brushing && r.variant.kind === 'terry');
  }
  const ne = [240, 280, 320, 360].map(g => FT(g).yarns.find(y => y.role === 'loop').ne);
  for (let i = 1; i < ne.length; i++) assert(ne[i] <= ne[i - 1], `loop coarsens with weight: ${ne.join(' → ')}`);
  console.log(`  Loopback loop yarn: ${ne.join(' → ')} Ne for 240 → 360 GSM`);
}

// 3. plush: the measured tightness, the 2h pile geometry, the balance closes
{
  const M = _model();
  assert(M.tf > 1.25 && M.tf < 1.45 && M.tf_sd < 0.1, `plated-bundle TF from factory rows ≈ 1.35 (got ${M.tf.toFixed(3)} ± ${M.tf_sd.toFixed(3)})`);
  const r = PT('terry_fabric', 450);
  const g = r.yarns.find(y => y.role === 'ground'), p = r.yarns.find(y => y.role === 'pile');
  assert(Math.abs(p.sl_mm - (g.sl_mm + 2 * r.pile.sinker_height_mm)) < 0.02, 'pile length per needle = ground loop + 2 × sinker height');
  assert(Math.abs(Math.sqrt(g.tex + p.tex) / g.sl_mm - M.tf) < 0.01, 'ground loop sized from the plated bundle at the measured TF');
  assert(Math.abs(r.mass_balance.deviation_pct) <= 6, `450 GSM lands within 6% (${r.mass_balance.gsm_at_chosen_counts})`);
  assert(p.share_pct > 55 && p.share_pct < 80, `the pile carries most of a towel's weight (${p.share_pct}%)`);
  assert(Math.abs(g.share_pct + p.share_pct - 100) < 0.5);
  console.log(`  Plush 450: ${r.declaration}, sinker ${r.pile.sinker_height_mm} mm, ${r.pile.loops_per_cm2} loops/cm², pile ${p.share_pct}%`);
}

// 4. heavier towels get taller loops and/or coarser pile; sinker ↔ count trade-off
{
  const light = PT('terry_fabric', 300), heavy = PT('terry_fabric', 520);
  assert(heavy.pile.sinker_height_mm >= light.pile.sinker_height_mm, 'heavier towel, taller loops');
  const opts = PT('terry_fabric', 450).pile.options;
  const ne = opts.map(o => parseInt(o.pile, 10));
  assert(ne[ne.length - 1] > ne[0], 'a taller sinker needs a finer pile yarn for the same GSM');
  const fixed = PT('terry_fabric', 450, '100% Cotton', { pileNe: 16 });
  assert(fixed.pile.sinker_height_mm < 2.5, 'a coarse 16/1 pile at 450 GSM needs a low sinker');
  console.log(`  Sinker options at 450 GSM: ${opts.map(o => o.sinker_mm + 'mm→' + o.pile).join(', ')}`);
}

// 5. towels absorb, polyester does not; plush is thicker with taller loops
{
  const cot = PT('terry_fabric', 450), pes = PT('terry_fabric', 450, '100% Polyester');
  assert(cot.absorbency.g_per_g > 2 && cot.absorbency.g_per_g < 5, `cotton terry takes up 2-5 g water per g (${cot.absorbency.g_per_g})`);
  assert(pes.absorbency.g_per_g < cot.absorbency.g_per_g * 0.6, 'a polyester pile holds far less water');
  const lo = PT('terry_fabric', 450, '100% Cotton', { pileHeightMm: 1.5 }), hi = PT('terry_fabric', 450, '100% Cotton', { pileHeightMm: 3.0 });
  assert(hi.thermal.thickness_mm > lo.thermal.thickness_mm + 0.8, 'taller loops, thicker cloth');
  console.log(`  Absorbency: cotton ${cot.absorbency.g_per_g} g/g, polyester ${pes.absorbency.g_per_g} g/g`);
}

// 6. velour: sheared, grey heavier than finished, filament pile for polyester
{
  const v = PT('velour_plush', 300);
  assert(v.variant.cut && v.shearing && v.shearing.cut_to_mm < v.shearing.knitted_loop_mm, 'velour loops are cut below the knitted height');
  assert(v.mass_balance.gsm_grey_before_shearing > v.mass_balance.gsm_at_chosen_counts, 'shearing removes mass: knit grey heavier');
  const p = PT('velour_plush', 280, '100% Polyester');
  assert(p.yarns.every(y => y.denier), 'polyester velour: filament ground and filament pile');
  const cvc = PT('velour_plush', 320, '80% Cotton 20% Polyester');
  assert(cvc.yarns.find(y => y.role === 'ground').denier && !cvc.yarns.find(y => y.role === 'pile').denier, 'CVC velour: polyester ground, cotton pile');
  const plush = PT('velour_plush', 300, '100% Cotton', { cut: false });
  assert(!plush.variant.cut && !plush.shearing, 'uncut: plush');
  console.log(`  Velour: ${v.declaration}, knit ${v.shearing.knitted_loop_mm} → cut ${v.shearing.cut_to_mm} mm, ${v.shearing.fabric_mass_removed_pct}% sheared off`);
}

// 7. gauge: a heavy bundle is flagged with a coarser machine
{
  const r = PT('terry_fabric', 560);
  assert(!r.gauge_check.ok && r.gauge_check.suggested_gauge < 20, `a ${r.gauge_check.bundle_tex} tex bundle needs a coarser gauge than 20G`);
  assert(PT('terry_fabric', 400).gauge_check.ok, '400 GSM plush runs on 20G');
}

// 8. the full engine
{
  const r = calculate({ fabric: 'terry_fabric', gsm: 450, composition: '100% Cotton', efficiency: 85 });
  assert(r.terry && r.terry.ok, 'terry block present');
  assert(/Pile: /.test(r.yarn.count_display) && /sinker/.test(r.yarn.count_display), r.yarn.count_display);
  assert(r.loop_length.multiplier_source === 'TERRY_PLUSH_MODEL' && Math.abs(r.loop_length.value_mm - r.terry.mass_balance.ground_sl_mm) < 0.01, 'SL is the plush ground loop, not the loopback face');
  const route = r.wet_processing.process_route;
  assert(!route.some(x => /Compacting/.test(x)) && route.some(x => /relax dry/i.test(x)), 'plush: no compactor, relax dried');
  assert(r.quality_prediction.shrinkage.finishing_route.key === 'plush');
  assert(/plush \(terry\) machine/.test(r.machine.optimal.summary));
  const v = calculate({ fabric: 'velour_plush', gsm: 280, composition: '100% Polyester', efficiency: 85 });
  const vr = v.wet_processing.process_route;
  assert(/Shearing/.test(vr[1]) && vr.some(x => /Final shearing/.test(x)) && vr.some(x => /Disperse/.test(x)), 'velour: cut grey, disperse dyed, final shear');
  const f = calculate({ fabric: 'french_terry', gsm: 280, composition: '100% Cotton', efficiency: 85 });
  assert(f.fleece && !f.terry && f.wet_processing.process_route.some(x => /Compacting/.test(x)), 'loopback terry stays on the fleece engine and is compacted');
  console.log('  Engine: plush SL from the terry model, no compactor; velour sheared + disperse; loopback compacted');
}

console.log('\nAll terry tests passed.');
