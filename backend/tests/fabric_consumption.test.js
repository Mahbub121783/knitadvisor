const assert = require('assert');
const { calculateFabricConsumption, FLAT_MARKER_LOSS_FALLBACK_PCT } = require('../engine/domain/fabric-consumption-engine');
const { MARKER_EFFICIENCY_BY_GARMENT_TYPE, REJECTION_DAMAGE_PCT_DEFAULT, END_BIT_REMNANT_PCT_DEFAULT, GSM_TOLERANCE_BUFFER_PCT_DEFAULT } = require('../engine/catalog/fabric-consumption-factors');

console.log('--- Running Fabric Consumption Engine Tests ---');

// ============================================================================
// 1. Core gross-up math, hand-verified for a basic tee: 180g net, $4.20/kg,
//    garment_type basic_tshirt (marker loss 13%) + rejection 4% + end-bit 2%
//    + GSM buffer 3% = 22% total wastage.
//    Gross weight = 0.180 * 1.22 = 0.2196 kg = 219.6g
//    Gross cost   = 0.2196 * 4.20 = 0.92232 usd
// ============================================================================
{
  const r = calculateFabricConsumption({
    net_garment_weight_g: 180,
    fabric_cost_per_kg_usd: 4.20,
    garment_type: 'basic_tshirt',
  });
  assert(r.success, `Expected success, got: ${r.error}`);
  assert.strictEqual(r.allowances.total_wastage_pct, 22, `Total wastage should be 22%, got ${r.allowances.total_wastage_pct}`);
  assert(Math.abs(r.gross.weight_g - 219.6) < 0.01, `Gross weight should be ~219.6g, got ${r.gross.weight_g}`);
  assert(Math.abs(r.gross.fabric_cost_usd - 0.9223) < 0.001, `Gross fabric cost should be ~0.9223 usd, got ${r.gross.fabric_cost_usd}`);
  assert(r.gross.fabric_cost_usd > r.net.fabric_cost_usd, 'Gross cost must exceed net cost');
  console.log(`  Core gross-up math correct: net ${r.net.weight_g}g/$${r.net.fabric_cost_usd} -> gross ${r.gross.weight_g}g/$${r.gross.fabric_cost_usd} (${r.allowances.total_wastage_pct}% total wastage)`);
}

// ============================================================================
// 2. Every catalogued garment type's marker-loss default is applied (not the
//    flat fallback), and complexity ranking should track panel complexity:
//    hoodie (most panels) >= jogger >= polo >= tshirt (fewest panels).
// ============================================================================
{
  const losses = {};
  for (const gt of Object.keys(MARKER_EFFICIENCY_BY_GARMENT_TYPE)) {
    const r = calculateFabricConsumption({ net_garment_weight_g: 200, fabric_cost_per_kg_usd: 5, garment_type: gt });
    assert(r.success, `${gt}: expected success, got ${r.error}`);
    assert.strictEqual(r.allowances.marker_cutting_loss_pct.value, MARKER_EFFICIENCY_BY_GARMENT_TYPE[gt].marker_cutting_loss_pct, `${gt}: marker loss should match its catalog default`);
    assert.strictEqual(r.allowances.marker_cutting_loss_pct.source, 'INDUSTRY_TYPICAL');
    assert(!r.warnings.some(w => w.includes('marker-efficiency profile')), `${gt}: a catalogued garment type should not warn about a missing marker-efficiency profile`);
    losses[gt] = r.allowances.marker_cutting_loss_pct.value;
  }
  assert(losses.basic_hoodie > losses.basic_tshirt, 'Hoodie (most panels) should have higher marker loss than a plain tee');
  console.log(`  Per-garment-type marker-loss profiles applied: ${JSON.stringify(losses)}`);
}

// ============================================================================
// 3. Unknown/absent garment_type falls back to the flat default, with a warning.
// ============================================================================
{
  const rUnknown = calculateFabricConsumption({ net_garment_weight_g: 200, fabric_cost_per_kg_usd: 5, garment_type: 'spacesuit' });
  assert(rUnknown.success);
  assert.strictEqual(rUnknown.allowances.marker_cutting_loss_pct.value, FLAT_MARKER_LOSS_FALLBACK_PCT);
  assert(rUnknown.warnings.some(w => w.includes('No marker-efficiency profile')), 'Unknown garment_type should warn');

  const rNone = calculateFabricConsumption({ net_garment_weight_g: 200, fabric_cost_per_kg_usd: 5 });
  assert(rNone.success);
  assert.strictEqual(rNone.allowances.marker_cutting_loss_pct.value, FLAT_MARKER_LOSS_FALLBACK_PCT);
  console.log('  Unknown/absent garment_type falls back to flat 15% marker-loss default with a warning');
}

// ============================================================================
// 4. User overrides for every named allowance percentage are honored and
//    tagged USER_OVERRIDE instead of INDUSTRY_TYPICAL.
// ============================================================================
{
  const r = calculateFabricConsumption({
    net_garment_weight_g: 200,
    fabric_cost_per_kg_usd: 5,
    garment_type: 'basic_tshirt',
    marker_cutting_loss_pct: 25,
    rejection_damage_pct: 10,
    end_bit_remnant_pct: 5,
    gsm_tolerance_buffer_pct: 8,
  });
  assert(r.success);
  assert.strictEqual(r.allowances.marker_cutting_loss_pct.value, 25);
  assert.strictEqual(r.allowances.marker_cutting_loss_pct.source, 'USER_OVERRIDE');
  assert.strictEqual(r.allowances.rejection_damage_pct.source, 'USER_OVERRIDE');
  assert.strictEqual(r.allowances.end_bit_remnant_pct.source, 'USER_OVERRIDE');
  assert.strictEqual(r.allowances.gsm_tolerance_buffer_pct.source, 'USER_OVERRIDE');
  assert.strictEqual(r.allowances.total_wastage_pct, 48, `25+10+5+8=48, got ${r.allowances.total_wastage_pct}`);
  console.log('  All 4 named allowance overrides honored and correctly tagged USER_OVERRIDE');
}

