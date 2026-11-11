// Part 0 — the stitch graph: the interlocking of any weft or warp structure, as the machine makes it.
const assert = require('assert');
console.log('--- Running Stitch Graph Tests ---');
const G = require('../engine/domain/stitch-graph');
const Audit = require('../tools/stitch-graph-audit');

const weft = (C, D, extra = {}) => G.fromWeft({ grid: { C, D }, feeds: C.map(() => ({ role: 'ground' })), ...extra });
const loop = (g, id) => g.loops.find((L) => L.id === id);

// 1. plain jersey: every loop is drawn through the one below it and cast off by the one above
let g = weft(['K']);
assert.strictEqual(g.loops.length, 1);
assert.deepStrictEqual(loop(g, 'C0@0').through, ['C0@-1'], 'drawn through the loop of the course before (one repeat earlier)');
assert.strictEqual(loop(g, 'C0@0').held, 1);
assert(g.steady && g.stats.knittable);

// 2. a tuck is drawn through nothing; the next knit is drawn through the old loop AND the tuck
g = weft(['KT', 'KT', 'TK', 'TK']);                       // single piqué
const tuck = loop(g, 'C1@0');
assert.strictEqual(tuck.kind, 'tuck'); assert.deepStrictEqual(tuck.through, []);
const k2 = loop(g, 'C1@2');
assert.strictEqual(k2.kind, 'knit');
assert.deepStrictEqual([...k2.through].sort(), ['C1@-1', 'C1@0', 'C1@1'].sort(), 'the knit at feed 3 clears the old loop and both tucks');
assert.strictEqual(tuck.cast_off, 2);
assert.strictEqual(loop(g, 'C1@-1') ? 1 : 0, 0, 'only the steady repeat is returned');

// 3. a miss leaves the loop held: it is cast off courses later, and the yarn floats
g = weft(['KM', 'MK']);
assert.strictEqual(loop(g, 'C0@0').held, 2, 'held through the course it missed');
const sp = g.passes.find((p) => p.course === 0).spans;
assert(sp.some((x) => x.kind === 'float' && x.float_needles === 1));

// 4. rib: two beds, the yarn crosses between them; interlock: face to face, alternate needles
g = weft(['K'], ['K'], { gating: 'rib' });
assert.deepStrictEqual(g.beds.sort(), ['C', 'D']);
assert.strictEqual(g.needles.find((n) => n.id === 'D0').x, 0.5, 'a dial needle sits between two cylinder needles on rib gating');
assert(g.passes[0].spans.every((x) => x.kind === 'crossing'));
g = weft(['KM', 'MK'], ['MK', 'KM'], { gating: 'interlock' });
assert.strictEqual(g.needles.find((n) => n.id === 'D0').x, 0, 'face to face on interlock gating');
assert.strictEqual(loop(g, 'C0@0').held, 2);

// 5. a transfer: the loop moves, the neighbour knits through two loops, the emptied needle starts a new wale (eyelet)
g = weft(['KKKK', 'KEKK', 'KKKK']);
assert.deepStrictEqual(g.transfers.map((t) => [t.from, t.to]), [['C1', 'C2']]);
assert.strictEqual(loop(g, 'C2@1').through.length, 2, 'the needle the loop moved to knits through both');
assert.strictEqual(loop(g, 'C1@2').kind, 'cast-on', 'the emptied needle starts again');
assert(g.checks.some((c) => c.code === 'eyelet'));
g = weft(['KKKK', 'KEKK', 'KKKK'], null, { transfer_dir: 'left' });
assert.deepStrictEqual(g.transfers.map((t) => t.to), ['C0']);

// 6. plating: two yarns in one loop; elastane on alternate feeds
g = G.fromWeft({ grid: { C: ['K', 'K'] }, feeds: [{ role: 'ground', plated: true }, { role: 'ground' }] });
assert.deepStrictEqual(loop(g, 'C0@0').yarns, ['F1', 'F1p']); assert.deepStrictEqual(loop(g, 'C0@1').yarns, ['F2']);
g = G.fromWeft({ grid: { C: ['K', 'K'] }, feeds: [{}, {}], elastane: { every: 'alternate' } });
assert.strictEqual(g.yarns.find((y) => y.id === 'F1p').role, 'elastane'); assert(!g.yarns.some((y) => y.id === 'F2p'));

