// Fabric Studio: a drawing is named and described from its own programme.
// The family (the measured constants the weight borrows from) is a separate line;
// it never stands in for what the drawing is.
const assert = require('assert');
const studio = require('../engine/domain/fabric-studio');
console.log('--- Running Studio Identity Tests ---');

const run = (C, D, roles, gating = 'rib') => studio.analyse({
  bed: D ? 'double' : 'single', gating, grid: { C, D: D || undefined },
  feeds: roles.map((role) => ({ role })), yarn: { fibre: 'cotton', count: 30, unit: 'ne' }, target: { gsm: 180 }, machine: {},
});
const id = (r) => r.structure.identity;

// plain jersey
let r = run([['K', 'K'], ['K', 'K']], null, ['ground', 'ground']);
assert.strictEqual(id(r).title, 'Single bed · plain knit');

// a knit-and-miss drawing is described as that, whatever its weighing family
r = run([['K', 'M', 'K', 'M'], ['M', 'K', 'M', 'K']], null, ['ground', 'ground']);
assert.strictEqual(id(r).title, 'Single bed · knit and miss (float)');
assert.strictEqual(id(r).longest_float, 1);
assert.ok(/miss 50%/.test(id(r).detail), id(r).detail);
assert.strictEqual(r.structure.family, 'single_jersey', 'weighed on the jersey constants, but not called jersey');

// a longer float is measured from the drawing
r = run([['K', 'M', 'M', 'M'], ['M', 'K', 'K', 'K']], null, ['ground', 'ground']);
assert.strictEqual(id(r).longest_float, 3);
assert.ok(/longest float 3 needles/.test(id(r).detail));

// tuck + knit; tucks stacking is read down the repeat
r = run([['K', 'T'], ['K', 'T'], ['K', 'K']], null, ['ground', 'ground', 'ground']);
assert.strictEqual(id(r).title, 'Single bed · knit and tuck');
assert.strictEqual(id(r).tuck_stack, 2);

// a double bed names its gating and what is on it
r = run([['K', 'K'], ['K', 'K']], [['K', 'K'], ['K', 'K']], ['ground', 'ground'], 'rib');
assert.ok(/^Double bed · rib gating/.test(id(r).title), id(r).title);

console.log('✓ Studio identity tests passed');
