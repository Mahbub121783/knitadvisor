// Fabric studio: a drawn structure weighed on the factory's own constants,
// checked the way the knitting floor would find out.
const assert = require('assert');
const S = require('../engine/domain/fabric-studio');
const { CAL, buildKnitPlan } = require('../engine/domain/knit-plan');
const { FACTORY_RECORDS } = require('../engine/catalog/factory-dataset');
const { FABRIC_DERIVATIVES } = require('../engine/catalog/fabric-derivatives');
console.log('--- Running Fabric Studio Tests ---');

const T = S.listTemplates();
const tpl = (id) => T.find((t) => t.id === id);
const run = (id, x = {}) => {
  const t = tpl(id);
  return S.analyse({ bed: t.bed, gating: t.gating, grid: t.grid, feeds: t.roles.map((role) => ({ role })), ...x });
};

// 1. every catalogue weft structure loads and analyses
assert(T.length >= 60, `templates: ${T.length}`);
for (const t of T) {
  const r = run(t.id, { yarn: { ne: 30 }, target: { gsm: 200 } });
  assert(r.success, `${t.id}: ${r.error}`);
  // only the jacquard-width pointelles need more than a 4-track cylinder
  const errs = r.checks.filter((c) => c.level === 'error');
  if (!/pointelle_(chevron|diagonal)/.test(t.id)) assert.strictEqual(errs.length, 0, `${t.id}: ${errs.map((c) => c.text).join(' / ')}`);
}

// 2. the anchor structure IS the measured fit: GSM = Ks × tex ÷ (10 ℓ)
{
  const r = run('single_jersey', { yarn: { ne: 30 }, machine: { sl_mm: 2.7 } });
  const ks = CAL.ks['single_jersey|P'].med;
  assert.strictEqual(r.structure.confidence.level, 'calibrated');
  assert(Math.abs(r.fabric.gsm - (ks * 590.5 / 30) / 2.7) <= 1, `gsm ${r.fabric.gsm}`);
}

// 3. against the factory's own single-jersey rows: stitch length for the GSM
{
  const e = [];
  for (const rec of FACTORY_RECORDS) {
    if (rec.fab !== 'single_jersey' || /lycra/.test(rec.spin || '') || !(rec.ne > 0 && rec.sl > 0 && rec.fgsm > 0)) continue;
    const r = run('single_jersey', { yarn: { ne: rec.ne }, target: { gsm: rec.fgsm } });
    e.push(Math.abs(r.fabric.sl_mm / rec.sl - 1) * 100);
  }
  e.sort((a, b) => a - b);
  assert(e[e.length >> 1] < 6, `single jersey SL median error ${e[e.length >> 1]}%`);
}

// 4. the same answer as the calculator's knitting plan for a catalogue fabric
{
  const f = FABRIC_DERIVATIVES.find((x) => x.id === 'lacoste_single');
  const kp = buildKnitPlan({ fabricDef: f, countNe: 24, gsm: 210, gauge: 24, dia: 30 });
  const r = run('lacoste_single', { yarn: { ne: 24 }, target: { gsm: 210 }, machine: { gauge: 24, dia: 30 } });
  assert.strictEqual(r.structure.confidence.level, 'calibrated');
  assert(Math.abs(r.fabric.sl_mm / kp.stitch_length.used_mm - 1) < 0.02, `SL ${r.fabric.sl_mm} vs ${kp.stitch_length.used_mm}`);
  assert(Math.abs(r.fabric.width_open_in / kp.fabric.finished_width_in - 1) < 0.03, `width ${r.fabric.width_open_in} vs ${kp.fabric.finished_width_in}`);
  // two tracks; knit feeders take more yarn than knit-tuck feeders → two quality belts
  assert.strictEqual(r.setup.tracks.C.count, 2);
  assert.strictEqual(r.vdq.groups.length, 2);
}

// 5. solver: no count given → a count the factory would use for 180 GSM jersey
{
  const r = run('single_jersey', { target: { gsm: 180 } });
  assert(r.solver && r.solver.options.length >= 2);
  const ne = 590.5 / r.yarn.ground.tex;
  assert(ne >= 18 && ne <= 26, `solved ${ne}s`);
}

