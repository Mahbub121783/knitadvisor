/**
 * KnitAdvisor — Financial Costing Engine v2.0
 *
 * Sourced from industry-verified price database:
 *   Factory-Approved Reference Price List — Updated May 2026
 *
 * Features:
 *   - Count-aware pricing (10/s to 40/s full matrix)
 *   - All yarn types: Carded, Combed, Supima/Pima, CVC, PC, Slub, Siro,
 *     Viscose, Modal, Cotton-Viscose, Spandex, Filament, US Cotton (Combed + Carded)
 *   - Automatic surcharges: White, Organic (GOTS/OCS/ic2), Slub, Ecovero
 *   - Dual-bath dyeing surcharge for blends
 *   - At-Sight payment discount
 *   - Multi-fiber blend composition cost splitting
 *   - Garment-level costing
 *   - Currency conversion (USD / BDT / EUR / GBP / CNY / INR)
 *
 * Sources:
 *   - Factory-Approved Reference Price List (May 2026)
 *   - US Pima/Supima: ~$9.00/kg base (30/s) — Fibre2Fashion + Supima.com 2025
 *   - US Upland Combed: ~$4.20/kg base (30/s) — Bangladesh market + textilepages.com
 *   - US Upland Carded: ~$3.50/kg base (30/s) — Bangladesh RMG sector 2026
 *
 * All prices are USD/kg FOB Bangladesh spinning mill.
 * Language: English only. No regional formatting.
 */

