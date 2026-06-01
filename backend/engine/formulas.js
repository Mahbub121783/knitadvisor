/**
 * KnitAdvisor Formula Engine — v1.0
 * Source: Verified directly from PDF documents
 * All formulas 100% deterministic. AI never touches these calculations.
 */

// ============================================================
// SECTION 1: UNIT CONVERSION CONSTANTS
// Source: KnittingCalculations.pdf pp.3-13
// ============================================================
const UNITS = {
  // Length
  METER_TO_INCH: 39.37,
  METER_TO_YARD: 1.0936,
  YARD_TO_METER: 0.9144,
  YARD_TO_INCH: 36,
  INCH_TO_CM: 2.54,
  INCH_TO_MM: 25.4,
  CM_TO_MM: 10,

  // Weight
  KG_TO_LB: 2.2046,
  LB_TO_KG: 0.4536,
  LB_TO_GRAM: 453.6,
  OZ_TO_GRAM: 28.35,        // Precise: 28.3495g (PDF uses 28g as approximation)
  OZ_TO_GRAM_PDF: 28,       // As used in PDF examples

  // Area
  SQ_YARD_TO_SQ_METER: 0.836,  // 1 sq yard = 0.836 m² (PDF value)
  SQ_YARD_TO_SQ_METER_PRECISE: 0.83613,

  // Yarn count hank lengths (yards per pound per count)
  COTTON_HANK: 840,         // 1 hank of cotton = 840 yards
  WORSTED_HANK: 560,
  WOOLLEN_HANK: 256,
  LINEN_HANK: 300,

  // Denier
  DENIER_BASE: 9000,        // 9000 meters per gram per denier unit

  // Gauge
  INCH_TO_GAUGE_MM: 25.4,   // pitch_mm = 25.4 / gauge
};

// ============================================================
// SECTION 2: UNIT CONVERTER FUNCTIONS
// ============================================================
const UnitConverter = {

  // Length conversions
  mmToCm: mm => mm / 10,
  cmToMm: cm => cm * 10,
  cmToInch: cm => cm / 2.54,
  inchToCm: inch => inch * 2.54,
  inchToMm: inch => inch * 25.4,
  mmToInch: mm => mm / 25.4,
  meterToYard: m => m * 1.0936,
  yardToMeter: yd => yd * 0.9144,
  meterToInch: m => m * 39.37,
  inchToMeter: inch => inch / 39.37,
  cmToYard: cm => cm / 91.44,
  yardToCm: yd => yd * 91.44,

  // Weight conversions
  kgToLb: kg => kg * 2.2046,
  lbToKg: lb => lb * 0.4536,
  kgToGram: kg => kg * 1000,
  gramToKg: g => g / 1000,
  lbToGram: lb => lb * 453.6,
  gramToLb: g => g / 453.6,
  ozToGram: oz => oz * 28.35,
  gramToOz: g => g / 28.35,

  // Grammage (fabric weight) conversions
  // GSM = grams per square meter
  // OSY = ounces per square yard
  gsmToOsy: gsm => gsm * 0.836 / 28.35,  // GSM × (0.836 m²/sqyd) / (28.35g/oz)
  osyToGsm: osy => osy * 28.35 / 0.836, // inverse
  // Simplified PDF version (1oz=28g, 1sqyd=0.836m²)
  gsmToOsy_pdf: gsm => gsm * 0.836 / 28,
  osyToGsm_pdf: osy => osy * 28 / 0.836,

  // Yarn count system conversions
  // Ne (English count, cotton) ↔ Tex ↔ Denier
  neToTex: ne => 590.5 / ne,
  texToNe: tex => 590.5 / tex,
  neToDenier: ne => 5905 / ne,  // Denier = Tex × 9 = (590.5/Ne) × 9 = 5314.5/Ne, use 5905 for Dtex
  denierToNe: d => 5315 / d,
  texToDenier: tex => tex * 9,
  denierToTex: d => d / 9,

  // Machine gauge ↔ pitch
  gaugeToPitch_mm: gauge => 25.4 / gauge,   // pitch in mm = 25.4 / gauge
  pitchToGauge: pitch_mm => 25.4 / pitch_mm,

  // Universal length converter (returns value in target unit)
  convertLength(value, from, to) {
    // Normalise to meters first
    const toMeters = { mm: 0.001, cm: 0.01, inch: 0.0254, yard: 0.9144, meter: 1 };
    const fromMeters = { mm: 1000, cm: 100, inch: 39.37, yard: 1.0936, meter: 1 };
    if (!toMeters[from] || !fromMeters[to]) throw new Error(`Unknown unit: ${from} or ${to}`);
    return value * toMeters[from] * fromMeters[to];
  },

  // Universal weight converter
  convertWeight(value, from, to) {
    const toGrams = { gram: 1, kg: 1000, lb: 453.6, oz: 28.35 };
    const fromGrams = { gram: 1, kg: 0.001, lb: 1/453.6, oz: 1/28.35 };
    if (!toGrams[from] || !fromGrams[to]) throw new Error(`Unknown unit: ${from} or ${to}`);
    return value * toGrams[from] * fromGrams[to];
  },
};

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
  suitable_count_double_jersey: gauge => (gauge * gauge) / 8.4,

  // Tightness Factor (TF) calculations
  // TF = sqrt(Tex) / StitchLength_cm
  calcTightnessFactor: (tex, ll_cm) => {
    if (!tex || !ll_cm || ll_cm <= 0) return null;
    return parseFloat((Math.sqrt(tex) / ll_cm).toFixed(2));
  }
};

