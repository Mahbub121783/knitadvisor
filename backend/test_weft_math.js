const assert = require('assert');
const { WeftCalculators, ProductionFormulas } = require('./engine/formulas');

console.log("--- Running Weft Knitting Calculation Tests ---");

// Test 1: Stitch Density (S = K / l^2)
// For K = 20, loop_length = 0.28 cm (2.8 mm)
// S = 20 / (0.28 * 0.28) = 255.102 loops/cm²
const s = WeftCalculators.calcStitchDensity(0.28, 20);
console.log(`Stitch Density (expected ~255.102): ${s}`);
assert(Math.abs(s - 255.102) < 0.01);

// Test 2: Cover Factor (CF = sqrt(Tex) / l_cm)
// count Ne = 30 => Tex = 590.5 / 30 = 19.6833
// CF = sqrt(19.6833) / 0.28 = 4.4366 / 0.28 = 15.845
const tex = 590.5 / 30;
const cf = WeftCalculators.calcCoverFactor(tex, 0.28);
console.log(`Cover Factor (expected ~15.845): ${cf}`);
assert(Math.abs(cf - 15.845) < 0.01);

// Test 3: GSM from Stitch Density
// GSM = (S * l_cm * Tex) / 10
// For S = 255.102, l = 0.28, Tex = 19.6833
// GSM = (255.102 * 0.28 * 19.6833) / 10 = 140.60
const gsm = WeftCalculators.calcGSMFromStitchDensity(s, 0.28, tex);
console.log(`Calculated GSM (expected ~140.60): ${gsm}`);
assert(Math.abs(gsm - 140.60) < 0.05);

// Test 4: Optimum Gauge from Tex (Single Jersey)
// G = sqrt(1650/Tex) in needles/cm => npi = G * 2.54 = 2.54 * sqrt(1650/Tex)
// For Tex = 19.6833
// G = sqrt(1650/19.6833) = sqrt(83.827) = 9.1557 needles/cm
// npi = 9.1557 * 2.54 = 23.255 needles/inch (GG)
const gauge_sj = WeftCalculators.calcOptimumGaugeFromTex(tex, false);
console.log(`Optimum SJ Gauge npi (expected ~23.26): ${gauge_sj.npi}`);
assert(Math.abs(gauge_sj.npi - 23.26) < 0.05);

// Test 5: Optimum Gauge from Tex (Double Jersey)
// G = sqrt(1400/Tex) needles/cm => npi = 2.54 * sqrt(1400/Tex)
// For Tex = 19.6833
// G = sqrt(1400/19.6833) = 8.4338
// npi = 8.4338 * 2.54 = 21.42
const gauge_dj = WeftCalculators.calcOptimumGaugeFromTex(tex, true);
console.log(`Optimum DJ Gauge npi (expected ~21.42): ${gauge_dj.npi}`);
assert(Math.abs(gauge_dj.npi - 21.42) < 0.05);

// Test 6: Running meters per hour
// L = (rpm * feeders * eff * 60) / (feeders_per_course * courses_per_cm * 100)
// For rpm = 25, feeders = 96, eff = 85%, feeders_per_course = 1, courses_per_cm = 20
// L = (25 * 96 * 0.85 * 60) / (1 * 20 * 100) = 122400 / 2000 = 61.2 m/hr
const length = ProductionFormulas.calcRunningMetersPerHour(25, 96, 85, 1, 20);
console.log(`Running Meters per Hour (expected 61.2): ${length}`);
assert.strictEqual(length, 61.2);

// Test 7: Open Width in meters
// W = (pi * dia * gauge) / (wales_per_cm * 100)
// For dia = 30", gauge = 24, wales_per_cm = 11
// W = (pi * 30 * 24) / (11 * 100) = 2261.9467 / 1100 = 2.0563 meters
const width = ProductionFormulas.calcOpenWidth(30, 24, 11);
console.log(`Fabric Open Width (expected ~2.0563): ${width}`);
assert(Math.abs(width - 2.0563) < 0.01);

// Test 8: Production Weight from meters (kg/hr)
// P = (L * W * GSM) / 1000
// For L = 61.2, W = 2.0563, GSM = 180
// P = (61.2 * 2.0563 * 180) / 1000 = 22.684
const weight_m = ProductionFormulas.calcProductionKgPerHourFromRunningMeters(length, width, 180);
console.log(`Production Weight via meters (expected ~22.684): ${weight_m}`);
assert(Math.abs(weight_m - 22.684) < 0.05);

// Test 9: Production Weight direct Ne (kg/hr)
// P = (rpm * feeders * dia * gauge * sl_cm * eff * pi * factor) / count_ne
// where factor = 0.00001112598
// For rpm=25, feeders=96, dia=30, gauge=24, sl_cm=0.28, eff=85%, count_ne=30
// P = (25 * 96 * 30 * 24 * 0.28 * 0.85 * pi * 0.00001112598) / 30
const weight_ne = ProductionFormulas.calcProductionKgPerHourDirectNe(25, 96, 30, 24, 0.28, 85, 30);
console.log(`Production Weight via Ne (expected ~0.4792): ${weight_ne}`);
assert(Math.abs(weight_ne - 0.4792) < 0.05);

console.log("All Weft Knitting Calculation Tests Passed!");
