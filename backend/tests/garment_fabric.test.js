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
console.log('Fabric and details tests passed');
