/**
 * KnitAdvisor — Predictive Quality Engine v2.0
 *
 * Mathematically predicts:
 *   1. SPIRALITY (fabric twist/skew %) after laundering  [AATCC 179]
 *   2. SHRINKAGE (lengthwise & widthwise %)              [AATCC 135 / ISO 6330]
 *   3. PILLING RESISTANCE rating                         [ASTM D3512]
 *   4. BURSTING STRENGTH estimation (kPa)                [ISO 13938-1]
 *   5. WASH FASTNESS risk rating                         [ISO 105-C06]
 *   6. DIMENSIONAL STABILITY CLASS
 *
 * v2.0 ACCURACY UPGRADE — adds the two DOMINANT physical drivers that v1 missed:
 *
 *   ▸ SPIRALITY root cause = yarn TWIST LIVELINESS (residual torque).
 *     A knitted loop made from a twist-lively single yarn untwists and rotates
 *     the wale → skew. Plied / compact / vortex yarns are torque-balanced and
 *     barely spiral. v2 adds YARN STRUCTURE + TWIST MULTIPLIER as primary inputs.
 *     Refs: Primentas (2003) J.Text.Inst; Araujo & Smith (1989) Text.Res.J;
 *           Tao, Lo & Lau (1997); Murata Vortex spirality studies.
 *
 *   ▸ SHRINKAGE residual depends on the FINISHING ROUTE the fabric takes.
 *     Greige relaxes fully (8–12%); a compacted/sanforized fabric is already
 *     pre-relaxed (2–4%). v2 adds FINISHING ROUTE as a multiplier on the
 *     relaxation-theory base. Refs: Munden (1959) reference-state K-values;
 *     Heap/Starfish relaxation database; Quaynor et al. (1999).
 *
 * Every prediction carries a CONFIDENCE BAND (model standard error from the
 * source regressions) and is CALIBRATABLE — pass measured lab values to anchor
 * the model to a specific mill's machinery and finishing line.
 *
 * Honest scope: this is a deterministic PREDICTION model grounded in the
 * dominant physical drivers and peer-reviewed regressions. It is accurate to
 * within the stated band for standard ring-spun cotton knits; for an exact
 * figure on a specific quality, anchor it with one lab test (see calibration).
 * No AI. No randomness.
 */

// ============================================================
// BASE SHRINKAGE DATABASE
// Source: Starfish Industrial Database + peer-reviewed research
// Format: { fabric_type: { composition: { L%, W% } } }
// ============================================================
const SHRINKAGE_BASE = {
  single_jersey: {
    // Greige relaxed base. Width raised 3→5.5 to match factory data: compacted
    // S/J cotton shows W ≈ 4.4% (width relaxes more than the old model assumed).
    cotton:      { length: 6.5,  width: 5.5 },
    cvc:         { length: 5.5,  width: 2.5 },
    pc:          { length: 4.0,  width: 2.0 },
    polyester:   { length: 2.5,  width: 1.5 },
    viscose:     { length: 8.0,  width: 4.0 },
    tencel:      { length: 7.5,  width: 3.5 },
    bamboo:      { length: 6.5,  width: 3.0 },
    nylon:       { length: 3.0,  width: 2.0 },
    modal:       { length: 7.0,  width: 3.5 },
  },
  rib_1x1: {
    cotton:      { length: 5.0,  width: 5.0 },
    cvc:         { length: 4.0,  width: 4.5 },
    pc:          { length: 3.0,  width: 3.5 },
    polyester:   { length: 2.0,  width: 2.5 },
    viscose:     { length: 6.5,  width: 5.5 },
    tencel:      { length: 6.0,  width: 5.0 },
  },
  rib_2x2: {
    cotton:      { length: 4.5,  width: 6.0 },
    cvc:         { length: 3.5,  width: 5.0 },
    pc:          { length: 2.5,  width: 4.0 },
    polyester:   { length: 1.5,  width: 2.5 },
  },
  interlock: {
    cotton:      { length: 5.0,  width: 2.5 },
    cvc:         { length: 4.0,  width: 2.0 },
    pc:          { length: 3.0,  width: 1.5 },
    polyester:   { length: 2.0,  width: 1.0 },
    tencel:      { length: 6.0,  width: 2.5 },
  },
  fleece_3_thread: {
    cotton:      { length: 7.0,  width: 1.0 },
    cvc:         { length: 5.5,  width: 0.8 },
    tencel:      { length: 7.0,  width: 0.5 },
    bamboo:      { length: 7.0,  width: 0.9 },
  },
  fleece_2_thread: {
    cotton:      { length: 7.2,  width: 1.2 },
    cvc:         { length: 5.8,  width: 1.0 },
    tencel:      { length: 7.2,  width: 0.7 },
    bamboo:      { length: 5.5,  width: 0.9 },
  },
  french_terry: {
    cotton:      { length: 6.5,  width: 2.0 },
    cvc:         { length: 5.0,  width: 1.8 },
    tencel:      { length: 7.0,  width: 1.5 },
    bamboo:      { length: 6.0,  width: 1.8 },
  },
  pique_single: {
    cotton:      { length: 5.5,  width: 4.0 },
    cvc:         { length: 4.5,  width: 3.2 },
    pc:          { length: 3.0,  width: 2.5 },
  },
  ponte_di_roma: {
    polyester:   { length: 2.0,  width: 1.0 },
    cvc:         { length: 3.5,  width: 2.0 },
    viscose:     { length: 5.0,  width: 2.5 },
  },
};