// Default tight and loose limits for various fabric categories based on industry standards
const TIGHTNESS_LIMITS = {
  'single_jersey': { min: 11, max: 19, ideal_min: 13, ideal_max: 17 },
  'heavy_jersey': { min: 13, max: 28, ideal_min: 16, ideal_max: 25 },
  'interlock': { min: 12, max: 20, ideal_min: 14, ideal_max: 18 },
  'rib': { min: 10, max: 18, ideal_min: 12, ideal_max: 16 },
  'fleece': { min: 14, max: 22, ideal_min: 16, ideal_max: 20 },
  'default': { min: 10, max: 22, ideal_min: 12, ideal_max: 20 }
};

// ============================================================
// SECTION 4: GSM ↔ YARN COUNT REGRESSION FORMULAS
// Source: 448733518GSMtoCountConversion.pdf pp.2-3
// Formula: Count = a × GSM + b  (linear regression, Ne)
// ============================================================
const GSM_COUNT_REGRESSION = {
  // Structure: { a: slope, b: intercept, gsm_min, gsm_max, gauge_note }
  'single_jersey':    { a: -0.141, b: 50.22, gsm_min: 100, gsm_max: 260, gauge: 24 },
  'interlock':        { a: -0.206, b: 80.56, gsm_min: 150, gsm_max: 380, gauge: 24 },
  'pique':            { a: -0.146, b: 57.16, gsm_min: 130, gsm_max: 280, gauge: 24 },
  'rib_1x1':          { a: -0.123, b: 54.57, gsm_min: 130, gsm_max: 300, gauge: 18 },
  'double_lacoste':   { a: -0.167, b: 64.36, gsm_min: 150, gsm_max: 280, gauge: 24 },
  'lycra_rib_1x1':    { a: -0.119, b: 59.12, gsm_min: 150, gsm_max: 260, gauge: 18 },
  'lycra_rib_2x2':    { a: -0.108, b: 56.62, gsm_min: 180, gsm_max: 280, gauge: 18 },
};

function calcCountFromGSM(fabricType, gsm) {
  const reg = GSM_COUNT_REGRESSION[fabricType];
  if (!reg) throw new Error(`No regression data for: ${fabricType}`);
  if (gsm < reg.gsm_min || gsm > reg.gsm_max)
    console.warn(`GSM ${gsm} outside validated range [${reg.gsm_min}–${reg.gsm_max}] for ${fabricType}`);
  return reg.a * gsm + reg.b;
}

// Inverse: GSM from count (for validation)
function calcGSMFromCount(fabricType, count) {
  const reg = GSM_COUNT_REGRESSION[fabricType];
  if (!reg) throw new Error(`No regression data for: ${fabricType}`);
  return (count - reg.b) / reg.a;
}

