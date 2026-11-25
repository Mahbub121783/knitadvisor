// Arrangement: where each piece first hangs on the body. A limb piece starts clear of the torso, a piece too narrow for the body says so (and can be fitted),
// and the solver finds, for a scrambled garment, the places its seams want.
'use strict';
const assert = require('assert');
const path = require('path');
const FE = path.join(__dirname, '..', '..', 'frontend', 'assets', 'js');
const Sim = require(path.join(FE, 'garment-sim.js'));
const Doc = require(path.join(FE, 'garment-doc.js'));
const Pat = require(path.join(FE, 'garment-pattern.js'));
const Tpl = require(path.join(FE, 'garment-templates.js'));

console.log('--- Running Arrangement Tests ---');
const run = (doc, steps) => { const b = Sim.fromDoc(doc), c = new Sim.Cloth(b.insts, b.body, Object.assign({}, Sim.DRAPE.medium, b.opt)); c.run(steps); return c; };
const gaps = (c) => { const g = []; for (let e = 0; e < c.ss.length; e += 2) { const a = 3 * c.ss[e], b = 3 * c.ss[e + 1]; g.push(Math.hypot(c.X[a] - c.X[b], c.X[a + 1] - c.X[b + 1], c.X[a + 2] - c.X[b + 2])); } g.sort((x, y) => x - y); return { mean: g.reduce((t, v) => t + v, 0) / g.length, p95: g[Math.floor(g.length * 0.95)] }; };
const scramble = (P) => P.pieces.forEach((p) => { if (p.arr.mode !== 'patch') p.arr = Object.assign({ mode: 'wrap', top: 100 }, p.arr.arc ? { arc: p.arr.arc } : {}); });
const where = (P) => P.pieces.map((p) => p.name + ':' + p.arr.mode);

