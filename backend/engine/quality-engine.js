/**
 * KnitAdvisor — Predictive Quality Engine v1.0
 *
 * Mathematically predicts:
 *   1. SPIRALITY (fabric twist/skew %) after washing
 *   2. SHRINKAGE (lengthwise & widthwise %) after wash & tumble-dry
 *   3. PILLING RESISTANCE rating
 *   4. BURSTING STRENGTH estimation (kPa)
 *   5. WASH FASTNESS risk rating
 *   6. DIMENSIONAL STABILITY CLASS
 *
 * Sources:
 *   - Onofrei et al. (2020) — Spirality regression for cotton knits
 *   - Hossain et al. (2021) — Shrinkage vs. stitch length for S/J
 *   - Doğu & Çeven (2018)  — GSM, TF, and pilling correlation
 *   - Hakam et al. (2025)  — Fleece fiber composition study (Mansoura Eng. J.)
 *   - Starfish Database     — Industry empirical database for Bangladesh RMG
 *
 * All formulas are deterministic. No AI. No randomness.
 */

// ============================================================
// BASE SHRINKAGE DATABASE
// Source: Starfish Industrial Database + peer-reviewed research
// Format: { fabric_type: { composition: { L%, W% } } }
// ============================================================
const SHRINKAGE_BASE = {
  single_jersey: {
    cotton:      { length: 7.0,  width: 3.0 },
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

  // --- FINAL SHRINKAGE ---
  const lengthShrink = parseFloat((base.length + slMod.length + tfMod.length + elastaneMod.length).toFixed(2));
  const widthShrink  = parseFloat((base.width  + slMod.width  + tfMod.width  + elastaneMod.width ).toFixed(2));

  // Clamp to realistic bounds
  const finalLength = Math.max(0, Math.min(20, lengthShrink));
  const finalWidth  = Math.max(0, Math.min(15, widthShrink));

  // --- SPIRALITY ---
  const fabricSpirality = SPIRALITY_BASE[fabricId] || SPIRALITY_BASE.single_jersey;
  const spiralBase      = fabricSpirality[compKey] || fabricSpirality.cotton || { base_pct: 5.0, tf_sensitivity: 0.3, gsm_sensitivity: -0.008 };
  const spirality_raw   = spiralBase.base_pct + spiralBase.tf_sensitivity * (tf - 14) + spiralBase.gsm_sensitivity * (gsm - 180);
  const spirality_pct   = parseFloat(Math.max(0, spirality_raw).toFixed(2));
  
  // Elastane reduces spirality (recovery force counteracts twist)
  const spiralityFinal  = parseFloat(Math.max(0, spirality_pct - elastane * 0.15).toFixed(2));

  const spiralityRisk = spiralityFinal > 8 ? 'CRITICAL — Severe skew; must use counter-twist yarn or enzyme wash'
    : spiralityFinal > 5 ? 'HIGH — Noticeable twisting; recommend heat setting or anti-twist finish'
    : spiralityFinal > 3 ? 'MEDIUM — Light spirality; compacting recommended'
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
    
    input: { fabricId, gsm, sl_mm, tightness_factor: tf, count_ne: countNe, composition: parsedComp ? parsedComp.display : '100% Cotton (assumed)' },

    shrinkage: {
      lengthwise_pct: finalLength,
      widthwise_pct: finalWidth,
      breakdown: {
        base:         { length: base.length,     width: base.width },
        sl_modifier:  { length: slMod.length,    width: slMod.width },
        tf_modifier:  { length: tfMod.length,    width: tfMod.width },
        elastane_mod: { length: elastaneMod.length, width: elastaneMod.width },
      },
      formula_trace: {
        length: `${base.length} (base) + ${slMod.length} (SL) + ${tfMod.length} (TF) + ${elastaneMod.length} (elastane) = ${finalLength}%`,
        width:  `${base.width}  (base) + ${slMod.width}  (SL) + ${tfMod.width}  (TF) + ${elastaneMod.width}  (elastane) = ${finalWidth}%`,
      },
      source: 'Hossain et al. (2021) IJFTR + Starfish Industrial DB',
    },

    spirality: {
      predicted_pct: spiralityFinal,
      risk_level: spiralityRisk,
      formula_trace: `${spiralBase.base_pct} (base) + ${spiralBase.tf_sensitivity}×(TF-14) + ${spiralBase.gsm_sensitivity}×(GSM-180) − ${elastane}×0.15 = ${spiralityFinal}%`,
      source: 'Onofrei et al. (2020) Textile Research Journal',
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
  if (spirality > 4) recs.push({ process: 'Enzyme Bio-Wash (Cellulase)', reason: `Spirality ${spirality}%. Cellulase enzyme reduces surface torque and fiber snarling.` });
  if (spirality > 6) recs.push({ process: 'Heat Setting (190°C, 30s)', reason: `Critical spirality. Heat setting on pin stenter at 190°C locks structure and removes twist.` });
  if (pillingScore < 2.5) recs.push({ process: 'Bio-Polish (Anti-Pilling Enzyme)', reason: `Pilling score ${pillingScore}/5. Removes protruding fibers causing pilling.` });
  if (['fleece_2_thread', 'fleece_3_thread', 'french_terry'].includes(fabricId)) {
    recs.push({ process: 'Brushing / Raising (3–5 passes)', reason: 'Essential for fleece. Wire-point raising breaks loop heads to generate soft nap.' });
    recs.push({ process: 'Anti-Pilling Shearing', reason: 'After raising, shear to uniform nap height to prevent subsequent pilling.' });
  }

  if (recs.length === 0) recs.push({ process: 'Standard Wash + Soften', reason: 'Fabric quality is within acceptable limits. Standard processing is sufficient.' });

  return recs;
}

module.exports = { predictQuality };
