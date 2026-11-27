// The Studio picks yarns the way the mill floor knits that weight, answers every composition it is given, and shows the yarns to buy.
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const FS = require('../engine/domain/fabric-studio');
const KP = require('../engine/domain/knit-plan');

console.log('--- Running Studio Yarn-Plan Tests ---');
const T = FS.listTemplates();
function run(id, gsm, comp, yarn, more) {
  const t = T.find((x) => x.id === id);
  const C = t.grid.C.map((r) => r.slice()), D = t.grid.D ? t.grid.D.map((r) => r.slice()) : null;
  const w = Math.max(C[0].length, D ? D[0].length : 0), fit = (g) => g.map((r) => Array.from({ length: w }, (_, j) => r[j % r.length]));
  return FS.analyse({ bed: D ? 'double' : 'single', gating: t.gating === 'interlock' ? 'interlock' : 'rib', grid: { C: fit(C).map((r) => r.join('')), D: D ? fit(D).map((r) => r.join('')) : null },
    feeds: t.roles.map((r) => ({ role: r, plate: !!t.plated })), yarn: { fibre: 'cotton', type: 'auto', ply: t.ends || 1, ...(yarn || {}) }, yarns: {}, elastane: null,
    finish: { brush: /fleece/.test(t.id) ? 'back' : 'none' }, plush: { cut: t.id === 'velour_plush', arrangement: 'full' }, pile: 'auto', target: { gsm, composition: comp, shrinkage_pct: 5 }, machine: {}, ...(more || {}) });
}