// ============================================================
// SECTION 1: INDUSTRY-VERIFIED PRICE MATRIX
// Rows = product type + variant | Cols = yarn count (Ne)
// Source: Industry-Verified Price Database — May 2, 2026
// ============================================================
const SM_PRICE_MATRIX = {
  // ----- 100% Cotton Carded Regular -----
  'carded_regular': {
    10: 3.15, 12: 3.15, 14: 3.25, 16: 3.25, 18: 3.25, 20: 3.25,
    22: 3.25, 24: 3.30, 26: 3.30, 28: 3.35, 30: 3.35, 32: 3.45,
    34: 3.55, 36: 3.65, 40: 3.85,
    label: '100% Cotton Carded (Regular)',
    fiber: 'cotton', type: 'carded',
  },
  // ----- 100% Cotton Carded White -----
  'carded_white': {
    10: 3.25, 12: 3.25, 14: 3.35, 16: 3.35, 18: 3.35, 20: 3.35,
    22: 3.35, 24: 3.40, 26: 3.40, 28: 3.45, 30: 3.45, 32: 3.55,
    34: 3.65, 36: 3.75, 40: 3.95,
    label: '100% Cotton Carded (White)',
    fiber: 'cotton', type: 'carded', finish: 'white',
  },
  // ----- 100% Cotton Carded Slub -----
  'carded_slub': {
    16: 3.55, 18: 3.55, 20: 3.55, 22: 3.55, 24: 3.60, 26: 3.60,
    28: 3.65, 30: 3.65, 32: 3.75, 34: 3.85, 36: 3.95, 40: 4.15,
    label: '100% Cotton Carded (Slub)',
    fiber: 'cotton', type: 'carded', finish: 'slub',
  },
  // ----- 100% Cotton Combed Regular -----
  'combed_regular': {
    16: 3.60, 18: 3.60, 20: 3.60, 22: 3.60, 24: 3.65, 26: 3.65,
    28: 3.70, 30: 3.70, 32: 3.80, 34: 3.90, 36: 4.00, 40: 4.20,
    label: '100% Cotton Combed (Regular)',
    fiber: 'cotton', type: 'combed',
  },
  // ----- 100% Cotton Combed White -----
  'combed_white': {
    16: 3.70, 18: 3.70, 20: 3.70, 22: 3.70, 24: 3.75, 26: 3.75,
    28: 3.80, 30: 3.80, 32: 3.90, 34: 4.00, 36: 4.10, 40: 4.30,
    label: '100% Cotton Combed (White)',
    fiber: 'cotton', type: 'combed', finish: 'white',
  },
  // ----- Supima / Pima Combed -----
  // US Pima ELS cotton — premium grade
  'supima_combed': {
    20: 8.90, 22: 8.90, 24: 8.95, 26: 8.95, 28: 9.00, 30: 9.00,
    32: 9.10, 34: 9.20, 36: 9.30, 40: 9.50,
    label: 'Supima / US Pima Combed',
    fiber: 'supima', type: 'combed',
  },
  // ----- US Combed Cotton (Upland Long Staple) -----
  // US Upland Combed — not Pima, but US-origin, better than standard BD combed
  // Priced at ~$0.50/kg premium over standard combed (market 2025–2026)
  'us_combed_cotton': {
    16: 4.10, 18: 4.10, 20: 4.10, 22: 4.10, 24: 4.15, 26: 4.15,
    28: 4.20, 30: 4.20, 32: 4.30, 34: 4.40, 36: 4.50, 40: 4.70,
    label: 'US Upland Combed Cotton',
    fiber: 'cotton', type: 'combed', origin: 'US',
    note: 'US-origin upland cotton, long staple combed. ~$0.50 premium over standard combed. Source: textilepages.com + Bangladesh RMG market 2026',
  },
  // ----- US Normal (Carded) Cotton -----
  // US Upland Carded — US cotton origin, carded process
  // Priced at ~$0.15–$0.20 premium over standard BD carded (US cotton surcharge)
  'us_carded_cotton': {
    10: 3.30, 12: 3.30, 14: 3.40, 16: 3.40, 18: 3.40, 20: 3.40,
    22: 3.40, 24: 3.45, 26: 3.45, 28: 3.50, 30: 3.50, 32: 3.60,
    34: 3.70, 36: 3.80, 40: 4.00,
    label: 'US Upland Carded Cotton',
    fiber: 'cotton', type: 'carded', origin: 'US',
    note: 'US-origin upland cotton, carded process. ~$0.15 premium over standard carded. Source: Bangladesh market + USDA cotton reports 2026',
  },
  // ----- CVC 60/40 -----
  'cvc_60_40': {
    10: 2.90, 12: 2.90, 14: 3.00, 16: 3.00, 18: 3.00, 20: 3.00,
    22: 3.00, 24: 3.05, 26: 3.05, 28: 3.10, 30: 3.10, 32: 3.20,
    34: 3.30, 36: 3.40, 40: 3.60,
    label: 'CVC 60/40 (Cotton/Polyester)',
    fiber: 'cvc_60_40', type: 'blended', cotton_pct: 60, poly_pct: 40,
  },
  // ----- CVC 80/20 -----
  'cvc_80_20': {
    10: 3.20, 12: 3.20, 14: 3.30, 16: 3.30, 18: 3.30, 20: 3.30,
    22: 3.30, 24: 3.35, 26: 3.35, 28: 3.40, 30: 3.40, 32: 3.50,
    34: 3.60, 36: 3.70, 40: 3.90,
    label: 'CVC 80/20 (Cotton/Polyester)',
    fiber: 'cvc_80_20', type: 'blended', cotton_pct: 80, poly_pct: 20,
  },
  // ----- CVC 60/40 Slub -----
  'cvc_60_40_slub': {
    20: 3.30, 22: 3.30, 24: 3.35, 26: 3.35, 28: 3.40, 30: 3.40,
    32: 3.50, 34: 3.60, 36: 3.70, 40: 3.90,
    label: 'CVC 60/40 Slub',
    fiber: 'cvc_60_40', type: 'blended', finish: 'slub',
  },
  // ----- CVC 80/20 Slub -----
  'cvc_80_20_slub': {
    20: 3.60, 22: 3.60, 24: 3.65, 26: 3.65, 28: 3.70, 30: 3.70,
    32: 3.80, 34: 3.90, 36: 4.00, 40: 4.20,
    label: 'CVC 80/20 Slub',
    fiber: 'cvc_80_20', type: 'blended', finish: 'slub',
  },
  // ----- CVC 60/40 Siro -----
  'cvc_60_40_siro': {
    20: 4.20, 22: 4.20, 24: 4.25, 26: 4.25, 28: 4.30, 30: 4.30,
    32: 4.40, 34: 4.50, 36: 4.60, 40: 4.80,
    label: 'CVC 60/40 Siro',
    fiber: 'cvc_60_40', type: 'blended', finish: 'siro',
  },
  // ----- CVC 50/50 Siro -----
  'cvc_50_50_siro': {
    20: 4.10, 22: 4.10, 24: 4.15, 26: 4.15, 28: 4.20, 30: 4.20,
    32: 4.30, 34: 4.40, 36: 4.50, 40: 4.70,
    label: 'CVC 50/50 Siro',
    fiber: 'cvc_50_50', type: 'blended', finish: 'siro',
  },
  // ----- PC 65/35 -----
  'pc_65_35': {
    10: 2.80, 12: 2.80, 14: 2.90, 16: 2.90, 18: 2.90, 20: 2.90,
    22: 2.90, 24: 2.95, 26: 2.95, 28: 3.00, 30: 3.00, 32: 3.10,
    34: 3.20, 36: 3.30, 40: 3.50,
    label: 'PC 65/35 (Polyester/Cotton)',
    fiber: 'pc_65_35', type: 'blended', poly_pct: 65, cotton_pct: 35,
  },
  // ----- Cotton/Modal 50/50 -----
  'cotton_modal_50_50': {
    28: 4.15, 30: 4.20, 32: 4.30, 34: 4.40, 36: 4.50, 40: 4.70,
    label: 'Cotton/Modal 50/50',
    fiber: 'cotton_modal', type: 'blended', cotton_pct: 50, modal_pct: 50,
  },
  // ----- Cotton/Viscose 50/50 -----
  'cotton_viscose_50_50': {
    26: 3.65, 28: 3.70, 30: 3.70, 32: 3.80, 34: 3.90, 36: 4.00, 40: 4.20,
    label: 'Cotton/Viscose 50/50',
    fiber: 'cotton_viscose', type: 'blended', cotton_pct: 50, viscose_pct: 50,
  },
  // ----- 100% Viscose Regular -----
  'viscose_regular': {
    26: 3.35, 28: 3.40, 30: 3.40, 32: 3.50, 34: 3.60, 36: 3.70, 40: 3.90,
    label: '100% Viscose (Regular)',
    fiber: 'viscose', type: 'regular',
  },
  // ----- Spandex (Elastane) — Denier-based -----
  'spandex_20d': { price: 5.30, label: 'Spandex 20D', fiber: 'elastane', denier: 20 },
  'spandex_30d': { price: 5.10, label: 'Spandex 30D', fiber: 'elastane', denier: 30 },
  'spandex_40d': { price: 4.90, label: 'Spandex 40D', fiber: 'elastane', denier: 40 },
  'spandex_70d': { price: 4.90, label: 'Spandex 70D', fiber: 'elastane', denier: 70 },
  // ----- Polyester Filament -----
  'filament_75d':  { price: 2.25, label: 'Polyester Filament 75D',  fiber: 'filament', denier: 75 },
  'filament_100d': { price: 2.25, label: 'Polyester Filament 100D', fiber: 'filament', denier: 100 },
  'filament_150d': { price: 2.25, label: 'Polyester Filament 150D', fiber: 'filament', denier: 150 },
};

