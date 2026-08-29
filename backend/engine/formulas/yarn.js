/**
 * Yarn count and tightness
 *
 * Count arithmetic (Ne / Tex / denier / hank), the cover-factor helpers, and the
 * tightness factor TF = sqrt(Tex) / SL_cm together with the per-family bands that
 * decide whether a construction is knittable.
 *
 * Part of the calculation formula section — see index.js.
 */
'use strict';

// ============================================================
// SECTION 3: YARN COUNT FORMULAS
// Source: KnittingCalculations.pdf p.3
// ============================================================
const YarnCountFormulas = {

  // Cotton Ne (English count)
  // Ne = number of 840-yard hanks per pound
  ne_from_length_weight: (length_yards, weight_lb) =>
    length_yards / (weight_lb * 840),

  length_from_ne_weight: (ne, weight_lb) =>
    ne * 840 * weight_lb,   // returns yards

  weight_lb_from_ne_length: (ne, length_yards) =>
    length_yards / (ne * 840),  // returns pounds

  // Denier (filament, e.g. polyester)
  // Denier = grams per 9000 meters
  denier_length_from_weight: (weight_grams, denier) =>
    (weight_grams * 9000) / denier,  // returns meters

  denier_weight_from_length: (length_meters, denier) =>
    (length_meters * denier) / 9000, // returns grams

  denier_from_weight_length: (weight_grams, length_meters) =>
    (9000 * weight_grams) / length_meters,

  // Universal Yarn Count Converter (Supporting all 12 units from book)
  convertYarnCount(value, from, to) {
    const f = from.toLowerCase();
    const t = to.toLowerCase();
    if (f === t) return value;

    // 1. Convert to Tex (reference unit)
    let tex;
    if (f === 'tex') {
      tex = value;
    } else if (f === 'denier' || f === 'den') {
      tex = value / 9;
    } else if (f === 'dtex') {
      tex = value / 10;
    } else if (f === 'mtex') {
      tex = value / 1000;
    } else if (f === 'ktex') {
      tex = value * 1000;
    } else if (f === 'jute') {
      tex = value * 34.448;
    } else if (f === 'ne') {
      tex = 590.5 / value;
    } else if (f === 'nm') {
      tex = 1000 / value;
    } else if (f === 'nek') {
      tex = 886.0 / value;
    } else if (f === 'nel') {
      tex = 1654.0 / value;
    } else if (f === 'new' || f === 'ysw') {
      tex = 1938.0 / value;
    } else if (f === 'dewsbury') {
      tex = 31004.0 / value;
    } else {
      throw new Error(`Unsupported from unit: ${from}`);
    }

    // 2. Convert from Tex to target unit
    if (t === 'tex') {
      return tex;
    } else if (t === 'denier' || t === 'den') {
      return tex * 9;
    } else if (t === 'dtex') {
      return tex * 10;
    } else if (t === 'mtex') {
      return tex * 1000;
    } else if (t === 'ktex') {
      return tex / 1000;
    } else if (t === 'jute') {
      return tex / 34.448;
    } else if (t === 'ne') {
      return 590.5 / tex;
    } else if (t === 'nm') {
      return 1000 / tex;
    } else if (t === 'nek') {
      return 886.0 / tex;
    } else if (t === 'nel') {
      return 1654.0 / tex;
    } else if (t === 'new' || t === 'ysw') {
      return 1938.0 / tex;
    } else if (t === 'dewsbury') {
      return 31004.0 / tex;
    } else {
      throw new Error(`Unsupported to unit: ${to}`);
    }
  },

  // Calculate Ply Count (Resultant Count)
  calcPlyCount(yarns, system) {
    if (!yarns || yarns.length === 0) return null;
    const sys = system.toLowerCase();
    const isDirect = ['tex', 'denier', 'den', 'dtex', 'mtex', 'ktex', 'jute'].includes(sys);

    if (isDirect) {
      // Direct count: sum of counts
      return yarns.reduce((sum, y) => sum + parseFloat(y), 0);
    } else {
      // Indirect count: 1 / sum(1/count)
      const sumRecip = yarns.reduce((sum, y) => sum + (1 / parseFloat(y)), 0);
      return 1 / sumRecip;
    }
  },

  // Calculate length of sewing thread/yarn on cone (in meters)
  calcConeLength(count, system, weight_g) {
    const sys = system.toLowerCase();
    if (sys === 'ne') {
      return count * weight_g * 1.6933; // Book constant (Page 49)
    }
    if (sys === 'nm') {
      return count * weight_g; // Book constant (Page 49)
    }
    const tex = this.convertYarnCount(count, system, 'tex');
    return (weight_g * 1000) / tex;
  },

  // Calculate weight of sewing thread/yarn on cone (in grams)
  calcConeWeight(count, system, length_m) {
    const sys = system.toLowerCase();
    if (sys === 'ne') {
      return length_m / (count * 1.6933);
    }
    if (sys === 'nm') {
      return length_m / count;
    }
    const tex = this.convertYarnCount(count, system, 'tex');
    return (length_m * tex) / 1000;
  },

  // Suitable count for machine gauge
  // Source: KnittingCalculations.pdf p.1
  suitable_count_single_jersey: gauge => (gauge * gauge) / 18,
  suitable_count_double_jersey: gauge => (gauge * gauge) / 15.3,

  // Tightness Factor (TF) calculations
  // TF = sqrt(Tex) / StitchLength_cm
  calcTightnessFactor: (tex, ll_cm) => {
    if (!tex || !ll_cm || ll_cm <= 0) return null;
    return parseFloat((Math.sqrt(tex) / ll_cm).toFixed(2));
  }
};

