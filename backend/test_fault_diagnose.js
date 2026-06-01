const assert = require('assert');
const { diagnoseFaults, FAULTS_DATABASE } = require('./engine/faults-engine');

console.log("--- Running Fabric Faults Diagnostics Tests ---");

// Test 1: Empty symptoms should return empty list
const resultEmpty = diagnoseFaults([], {});
console.log("Empty symptoms result length (expected 0):", resultEmpty.length);
assert.strictEqual(resultEmpty.length, 0);

// Test 2: Symptoms of Holes
// Selected symptoms: ["holes", "high_tension"]
// This should return "Holes (Broken ends, holes or cracks)" as the top match (highest confidence)
const resultHoles = diagnoseFaults(["holes", "high_tension"], {});
console.log("Holes symptoms diagnostics result:", resultHoles.map(r => `${r.name} (${r.confidence}%)`));
assert(resultHoles.length > 0);
assert.strictEqual(resultHoles[0].id, 'holes');
assert(resultHoles[0].confidence > 50);

// Test 3: Drop Stitches
// Selected symptoms: ["drop_stitch", "broken_hook", "closed_latch"]
const resultDrop = diagnoseFaults(["drop_stitch", "broken_hook", "closed_latch"], {});
console.log("Drop stitch symptoms diagnostics result:", resultDrop.map(r => `${r.name} (${r.confidence}%)`));
assert(resultDrop.length > 0);
assert.strictEqual(resultDrop[0].id, 'drop_stitches');

// Test 4: Verify all 11 faults are present in FAULTS_DATABASE
console.log("Total faults in database (expected 11):", FAULTS_DATABASE.length);
assert.strictEqual(FAULTS_DATABASE.length, 11);

console.log("All Fabric Faults Diagnostics Tests Passed!");