// ============================================================
// SECTION 2: FACTORY-APPROVED SURCHARGE RULES (from price list footnotes)
// ============================================================
const SM_SURCHARGES = {
  at_sight_discount:     -0.05,  // Rule 1: At Sight payment = −$0.05/kg
  white_cotton:          +0.10,  // Rule 2: White finish on Cotton = +$0.10
  white_blended:         +0.05,  // Rule 2: White finish on CVC/PC/Viscose/Modal = +$0.05
  organic_gots_ocs:      +0.60,  // Rule 3: Organic (GOTS, OCS) = +$0.60
  organic_ic2:           +0.30,  // Rule 3: ic2 certified = +$0.30
  slub_all:              +0.30,  // Rule 4: Slub on any type = +$0.30
  ecovero:               +0.45,  // Rule 5: Ecovero Viscose = +$0.45
};

// ============================================================
// SECTION 3: YARN TYPE CATALOG (all available types from industry + market)
// ============================================================
const YARN_TYPE_CATALOG = {
  // Cotton family
  'carded_regular':       { category: 'Cotton',  description: 'Standard carded cotton, basic quality, open-end or ring spun' },
  'carded_white':         { category: 'Cotton',  description: 'Carded cotton, white/optical bright finish, higher visual purity' },
  'carded_slub':          { category: 'Cotton',  description: 'Carded cotton with deliberate thick-thin effect (slub)' },
  'combed_regular':       { category: 'Cotton',  description: 'Combed ring-spun cotton, shorter fibers removed, stronger & finer' },
  'combed_white':         { category: 'Cotton',  description: 'Combed ring-spun cotton, white/optically brightened' },
  'supima_combed':        { category: 'Premium Cotton', description: 'US Pima (Supima) Extra Long Staple combed. Silkiest, strongest cotton.' },
  'us_combed_cotton':     { category: 'Premium Cotton', description: 'US Upland long-staple combed. Higher quality than standard, lower than Pima.' },
  'us_carded_cotton':     { category: 'Premium Cotton', description: 'US Upland carded cotton. US-origin, BCI-equivalent traceability.' },
  // Blended family
  'cvc_60_40':            { category: 'CVC',     description: 'Chief Value Cotton 60% Cotton / 40% Polyester blend' },
  'cvc_80_20':            { category: 'CVC',     description: 'High-cotton CVC 80% Cotton / 20% Polyester blend' },
  'cvc_60_40_slub':       { category: 'CVC',     description: 'CVC 60/40 with slub texture effect' },
  'cvc_80_20_slub':       { category: 'CVC',     description: 'CVC 80/20 with slub texture effect' },
  'cvc_60_40_siro':       { category: 'CVC',     description: 'CVC 60/40 Siro-spun (two-strand plied, compact, minimal hairiness)' },
  'cvc_50_50_siro':       { category: 'CVC',     description: 'CVC 50/50 Siro-spun for balanced stretch and durability' },
  'pc_65_35':             { category: 'PC',      description: 'Polyester/Cotton 65/35 — polyester dominant blend, strong & low-shrink' },
  // Specialty
  'cotton_modal_50_50':   { category: 'Modal',   description: 'Cotton/Modal 50/50 — ultra-soft, silky hand-feel' },
  'cotton_viscose_50_50': { category: 'Viscose', description: 'Cotton/Viscose 50/50 — lightweight, flowy drape' },
  'viscose_regular':      { category: 'Viscose', description: '100% Viscose/Rayon — very soft, moisture-absorbent, low-cost' },
  // Elastane / Filament
  'spandex_20d':          { category: 'Spandex', description: 'Spandex/Elastane 20 Denier — lightest, for 90%+ stretch fabrics' },
  'spandex_30d':          { category: 'Spandex', description: 'Spandex 30D — standard for fine knit base fabric' },
  'spandex_40d':          { category: 'Spandex', description: 'Spandex 40D — most common, all-purpose stretch yarn' },
  'spandex_70d':          { category: 'Spandex', description: 'Spandex 70D — heavy support/compression fabric' },
  'filament_75d':         { category: 'Filament', description: 'Polyester Filament 75D — smooth, sheen, wicking sportswear' },
  'filament_100d':        { category: 'Filament', description: 'Polyester Filament 100D — heavier sportswear/activewear base' },
  'filament_150d':        { category: 'Filament', description: 'Polyester Filament 150D — fleece binder / heavy base' },
};

