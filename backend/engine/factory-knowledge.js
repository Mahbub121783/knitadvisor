/**
 * KnitAdvisor — Factory Knowledge Database
 * 
 * Distilled from 2710 real factory R&D records (H&M, C&A, OVS buyers)
 * Source: New ERP R&D Master File-2022.xlsx
 * 
 * This module REPLACES the Python-generated rnd-reference.js.
 * All data is permanently embedded — no external files needed.
 * 
 * Structure: COMPOSITION_REFERENCE[fabricId][compositionKey] → count/SL/gauge data
 */

// ============================================================
// COMPOSITION-AWARE REFERENCE DATA
// Extracted from factory R&D records, grouped by fabric + composition
// ============================================================
const COMPOSITION_REFERENCE = {

  // ============================================================
  // SINGLE JERSEY
  // ============================================================
  single_jersey: {
    '100_cotton': {
      gsm_range: { min: 100, max: 260 },
      count_map: [
        { gsm: 120, count_ne: 40, count_display: '40/1', gauge: 28, sl: 2.55 },
        { gsm: 130, count_ne: 34, count_display: '34/1', gauge: 28, sl: 2.55 },
        { gsm: 140, count_ne: 32, count_display: '32/1', gauge: 24, sl: 2.61, n: 165 },
        { gsm: 150, count_ne: 30, count_display: '30/1', gauge: 24, sl: 2.64, n: 190 },
        { gsm: 160, count_ne: 28, count_display: '28/1', gauge: 24, sl: 2.65, n: 469 },
        { gsm: 170, count_ne: 26, count_display: '26/1', gauge: 24, sl: 2.75 },
        { gsm: 180, count_ne: 24, count_display: '24/1', gauge: 24, sl: 2.84, n: 157 },
        { gsm: 190, count_ne: 22, count_display: '22/1', gauge: 24, sl: 2.86 },
        { gsm: 200, count_ne: 20, count_display: '20/1', gauge: 24, sl: 2.93, n: 122 },
        { gsm: 210, count_ne: 18, count_display: '18/1', gauge: 20, sl: 3.01, n: 40 },
        { gsm: 220, count_ne: 18, count_display: '18/1', gauge: 20, sl: 3.10 },
        { gsm: 240, count_ne: 16, count_display: '16/1', gauge: 18, sl: 3.20 },
      ],
      typical_gauges: [24, 28],
      typical_dia: [30, 32, 34],
    },

    'cotton_elastane_hf': {
      label: 'Cotton + Elastane (Half Feed)',
      gsm_range: { min: 160, max: 280 },
      gsm_offset: 0.15,
      count_map: [
        { gsm: 160, count_ne: 34, count_display: '34/1+40D', gauge: 28, sl: 2.85 },
        { gsm: 180, count_ne: 30, count_display: '30/1+40D', gauge: 28, sl: 2.88 },
        { gsm: 200, count_ne: 26, count_display: '26/1+40D', gauge: 28, sl: 2.90 },
        { gsm: 220, count_ne: 26, count_display: '26/1+40D', gauge: 28, sl: 2.92 },
      ],
      typical_gauges: [28],
      typical_dia: [30, 32],
      lycra_denier: 40,
      feed_type: 'half_feed',
    },

    'cotton_elastane_ff': {
      label: 'Cotton + Elastane (Full Feed)',
      gsm_range: { min: 160, max: 240 },
      gsm_offset: 0.10,
      count_map: [
        { gsm: 180, count_ne: 34, count_display: '34/1+20D', gauge: 28, sl: 2.90 },
        { gsm: 200, count_ne: 30, count_display: '30/1+20D', gauge: 28, sl: 2.92 },
        { gsm: 220, count_ne: 26, count_display: '26/1+20D', gauge: 28, sl: 2.95 },
      ],
      typical_gauges: [28],
      typical_dia: [30, 32],
      lycra_denier: 20,
      feed_type: 'full_feed',
    },

    'cotton_polyester': {
      label: 'Cotton/Polyester Blend',
      gsm_range: { min: 120, max: 260 },
      gsm_offset: -0.03,
      count_map: [
        { gsm: 140, count_ne: 34, count_display: '34/1', gauge: 24, sl: 2.58 },
        { gsm: 160, count_ne: 30, count_display: '30/1', gauge: 24, sl: 2.62 },
        { gsm: 180, count_ne: 26, count_display: '26/1', gauge: 24, sl: 2.78 },
        { gsm: 200, count_ne: 22, count_display: '22/1', gauge: 24, sl: 2.88 },
        { gsm: 220, count_ne: 20, count_display: '20/1', gauge: 20, sl: 3.05 },
      ],
      typical_gauges: [24, 28],
    },

    'cotton_viscose': {
      label: 'Cotton/Viscose Blend',
      gsm_range: { min: 130, max: 240 },
      gsm_offset: 0.02,
      count_map: [
        { gsm: 150, count_ne: 30, count_display: '30/1', gauge: 24, sl: 2.62 },
        { gsm: 180, count_ne: 26, count_display: '26/1', gauge: 24, sl: 2.80 },
        { gsm: 200, count_ne: 22, count_display: '22/1', gauge: 24, sl: 2.90 },
      ],
      typical_gauges: [24, 28],
    },

    'cotton_poly_elastane': {
      label: 'Cotton + Polyester + Elastane (3-blend)',
      gsm_range: { min: 160, max: 280 },
      gsm_offset: 0.12,
      count_map: [
        { gsm: 180, count_ne: 30, count_display: '30/1+40D', gauge: 28, sl: 2.85 },
        { gsm: 200, count_ne: 26, count_display: '26/1+40D', gauge: 28, sl: 2.88 },
        { gsm: 220, count_ne: 24, count_display: '24/1+40D', gauge: 24, sl: 2.92 },
      ],
      typical_gauges: [24, 28],
      lycra_denier: 40,
      feed_type: 'half_feed',
    },
  },

  // ============================================================
  // RIB 1x1
  // ============================================================
  rib_1x1: {
    '100_cotton': {
      gsm_range: { min: 130, max: 300 },
      count_map: [
        { gsm: 160, count_ne: 34, count_display: '34/1', gauge: 18, sl: 2.55 },
        { gsm: 180, count_ne: 34, count_display: '34/1', gauge: 18, sl: 2.65, n: 65 },
        { gsm: 190, count_ne: 30, count_display: '30/1', gauge: 18, sl: 2.70 },
        { gsm: 200, count_ne: 28, count_display: '28/1', gauge: 18, sl: 2.75, n: 33 },
        { gsm: 220, count_ne: 26, count_display: '26/1', gauge: 18, sl: 2.80, n: 30 },
        { gsm: 230, count_ne: 24, count_display: '24/1', gauge: 18, sl: 2.85 },
        { gsm: 240, count_ne: 24, count_display: '24/1', gauge: 18, sl: 2.90 },
        { gsm: 280, count_ne: 20, count_display: '20/1', gauge: 18, sl: 3.10 },
      ],
      typical_gauges: [18],
      typical_dia: [26, 28, 30],
    },

    'cotton_elastane': {
      label: 'Cotton + Elastane (Lycra Rib)',
      gsm_range: { min: 150, max: 280 },
      gsm_offset: 0.18,
      count_map: [
        { gsm: 180, count_ne: 34, count_display: '34/1+40D', gauge: 18, sl: 2.60 },
        { gsm: 200, count_ne: 30, count_display: '30/1+40D', gauge: 18, sl: 2.68 },
        { gsm: 220, count_ne: 30, count_display: '30/1+40D', gauge: 18, sl: 2.72 },
        { gsm: 240, count_ne: 26, count_display: '26/1+20D', gauge: 18, sl: 2.78 },
      ],
      typical_gauges: [18],
      lycra_denier: 40,
      feed_type: 'half_feed',
    },

    'cotton_poly_elastane': {
      label: 'Cotton + Polyester + Elastane (3-blend Rib)',
      gsm_range: { min: 180, max: 300 },
      gsm_offset: 0.15,
      count_map: [
        { gsm: 200, count_ne: 30, count_display: '30/1+40D', gauge: 18, sl: 2.65 },
        { gsm: 220, count_ne: 28, count_display: '28/1+40D', gauge: 18, sl: 2.72 },
        { gsm: 240, count_ne: 26, count_display: '26/1+40D', gauge: 18, sl: 2.78 },
        { gsm: 260, count_ne: 24, count_display: '24/1+40D', gauge: 18, sl: 2.85 },
      ],
      typical_gauges: [18],
      lycra_denier: 40,
      feed_type: 'half_feed',
    },
  },

  // ============================================================
  // RIB 2x2
  // ============================================================
  rib_2x2: {
    '100_cotton': {
      gsm_range: { min: 150, max: 310 },
      count_map: [
        { gsm: 190, count_ne: 30, count_display: '30/1', gauge: 18, sl: 2.65 },
        { gsm: 200, count_ne: 30, count_display: '30/1', gauge: 18, sl: 2.68 },
        { gsm: 220, count_ne: 26, count_display: '26/1', gauge: 18, sl: 2.75, n: 20 },
        { gsm: 240, count_ne: 24, count_display: '24/1', gauge: 18, sl: 2.80 },
        { gsm: 260, count_ne: 20, count_display: '20/1', gauge: 18, sl: 2.90 },
        { gsm: 280, count_ne: 20, count_display: '20/1', gauge: 18, sl: 3.00 },
      ],
      typical_gauges: [18],
    },

    'cotton_elastane': {
      label: 'Cotton + Elastane (Lycra 2x2 Rib)',
      gsm_range: { min: 200, max: 300 },
      gsm_offset: 0.18,
      count_map: [
        { gsm: 200, count_ne: 34, count_display: '34/1+20D', gauge: 18, sl: 2.60 },
        { gsm: 220, count_ne: 34, count_display: '34/1+20D', gauge: 18, sl: 2.65 },
        { gsm: 240, count_ne: 30, count_display: '30/1+20D', gauge: 18, sl: 2.70 },
        { gsm: 260, count_ne: 30, count_display: '30/1+20D', gauge: 18, sl: 2.75 },
      ],
      typical_gauges: [18],
      lycra_denier: 20,
      feed_type: 'full_feed',
    },
  },

  // ============================================================
  // PIQUE
  // ============================================================
  pique: {
    '100_cotton': {
      gsm_range: { min: 130, max: 280 },
      count_map: [
        { gsm: 160, count_ne: 30, count_display: '30/1', gauge: 24, sl: 2.55 },
        { gsm: 180, count_ne: 30, count_display: '30/1', gauge: 24, sl: 2.60 },
        { gsm: 200, count_ne: 28, count_display: '28/1', gauge: 24, sl: 2.67, n: 30 },
        { gsm: 210, count_ne: 24, count_display: '24/1', gauge: 24, sl: 2.70 },
        { gsm: 220, count_ne: 24, count_display: '24/1', gauge: 24, sl: 2.75, n: 25 },
        { gsm: 240, count_ne: 20, count_display: '20/1', gauge: 24, sl: 2.85 },
      ],
      typical_gauges: [24],
      typical_dia: [30, 32],
    },

    'cotton_elastane': {
      label: 'Pique + Lycra',
      gsm_range: { min: 200, max: 280 },
      gsm_offset: 0.12,
      count_map: [
        { gsm: 200, count_ne: 34, count_display: '34/1+20D', gauge: 24, sl: 2.62 },
        { gsm: 210, count_ne: 30, count_display: '30/1+20D', gauge: 24, sl: 2.65 },
        { gsm: 220, count_ne: 30, count_display: '30/1+20D', gauge: 24, sl: 2.68 },
      ],
      typical_gauges: [24],
      lycra_denier: 20,
      feed_type: 'full_feed',
    },
  },

  // ============================================================
  // INTERLOCK
  // ============================================================
  interlock: {
    '100_cotton': {
      gsm_range: { min: 150, max: 380 },
      count_map: [
        { gsm: 180, count_ne: 40, count_display: '40/1', gauge: 24, sl: 2.30 },
        { gsm: 190, count_ne: 40, count_display: '40/1', gauge: 24, sl: 2.35 },
        { gsm: 200, count_ne: 40, count_display: '40/1', gauge: 24, sl: 2.40 },
        { gsm: 220, count_ne: 34, count_display: '34/1', gauge: 24, sl: 2.50, n: 20 },
        { gsm: 240, count_ne: 30, count_display: '30/1', gauge: 24, sl: 2.55, n: 15 },
        { gsm: 260, count_ne: 28, count_display: '28/1', gauge: 18, sl: 2.60 },
        { gsm: 280, count_ne: 26, count_display: '26/1', gauge: 18, sl: 2.65 },
        { gsm: 300, count_ne: 24, count_display: '24/1', gauge: 18, sl: 2.10 },
        { gsm: 320, count_ne: 24, count_display: '24/1', gauge: 18, sl: 2.15 },
      ],
      typical_gauges: [18, 24],
      typical_dia: [30, 32],
    },
  },

  // ============================================================
  // FLEECE
  // ============================================================
  fleece: {
    '100_cotton': {
      gsm_range: { min: 200, max: 400 },
      count_map: [
        { gsm: 200, count_ne: 36, count_display: 'Ground 36/S + Loop 12/S + Binder 75D', gauge: 20, sl: 4.45 },
        { gsm: 220, count_ne: 36, count_display: 'Ground 36/S + Loop 14/S + Binder 75D', gauge: 20, sl: 4.45 },
        { gsm: 240, count_ne: 34, count_display: 'Ground 34/S + Loop 16/S + Binder 75D', gauge: 20, sl: 4.45, n: 50 },
        { gsm: 260, count_ne: 32, count_display: 'Ground 32/S + Loop 18/S + Binder 75D', gauge: 20, sl: 4.45, n: 80 },
        { gsm: 280, count_ne: 30, count_display: 'Ground 30/S + Loop 20/S + Binder 75D', gauge: 20, sl: 4.45, n: 40 },
        { gsm: 300, count_ne: 30, count_display: 'Ground 30/S + Loop 20/S + Binder 75D', gauge: 20, sl: 4.47 },
        { gsm: 320, count_ne: 28, count_display: 'Ground 28/S + Loop 20/S + Binder 75D', gauge: 20, sl: 4.50 },
      ],
      typical_gauges: [20],
      typical_dia: [30, 34],
    },
  },

  // ============================================================
  // TERRY
  // ============================================================
  terry_fabric: {
    '100_cotton': {
      gsm_range: { min: 200, max: 350 },
      count_map: [
        { gsm: 200, count_ne: 30, count_display: 'Ground 30/S + Pile 30/S', gauge: 20, sl: 4.35 },
        { gsm: 220, count_ne: 26, count_display: 'Ground 26/S + Pile 26/S', gauge: 20, sl: 4.40 },
        { gsm: 240, count_ne: 24, count_display: 'Ground 24/S + Pile 24/S', gauge: 20, sl: 4.45 },
        { gsm: 260, count_ne: 22, count_display: 'Ground 22/S + Pile 22/S', gauge: 20, sl: 4.45, n: 30 },
        { gsm: 280, count_ne: 20, count_display: 'Ground 20/S + Pile 20/S', gauge: 20, sl: 4.45, n: 25 },
        { gsm: 300, count_ne: 20, count_display: 'Ground 20/S + Pile 20/S', gauge: 20, sl: 4.50 },
      ],
      typical_gauges: [20],
      typical_dia: [30, 34],
    },
  },

  // ============================================================
  // WAFFLE
  // ============================================================
  waffle: {
    '100_cotton': {
      gsm_range: { min: 160, max: 280 },
      count_map: [
        { gsm: 180, count_ne: 34, count_display: '34/1', gauge: 18, sl: 2.55 },
        { gsm: 200, count_ne: 28, count_display: '28/1', gauge: 18, sl: 2.62 },
        { gsm: 220, count_ne: 28, count_display: '28/1', gauge: 18, sl: 2.70, n: 15 },
        { gsm: 240, count_ne: 24, count_display: '24/1', gauge: 18, sl: 2.80 },
      ],
      typical_gauges: [18],
    },
  },

  // ============================================================
  // SLUB SINGLE JERSEY
  // ============================================================
  slub_sj: {
    '100_cotton': {
      gsm_range: { min: 130, max: 240 },
      count_map: [
        { gsm: 140, count_ne: 30, count_display: '30/1', gauge: 24, sl: 2.60 },
        { gsm: 150, count_ne: 28, count_display: '28/1 Slub', gauge: 24, sl: 2.65, n: 30 },
        { gsm: 160, count_ne: 28, count_display: '28/1 Slub', gauge: 24, sl: 2.68, n: 40 },
        { gsm: 180, count_ne: 24, count_display: '24/1 Slub', gauge: 24, sl: 2.75 },
        { gsm: 200, count_ne: 20, count_display: '20/1 Slub', gauge: 20, sl: 2.90 },
      ],
      typical_gauges: [24],
    },
  },
};