// ============================================================
// SECTION 5: GSM ↔ COUNT LOOKUP TABLES (Non-regression fabrics)
// Source: 448733518GSMtoCountConversion.pdf p.1
// ============================================================
const GSM_COUNT_LOOKUP = {
  'single_jersey_table': [
    { count: 40, gsm_min: 100, gsm_max: 120, gsm_lycra_min: 140, gsm_lycra_max: 150 },
    { count: 34, gsm_min: 130, gsm_max: 140, gsm_lycra_min: 170, gsm_lycra_max: 180 },
    { count: 30, gsm_min: 140, gsm_max: 150, gsm_lycra_min: 180, gsm_lycra_max: 200 },
    { count: 28, gsm_min: 150, gsm_max: 160, gsm_lycra_min: 200, gsm_lycra_max: 210 },
    { count: 26, gsm_min: 160, gsm_max: 170, gsm_lycra_min: 220, gsm_lycra_max: 230 },
    { count: 24, gsm_min: 170, gsm_max: 180, gsm_lycra_min: 230, gsm_lycra_max: 240 },
    { count: 22, gsm_min: 190, gsm_max: 200, gsm_lycra_min: 250, gsm_lycra_max: 260 },
    { count: 20, gsm_min: 200, gsm_max: 220, gsm_lycra_min: 270, gsm_lycra_max: 280 },
  ],
  'pique_table': [
    { count: 40, gsm_min: 130, gsm_max: 140 },
    { count: 34, gsm_min: 150, gsm_max: 160 },
    { count: 30, gsm_min: 170, gsm_max: 180 },
    { count: 28, gsm_min: 180, gsm_max: 200 },
    { count: 26, gsm_min: 200, gsm_max: 220 },
    { count: 24, gsm_min: 220, gsm_max: 240 },
    { count: 22, gsm_min: 250, gsm_max: 260 },
    { count: 20, gsm_min: 260, gsm_max: 270 },
  ],
  'interlock_table': [
    { count: 40, gsm_min: 170, gsm_max: 200 },
    { count: 34, gsm_min: 200, gsm_max: 230 },
    { count: 30, gsm_min: 240, gsm_max: 260 },
    { count: 28, gsm_min: 260, gsm_max: 280 },
    { count: 26, gsm_min: 280, gsm_max: 300 },
    { count: 24, gsm_min: 320, gsm_max: 340 },
    { count: 22, gsm_min: 350, gsm_max: 360 },
    { count: 20, gsm_min: 370, gsm_max: 380 },
  ],
  'rib_1x1_table': [
    { count: 40, gsm_min: 130, gsm_max: 140 },
    { count: 34, gsm_min: 160, gsm_max: 180 },
    { count: 30, gsm_min: 190, gsm_max: 200 },
    { count: 28, gsm_min: 200, gsm_max: 220 },
    { count: 26, gsm_min: 210, gsm_max: 230 },
    { count: 24, gsm_min: 240, gsm_max: 250 },
    { count: 22, gsm_min: 260, gsm_max: 270 },
    { count: 20, gsm_min: 280, gsm_max: 300 },
  ],
  'rib_2x2_table': [
    { count: 40, gsm_min: 150, gsm_max: 160 },
    { count: 34, gsm_min: 170, gsm_max: 180 },
    { count: 30, gsm_min: 190, gsm_max: 210 },
    { count: 28, gsm_min: 220, gsm_max: 230 },
    { count: 26, gsm_min: 230, gsm_max: 250 },
    { count: 24, gsm_min: 250, gsm_max: 270 },
    { count: 22, gsm_min: 270, gsm_max: 280 },
    { count: 20, gsm_min: 280, gsm_max: 310 },
  ],
  'terry_table': [
    { gsm: 200, ground_count: 30, loop_count: 30 },
    { gsm: 220, ground_count: 26, loop_count: 26 },
    { gsm: 240, ground_count: 24, loop_count: 24 },
    { gsm: 260, ground_count: 22, loop_count: 22 },
    { gsm: 280, ground_count: 20, loop_count: 20 },
  ],
  'fleece_2_thread_table': [
    { gsm: 220, ground_count: 30, loop_count: 16 },
    { gsm: 250, ground_count: 24, loop_count: 20 },
    { gsm: 280, ground_count: 20, loop_count: 20 },
  ],
  'fleece_3_thread_table': [
    { gsm: 200, ground_count: 36, loop_count: 12, binder_denier: 75 },
    { gsm: 220, ground_count: 36, loop_count: 14, binder_denier: 75 },
    { gsm: 240, ground_count: 34, loop_count: 16, binder_denier: 75 },
    { gsm: 260, ground_count: 32, loop_count: 18, binder_denier: 75 },
    { gsm: 280, ground_count: 30, loop_count: 20, binder_denier: 75 },
    { gsm: 300, ground_count: 30, loop_count: 20, binder_denier: 75 },
    { gsm: 310, ground_count: 30, loop_count: 16, yarn2_ne: 34 },
    { gsm: 320, ground_count: 28, loop_count: 20, binder_denier: 75 },
    { gsm: 340, ground_count: 28, loop_count: 22, binder_denier: 75 },
  ],
};