// ============================================================
// SECTION 4: KNITTING COST BY GAUGE (USD/kg)
// ============================================================
const KNITTING_COST_BY_GAUGE = {
  12: 0.55, 14: 0.60, 16: 0.65, 18: 0.70,
  20: 0.75, 24: 0.85, 28: 1.00, 32: 1.20,
  36: 1.40, 40: 1.60,
};

// ============================================================
// SECTION 5: FINISHING COST BY FABRIC (USD/kg)
// ============================================================
const FINISHING_COST_BY_FABRIC = {
  single_jersey:   0.40, rib_1x1: 0.40, rib_2x2: 0.40,
  interlock:       0.45, pique_single: 0.50, pique_double: 0.55,
  fleece_2_thread: 0.65, fleece_3_thread: 0.75, fleece_diagonal: 0.75,
  french_terry:    0.55, terry_fabric: 0.60, ponte_di_roma: 0.50,
  default:         0.45,
};

// ============================================================
// SECTION 6: DYEING COST BY SHADE (USD/kg)
// ============================================================
const DYEING_COST_BY_SHADE = {
  white: 0.35, light: 0.45, medium: 0.55, dark: 0.70,
  black: 0.85, melange: 0.30, yarn_dyed: 1.20,
};

// ============================================================
// SECTION 7: INVISIBLE WASTE FACTORS (%)
// ============================================================
const INVISIBLE_WASTE_PCT = {
  single_jersey: 2.5, rib_1x1: 3.0, rib_2x2: 3.0, interlock: 3.5,
  pique_single: 3.0, fleece_2_thread: 3.5, fleece_3_thread: 4.0,
  fleece_diagonal: 4.0, french_terry: 3.5, terry_fabric: 4.0,
  default: 3.0,
};

// ============================================================
// SECTION 8: EXCHANGE RATES (USD base)
// ============================================================
const DEFAULT_EXCHANGE_RATES = {
  USD: 1.000, BDT: 110.5, EUR: 0.920,
  GBP: 0.790, CNY: 7.250, INR: 83.50,
};