// Tight/loose limits per fabric FAMILY (see factory-knowledge.js's
// FAB_BUCKET_ALIAS — every one of the 54 catalogued fabrics maps to one of
// these 8 keys). Recalibrated from the real factory dataset
// (backend/data/factory-records.json, computed TF = sqrt(590.5/Ne)/(SL_cm)
// against each record's actual ne/sl): min/max ≈ the 2nd/98th percentile of
// TF genuinely observed in real production for that family, ideal_min/max ≈
// the 25th/75th percentile. This replaced numbers that were miscalibrated
// two different ways — (1) rib/interlock/single_jersey ceilings were low
// enough that 4-11% of REAL, already-produced fabric in the dataset would
// have been flagged "un-knittable" under them (e.g. a real, exact-match 420
// GSM rib record sits at TF≈19.6, above the old max of 18); (2) terry/fleece
// (pile structures, whose ground-yarn-only TF is inherently much lower than a
// plain structure's) were never actually reaching a dedicated limit at all —
// a bug in the old category-string matching meant they silently fell back to
// the single_jersey/default limits, which sit far above where real terry/
// fleece production actually falls (median TF ≈9.4), so nearly all real
// terry/fleece would have shown a false "too loose" warning.
const TIGHTNESS_LIMITS = {
  'single_jersey': { min: 12, max: 21, ideal_min: 14, ideal_max: 18 },
  'heavy_jersey':  { min: 10, max: 19, ideal_min: 12, ideal_max: 15 },
  'rib':           { min: 12, max: 21, ideal_min: 14, ideal_max: 18 },
  'interlock':     { min: 12, max: 30, ideal_min: 14, ideal_max: 20 },
  'pique':         { min: 14, max: 21, ideal_min: 16, ideal_max: 19 },
  'waffle':        { min: 12, max: 28, ideal_min: 14, ideal_max: 19 },
  'terry':         { min: 7,  max: 17, ideal_min: 8,  ideal_max: 11 },
  'fleece':        { min: 7,  max: 14, ideal_min: 8,  ideal_max: 10.5 },
  'default':       { min: 10, max: 22, ideal_min: 12, ideal_max: 20 }
};

module.exports = { YarnCountFormulas, TIGHTNESS_LIMITS };
