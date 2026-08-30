/**
 * Fabric weight and area
 *
 * GSM from a measured swatch, weight from GSM, tubular and open-width variants,
 * and the fibre-percentage split for blends.
 *
 * Part of the calculation formula section — see index.js.
 */
'use strict';

// ============================================================
// SECTION 10: FABRIC WEIGHT / AREA / GSM FORMULAS
// Source: KnittingCalculations.pdf pp.12-13
// ============================================================
const FabricWeightFormulas = {

  /**
   * GSM from fabric dimensions and weight
   * GSM = Weight_g / (Length_m × Width_m)
   * For tubular fabric: Width_m = tubular_width_m × 2
   */
  calcGSM: (weight_g, length_m, width_m) =>
    parseFloat((weight_g / (length_m * width_m)).toFixed(2)),

  calcGSM_tubular: (weight_g, length_m, tubular_width_m) =>
    parseFloat((weight_g / (length_m * tubular_width_m * 2)).toFixed(2)),

  /**
   * Fabric weight from GSM, length, width
   * Weight_kg = GSM × Length_m × Width_m / 1000
   */
  calcWeight_kg: (gsm, length_m, width_m) =>
    parseFloat((gsm * length_m * width_m / 1000).toFixed(3)),

  /**
   * Yarn consumption for tubular fabric
   * Source: KnittingCalculations.pdf p.14 "YARN CONSUMPTION = LENGTH × WIDTH × GSM × 2 / 10000 (IF TUBULAR)"
   * Returns kg
   */
  calcYarnConsumption_tubular_kg: (length_m, width_tubular_m, gsm) =>
    parseFloat((length_m * width_tubular_m * 2 * gsm / 10000).toFixed(3)),

  // GSM / OSY conversions
  gsmToOsy: gsm => parseFloat((gsm * 0.836 / 28.35).toFixed(3)),
  osyToGsm: osy => parseFloat((osy * 28.35 / 0.836).toFixed(2)),
};

// ============================================================
// SECTION 11: FIBER PERCENTAGE IN BLENDED FABRICS
// Source: KnittingCalculations.pdf p.14
// ============================================================
function calcFiberPercentage(yarns) {
  // yarns: array of { weight_kg, fiber_composition: [{fiber, pct}] }
  const totalWeight = yarns.reduce((s, y) => s + y.weight_kg, 0);
  const fiberWeights = {};
  yarns.forEach(yarn => {
    yarn.fiber_composition.forEach(({ fiber, pct }) => {
      fiberWeights[fiber] = (fiberWeights[fiber] || 0) + yarn.weight_kg * pct / 100;
    });
  });
  const result = {};
  Object.keys(fiberWeights).forEach(f => {
    result[f] = parseFloat(((fiberWeights[f] / totalWeight) * 100).toFixed(2));
  });
  return result;
}

module.exports = { FabricWeightFormulas, calcFiberPercentage };
