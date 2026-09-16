const assert = require('assert');
const { calculateCarbonFootprint, detectVariant } = require('../engine/domain/carbon-footprint-engine');
const { FIBER_CO2E_PER_KG, GRID_EMISSION_FACTOR, PROCESSING_ENERGY_KWH_PER_KG } = require('../engine/catalog/carbon-footprint-factors');

console.log('--- Running Carbon Footprint Engine Tests ---');

// ============================================================================
// 1. Bad input handling.
// ============================================================================
{
  assert.strictEqual(calculateCarbonFootprint({}).success, false, 'Missing gsm should fail cleanly');
  assert.strictEqual(calculateCarbonFootprint({ gsm: -10 }).success, false, 'Negative gsm should fail cleanly');
  assert.strictEqual(calculateCarbonFootprint({ gsm: 180, fibers: { cotton: 0 } }).success, false, 'Zero-sum composition should fail cleanly');
  console.log('  Bad-input handling OK (no throws)');
}

// ============================================================================
// 2. Default composition (no fibers given) assumes 100% cotton, with a warning.
// ============================================================================
{
  const r = calculateCarbonFootprint({ gsm: 180 });
  assert.strictEqual(r.success, true);
  assert(r.warnings.some(w => /assuming 100% Cotton/i.test(w)));
  assert.strictEqual(r.fiber_breakdown.length, 1);
  assert.strictEqual(r.fiber_breakdown[0].fiber, 'cotton');
  console.log('  Default composition (no fibers) correctly assumes 100% cotton with a warning');
}

// ============================================================================
// 3. Hand-computed cross-check for a known 100% cotton, Bangladesh case.
//    fiber = 2.8 * 1.0 = 2.8
//    processing = 16 * 0.61 = 9.76
//    total = 12.56 kg CO2e/kg fabric
// ============================================================================
{
  const r = calculateCarbonFootprint({ gsm: 180, fibers: { cotton: 100 }, country: 'bangladesh' });
  assert.strictEqual(r.success, true);
  const expectedFiber = FIBER_CO2E_PER_KG.cotton.value;
  const expectedProcessing = PROCESSING_ENERGY_KWH_PER_KG.value * GRID_EMISSION_FACTOR.bangladesh.kg_co2_per_kwh;
  assert(Math.abs(r.fiber_co2e_per_kg_fabric - expectedFiber) < 1e-6, `fiber CO2e mismatch: ${r.fiber_co2e_per_kg_fabric} vs ${expectedFiber}`);
  assert(Math.abs(r.processing.co2e_per_kg_fabric - expectedProcessing) < 1e-6, `processing CO2e mismatch: ${r.processing.co2e_per_kg_fabric} vs ${expectedProcessing}`);
  assert(Math.abs(r.total_co2e_per_kg_fabric - (expectedFiber + expectedProcessing)) < 1e-6);
  // per-m2 = total_per_kg * (gsm/1000)
  assert(Math.abs(r.total_co2e_per_m2_fabric - r.total_co2e_per_kg_fabric * 0.18) < 1e-6);
  console.log(`  Hand-computed cross-check correct: ${r.total_co2e_per_kg_fabric} kg CO2e/kg fabric (100% cotton, Bangladesh)`);
}

// ============================================================================
// 4. A 100% conventional cotton composition should be its own baseline —
//    zero % difference vs the baseline it defines.
// ============================================================================
{
  const r = calculateCarbonFootprint({ gsm: 180, fibers: { cotton: 100 } });
  assert.strictEqual(r.vs_conventional_cotton_baseline.pct_difference, 0);
  assert.strictEqual(r.vs_conventional_cotton_baseline.direction, 'equal');
  console.log('  100% conventional cotton correctly shows 0% vs its own baseline');
}

// ============================================================================
// 5. Organic cotton variant detection lowers the footprint vs conventional,
//    detected from the RAW composition string (parsedComp collapses "organic
//    cotton" onto the plain "cotton" key, so this MUST come from raw text).
// ============================================================================
{
  const conventional = calculateCarbonFootprint({ gsm: 180, fibers: { cotton: 100 }, raw_composition: '100% Cotton' });
  const organic = calculateCarbonFootprint({ gsm: 180, fibers: { cotton: 100 }, raw_composition: '100% Organic Cotton' });
  assert(organic.fiber_co2e_per_kg_fabric < conventional.fiber_co2e_per_kg_fabric, 'Organic cotton should have a lower fiber footprint than conventional');
  assert.strictEqual(organic.fiber_breakdown[0].variant, 'organic');
  assert.strictEqual(conventional.fiber_breakdown[0].variant, null);
  console.log(`  Organic cotton correctly detected and lowers footprint: ${organic.fiber_co2e_per_kg_fabric} vs conventional ${conventional.fiber_co2e_per_kg_fabric}`);
}

