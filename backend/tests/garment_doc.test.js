// The garment document (frontend/assets/js/garment-doc.js) and the simulator that reads it (KASim.fromDoc): any garment is pieces + stitches + pins + a body.
// Nothing here knows what a tee is: a skirt and a two-panel tube are written by hand as data, and drape.
'use strict';
const assert = require('assert');
const path = require('path');
const Sim = require(path.join(__dirname, '..', '..', 'frontend', 'assets', 'js', 'garment-sim.js'));
const Doc = require(path.join(__dirname, '..', '..', 'frontend', 'assets', 'js', 'garment-doc.js'));

console.log('--- Running Garment Document Tests ---');
const TAU = Math.PI * 2;

// a rectangle of W x H wrapped round a vertical post of radius R, y flat = down the garment, from the top (world y = top - y)
const wrap = (W, H, R, top, x0, span) => {
  const poly = [[0, 0], [W, 0], [W, H], [0, H]], nx = Math.ceil(W) + 1, ny = Math.ceil(H) + 1, xyz = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = x0 + (i / (nx - 1)) * span, y = (j / (ny - 1)) * H; xyz.push(R * Math.cos(a), top - y, R * Math.sin(a)); }
  return { poly, placement: { x0: 0, y0: 0, dx: W / (nx - 1), dy: H / (ny - 1), nx, ny, xyz } };
};
const post = (r, top, bottom) => ({ top: top + 10, loft: { keys: [[top + 10, r, r], [bottom, r, r]], from: null }, caps: [], spheres: [] });
const run = (doc, steps) => { const b = Sim.fromDoc(doc), c = new Sim.Cloth(b.insts, b.body, Object.assign({}, Sim.DRAPE.medium, b.opt)); c.run(steps); return c; };

// a skirt: one rectangle, its two side edges sewn together by share, the top edge (the waist, y = 0) held
const skirt = () => {
  const W = 60, H = 40, R = W / TAU, w = wrap(W, H, R + 0.6, 80, 0, TAU);
  return { format: 'ka-garment', version: 1, unit: 'cm', name: 'skirt', block: null, fabric: { gsm: 160 },
    pieces: [{ id: 'skirt', pid: 'skirt', name: 'Skirt', poly: w.poly, labels: ['waist', 'side', 'hem', 'side'], material: 'main', grp: null, pinAll: false, placement: w.placement }],
    stitches: [], seams: [{ a: [{ piece: 'skirt', s0: 0.3, s1: 0.5 }], b: [{ piece: 'skirt', s0: 0.8, s1: 1.0001, rev: true }], mode: 'share' }],
    pins: [{ piece: 'skirt', s0: 0, s1: 0.3 }], avatar: post(R - 0.8, 80, 20), sim: { gravity: 980 } };
};

