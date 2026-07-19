/**
 * KnitAdvisor — Factory Knowledge Database
 *
 * COMPOSITION_REFERENCE is loaded from backend/data/composition-reference.json,
 * built by backend/scripts/build-composition-reference.js from the real
 * factory ERP R&D Master File (2,201 usable greige→finish records — see
 * backend/engine/factory-dataset.js). Regenerate that JSON whenever the
 * source records change; don't hand-edit it here.
 *
 * The real dataset is keyed by 8 structural buckets (single_jersey, rib,
 * pique, interlock, fleece, terry, waffle, heavy_jersey) — coarser than the
 * 54 individual structures in fabric-derivatives.js (the source spreadsheet
 * doesn't distinguish e.g. 1x1 vs 2x2 vs cardigan rib). FAB_BUCKET_ALIAS below
 * maps every fabric ID to its nearest real bucket, so every fabric — not just
 * the ones that happen to share a name with a bucket — gets a real,
 * sample-count-backed reference instead of silently falling through to the
 * unclamped GSM→count regression (which produces nonsense, even negative,
 * counts well within GSM ranges knitters actually use — e.g. heavy rib/fleece
 * fabrics above ~350-400 GSM).
 *
 * Structure: COMPOSITION_REFERENCE[bucket][compositionKey] → count/SL/gauge data
 */

const COMPOSITION_REFERENCE = require('../data/composition-reference.json');

// ============================================================
// FABRIC ID → REAL DATA BUCKET
// ============================================================
const FAB_BUCKET_ALIAS = {
  // single_jersey family — plain + lightweight/structural single-bed variants
  single_jersey: 'single_jersey',
  pointelle: 'single_jersey', pointelle_eyelet: 'single_jersey',
  pointelle_chevron: 'single_jersey', pointelle_diagonal: 'single_jersey',
  plated_jersey: 'single_jersey', single_jacquard: 'single_jersey',
  single_cross_tuck: 'single_jersey', mock_rib: 'single_jersey',
  knitted_twill: 'single_jersey', knitted_crepe: 'single_jersey',
  moss_stitch: 'single_jersey',

  heavy_jersey: 'heavy_jersey',

  // pique / lacoste (single-bed tuck structures)
  pique_single: 'pique', pique_double: 'pique',
  lacoste_single: 'pique', lacoste_pique: 'pique', texipique: 'pique',

  // fleece / french terry (loopback single-bed, brushed) — structurally
  // distinct from toweling terry ('terry' bucket below)
  french_terry: 'fleece', fleece_2_thread: 'fleece', fleece_3_thread: 'fleece',
  fleece_diagonal: 'fleece',

  // toweling terry
  terry_fabric: 'terry',

  // rib family (all 1x1/2x1/2x2/3x3/4x1 variants, cardigan, milano, cable, drop-needle)
  rib_1x1: 'rib', rib_2x1: 'rib', rib_2x2: 'rib', rib_3x2: 'rib', rib_3x3: 'rib', rib_4x1: 'rib',
  lycra_rib_1x1: 'rib', lycra_rib_2x2: 'rib',
  half_cardigan: 'rib', full_cardigan: 'rib',
  half_milano: 'rib', full_milano: 'rib',
  drop_needle_rib: 'rib', cable_rib: 'rib',

  waffle_knit: 'waffle',

  // interlock / double-knit family
  interlock: 'interlock', ponte_di_roma: 'interlock', eight_lock: 'interlock',
  swiss_double_pique: 'interlock', french_double_pique: 'interlock',
  gabardine_double: 'interlock', poplin_double: 'interlock', bourrelet: 'interlock',
  blister_single: 'interlock', relief_single: 'interlock',

  // warp_knit (tricot/locknit/sharkskin/spacer/powernet) is denier-based, not
  // Ne/GSM-regression-based — intentionally has no bucket alias; the caller
  // (calculator.js) never invokes this lookup for category === 'warp_knit'.
};

// Sample-weighted least-squares slope of `points[i][field]` vs `points[i].gsm`,
// weighting each point by its real sample count `n` (falls back to 1 if
// absent) so thin (n=1) tail points don't dominate the trend.
function weightedSlope(points, field) {
  let sw = 0, swx = 0, swy = 0, swxx = 0, swxy = 0;
  for (const p of points) {
    const w = p.n || 1;
    const x = p.gsm, y = p[field];
    sw += w; swx += w * x; swy += w * y; swxx += w * x * x; swxy += w * x * y;
  }
  const denom = sw * swxx - swx * swx;
  if (Math.abs(denom) < 1e-9) return 0;
  return (sw * swxy - swx * swy) / denom;
}

// ============================================================
// LOOKUP FUNCTION
// ============================================================

/**
 * Get the composition-aware reference data for a fabric + composition.
 *
 * @param {string} fabricId - e.g. 'rib_2x1' (aliased to its real data bucket)
 * @param {object} parsedComp - Result from parseComposition()
 * @returns {object|null} - Reference data block or null
 */
