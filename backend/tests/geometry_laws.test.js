// Part 6 v0 — brick laws: learned from the first floors only, judged on the families they never saw.
const assert = require('assert');
console.log('--- Running Geometry Laws (Part 6) Tests ---');
const GL = require('../engine/domain/geometry-laws');
const G = require('../engine/domain/stitch-graph');
const F = require('../engine/domain/fabric-studio');
const FS = require('../tools/floor-skip');

const graphOf = (id, feedsOver) => { const t = F.listTemplates().find((x) => x.id === id); return G.fromDesign({ grid: t.grid, gating: t.gating, feeds: t.roles.map((role, i) => ({ role, ...((feedsOver || [])[i] || {}) })) }); };

// 1. the stitch graph knows which feeders form one course: a binder with its face feeder plated into the same loops
const fl = graphOf('fleece_3_thread');
assert.strictEqual(fl.period.fabric_courses, 4, 'binder + face are one course, the two loop-yarn feeds their own');
const L0 = fl.loops.find((L) => L.id === 'C0@0');
assert.deepStrictEqual(L0.yarns, ['F1', 'F2'], 'the face yarn is plated into the binder\'s loop');
assert.strictEqual(fl.feeds[1].joins_previous, true); assert.strictEqual(fl.feeds[1].said, false, 'decided by the roles, automatically');
const said = graphOf('fleece_3_thread', [{}, { course: 'new' }, {}, {}, { course: 'new' }, {}]);
assert.strictEqual(said.period.fabric_courses, 6, 'the designer can say otherwise, and is followed');
const plain = G.fromDesign({ grid: { C: ['K', 'K'] }, feeds: [{}, {}] });
assert.strictEqual(plain.period.fabric_courses, 2, 'two ordinary feeders knitting the same needles are two courses');
assert.strictEqual(G.fromDesign({ grid: { C: ['K', 'K'] }, feeds: [{}, { course: 'same' }] }).period.fabric_courses, 1);

// 2. the laws: jersey is its own cell; interlock is one wale wide with one loop per repeat; rib two wales collapsed
const K = GL.calibrate([{ kind: 'jersey', w_l: 0.263, H_l: 0.193 }, { kind: 'rib', w_l: 0.346, H_l: 0.215 }, { kind: 'jersey+L', w_l: 0.227, H_l: 0.152 }]);
assert(Math.abs(K.phi_rib - 0.346 / (2 * 0.263)) < 1e-9);
const cJ = GL.cell(graphOf('single_jersey'), K);
assert(Math.abs(cJ.w_l - 0.263) < 1e-9 && Math.abs(cJ.H_rep_l - 0.193) < 1e-9);
const cI = GL.cell(graphOf('interlock'), K);
assert(Math.abs(cI.w_l - 0.263) < 1e-9 && Math.abs(cI.H_rep_l - 0.193) < 1e-9, 'interlock: one wale wide, one loop high per two feeds');
assert(cI.laws.some((x) => /face to face/.test(x)));
const cR = GL.cell(graphOf('rib_1x1'), K);
assert(Math.abs(cR.w_l - 0.346) < 1e-9, 'rib is what it was learned from');
assert(GL.cell(graphOf('pique_single'), K).missing.some((m) => /tuck/.test(m)), 'without a piqué taught, the tuck is said to be missing');
// needle out: a slot as wide as its wales — 2×2 rib (two needles of three) from the 1×1 collapse
const c22 = GL.cell(graphOf('rib_2x2'), K);
assert(Math.abs(c22.w_l - (4 / 3) * 0.263 * K.phi_rib) < 1e-9 && c22.laws.some((x) => /needle out/.test(x)));
// the tuck law, learned from piqué: spreads the wale, shortens the loop; a loop yarn's tucks are not counted; a double bed is said
const Kt = GL.calibrate([{ kind: 'jersey', w_l: 0.263, H_l: 0.193 }, { kind: 'rib', w_l: 0.346, H_l: 0.215 }, { kind: 'pique', w_l: 0.342, H_l: 0.166, tucks_per_knit: 1 / 3 }]);
assert(Math.abs(Kt.tuck.kappa - (0.342 / 0.263 - 1) * 3) < 1e-9 && Kt.tuck.lambda > 0);
const cL = GL.cell(graphOf('lacoste_single'), Kt);
assert(Math.abs(cL.w_l - 0.342) < 1e-6 && Math.abs(cL.H_rep_l / GL.featuresOf(graphOf('lacoste_single')).loops_per_wale - 0.166) < 1e-6, 'piqué is what it was learned from');
assert.strictEqual(GL.featuresOf(graphOf('fleece_3_thread')).ground_tucks_per_knit, 0, "a loop yarn's tucks tie its float in: not a ground tuck");
assert(GL.cell(graphOf('waffle_knit'), Kt).missing.some((m) => /double bed/.test(m)), 'a tuck on a double bed has no law yet, and says so');
assert(GL.cell(graphOf('rib_1x1'), { w0: 0.263, h0: 0.193, phi_rib: null, elastane: null }).missing.some((m) => /rib collapse/.test(m)));
const cE = GL.cell(graphOf('single_jersey'), K, { elastane: true });
assert(Math.abs(cE.w_l - 0.227) < 1e-9);
assert.throws(() => GL.calibrate([{ kind: 'rib', w_l: 0.3, H_l: 0.2 }]), /jersey/);

// 3. the yardstick: taught jersey + rib only, the laws must keep what they won on the families never shown
const s = FS.lawsScenario(['single_jersey', 'rib']).families;
assert(s.interlock.gsm_err_med < 0.12, `interlock GSM ${s.interlock.gsm_err_med} (the Studio without its interlock table: 46 %)`);
assert(s['fleece+L'].gsm_err_med < 0.12, `fleece with elastane GSM ${s['fleece+L'].gsm_err_med}`);
assert(s.waffle.width_err_med < 0.2, `waffle width ${s.waffle.width_err_med}`);
assert(s.heavy_jersey.gsm_err_med < 0.08);
console.log('Geometry laws tests passed');

// 4. the second opinion on a Studio answer: agrees on what the laws were learned from, says "incomplete" where a brick
//    has no law, and names no outside source — nor does the rest of the Studio's answer
{
  const SO = require('../engine/domain/second-opinion');
  const run = (id) => { const t = F.listTemplates().find((x) => x.id === id); const input = { bed: t.bed, gating: t.gating, grid: t.grid, feeds: t.roles.map((r) => ({ role: r })), yarn: { count: 30, unit: 'ne', fibre: 'cotton' }, machine: { gauge: 24, dia: 30, sl_mm: 2.7 }, target: {} }; const o = F.analyse(input); o.fabric.second_opinion = SO.forDesign(input, o); return o; };
  assert.strictEqual(run('single_jersey').fabric.second_opinion.status, 'agrees');
  assert.strictEqual(run('rib_1x1').fabric.second_opinion.status, 'agrees');
  const fl = run('fleece_3_thread').fabric.second_opinion;
  assert.strictEqual(fl.status, 'incomplete'); assert(fl.missing.some((m) => /float/.test(m)));
  const il = run('interlock').fabric.second_opinion;
  assert(il.laws.some((x) => /face to face/.test(x)) && Math.abs(il.diff_gsm_pct) < 15);
  for (const id of ['single_jersey', 'interlock', 'fleece_3_thread', 'pique_single', 'rib_2x2']) {
    assert(!/Munden|Postle|Hearle|Morton|Spencer|Peirce|textilelearner|http/i.test(JSON.stringify(run(id))), `${id}: no outside source in the Studio's answer`);
  }
}
console.log('Second opinion checks passed');
