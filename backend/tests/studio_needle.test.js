// Fabric Studio: the needle-action cycle (studio-needle.js) moves each needle
// by the cam path its notation cell asks for (Spencer's eight positions):
//   K  raised to clearing height — above tuck height — then drawn below the
//      knock-over level by the stitch cam
//   T  raised only to tuck height: the old loop reaches the latch, not the stem
//   M  never raised
//   E  raised highest (transfer height)
// and every stitch has a caption for every position.
const assert = require('assert');
const N = require('../../frontend/assets/js/studio-needle.js');
console.log('--- Running Studio Needle Tests ---');

const peak = (s) => Math.max(...Array.from({ length: 101 }, (_, i) => N.lift(s, i / 100)));
const low = (s) => Math.min(...Array.from({ length: 101 }, (_, i) => N.lift(s, i / 100)));
assert(peak('E') > peak('K') && peak('K') > peak('T') && peak('T') > 0, 'transfer > clearing > tuck height');
assert.strictEqual(peak('M'), 0, 'a missing needle is never raised');
assert(low('K') < 0 && low('T') < 0, 'the stitch cam draws knit and tuck below the knock-over level');
assert.strictEqual(N.lift('K', 0), 0); assert(Math.abs(N.lift('K', 0.9999)) < 0.5, 'the cycle closes at rest');
// the latch geometry: the old loop (held by the sinker 11 px above the hook top at rest)
// clears the open latch's spoon (68 px down the needle) only at clearing height
const rel = (s) => 11 + peak(s);
assert(rel('K') > 68, 'knit: the old loop is cleared onto the stem');
assert(rel('T') > 38 && rel('T') < 68, 'tuck: the old loop rests on the latch, below the rivet, above the spoon');
// phases in order, captions complete
assert.strictEqual(N.PHASES.length, 8);
N.PHASES.forEach((p, i) => { if (i) assert(p.t > N.PHASES[i - 1].t, 'phases run in order'); });
for (const s of ['K', 'T', 'M', 'E']) for (const p of N.PHASES) assert(N.TEXT[s][p.k] && N.TEXT[s][p.k].length > 20, `${s} ${p.k} has a caption`);
// the needle types render without a browser
const html = N.renderTypes();
for (const t of ['Latch needle', 'Compound needle', 'Bearded', 'Transfer', 'Double-headed', 'selector jack', 'Sinker']) assert(html.includes(t), t);
console.log('Studio needle tests passed');