function getCompositionReference(fabricId, parsedComp) {
  const bucket = FAB_BUCKET_ALIAS[fabricId] || fabricId;
  const fabricData = COMPOSITION_REFERENCE[bucket];
  if (!fabricData) return null;

  if (!parsedComp || !parsedComp.fibers) {
    return fabricData['100_cotton'] || null;
  }

  // Same dominant-fibre classification used when the real dataset was built
  // (build-factory-dataset.js's mapComposition()) — one rule, applied both at
  // build time and query time, so a user's typed composition lands in the
  // same bucket a real record with that blend would have.
  const f = parsedComp.fibers;
  const cotton = f.cotton || 0, poly = f.polyester || 0, viscose = f.viscose || 0;
  let key = '100_cotton';
  if (viscose >= 15) key = 'cotton_viscose';
  else if (poly > 0 && poly >= cotton) key = 'poly_cotton';
  else if (poly > 0) key = 'cotton_polyester';

  // Elastane blends aren't split out here (the real dataset has no reliable
  // elastane% field to bucket on) — SL/count adjustment for elastane is
  // already applied separately via composition-engine.js's
  // getCompositionModifiers(). This reference stays a same-fibre-family
  // sanity check, not a claim of elastane-specific sample backing.
  return fabricData[key] || fabricData['100_cotton'] || null;
}

/**
 * Find the closest count/SL data for a given GSM from a reference block.
 * Interpolates between real data points; EXTRAPOLATES beyond the last real
 * point using the nearest segment's slope (rather than silently repeating
 * the edge value forever) so heavy fabrics above the sampled range still get
 * a physically-reasoned estimate instead of a stale low-GSM recipe. Confidence
 * degrades accordingly (source: 'FACTORY_EXTRAPOLATED').
 *
 * @param {object} refBlock - Reference data block (e.g. COMPOSITION_REFERENCE.rib['100_cotton'])
 * @param {number} gsm - Target GSM
 * @returns {{ count_ne, count_display, gauge, sl, interpolated, source }}
 */
function lookupByGSM(refBlock, gsm) {
  if (!refBlock || !refBlock.count_map || refBlock.count_map.length === 0) {
    return null;
  }

  const map = [...refBlock.count_map].sort((a, b) => a.gsm - b.gsm);

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

  // Beyond the sampled range — extrapolate instead of flat-clamping to the
  // edge value (which used to hand back e.g. a 280 GSM recipe verbatim for a
  // 600 GSM request). Uses a sample-weighted slope over the last several
  // points (not just the literal last two) — real factory data is noisy
  // enough that a 2-point slope can swing on one thin sample (n=1) and, for
  // SL specifically, even point the wrong direction (shorter loop at higher
  // GSM, which isn't physically sensible for the same structure/gauge).
  if (map.length >= 2) {
    const useUpperEnd = lower != null;
    const window = useUpperEnd ? map.slice(-Math.min(4, map.length)) : map.slice(0, Math.min(4, map.length));
    const anchor = useUpperEnd ? window[window.length - 1] : window[0];
    const slopeNe = weightedSlope(window, 'count_ne');
    const slopeSl = weightedSlope(window, 'sl');
    const dGsm = gsm - anchor.gsm;
    // Floor count at a physically spinnable minimum; heavy fabrics run coarse
    // yarn but never below ~4 Ne in practice.
    const count_ne = Math.max(4, Math.round((anchor.count_ne + slopeNe * dGsm) * 10) / 10);
    // SL should not go BELOW the anchor's real SL as GSM increases further —
    // heavier fabric never needs a shorter loop for the same structure/gauge.
    const sl = Math.max(anchor.sl, Math.round((anchor.sl + slopeSl * dGsm) * 1000) / 1000);

    return {
      count_ne,
      count_display: `${count_ne}/1 (est.)`,
      gauge: anchor.gauge,
      sl,
      interpolated: false,
      source: 'FACTORY_EXTRAPOLATED',
      extrapolated_from_gsm: anchor.gsm,
    };
  }

  // Only one data point total — nothing to extrapolate a slope from.
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
  if (ref.source === 'FACTORY_EXTRAPOLATED') confidence = 'low';

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
    extrapolated: ref.source === 'FACTORY_EXTRAPOLATED',
    // "Factory verified" is only honest when the reference itself is backed by
    // enough real samples (confidence high/very_high) — a numeric coincidence
    // against a low/no-sample-count or extrapolated bucket isn't verification.
    message: (deviation <= 5 && (confidence === 'very_high' || confidence === 'high'))
      ? 'Factory verified ✓'
      : ref.source === 'FACTORY_EXTRAPOLATED'
        ? `Beyond sampled range (extrapolated from ${ref.extrapolated_from_gsm} g/m² data) — treat as indicative`
        : deviation <= 15
          ? `Close to factory estimate (+${Math.round(deviation)}%, ${ref.n || 'few'} samples)`
          : `Differs from factory data (${Math.round(deviation)}%)`,
  };
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  COMPOSITION_REFERENCE,
  FAB_BUCKET_ALIAS,
  getCompositionReference,
  lookupByGSM,
  validateStitchLength,
};
