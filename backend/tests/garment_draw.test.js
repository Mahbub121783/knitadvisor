// The free pattern (frontend/assets/js/garment-pattern.js): pieces drawn as outlines and curves, edited, sewn edge to edge, written as a garment document, and draped.
// Nothing in the module knows what a garment is.
'use strict';
const assert = require('assert');
const path = require('path');
const FE = path.join(__dirname, '..', '..', 'frontend', 'assets', 'js');
const Sim = require(path.join(FE, 'garment-sim.js'));
const Doc = require(path.join(FE, 'garment-doc.js'));
const Pat = require(path.join(FE, 'garment-pattern.js'));

console.log('--- Running Free Pattern Tests ---');
const near = (a, b, t, m) => assert(Math.abs(a - b) <= t, `${m}: ${a} vs ${b}`);
const run = (doc, steps) => { const b = Sim.fromDoc(doc), c = new Sim.Cloth(b.insts, b.body, Object.assign({}, Sim.DRAPE.medium, b.opt)); c.run(steps); return c; };

{
  const P = Pat.create(), r = Pat.rect(P, 0, 0, 20, 10, 'R'), e = Pat.ellipse(P, 50, 5, 10, 5, 'E');
  near(Math.abs(Pat.area(Pat.flatten(r).poly)), 200, 0.01, 'a rectangle'); near(Math.abs(Pat.area(Pat.flatten(e, 0.5).poly)), Math.PI * 50, 0.8, 'an ellipse made of four smooth points');
  assert(r.edges.length === 4 && new Set(r.edges.map((x) => x.id)).size === 4, 'every edge has its own id');
  const sh = Pat.shares(r); near(sh[0].len, 20, 1e-6, 'edge length'); near(sh[3].s1, 1, 1e-9, 'the last edge ends the outline'); near(sh[1].s0, 20 / 60, 1e-6, 'share where edge 1 starts');
  console.log('✓ a rectangle and an ellipse are outlines of the right size; every edge has its own id');
}
{
  // a point added on an edge splits it in two that both keep what the edge had (a label, held, sewn); a point taken away joins them again
  const P = Pat.create(), a = Pat.rect(P, 0, 0, 20, 10, 'A'), b = Pat.rect(P, 30, 0, 20, 10, 'B');
  a.edges[0].label = 'top'; a.edges[0].hold = true; Pat.sew(P, { piece: a.id, eid: a.edges[0].id }, { piece: b.id, eid: b.edges[0].id });
  const ni = Pat.addNode(P, a, 0, 0.25); assert(a.nodes.length === 5 && ni === 1, 'a point is added');
  assert(a.edges[0].label === 'top' && a.edges[1].label === 'top' && a.edges[1].hold, 'both halves keep the label and the hold');
  assert(P.seams[0].a.length === 2 && P.seams[0].a[1].eid === a.edges[1].id, 'the seam now holds both halves');
  near(Pat.edgeLen(a, 0), 5, 1e-6, 'the first half is a quarter'); near(Pat.area(Pat.flatten(a).poly), 200, 1e-6, 'the shape is the same');
  assert(Pat.removeNode(P, a, 1) && a.nodes.length === 4, 'a point is taken away'); near(Pat.edgeLen(a, 0), 20, 1e-6, 'the edge is whole again');
  assert(P.seams[0].a.length === 1, 'the seam no longer names the edge that is gone');
  const t = Pat.rect(P, 0, 0, 5, 5, 'T'); t.nodes.splice(3, 1); t.edges.splice(3, 1); assert(!Pat.removeNode(P, t, 0), 'a piece never has fewer than 3 points');
  console.log('✓ a point added or taken away keeps the label, the hold and the seam');
}
{
  // curves: smooth points make a round, handles move, and a point added on a curve stays on it
  const P = Pat.create(), p = Pat.ellipse(P, 0, 0, 10, 10, 'C'), before = Pat.flatten(p, 0.25).poly;
  Pat.addNode(P, p, 0, 0.5); const after = Pat.flatten(p, 0.25).poly;
  near(Math.abs(Pat.area(after)), Math.abs(Pat.area(before)), 0.3, 'adding a point on a curve leaves the curve');
  const N = p.nodes[1]; assert(Math.abs(Math.hypot(N.x, N.y) - 10) < 0.15, 'the new point is on the circle');
  const q = Pat.rect(P, 0, 0, 10, 10, 'Q'); Pat.toggleSmooth(q, 0); const flat = Pat.flatten(q); assert(flat.poly.length > 8, 'a smooth corner rounds the edges beside it');
  Pat.moveHandle(q, 1, 'o', 3, 0); assert(q.nodes[1].o[0] === 3 && q.nodes[1].i[0] === -3 || q.nodes[1].i[0] < 0, 'dragging a handle moves its twin the other way');
  const hit = Pat.nearest(q, 5, -0.4); assert(hit.e === 0 && hit.d < 1, 'the nearest edge is found');
  console.log('✓ curves: handles, smooth points, a point on a curve stays on it, the nearest edge is found');
}
{
  // a dart: a wedge taken out, its legs sewn together; mirror across a fold; a copy flipped; a seam allowance
  const P = Pat.create(), p = Pat.rect(P, 0, 0, 40, 30, 'D'), A0 = Math.abs(Pat.area(Pat.flatten(p).poly));
  Pat.addDart(P, p, 2, 0.5, 4, 10);
  assert(p.nodes.length === 7 && p.edges.filter((e) => e.label === 'dart').length === 2, 'a dart adds three points and two dart edges');
  const A1 = Math.abs(Pat.area(Pat.flatten(p).poly)); near(A1, A0 - 0.5 * 4 * 10, 0.5, 'the dart takes out its triangle');
  assert(P.seams.length === 1 && P.seams[0].a[0].piece === P.seams[0].b[0].piece, 'the two dart legs are sewn to each other');
  const H = Pat.rect(P, 100, 0, 20, 30, 'Half'); assert(Pat.mirrorFold(P, H, 3), 'fold'); near(Math.abs(Pat.area(Pat.flatten(H).poly)), 1200, 0.01, 'a half mirrored across its fold edge is twice as big');
  assert(H.nodes.length === H.edges.length, 'points and edges stay in step');
  const C = Pat.mirrorCopy(P, H); near(Math.abs(Pat.area(Pat.flatten(C).poly)), 1200, 0.01, 'a mirrored copy is the same size'); assert(Pat.bbox(Pat.flatten(C).poly).x0 > Pat.bbox(Pat.flatten(H).poly).x1, 'and sits beside it');
  const Q = Pat.rect(P, 0, 0, 10, 10, 'Q'), cut = Pat.allowance(Q, 1); near(Math.abs(Pat.area(cut)), 144, 0.5, 'a 1 cm allowance makes 12 x 12');
  assert(/^<svg/.test(Pat.toSVG(P, 1)) && /cm"/.test(Pat.toSVG(P, 1)), 'the flat pattern goes out as an SVG in true size');
  console.log('✓ darts, fold, mirrored copy, seam allowance, SVG');
}
{
  // sewing edge to edge: lengths, the ease, and the document it makes
  const P = Pat.create(), a = Pat.rect(P, 0, 0, 20, 10, 'A'), b = Pat.rect(P, 0, 20, 22, 10, 'B');
  assert(Pat.sew(P, { piece: a.id, eid: a.edges[0].id }, { piece: b.id, eid: b.edges[0].id }), 'sewn'); assert(!Pat.sew(P, { piece: a.id, eid: a.edges[0].id }, { piece: b.id, eid: b.edges[0].id }), 'the same pair is not sewn twice');
  assert(!Pat.sew(P, { piece: a.id, eid: a.edges[0].id }, { piece: a.id, eid: a.edges[0].id }), 'an edge is not sewn to itself');
  const inf = Pat.seamInfo(P)[0]; near(inf.lenA, 20, 1e-6, 'a'); near(inf.lenB, 22, 1e-6, 'b'); near(inf.diff, -2, 1e-6, 'one is 2 cm longer'); near(inf.pct, -9.09, 0.05, 'a tenth');
  Pat.unsew(P, inf.id); assert(P.seams.length === 0, 'unsewn');
  console.log('✓ edge to edge: the same pair twice and an edge to itself are refused; lengths and ease are read');
}
{
  // a skirt template drapes as a document made from drawn data
  const P = Pat.create('skirt'); Pat.TEMPLATES.skirt(P); const doc = Pat.toDoc(P);
  assert.deepStrictEqual(Doc.validate(doc), [], 'the drawn skirt is a good document'); assert(doc.pins.length === 1 && doc.seams.length === 1, 'one held edge, one seam');
  const c = run(doc, 160), s = c.stats();
  assert(c.X.every(Number.isFinite), 'no NaN'); assert(s.seams >= 10, `the side seam is found: ${s.seams}`); assert(s.seam_gap < 2.5, `the seam closes: ${s.seam_gap}`); assert(s.inside_body > -1.2, `it does not go into the body: ${s.inside_body}`);
  const back = Doc.fromJSON(Doc.toJSON(doc)); assert.deepStrictEqual(back.pieces[0].poly, doc.pieces[0].poly, 'and it survives a file');
  console.log(`✓ a drawn skirt (one piece, one seam, a held waist) drapes: ${s.seams} seam pairs, within ${s.seam_gap.toFixed(2)} cm, ${s.inside_body.toFixed(2)} cm into the body, ${(s.max_strain * 100).toFixed(0)} % worst stretch`);
}
{
  // two drawn pieces, front and back, sewn at both sides: the seam finds its own direction
  const P = Pat.create('tube'); Pat.TEMPLATES.tube(P); const doc = Pat.toDoc(P);
  assert.deepStrictEqual(Doc.validate(doc), []); assert(doc.seams.length === 2 && doc.pins.length === 2, 'two seams and two held edges');
  const c = run(doc, 160), s = c.stats();
  assert(c.X.every(Number.isFinite), 'no NaN'); assert(s.seam_gap < 3, `both seams close: ${s.seam_gap}`); assert(s.inside_body > -1.4, `it does not go into the body: ${s.inside_body}`);
  console.log(`✓ a drawn front and back sewn at both sides drape: seam within ${s.seam_gap.toFixed(2)} cm, ${s.inside_body.toFixed(2)} cm into the body`);
}
{
  // a free outline of curves with a dart, wrapped, drapes too (nothing about it is a known garment)
  const P = Pat.create('free'), p = Pat.addPiece(P, [{ x: 10, y: 0, sm: true }, { x: 70, y: 0, sm: true }, { x: 85, y: 40, sm: true }, { x: 0, y: 40, sm: true }], 'Panel', { arr: { mode: 'wrap', top: 108 } });
  p.edges[0].hold = true; Pat.sew(P, { piece: p.id, eid: p.edges[1].id }, { piece: p.id, eid: p.edges[3].id });
  const doc = Pat.toDoc(P); assert.deepStrictEqual(Doc.validate(doc), []); const c = run(doc, 120), s = c.stats();
  assert(c.X.every(Number.isFinite), 'no NaN'); assert(s.inside_body > -1.5, `${s.inside_body}`);
  console.log(`✓ a free curved outline drapes: ${s.seams} seam pairs, ${s.inside_body.toFixed(2)} cm into the body`);
}
{
  // G3: one edge sewn to several, a seam turned the other way, a point-to-point stitch
  const P = Pat.create(), a = Pat.rect(P, 0, 0, 40, 10, 'Long'), b = Pat.rect(P, 0, 20, 20, 10, 'S1'), c = Pat.rect(P, 30, 20, 20, 10, 'S2');
  const s = Pat.sew(P, { piece: a.id, eid: a.edges[2].id }, [{ piece: b.id, eid: b.edges[0].id }]); assert(Pat.addToSeam(P, s.id, 'b', { piece: c.id, eid: c.edges[0].id }), 'a second edge joins the side');
  assert(!Pat.addToSeam(P, s.id, 'b', { piece: c.id, eid: c.edges[0].id }), 'the same edge twice is refused'); const inf = Pat.seamInfo(P)[0]; near(inf.lenA, 40, 1e-6, 'one long edge'); near(inf.lenB, 40, 1e-6, 'two short ones add up'); near(inf.diff, 0, 1e-6, 'no ease');
  const d0 = Pat.toDoc(P).seams[0]; Pat.flipSeam(P, s.id); const d1 = Pat.toDoc(P).seams[0]; assert(!!d0.b[0].rev !== !!d1.b[0].rev, 'flipping turns the seam the other way');
  const hit = Pat.nearest(a, 20, 10.2); assert(hit.s > 0.65 && hit.s < 0.75, `a point on an outline has its share: ${hit.s}`);
  const t = Pat.stitch(P, a.id, hit.s, b.id, 0.1); assert(t && Pat.toDoc(P).stitches.length === 1, 'a stitch goes into the document'); Pat.unstitch(P, t.id); assert(Pat.toDoc(P).stitches.length === 0, 'and out again'); Pat.stitch(P, a.id, 0.2, c.id, 0.2); Pat.removePiece(P, c.id); assert(Pat.toDoc(P).stitches.length === 0, 'a piece taken away takes its stitches');
  assert.deepStrictEqual(Doc.validate(Pat.toDoc(P)), []);
  console.log('✓ one edge to several (lengths add up), flip, point-to-point stitches; a taken piece takes its seams and stitches');
}
{
  // G4: bodies from measures, and a piece wrapped round a limb
  const f = Pat.bodyFromMeasures({ preset: 'female' }), m = Pat.bodyFromMeasures({ preset: 'male' }), k = Pat.bodyFromMeasures({ preset: 'child' });
  assert(m.top > f.top && f.top > k.top, 'a man is taller than a woman, a child is shortest'); near(k.anchors.waist / f.anchors.waist, 120 / 165, 0.02, 'the anchors follow the height');
  const ring = (d, y) => { const e = Pat.arrangeMap; const keys = d.loft.keys; let best = keys[0]; for (const q of keys) if (Math.abs(q[0] - y) < Math.abs(best[0] - y)) best = q; return Math.PI * (3 * (best[1] + best[2]) - Math.sqrt((3 * best[1] + best[2]) * (best[1] + 3 * best[2]))); };
  near(ring(f, f.anchors.waist), 70, 1.5, 'the waist is the waist measure'); near(ring(m, m.anchors.chest), 100, 2, 'the chest is the chest measure');
  const over = Pat.bodyFromMeasures({ preset: 'female', hip: 110 }); assert(ring(over, over.anchors.hip) > ring(f, f.anchors.hip) + 10, 'a bigger hip is a bigger hip');
  assert.deepStrictEqual(Object.keys(f.limbs).sort(), ['armL', 'armR', 'legL', 'legR']);
  // a narrow tube sewn to itself, hung on the left arm
  const P = Pat.create('sleeve'); P.body = { preset: 'female' }; const p = Pat.rect(P, 0, 0, 37, 40, 'Tube', { arr: { mode: 'armL', along: 10 } }); p.edges[0].hold = true; Pat.sew(P, { piece: p.id, eid: p.edges[1].id }, { piece: p.id, eid: p.edges[3].id });
  const doc = Pat.toDoc(P); assert.deepStrictEqual(Doc.validate(doc), []); const c = run(doc, 140), s = c.stats();
  assert(c.X.every(Number.isFinite), 'no NaN'); assert(s.inside_body > -1.5, `it stays out of the arm: ${s.inside_body}`); assert(s.seam_gap < 3, `the seam closes: ${s.seam_gap}`);
  let x0 = 1e9, x1 = -1e9; for (let i = 0; i < c.X.length; i += 3) { x0 = Math.min(x0, c.X[i]); x1 = Math.max(x1, c.X[i]); } assert(x0 > 5, 'it hangs on the left arm, not the middle of the body');
  // the first guess at arrangement: a tube is a limb, a pair is a front and a back, the rest wraps
  const Q = Pat.create(); Pat.TEMPLATES.tube(Q); Q.pieces.forEach((z) => { z.arr.mode = 'wrap'; }); Pat.autoArrange(Q); assert(Q.pieces[0].arr.mode === 'front' && Q.pieces[1].arr.mode === 'back', 'two pieces sewn twice are a front and a back');
  const R = Pat.create(); const t = Pat.rect(R, 0, 0, 20, 30, 'T'); Pat.sew(R, { piece: t.id, eid: t.edges[1].id }, { piece: t.id, eid: t.edges[3].id }); Pat.autoArrange(R); assert(/^arm/.test(R.pieces[0].arr.mode), `a narrow self-sewn tube is a limb: ${R.pieces[0].arr.mode}`);
  console.log(`✓ bodies from measures (female/male/child, any chest, waist, hip, height); a drawn tube drapes on the left arm: ${s.seams} seam pairs, within ${s.seam_gap.toFixed(2)} cm; a first guess of where pieces hang`);
}
{
  const src = require('fs').readFileSync(path.join(FE, 'garment-pattern.js'), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const body = src.slice(0, src.indexOf('const TEMPLATES'));
  assert(!/sleeve|armhole|inseam|waistband|'tee'|'legs'|neckline/.test(body), 'the pattern module has no word of any garment in it (only the templates below it do)');
  console.log('✓ the pattern module knows no garment; only the starting templates do');
}
console.log('Free pattern tests passed');
