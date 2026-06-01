/**
 * Test Suite for KnitAdvisor Production Critical Path Analysis (CPA)
 * and Dynamic Stitch Structure Adaptations.
 */

const { calculate } = require('./engine/calculator');
const { getPattern } = require('./engine/pattern-engine');
const { analyzeCriticalPath } = require('./engine/critical-path');

console.log("================================================================");
console.log("RUNNING KNITADVISOR CRITICAL PATH & STITCH ADAPTATION TEST SUITE");
console.log("================================================================\n");

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`[FAIL] ${message}`);
    failedTests++;
  }
}

// ----------------------------------------------------------------
// TEST CASE 1: Heavy Rib 2x2 Drop Needle adaptation
// ----------------------------------------------------------------
try {
  console.log("--- Test Case 1: Rib 2x2 Drop Needle Adaptation (High GSM, GG >= 18) ---");
  const pattern = getPattern('rib_2x2', 240, 18, '100% Cotton');
  
  assert(pattern !== null, "Pattern is generated successfully");
  assert(pattern.courses_per_repeat === 1, "Courses per repeat adjusted to 1");
  assert(pattern.wales_per_repeat === 5, "Wales per repeat adjusted to 5 (4 active + 1 dropped)");
  assert(pattern.needle_arrangement.butt_pattern === 'CC__DD__', "Needle arrangement butt pattern updated to drop-needle CC__DD__");
  assert(pattern.structure_note.includes("Heavy fabric drop-needle configuration active"), "Structure note contains drop-needle details");
} catch (err) {
  console.error("Test Case 1 failed with error:", err);
  failedTests++;
}

// ----------------------------------------------------------------
// TEST CASE 2: Lycra Rib Full-Feed vs Half-Feed Plating
// ----------------------------------------------------------------
try {
  console.log("\n--- Test Case 2: Lycra Rib 1x1 Plating Adaptation ---");
  // Light GSM
  const patternLight = getPattern('lycra_rib_1x1', 160, 18, '95% Cotton 5% Elastane');
  assert(patternLight.structure_note.includes("Half-feed Lycra plating"), "Light Lycra Rib selects Half-feed");

  // Heavy GSM
  const patternHeavy = getPattern('lycra_rib_1x1', 230, 18, '95% Cotton 5% Elastane');
  assert(patternHeavy.structure_note.includes("Full-feed Lycra plating"), "Heavy Lycra Rib selects Full-feed");
} catch (err) {
  console.error("Test Case 2 failed with error:", err);
  failedTests++;
}

// ----------------------------------------------------------------
// TEST CASE 3: Single Pique Tuck-to-Miss weight reduction
// ----------------------------------------------------------------
try {
  console.log("\n--- Test Case 3: Single Pique Tuck-to-Miss Adaptation (High GSM) ---");
  const pattern = getPattern('pique_single', 240, 24, '100% Cotton');
  
  assert(pattern.pattern_cylinder[1][1] === 'M', "Second course tuck loop converted to Miss ('M') loop");
  assert(pattern.pattern_cylinder[3][0] === 'M', "Fourth course tuck loop converted to Miss ('M') loop");
  assert(pattern.structure_note.includes("tuck-to-miss adaptation active"), "Structure note mentions tuck-to-miss activation");
} catch (err) {
  console.error("Test Case 3 failed with error:", err);
  failedTests++;
}

// ----------------------------------------------------------------
// TEST CASE 4: French Terry Sinker Loop Height Multiplier
// ----------------------------------------------------------------
try {
  console.log("\n--- Test Case 4: French Terry Loop Height Adaptation ---");
  const patternLight = getPattern('french_terry', 200, 18, '100% Cotton');
  assert(patternLight.structure_note.includes("loop height set to 1.6×"), "Light French Terry has 1.6x multiplier note");

  const patternHeavy = getPattern('french_terry', 260, 18, '100% Cotton');
  assert(patternHeavy.structure_note.includes("sinker loop height multiplier increased to 2.2×"), "Heavy French Terry has 2.2x multiplier note");
} catch (err) {
  console.error("Test Case 4 failed with error:", err);
  failedTests++;
}