{
  // what the floor does at a weight: counts fall and the gauge coarsens as the cloth gets heavier
  const a = KP.practiceAt('single_jersey', false, 150), b = KP.practiceAt('single_jersey', false, 180), c = KP.practiceAt('single_jersey', false, 240);
  assert(a.ne > b.ne && b.ne > c.ne, `counts fall with weight: ${a.ne} ${b.ne} ${c.ne}`);
  assert(b.g === 24 && c.g === 20, `gauge: ${b.g} then ${c.g}`);
  assert(KP.practiceAt('single_jersey', false, 600) === null, 'no records, no practice');
  console.log(`✓ floor practice by weight: ${a.ne.toFixed(0)}s at 150, ${b.ne.toFixed(0)}s on ${b.g} GG at 180, ${c.ne.toFixed(0)}s on ${c.g} GG at 240`);
}
{
  // the solved count stays near the floor's own count on the structures that were furthest from it
  const out = [];
  for (const [id, gsm, comp] of [['single_jersey', 250, '95% cotton 5% elastane'], ['pique_single', 260], ['french_terry', 340], ['fleece_2_thread', 310], ['rib_1x1', 225], ['interlock', 225], ['heavy_jersey', 260]]) {
    const r = run(id, gsm, comp, null, { use_model: false }), p = r.yarn_plan.practice;
    assert(r.success !== false && p, `${id} ${gsm}: answered with the floor practice`);
    const ne = r.solver.options[0].ne;
    assert(Math.abs(Math.log(ne / p.ne)) < Math.log(1.2), `${id} ${gsm}: ${ne}s against the floor's ${p.ne}s`);
    assert(Math.abs(r.machine.gauge - p.gauge) <= 2, `${id} ${gsm}: ${r.machine.gauge} GG against the floor's ${p.gauge}`);
    out.push(`${id} ${ne}s/${r.machine.gauge}GG`);
  }
  console.log('✓ solved counts and gauges keep to the floor: ' + out.join(', '));
}
if (require('../engine/domain/universal-model').model().ok) {
  // the loop model, where it answers: a heavier elastane jersey keeps a fine yarn on 24 GG (it draws in), counts fall with weight,
  // and the counts either side are offered beside its choice
  const at = (gsm) => run('single_jersey', gsm, '95% cotton 5% elastane');
  const [a, b, c] = [180, 215, 250].map(at);
  const ne = (r) => parseFloat(r.yarn.ground.count);
  assert([a, b, c].every((r) => r.recipe && r.recipe.model), 'the model answers');
  assert(ne(a) >= ne(b) && ne(b) >= ne(c) && ne(c) >= 24 && ne(c) <= 30 && c.machine.gauge === 24, `${ne(a)} ${ne(b)} ${ne(c)} on ${c.machine.gauge} GG`);
  assert(c.solver.options.length >= 3 && c.solver.options[0].ne === ne(c) && c.solver.options.every((o) => o.sl_mm > 0 && Math.abs(o.gsm - 250) <= 3), JSON.stringify(c.solver.options.map((o) => [o.ne, o.sl_mm, o.gsm])));
  console.log(`✓ loop model elastane jersey: ${ne(a)}s at 180, ${ne(b)}s at 215, ${ne(c)}s on ${c.machine.gauge} GG at 250; ${c.solver.options.length} counts offered`);
}
{
  // two plated yarns share one loop, so each is about twice as fine as the one-yarn count; a two-end design keeps its two ends
  const p = run('plated_jersey', 145);
  assert(p.solver.verdict.level === 'ok', 'a light plated jersey is knittable: ' + p.solver.verdict.text);
  assert(parseFloat(p.yarn.ground.count) >= 50, 'two fine yarns: ' + p.yarn.ground.count);
  const h = run('heavy_jersey', 300);
  assert(/^2\//.test(h.yarn.ground.count), 'two ends a feeder are kept in the solved count: ' + h.yarn.ground.count);
  console.log('✓ plated jersey ' + p.yarn.ground.count + ' + the same; heavy jersey ' + h.yarn.ground.count);
}
{
  // an automatic yarn type: carded when coarse, combed when fine
  assert(run('single_jersey', 150, '100% cotton').yarn.feeds[0].look.type === 'combed', 'fine: combed');
  assert(run('single_jersey', 150, '100% cotton', { type: 'auto', count: 16, unit: 'ne' }).yarn.feeds[0].look.type === 'carded', 'coarse: carded');
  console.log('✓ yarn type auto: carded at a coarse count, combed at a fine one');
}
{
  // terry and velour answer a composition, elastane and blends included
  for (const [id, gsm, comp] of [['terry_fabric', 300, '95% cotton 5% elastane'], ['velour_plush', 320, '60% cotton 40% polyester'], ['velour_plush', 250, '80% cotton 20% polyester'], ['terry_fabric', 400, '100% polyester']]) {
    const r = run(id, gsm, comp);
    assert(r.success !== false, `${id} ${comp}: ${r.error}`);
    assert(r.composition_solve.success && r.composition_solve.largest_miss_pts <= 3, `${id} ${comp}: missed ${r.composition_solve.largest_miss_pts}`);
  }
  console.log('✓ terry and velour hold a blend or an elastane composition inside 3 points');
}
{
  // the plan: every yarn with its share, fibres and who chose it; the elastane at a fine denier, as mills plate it
  const r = run('french_terry', 300, '95% cotton 5% elastane'), P = r.yarn_plan;
  const sum = P.rows.reduce((t, x) => t + x.share_pct, 0);
  assert(Math.abs(sum - 100) < 0.6, 'the shares add to 100: ' + sum);
  assert(['binder', 'face', 'loop', 'elastane'].every((k) => P.rows.some((x) => x.role === k)), 'roles: ' + P.rows.map((x) => x.role).join(', '));
  const el = P.rows.find((x) => x.role === 'elastane');
  assert(el.source === 'solved' && parseInt(el.count, 10) <= 40, 'elastane solved at 20-40 D: ' + el.count);
  assert(r.yarn.feeds.find((f) => f.role === 'loop').d_mm > 0, 'the assumed loop yarn has a diameter the views can draw');
  assert(P.practice && /cotton/.test(P.cloth), 'practice and cloth');
  const own = run('single_jersey', 180, undefined, { count: 30, unit: 'ne' });
  assert(own.yarn_plan.rows[0].source === 'yours' && own.yarn_plan.practice, 'your own count is marked yours, the floor practice still shown');
  for (const [id, comp] of [['single_jersey', '95% cotton 5% elastane'], ['rib_1x1', '95% cotton 5% elastane'], ['single_jersey', '92% modal 8% elastane']]) {
    const d = run(id, 200, comp).composition_solve.solved.elastane;
    assert(d.denier <= 40, `${id} ${comp}: ${d.denier} D`);
  }
  console.log('✓ the yarn plan lists every yarn with its share and source; elastane 20-40 D');
}
{
  const loops = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'assets', 'js', 'studio-loops.js'), 'utf8');
  assert(/const face = courseColour\(co\)/.test(loops), 'a plated back yarn takes its colour from its own course (it used an undefined name and the loop view stopped)');
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'assets', 'js', 'studio.js'), 'utf8');
  assert(/function renderPlan\(\)/.test(js) && /data-plan="auto"/.test(js), 'the yarn plan and its way back to automatic are in the page');
  console.log('✓ the loop view draws plated designs; the page shows the yarn plan');
}
console.log('Studio yarn-plan tests passed');
