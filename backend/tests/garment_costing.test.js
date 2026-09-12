const assert = require('assert');
const { calculateGarmentCosting } = require('../engine/domain/garment-costing-engine');
const { buildGarmentSam, GARMENT_CATALOG } = require('../engine/catalog/garment-operations');
const { getWageGrade, STANDARD_WORKING_MINUTES_PER_MONTH, BD_WAGE_GRADES } = require('../engine/catalog/bd-wage-board');

console.log('--- Running Garment CMT Costing Tests ---');

// ============================================================================
// 1. Cross-check the CM (cost-per-minute) formula against the sourced worked
//    example: salary 6000, 20 workers, 480 shift-minutes, 80% efficiency ->
//    cost per SAM-minute = 0.78 (ordnur.com / textilecalculations.com).
//    This engine's formula: CM_100 = salary / (workers*shiftMin), then
//    cost-per-SAM-minute = CM_100 / efficiencyFraction.
// ============================================================================
{
  const salary = 6000, workers = 20, shiftMin = 480, efficiencyPct = 80;
  const cm100 = salary / (workers * shiftMin); // 0.625
  const costPerSamMinute = cm100 / (efficiencyPct / 100); // 0.78125, source rounds this to "0.78"
  assert(Math.round(costPerSamMinute * 100) / 100 === 0.78,
    `CM formula cross-check failed: expected ~0.78 (source's rounding), got ${costPerSamMinute}`);
  console.log(`  CM formula matches sourced example: ${costPerSamMinute} (source states 0.78)`);
}

// ============================================================================
// 2. Each garment type's built SAM should land close to its cited benchmark
//    (by construction — the operation list was tuned to it) — this guards
//    against a future edit to the operation list silently drifting away from
//    the sourced total without anyone noticing.
// ============================================================================
for (const [id, def] of Object.entries(GARMENT_CATALOG)) {
  const build = buildGarmentSam(id);
  const diff = Math.abs(build.sam_minutes - def.benchmark_sam);
  assert(diff < 0.1,
    `${id}: built SAM ${build.sam_minutes} drifted from benchmark ${def.benchmark_sam} (diff ${diff.toFixed(3)})`);
  console.log(`  ${id}: SAM ${build.sam_minutes} min matches benchmark ${def.benchmark_sam} min (${def.benchmark_source})`);
}

// ============================================================================
// 3. Wage grade lookup: exact grades resolve, unknown grade falls back to
//    Grade 3 (documented default), and every grade's gross > basic (never
//    the other way around, which would mean the table got typo'd).
// ============================================================================
for (const g of BD_WAGE_GRADES) {
  assert(g.gross_bdt > g.basic_bdt, `Grade ${g.grade}: gross (${g.gross_bdt}) must exceed basic (${g.basic_bdt})`);
}
assert(getWageGrade(3).grade === 3, 'Grade 3 should resolve directly');
assert(getWageGrade(99).grade === 3, 'Unknown grade should fall back to Grade 3');
assert(STANDARD_WORKING_MINUTES_PER_MONTH === 26 * 8 * 60, 'Working minutes/month should be 26 days x 8h x 60min = 12,480');
console.log('  Wage grade table and fallback OK');

// ============================================================================
// 4. Full engine run for all 4 garment types — must succeed, produce a
//    sane FOB total (> fabric cost alone, since CMT/overhead/profit are
//    added on top), and the fabric-share sanity warning should behave as
//    designed: silent inside 40-80%, present outside it.
// ============================================================================
const FABRIC_COST_TYPICAL = 1.20; // USD, plausible for a basic 180gsm cotton tee at ~180g

for (const garmentType of Object.keys(GARMENT_CATALOG)) {
  const r = calculateGarmentCosting({
    garment_type: garmentType,
    fabric_cost_per_garment_usd: FABRIC_COST_TYPICAL,
  });
  assert(r.success, `${garmentType}: engine should succeed, got error: ${r.error}`);
  assert(r.summary.fob_total_usd > FABRIC_COST_TYPICAL, `${garmentType}: FOB total must exceed fabric-only cost`);
  assert(r.cmt_total_usd > 0, `${garmentType}: CMT total must be positive`);
  assert(r.summary.fabric_share_pct_of_fob > 0 && r.summary.fabric_share_pct_of_fob < 100,
    `${garmentType}: fabric share must be a real percentage`);
  console.log(`  ${garmentType}: FOB $${r.summary.fob_total_usd} (fabric $${FABRIC_COST_TYPICAL} = ${r.summary.fabric_share_pct_of_fob}%, CMT $${r.cmt_total_usd})`);
}

// ============================================================================
// 5. Fabric-share sanity warning: force it both ways.
// ============================================================================
{
  // Absurdly cheap fabric relative to a heavy-CMT garment -> fabric share low -> warning
  const low = calculateGarmentCosting({ garment_type: 'basic_hoodie', fabric_cost_per_garment_usd: 0.05 });
  assert(low.warnings.some(w => w.includes('Fabric is')), 'Very low fabric share should warn');

  // Absurdly expensive fabric relative to a light-CMT garment -> fabric share high -> warning
  const high = calculateGarmentCosting({ garment_type: 'basic_tshirt', fabric_cost_per_garment_usd: 50 });
  assert(high.warnings.some(w => w.includes('Fabric is')), 'Very high fabric share should warn');

  // A realistic mid-range case should NOT warn
  const mid = calculateGarmentCosting({ garment_type: 'basic_tshirt', fabric_cost_per_garment_usd: 1.20 });
  assert(!mid.warnings.some(w => w.includes('Fabric is')), `Typical case should not warn, got: ${JSON.stringify(mid.warnings)}`);
  console.log('  Fabric-share sanity warning fires/stays silent correctly');
}

// ============================================================================
// 6. Complexity add-ons increase SAM (and therefore making cost) without
//    touching the base garment's own operations.
// ============================================================================
{
  const base = calculateGarmentCosting({ garment_type: 'basic_hoodie', fabric_cost_per_garment_usd: 2.0 });
  const withZip = calculateGarmentCosting({ garment_type: 'basic_hoodie', fabric_cost_per_garment_usd: 2.0, addons: ['full_zipper'] });
  assert(withZip.sam.sewing.sam_minutes > base.sam.sewing.sam_minutes, 'Adding a zipper should increase SAM');
  assert(withZip.labor.making_cost_usd > base.labor.making_cost_usd, 'Adding a zipper should increase making cost');
  console.log(`  Add-on (full_zipper) increases SAM: ${base.sam.sewing.sam_minutes} -> ${withZip.sam.sewing.sam_minutes} min`);
}

// ============================================================================
// 7. Bad input handling — unknown garment type and missing fabric cost both
//    fail cleanly (success: false + a readable error), never throw.
// ============================================================================
{
  const badGarment = calculateGarmentCosting({ garment_type: 'spacesuit', fabric_cost_per_garment_usd: 1 });
  assert(badGarment.success === false && /Unknown garment_type/.test(badGarment.error), 'Unknown garment_type should fail cleanly');

  const noFabricCost = calculateGarmentCosting({ garment_type: 'basic_tshirt' });
  assert(noFabricCost.success === false, 'Missing fabric_cost_per_garment_usd should fail cleanly');
  console.log('  Bad-input handling OK (no throws)');
}

console.log('\nAll Garment CMT Costing Tests Passed!');