// ============================================================
// BASE SPIRALITY DATABASE
// Source: Onofrei et al. (2020) — Textile Research Journal
// Spirality % = f(twist direction, TF, GSM, composition)
// ============================================================
const SPIRALITY_BASE = {
  single_jersey: {
    cotton:      { base_pct: 6.5, tf_sensitivity: 0.4, gsm_sensitivity: -0.010 },
    cvc:         { base_pct: 5.0, tf_sensitivity: 0.3, gsm_sensitivity: -0.008 },
    pc:          { base_pct: 3.5, tf_sensitivity: 0.2, gsm_sensitivity: -0.005 },
    polyester:   { base_pct: 2.0, tf_sensitivity: 0.15, gsm_sensitivity: -0.003 },
    viscose:     { base_pct: 4.5, tf_sensitivity: 0.35, gsm_sensitivity: -0.008 },
    tencel:      { base_pct: 3.0, tf_sensitivity: 0.25, gsm_sensitivity: -0.006 },
    bamboo:      { base_pct: 2.0, tf_sensitivity: 0.20, gsm_sensitivity: -0.005 },
  },
  rib_1x1:      { cotton: { base_pct: 0.5, tf_sensitivity: 0.05, gsm_sensitivity: 0 } },
  rib_2x2:      { cotton: { base_pct: 0.3, tf_sensitivity: 0.03, gsm_sensitivity: 0 } },
  interlock:    { cotton: { base_pct: 0.5, tf_sensitivity: 0.04, gsm_sensitivity: 0 } },
  fleece_3_thread: { cotton: { base_pct: 3.0, tf_sensitivity: 0.25, gsm_sensitivity: -0.005 } },
  fleece_2_thread: { cotton: { base_pct: 5.0, tf_sensitivity: 0.35, gsm_sensitivity: -0.008 } },
  french_terry:    { cotton: { base_pct: 4.0, tf_sensitivity: 0.30, gsm_sensitivity: -0.007 } },
};

// ============================================================
// v2.0 — YARN STRUCTURE TORQUE FACTOR  (primary spirality driver)
// Multiplier applied to the SPIRALITY base. A twist-lively single ring yarn is
// the reference (1.00); torque-balanced yarns spiral far less.
// Source: Primentas (2003); Araujo & Smith (1989); Murata vortex data;
//         Kane, Patil & Sudhakar (2007) ring vs compact spirality.
// ============================================================
const YARN_STRUCTURE_TORQUE = {
  single_carded:   1.00,  // highest torque, max spirality (reference)
  single_combed:   0.85,  // combed = more parallel fibres, slightly less snarl
  single_compact:  0.60,  // compact spinning removes hairiness & torque
  single_open_end: 0.65,  // rotor yarn — lower twist liveliness than ring
  single_vortex:   0.32,  // air-jet/vortex — near torque-free, minimal spirality
  ply_2:           0.22,  // 2-ply balances S/Z torque → almost no spirality
  ply_2_compact:   0.15,
};
const DEFAULT_YARN_STRUCTURE = 'single_combed';

