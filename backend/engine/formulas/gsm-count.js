/**
 * GSM to yarn count
 *
 * The published linear regressions (Count = a x GSM + b) and the lookup tables
 * for structures a straight line does not fit. These are the fallback used when
 * no real factory sample covers the requested GSM.
 *
 * Part of the calculation formula section — see index.js.
 */
'use strict';

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
  // Rows above 280 GSM (terry) / 340 GSM (fleece 3-thread) are anchored to the
  // real factory ERP dataset (backend/data/factory-records.json — toweling terry
  // and fleece ground-yarn count vs. GSM, cotton, averaged per 20-GSM bucket).
  // Real terry data shows the ground count PLATEAUS around 26-32/1 even at 400
  // GSM (heavier towel GSM comes mainly from more/looser pile, not a continuously
  // coarsening ground yarn) — very different from what a straight-line
  // extrapolation of the old 200-280 GSM rows alone would have predicted.
  'terry_table': [
    { gsm: 200, ground_count: 30, loop_count: 30 },
    { gsm: 220, ground_count: 26, loop_count: 26 },
    { gsm: 240, ground_count: 24, loop_count: 24 },
    { gsm: 260, ground_count: 22, loop_count: 22 },
    { gsm: 280, ground_count: 20, loop_count: 20 },
    { gsm: 300, ground_count: 31, loop_count: 31 },
    { gsm: 320, ground_count: 30, loop_count: 30 },
    { gsm: 340, ground_count: 30, loop_count: 30 },
    { gsm: 400, ground_count: 26, loop_count: 26 },
    { gsm: 450, ground_count: 24, loop_count: 24 },
  ],
  'fleece_2_thread_table': [
    { gsm: 220, ground_count: 30, loop_count: 16 },
    { gsm: 250, ground_count: 24, loop_count: 20 },
    { gsm: 280, ground_count: 20, loop_count: 20 },
    { gsm: 320, ground_count: 24, loop_count: 20 },
    { gsm: 360, ground_count: 22, loop_count: 20 },
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
    { gsm: 360, ground_count: 28, loop_count: 24, binder_denier: 75 },
    { gsm: 400, ground_count: 26, loop_count: 26, binder_denier: 75 },
    { gsm: 450, ground_count: 24, loop_count: 26, binder_denier: 75 },
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

module.exports = { GSM_COUNT_REGRESSION, GSM_COUNT_LOOKUP, MASTER_LOOKUP, calcCountFromGSM, calcGSMFromCount };
