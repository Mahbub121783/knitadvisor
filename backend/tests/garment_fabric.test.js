// Fabric physics (G5) and garment details (G6): a cloth that gives differently across and along, a fit map, cloth on cloth, creases, patches, trims.
'use strict';
const assert = require('assert');
const path = require('path');
const FE = path.join(__dirname, '..', '..', 'frontend', 'assets', 'js');
const Sim = require(path.join(FE, 'garment-sim.js'));
const Doc = require(path.join(FE, 'garment-doc.js'));
const Pat = require(path.join(FE, 'garment-pattern.js'));

console.log('--- Running Fabric And Details Tests ---');
const mk = (doc) => { const b = Sim.fromDoc(doc), c = new Sim.Cloth(b.insts, b.body, Object.assign({}, Sim.DRAPE.medium, b.opt)); return { b, c }; };
const run = (doc, steps) => { const r = mk(doc); r.c.run(steps); return r; };
const skirt = (w, fam, gsm) => { const P = Pat.create('s'); P.fabric = { gsm: gsm || 180 }; if (fam) P.fabric.family = fam; const p = Pat.rect(P, 0, 0, w, 40, 'Skirt', { arr: { mode: 'wrap', top: 108 } }); p.edges[0].hold = true; Pat.sew(P, { piece: p.id, eid: p.edges[1].id }, { piece: p.id, eid: p.edges[3].id }); return P; };