// ----------------------------------------------------------------
// TEST CASE 5: CPA Yarn-to-Needle Slot Collision Index
// ----------------------------------------------------------------
try {
  console.log("\n--- Test Case 5: CPA Slot Clearance Warnings ---");
  
  // Scenario 5a: Thick yarn on fine gauge (Critical Tight)
  const cpaTight = analyzeCriticalPath({
    fabricId: 'single_jersey',
    category: 'single_jersey',
    gsm: 200,
    countNe: 12, // very thick
    loopLengthMm: 2.8,
    dia: 30,
    gauge: 28, // very fine
    feeders: 90,
    rpm: 20
  });
  assert(cpaTight.clearance.status === 'CRITICAL_TIGHT', "Detected critical tight yarn slot clearance");
  assert(cpaTight.warnings.some(w => w.includes("Yarn-to-Slot clearance index")), "Tight clearance triggers warning in warning list");

  // Scenario 5b: Thin yarn on coarse gauge (Warning Loose)
  const cpaLoose = analyzeCriticalPath({
    fabricId: 'single_jersey',
    category: 'single_jersey',
    gsm: 90,
    countNe: 40, // very thin
    loopLengthMm: 2.6,
    dia: 30,
    gauge: 12, // very coarse
    feeders: 96,
    rpm: 20
  });
  assert(cpaLoose.clearance.status === 'WARNING_LOOSE', "Detected too loose yarn slot clearance");
} catch (err) {
  console.error("Test Case 5 failed with error:", err);
  failedTests++;
}

// ----------------------------------------------------------------
// TEST CASE 6: CPA Torque & Spirality Skewness Angle
// ----------------------------------------------------------------
try {
  console.log("\n--- Test Case 6: CPA Torque & Spirality Skewness ---");
  
  // Single Jersey (prone to spirality)
  const cpaSj = analyzeCriticalPath({
    fabricId: 'single_jersey',
    category: 'single_jersey',
    gsm: 160,
    countNe: 30,
    loopLengthMm: 2.8,
    dia: 30,
    gauge: 24,
    feeders: 96, // many feeders → high pitch angle
    rpm: 26,
    composition: '100% Cotton Carded' // high twist/torque
  });
  assert(cpaSj.spirality.risk === 'HIGH', "High spirality risk detected on single jersey with high feed pitch and carded cotton");
  assert(cpaSj.spirality.angle_degrees > 7.0, `Spirality angle is estimated at ${cpaSj.spirality.angle_degrees}°`);

  // Double bed (balanced structure)
  const cpaRib = analyzeCriticalPath({
    fabricId: 'rib_1x1',
    category: 'rib',
    gsm: 200,
    countNe: 28,
    loopLengthMm: 3.2,
    dia: 30,
    gauge: 18,
    feeders: 60,
    rpm: 20
  });
  assert(cpaRib.spirality.risk === 'LOW', "Double bed structures have low spirality risk");
  assert(cpaRib.spirality.angle_degrees === 0, "Double bed spirality angle is 0");
} catch (err) {
  console.error("Test Case 6 failed with error:", err);
  failedTests++;
}

// ----------------------------------------------------------------
// TEST CASE 7: CPA Speed Limit (RPM)
// ----------------------------------------------------------------
try {
  console.log("\n--- Test Case 7: CPA RPM mechanical limits ---");
  
  const cpaSpeed = analyzeCriticalPath({
    fabricId: 'single_jersey',
    category: 'single_jersey',
    gsm: 150,
    countNe: 30,
    loopLengthMm: 2.8,
    dia: 30,
    gauge: 24,
    feeders: 90,
    rpm: 130 // exceeds safe speed ceiling
  });
  
  assert(cpaSpeed.speed.status === 'EXCEEDS_SAFE_LIMIT', "RPM exceed status flagged correctly");
  assert(cpaSpeed.warnings.some(w => w.includes("Machine RPM exceeds safe running speed limit")), "RPM limit violation triggers warning");
} catch (err) {
  console.error("Test Case 7 failed with error:", err);
  failedTests++;
}

// ----------------------------------------------------------------
// TEST CASE 8: Full Calculator Integration
// ----------------------------------------------------------------
try {
  console.log("\n--- Test Case 8: Main Calculator API Response Integration ---");
  
  const result = calculate({
    fabric: 'rib_2x2',
    gsm: 240,
    gauge: 18,
    dia: 30,
    rpm: 22,
    composition: '100% Cotton Combed'
  });

  assert(result.success === true, "Calculator successfully computed result");
  assert(result.pattern !== null, "Pattern embedded directly in response");
  assert(result.pattern.wales_per_repeat === 5, "Dynamic drop needle pattern is returned");
  assert(result.critical_path !== null, "Critical path analysis is returned in response");
  assert(result.critical_path.setup.cam_timing === 'Delayed Timing', "CPA correctly identified Delayed Timing requirement for tight rib");
} catch (err) {
  console.error("Test Case 8 failed with error:", err);
  failedTests++;
}

console.log("\n================================================================");
console.log(`TEST SUITE COMPLETE: ${passedTests} passed, ${failedTests} failed`);
console.log("================================================================");
process.exit(failedTests > 0 ? 1 : 0);