// ============================================================
// LOOKUP FUNCTION
// ============================================================

/**
 * Get the composition-aware reference data for a fabric + composition.
 * 
 * @param {string} fabricId - e.g. 'single_jersey'
 * @param {object} parsedComp - Result from parseComposition()
 * @returns {object|null} - Reference data block or null
 */
function getCompositionReference(fabricId, parsedComp) {
  const fabricData = COMPOSITION_REFERENCE[fabricId];
  if (!fabricData) return null;

  if (!parsedComp) {
    // Default to 100% cotton
    return fabricData['100_cotton'] || null;
  }

  const { fibers, has_elastane, dominant, fiber_count } = parsedComp;

  // 3-component blend (e.g. Cotton+Poly+Elastane)
  if (fiber_count >= 3 && has_elastane && fibers.cotton && fibers.polyester) {
    const key = 'cotton_poly_elastane';
    if (fabricData[key]) return fabricData[key];
  }

  // Elastane blend
  if (has_elastane && fibers.cotton) {
    // Determine feed type
    const elastPct = fibers.elastane || 0;
    if (fabricId.includes('rib') || fabricId.includes('pique')) {
      if (fabricData['cotton_elastane']) return fabricData['cotton_elastane'];
    }
    if (elastPct <= 3) {
      if (fabricData['cotton_elastane_ff']) return fabricData['cotton_elastane_ff'];
    }
    if (fabricData['cotton_elastane_hf']) return fabricData['cotton_elastane_hf'];
    if (fabricData['cotton_elastane']) return fabricData['cotton_elastane'];
  }

  // Cotton/Polyester
  if (fibers.cotton && fibers.polyester && !has_elastane) {
    if (fabricData['cotton_polyester']) return fabricData['cotton_polyester'];
  }

  // Cotton/Viscose
  if (fibers.cotton && fibers.viscose) {
    if (fabricData['cotton_viscose']) return fabricData['cotton_viscose'];
  }

  // Default: 100% cotton
  return fabricData['100_cotton'] || null;
}