// ============================================================
// SECTION 6: COMPREHENSIVE MASTER LOOKUP TABLE
// Source: ilide_infoyarncountvsgsmxlspr PDF (full industrial reference)
// ============================================================
const MASTER_LOOKUP = [
  { id: 1,  type: '100% CTN Single Jersey',      gsm: 140,     count: '30/1' },
  { id: 2,  type: '100% CTN Single Jersey',      gsm: 160,     count: '26/1' },
  { id: 3,  type: '100% CTN Single Jersey',      gsm: 180,     count: '24/1' },
  { id: 4,  type: '100% CTN Single Jersey',      gsm: 200,     count: '20/1' },
  { id: 5,  type: '100% CTN Single Jersey',      gsm: 220,     count: '18/1' },
  { id: 6,  type: '100% CTN Single Jersey',      gsm: 240,     count: '16/1' },
  { id: 7,  type: '95% CTN 5% Lycra S/J H/F',   gsm: 160,     count: '34/1+40D' },
  { id: 8,  type: '95% CTN 5% Lycra S/J H/F',   gsm: 180,     count: '30/1+40D' },
  { id: 9,  type: '95% CTN 5% Lycra S/J H/F',   gsm: 200,     count: '26/1+40D' },
  { id: 10, type: '95% CTN 5% Lycra S/J H/F',   gsm: 220,     count: '26/1+40D' },
  { id: 11, type: '95% CTN 5% Lycra S/J F/F',   gsm: 180,     count: '34/1+20D' },
  { id: 12, type: '95% CTN 5% Lycra S/J F/F',   gsm: 200,     count: '30/1+20D' },
  { id: 13, type: '95% CTN 5% Lycra S/J F/F',   gsm: 220,     count: '26/1+20D' },
  { id: 14, type: '1X1 CTN RIB',                 gsm: 180,     count: '34/1' },
  { id: 15, type: '1X1 CTN RIB',                 gsm: 190,     count: '30/1' },
  { id: 16, type: '1X1 CTN RIB',                 gsm: 200,     count: '28/1' },
  { id: 17, type: '1X1 CTN RIB',                 gsm: 220,     count: '26/1' },
  { id: 18, type: '1X1 CTN RIB',                 gsm: 230,     count: '24/1' },
  { id: 19, type: '1X1 CTN RIB',                 gsm: 240,     count: '24/1' },
  { id: 20, type: '1X1 CTN/Elast RIB',           gsm_range: '180-190',  count: '34/1+40D' },
  { id: 21, type: '1X1 CTN/Elast RIB',           gsm_range: '200-220',  count: '30/1+40D' },
  { id: 22, type: '1X1 CTN/Elast RIB',           gsm_range: '230-240',  count: '26/1+20D' },
  { id: 23, type: '2X2 RIB',                     gsm: 220,     count: '26/1' },
  { id: 24, type: '2X2 RIB',                     gsm: 240,     count: '24/1' },
  { id: 25, type: '2X2 RIB',                     gsm: 260,     count: '20/1' },
  { id: 26, type: '2X2 CTN/ELAS RIB',            gsm_range: '200-220',  count: '34/1+20D' },
  { id: 27, type: '2X2 CTN/ELAS RIB',            gsm_range: '240-260',  count: '30/1+20D' },
  { id: 28, type: 'S/LACOST',                    gsm: 170,     count: '26/1' },
  { id: 29, type: 'S/LACOST',                    gsm: 180,     count: '26/1' },
  { id: 30, type: 'S/LACOST',                    gsm: 200,     count: '24/1' },
  { id: 31, type: 'S/LACOST',                    gsm: 210,     count: '20/1' },
  { id: 32, type: 'S/LACOST',                    gsm: 230,     count: '20/1' },
  { id: 33, type: 'S/LACOST',                    gsm: 230,     count: '18/1' },
  { id: 34, type: 'D/LACOST',                    gsm_range: '180-190',  count: '30/1' },
  { id: 35, type: 'D/LACOST',                    gsm_range: '200-210',  count: '26/1' },
  { id: 36, type: 'D/LACOST',                    gsm_range: '220-230',  count: '24/1' },
  { id: 37, type: 'D/LACOST',                    gsm_range: '240-250',  count: '24/1' },
  { id: 38, type: 'INTERLOCK',                   gsm: 190,     count: '40/1' },
  { id: 39, type: 'INTERLOCK',                   gsm: 200,     count: '40/1' },
  { id: 40, type: 'INTERLOCK',                   gsm: 220,     count: '34/1' },
  { id: 41, type: 'INTERLOCK',                   gsm: 240,     count: '30/1' },
  { id: 42, type: 'PIQUE',                       gsm: 180,     count: '30/1' },
  { id: 43, type: 'PIQUE',                       gsm_range: '190-200',  count: '28/1' },
  { id: 44, type: 'PIQUE',                       gsm_range: '220-230',  count: '24/1' },
  { id: 45, type: 'PIQUE 95/5 Lycra',            gsm_range: '200-210',  count: '34/1+20D' },
  { id: 46, type: 'PIQUE 95/5 Lycra',            gsm_range: '200-220',  count: '30/1+20D' },
  { id: 47, type: 'FLEECE 1 side brush',         gsm: 245,     count: '34/1+24/1' },
  { id: 48, type: 'FLEECE 1 side brush',         gsm: 260,     count: '30/1+24/1' },
  { id: 49, type: 'FLEECE 3 THREAD',             gsm: 280,     count: '30/1+20/1' },
  { id: 50, type: 'FLEECE',                      gsm: 300,     count: '30/1+16/1' },
  { id: 51, type: 'TERRY W/OUT brush',           gsm: 245,     count: '34/1+24/1' },
  { id: 52, type: 'TERRY W/OUT brush',           gsm: 260,     count: '30/1+24/1' },
  { id: 53, type: 'TERRY W/OUT brush',           gsm: 280,     count: '30/1+20/1' },
  { id: 54, type: 'TERRY W/OUT brush',           gsm: 300,     count: '30/1+16/1' },
  { id: 55, type: '95% Viscose 5% Lycra',        gsm: 180,     count: '40/1 vis+20D' },
  { id: 56, type: '95% Viscose 5% Lycra',        gsm: 210,     count: '36/1 vis+20D' },
];

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

