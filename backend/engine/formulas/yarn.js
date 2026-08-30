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

// Tight/loose limits per fabric FAMILY (see domain/factory-knowledge.js's
// FAB_BUCKET_ALIAS — every catalogued fabric maps to one of these 8 keys).
//
// Derived from the 2,201 real production records in data/factory-records.json,
// each contributing its own TF = sqrt(590.5/ne) / (sl/10). The two tiers answer
// two different questions and are built two different ways.
//
//   min / max              CAN this be knitted? Set to the observed extremes
//                          with 1 unit of margin, so it covers 100% of real
//                          production. Crossing it reports UNKNITTABLE.
//
//   ideal_min / ideal_max  is this a NORMAL construction? p10/p90, rounded
//                          outward, so 82-96% of real production reads as
//                          normal and the warning is reserved for the tails.
//
// Why the hard band is not a percentile. It was briefly set to p2/p98, which
// sounds rigorous and declares 4% of genuinely shipped fabric physically
// impossible — a real 200 GSM cotton fleece at TF 13.4 came back
// UNKNITTABLE_TIGHT. A statistical tail is not a physical limit. Real
// production defines what is possible, so the hard band takes the extremes.
//
// Two records are excluded from the extremes, on physics rather than
// statistics: both are 18-gauge with a stitch length of 1.05 and 1.1 mm, and
// an 18 GG needle pitch is 25.4/18 = 1.41 mm. A loop cannot be shorter than
// the pitch it spans, so those rows are measurement errors, not tight fabric.
// They alone pushed rib's ceiling from 30 to 41 and would have made the band
// meaningless. Every other record is kept, outliers included.
//
// The ideal band was previously documented as p25/p75, which flags half of all
// production by construction. On interlock that was severe: its distribution is
// dense between 13.5 and 14.3 (38 of 50 records at or below 14.0) against an
// ideal_min of 14, so 76% of real interlock came back warned "too loose".
//
// Rounding is OUTWARD, never to-nearest — these distributions are concentrated
// enough that rounding to the nearest 0.5 cuts through a dense cluster and
// recreates the same false-warning problem at a smaller scale.
//
// Re-derive with scripts/calibrate-tightness.js whenever factory_records grows.
const TIGHTNESS_LIMITS = {
  'single_jersey': { min: 8,  max: 32, ideal_min: 14.5, ideal_max: 18.5 },
  'heavy_jersey':  { min: 11, max: 20, ideal_min: 12.5, ideal_max: 14 },
  'rib':           { min: 8,  max: 30, ideal_min: 14.5, ideal_max: 18.5 },
  'interlock':     { min: 12, max: 30, ideal_min: 13.5, ideal_max: 20 },
  'pique':         { min: 14, max: 22, ideal_min: 17,   ideal_max: 19.5 },
  'waffle':        { min: 12, max: 28, ideal_min: 14,   ideal_max: 17.5 },
  'terry':         { min: 7,  max: 22, ideal_min: 9,    ideal_max: 10 },
  'fleece':        { min: 8,  max: 17, ideal_min: 9,    ideal_max: 10 },
  'default':       { min: 7,  max: 32, ideal_min: 12,   ideal_max: 20 }
};

module.exports = { YarnCountFormulas, TIGHTNESS_LIMITS };
