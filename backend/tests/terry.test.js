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

// 9. loops: size and layout name the terry
{
  const { ENGINE_INPUTS } = require('../engine');
  for (const k of ['loop_size', 'loop_arrangement', 'pile_height_mm', 'velour_cut']) assert(ENGINE_INPUTS.includes(k), `${k} is forwarded by the API`);
  const std = FT(280).loop;
  assert(Math.abs(std.loop_height_mm - 1.54) < 0.05, `standard 1:3, 1.55 mm on 20G: h = √(3/16·(L²−S²)) ≈ 1.54 mm (got ${std.loop_height_mm})`);
  const sizes = std.sizes.map(z => z.loop_ne);
  for (let i = 1; i < sizes.length; i++) assert(sizes[i] >= sizes[i - 1], `bigger loops need a finer loop yarn at the same GSM: ${sizes.join(' → ')}`);
  const hs = std.sizes.map(z => z.loop_height_mm);
  for (let i = 1; i < hs.length; i++) assert(hs[i] > hs[i - 1], 'bigger loop size, taller loop');
  const a = Object.fromEntries(std.arrangements.map(x => [x.key, x]));
  assert(a.micro.loop_height_mm < a.standard.loop_height_mm && a.micro.loops_per_cm2 > 1.9 * a.standard.loops_per_cm2 && a.micro.snag_index < 0.5, '1:1 ties: smaller, twice as many, safer loops');
  assert(a.open.snag_index > 1.5, 'a 1:5 long float snags most');
  const taut = FT(280, { loopLengthMm: 1.2 });
  assert(taut.loop.taut && taut.warnings.some(w => /no loop forms/.test(w)), 'loop yarn shorter than the needle pitch: no loop');
  const big = FT(280, { loopSize: 'large', loopArrangement: 'diagonal' });
  assert(big.loop.size.key === 'large' && big.loop.arrangement.key === 'diagonal');
  assert(big.risks.some(r => r.topic === 'Loop snagging' && r.level !== 'low'), 'large loops are flagged for snagging');
  // the machine programme follows the layout
  const r = calculate({ fabric: 'french_terry', gsm: 280, composition: '100% Cotton', efficiency: 85, loop_arrangement: 'diagonal', loop_size: 'large' });
  const fleecy = r.pattern.pattern_cylinder.filter(row => row.includes('T')).map(row => row.indexOf('T'));
  assert.deepStrictEqual(fleecy, [3, 2, 1, 0], `diagonal: the tuck steps one needle per loop feed (${fleecy})`);
  assert(r.pattern.cam_arrangement.length === r.pattern.pattern_cylinder.length);
  assert(r.fleece.yarns.find(y => y.role === 'loop').sl_mm === 1.8, 'large loop: 1.8 mm per needle');
  console.log(`  Loopback loops: sizes ${hs.join('/')} mm high → loop ${sizes.join('/')} Ne; 1:1 ${a.micro.loop_height_mm} mm, 1:5 snag ${a.open.snag_index}×`);
}

// 10. plush layouts: fewer loop positions → coarser pile for the same GSM
{
  const full = PT('terry_fabric', 450, '100% Cotton', { pileHeightMm: 2.5 });
  const chk = PT('terry_fabric', 450, '100% Cotton', { pileHeightMm: 2.5, loopArrangement: 'checker' });
  const dia = PT('terry_fabric', 450, '100% Cotton', { pileHeightMm: 2.5, loopArrangement: 'diagonal' });
  const ne = (x) => x.yarns.find(y => y.role === 'pile').ne;
  assert(ne(chk) < ne(full) && ne(dia) <= ne(chk), `pile coarsens as loops thin out: ${ne(full)} → ${ne(chk)} → ${ne(dia)}`);
  assert(Math.abs(chk.pile.loops_per_cm2 / full.pile.loops_per_cm2 - 0.5) < 0.12, 'checker: about half the loops');
  const p = chk.yarns.find(y => y.role === 'pile'), g = chk.yarns.find(y => y.role === 'ground');
  assert(Math.abs(p.sl_mm - (g.sl_mm + 2 * 2.5 * 0.5)) < 0.02, 'pile per needle = ground + 2h × loop share');
  const jumbo = PT('terry_fabric', 450, '100% Cotton', { loopSize: 'jumbo' });
  assert(jumbo.pile.sinker_height_mm === 3, 'jumbo preset: 3 mm sinker');
  console.log(`  Plush layouts at 2.5 mm: full ${ne(full)}/1, checker ${ne(chk)}/1, diagonal ${ne(dia)}/1 pile`);
}

// 11. the back you see: scale, twill, grain, pebble, rib, open
{
  const back = (x) => FT(280, x).loop.back;
  assert.strictEqual(back({}).texture, 'scale', 'standard 1:3 loopback has the classic scale back');
  assert.strictEqual(back({ loopArrangement: 'diagonal' }).texture, 'twill', 'diagonal layout: twill ribs');
  assert.strictEqual(back({ loopArrangement: 'zigzag' }).texture, 'twill');
  assert.strictEqual(back({ loopArrangement: 'micro' }).texture, 'pebble', '1:1: pebble');
  assert.strictEqual(back({ loopArrangement: 'straight' }).texture, 'rib');
  assert.strictEqual(back({ loopSize: 'micro' }).texture, 'grain', 'micro loops lie flat as grain');
  assert.strictEqual(back({ loopSize: 'large' }).texture, 'open', 'large loops stand open');
  const s = back({});
  assert(s.lie_deg >= 40 && s.lie_deg <= 70 && s.standing_height_mm < FT(280).loop.loop_height_mm, 'loops lie over: they stand lower than their arc height');
  assert(s.slant_deg > 0, 'a singles loop yarn slants its loops');
  assert(s.back_lift > 0 && s.back_lift < 0.2, 'the back reads a little lighter than the face');
  // a two-ply loop yarn (a very heavy terry needs one) stands square
  const heavy = FT(560).loop.back;
  if (FT(560).yarns.find(y => y.role === 'loop').ply > 1) assert.strictEqual(heavy.slant_deg, 0, 'balanced two-ply loop yarn: no slant');
  const cover = [240, 300, 360].map(g => FT(g).loop.back.loop_cover_pct);
  assert(cover[2] > cover[0], `a heavier terry's coarser loop yarn covers more of the back: ${cover.join(' → ')}%`);
  console.log(`  Back: standard ${s.label}, lie ${s.lie_deg}°, slant ${s.slant_deg}°, cover ${cover.join('/')}% for 240/300/360 GSM`);
}

console.log('\nAll terry tests passed.');
