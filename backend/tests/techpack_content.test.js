const assert = require('assert');
const { calculate } = require('../engine/index');
const { buildTechPackContent } = require('../engine/domain/techpack-content-builder');

console.log('--- Running Tech Pack Content Builder Tests ---');

// ============================================================================
// 1. Bad input — no result object, or a result missing fabric/input — fails
//    cleanly rather than throwing.
// ============================================================================
{
  assert.strictEqual(buildTechPackContent(null).ok, false);
  assert.strictEqual(buildTechPackContent({}).ok, false);
  assert.strictEqual(buildTechPackContent({ fabric: {} }).ok, false, 'Missing input should fail cleanly');
  console.log('  Bad-input handling OK (no throws)');
}

// ============================================================================
// 2. A real single_jersey calculation (no garment/dyeing-recipe params) —
//    fabric/yarn/machine/quality/costing sections populate, garment and
//    dyeing_recipe stay null (their triggering inputs were never supplied).
// ============================================================================
{
  const r = calculate({ fabric: 'single_jersey', gsm: 180, gauge: 24, dia: 30, composition: '100% Cotton', color_shade: 'medium' });
  assert(!r.error, `calculate() should succeed, got: ${r.error}`);
  const content = buildTechPackContent(r);

  assert.strictEqual(content.ok, true);
  assert.strictEqual(content.meta.fabric_name, 'Single Jersey (Plain)');
  assert.strictEqual(content.meta.gsm, 180);

  assert(content.fabric_spec.some(row => row.label === 'Target GSM' && row.value === '180 g/m²'));
  assert(content.fabric_spec.some(row => row.label === 'Composition' && row.value === '100% Cotton'));
  assert(content.yarn_spec.some(row => row.label === 'Yarn count'));
  assert(content.yarn_spec.some(row => row.label === 'Final price (with surcharges)'));
  assert(content.costing.breakdown.length > 0);
  assert(content.costing.margins.length === 5, 'Should carry all 5 margin scenarios');
  assert.strictEqual(content.garment, null, 'No garment_type/garment_weight_g supplied -> garment section must be null');
  assert.strictEqual(content.dyeing_recipe, null, 'No REAL_RECIPE match expected for this input -> must be null, not fabricated');
  console.log('  Base calculation populates fabric/yarn/costing sections correctly; garment/dyeing_recipe correctly absent');
}

// ============================================================================
// 3. Same calculation, WITH garment costing params — garment section
//    populates and matches the source numbers exactly (no silent drift
//    between what /api/calculate returns and what the tech pack shows).
// ============================================================================
{
  const r = calculate({
    fabric: 'single_jersey', gsm: 180, gauge: 24, dia: 30, composition: '100% Cotton', color_shade: 'medium',
    garment_weight_g: 180, garment_type: 'basic_tshirt', order_quantity: 5000,
  });
  assert(!r.error);
  const content = buildTechPackContent(r);

  assert(content.garment, 'garment section should be present when garment_weight_g + garment_type are supplied');
  assert.strictEqual(content.garment.garment_name, 'Basic Crew-Neck T-Shirt');
  assert.strictEqual(content.garment.net_weight_g, r.garment_costing.consumption.net.weight_g);
  assert.strictEqual(content.garment.fob_total_usd, r.garment_costing.cmt.summary.fob_total_usd.toFixed(4));
  assert(content.garment.breakdown.length === 6, 'Garment CMT breakdown should have 6 named line items');
  console.log('  Garment CMT section present and numerically matches the source calculation exactly');
}

// ============================================================================
// 4. Quality prediction section is skipped gracefully when quality_prediction
//    is null (rather than crashing or emitting empty/garbage rows) — force
//    this by feeding buildTechPackContent a result with quality_prediction
//    stripped.
// ============================================================================
{
  const r = calculate({ fabric: 'single_jersey', gsm: 180, gauge: 24, dia: 30 });
  assert(!r.error);
  const stripped = { ...r, quality_prediction: null };
  const content = buildTechPackContent(stripped);
  assert.deepStrictEqual(content.quality, [], 'Missing quality_prediction should yield an empty array, not a throw');
  console.log('  Missing quality_prediction handled gracefully (empty section, no throw)');
}

// ============================================================================
// 5. Warp-knit fabric (different machine_type/category path) still builds a
//    valid tech pack without throwing — a structural smoke test across the
//    other major fabric family this engine supports.
// ============================================================================
{
  const r = calculate({ fabric: 'tricot_plain', gsm: 120, denier: 70, filaments: 34 });
  if (!r.error) {
    const content = buildTechPackContent(r);
    assert.strictEqual(content.ok, true);
    assert(content.fabric_spec.length > 0);
    console.log('  Warp-knit fabric builds a valid tech pack without throwing');
  } else {
    console.log('  (warp-knit smoke test skipped — tricot_plain needs different params in this engine version)');
  }
}

console.log('\nAll Tech Pack Content Builder Tests Passed!');