{
  assert.deepStrictEqual(Doc.validate(skirt()), [], 'a hand-written skirt is a good document');
  assert(Doc.validate({}).length && Doc.validate(null).length, 'nothing is not a document');
  const d = skirt(); d.pieces[0].labels.pop(); assert(Doc.validate(d).some((m) => /label/.test(m)), 'a label missing is named');
  const e = skirt(); e.pieces[0].placement.xyz.pop(); assert(Doc.validate(e).some((m) => /starts/.test(m)), 'a placement of the wrong size is named');
  const f = skirt(); f.pins[0].piece = 'nope'; assert(Doc.validate(f).some((m) => /pin/.test(m)), 'a pin on a piece that is not there is named');
  const g = skirt(); g.avatar = {}; assert(Doc.validate(g).some((m) => /body/.test(m)), 'no body is named');
  assert.throws(() => Doc.fromJSON('not json'), /not JSON/); assert.throws(() => Doc.fromJSON('{"format":"x"}'), /not a KnitAdvisor/);
  const back = Doc.fromJSON(Doc.toJSON(skirt())); assert.deepStrictEqual(back, skirt(), 'a document survives being written to a file and read back');
  console.log('✓ the document is checked (a missing label, a placement of the wrong size, a pin on nothing, no body) and survives a file');
}
{
  // the skirt drapes: the seam closes, the waist stays, nothing goes into the body, the cloth keeps its size
  const c = run(skirt(), 160), s = c.stats();
  assert(c.X.every(Number.isFinite), 'no NaN'); assert(s.seams >= 10, `the side seam is found: ${s.seams}`);
  assert(s.seam_gap < 1.2, `the seam closes: ${s.seam_gap}`); assert(s.inside_body > -0.8, `it does not go into the body: ${s.inside_body}`); assert(s.max_strain < 0.4, `it keeps its size: ${s.max_strain}`);
  const c2 = run(skirt(), 160); assert(c.X.every((v, i) => v === c2.X[i]), 'the same document gives the same drape');
  const c3 = run(Doc.fromJSON(Doc.toJSON(skirt())), 160); assert(c.X.every((v, i) => v === c3.X[i]), 'and the same after a file');
  console.log(`✓ a skirt written as data drapes: ${s.seams} seam pairs, seam within ${s.seam_gap.toFixed(2)} cm, ${s.inside_body.toFixed(2)} cm into the body, ${(s.max_strain * 100).toFixed(0)} % worst stretch, the same every time`);
}
{
  // two panels sewn at both sides (front to back), from the hem up: a tube made of two pieces, as a vest or a bag is
  const W = 30, H = 40, R = 60 / TAU, top = 80, front = wrap(W, H, R + 0.6, top, -Math.PI / 2, Math.PI), back = wrap(W, H, R + 0.6, top, Math.PI / 2, Math.PI);
  const per = 2 * (W + H), r0 = W / per, r1 = (W + H) / per, t1 = (2 * W + H) / per, labels = ['top', 'side', 'hem', 'side'], doc = { format: 'ka-garment', version: 1, unit: 'cm', name: 'tube', fabric: { gsm: 180 },
    pieces: [{ id: 'f', pid: 'f', name: 'Front', poly: front.poly, labels, material: 'main', placement: front.placement }, { id: 'b', pid: 'b', name: 'Back', poly: back.poly, labels, material: 'main', placement: back.placement }],
    stitches: [], seams: [
      { a: [{ piece: 'f', s0: r0, s1: r1 }], b: [{ piece: 'b', s0: t1, s1: 1.0001, rev: true }], mode: 'end' },   // front right edge to back left edge, both from the hem up
      { a: [{ piece: 'f', s0: t1, s1: 1.0001, rev: true }], b: [{ piece: 'b', s0: r0, s1: r1 }], mode: 'end' } ],
    pins: [{ piece: 'f', s0: 0, s1: r0 }, { piece: 'b', s0: 0, s1: r0 }], avatar: post(R - 0.8, top, 20), sim: { gravity: 980 } };
  assert.deepStrictEqual(Doc.validate(doc), []);
  const c = run(doc, 160), s = c.stats();
  assert(c.X.every(Number.isFinite), 'no NaN'); assert(s.seam_gap < 1.4, `both seams close: ${s.seam_gap}`); assert(s.inside_body > -0.9, `it does not go into the body: ${s.inside_body}`);
  console.log(`✓ two pieces sewn at both sides, written as data, drape on a post: seam within ${s.seam_gap.toFixed(2)} cm, ${s.inside_body.toFixed(2)} cm into the body`);
}
{
  // the stitches written down are what the cloth is held by: the same skirt with its seam given as point to point stitches drapes the same way
  const d = skirt(), W = 60, H = 40; d.seams = []; d.stitches = [];
  const per = 2 * (W + H), sOf = (x, y) => (x === W && y >= 0 ? (W + y) / per : x === 0 ? (2 * W + H + (H - y)) / per : 0);
  for (let y = 0; y <= H; y += 2) d.stitches.push({ a: ['skirt', sOf(W, y)], b: ['skirt', sOf(0, y)] });
  const c = run(d, 160), s = c.stats(); assert(s.seams >= 10, `${s.seams}`); assert(s.seam_gap < 2, `the stitches hold: ${s.seam_gap}`);
  console.log(`✓ stitches given point to point hold the seam (${s.seams} pairs, within ${s.seam_gap.toFixed(2)} cm)`);
}
{
  // the blocks know a tee and a pair of legs, and nothing else; they are data-producing rules, the simulator never sees them
  assert(Doc.BLOCKS.tee && Doc.BLOCKS.legs && typeof Doc.BLOCKS.tee.sewing === 'function', 'the tee and the legs blocks exist');
  const src = require('fs').readFileSync(path.join(__dirname, '..', '..', 'frontend', 'assets', 'js', 'garment-sim.js'), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const body = src.slice(src.indexOf('function fromDoc')), inside = body.slice(0, body.indexOf('const KASim'));
  assert(!/sleeve|shoulder|armhole|inseam|waistband|'tee'|'legs'/.test(inside), 'the document reader has no word of any garment in it');
  console.log('✓ the reader of the document has no word of any garment in it; the garment-specific rules are the blocks');
}
console.log('Garment document tests passed');