// 6. a 2-in-1-out rib is weighed on its own factory records: it draws in more
// across the width, so the same GSM and count take a longer loop than a 1×1
// (Ks 36 vs 27 in the records; one shared Ks had put its GSM out by ~24 %)
{
  const a = run('rib_1x1', { yarn: { ne: 30 }, target: { gsm: 220 } });
  const b = run('rib_2x2', { yarn: { ne: 30 }, target: { gsm: 220 } });
  const ratio = b.fabric.sl_mm / a.fabric.sl_mm;
  assert(ratio > 1.2 && ratio < 1.5, `2x2 / 1x1 stitch length ${b.fabric.sl_mm} / ${a.fabric.sl_mm}`);
  assert(/rib2x2/.test(b.fabric.ks_basis), `2x2 constants from the 2x2 records: ${b.fabric.ks_basis}`);
  // width: two-thirds of the needles, each loop longer by that ratio (Kw per working needle is the same in the records)
  const wExpect = (2 / 3) * ratio;
  assert(Math.abs(b.fabric.width_open_in / a.fabric.width_open_in / wExpect - 1) < 0.08, `width ${b.fabric.width_open_in} vs ${a.fabric.width_open_in} × ${wExpect.toFixed(2)}`);
}

// 7. checks the machine would otherwise find
{
  const clash = S.analyse({ bed: 'double', gating: 'interlock', grid: { C: ['KK'], D: ['KK'] }, yarn: { ne: 30 }, target: { gsm: 200 } });
  assert(clash.checks.some((c) => c.level === 'error' && /face each other/.test(c.text)), 'interlock clash');
  assert.strictEqual(clash.ok_to_knit, false);
  const tracks = S.analyse({ grid: { C: ['KTMK', 'TKKM', 'MKTK'] }, yarn: { ne: 30 }, target: { gsm: 180 }, machine: { tracks_cyl: 2 } });
  assert(tracks.checks.some((c) => c.level === 'error' && /needs 4 needle tracks/.test(c.text)), 'track count');
  const feeders = run('lacoste_single', { yarn: { ne: 24 }, target: { gsm: 210 }, machine: { feeders: 90 } });
  assert(feeders.checks.some((c) => c.level === 'error' && /not a whole number/.test(c.text)), 'feeders multiple');
  const held = S.analyse({ grid: { C: ['K', 'T', 'T', 'T', 'T', 'T'] }, yarn: { ne: 30 }, target: { gsm: 200 } });
  assert(held.checks.some((c) => c.level === 'warn' && /tucks 5 times/.test(c.text)), 'tuck run');
  const nothing = S.analyse({ grid: { C: ['KM', 'KM'] }, yarn: { ne: 30 }, target: { gsm: 160 } });
  assert(nothing.success);
  const bad = S.analyse({ grid: { C: ['KX'] }, yarn: { ne: 30 }, target: { gsm: 160 } });
  assert(!bad.success && /Use K, T, M, E or -/.test(bad.error));
}

// 8. elastane by mass balance: 20 D at draft 2.6 in 30s, full plating
{
  const r = run('single_jersey', { yarn: { ne: 30 }, target: { gsm: 190 }, elastane: { denier: 20, draft: 2.6 } });
  const el = r.yarn.composition.find((c) => /elastane/.test(c.part));
  const expect = (20 / 9 / 2.6) / (590.5 / 30 + 20 / 9 / 2.6) * 100;
  assert(Math.abs(el.pct - expect) < 0.15, `elastane ${el.pct}% vs ${expect}%`);
}

// 9. VDQ: two reference settings → a straight line through both
{
  const r = run('lacoste_single', { yarn: { ne: 24 }, target: { gsm: 210 }, machine: { gauge: 24, dia: 30, vdq: { points: [{ reading: 100, course_length_m: 5 }, { reading: 120, course_length_m: 6 }] } } });
  r.vdq.groups.forEach((g) => assert(Math.abs(g.vdq_reading - (100 + 20 * (g.course_length_m - 5))) < 0.02));
}