// ============================================================================
// 5. Sample & development allocation: math correct, amortizes over
//    order_quantity when given, warns (does not fail) when absent.
// ============================================================================
{
  const netWeightKg = 0.180;
  const withoutQty = calculateFabricConsumption({ net_garment_weight_g: 180, fabric_cost_per_kg_usd: 4.20, garment_type: 'basic_tshirt' });
  assert(withoutQty.success);
  assert.strictEqual(withoutQty.order, null, 'No order_quantity -> order should be null');
  assert.strictEqual(withoutQty.sample_development.amortized_cost_per_garment_usd, null);
  assert(withoutQty.warnings.some(w => w.includes('order_quantity not provided')), 'Missing order_quantity should warn');

  const piecesEquiv = 2 + 3 + 3 + 6; // defaults: lab_dip 2 + fit 3 + pp 3 + size_set 6 = 14
  const expectedSampleKg = piecesEquiv * netWeightKg * 1.3;
  assert(Math.abs(withoutQty.sample_development.fabric_kg_one_time - expectedSampleKg) < 0.001,
    `Sample fabric kg should be ~${expectedSampleKg.toFixed(4)}, got ${withoutQty.sample_development.fabric_kg_one_time}`);

  const withQty = calculateFabricConsumption({ net_garment_weight_g: 180, fabric_cost_per_kg_usd: 4.20, garment_type: 'basic_tshirt', order_quantity: 5000 });
  assert(withQty.success);
  assert(withQty.order && withQty.order.quantity === 5000);
  assert(withQty.sample_development.amortized_cost_per_garment_usd > 0, 'Sample cost should amortize into a positive per-garment addition');
  assert(withQty.fabric_cost_per_garment_usd > withQty.gross.fabric_cost_usd, 'Final per-garment cost should include the amortized sample addition on top of gross fabric cost');
  const expectedTotalOrderKg = withQty.gross.weight_kg * 5000 + withQty.sample_development.fabric_kg_one_time;
  assert(Math.abs(withQty.order.total_fabric_kg - expectedTotalOrderKg) < 0.01, 'Order total fabric kg should equal (gross per garment * qty) + one-time sample kg');
  console.log(`  Sample/development allocation correct: ${withoutQty.sample_development.fabric_kg_one_time}kg one-time, amortizes to $${withQty.sample_development.amortized_cost_per_garment_usd}/garment at qty 5000`);
}

// ============================================================================
// 6. Sample-development overrides are respected.
// ============================================================================
{
  const r = calculateFabricConsumption({
    net_garment_weight_g: 180,
    fabric_cost_per_kg_usd: 4.20,
    garment_type: 'basic_tshirt',
    sample_development_overrides: { lab_dip_pcs_equivalent: 0, fit_sample_pcs: 0, pp_sample_pcs: 0, size_set_pcs: 0 },
  });
  assert(r.success);
  assert.strictEqual(r.sample_development.pieces_equivalent, 0);
  assert.strictEqual(r.sample_development.fabric_kg_one_time, 0);
  console.log('  sample_development_overrides zeroing out all pieces correctly zeros the sample allocation');
}

// ============================================================================
// 7. Bad-input handling — missing required fields and out-of-range
//    percentages fail cleanly (success:false), never throw.
// ============================================================================
{
  const noWeight = calculateFabricConsumption({ fabric_cost_per_kg_usd: 5 });
  assert(noWeight.success === false && /net_garment_weight_g/.test(noWeight.error));

  const noCost = calculateFabricConsumption({ net_garment_weight_g: 180 });
  assert(noCost.success === false && /fabric_cost_per_kg_usd/.test(noCost.error));

  const badPct = calculateFabricConsumption({ net_garment_weight_g: 180, fabric_cost_per_kg_usd: 5, marker_cutting_loss_pct: 150 });
  assert(badPct.success === false, 'Out-of-range percentage should fail cleanly');

  const negativeWeight = calculateFabricConsumption({ net_garment_weight_g: -50, fabric_cost_per_kg_usd: 5 });
  assert(negativeWeight.success === false, 'Negative weight should fail cleanly');

  console.log('  Bad-input handling OK (no throws)');
}

// ============================================================================
// 8. Sanity cross-check against the catalog defaults directly (guards against
//    the engine and catalog drifting apart silently).
// ============================================================================
{
  const r = calculateFabricConsumption({ net_garment_weight_g: 200, fabric_cost_per_kg_usd: 5, garment_type: 'polo_shirt' });
  assert.strictEqual(r.allowances.rejection_damage_pct.value, REJECTION_DAMAGE_PCT_DEFAULT);
  assert.strictEqual(r.allowances.end_bit_remnant_pct.value, END_BIT_REMNANT_PCT_DEFAULT);
  assert.strictEqual(r.allowances.gsm_tolerance_buffer_pct.value, GSM_TOLERANCE_BUFFER_PCT_DEFAULT);
  console.log('  Engine defaults match catalog constants (no drift)');
}

console.log('\nAll Fabric Consumption Engine Tests Passed!');
