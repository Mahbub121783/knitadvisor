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
  const src = require('fs').readFileSync(path.join(FE, 'garment-pattern.js'), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const body = src.slice(0, src.indexOf('const TEMPLATES'));
  assert(!/sleeve|shoulder|armhole|inseam|waistband|'tee'|'legs'|neckline/.test(body), 'the pattern module has no word of any garment in it (only the templates below it do)');
  console.log('✓ the pattern module knows no garment; only the starting templates do');
}
console.log('Free pattern tests passed');