// 10. the double piqués drawn with both beds rising open on rib gating
assert.strictEqual(tpl('swiss_double_pique').gating, 'rib');
assert.strictEqual(tpl('interlock').gating, 'interlock');
assert.strictEqual(tpl('ponte_di_roma').gating, 'interlock');


// 11. the structure moves the cloth, not just the yarn (same yarn, ℓ, machine)
{
  const base = { yarn: { ne: 30 }, machine: { sl_mm: 2.7, gauge: 24, dia: 30 } };
  const a = (C, x = {}) => S.analyse({ grid: { C }, ...base, ...x });
  const sj = a(['K']), same = a(['KKKK']), miss = a(['KM', 'MK']), lac = run('lacoste_single', base);
  // a repeat drawn bigger than it needs is the same fabric, and is recognised as such
  assert.strictEqual(same.fabric.gsm, sj.fabric.gsm);
  assert.strictEqual(same.structure.confidence.level, 'calibrated');
  assert(same.structure.reduced, 'repeat reduced');
  // tucks widen the cloth and pack the courses; floats draw it in
  assert(lac.fabric.width_open_in > sj.fabric.width_open_in * 1.2, 'tucks widen');
  assert(lac.fabric.cpi > sj.fabric.cpi * 1.3, 'tucks pack courses');
  assert(miss.fabric.width_open_in < sj.fabric.width_open_in, 'misses narrow');
  assert.strictEqual(miss.structure.confidence.level, 'estimate', 'miss magnitude is not measured');
  // more tucks than the anchor → wider still (within the measured cap)
  const pq = run('pique_single', base);
  assert(pq.fabric.width_open_in > lac.fabric.width_open_in, 'more tucks, wider');
  // a needle taken out narrows the cloth by its share and leaves the weight per area alone
  const drop = a(['KKK-']);
  assert(Math.abs(drop.fabric.width_open_in / sj.fabric.width_open_in - 0.75) < 0.01, 'drop needle width');
  assert(Math.abs(drop.fabric.gsm / sj.fabric.gsm - 1) < 0.02, 'drop needle gsm');
  // fibre is in the constants (factory: CVC and PC jersey run heavier than cotton at one ℓ)
  const f = (fibre) => S.analyse({ grid: { C: ['K'] }, yarn: { ne: 30, fibre }, machine: { sl_mm: 2.7 } });
  assert(f('cvc').fabric.gsm > f('cotton').fabric.gsm && f('polyester_spun').fabric.gsm > f('cvc').fabric.gsm, 'fibre ordering');
  assert.strictEqual(f('viscose').structure.confidence.level, 'estimate', 'no viscose records');
  // part-plating sits between plain and fully plated; an odd repeat is doubled so "alternate" means something
  const L = { grid: { C: ['K'] }, yarn: { ne: 30 }, machine: { sl_mm: 2.9 } };
  const none = S.analyse(L), half = S.analyse({ ...L, elastane: { denier: 20, every: 'alternate' } }), full = S.analyse({ ...L, elastane: { denier: 20 } });
  assert(none.fabric.gsm < half.fabric.gsm && half.fabric.gsm < full.fabric.gsm, 'plating blend');
  assert.strictEqual(half.structure.feeds, 2);
  // a tighter tuck feeder changes the cloth's loop length, and a note says so
  const tf = S.analyse({ grid: { C: lac.structure.beds.C.map((r) => r.join('')) }, feeds: [{ sl_ratio: 0.92 }, {}, { sl_ratio: 0.92 }, {}], ...base });
  assert(tf.checks.some((c) => /knitting feeders/.test(c.text)));
}