{
  // a limb piece starts clear of the rest of the body, wherever on the limb it has to start
  const P = Pat.create('sleeve'); P.body = { preset: 'female' }; const p = Pat.rect(P, 0, 0, 37, 40, 'Tube', { arr: { mode: 'armL', auto: true } }); p.edges[0].hold = true; Pat.sew(P, { piece: p.id, eid: p.edges[1].id }, { piece: p.id, eid: p.edges[3].id });
  const d = Pat.bodyDesc(P), local = Pat.flatten(p).poly.map(([x, y]) => [x, y]), along = Pat.autoAlong(d, p.arr, local, 0); assert(along > 0 && along < 30, 'it starts down the arm: ' + along);
  const rest = Sim.avatar({ top: d.top, loft: d.loft, caps: d.caps.filter((c) => !d.limbs.armL.some((q) => Math.hypot(c.A[0] - q[0], c.A[1] - q[1]) < 1e-3 || Math.hypot(c.B[0] - q[0], c.B[1] - q[1]) < 1e-3)), spheres: d.spheres }), map = Pat.mapFor(P, p), pt = map(0, 0); assert(rest.sdf(pt[0], pt[1], pt[2]) > 0.3, 'the top row is outside the torso');
  const doc = Pat.toDoc(P); assert.deepStrictEqual(Doc.validate(doc), []); const c = run(doc, 120), s = c.stats(); assert(c.X.every(Number.isFinite), 'no NaN'); assert(s.inside_body > -1.5, `a sleeve that finds its own start stays out of the body: ${s.inside_body.toFixed(2)}`);
  console.log(`✓ a limb piece with no start given finds one (${along} cm down the arm) and drapes without going into the body (${s.inside_body.toFixed(2)} cm)`);
}
{
  // too narrow for the body: it says so, by how much, and what the cloth gives; a piece can be fitted to the body
  const mk = (fam) => { const P = Pat.create('s'); P.fabric = { gsm: 200, family: fam }; const p = Pat.rect(P, 0, 0, 75, 50, 'Skirt', { arr: { mode: 'wrap', top: 108 } }); p.edges[0].hold = true; Pat.sew(P, { piece: p.id, eid: p.edges[1].id }, { piece: p.id, eid: p.edges[3].id }); return P; };
  const W = mk('woven'), J = mk('jersey'), rw = Pat.arrangeReport(W)[0], rj = Pat.arrangeReport(J)[0];
  assert(rw.status === 'narrow' && rw.short_cm > 8 && /does not stretch|gives 3 %/.test(rw.note), 'a woven skirt too small says so: ' + rw.note); assert(rj.status === 'ok', 'a jersey one of the same size is fine, it gives: ' + rj.note);
  const r = Pat.fitToBody(W, W.pieces[0].id, 2); assert(r && r.to > r.from, 'fitted: ' + JSON.stringify(r)); const after = Pat.arrangeReport(W)[0]; assert(after.status !== 'narrow', 'and it fits after: ' + after.note);
  const c = run(Pat.toDoc(W), 150), st = c.stats(); assert(st.seam_gap < 3, `the fitted woven skirt closes: ${st.seam_gap.toFixed(2)}`);
  const wide = Pat.create('w'); wide.fabric = { gsm: 150, family: 'jersey' }; Pat.rect(wide, 0, 0, 200, 50, 'Big', { arr: { mode: 'wrap', top: 108 } }); assert(Pat.arrangeReport(wide)[0].status === 'wide', 'a piece far wider than the body says so');
  console.log(`✓ the report names a piece too narrow (${rw.short_cm.toFixed(1)} cm short, woven) and one that gives enough (jersey), fitting widens it ${r.from} → ${r.to} cm and it then closes`);
}
{
  // the solver: scramble every piece of a garment and it finds where each hangs
  const cases = { tee: ['Back:back', 'Front:front', 'Sleeve (left arm):armL', 'Sleeve (right arm):armR'], shirt: ['Back:back', 'Front:front', 'Sleeve (left arm):armL', 'Sleeve (right arm):armR'], jacket: ['Back:back', 'Front right:front', 'Front left:front', 'Sleeve (left arm):armL', 'Sleeve (right arm):armR'], dress: ['Back:back', 'Front:front'], hoodie: ['Back:back', 'Front:front', 'Sleeve (left arm):armL', 'Sleeve (right arm):armR', 'Pocket:patch'], pant: ['Left leg:legL', 'Right leg:legR'] };
  Object.keys(cases).forEach((k) => { const P = Tpl.build(k, {}); scramble(P); const t = Date.now(); const r = Pat.arrange(P); assert.deepStrictEqual(where(P), cases[k], k + ' is found: ' + where(P).join(', ') + ' (' + (Date.now() - t) + ' ms)'); assert(r.report.every((x) => x.status === 'ok' || x.status === 'wide'), k + ' fits: ' + r.report.map((x) => x.piece + ' ' + x.status).join(', ')); });
  const S = Tpl.build('skirt', {}); scramble(S); Pat.arrange(S); assert(Math.abs(S.pieces[0].arr.top - Pat.bodyDesc(S).anchors.waist) < 4, 'a skirt held at the top finds the waist: ' + S.pieces[0].arr.top);
  console.log('✓ scrambled, the solver finds every piece of a tee, shirt, zip jacket, dress, pullover (pocket stays on) and trousers, and puts a skirt at the waist');
}
{
  // no hints in the names: front and back may come out either way round, but the pair is a pair and the garment drapes
  const P = Tpl.build('tee', {}); P.pieces.forEach((p) => { p.name = p.name === 'Front' ? 'Piece A' : p.name === 'Back' ? 'Piece B' : p.name.replace(/left|right/, 'X'); }); scramble(P); Pat.arrange(P);
  const m = P.pieces.map((p) => p.arr.mode); assert(new Set(m.slice(0, 2)).size === 2 && m.slice(0, 2).every((x) => x === 'front' || x === 'back'), 'a front and a back: ' + m); assert(m.slice(2).some((x) => x === 'armL') && m.slice(2).some((x) => x === 'armR'), 'two arms: ' + m);
  const c = run(Pat.toDoc(P), 110), g = gaps(c), st = c.stats(); assert(c.X.every(Number.isFinite)); assert(g.mean < 3.5 && st.inside_body > -2, `the solved tee drapes: mean gap ${g.mean.toFixed(2)}, inside ${st.inside_body.toFixed(2)}`);
  console.log(`✓ with no hints in the names the solver still finds a front and a back and two arms, and the tee drapes (mean gap ${g.mean.toFixed(2)} cm)`);
}
{
  // the map the editor shows while a piece is dragged is the map the document is made with
  const P = Tpl.build('tee', {}), p = P.pieces[0], doc = Pat.toDoc(P), pl = doc.pieces[0].placement, map = Pat.mapFor(P, p), q = doc.pieces[0].poly[5], f = Sim.gridMap(pl)(q[0], q[1]), m = map(q[0], q[1]);
  assert(Math.hypot(f[0] - m[0], f[1] - m[1], f[2] - m[2]) < 0.8, 'the live map and the document agree: ' + JSON.stringify([f, m]));
  const H = Tpl.build('hoodie', {}), pk = H.pieces.find((x) => x.name === 'Pocket'), dd = Pat.toDoc(H), dp = dd.pieces.find((x) => x.name === 'Pocket'), qq = dp.poly[2], ff = Sim.gridMap(dp.placement)(qq[0], qq[1]), mm = Pat.mapFor(H, pk)(qq[0], qq[1]); assert(Math.hypot(ff[0] - mm[0], ff[1] - mm[1], ff[2] - mm[2]) < 0.8, 'also for a patch');
  console.log('✓ the map used while a piece is being dragged is the one the document is made with (also for a patch)');
}
console.log('Arrangement tests passed');
