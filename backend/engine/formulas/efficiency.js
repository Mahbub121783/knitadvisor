/**
 * Machine efficiency
 *
 * Efficiency, loss and the theoretical-versus-actual comparison.
 *
 * Part of the calculation formula section — see index.js.
 */
'use strict';

// ============================================================
// SECTION 12: EFFICIENCY CALCULATION
// Source: EfficiencyLossesCalculation.pdf p.2
// ============================================================
const EfficiencyFormulas = {
  /**
   * Machine efficiency (%) = Actual_production / Calculated_production × 100
   */
  machineEfficiency: (actual_kg, theoretical_kg) =>
    parseFloat(((actual_kg / theoretical_kg) * 100).toFixed(2)),

  /**
   * Efficiency loss (%) = 100 - efficiency_%
   */
  efficiencyLoss: efficiency_pct => parseFloat((100 - efficiency_pct).toFixed(2)),

  /**
   * Production loss per day = theoretical_per_day - actual_per_day
   */
  productionLoss_kg: (theoretical_kg_day, actual_kg_day) =>
    parseFloat((theoretical_kg_day - actual_kg_day).toFixed(2)),
};

module.exports = { EfficiencyFormulas };