// 12. trial rolls replace the carried-over constants and reproduce the mill's own cloth
{
  const grid = { C: ['KT', 'KK', 'TK', 'KK'] };
  const base = { grid, yarn: { ne: 24 }, machine: { gauge: 24, dia: 30, sl_mm: 2.6 } };
  const m = S.analyse(base);
  const rolls = [2.6, 2.75].map((sl) => ({ sl_mm: sl, gsm: m.fabric.gsm * 1.08 * 2.6 / sl, width_in: m.fabric.width_open_in * 0.97 * sl / 2.6, dia: 30, gauge: 24 }));
  const c = S.analyse({ ...base, calibration: { rolls } });
  assert.strictEqual(c.structure.confidence.level, 'verified');
  assert(Math.abs(c.fabric.gsm / (m.fabric.gsm * 1.08) - 1) < 0.01, `gsm ${c.fabric.gsm}`);
  assert(Math.abs(c.fabric.width_open_in / (m.fabric.width_open_in * 0.97) - 1) < 0.01, 'width');
  assert(Math.abs(c.fabric.calibration.ks_vs_model_pct - 8) < 0.6, 'the model was 8% light');
  // the stitch length solved for a target now follows the mill's own cloth
  const t = S.analyse({ ...base, machine: { gauge: 24, dia: 30 }, target: { gsm: 230 }, calibration: { rolls } });
  const u = S.analyse({ ...base, machine: { gauge: 24, dia: 30 }, target: { gsm: 230 } });
  assert(t.fabric.sl_mm > u.fabric.sl_mm, 'a mill whose cloth is heavier per loop reaches the same weight with a longer loop');
  // scatter widens the likely range; an outlier among three is flagged
  const noisy = S.analyse({ ...base, calibration: { rolls: [rolls[0], rolls[1], { ...rolls[0], gsm: rolls[0].gsm * 1.2 }] } });
  assert(noisy.fabric.calibration.rolls.some((r) => r.outlier), 'outlier flagged');
  assert(noisy.fabric.gsm_range[1] - noisy.fabric.gsm_range[0] > c.fabric.gsm_range[1] - c.fabric.gsm_range[0]);
  // nonsense is refused with the field named
  const bad = S.analyse({ ...base, calibration: { rolls: [{ ...rolls[0], gsm: 5 }] } });
  assert(!bad.success && /finished GSM/.test(bad.error));
}

// choosing count and gauge together: what it proposes, its own checks accept
{
  const T = S.listTemplates();
  const run = (id, gsm, machine = {}) => {
    const t = T.find((x) => x.id === id);
    return S.analyse({ bed: t.bed, gating: t.gating, grid: t.grid, feeds: t.roles.map((r) => ({ role: r })), yarn: { fibre: 'cotton' }, target: { gsm }, machine });
  };
  for (const [id, gsm] of [['single_jersey', 160], ['lacoste_single', 215], ['rib_1x1', 220], ['interlock', 220], ['fleece_3_thread', 300], ['rib_2x2', 305]]) {
    const o = run(id, gsm);
    assert(o.success && o.solver.verdict.level === 'ok', `${id} ${gsm}: a setting inside every limit exists`);
    assert(!o.checks.some((c) => c.level === 'warn' && /Tightness factor|too fine|coarse for|hook load/.test(c.text)), `${id} ${gsm}: the chosen setting passes its own checks — ${o.checks.filter((c) => c.level === 'warn').map((c) => c.text).join(' | ')}`);
    assert(o.solver.options[0].breaks.length === 0);
  }
  // a weight the structure cannot reach inside the factory's limits is said so, not passed off
  const h = run('heavy_jersey', 335);
  assert.strictEqual(h.solver.verdict.level, 'not_reachable');
  assert(/too heavy/.test(h.solver.verdict.text) && h.checks.some((c) => c.level === 'warn' && /No count and gauge/.test(c.text)));
  // a gauge you set is kept; only the count is searched
  const g = run('single_jersey', 160, { gauge: 28 });
  assert(g.solver.options.every((x) => x.gauge === 28) && g.machine.gauge === 28);
}