/**
 * Find the closest count/SL data for a given GSM from a reference block.
 * Uses linear interpolation between nearest points.
 * 
 * @param {object} refBlock - Reference data block (e.g. COMPOSITION_REFERENCE.single_jersey['100_cotton'])
 * @param {number} gsm - Target GSM
 * @returns {{ count_ne, count_display, gauge, sl, interpolated, source }}
 */
function lookupByGSM(refBlock, gsm) {
  if (!refBlock || !refBlock.count_map || refBlock.count_map.length === 0) {
    return null;
  }

  const map = refBlock.count_map.sort((a, b) => a.gsm - b.gsm);

  // Exact match
  const exact = map.find(m => m.gsm === gsm);
  if (exact) {
    return { ...exact, interpolated: false, source: 'FACTORY_EXACT' };
  }

  // Find surrounding points for interpolation
  let lower = null;
  let upper = null;
  for (const m of map) {
    if (m.gsm <= gsm) lower = m;
    if (m.gsm > gsm && !upper) upper = m;
  }

  // Interpolate
  if (lower && upper) {
    const ratio = (gsm - lower.gsm) / (upper.gsm - lower.gsm);
    const count_ne = Math.round((lower.count_ne + ratio * (upper.count_ne - lower.count_ne)) * 10) / 10;
    const sl = Math.round((lower.sl + ratio * (upper.sl - lower.sl)) * 1000) / 1000;

    // Use the nearest count display (whichever is closer)
    const nearestPoint = ratio < 0.5 ? lower : upper;

    return {
      count_ne,
      count_display: nearestPoint.count_display,
      gauge: nearestPoint.gauge,
      sl,
      interpolated: true,
      source: 'FACTORY_INTERPOLATED',
    };
  }

  // Nearest edge
  if (lower) return { ...lower, interpolated: false, source: 'FACTORY_NEAREST' };
  if (upper) return { ...upper, interpolated: false, source: 'FACTORY_NEAREST' };

  return null;
}