// ============================================================
// v2.0 — TWIST MULTIPLIER effect on spirality
// αe (English twist multiplier) for knitting yarn ≈ 3.4–4.0. Neutral ≈ 3.6.
// Each unit of αe above neutral adds ~4% spirality (single yarn).
// Source: Primentas (2003) twist-factor regression.
// ============================================================
const TWIST_NEUTRAL_ALPHA = 3.6;
const TWIST_SPIRALITY_COEFF = 4.0;   // %spirality per unit αe above neutral
const DEFAULT_TWIST_ALPHA = 3.75;    // typical hosiery/knitting yarn

// ============================================================
// v2.1 — FINISHING ROUTE FACTOR  (DIRECTIONAL — length vs width vs spirality)
// CALIBRATED to real factory finishing reports (129 rows, 30s S/J cotton).
// Key finding: compacting/sanforizing pre-shrinks LENGTH heavily (residual
// L ≈ 0–1%) but barely affects WIDTH (residual W ≈ 4–5%), and finishing also
// controls spirality down to ~2%. A single scalar factor cannot capture this,
// so each route carries separate length / width / spirality factors.
// Factory targets (compacted 30s S/J cotton): L ≈ +0.4%, W ≈ −4.4%, spiral ≈ 2.3%.
// Source: factory grey→finish report data + Heap/Starfish relaxation theory.
// ============================================================
const FINISHING_ROUTE = {
  greige:          { length_factor: 1.00, width_factor: 1.00, spirality_factor: 1.00, label: 'Greige / unfinished (full relaxation pending)' },
  tubular_relaxed: { length_factor: 0.70, width_factor: 0.85, spirality_factor: 0.60, label: 'Tubular relaxed / tumble-dried' },
  compacted:       { length_factor: 0.10, width_factor: 0.80, spirality_factor: 0.31, label: 'Open-width compacted / sanforized' },
  heat_set:        { length_factor: 0.12, width_factor: 0.45, spirality_factor: 0.20, label: 'Heat-set (synthetic-rich)' },
};
const DEFAULT_FINISHING_ROUTE = 'compacted'; // most knit fabric is delivered compacted

// ============================================================
// v2.0 — MODEL CONFIDENCE BANDS (±, from source regression std. error)
// ============================================================
const CONF_BAND = {
  shrinkage_length: 1.5,   // ±% (Hossain 2021 / Starfish SE)
  shrinkage_width:  1.0,
  spirality:        1.5,   // ±% (Primentas / Onofrei SE)
};

function estimateTwistAlpha(provided) {
  const a = parseFloat(provided);
  if (a && a >= 2.5 && a <= 5.5) return a;
  return DEFAULT_TWIST_ALPHA;
}

// ============================================================
// STITCH LENGTH SHRINKAGE MODIFIER
// Source: Hossain et al. (2021) — IJFTR
// Longer SL = more shrinkage (less tight structure → more relaxation)
// ============================================================
const SL_SHRINKAGE_MODIFIER = (sl_mm) => {
  // Baseline SL = 2.8mm for S/J. Each 0.1mm above → +0.3% shrinkage
  const base = 2.8;
  const delta = sl_mm - base;
  return { length: parseFloat((delta * 0.30).toFixed(2)), width: parseFloat((delta * 0.15).toFixed(2)) };
};

// ============================================================
// TIGHTNESS FACTOR SHRINKAGE MODIFIER
// Tighter fabric (higher TF) → less relaxation → less shrinkage
// ============================================================
const TF_SHRINKAGE_MODIFIER = (tf) => {
  // Baseline TF = 14. Each unit above 14 → −0.3% length shrinkage
  const base = 14;
  const delta = tf - base;
  return { length: parseFloat((delta * -0.30).toFixed(2)), width: parseFloat((delta * -0.10).toFixed(2)) };
};

