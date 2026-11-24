// The cloth simulation (frontend/assets/js/garment-sim.js, plain numbers): a piece is meshed into triangles that fill it, cloth falls on a body without going into it,
// the seams stay closed, the cloth keeps its own size, and the same input gives the same drape.
'use strict';
const assert = require('assert');
const path = require('path');
const Sim = require(path.join(__dirname, '..', '..', 'frontend', 'assets', 'js', 'garment-sim.js'));
const G = require('../engine/domain/garment-pattern');

console.log('--- Running Garment Simulation Tests ---');
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const polyArea = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };

{
  // the mesh fills the piece: a rectangle, an L, and every piece of a tee
  const rect = [[0, 0], [40, 0], [40, 30], [0, 30]], L = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]];
  [[rect, 'rect'], [L, 'L']].forEach(([poly, name]) => { const m = Sim.meshPiece(poly, poly.map(() => 'e'), 2); near(Sim.meshArea(m), polyArea(poly), polyArea(poly) * 0.04, `the mesh of the ${name} fills it`); assert(m.nb >= poly.length && m.tris.length > 20); });
  const T = G.template(['M'], 'cm'), r = G.build({ sizes: ['M'], chart: T.chart, fabric: { gsm: 180 } });
  r.by_size[0].pieces.forEach((p) => { const m = Sim.meshPiece(p.finished, p.finished_labels, 2); near(Sim.meshArea(m), polyArea(p.finished), polyArea(p.finished) * 0.06, `the mesh of the ${p.id} fills it`); });
  console.log('✓ a piece is meshed into triangles that fill it (a rectangle, an L, the four pieces of a tee, within 6 % of their area)');
}
{
  // cloth over a sphere: it rests on it, it does not go in, it is not stretched
  const mesh = Sim.meshPiece([[-20, -20], [20, -20], [20, 20], [-20, 20]], ['a', 'b', 'c', 'd'], 2);
  const body = { sdf: (x, y, z) => Math.hypot(x, y, z) - 14 }, mk = () => new Sim.Cloth([{ id: 'sheet', mesh, map: (x, y) => [x, 18, y], rest: 'flat' }], body, { h: 2 });
  const c = mk(); c.run(260); const s = c.stats();
  assert(s.inside_body > -0.7, `the cloth does not go into the body: ${s.inside_body}`); assert(s.max_strain < 0.4, `the cloth keeps its size: ${s.max_strain}`); assert(s.moving < 0.25, `the cloth comes to rest: ${s.moving}`);
  let low = 1e9, high = -1e9; for (let i = 0; i < c.N; i++) { low = Math.min(low, c.X[3 * i + 1]); high = Math.max(high, c.X[3 * i + 1]); } assert(low < 12 && high > 12, 'it hangs down the sides of the sphere');
  const c2 = mk(); c2.run(260); assert(c.X.every((v, i) => v === c2.X[i]), 'the same input gives the same drape');
  console.log(`✓ a sheet falls on a sphere: it rests on it (${s.inside_body.toFixed(2)} cm in), keeps its size (${(s.max_strain * 100).toFixed(1)} % worst stretch), comes to rest, and is the same every time`);
}
{
  // a tube: a rectangle rolled round a post and sewn to itself where its two ends meet (what a sleeve or a leg is), draped on the post
  const W = 50, H = 40, R = W / (2 * Math.PI), mesh = Sim.meshPiece([[0, 0], [W, 0], [W, H], [0, H]], ['left', 'top', 'right', 'bottom'], 2);
  const post = { sdf: (x, y, z) => Math.hypot(x, z) - R * 0.8 };
  const c = new Sim.Cloth([{ id: 'tube', mesh, map: (x, y) => [R * Math.cos((x / W) * 2 * Math.PI), 60 - y, R * Math.sin((x / W) * 2 * Math.PI)], rest: 'flat' }], post, { h: 2, seamTol: 2.2 });
  const s0 = c.stats(); assert(s0.seams >= 15, `the two ends of the piece are found to be one seam: ${s0.seams}`);
  c.run(150); const s = c.stats();
  assert(c.X.every(Number.isFinite), 'no NaN'); assert(s.seam_gap < 0.8, `the seam stays closed: ${s.seam_gap}`); assert(s.inside_body > -0.8, `the tube does not go into the post: ${s.inside_body}`); assert(s.max_strain < 0.25, `the tube keeps its size: ${s.max_strain}`);
  console.log(`✓ a rectangle sewn into a tube on a post: ${s0.seams} seam pairs found by where the ends start, after the drape the seam is within ${s.seam_gap.toFixed(2)} cm, ${s.inside_body.toFixed(2)} cm into the post, ${(s.max_strain * 100).toFixed(0)} % worst stretch`);
}
{
  // the tee's mannequin: a chest that is the garment's less its ease, shoulders, arms along the sleeve, a head
  const T = G.template(['M'], 'cm'), r = G.build({ sizes: ['M'], chart: T.chart, fabric: { gsm: 180 } }), o = r.by_size[0], m = o.m, Lh = m.length, body = Sim.bodyTee(o, {});
  assert(body.sdf(0, Lh / 2, 0) < 0 && body.sdf(0, Lh / 2, 40) > 0 && body.sdf(40, Lh * 0.7, 0) > 0, 'the mannequin has a body, and outside it is outside');
  assert(body.sdf(m.shoulder / 2 - 2.2 + 12 * Math.sin(28 * Math.PI / 180), Lh - m.slope - 3.2 - 12 * Math.cos(28 * Math.PI / 180), 0) < 0, 'an arm hangs from the shoulder'); assert(body.sdf(0, Lh + 14, 0) < 0, 'a head sits on the neck');
  // the chest's perimeter is the garment's less the ease
  let w = 0; for (let x = 0; x < 60; x += 0.05) { if (body.sdf(x, Lh * 0.2, 0) < 0) w = x; }
  assert(w > m.chest / 2 * 0.55 && w < m.chest / 2 * 1.0, `the chest is narrower than the garment's: half-width ${w.toFixed(1)} vs ${(m.chest / 2).toFixed(1)}`);
  console.log('✓ the mannequin of a top: a chest that is the garment less its ease, shoulders, arms, a head');
}
{
  // the legs' mannequin: a waist, a seat, two legs
  const SH = require('../engine/domain/garment-shorts'), T = SH.template(['M'], 'cm'), r = SH.build({ sizes: ['M'], chart: T.chart, fabric: { gsm: 240 } }), o = r.by_size[0], b = Sim.bodyLegs(o, {});
  const top = o.m.outseam; assert(b.sdf(0, top - 10, 0) < 0, 'the pelvis is solid'); assert(b.sdf(o.m.thigh * 0.5, 15, 0) < 0 || b.sdf(o.m.thigh * 0.4, 15, 0) < 0, 'a leg is solid'); assert(b.sdf(0, 5, 0) > 0, 'between the legs is empty'); assert(b.sdf(60, top / 2, 0) > 0, 'outside is outside');
  assert(b.geo && b.geo.yc > 0 && b.geo.keys.length >= 3 && b.geo.rt > b.geo.ra * 0.5, 'the mannequin gives the start of the drape its measures'); const lk = Sim.lerpKeys(b.geo.keys, b.geo.top - b.geo.F * 0.5); assert(lk[0] > 5 && lk[1] < lk[0], 'the pelvis is wider than deep');
  console.log('✓ the mannequin of a bottom: a pelvis, two legs, empty between them');
}
console.log('Garment simulation tests passed');