/**
 * Cross-validate a calculated stitch length against factory knowledge.
 * Now composition-aware.
 */
function validateStitchLength(fabricId, gsm, calculatedSL, gauge, yarnCount, parsedComp) {
  const refBlock = getCompositionReference(fabricId, parsedComp);
  if (!refBlock) return { valid: true, confidence: 'no_data', factory_sl: null };

  const ref = lookupByGSM(refBlock, gsm);
  if (!ref || !ref.sl) return { valid: true, confidence: 'no_data', factory_sl: null };

  const deviation = Math.abs(calculatedSL - ref.sl) / ref.sl * 100;

  let confidence = ref.n && ref.n >= 10 ? 'high' : ref.n && ref.n >= 5 ? 'medium' : 'low';
  if (ref.source === 'FACTORY_EXACT') confidence = 'very_high';

  return {
    valid: deviation <= 15,
    deviation_pct: Math.round(deviation * 10) / 10,
    factory_sl: ref.sl,
    factory_count: ref.count_ne,
    factory_count_display: ref.count_display,
    factory_gauge: ref.gauge,
    factory_samples: ref.n || null,
    confidence,
    source: ref.source,
    interpolated: ref.interpolated || false,
    message: deviation <= 5
      ? 'Factory verified ✓'
      : deviation <= 15
        ? `Close to factory data (+${Math.round(deviation)}%)`
        : `Differs from factory data (${Math.round(deviation)}%)`,
  };
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  COMPOSITION_REFERENCE,
  getCompositionReference,
  lookupByGSM,
  validateStitchLength,
};
