// Fabric Studio: every feeder role works with every programme — the engine
// gives each combination its mechanical meaning instead of refusing it:
//   - a loop yarn that knits is a sinker-loop pile when a pile is chosen, and
//     otherwise knits in as a jersey course of that yarn (said in the checks)
//   - pile courses may alternate with plain courses
//   - a loop yarn never tied in is an error check, not a refusal
//   - a binder with no loop yarn is a plain ground course
//   - brushing is a choice: unbrushed fleece is a loopback, heavier than
//     raised; brushing a jersey costs a little weight; the 3D follows it
// plus a sweep of random roles × programmes × finishes: nothing throws or refuses.
const assert = require('assert');
const studio = require('../engine/domain/fabric-studio');
const map = require('../../frontend/assets/js/studio-cloth-map.js');
console.log('--- Running Studio Role Tests ---');

const f = (...r) => r.map((role) => ({ role }));
const run = (o) => studio.analyse({ bed: 'single', gating: 'rib', yarn: { fibre: 'cotton' }, target: { gsm: 260 }, machine: {}, ...o });
const has = (r, re, level) => r.checks.some((c) => re.test(c.text) && (!level || c.level === level));

// the case that used to be refused: binder / face / loop, all knitting
const pile = run({ grid: { C: ['K', 'K', 'K'] }, feeds: f('binder', 'face', 'loop'), pile: 'sinker' });
assert(pile.success && pile.structure.family === 'plush', 'a pile with plain courses is analysed');
assert(has(pile, /Pile on 1 of 3 knitting feeds/, 'warn'));
assert.strictEqual(pile.plush_spread.arrangement, 'diagonal', 'one pile course in three = one pile loop in three');
assert.strictEqual(pile.yarn.feeds.length, 4, 'ground, pile and the two plain courses are all listed');
const knitIn = run({ grid: { C: ['K', 'K', 'K'] }, feeds: f('binder', 'face', 'loop'), pile: 'none' });
assert(knitIn.success && knitIn.structure.family === 'single_jersey');
assert.deepStrictEqual(knitIn.structure.roles_drawn, ['binder', 'face', 'loop']);
assert.strictEqual(knitIn.yarn.feeds[2].role, 'ground'); assert.strictEqual(knitIn.yarn.feeds[2].role_drawn, 'loop');
assert(has(knitIn, /carries the loop yarn but knits/, 'warn') && has(knitIn, /binder, but no feeder lays a loop yarn/));

// loop yarn never tied in: an error check, the numbers still come
const loose = run({ grid: { C: ['KKKK', 'MMMM'] }, feeds: f('ground', 'loop') });
assert(loose.success && !loose.ok_to_knit && has(loose, /never tucks or knits/, 'error'));

// brushing is a choice
const FL = { grid: { C: ['KKKK', 'KKKK', 'TMMM', 'KKKK', 'KKKK', 'MMTM'] }, feeds: f('face', 'binder', 'loop', 'face', 'binder', 'loop'), machine: { sl_mm: 4.4 } };
const raised = run({ ...FL, finish: { brush: 'back' } }), loopback = run({ ...FL, finish: { brush: 'none' } });
assert(loopback.fabric.gsm > raised.fabric.gsm, 'an unbrushed fleece keeps its loop yarn: heavier at the same stitch length');
assert(raised.finish.loop_yarn_raised_pct > 5 && raised.finish.nap_mm > 0.5);
assert.strictEqual(loopback.finish.fabric_loss_pct, 0);
const legacy = run(FL);
assert.strictEqual(legacy.fabric.gsm, raised.fabric.gsm, 'older clients: a fleece is raised, as before');
const J = { grid: { C: ['K'] }, feeds: f('ground'), machine: { sl_mm: 2.8 } };
const jp = run({ ...J, finish: { brush: 'none' } }), jb = run({ ...J, finish: { brush: 'both' } });
assert(jb.fabric.gsm < jp.fabric.gsm && jb.fabric.gsm > jp.fabric.gsm * 0.94, 'a brushed jersey loses a little surface fibre');

// the real view follows the same reading
const cs = (o) => map.clothSpec({ bed: 'single', C: o.C.map((r) => r.split('')), feeds: o.feeds, brush: o.brush, pile: o.pile, plush: o.plush });
assert.strictEqual(cs({ C: FL.grid.C, feeds: FL.feeds, brush: 'none' }).construction.type, 'terry', 'unbrushed fleece: loopback back, no nap');
const br = cs({ C: FL.grid.C, feeds: FL.feeds, brush: 'back' }).construction;
assert(br.type === 'fleece' && br.brush && br.pile === 'brush', 'brushed fleece: the nap');
assert.strictEqual(cs({ C: ['K', 'K', 'K'], feeds: f('binder', 'face', 'loop'), pile: 'none' }).construction.type, 'jersey', 'a knitting loop yarn without a pile is a jersey course');
assert.strictEqual(cs({ C: ['K'], feeds: f('ground'), brush: 'both' }).construction.brush, true, 'brushed jersey shows a nap');
assert.strictEqual(cs({ C: ['K'], feeds: f('ground'), brush: 'none' }).construction.brush, false, 'no brushing, no nap');

// sweep: roles × programmes × pile × finish — nothing throws, nothing is refused
let seed = 11;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
for (let i = 0; i < 400; i++) {
  const bed = pick(['single', 'single', 'rib', 'interlock']);
  const F = 1 + Math.floor(rnd() * 6), W = 1 + Math.floor(rnd() * 6);
  const sym = pick([['K', 'T', 'M'], ['K', 'K', 'T', 'M'], ['K', 'M'], ['T', 'M', 'M']]);
  const g = () => Array.from({ length: F }, () => Array.from({ length: W }, () => pick(sym)).join(''));
  const r = studio.analyse({
    bed: bed === 'single' ? 'single' : 'double', gating: bed === 'interlock' ? 'interlock' : 'rib', grid: { C: g(), D: bed === 'single' ? null : g() },
    feeds: Array.from({ length: F }, () => ({ role: pick(['ground', 'face', 'binder', 'loop']) })), yarn: { fibre: pick(['cotton', 'cvc', 'polyester_spun']) },
    target: { gsm: 120 + Math.floor(rnd() * 300) }, machine: {}, pile: pick(['sinker', 'none']),
    finish: { brush: pick(['none', 'back', 'face', 'both']), sheared: rnd() < 0.3 }, plush: { cut: rnd() < 0.5, arrangement: pick(['full', 'alternate', 'checker', 'diagonal']) },
  });
  assert(r.success, `sweep ${i}: ${r.error}`);
  assert(Number.isFinite(r.fabric.gsm) && (r.fabric.gsm > 0 || !r.ok_to_knit), `sweep ${i}: a weight, or an error that says why there is none`);
}
console.log('Studio role tests passed');
