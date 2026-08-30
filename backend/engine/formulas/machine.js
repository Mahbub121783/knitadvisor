/**
 * Machine geometry
 *
 * Needles, feeders, pitch and the suitable-count-for-gauge relations. Pure
 * geometry of a circular knitting machine.
 *
 * Part of the calculation formula section — see index.js.
 */
'use strict';

// ============================================================
// SECTION 8: MACHINE PARAMETER FORMULAS
// Source: KnittingCalculations.pdf p.6, knitcalculation2.pdf p.1
// ============================================================
const MachineFormulas = {

  /**
   * Number of needles = π × Diameter(inches) × Gauge
   * Round to nearest even number
   */
  calcNeedles: (dia_inches, gauge) => {
    const raw = Math.PI * dia_inches * gauge;
    const rounded = Math.round(raw / 2) * 2;  // nearest even
    return { raw: parseFloat(raw.toFixed(2)), rounded };
  },

  /**
   * Theoretical number of feeders = Diameter × 3
   * (Source: efficiency paper section 2.2.5)
   */
  calcFeedersTheoretical: dia_inches => Math.round(dia_inches * 3),

  /**
   * Machine pitch (mm) = 25.4 / Gauge
   */
  calcPitch: gauge => parseFloat((25.4 / gauge).toFixed(4)),

  /**
   * Fabric width from needles and wales per cm
   * Width (cm) = No. of Needles / Wales_per_cm
   * For circular machine: circumference / wales_per_cm → open width = half of circumference
   */
  calcFabricWidth: (needles, wales_per_cm) =>
    parseFloat((needles / wales_per_cm).toFixed(2)),

  calcSystemDensity: (feeders, dia_inches) =>
    parseFloat((feeders / dia_inches).toFixed(4)),

  calcKnittingSpeed: (dia_inches, rpm) =>
    parseFloat((0.00133 * dia_inches * rpm).toFixed(4)),

  calcRpmFromSpeed: (dia_inches, speed_m_s) =>
    parseFloat((speed_m_s / (0.00133 * dia_inches)).toFixed(2)),

  calcSpeedFactor: (feeders, rpm) => feeders * rpm,
};

module.exports = { MachineFormulas };
