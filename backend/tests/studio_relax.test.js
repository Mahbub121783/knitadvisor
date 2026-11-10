// Fabric Studio: relaxation states and shrinkage (knit-relax.js) — the loop
// length is fixed by the machine; wales, courses, weight and width follow the
// state (Munden). Finished = the factory records; dry / wet / fully relaxed
// placed against them; residual shrinkage and the compaction that holds it.
const assert = require('assert');
const S = require('../engine/domain/fabric-studio');
const KR = require('../engine/domain/knit-relax');
console.log('--- Running Studio Relaxation Tests ---');

const T = S.listTemplates();
const rows = (g) => g.map((r) => (r.join ? r.join('') : r));
const run = (id, fibre, target, extra) => { const t = T.find((x) => x.id === id); return S.analyse({ bed: t.grid.D ? 'double' : 'single', gating: t.gating || 'rib', grid: { C: rows(t.grid.C), D: t.grid.D ? rows(t.grid.D) : null }, feeds: t.roles.map((role) => ({ role })), yarn: { fibre: fibre || 'cotton', ne: 30 }, target: { gsm: 180, ...(target || {}) }, machine: {}, ...(extra || {}) }); };

for (const id of ['single_jersey', 'lacoste_single', 'rib_1x1', 'interlock']) {
  const r = run(id);
  const R = r.fabric.relaxation;
  const st = Object.fromEntries(R.states.map((x) => [x.state, x]));
  // the finished state is the engine's own answer
  assert.strictEqual(st.finished.gsm, r.fabric.gsm, `${id}: finished = the solve`);
  // cotton packs closer the more it relaxes
  assert(st.dry.gsm < st.finished.gsm && st.finished.gsm < st.wet.gsm && st.wet.gsm < st.full.gsm, `${id}: dry < finished < wet < fully relaxed`);
  assert(st.full.width_in < st.finished.width_in && st.full.length_pct < 0, `${id}: it shrinks in width and length`);
  // residual shrinkage = what fully relaxing takes off the finished cloth
  const L = R.residual.length_pct;
  assert(L[0] <= L[1] && L[1] <= L[2]);
  assert(Math.abs(L[1] - (1 - st.finished.cpc / st.full.cpc) * 100) < 0.2, `${id}: residual length = 1 − cpc ratio`);
  // compaction to hold the limit: at the limit exactly
  assert(Math.abs(R.compaction.min_cpc - st.full.cpc * 0.95) < 0.02);
}
// fibre: polyester relaxes less than cotton, viscose more
const sh = (f) => run('single_jersey', f).fabric.relaxation.residual.length_pct[1];
assert(sh('polyester_spun') < sh('cotton') && sh('cotton') < sh('viscose'), 'fibre order');
// elastane (heat-set) relaxes less
assert(run('single_jersey', 'cotton', null, { elastane: { denier: 40, draft: 2.6, every: 'all' } }).fabric.relaxation.residual.length_pct[1] < sh('cotton'));
// a wider limit asks less of the compactor
assert(run('single_jersey', 'cotton', { shrinkage_pct: 8 }).fabric.relaxation.compaction.min_cpc < run('single_jersey', 'cotton', { shrinkage_pct: 5 }).fabric.relaxation.compaction.min_cpc);
// the residual shrinkage is in the checks
assert(run('single_jersey').checks.some((c) => /Residual shrinkage after home laundering/.test(c.text)));
// Munden: a state's wales per cm ∝ Kw, at the same loop length
{
  const r = run('single_jersey');
  const R = r.fabric.relaxation, st = Object.fromEntries(R.states.map((x) => [x.state, x]));
  const J = R.basis.match(/Kc ([\d.]+), Kw ([\d.]+)/);
  assert(Math.abs(st.full.wpc / st.finished.wpc - KR.LIT.full.kw / +J[2]) < 0.01, 'wpc ∝ Kw');
}
console.log('Studio relaxation tests passed');