// held loops pack the cloth: an interlock programme drawn on rib gating is the
// same cloth as interlock, and the double piqués reach their usual weights
{
  const T = S.listTemplates();
  const two = (gating) => S.analyse({ bed: 'double', gating, grid: { C: ['KM', 'MK'], D: ['MK', 'KM'] }, feeds: [{}, {}], yarn: { ne: 34, fibre: 'cotton' }, machine: { sl_mm: 2.9, gauge: 24, dia: 30 }, target: {} });
  const il = two('interlock'), rb = two('rib');
  assert(Math.abs(rb.fabric.gsm / il.fabric.gsm - 1) < 0.01 && Math.abs(rb.fabric.width_open_in / il.fabric.width_open_in - 1) < 0.01, 'rib-gated interlock programme = measured interlock');
  assert(Math.abs(rb.fabric.cpc - il.fabric.cpc) < 0.2, 'face courses counted the same way');
  const run = (id, gsm, extra = {}) => { const t = T.find((x) => x.id === id); return S.analyse({ bed: t.bed, gating: t.gating, grid: t.grid, feeds: t.roles.map((r) => ({ role: r })), yarn: { fibre: 'cotton' }, target: { gsm }, machine: {}, ...extra }); };
  for (const id of ['swiss_double_pique', 'french_double_pique', 'gabardine_double', 'blister_single']) {
    const o = run(id, 270);
    assert(o.success && o.solver.verdict.level === 'ok', `${id} 270 GSM is reachable`);
    const ne = parseFloat(o.yarn.ground.count);
    assert(ne >= 20 && ne <= 40, `${id}: ${ne}s is a count double piqué is knitted with`);
  }
  // plush terry and velour: two yarns plated per feed, weighed by the plush model
  const tf = run('terry_fabric', 400);
  assert(tf.success && tf.plush && Math.abs(tf.fabric.gsm / 400 - 1) < 0.03, 'terry reaches its weight');
  const g = parseFloat(tf.yarn.ground.count);
  assert(g >= 20 && g <= 40, `terry ground ${g}s, not a 60s`);
  assert(tf.yarn.feeds.length === 2 && tf.yarn.feeds.some((f) => f.role === 'pile'), 'ground and pile both listed');
  assert(!tf.checks.some((c) => c.level === 'warn' && /Tightness factor/.test(c.text)), 'no single-yarn tightness window on a plated plush loop');
  const ve = run('velour_plush', 320, { plush: { cut: true } });
  assert(ve.success && ve.plush.shearing && ve.plush.variant.cut, 'velour is sheared');
  // pointelle: eyelets are transfers, not misses — no track error, and the rules of a transfer are checked
  for (const id of ['pointelle_chevron', 'pointelle_diagonal']) {
    const o = run(id, 130);
    assert(o.success && !o.checks.some((c) => c.level === 'error'), `${id} knits on a pointelle machine`);
    assert(o.structure.match && o.structure.match.id === id);
  }
  const bad = S.analyse({ bed: 'single', grid: { C: ['KE-', 'KKK'] }, feeds: [{}, {}], yarn: { ne: 30, fibre: 'cotton' }, target: { gsm: 140 }, machine: {} });
  assert(bad.checks.some((c) => c.level === 'error' && /transferred loop goes onto needle 3/.test(c.text)), 'a transfer needs a needle to take the loop');
}

// single-bed miss: the one measured pair (same yarn, same 3.0 mm loop:
// jersey 163, 1×1 cross miss 170.7 GSM finished) is reproduced, and the
// result stays an estimate with a wide range
{
  const run = (C) => S.analyse({ bed: 'single', grid: { C }, feeds: C.map(() => ({})), yarn: { ne: 30, fibre: 'cotton' }, machine: { sl_mm: 3.0, gauge: 24, dia: 30 }, target: {} });
  const sj = run(['K']), cm = run(['KM', 'MK']);
  assert(Math.abs(cm.fabric.gsm / sj.fabric.gsm - 170.7 / 163) < 0.01, 'cross miss : jersey weight as measured');
  assert.strictEqual(cm.structure.confidence.level, 'estimate');
  assert(cm.fabric.gsm_range[1] - cm.fabric.gsm_range[0] > 2.5 * (sj.fabric.gsm_range[1] - sj.fabric.gsm_range[0]), 'range wider than a measured fabric');
}

console.log('Fabric studio tests passed');
