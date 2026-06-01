const { calculate } = require('./engine/calculator.js');

console.log("=== HEAVY SINGLE JERSEY TEST (BEFORE CHANGES) ===");

const testGSMs = [260, 280, 300, 320, 340, 350];
const compositions = [
  '100% Cotton',
  '95% Cotton + 5% Elastane',
  '60% Cotton + 40% Polyester'
];

testGSMs.forEach(gsm => {
  compositions.forEach(comp => {
    console.log(`\n--------------------------------------------------`);
    console.log(`GSM: ${gsm} | Composition: ${comp}`);
    const result = calculate({
      fabric: 'heavy_jersey',
      gsm,
      composition: comp,
      gauge: gsm >= 340 ? 14 : (gsm >= 300 ? 16 : 18),
      dia: 30,
      rpm: 20
    });

    if (result.error) {
      console.error(`Error: ${result.error}`);
      return;
    }

    console.log(`Yarn Count Ne: ${result.yarn.count_ne} (Exact: ${result.yarn.count_ne_exact}) [Display: ${result.yarn.count_display}]`);
    console.log(`Stitch Length: ${result.loop_length.value_mm} mm (Source: ${result.loop_length.multiplier_source})`);
    if (result.physical_constraints) {
      console.log(`Tightness Factor: ${result.physical_constraints.tightness_factor} (Status: ${result.physical_constraints.status})`);
    } else {
      console.log(`Tightness Factor: N/A`);
    }
    
    if (result.warnings && result.warnings.length > 0) {
      console.log("Warnings:");
      result.warnings.forEach(w => console.log(` - ${w}`));
    }
  });
});
