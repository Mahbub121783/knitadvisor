/**
 * Loop length
 *
 * The two published stitch-length models: the per-structure multiplier and the
 * book K constants. Both are only reached when no factory record supplies a real
 * measured SL.
 *
 * Part of the calculation formula section — see index.js.
 */
'use strict';

// ============================================================
// SECTION 7: LOOP LENGTH SHORTCUT FORMULAS
// Source: KnittingCalculations.pdf p.14 & Understanding Textile for Marchandiser p.512
// LL in mm, Count in Ne, GSM in g/m²
// ============================================================
const LOOP_LENGTH_MULTIPLIERS = {
  // { structure: multiplier }  — base constant = 1257.765 for 24 GG
  'single_jersey':   { multiplier: 1.0,  base_gauge: 24, constant: 1257.765 },
  'rib_1x1':         { multiplier: 1.4,  base_gauge: 18, constant: 1257.765 },
  'interlock':       { multiplier: 1.9,  base_gauge: 24, constant: 1257.765 },
  // Terry uses different approach (two yarns); use machine specs method
  // For others: multiplier is proportional to fabric tightness factor
  'pique':           { multiplier: 1.3,  base_gauge: 24, constant: 1257.765 },
  'rib_2x2':         { multiplier: 1.45, base_gauge: 18, constant: 1257.765 },
  'fleece':          { multiplier: 1.0,  base_gauge: 18, constant: 1257.765 },  // front yarn
  'terry':           { multiplier: 1.0,  base_gauge: 20, constant: 1257.765 },  // ground yarn
};

// Exact K constants from 'Understanding Textile for Marchandiser' Page 512
// Formula: LL (mm) = K / (Ne * GSM)
const BOOK_K_CONSTANTS = {
  'single_jersey': 12068.509,
  'heavy_jersey': 12068.509,
  'lacoste_double': 14855.2,
  'rib_1x1': 16431.497,
  'lycra_rib_1x1': 16431.497,
  'rib_2x1': 19005.333,
  'interlock': 24013.8,
};

/**
 * Calculate loop length (mm) from GSM, count, and structure
 * Formula: LL = constant × multiplier / (Count × GSM)
 * If exact K constant is available from 'Understanding Textile for Marchandiser', use it.
 */
function calcLoopLength(structure, count_ne, gsm) {
  if (BOOK_K_CONSTANTS[structure] !== undefined) {
    return BOOK_K_CONSTANTS[structure] / (count_ne * gsm);
  }
  const lld = LOOP_LENGTH_MULTIPLIERS[structure];
  if (!lld) throw new Error(`No LL data for: ${structure}`);
  return (lld.constant * lld.multiplier * 10) / (count_ne * gsm); // base constant gives cm; *10 for mm
}

module.exports = { LOOP_LENGTH_MULTIPLIERS, BOOK_K_CONSTANTS, calcLoopLength };