// ============================================================
// ELASTANE SHRINKAGE MODIFIER
// Elastane reduces shrinkage significantly due to recovery
// ============================================================
const ELASTANE_MODIFIER = (elastane_pct) => {
  if (!elastane_pct || elastane_pct <= 0) return { length: 0, width: 0 };
  // Each 1% elastane → reduce L shrinkage by 0.4%, W by 0.3%
  return {
    length: parseFloat((-elastane_pct * 0.40).toFixed(2)),
    width:  parseFloat((-elastane_pct * 0.30).toFixed(2)),
  };
};

// ============================================================
// PILLING RESISTANCE PREDICTOR
// Source: Doğu & Çeven (2018) — Fibres & Textiles in Eastern Europe
// ============================================================
function predictPilling(fabricId, parsedComp, gsm, countNe) {
  const fibers = parsedComp ? parsedComp.fibers : { cotton: 100 };
  const cottonPct = fibers.cotton || 0;
  const polyPct = fibers.polyester || 0;
  const viscocePct = fibers.viscose || 0;
  const elastanePct = fibers.elastane || 0;

  // Pilling score (0–5, 5 = best resistance)
  let score = 3.0; // baseline cotton

  // Polyester blending increases pilling risk
  if (polyPct > 0) score -= (polyPct / 100) * 1.5;
  // Fine counts pill more (shorter fibers)
  if (countNe > 36) score -= 0.5;
  else if (countNe > 30) score -= 0.2;
  // Higher GSM = more yarn overlaps = higher pilling
  if (gsm > 250) score -= 0.3;
  // Viscose pills quickly
  if (viscocePct > 30) score -= 0.5;
  // Elastane helps by holding structure
  if (elastanePct > 3) score += 0.3;
  // Interlock / double jersey resists pilling
  if (fabricId === 'interlock' || fabricId === 'ponte_di_roma') score += 0.8;

  score = Math.max(1.0, Math.min(5.0, score));
  const rounded = parseFloat(score.toFixed(1));

  const ratings = {
    5.0: 'Excellent — No pilling expected',
    4.0: 'Good — Minimal pilling after 5+ wash cycles',
    3.0: 'Average — Light pilling after 3–5 washes (standard for cotton)',
    2.0: 'Poor — Pilling expected within 2–3 wash cycles',
    1.0: 'Very Poor — Immediate pilling. Anti-pilling finish required.',
  };

  const ratingKey = Math.round(rounded);
  return {
    score: rounded,
    rating: ratingKey >= 4.5 ? ratings[5.0] : ratingKey >= 3.5 ? ratings[4.0] : ratingKey >= 2.5 ? ratings[3.0] : ratingKey >= 1.5 ? ratings[2.0] : ratings[1.0],
    recommendation: polyPct > 30 ? 'Consider Bio-polish or Anti-pilling enzyme wash to reduce pilling.' : null,
  };
}

// ============================================================
// BURSTING STRENGTH PREDICTOR (kPa)
// Source: Bhattacharjee & Kothari (2014) — IJFTR
// BS ≈ k × GSM × (1 + elastane_factor) × fabric_structure_factor
// ============================================================
function predictBurstingStrength(fabricId, parsedComp, gsm, tightnessF) {
  const fibers = parsedComp ? parsedComp.fibers : { cotton: 100 };
  const elastane = fibers.elastane || 0;
  const polyester = fibers.polyester || 0;
  const tencel = fibers.tencel || 0;

  // Base coefficient by fabric type (empirical from IJFTR)
  const kFactors = {
    single_jersey:   0.92,
    rib_1x1:         1.20,
    rib_2x2:         1.15,
    interlock:       1.35,
    fleece_2_thread: 1.10,
    fleece_3_thread: 1.05,
    french_terry:    1.08,
    pique_single:    1.00,
    ponte_di_roma:   1.30,
  };

  const k = kFactors[fabricId] || 0.92;

  // Fiber modifiers
  let fiberMod = 1.0;
  if (elastane > 3)  fiberMod += 0.25;
  if (polyester > 30) fiberMod += 0.10;
  if (tencel > 30)   fiberMod += 0.08;

  // TF modifier (tighter = slightly higher BS)
  const tfMod = tightnessF ? (1 + (tightnessF - 14) * 0.015) : 1.0;

  const bs_kpa = k * gsm * fiberMod * tfMod * 0.85; // 0.85 = empirical calibration constant

  return {
    value_kpa: parseFloat(bs_kpa.toFixed(1)),
    value_psi: parseFloat((bs_kpa * 0.145).toFixed(2)),
    rating: bs_kpa > 400 ? 'Excellent (>400 kPa)' : bs_kpa > 280 ? 'Good (280–400 kPa)' : bs_kpa > 180 ? 'Average (180–280 kPa)' : 'Below Standard (<180 kPa)',
    standard_ref: 'ISO 13938-1 / ASTM D3786',
  };
}