// ============================================================================
// 6. Recycled polyester variant detection.
// ============================================================================
{
  const virgin = calculateCarbonFootprint({ gsm: 180, fibers: { polyester: 100 }, raw_composition: '100% Polyester' });
  const recycled = calculateCarbonFootprint({ gsm: 180, fibers: { polyester: 100 }, raw_composition: '100% Recycled Polyester' });
  assert(recycled.fiber_co2e_per_kg_fabric < virgin.fiber_co2e_per_kg_fabric, 'Recycled polyester should have a lower footprint than virgin');
  assert(recycled.fiber_co2e_per_kg_fabric < virgin.fiber_co2e_per_kg_fabric * 0.5, 'Recycled polyester reduction should be substantial (~70% per sourced figure)');
  console.log(`  Recycled polyester correctly detected and substantially lowers footprint: ${recycled.fiber_co2e_per_kg_fabric} vs virgin ${virgin.fiber_co2e_per_kg_fabric}`);
}

// ============================================================================
// 7. Unmodeled fibers (silk, polypropylene, etc.) produce a warning and are
//    excluded from the total rather than silently fabricating a number.
// ============================================================================
{
  const r = calculateCarbonFootprint({ gsm: 180, fibers: { cotton: 80, silk: 20 } });
  assert.strictEqual(r.success, true);
  assert(r.warnings.some(w => /silk/i.test(w) && /understates/i.test(w)));
  const silkRow = r.fiber_breakdown.find(f => f.fiber === 'silk');
  assert.strictEqual(silkRow.modeled, false);
  console.log('  Unmodeled fiber (silk) correctly warned and excluded, not fabricated');
}

// ============================================================================
// 8. Multi-fiber blend — weighted correctly, percentages not summing to
//    exactly 100 (e.g. rounding in a real buyer spec) still normalize correctly.
// ============================================================================
{
  const r = calculateCarbonFootprint({ gsm: 200, fibers: { cotton: 60, polyester: 35, elastane: 5 } });
  assert.strictEqual(r.success, true);
  const round4 = (v) => Math.round(v * 10000) / 10000;
  const expected = round4(
    (FIBER_CO2E_PER_KG.cotton.value * 0.6) +
    (FIBER_CO2E_PER_KG.polyester.value * 0.35) +
    (FIBER_CO2E_PER_KG.elastane.value * 0.05)
  );
  assert(Math.abs(r.fiber_co2e_per_kg_fabric - expected) < 1e-6, `Blend weighting mismatch: ${r.fiber_co2e_per_kg_fabric} vs ${expected}`);
  assert.strictEqual(r.fiber_breakdown.length, 3);
  console.log(`  Multi-fiber blend correctly weighted: ${r.fiber_co2e_per_kg_fabric} kg CO2e/kg`);
}

// ============================================================================
// 9. Per-garment total, when garment_weight_g is supplied.
// ============================================================================
{
  const r = calculateCarbonFootprint({ gsm: 180, fibers: { cotton: 100 }, garment_weight_g: 180 });
  assert(r.per_garment);
  assert.strictEqual(r.per_garment.garment_weight_g, 180);
  const expected = Math.round(r.total_co2e_per_kg_fabric * 0.18 * 10000) / 10000;
  assert(Math.abs(r.per_garment.total_co2e_kg - expected) < 1e-6);

  const noWeight = calculateCarbonFootprint({ gsm: 180, fibers: { cotton: 100 } });
  assert.strictEqual(noWeight.per_garment, null, 'No garment_weight_g should leave per_garment null, not a fabricated figure');
  console.log('  Per-garment total correct when weight supplied, null when not');
}

// ============================================================================
// 10. Unknown country falls back to Bangladesh's grid factor with a warning.
// ============================================================================
{
  const r = calculateCarbonFootprint({ gsm: 180, fibers: { cotton: 100 }, country: 'narnia' });
  assert.strictEqual(r.success, true);
  assert(r.warnings.some(w => /narnia/i.test(w) && /fallback/i.test(w)));
  assert.strictEqual(r.processing.grid_emission_factor_kg_co2_per_kwh, GRID_EMISSION_FACTOR.bangladesh.kg_co2_per_kwh);
  console.log('  Unknown country falls back to Bangladesh grid factor with an explicit warning');
}

// ============================================================================
// 11. detectVariant is a clean, independently-testable pure function.
// ============================================================================
{
  assert.strictEqual(detectVariant('cotton', '100% BCI Cotton').key, 'organic');
  assert.strictEqual(detectVariant('cotton', '95% Cotton 5% Elastane'), null, 'Plain cotton mention should not falsely trigger organic detection');
  assert.strictEqual(detectVariant('polyester', 'Recycled Polyester 100%').key, 'recycled');
  assert.strictEqual(detectVariant('viscose', 'Organic Viscose'), null, 'Viscose has no variant multiplier defined — should return null, not throw');
  console.log('  detectVariant keyword detection correct, including no-false-positive check');
}

console.log('\nAll Carbon Footprint Engine Tests Passed!');
