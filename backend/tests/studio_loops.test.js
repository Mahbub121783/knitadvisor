// Fabric Studio loop view: the yarn path drawn for each knit, tuck and miss has
// the topology of the real stitch (over/under, held height, which side).
const assert = require('assert');
const { buildLoopPaths } = require('../../frontend/assets/js/studio-loop-geom.js');
console.log('--- Running Studio Loop Geometry Tests ---');

const stitch = (g, c, bed, wale) => g.courses[c].stitches.find((s) => s.bed === bed && s.wale === wale);
const pts = (g, c, s) => g.courses[c].points.slice(s.from, s.to + 1);
const zAt = (list, y) => list.reduce((b, p) => (Math.abs(p.y - y) < Math.abs(b.y - y) ? p : b)).z;

// single jersey: every new loop is drawn through the old one, back to front
{
  const g = buildLoopPaths({ C: [['K']], h: 0.75 });
  assert(g.rows >= 10 && g.wales >= 10, 'shows enough loops to read');
  const old = stitch(g, 3, 'C', 4), nu = stitch(g, 4, 'C', 4);
  const o = pts(g, 3, old), n = pts(g, 4, nu);
  const crown = o.reduce((b, p) => (p.y > b.y ? p : b));
  assert(crown.y > n[0].y, 'old head reaches above the new loop feet (they intermesh)');
  assert(n[0].z < crown.z + 0.01 || n[0].z < 0, 'new feet start behind');
  assert(zAt(n, crown.y) > crown.z + 0.15, 'new legs cross in front of the old head');
  assert.strictEqual(old.held, 0);
}

// a tuck: open arch behind the held loop, crown beside the held head, both
// cleared together by the next knit
{
  const g = buildLoopPaths({ C: [['K', 'K'], ['T', 'K'], ['K', 'K']], h: 0.75 });
  const held = stitch(g, 0, 'C', 0), tuck = stitch(g, 1, 'C', 0), next = stitch(g, 2, 'C', 0);
  assert.strictEqual(held.held, 1, 'loop on the tucking needle is held one course');
  assert.strictEqual(tuck.act, 'T');
  assert(Math.abs(held.top - tuck.top) < 0.2, 'tuck crown sits beside the held head');
  const tp = pts(g, 1, tuck);
  assert(tp.every((p) => p.z < 0), 'tuck lies behind the face');
  assert(tp[0].y < tp[3].y && tp[6].y < tp[3].y, 'tuck is an arch with open feet');
  assert.strictEqual(next.tucks, 1, 'next knit loop is drawn through the tuck too');
  const np = pts(g, 2, next);
  assert(np[0].z < Math.min(...tp.map((p) => p.z)) + 0.05, 'next loop feet go behind the tuck');
  const plain = stitch(g, 0, 'C', 1);
  assert(held.top > plain.top + 0.5, 'held loop is longer than its neighbour');
}

// a miss: straight float behind the held loop, at its own course height
{
  const g = buildLoopPaths({ C: [['K', 'K'], ['M', 'K']], h: 0.75 });
  const m = stitch(g, 1, 'C', 0), mp = pts(g, 1, m);
  assert.strictEqual(mp.length, 2);
  assert(mp[0].y === mp[1].y && mp.every((p) => p.z < -0.2), 'float straight across the back');
  assert.strictEqual(stitch(g, 0, 'C', 0).held, 1);
}

// rib: dial loops sit between cylinder needles, on the other side, facing back;
// the yarn crosses between the beds
{
  const g = buildLoopPaths({ C: [['K']], D: [['K']], bed: 'rib', h: 0.8 });
  const c = stitch(g, 2, 'C', 3), d = stitch(g, 2, 'D', 3);
  assert.strictEqual(d.x - c.x, 0.5, 'rib gating: dial needle between two cylinder needles');
  const cp = pts(g, 2, c), dp = pts(g, 2, d);
  assert(Math.max(...cp.map((p) => p.z)) > 0.4 && Math.min(...dp.map((p) => p.z)) < -0.4, 'beds on opposite sides');
  const order = g.courses[2].stitches.slice(0, 4).map((s) => s.bed).join('');
  assert.strictEqual(order, 'CDCD', 'yarn meets the needles alternately');
}

// interlock: dial needles face to face with the cylinder; each feed knits on
// alternate needles of each bed
{
  const g = buildLoopPaths({ C: [['K', '-'], ['-', 'K']], D: [['-', 'K'], ['K', '-']], bed: 'interlock', h: 0.8 });
  assert.strictEqual(stitch(g, 0, 'D', 1).x, stitch(g, 0, 'C', 1).x, 'interlock gating: needles opposite');
  assert.strictEqual(stitch(g, 0, 'C', 1).act, '-');
  // each needle knits on one feed in two, so one face course is two feeds and
  // a loop spans both: drawn as one face course tall, like a jersey loop
  const s = stitch(g, 2, 'C', 0);
  assert.strictEqual(s.held, 1);
  assert(Math.abs(g.step - 0.4) < 1e-9, 'a feed is half a face course');
  assert(Math.abs((s.top - s.y0) - 1.38 * 0.8) < 1e-9, 'loop height = one face course + intermesh');
}

// a fleece loop yarn: tucks and long floats only, all on the back
{
  const g = buildLoopPaths({ C: [['K', 'K', 'K', 'K'], ['T', 'M', 'M', 'M']], h: 0.75 });
  const loopCourse = g.courses[1];
  assert(loopCourse.points.every((p) => p.z <= 0.0001), 'loop yarn never comes to the face');
}
// a transfer (E): the loop is handed to the next needle, the needle is left
// empty (the eyelet), and the moved loop's head leans onto the receiving needle
{
  const g = buildLoopPaths({ C: [['K', 'K', 'K'], ['K', 'E', 'K'], ['K', 'K', 'K']], h: 0.75 });
  const moved = stitch(g, 0, 'C', 1), e = stitch(g, 1, 'C', 1);
  assert.strictEqual(moved.transferred, 1);
  const crown = pts(g, 0, moved).reduce((b, p) => (p.y > b.y ? p : b));
  assert(Math.abs(crown.x - (moved.x + 0.5)) < 1e-9, 'head leans onto the next needle');
  assert.strictEqual(pts(g, 1, e).length, 1, 'the emptied needle takes no loop');
}

// plush: the pile yarn stands over the sinker on the back, as tall as asked
{
  const g = buildLoopPaths({ C: [['K']], h: 0.8, pileH: 1.6, pileFeeds: [true] });
  const pile = g.courses[3].pile;
  assert(pile && Math.min(...pile.map((p) => p.z)) <= -1.79, 'loops stand the sinker height off the back');
  assert(Math.max(...pile.map((p) => p.z)) < Math.max(...g.courses[3].points.map((p) => p.z)) - 0.1, 'plated: the pile lies behind the ground yarn on the face');
}
console.log('studio loop geometry: ok');