// ============================================================
// DIMENSIONAL STABILITY CLASS
// Based on combined shrinkage
// ============================================================
function classifyDimensionalStability(lengthShrink, widthShrink) {
  const total = Math.abs(lengthShrink) + Math.abs(widthShrink);
  if (total <= 3.0)  return { class: 'A', label: 'Excellent — Very high dimensional stability' };
  if (total <= 6.0)  return { class: 'B', label: 'Good — Standard commercial stability' };
  if (total <= 10.0) return { class: 'C', label: 'Average — Pre-shrinking (sanforizing) recommended' };
  if (total <= 14.0) return { class: 'D', label: 'Poor — Must apply relaxation finish + pre-setting' };
  return { class: 'E', label: 'Very Poor — Consider blending with synthetic fiber' };
}

// ============================================================
// MAIN QUALITY PREDICT FUNCTION
// ============================================================
function predictQuality(params) {
  const startTime = Date.now();
  const warnings = [];

  const fabricId = (params.fabric || 'single_jersey').toLowerCase().trim();
  const gsm      = parseFloat(params.gsm)           || 180;
  const sl_mm    = parseFloat(params.stitch_length) || 2.8;
  const tf       = parseFloat(params.tightness_factor) || 14.0;
  const countNe  = parseFloat(params.count_ne)      || 30;
  const parsedComp = params.parsedComp || null;

  // v2.0 dominant-driver inputs (optional — sensible defaults if absent)
  const yarnStructure = YARN_STRUCTURE_TORQUE[params.yarn_type] != null ? params.yarn_type : DEFAULT_YARN_STRUCTURE;
  const torqueFactor  = YARN_STRUCTURE_TORQUE[yarnStructure];
  const twistAlpha    = estimateTwistAlpha(params.twist_multiplier);
  const finishKey     = FINISHING_ROUTE[params.finishing_route] ? params.finishing_route : DEFAULT_FINISHING_ROUTE;
  const route         = FINISHING_ROUTE[finishKey];
  const routeLenF     = route.length_factor;
  const routeWidF     = route.width_factor;
  const routeSpirF    = route.spirality_factor;
  // Optional lab calibration anchors (measured %): overrides prediction when given
  const calib = params.calibration || null;

  // Identify dominant composition for lookup
  const fibers  = parsedComp ? parsedComp.fibers : { cotton: 100 };
  const cotton  = fibers.cotton  || 0;
  const poly    = fibers.polyester || 0;
  const viscose = fibers.viscose || 0;
  const elastane= fibers.elastane || 0;

  let compKey = 'cotton';
  if (poly > 50)         compKey = 'polyester';
  else if (poly >= 30)   compKey = 'cvc';
  else if (poly > 0)     compKey = 'cvc';
  else if (viscose > 30) compKey = 'viscose';
  else if (fibers.tencel > 30) compKey = 'tencel';
  else if (fibers.bamboo > 30) compKey = 'bamboo';
  else if (fibers.nylon > 30)  compKey = 'nylon';
  else if (fibers.modal > 30)  compKey = 'modal';

  // Determine if PC (polyester dominant)
  if (poly > cotton && poly > 50) compKey = 'pc';

  // --- BASE SHRINKAGE ---
  const fabricShrinkage = SHRINKAGE_BASE[fabricId] || SHRINKAGE_BASE.single_jersey;
  const base = fabricShrinkage[compKey] || fabricShrinkage.cotton || { length: 6.0, width: 3.0 };

  // --- MODIFIERS ---
  const slMod       = SL_SHRINKAGE_MODIFIER(sl_mm);
  const tfMod       = TF_SHRINKAGE_MODIFIER(tf);
  const elastaneMod = ELASTANE_MODIFIER(elastane);

  // --- RELAXATION-STATE base shrinkage (before finishing route) ---
  const relaxedLength = base.length + slMod.length + tfMod.length + elastaneMod.length;
  const relaxedWidth  = base.width  + slMod.width  + tfMod.width  + elastaneMod.width;

  // v2.1 — apply DIRECTIONAL finishing-route factors (length compacts more than width)
  let lengthShrink = relaxedLength * routeLenF;
  let widthShrink  = relaxedWidth  * routeWidF;

  // v2.0 — lab calibration override (anchor to a measured value if provided)
  if (calib && calib.shrinkage_length != null) lengthShrink = parseFloat(calib.shrinkage_length);
  if (calib && calib.shrinkage_width  != null) widthShrink  = parseFloat(calib.shrinkage_width);

  lengthShrink = parseFloat(lengthShrink.toFixed(2));
  widthShrink  = parseFloat(widthShrink.toFixed(2));

  // Clamp to realistic bounds
  const finalLength = Math.max(0, Math.min(20, lengthShrink));
  const finalWidth  = Math.max(0, Math.min(15, widthShrink));

  // --- SPIRALITY (v2.0 — yarn torque is the primary driver) ---
  const fabricSpirality = SPIRALITY_BASE[fabricId] || SPIRALITY_BASE.single_jersey;
  const spiralBase      = fabricSpirality[compKey] || fabricSpirality.cotton || { base_pct: 5.0, tf_sensitivity: 0.3, gsm_sensitivity: -0.008 };

  // Structure/TF/GSM component (the v1 regression)
  const structuralSpiral = spiralBase.base_pct
    + spiralBase.tf_sensitivity * (tf - 14)
    + spiralBase.gsm_sensitivity * (gsm - 180);

  // v2.0 — yarn TWIST LIVELINESS: torque multiplier × twist-factor excess
  const twistExcess  = TWIST_SPIRALITY_COEFF * Math.max(0, twistAlpha - TWIST_NEUTRAL_ALPHA); // %
  // Apply yarn-structure torque multiplier to the spirality-generating part,
  // then add the twist-factor contribution (also scaled by structure torque,
  // since plied/vortex yarns neutralise twist torque regardless of αe).
  let spirality_raw = (structuralSpiral + twistExcess) * torqueFactor;

  // Elastane recovery force counteracts residual twist
  spirality_raw -= elastane * 0.15;

  // v2.1 — finishing controls residual spirality (compacting/heat-set reduce skew).
  // Calibrated so compacted combed S/J cotton lands ~2.3% (factory data).
  spirality_raw *= routeSpirF;

  // v2.0 — lab calibration override
  let spiralityFinal = parseFloat(Math.max(0, spirality_raw).toFixed(2));
  if (calib && calib.spirality != null) spiralityFinal = parseFloat(calib.spirality);

  const spiralityRisk = spiralityFinal > 8 ? 'CRITICAL — Severe skew; use twist-balanced (ply/compact/vortex) yarn + stenter weft-straightener (anti-skew) + compactor'
    : spiralityFinal > 5 ? 'HIGH — Noticeable twisting; correct on stenter with anti-skew/overfeed, then compactor (heat-set for synthetic-rich)'
    : spiralityFinal > 3 ? 'MEDIUM — Light spirality; stenter overfeed + compacting straightens the wale line'
    : 'LOW — Within acceptable limits (≤3%)';

  // --- PILLING ---
  const pilling = predictPilling(fabricId, parsedComp, gsm, countNe);

  // --- BURSTING STRENGTH ---
  const bursting = predictBurstingStrength(fabricId, parsedComp, gsm, tf);

  // --- DIMENSIONAL STABILITY CLASS ---
  const stability = classifyDimensionalStability(finalLength, finalWidth);

  // --- WASH FASTNESS RISK ---
  const washRisk = (cotton > 70 && !['cvc', 'pc'].includes(compKey))
    ? { rating: 'Moderate', note: 'Pure cotton prone to color bleeding in reactive dyes. Use fixative bath.' }
    : poly > 50
    ? { rating: 'Excellent', note: 'Polyester-dominant blends have excellent color fastness to washing.' }
    : viscose > 30
    ? { rating: 'Poor', note: 'Viscose/Rayon has low dye-bond affinity. Expect color loss after 3–5 washes.' }
    : { rating: 'Good', note: 'Blend composition provides reasonable color fastness.' };

  // --- WARNINGS ---
  if (spiralityFinal > 6) warnings.push(`High spirality risk (${spiralityFinal}%). Use S-twist + Z-twist balanced yarn feeding.`);
  if (finalLength > 10)   warnings.push(`High length shrinkage predicted (${finalLength}%). Pre-shrink using open-width compactor.`);
  if (finalWidth > 5)     warnings.push(`High width shrinkage predicted (${finalWidth}%). Over-feed during finishing.`);
  if (pilling.score < 2.5) warnings.push(`Poor pilling resistance. Apply bio-polish enzyme treatment.`);

  return {
    success: true,
    response_ms: Date.now() - startTime,
    
    input: { fabricId, gsm, sl_mm, tightness_factor: tf, count_ne: countNe, composition: parsedComp ? parsedComp.display : '100% Cotton (assumed)',
             yarn_structure: yarnStructure, twist_multiplier_alpha: twistAlpha, finishing_route: finishKey },

    model_meta: {
      version: '2.1',
      method: 'Deterministic regression on dominant physical drivers (yarn torque, twist factor, relaxation reference state, finishing route).',
      accuracy_note: 'Predicted values carry the stated ± confidence band for standard ring-spun cotton knits. For an exact figure on a specific quality, anchor the model with one lab test via the calibration input.',
      test_standards: { shrinkage: 'AATCC 135 / ISO 6330 / AATCC 150', spirality: 'AATCC 179', pilling: 'ASTM D3512 / Martindale', bursting: 'ISO 13938-1 / ASTM D3786', wash_fastness: 'ISO 105-C06' },
      calibration_supported: true,
      calibration_applied: !!calib,
    },

    shrinkage: {
      lengthwise_pct: finalLength,
      widthwise_pct: finalWidth,
      confidence_band: {
        length: [parseFloat(Math.max(0, finalLength - CONF_BAND.shrinkage_length).toFixed(1)), parseFloat((finalLength + CONF_BAND.shrinkage_length).toFixed(1))],
        width:  [parseFloat(Math.max(0, finalWidth  - CONF_BAND.shrinkage_width ).toFixed(1)), parseFloat((finalWidth  + CONF_BAND.shrinkage_width ).toFixed(1))],
      },
      finishing_route: { key: finishKey, label: route.label, length_factor: routeLenF, width_factor: routeWidF, spirality_factor: routeSpirF },
      breakdown: {
        relaxed_base: { length: parseFloat(relaxedLength.toFixed(2)), width: parseFloat(relaxedWidth.toFixed(2)) },
        base:         { length: base.length,     width: base.width },
        sl_modifier:  { length: slMod.length,    width: slMod.width },
        tf_modifier:  { length: tfMod.length,    width: tfMod.width },
        elastane_mod: { length: elastaneMod.length, width: elastaneMod.width },
        route_length_factor: routeLenF,
        route_width_factor:  routeWidF,
      },
      formula_trace: {
        length: `[${base.length} base + ${slMod.length} SL + ${tfMod.length} TF + ${elastaneMod.length} elastane] × ${routeLenF} (${finishKey} length) = ${finalLength}%`,
        width:  `[${base.width} base + ${slMod.width} SL + ${tfMod.width} TF + ${elastaneMod.width} elastane] × ${routeWidF} (${finishKey} width) = ${finalWidth}%`,
      },
      calibrated: !!(calib && (calib.shrinkage_length != null || calib.shrinkage_width != null)),
      test_standard: 'AATCC 135 / ISO 6330 (home laundering), AATCC 150 (garment)',
      reference_note: 'Directional finishing-route model: compacting pre-shrinks LENGTH heavily but barely affects WIDTH. Calibrated to a real factory grey→finish report (129 rows, 30s S/J cotton: L≈0.4%, W≈4.4%).',
      source: 'Factory finishing-report data (30s S/J, 2026) + Munden (1959) reference state; Heap/Starfish relaxation DB',
    },

    spirality: {
      predicted_pct: spiralityFinal,
      risk_level: spiralityRisk,
      confidence_band: [parseFloat(Math.max(0, spiralityFinal - CONF_BAND.spirality).toFixed(1)), parseFloat((spiralityFinal + CONF_BAND.spirality).toFixed(1))],
      drivers: {
        yarn_structure: yarnStructure,
        torque_factor: torqueFactor,
        twist_multiplier_alpha: twistAlpha,
        twist_excess_pct: parseFloat(twistExcess.toFixed(2)),
        structural_component: parseFloat(structuralSpiral.toFixed(2)),
      },
      formula_trace: `([${parseFloat(structuralSpiral.toFixed(2))} structural + ${parseFloat(twistExcess.toFixed(2))} twist(αe ${twistAlpha})] × ${torqueFactor} torque[${yarnStructure}]) − ${elastane}×0.15 elastane = ${spiralityFinal}%`,
      calibrated: !!(calib && calib.spirality != null),
      test_standard: 'AATCC 179 (skew after laundering)',
      reference_note: 'Spirality is driven primarily by yarn residual torque (twist liveliness). Plied / compact / vortex yarns are torque-balanced and barely spiral, regardless of TF or GSM.',
      source: 'Primentas (2003) J.Text.Inst; Araujo & Smith (1989); Onofrei et al. (2020)',
    },

    pilling: pilling,

    bursting_strength: bursting,

    dimensional_stability: stability,

    wash_fastness: washRisk,

    finishing_recommendations: buildFinishingRecommendations(finalLength, finalWidth, spiralityFinal, pilling.score, fabricId),

    warnings,
  };
}

