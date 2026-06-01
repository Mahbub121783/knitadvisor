const assert = require('assert');
const { GLOSSARY, BASIC_ELEMENTS, FORMATION_CYCLES, QUIZ_QUESTIONS } = require('./engine/academy-engine');

console.log("--- Running Knitting Academy Engine Tests ---");

// Test 1: Glossary Data completeness
console.log("Checking Glossary Terminology...");
assert(GLOSSARY.kink_of_yarn !== undefined);
assert(GLOSSARY.knitted_loop !== undefined);
assert(GLOSSARY.knitted_stitch !== undefined);
assert(GLOSSARY.stitch_density !== undefined);
assert(GLOSSARY.stitch_length !== undefined);
assert.strictEqual(GLOSSARY.needle_loop.page, "326");
console.log(`✅ Glossary loaded. Total terms: ${Object.keys(GLOSSARY).length}`);

// Test 2: Needle elements
console.log("Checking Needle Parts...");
const needles = BASIC_ELEMENTS.needles;
assert(needles.latch !== undefined);
assert(needles.spring_bearded !== undefined);
assert(needles.compound !== undefined);
assert.strictEqual(needles.latch.parts.hook, "Encloses and retains the yarn during stitch formation.");
assert.strictEqual(needles.latch.parts.butt, "The protrusion that contacts cam profiles to displace the needle vertically.");
console.log("✅ Needle parts checked.");

// Test 3: Cycles
console.log("Checking Stitch Cycle stages...");
assert(FORMATION_CYCLES.bearded.length === 7);
assert(FORMATION_CYCLES.latch.length === 9);
assert(FORMATION_CYCLES.compound.length === 10);
assert.strictEqual(FORMATION_CYCLES.latch[0].name, "Clearing");
assert.strictEqual(FORMATION_CYCLES.latch[6].name, "Casting-off or knocking-over");
console.log("✅ Cycle steps verified.");

// Test 4: Quiz
console.log("Checking Quiz questions...");
assert.strictEqual(QUIZ_QUESTIONS.length, 30);
assert.strictEqual(QUIZ_QUESTIONS[0].id, "q1");
assert.strictEqual(QUIZ_QUESTIONS[0].answer, 1); // 1 = "Kink of yarn"
assert.strictEqual(QUIZ_QUESTIONS[29].id, "q30"); // Question 30 should exist

// Test answer validation mock
const question = QUIZ_QUESTIONS[0];
const verifyCorrect = (choice) => choice === question.answer;
assert.strictEqual(verifyCorrect(1), true);  // Kink of yarn
assert.strictEqual(verifyCorrect(0), false); // Knitted loop
console.log("✅ Quiz logic and question structure verified.");

// Test 5: Weft Machinery
console.log("Checking Weft Machine details...");
const machinery = BASIC_ELEMENTS.machinery;
assert(machinery.single_jersey !== undefined);
assert(machinery.rib !== undefined);
assert(machinery.interlock !== undefined);
assert(machinery.flat_bed !== undefined);
assert(machinery.links_links !== undefined);
assert.strictEqual(machinery.single_jersey.formula, "Ne = G² / 18 (where Ne is Cotton Count and G is Gauge in npi)");
assert.strictEqual(machinery.rib.formula, "Ne = G² / 15.3 (where Ne is Cotton Count and G is Gauge in npi)");
console.log("✅ Weft Machinery properties verified.");

console.log("All Knitting Academy Engine Tests Passed!");