// ============================================================
// HELPER: GET PRICE FROM MATRIX FOR A GIVEN YARN TYPE & COUNT
// ============================================================
function getPriceFromMatrix(yarnTypeKey, countNe) {
  const entry = SM_PRICE_MATRIX[yarnTypeKey];
  if (!entry) return null;

  // Spandex/Filament are denier-based, not count-based
  if (entry.price !== undefined) return entry.price;

  // Find closest available count in the matrix
  const availableCounts = Object.keys(entry)
    .map(Number)
    .filter(k => !isNaN(k) && entry[k] !== '-');

  if (availableCounts.length === 0) return null;

  const closest = availableCounts.reduce((prev, curr) =>
    Math.abs(curr - countNe) < Math.abs(prev - countNe) ? curr : prev
  );

  const price = entry[closest];
  return typeof price === 'string' ? null : price;
}

// ============================================================
// HELPER: AUTO-DETECT BEST YARN TYPE FROM PARSED COMPOSITION
// ============================================================
function autoDetectYarnType(parsedComp, countNe, options = {}) {
  if (!parsedComp) return { key: 'carded_regular', label: '100% Cotton Carded (Regular)' };

  const fibers = parsedComp.fibers || {};
  const cotton = fibers.cotton || 0;
  const poly   = fibers.polyester || 0;
  const visc   = fibers.viscose || 0;
  const modal  = fibers.modal || 0;
  const elast  = fibers.elastane || 0;
  const supima = fibers.supima || 0;

  const isSlub    = options.slub    || (parsedComp.raw || '').toLowerCase().includes('slub');
  const isSiro    = options.siro    || (parsedComp.raw || '').toLowerCase().includes('siro');
  const isWhite   = options.white   || (parsedComp.raw || '').toLowerCase().includes('white');
  const isUS      = options.us_origin || false;
  const isOrganic = options.organic || false;

  // Supima/Pima
  if (supima > 50 || (parsedComp.raw || '').toLowerCase().includes('supima') || (parsedComp.raw || '').toLowerCase().includes('pima')) {
    return { key: 'supima_combed', label: SM_PRICE_MATRIX.supima_combed.label };
  }
  // US Cotton
  if (isUS && cotton >= 90) {
    if (countNe >= 20) return { key: 'us_combed_cotton', label: SM_PRICE_MATRIX.us_combed_cotton.label };
    return { key: 'us_carded_cotton', label: SM_PRICE_MATRIX.us_carded_cotton.label };
  }
  // CVC / PC blends
  if (cotton > 0 && poly > 0) {
    const ratio = `${cotton}_${poly}`;
    if (cotton >= 55 && cotton <= 65) {
      if (isSlub) return { key: 'cvc_60_40_slub', label: SM_PRICE_MATRIX.cvc_60_40_slub.label };
      if (isSiro) return { key: 'cvc_60_40_siro', label: SM_PRICE_MATRIX.cvc_60_40_siro.label };
      return { key: 'cvc_60_40', label: SM_PRICE_MATRIX.cvc_60_40.label };
    }
    if (cotton >= 75) {
      if (isSlub) return { key: 'cvc_80_20_slub', label: SM_PRICE_MATRIX.cvc_80_20_slub.label };
      return { key: 'cvc_80_20', label: SM_PRICE_MATRIX.cvc_80_20.label };
    }
    if (cotton >= 45 && cotton <= 55) {
      if (isSiro) return { key: 'cvc_50_50_siro', label: SM_PRICE_MATRIX.cvc_50_50_siro.label };
    }
    if (poly >= 60) return { key: 'pc_65_35', label: SM_PRICE_MATRIX.pc_65_35.label };
    return { key: 'cvc_60_40', label: SM_PRICE_MATRIX.cvc_60_40.label }; // fallback
  }
  // Modal blend
  if (modal > 30 && cotton > 30) return { key: 'cotton_modal_50_50', label: SM_PRICE_MATRIX.cotton_modal_50_50.label };
  // Viscose blend
  if (visc > 30 && cotton > 30) return { key: 'cotton_viscose_50_50', label: SM_PRICE_MATRIX.cotton_viscose_50_50.label };
  // Pure Viscose
  if (visc >= 90) return { key: 'viscose_regular', label: SM_PRICE_MATRIX.viscose_regular.label };
  // Pure Cotton
  if (cotton >= 90) {
    if (countNe >= 20) {
      if (isWhite) return { key: 'combed_white', label: SM_PRICE_MATRIX.combed_white.label };
      return { key: 'combed_regular', label: SM_PRICE_MATRIX.combed_regular.label };
    }
    if (isSlub) return { key: 'carded_slub', label: SM_PRICE_MATRIX.carded_slub.label };
    if (isWhite) return { key: 'carded_white', label: SM_PRICE_MATRIX.carded_white.label };
    return { key: 'carded_regular', label: SM_PRICE_MATRIX.carded_regular.label };
  }
  return { key: 'carded_regular', label: SM_PRICE_MATRIX.carded_regular.label };
}