// ============================================================
// FINISHING RECOMMENDATIONS ENGINE
// ============================================================
function buildFinishingRecommendations(lengthS, widthS, spirality, pillingScore, fabricId) {
  const recs = [];

  if (lengthS > 5) recs.push({ process: 'Compacting / Sanforizing', reason: `Predicted length shrinkage ${lengthS}%. Compactor will mechanically pre-shrink lengthwise.` });
  if (widthS > 3)  recs.push({ process: 'Open-Width Finish + Overfeeding', reason: `Width shrinkage ${widthS}%. Feed fabric at slight overfeed on stenter to allow width relaxation.` });
  if (spirality > 4) recs.push({ process: 'Stenter Anti-Skew + Compacting', reason: `Spirality ${spirality}%. Set the wale line on a stenter with weft-straightener/skew-bow correction and controlled overfeed, then lock it on the compactor. (Enzyme wash does NOT fix spirality — it only reduces pilling.)` });
  if (spirality > 6) recs.push({ process: 'Heat Setting (190°C, 30s)', reason: `Critical spirality on synthetic-rich fabric. Pin-stenter heat setting at 190°C relaxes residual torque and locks the structure before compacting.` });
  if (pillingScore < 2.5) recs.push({ process: 'Bio-Polish (Anti-Pilling Enzyme)', reason: `Pilling score ${pillingScore}/5. Removes protruding fibers causing pilling.` });
  if (['fleece_2_thread', 'fleece_3_thread', 'french_terry'].includes(fabricId)) {
    recs.push({ process: 'Brushing / Raising (3–5 passes)', reason: 'Essential for fleece. Wire-point raising breaks loop heads to generate soft nap.' });
    recs.push({ process: 'Anti-Pilling Shearing', reason: 'After raising, shear to uniform nap height to prevent subsequent pilling.' });
  }

  if (recs.length === 0) recs.push({ process: 'Standard Wash + Soften', reason: 'Fabric quality is within acceptable limits. Standard processing is sufficient.' });

  return recs;
}

module.exports = { predictQuality };
