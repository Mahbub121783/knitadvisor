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
const { TIGHTNESS_LIMITS } = require('./formulas');

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

  // rib family (all 1x1/2x1/2x2/3x1/3x2/3x3/4x1/4x2/4x3/5x1/5x3/5x4 gauge combos,
  // plus cardigan, milano, cable, drop-needle derivatives)
  rib_1x1: 'rib', rib_2x1: 'rib', rib_2x2: 'rib', rib_3x1: 'rib', rib_3x2: 'rib', rib_3x3: 'rib',
  rib_4x1: 'rib', rib_4x2: 'rib', rib_4x3: 'rib', rib_5x1: 'rib', rib_5x3: 'rib', rib_5x4: 'rib',
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
    const ref = fabricData['100_cotton'] || null;
    return ref ? { ...ref, _fallback_from: null } : null;
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

  // NOT every fabric bucket has real sampled data for every blend key (e.g.
  // the real dataset has no cotton-viscose or poly-dominant RIB records — only
  // 100_cotton and cotton_polyester; several buckets — waffle/interlock/
  // heavy_jersey — have ONLY 100_cotton at all). Falling through to
  // '100_cotton' silently in that case used to hand back plain-cotton count/SL
  // for e.g. a 65%-polyester fabric with no signal anything was substituted.
  // Flag it via `_fallback_from` so the caller can (a) tell the user real
  // blend data isn't available for this fabric+composition and (b) still
  // apply the generic composition modifier (getCompositionModifiers) on top
  // of the cotton baseline — which the exact-match branch below intentionally
  // skips, since real matched blend data already reflects that composition.
  // Elastane blends aren't split out here (the real dataset has no reliable
  // elastane% field to bucket on) — SL/count adjustment for elastane is
  // already applied separately via composition-engine.js's
  // getCompositionModifiers(). This reference stays a same-fibre-family
  // sanity check, not a claim of elastane-specific sample backing.
  let usedKey = key;
  if (!fabricData[usedKey]) usedKey = '100_cotton';
  const ref = fabricData[usedKey] || null;
  return ref ? { ...ref, _fallback_from: (usedKey !== key) ? key : null } : null;
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
 * @param {string} [familyKey] - Structural family (matches TIGHTNESS_LIMITS keys:
 *   rib/interlock/pique/waffle/terry/fleece/single_jersey/heavy_jersey) — used ONLY
 *   for the beyond-sampled-range extrapolation below, to keep the estimated count+SL
 *   combination physically knittable (see note there).
 * @returns {{ count_ne, count_display, gauge, sl, interpolated, source }}
 */
function lookupByGSM(refBlock, gsm, familyKey) {
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
    let sl = Math.round((lower.sl + ratio * (upper.sl - lower.sl)) * 1000) / 1000;
    const nearestPoint = ratio < 0.5 ? lower : upper;

    // count_ne and sl are interpolated independently along two separate real
    // records — each REAL point is individually knittable, but a straight
    // line between two records (which may come from different composition
    // samples) isn't guaranteed to be. Same floor as the extrapolation branch
    // below: never let the interpolated pair land tighter than the family's
    // ideal Tightness Factor ceiling.
    let tf_floor_applied = false;
    const limitsMid = familyKey && TIGHTNESS_LIMITS[familyKey];
    if (limitsMid) {
      const texMid = 590.5 / count_ne;
      const slFloorMm = parseFloat(((Math.sqrt(texMid) / limitsMid.ideal_max) * 10).toFixed(3));
      if (slFloorMm > sl) { sl = slFloorMm; tf_floor_applied = true; }
    }

    return {
      count_ne,
      count_display: nearestPoint.count_display,
      gauge: nearestPoint.gauge,
      sl,
      interpolated: true,
      source: 'FACTORY_INTERPOLATED',
      tf_floor_applied,
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
    const slTrend = Math.max(anchor.sl, Math.round((anchor.sl + slopeSl * dGsm) * 1000) / 1000);

    // Count and SL are extrapolated independently (two separate linear trends),
    // so far enough beyond the sampled window they can drift into a combination
    // that is knittable on paper but not in reality — e.g. a heavy 600 GSM rib
    // extrapolated from 130-420 GSM samples can land on a coarse count PLUS a
    // still-short SL, giving a Tightness Factor far past the structure's real
    // ceiling (needles breaking, yarn snapping). Real mills solve heavy GSM by
    // going coarser on BOTH count and loop length together, staying inside the
    // knittable band — so once we're extrapolating, floor the SL at whatever
    // loop length keeps TF at the family's ideal ceiling for this count, and
    // take the looser (larger) of that floor and the plain trend line. This
    // never fights real sampled data (interpolation above is untouched) — it
    // only keeps guesses beyond the data honestly knittable.
    let sl = slTrend;
    let tf_floor_applied = false;
    const limits = familyKey && TIGHTNESS_LIMITS[familyKey];
    if (limits) {
      const tex = 590.5 / count_ne; // Ne → Tex, same constant as UnitConverter.neToTex
      const slFloorMm = parseFloat(((Math.sqrt(tex) / limits.ideal_max) * 10).toFixed(3));
      if (slFloorMm > sl) {
        sl = slFloorMm;
        tf_floor_applied = true;
      }
    }

    return {
      count_ne,
      count_display: `${count_ne}/1 (est.)`,
      gauge: anchor.gauge,
      sl,
      interpolated: false,
      source: 'FACTORY_EXTRAPOLATED',
      extrapolated_from_gsm: anchor.gsm,
      tf_floor_applied,
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
function validateStitchLength(fabricId, gsm, calculatedSL, gauge, yarnCount, parsedComp, familyKey) {
  const refBlock = getCompositionReference(fabricId, parsedComp);
  if (!refBlock) return { valid: true, confidence: 'no_data', factory_sl: null };

  const ref = lookupByGSM(refBlock, gsm, familyKey);
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
