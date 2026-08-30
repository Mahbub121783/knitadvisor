/**
 * Weft knitting arithmetic
 *
 * Courses, wales, stitch density and the loop-length-per-course relations from
 * the weft-knitting literature.
 *
 * Part of the calculation formula section — see index.js.
 */
'use strict';

// ============================================================
// SECTION 14: WEFT KNITTING ARITHMETIC (Understanding Textile pp.501-512)
// ============================================================
const WeftCalculators = {
  calcStitchDensity(loop_length_cm, k_constant) {
    return parseFloat((k_constant / (loop_length_cm * loop_length_cm)).toFixed(4));
  },
  calcCoverFactor(tex, loop_length_cm) {
    return parseFloat((Math.sqrt(tex) / loop_length_cm).toFixed(4));
  },
  calcGSMFromStitchDensity(stitch_density, loop_length_cm, tex) {
    return parseFloat(((stitch_density * loop_length_cm * tex) / 10).toFixed(2));
  },
  calcOptimumGaugeFromTex(tex, isDouble) {
    const factor = isDouble ? 1400 : 1650;
    const npc = Math.sqrt(factor / tex);
    const npi = npc * 2.54;
    return { npc: parseFloat(npc.toFixed(4)), npi: parseFloat(npi.toFixed(2)) };
  },
  calcOptimumTexFromGauge(gauge, isDouble) {
    const factor = isDouble ? 1400 : 1650;
    const multiplier = factor * 2.54 * 2.54;
    return parseFloat((multiplier / (gauge * gauge)).toFixed(4));
  }
};

module.exports = { WeftCalculators };