// 7. flat (V-bed): the carriage goes back and forth; racking moves the needle opposite
g = G.fromWeft({ grid: { C: ['K', 'K'], D: ['K', 'K'] }, technique: 'flat' });
assert.strictEqual(g.technique, 'weft-flat'); assert.deepStrictEqual(g.passes.filter((p) => p.yarn.startsWith('F')).map((p) => p.direction), [1, -1]);
assert.deepStrictEqual(g.beds.sort(), ['B', 'F']);
g = G.fromWeft({ grid: { C: ['KK', 'RK', 'KK'], D: ['--', '--', 'KK'] }, technique: 'flat', racking: [0, 1, 0] });
assert.deepStrictEqual(g.transfers.map((t) => [t.from, t.to]), [['F0', 'B1']], 'racked one needle: F0 now stands opposite B1 (back needle i faces front needle i + r)');
assert.deepStrictEqual(G.fromWeft({ grid: { C: ['KK', 'RK', 'KK'], D: ['--', '--', 'KK'] }, technique: 'flat', racking: [0, 0, 0] }).transfers.map((t) => t.to), ['B0'], 'unracked: to the needle straight opposite');

// 8. what cannot be knitted is said, with the rule
assert(weft(['KT', 'KT']).checks.some((c) => c.code === 'never_cleared' && c.level === 'error'));
assert(weft(['KK', 'MM']).checks.some((c) => c.code === 'yarn_not_caught'));
assert(weft(['KR', 'KK']).checks.some((c) => c.code === 'no_opposite'));
assert(weft(['KK', ...Array(6).fill('KT')]).checks.some((c) => c.code === 'tuck_stack'));
assert(weft(['KMMMMMMM', 'KKKKKKKK']).checks.some((c) => c.code === 'long_float'));
assert.throws(() => weft(['KX']), G.GraphError);
assert.throws(() => weft(['K', 'KK']), G.GraphError);

// 9. warp: every needle loops every course from the yarns lapped onto it, through its own last loop
const warp = (bars, type = 'tricot', step) => G.fromWarp({ machine: { type, notation_step: step }, bars });
g = warp([{ notation: '1-0/1-2//' }, { notation: '1-2/1-0//' }]);           // full tricot
assert.strictEqual(g.period.courses, 2); assert.strictEqual(g.period.needles, 1);
const L0 = loop(g, 'W0@1');
assert.strictEqual(L0.yarns.length, 2, 'both bars lap onto every needle: one loop, two yarns');
assert.deepStrictEqual(L0.through, ['W0@0']);
assert(g.passes.every((p) => p.underlap.needles === 1));
assert(g.passes.filter((p) => p.yarn.startsWith('B1')).every((p) => p.lap === 'closed'), 'tricot 1-0/1-2: closed laps');
assert(g.stats.knittable);
assert(!warp([{ notation: '1-0/0-1//' }], 'raschel').stats.knittable, 'pillars alone fall apart into strips');
assert(warp([{ notation: '1-0/0-1//' }, { notation: '0-0/3-3//' }], 'raschel').stats.knittable, 'an inlay ties the pillars');
assert(warp([{ notation: '0-0/2-2//' }], 'raschel').checks.some((c) => c.code === 'no_loops'));
g = warp([{ notation: '1-0/0-1//', threading: 'X.' }, { notation: '1-0/1-2/2-3/2-1//', threading: '.X' }, { notation: '0-0/2-2//', threading: 'X.' }], 'raschel');
assert(g.checks.some((c) => c.code === 'pressed_off'), 'a powernet presses loops off: its eyelets');
g = warp([{ notation: '1-0/1-1/1-2/2-2//' }, { notation: '1-1/1-0/2-2/1-2//' }], 'double_raschel');
assert.deepStrictEqual(g.beds, ['W', 'V']); assert(g.loops.some((L) => L.needle.startsWith('V')) && g.loops.some((L) => L.needle.startsWith('W')));
g = warp([{ notation: '4-2/0-0/2-4/6-6//' }, { notation: '2-2/2-4/2-2/2-0//' }], 'raschel', 2);
assert.deepStrictEqual(G.toLapping(g).map((b) => b.notation), ['2-1/0-0/1-2/3-3//', '1-1/1-2/1-1/1-0//'], 'raschel-style notation is read in needle spaces');

// 10. every catalogue structure, weft and warp: builds, gives its notation back, repeats, and agrees with the part that already judges it
const rows = Audit.run();
assert(rows.length >= 78, `${rows.length} structures audited`);
for (const r of rows) {
  assert(r.built, `${r.id}: ${r.error}`);
  assert(r.round_trip, `${r.id}: the notation does not come back`);
  assert(r.steady, `${r.id}: not a steady repeat`);
  if (r.studio_knittable != null) assert.strictEqual(r.graph_knittable, r.studio_knittable, `${r.id}: the graph and the existing part disagree`);
}
const w = G.wales(G.fromWeft({ grid: { C: ['KT', 'KT', 'TK', 'TK'] }, feeds: [{}, {}, {}, {}] }));
assert.strictEqual(w.length, 2); assert(w[0].loops.length === 4 && w[0].loops.some((x) => x.kind === 'tuck'));
console.log('Stitch graph tests passed');