// ============================================================
// SECTION 13: COMPLETE SPEC — VALIDATION RANGES
// ============================================================
const VALIDATION_RANGES = {
  gsm:         { min: 80,   max: 500,  unit: 'g/m²' },
  count_ne:    { min: 6,    max: 80,   unit: 'Ne' },
  count_den:   { min: 20,   max: 600,  unit: 'D' },
  gauge:       { min: 8,    max: 36,   unit: 'needles/inch' },
  dia_inches:  { min: 8,    max: 60,   unit: 'inches' },
  rpm:         { min: 5,    max: 45,   unit: 'rev/min' },
  sl_mm:       { min: 1.5,  max: 8.0,  unit: 'mm' },
  efficiency:  { min: 50,   max: 98,   unit: '%' },
  feeders:     { min: 12,   max: 192,  unit: 'count' },
};

function validate(param, value) {
  const range = VALIDATION_RANGES[param];
  if (!range) return { ok: true };
  if (value < range.min || value > range.max)
    return { ok: false, msg: `${param} must be ${range.min}–${range.max} ${range.unit}, got ${value}` };
  return { ok: true };
}

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

module.exports = {
  UNITS,
  UnitConverter,
  YarnCountFormulas,
  GSM_COUNT_REGRESSION,
  GSM_COUNT_LOOKUP,
  MASTER_LOOKUP,
  LOOP_LENGTH_MULTIPLIERS,
  MachineFormulas,
  ProductionFormulas,
  FabricWeightFormulas,
  EfficiencyFormulas,
  TIGHTNESS_LIMITS,
  VALIDATION_RANGES,
  BOOK_K_CONSTANTS,
  calcCountFromGSM,
  calcGSMFromCount,
  calcLoopLength,
  calcFiberPercentage,
  validate,
  WeftCalculators,
};