// ============================================================
// MAIN COST CALCULATE FUNCTION
// ============================================================
function calculateCost(params) {
  const startTime = Date.now();
  const warnings  = [];

  const fabricId   = (params.fabric    || 'single_jersey').toLowerCase().trim();
  const gsm        = parseFloat(params.gsm)       || 180;
  const countNe    = parseFloat(params.count_ne)  || 30;
  const gauge      = parseInt(params.gauge)        || 24;
  const currency   = (params.currency  || 'USD').toUpperCase();
  const colorShade = (params.color_shade || 'medium').toLowerCase().replace(/\s+/g, '_');
  const parsedComp = params.parsedComp || null;

  // Payment & finish options
  const opts = {
    at_sight:    !!params.at_sight,
    white:       colorShade === 'white' || !!(params.white),
    organic:     !!(params.organic),
    organic_type: (params.organic_type || 'none'), // 'gots', 'ocs', 'ic2', 'none'
    slub:        !!(params.slub),
    ecovero:     !!(params.ecovero),
    siro:        !!(params.siro),
    us_origin:   !!(params.us_origin),
  };

  // Exchange rate
  const exchangeRates = { ...DEFAULT_EXCHANGE_RATES, ...(params.exchange_rate || {}) };
  const fxRate  = exchangeRates[currency] || 1.0;

  // ---- 1. AUTO-DETECT YARN TYPE ----
  let yarnTypeKey, yarnLabel;
  if (params.yarn_type && SM_PRICE_MATRIX[params.yarn_type]) {
    yarnTypeKey = params.yarn_type;
    yarnLabel   = SM_PRICE_MATRIX[params.yarn_type].label;
  } else {
    const detected  = autoDetectYarnType(parsedComp, countNe, opts);
    yarnTypeKey = detected.key;
    yarnLabel   = detected.label;
  }

  // ---- 2. GET BASE PRICE FROM SM MATRIX ----
  let basePrice = getPriceFromMatrix(yarnTypeKey, countNe);
  if (basePrice === null) {
    // Fallback: user-provided price or default
    basePrice = params.yarn_price_per_kg ? parseFloat(params.yarn_price_per_kg) : 3.35;
    warnings.push(`No reference price found for yarn type "${yarnTypeKey}" at count ${countNe}Ne. Using fallback price $${basePrice}/kg.`);
  }

  // ---- 3. APPLY SURCHARGES ----
  const surchargesApplied = [];
  let surchargeTotal = 0;

  if (opts.at_sight) {
    surchargeTotal += SM_SURCHARGES.at_sight_discount;
    surchargesApplied.push({ name: 'At-Sight Payment Discount', amount: SM_SURCHARGES.at_sight_discount });
  }
  if (opts.white) {
    const wSurcharge = yarnTypeKey.includes('carded') || yarnTypeKey.includes('combed') || yarnTypeKey.includes('us_')
      ? SM_SURCHARGES.white_cotton
      : SM_SURCHARGES.white_blended;
    surchargeTotal += wSurcharge;
    surchargesApplied.push({ name: 'White Finish Surcharge', amount: wSurcharge });
  }
  if (opts.organic) {
    const orgAmount = opts.organic_type === 'ic2'
      ? SM_SURCHARGES.organic_ic2
      : SM_SURCHARGES.organic_gots_ocs;
    surchargeTotal += orgAmount;
    surchargesApplied.push({ name: `Organic Surcharge (${opts.organic_type.toUpperCase()})`, amount: orgAmount });
  }
  if (opts.slub && !yarnTypeKey.includes('slub')) {
    surchargeTotal += SM_SURCHARGES.slub_all;
    surchargesApplied.push({ name: 'Slub Surcharge', amount: SM_SURCHARGES.slub_all });
  }
  if (opts.ecovero) {
    surchargeTotal += SM_SURCHARGES.ecovero;
    surchargesApplied.push({ name: 'Ecovero Viscose Surcharge', amount: SM_SURCHARGES.ecovero });
  }

  const finalYarnPrice = round4(basePrice + surchargeTotal);

  // ---- 3b. ELASTANE SEPARATE COST (when composition includes elastane) ----
  // Elastane/spandex is always a separate yarn fed via a dedicated feeder.
  // Cost must be weighted by its fraction of the total fabric weight.
  const fiberComp = parsedComp ? (parsedComp.fibers || {}) : {};
  const elastanePct = fiberComp.elastane || 0;
  let effectiveYarnPrice = finalYarnPrice;
  let elastaneDetail = null;

  if (elastanePct > 0) {
    let elDenier = 40;
    if (elastanePct <= 3) elDenier = 20;
    else if (elastanePct <= 8) elDenier = 40;
    else elDenier = 70;

    const elKey = `spandex_${elDenier}d`;
    const elPricePerKg = SM_PRICE_MATRIX[elKey]?.price || 4.90;
    const elFraction = elastanePct / 100;
    const baseFraction = 1 - elFraction;

    // Weighted blended yarn price = (base yarn price × base%) + (elastane price × elastane%)
    effectiveYarnPrice = round4(finalYarnPrice * baseFraction + elPricePerKg * elFraction);
    elastaneDetail = {
      denier: elDenier,
      pct_in_fabric: elastanePct,
      price_per_kg_usd: elPricePerKg,
      cost_contribution_usd: round4(elPricePerKg * elFraction),
      base_yarn_cost_contribution_usd: round4(finalYarnPrice * baseFraction),
      blended_price_usd: effectiveYarnPrice,
      label: SM_PRICE_MATRIX[elKey]?.label || `Spandex ${elDenier}D`,
      note: `${elastanePct}% elastane weight × $${elPricePerKg}/kg = $${round4(elPricePerKg * elFraction)}/kg contribution`,
    };
  }

  // ---- 4. INVISIBLE WASTE ----
  const wastePct = INVISIBLE_WASTE_PCT[fabricId] || INVISIBLE_WASTE_PCT.default;
  const wasteMultiplier = 1 + wastePct / 100;
  const rawMaterialWithWaste = round4(effectiveYarnPrice * wasteMultiplier);

  // ---- 5. KNITTING COST ----
  const gaugeKey = Object.keys(KNITTING_COST_BY_GAUGE)
    .map(Number)
    .reduce((prev, curr) => Math.abs(curr - gauge) < Math.abs(prev - gauge) ? curr : prev);
  const knittingBase = params.knitting_cost
    ? parseFloat(params.knitting_cost)
    : KNITTING_COST_BY_GAUGE[gaugeKey] || 0.75;
  const fineSurcharge = countNe > 36 ? 1.15 : countNe > 30 ? 1.05 : 1.0;
  const knittingFinal = round4(knittingBase * fineSurcharge);

  // ---- 6. DYEING COST ----
  const dyeingBase = params.dyeing_cost
    ? parseFloat(params.dyeing_cost)
    : DYEING_COST_BY_SHADE[colorShade] || 0.55;
  // Dual-bath surcharge for mixed fiber dyeing (cotton + polyester = two dye baths)
  const fibers = parsedComp ? (parsedComp.fibers || {}) : { cotton: 100 };
  const dualBath = (fibers.polyester > 0 && fibers.cotton > 0) ? 0.15 : 0;
  const dyeingFinal = round4(dyeingBase + dualBath);

  // ---- 7. FINISHING COST ----
  const finishingBase = params.finishing_cost
    ? parseFloat(params.finishing_cost)
    : FINISHING_COST_BY_FABRIC[fabricId] || FINISHING_COST_BY_FABRIC.default;
  const heavySurcharge = gsm > 300 ? 0.10 : gsm > 250 ? 0.05 : 0;
  const finishingFinal = round4(finishingBase + heavySurcharge);

  // ---- 8. TOTAL CMT ----
  const totalCost = round4(rawMaterialWithWaste + knittingFinal + dyeingFinal + finishingFinal);

  // ---- 9. MARGIN SCENARIOS ----
  const margins = [10, 15, 20, 25, 30].map(m => ({
    margin_pct:         m,
    selling_price_usd:  round4(totalCost * (1 + m / 100)),
    [`selling_${currency.toLowerCase()}_per_kg`]: round4(totalCost * (1 + m / 100) * fxRate),
  }));

  // ---- 10. PER-GARMENT ----
  let garmentCost = null;
  if (params.garment_weight_g) {
    const wt_kg = parseFloat(params.garment_weight_g) / 1000;
    garmentCost = {
      garment_weight_g:       parseFloat(params.garment_weight_g),
      raw_material_usd:       round4(rawMaterialWithWaste * wt_kg),
      knitting_usd:           round4(knittingFinal * wt_kg),
      dyeing_usd:             round4(dyeingFinal * wt_kg),
      finishing_usd:          round4(finishingFinal * wt_kg),
      total_usd:              round4(totalCost * wt_kg),
      [`total_${currency.toLowerCase()}`]: round4(totalCost * wt_kg * fxRate),
    };
  }

  // ---- 11. CONVERT TO CURRENCY ----
  const c = v => round4(v * fxRate);

  return {
    success: true,
    response_ms: Date.now() - startTime,

    yarn: {
      type_key:          yarnTypeKey,
      type_label:        yarnLabel,
      count_ne:          Math.round(countNe), // integer — industry standard
      count_display:     `${Math.round(countNe)}/1 Ne`,
      base_price_usd:    basePrice,
      surcharges:        surchargesApplied,
      surcharge_total:   round4(surchargeTotal),
      final_price_usd:   finalYarnPrice,
      source:            'KnitAdvisor Certified Price Database — May 2, 2026',
      // Elastane separate yarn (when applicable)
      elastane: elastaneDetail,
    },

    cost_breakdown_usd: {
      raw_material: {
        base_yarn_price_per_kg: finalYarnPrice,
        elastane_blended_price: elastaneDetail ? effectiveYarnPrice : null,
        effective_yarn_price_per_kg: effectiveYarnPrice,
        waste_pct:           wastePct,
        with_waste_per_kg:   rawMaterialWithWaste,
        fiber_detail: elastaneDetail ? [
          {
            fiber: yarnLabel,
            pct: 100 - elastanePct,
            price_per_kg: finalYarnPrice,
            cost_contribution: round4(finalYarnPrice * (1 - elastanePct / 100)),
          },
          {
            fiber: elastaneDetail.label,
            pct: elastanePct,
            price_per_kg: elastaneDetail.price_per_kg_usd,
            cost_contribution: elastaneDetail.cost_contribution_usd,
          },
        ] : null,
      },
      knitting:              knittingFinal,
      dyeing: {
        per_kg:              dyeingFinal,
        dual_bath_surcharge: dualBath > 0 ? dualBath : null,
      },
      finishing:             finishingFinal,
      total_per_kg:          totalCost,
    },

    cost_in_currency: {
      currency,
      exchange_rate:       fxRate,
      raw_material_per_kg: c(rawMaterialWithWaste),
      knitting_per_kg:     c(knittingFinal),
      dyeing_per_kg:       c(dyeingFinal),
      finishing_per_kg:    c(finishingFinal),
      total_per_kg:        c(totalCost),
    },

    margin_scenarios: margins,

    garment: garmentCost,

    formula_trace: {
      yarn_price:   `Reference Matrix[${yarnTypeKey}][${Math.round(countNe)}Ne] = $${basePrice} + surcharges($${round4(surchargeTotal)}) = $${finalYarnPrice}`,
      elastane_blend: elastaneDetail ? `Base yarn $${finalYarnPrice} × ${100 - elastanePct}% + Elastane $${elastaneDetail.price_per_kg_usd} × ${elastanePct}% = $${effectiveYarnPrice}/kg (weighted blend)` : null,
      raw_material: `$${effectiveYarnPrice} × (1 + ${wastePct}% waste) = $${rawMaterialWithWaste}`,
      knitting:     `Gauge ${gaugeKey}GG base $${knittingBase} × fine_surcharge(${fineSurcharge}) = $${knittingFinal}`,
      dyeing:       `shade="${colorShade}" $${dyeingBase} + dual_bath $${dualBath} = $${dyeingFinal}`,
      finishing:    `fabric="${fabricId}" $${finishingBase} + heavy_gsm $${heavySurcharge} = $${finishingFinal}`,
      total:        `$${rawMaterialWithWaste} + $${knittingFinal} + $${dyeingFinal} + $${finishingFinal} = $${totalCost}/kg`,
    },

    notes: [
      'Yarn prices sourced from KnitAdvisor certified industry-verified price database (May 2, 2026).',
      'US Upland Combed/Carded prices reference: textilepages.com + Bangladesh RMG market 2026.',
      'US Pima/Supima price reference: Fibre2Fashion.com + Supima.com 2025.',
      'Knitting, dyeing, and finishing costs are Bangladesh RMG industry averages.',
      `Invisible waste factor of ${wastePct}% applied to account for knitting & winding losses.`,
    ],
  };
}

function round4(v) { return parseFloat(Number(v).toFixed(4)); }

module.exports = {
  calculateCost,
  SM_PRICE_MATRIX,
  YARN_TYPE_CATALOG,
  SM_SURCHARGES,
  getPriceFromMatrix,
  autoDetectYarnType,
};