{
  // a cloth gives differently across and along, and most on the diagonal
  const J = Sim.fabricParams({}, 'jersey'), W = Sim.fabricParams({}, 'woven'); assert(J.x > J.y && J.x > W.x * 5, 'a jersey gives much more than a woven, and more across than along');
  assert(Sim.fabricParams({}, 'nothing') === null, 'an unknown family is no family');
  const P = skirt(80, 'jersey'), { c, b } = mk(Pat.toDoc(P)); let hx = 0, hy = 0, dg = 0, nx = 0, ny = 0, nd = 0;
  const it = b.insts[0];
  for (let e = 0; e < c.er.length; e++) { const a = it.mesh.pts[c.es[2 * e]], q = it.mesh.pts[c.es[2 * e + 1]], dx = Math.abs(q[0] - a[0]), dy = Math.abs(q[1] - a[1]), l = Math.hypot(dx, dy);
    if (dy / l < 0.05) { hx += c.em[e]; nx++; } else if (dx / l < 0.05) { hy += c.em[e]; ny++; } else if (dx / l > 0.4 && dx / l < 0.6) { dg += c.em[e]; nd++; } }
  hx /= nx; hy /= ny; dg /= nd; assert(Math.abs(hx - J.x) < 0.02, `across: ${hx}`); assert(Math.abs(hy - J.y) < 0.02, `along: ${hy}`); assert(dg > hy && dg < hx * 1.05, `diagonal sits between: ${dg}`);
  console.log(`✓ a jersey gives ${(hx * 100).toFixed(0)} % across, ${(hy * 100).toFixed(0)} % along, ${(dg * 100).toFixed(0)} % on the diagonal; a woven gives ${(W.x * 100).toFixed(0)} %`);
}
{
  // a skirt too small for the body: a knit gives and closes, a woven cannot; the fit map says so
  const J = run(Pat.toDoc(skirt(66, 'jersey')), 200), Wv = run(Pat.toDoc(skirt(66, 'woven')), 200), sj = J.c.stats(), sw = Wv.c.stats();
  assert(J.c.X.every(Number.isFinite) && Wv.c.X.every(Number.isFinite), 'no NaN'); assert(sj.seam_gap < sw.seam_gap, `the knit closes more: ${sj.seam_gap.toFixed(2)} vs ${sw.seam_gap.toFixed(2)}`);
  const fj = J.c.fitReport(), fw = Wv.c.fitReport(); assert(fw.tight_pct > fj.tight_pct, `the woven is tighter: ${fw.tight_pct.toFixed(1)} vs ${fj.tight_pct.toFixed(1)} %`); assert(J.c.stress().length === J.c.N && J.c.stress().every(Number.isFinite), 'a stress for every point');
  assert(fw.worst > 0 && Array.isArray(fw.at) && fw.piece, 'the report says where');
  console.log(`✓ a skirt too small: jersey seam ${sj.seam_gap.toFixed(1)} cm, ${fj.tight_pct.toFixed(0)} % near its limit; woven seam ${sw.seam_gap.toFixed(1)} cm, ${fw.tight_pct.toFixed(0)} % near its limit`);
}
{
  // heavier cloth: stiffer and thicker; the family sets the physics only when one is chosen (old documents keep what they had)
  const a = Sim.physics({ gsm: 120 }), b = Sim.physics({ gsm: 400 }); assert(b.bend > a.bend && b.thick > a.thick, 'heavier is stiffer and thicker'); assert(Sim.physics({}) === null);
  assert(Sim.fromDoc(Pat.toDoc(skirt(80, null))).opt.thick === undefined, 'no family: the old thickness'); assert(Sim.fromDoc(Pat.toDoc(skirt(80, 'jersey', 300))).opt.thick > 0.5, 'a family: the thickness follows the weight');
  console.log('✓ weight sets bending and thickness; a document with no family keeps its old behaviour');
}
{
  // a crease holds the cloth folded; a pleat is two of them
  const flat = skirt(80, 'woven'), fold = skirt(80, 'woven'); Pat.addPleat(fold.pieces[0], 20, 6, 40);
  const df = Pat.toDoc(flat), dd = Pat.toDoc(fold); assert(dd.pieces[0].folds.length === 2 && !df.pieces[0].folds, 'the creases are in the document'); assert(dd.sim.selfCollide === true, 'a folded cloth collides with itself');
  assert.deepStrictEqual(Doc.validate(dd), []);
  const a = mk(df), b = mk(dd), rest = (c) => { let s = 0; for (let i = 0; i < c.br.length; i++) s += c.br[i]; return s; }; assert(rest(b.c) < rest(a.c) * 0.999, 'the bending springs across a crease are shortened');
  b.c.run(60); assert(b.c.X.every(Number.isFinite), 'a folded cloth does not blow up');
  console.log('✓ creases and pleats: written into the document, shortened across the fold, the cloth stays finite');
}
{
  // a pocket: a patch sewn down on three edges to the piece below; cloth against cloth keeps the two layers apart
  const P = skirt(84, 'woven', 240), sk = P.pieces[0], pk = Pat.rect(P, 0, 0, 12, 14, 'Pocket', { arr: { mode: 'patch', on: sk.id, x: 36, y: 14 } });
  pk.edges[1].attach = pk.edges[2].attach = pk.edges[3].attach = true; pk.edges[1].topstitch = true; Pat.addButton(pk, 6, 3, 0.7);
  const doc = Pat.toDoc(P); assert.deepStrictEqual(Doc.validate(doc), []); assert(doc.stitches.length >= 8, `a stitch every 2 cm: ${doc.stitches.length}`); assert(doc.stitches.every((t) => t.b[1] === null), 'stitched to points inside the piece below');
  assert(doc.trims.length === 1 && doc.topstitch.length === 1, 'the button and the topstitch are in the document'); assert(doc.sim.selfCollide === true);
  const { c, b } = run(doc, 160); assert(c.X.every(Number.isFinite), 'no NaN'); const po = b.insts[1].off, pn = b.insts[1].mesh.pts.length, sn = b.insts[0].mesh.pts.length; let worst = 1e9, far = 0;
  for (let i = 0; i < pn; i++) { let d = 1e9; for (let j = 0; j < sn; j++) d = Math.min(d, Math.hypot(c.X[3 * (po + i)] - c.X[3 * j], c.X[3 * (po + i) + 1] - c.X[3 * j + 1], c.X[3 * (po + i) + 2] - c.X[3 * j + 2])); worst = Math.min(worst, d); far = Math.max(far, d); }
  assert(worst > 0.25, `the pocket does not go through the cloth: ${worst.toFixed(2)}`); assert(far < 6, `the pocket stays on the cloth: ${far.toFixed(2)}`);
  assert(b.trims.length === 1 && Number.isInteger(b.trims[0].v), 'the button is placed on a point of the cloth');
  const bs = c.bk, top = Math.max(...bs), base = Math.min(...bs); assert(top > base * 2.5, 'a topstitched edge bends less');
  console.log(`✓ a pocket sewn on 3 edges: ${doc.stitches.length} stitches, ${worst.toFixed(2)} cm from the cloth at the closest, ${far.toFixed(2)} at the furthest; button and topstitch placed`);
}
{
  // a zip is a seam that is drawn as teeth and held; the document says which seam
  const P = Pat.create('z'), f = Pat.rect(P, 0, 0, 30, 40, 'L', { arr: { mode: 'front', top: 120 } }), g = Pat.rect(P, 40, 0, 30, 40, 'R', { arr: { mode: 'front', top: 120 } });
  const s = Pat.sew(P, { piece: f.id, eid: f.edges[1].id }, { piece: g.id, eid: g.edges[3].id }); Pat.setZip(P, s.id, true); const doc = Pat.toDoc(P); assert(doc.seams[0].zip === true, 'the seam is a zip'); const b = Sim.fromDoc(doc); assert(b.zips.length === 1 && b.zips[0].length > 5, 'the zip has points to draw teeth along');
  // a point-to-point tack inside two pieces
  Pat.tack(P, { piece: f.id, x: 15, y: 20 }, { piece: g.id, x: 15, y: 20 }); const d2 = Pat.toDoc(P); assert(d2.stitches.some((t) => t.a[1] === null), 'a tack is a stitch between inside points'); assert.deepStrictEqual(Doc.validate(d2), []);
  console.log('✓ a zip is a marked seam with its points; a tack holds two inside points');
}
{
  // the cloth's own numbers win over the family's: stretch, bending length, friction, thickness
  const P = skirt(84, 'jersey', 200); P.fabric.stretch = { x: 0.5, y: 0.1 }; P.fabric.bend_len = 3.2; P.fabric.friction = 0.3; P.fabric.thick_mm = 0.6;
  const doc = Pat.toDoc(P); assert(doc.fabric.stretch.x === 0.5 && doc.fabric.bend_len === 3.2 && doc.fabric.friction === 0.3, 'they are in the document'); const b = Sim.fromDoc(doc);
  assert(Math.abs(b.opt.friction - 0.3) < 1e-9, 'the friction is the measured one'); assert(b.opt.thick > 0.3 && b.opt.thick < 0.9, 'and the thickness follows the measured one: ' + b.opt.thick);
  const stiff = Sim.fromDoc(Object.assign({}, doc, { fabric: Object.assign({}, doc.fabric, { bend_len: 4.5 }) })).opt.bend, soft = Sim.fromDoc(Object.assign({}, doc, { fabric: Object.assign({}, doc.fabric, { bend_len: 1.8 }) })).opt.bend;
  assert(stiff > b.opt.bend * 2 && b.opt.bend > soft * 3, `a longer bending length is a stiffer cloth: ${soft.toFixed(4)} < ${b.opt.bend.toFixed(4)} < ${stiff.toFixed(4)}`);
  const c = new Sim.Cloth(b.insts, b.body, Object.assign({}, Sim.DRAPE.medium, b.opt)), it = b.insts[0]; let hx = 0, nx = 0, hy = 0, ny = 0;
  for (let e = 0; e < c.er.length; e++) { const a = it.mesh.pts[c.es[2 * e]], q = it.mesh.pts[c.es[2 * e + 1]], dx = Math.abs(q[0] - a[0]), dy = Math.abs(q[1] - a[1]); if (dy < 0.05 * dx) { hx += c.em[e]; nx++; } else if (dx < 0.05 * dy) { hy += c.em[e]; ny++; } }
  assert(Math.abs(hx / nx - 0.5) < 0.02, 'across: the measured 50 %: ' + hx / nx); const w0 = Pat.toDoc(skirt(84, 'jersey', 200)); assert(Sim.fromDoc(w0).opt.friction === 0.12 && Sim.fromDoc(Pat.toDoc(skirt(84, null, 200))).opt.thick === undefined, 'without them, what the family and the weight say');
  const only = Pat.create('o'); only.fabric = { gsm: 180, stretch: { x: 0.4 } }; Pat.rect(only, 0, 0, 80, 40, 'S', { arr: { mode: 'wrap', top: 108 } }); const bo = Sim.fromDoc(Pat.toDoc(only)); assert(bo.insts[0].fab && bo.insts[0].fab.x === 0.4, 'a cloth with only its stretch measured is still a cloth');
  console.log('✓ measured numbers (stretch across, bending length, friction, thickness) replace the typical ones of the family; a longer bending length is a stiffer cloth');
}
{
  // a real pleat: cloth folded away, three layers kept apart, the placement narrower by what the folds take; gathers stand out as waves
  const flat = skirt(116, 'woven', 200), pl = skirt(116, 'woven', 200); Pat.addPleatSet(pl.pieces[0], 10, 106, 3, 4, false);
  const rw = Pat.arrangeReport(flat)[0], dd = Pat.toDoc(pl); assert(dd.pieces[0].folds.length === 6 && dd.sim.selfCollide, 'two folds for each pleat, and the cloth collides with itself');
  const xf = Pat.pleatXform(pl.pieces[0].pleats), a0 = xf(0), a1 = xf(116); assert(a0.p === 0 && Math.abs(a1.p - (116 - 24)) < 1e-9, 'the folds take up 2 x depth each of cloth: ' + a1.p); const bb = Pat.bbox(Pat.flatten(pl.pieces[0]).poly);
  const m = Pat.mapFor(pl, pl.pieces[0]), s0 = pl.pieces[0].pleats[0], q = (sOff) => m(s0.x - bb.x0 + sOff, 20), L0 = q(0.5), L1 = q(2 * s0.depth - 0.5), L2 = q(2 * s0.depth + 0.5), rad = (v) => Math.hypot(v[0], v[2]);
  assert(Math.abs(rad(L0) - rad(L1)) > 0.6 && Math.abs(rad(L1) - rad(L2)) > 0.6, 'the three layers of a pleat, at the same place across, are apart: ' + [rad(L0), rad(L1), rad(L2)].map((v) => v.toFixed(2)));
  const c = run(dd, 120).c, st = c.stats(); assert(c.X.every(Number.isFinite), 'no NaN'); assert(st.seam_gap < 4, `a pleated skirt closes: ${st.seam_gap.toFixed(2)}`);
  // the stack of one pleat stays about a depth wide: the points that began in the first pleat, round the body
  const it0 = Sim.fromDoc(dd).insts[0]; let mn = 1e9, mx = -1e9; it0.mesh.pts.forEach((p, i) => { if (p[0] >= s0.x - bb.x0 + 0.2 && p[0] <= s0.x - bb.x0 + 3 * s0.depth - 0.2 && p[1] > 10 && p[1] < 30) { const o = 3 * i, ph = Math.atan2(c.X[o], c.X[o + 2]); mn = Math.min(mn, ph); mx = Math.max(mx, ph); } });
  const span = (mx - mn) * 15; assert(span < 2.4 * s0.depth, `the pleat stays folded (${span.toFixed(1)} cm wide for ${3 * s0.depth} cm of cloth)`);
  const g = skirt(110, 'jersey', 160); g.pieces[0].edges[0].gather = true; const dg = Pat.toDoc(g), mg = Pat.mapFor(g, g.pieces[0]); const radial = []; for (let x = 0; x < 110; x += 1) radial.push(Math.hypot(...[mg(x, 0.4)[0], mg(x, 0.4)[2]])); const mean = radial.reduce((t, v) => t + v, 0) / radial.length, sd = Math.sqrt(radial.reduce((t, v) => t + (v - mean) ** 2, 0) / radial.length);
  const plain = Pat.mapFor(skirt(110, 'jersey', 160), skirt(110, 'jersey', 160).pieces[0]); assert(sd > 0.5, `a gathered edge stands out in waves: ${sd.toFixed(2)} cm`); assert.deepStrictEqual(Doc.validate(dg), []); const cg = run(dg, 100).c; assert(cg.X.every(Number.isFinite), 'a gathered skirt does not blow up');
  console.log(`✓ pleats are real folds (layers ${[rad(L0), rad(L1), rad(L2)].map((v) => v.toFixed(1)).join('/')} cm from the axis, the folded stack ${span.toFixed(1)} cm wide for ${3 * s0.depth} cm of cloth); a gathered edge stands out in waves (${sd.toFixed(2)} cm)`);
}
console.log('Fabric and details tests passed');
