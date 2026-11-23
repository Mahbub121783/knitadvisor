// Random designs through every engine and every export (tools/fuzz-studio.js): nothing throws, nothing is NaN, no engine fails silently, the verdict never contradicts its checks.
'use strict';
const assert = require('assert');
const { fuzz } = require('../tools/fuzz-studio');

console.log('--- Running Studio Fuzz Tests ---');
for (const seed of [101, 202, 303]) {
  const { stat, bad } = fuzz(120, seed);
  assert.deepStrictEqual(bad, {}, `seed ${seed}: ${JSON.stringify(bad).slice(0, 600)}`);
  assert(stat.knits > 20 && stat.exportsChecked > 5, `seed ${seed}: the fuzz reached too few knittable designs (${JSON.stringify(stat)})`);
}
console.log('✓ 360 random designs (single, rib, interlock; tucks, misses, transfers, roles, stripes, colours, elastane, 12 fibres): no throw, no NaN, no silent engine failure, same input same answer, and every knittable design survives its exports');
console.log('Studio fuzz tests passed');
