/**
 * Unit conversion
 *
 * Length, weight, area and count-system conversion. Nothing here knows what a
 * fabric is — these are the constants and the identities that turn one unit into
 * another, and they are the only place a magic number like 590.5 or 0.836 should
 * appear.
 *
 * Part of the calculation formula section — see index.js.
 */
'use strict';

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
  // Denier = Tex × 9 = (590.5/Ne) × 9 = 5314.5/Ne. This used to return 5905/Ne,
  // which is dtex, not denier — so it disagreed with denierToNe below by ~11%
  // and the pair did not round-trip (30 Ne → 196.8 → 27.0 Ne).
  neToDenier: ne => 5314.5 / ne,
  denierToNe: d => 5314.5 / d,
  neToDtex: ne => 5905 / ne,
  dtexToNe: dtex => 5905 / dtex,
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

module.exports = { UNITS, UnitConverter };
