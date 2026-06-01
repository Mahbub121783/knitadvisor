const { calculate } = require('./engine/calculator.js');
const { FABRIC_DERIVATIVES } = require('./engine/fabric-derivatives.js');

console.log("=== RUNNING TEST FOR 11 NEW FABRIC DERIVATIVES ===");

const testCases = [
  // Rib derivatives
  { fabric: 'rib_2x1', gsm: 220, comp: '100% Cotton' },
  { fabric: 'rib_3x3', gsm: 240, comp: '100% Cotton' },
  { fabric: 'rib_3x2', gsm: 200, comp: '100% Cotton' },
  { fabric: 'rib_4x1', gsm: 180, comp: '100% Cotton' },
  { fabric: 'lycra_rib_2x2', gsm: 260, comp: '95% Cotton + 5% Elastane' },
  // Pointelle variants
  { fabric: 'pointelle_eyelet', gsm: 120, comp: '100% Cotton' },
  { fabric: 'pointelle_chevron', gsm: 140, comp: '100% Cotton' },
  { fabric: 'pointelle_diagonal', gsm: 110, comp: '100% Cotton' },
  // Design textures
  { fabric: 'waffle_knit', gsm: 250, comp: '100% Cotton' },
  { fabric: 'cable_rib', gsm: 320, comp: '100% Cotton' },
  { fabric: 'moss_stitch', gsm: 180, comp: '100% Cotton' }
];

testCases.forEach((tc, idx) => {
  console.log(`\n[${idx + 1}] Testing ${tc.fabric} at ${tc.gsm} GSM (${tc.comp})`);
  const result = calculate({
    fabric: tc.fabric,
    gsm: tc.gsm,
    composition: tc.comp,
    dia: 30,
    gauge: tc.fabric.includes('rib') || tc.fabric.includes('waffle') || tc.fabric.includes('cable') ? 16 : 24,
    rpm: 22
  });

  if (result.error) {
    console.error(`❌ Test Failed: ${result.error}`);
    process.exit(1);
  }

  // Find structure details from fabric-derivatives
  const fDef = FABRIC_DERIVATIVES.find(f => f.id === tc.fabric);
  const s = fDef.structure || {};

  console.log(`   Yarn Count: ${result.yarn.count_display}`);
  console.log(`   Stitch Length: ${result.loop_length.value_mm} mm (Multiplier: ${result.loop_length.multiplier})`);
  console.log(`   Tightness Factor: ${result.physical_constraints?.tightness_factor} (Status: ${result.physical_constraints?.status})`);
  console.log(`   Structure Wales: ${s.wales_per_repeat}, Courses: ${s.courses_per_repeat}`);
  console.log(`   Needle Arrangement: ${s.needle_arrangement?.butt_pattern} (${s.needle_arrangement?.description})`);
  console.log(`   Cam sequence count: ${s.cam?.length || 0}`);
  
  if (result.warnings && result.warnings.length > 0) {
    console.log("   Warnings:");
    result.warnings.forEach(w => console.log(`    - ${w}`));
  }
});

console.log("\n✅ All 11 New Fabric Case Studies Calculated and Validated Successfully!");
