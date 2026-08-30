/**
 * Production rate
 *
 * Output in kg/hr for spun (Ne) and filament (denier) yarn, plus the running
 * metre and open-width relations. The denominator constant is the unit chain
 * spelled out rather than folded into one number.
 *
 * Part of the calculation formula section — see index.js.
 */
'use strict';

// ============================================================
// SECTION 9: PRODUCTION CALCULATION FORMULAS
// VERIFIED with worked examples from PDFs
// ============================================================
const ProductionFormulas = {

  /**
   * COTTON YARN — Universal production formula
   * Source: KnittingCalculations.pdf p.6-7, verified example 07
   *
   * Production_kg/hr = (π × D × G × Feeders × SL_mm × RPM × 60 × E/100)
   *                    / (10 × 2.54 × 36 × 840 × Count × 2.2046)
   *
   * Where:
   *   D = machine diameter (inches)
   *   G = gauge (needles/inch)
   *   SL_mm = stitch length (millimeters)
   *   RPM = machine speed (revolutions per minute)
   *   E = efficiency (%, e.g. 85)
   *   Count = yarn count (Ne, English cotton count)
   *
   * Denominator constant = 10 × 2.54 × 36 × 840 × 2.2046 = 1,693,382
   * (unit chain: mm→cm /10, cm→inch /2.54, inch→yard /36, yarn count hank 840, kg/lb 2.2046)
   */
  cotton_per_hour(dia_in, gauge, feeders, sl_mm, rpm, count_ne, efficiency_pct) {
    const needles = Math.PI * dia_in * gauge;
    const numerator = needles * feeders * sl_mm * rpm * 60 * (efficiency_pct / 100);
    const denominator = 10 * 2.54 * 36 * 840 * count_ne * 2.2046;
    return parseFloat((numerator / denominator).toFixed(4)); // kg/hour
  },

  /**
   * FILAMENT YARN (denier) — Production formula
   * Source: KnittingCalculations.pdf p.8, verified example 08
   *
   * Production_kg/hr = (π × D × G × Feeders × SL_mm × RPM × 60 × Denier × E/100)
   *                    / (1000 × 9000 × 1000)
   *
   * Unit chain: needles × SL_mm × RPM × 60 / 1000 = meters of yarn
   *             meters × denier / 9000 = grams / 1000 = kg
   */
  filament_per_hour(dia_in, gauge, feeders, sl_mm, rpm, denier, efficiency_pct) {
    const needles = Math.PI * dia_in * gauge;
    const yarn_m_per_hour = needles * feeders * sl_mm * rpm * 60 / 1000;
    const weight_g = yarn_m_per_hour * denier / 9000;
    return parseFloat(((weight_g / 1000) * (efficiency_pct / 100)).toFixed(4)); // kg/hour
  },

  calcRunningMetersPerHour(rpm, feeders, efficiency_pct, feeders_per_course, courses_per_cm) {
    const efficiency = efficiency_pct / 100;
    const num = rpm * feeders * efficiency * 60;
    const den = feeders_per_course * courses_per_cm * 100;
    return parseFloat((num / den).toFixed(4));
  },

  calcOpenWidth(dia_in, gauge, wales_per_cm) {
    return parseFloat(((Math.PI * dia_in * gauge) / (wales_per_cm * 100)).toFixed(4));
  },

  calcProductionKgPerHourFromRunningMeters(running_m_hr, width_m, gsm) {
    return parseFloat(((running_m_hr * width_m * gsm) / 1000).toFixed(4));
  },

  calcProductionKgPerHourDirectNe(rpm, feeders, dia_in, gauge, sl_cm, efficiency_pct, count_ne) {
    const eff = efficiency_pct / 100;
    const factor = 0.00001112598;
    const num = rpm * feeders * (dia_in * gauge * sl_cm) * eff * Math.PI * factor;
    return parseFloat((num / count_ne).toFixed(4));
  },

  /**
   * Convert kg/hour to kg/day (assuming 24h operation or custom hours)
   */
  per_day: (kg_per_hour, hours = 24) =>
    parseFloat((kg_per_hour * hours).toFixed(2)),

  per_shift: (kg_per_hour, hours = 8) =>
    parseFloat((kg_per_hour * hours).toFixed(2)),
};

module.exports = { ProductionFormulas };
