/**
 * KnitAdvisor — Yarn Expertise Engine v1.0
 * =========================================
 *
 * The yarn IS the fabric. Count alone (e.g. "30/1") tells you almost nothing —
 * a 30/1 Supima compact-combed yarn and a 30/1 recycled open-end yarn produce
 * completely different fabrics in strength, evenness, pilling, spirality, hand,
 * and price. This engine models the THREE axes that define a real yarn:
 *
 *   1. FIBER GRADE      — staple quality + origin/sustainability
 *                         (Supima/Pima ELS → Giza → Combed Upland → Carded
 *                          Upland → Recycled; plus BCI/Organic/CmiA labels)
 *   2. SPINNING SYSTEM  — how the fibres are assembled into yarn
 *                         (Compact → Combed Ring → Carded Ring → Open-End/Rotor
 *                          → Air-Jet/Vortex)
 *   3. YARN FORM        — single / plied / slub / core-spun
 *
 * From these it derives the real engineering properties factories specify:
 *   • Tenacity (RKM, cN/tex) and CSP (count-strength product)
 *   • Evenness (U% / CVm) and Imperfections (IPI)
 *   • Hairiness and residual torque (drives spirality)
 *   • Maximum spinnable count for the grade (spinning limit)
 *   • Quality rank, price index, and end-use suitability
 *
 * Blends are handled by fibre DENSITY + regain physics so the count↔GSM
 * relationship is grounded, not guessed. Slub/fancy yarns carry an effective
 * (resultant) count distinct from their base count.
 *
 * Sources: Klein "Manual of Textile Technology" (The Technology of Short-Staple
 * Spinning); Uster Statistics 2018; Lord "Handbook of Yarn Production";
 * Supima/Pima fibre data; ASTM D2256/D1907; mill QC practice (BD/India RMG).
 *
 * Deterministic. No AI. No randomness.
 */

'use strict';

const { usterProfile } = require('./uster-engine');

// ============================================================
// 1. FIBER GRADE TAXONOMY  (cotton quality hierarchy + sustainability labels)
//    rank: 1 = finest/strongest. staple_mm = typical upper-half mean length.
//    max_count = practical fine-spin limit (Ne) for this fibre on a ring frame.
//    strength_idx / evenness_idx: 1.00 = standard combed Upland reference.
//    price_idx: relative raw-fibre cost (combed Upland virgin = 1.00).
// ============================================================
const FIBER_GRADES = {
  supima: {
    label: 'Supima / Pima (ELS)', rank: 1, staple_mm: 36, micronaire: '3.8–4.2',
    max_count: 200, strength_idx: 1.30, evenness_idx: 1.18, price_idx: 2.6,
    sustainability: 'Premium US ELS, traceable', combable: true,
    note: 'Extra-long staple. Spins the finest, strongest, most lustrous yarns. Used for premium 60s–200s.',
  },
  giza: {
    label: 'Egyptian Giza (ELS)', rank: 1, staple_mm: 35, micronaire: '3.8–4.3',
    max_count: 180, strength_idx: 1.28, evenness_idx: 1.16, price_idx: 2.8,
    sustainability: 'Egyptian ELS, luxury', combable: true,
    note: 'Giza 45/87/96. Luxury ELS for fine combed counts and high-end shirting/jersey.',
  },
  combed_upland: {
    label: 'Combed Upland', rank: 3, staple_mm: 29, micronaire: '4.0–4.7',
    max_count: 80, strength_idx: 1.00, evenness_idx: 1.00, price_idx: 1.00,
    sustainability: 'Conventional', combable: true,
    note: 'The industry workhorse for quality knits. Combing removes short fibres → cleaner, stronger yarn.',
  },
  carded_upland: {
    label: 'Carded Upland', rank: 5, staple_mm: 27, micronaire: '4.2–4.9',
    max_count: 40, strength_idx: 0.86, evenness_idx: 0.84, price_idx: 0.82,
    sustainability: 'Conventional', combable: false,
    note: 'No combing — retains short fibres. Hairier, weaker, cheaper. Good for coarse/medium counts.',
  },
  bci: {
    label: 'BCI Cotton', rank: 3, staple_mm: 29, micronaire: '4.0–4.7',
    max_count: 80, strength_idx: 1.00, evenness_idx: 1.00, price_idx: 1.03,
    sustainability: 'Better Cotton Initiative (mass-balance)', combable: true,
    note: 'A SOURCING standard, not a fibre grade — properties match conventional Upland of equal staple. Combable.',
  },
  organic: {
    label: 'Organic Cotton', rank: 4, staple_mm: 28, micronaire: '4.0–4.8',
    max_count: 60, strength_idx: 0.96, evenness_idx: 0.95, price_idx: 1.35,
    sustainability: 'GOTS/OCS certified', combable: true,
    note: 'Certified organic. Slightly more variable staple than conventional; price premium for certification.',
  },
  cmia: {
    label: 'Cotton made in Africa', rank: 4, staple_mm: 28, micronaire: '4.1–4.8',
    max_count: 60, strength_idx: 0.97, evenness_idx: 0.96, price_idx: 1.05,
    sustainability: 'CmiA mass-balance', combable: true,
    note: 'African sustainability sourcing standard. Properties ≈ conventional Upland.',
  },
  recycled: {
    label: 'Recycled Cotton', rank: 7, staple_mm: 18, micronaire: 'n/a',
    max_count: 20, strength_idx: 0.55, evenness_idx: 0.60, price_idx: 0.70,
    sustainability: 'Mechanical/post-consumer recycled', combable: false,
    note: 'Fibres broken/shortened during recycling → weak, uneven, coarse-count only. Almost always blended with virgin cotton/PET (20–50%) for spinnability.',
  },
};
const DEFAULT_FIBER_GRADE = 'combed_upland';

// ============================================================
// 2. SPINNING SYSTEM TAXONOMY
//    rkm = tenacity in cN/tex (RKM). u_pct = Uster evenness (lower=better).
//    hairiness_idx, torque_idx (drives spirality), count range, cost factor.
//    Source: Uster Statistics 2018 medians; Klein; Lawrence "Advances in Yarn Spinning".
// ============================================================
const SPINNING_SYSTEMS = {
  compact: {
    label: 'Compact (ring)', rkm: 20, u_pct: 9.0, hairiness_idx: 0.55, torque_idx: 0.60,
    count_min: 20, count_max: 120, cost_idx: 1.20,
    note: 'Condensed fibre bundle before twist → lowest hairiness, highest strength. Best for fine premium counts.',
  },
  combed: {
    label: 'Combed (ring)', rkm: 18, u_pct: 9.8, hairiness_idx: 0.80, torque_idx: 0.85,
    count_min: 16, count_max: 100, cost_idx: 1.00,
    note: 'Combed sliver, ring spun. Standard for quality jersey/interlock. Strong, even.',
  },
  carded: {
    label: 'Carded (ring)', rkm: 16, u_pct: 11.5, hairiness_idx: 1.00, torque_idx: 1.00,
    count_min: 6, count_max: 40, cost_idx: 0.85,
    note: 'Carded sliver, ring spun. Reference for hairiness/torque. Medium/coarse counts.',
  },
  open_end: {
    label: 'Open-End (Rotor)', rkm: 13, u_pct: 11.0, hairiness_idx: 0.70, torque_idx: 0.65,
    count_min: 6, count_max: 30, cost_idx: 0.70,
    note: 'Rotor spun — bulkier, weaker (~-20% vs ring) but cheap & fast. Denim, fleece, sweat. Lower torque → less spirality.',
  },
  vortex: {
    label: 'Air-Jet / Vortex (MVS)', rkm: 15, u_pct: 10.5, hairiness_idx: 0.30, torque_idx: 0.32,
    count_min: 20, count_max: 60, cost_idx: 0.95,
    note: 'Air-jet (Murata Vortex). Very low hairiness, near torque-free → minimal spirality & pilling. Excellent for CVC/poly blends.',
  },
};
const DEFAULT_SPINNING = { fine: 'combed', medium: 'combed', coarse: 'carded' };

// ============================================================
// 3. FIBER DENSITY + REGAIN  (blend GSM/diameter physics)
//    density g/cm³, moisture regain % at 65% RH.
//    Source: textile fibre handbooks (ASTM D1909 regain).
// ============================================================
const FIBER_PROPERTIES = {
  cotton:    { density: 1.52, regain: 7.5,  rkm: 1.00 },
  polyester: { density: 1.38, regain: 0.4,  rkm: 1.25 },
  viscose:   { density: 1.52, regain: 13.0, rkm: 0.60 },
  modal:     { density: 1.52, regain: 12.5, rkm: 0.85 },
  tencel:    { density: 1.50, regain: 11.5, rkm: 1.05 },
  bamboo:    { density: 1.50, regain: 13.0, rkm: 0.55 },
  nylon:     { density: 1.14, regain: 4.2,  rkm: 1.40 },
  wool:      { density: 1.31, regain: 16.0, rkm: 0.50 },
  acrylic:   { density: 1.17, regain: 1.5,  rkm: 0.70 },
  elastane:  { density: 1.20, regain: 1.0,  rkm: 0.80 },
};

// ============================================================
// HELPERS
// ============================================================
function neToTex(ne) { return ne > 0 ? 590.5 / ne : null; }

/** Ashenhurst yarn diameter (inch) = 1/(28·√Ne) for cotton; scaled by fibre density. */
function yarnDiameterMm(ne, blendDensity) {
  if (!ne || ne <= 0) return null;
  const d_in_cotton = 1 / (28 * Math.sqrt(ne));
  const densityScale = Math.sqrt(1.52 / (blendDensity || 1.52)); // lighter fibre → bulkier → larger d
  return parseFloat((d_in_cotton * 25.4 * densityScale).toFixed(4));
}

/** Blend-weighted density & regain from a fibers{} map (percentages). */
function blendPhysical(fibers) {
  if (!fibers) return { density: 1.52, regain: 7.5, rkm_idx: 1.0 };
  let wsum = 0, dsum = 0, rsum = 0, rkm = 0;
  for (const [f, pct] of Object.entries(fibers)) {
    const p = FIBER_PROPERTIES[f];
    if (!p || !pct) continue;
    wsum += pct; dsum += p.density * pct; rsum += p.regain * pct; rkm += p.rkm * pct;
  }
  if (wsum === 0) return { density: 1.52, regain: 7.5, rkm_idx: 1.0 };
  return {
    density: parseFloat((dsum / wsum).toFixed(3)),
    regain:  parseFloat((rsum / wsum).toFixed(2)),
    rkm_idx: parseFloat((rkm / wsum).toFixed(3)),
  };
}

/**
 * Density-grounded count factor for blends.
 * At fixed knit geometry, GSM ∝ Tex (linear density). But blends change the
 * achievable packing: lighter, bulkier fibres (poly, nylon) let the loop pack
 * less mass per cm² at the same count, so a slightly FINER count is needed to
 * hit a heavy GSM target; denser cellulosics behave like cotton. We express
 * this as a small multiplier centred on cotton.
 */
function blendCountFactor(fibers) {
  const phys = blendPhysical(fibers);
  // Reference cotton density 1.52. Each 0.1 g/cm³ lighter → ~3% finer count target.
  const factor = 1 + (1.52 - phys.density) * 0.30;
  return { factor: parseFloat(factor.toFixed(3)), density: phys.density, regain: phys.regain };
}

// ============================================================
// 4. SLUB / FANCY YARN — effective (resultant) count
//    A slub yarn has periodic thick places. Its RESULTANT count is coarser
//    than the base count by the extra mass the slubs add.
//    resultant_Ne = base_Ne / (1 + slub_mass_fraction)
// ============================================================
function slubEffectiveCount(baseNe, opts = {}) {
  // slub thickness multiplier (e.g. 2.0 = slub is 2× base thickness),
  // slub length & spacing in cm → mass fraction added over a repeat.
  const thick = opts.slub_thickness || 1.8;   // typical 1.5–3×
  const slubLen = opts.slub_length_cm || 4;   // cm of thick place
  const spacing = opts.slub_spacing_cm || 20; // cm base between slubs
  const repeat = slubLen + spacing;
  const extraMass = ((thick - 1) * slubLen) / repeat; // fractional extra mass
  const resultant = baseNe / (1 + extraMass);
  return {
    base_ne: baseNe,
    resultant_ne: parseFloat(resultant.toFixed(2)),
    extra_mass_pct: parseFloat((extraMass * 100).toFixed(1)),
    params: { slub_thickness: thick, slub_length_cm: slubLen, slub_spacing_cm: spacing },
    note: `Slub adds ${(extraMass * 100).toFixed(1)}% mass → declare base ${baseNe}s but knit/cost as effective ${resultant.toFixed(1)}s. Use slub-attachment on the spinning frame; expect uneven cover by design.`,
  };
}

// ============================================================
// 5. MAIN — analyse a fully specified yarn
// ============================================================
/**
 * @param {object} args
 * @param {number} args.count_ne
 * @param {object} [args.fibers]          composition fibers{} map
 * @param {string} [args.fiber_grade]     key of FIBER_GRADES
 * @param {string} [args.spinning_system] key of SPINNING_SYSTEMS
 * @param {string} [args.yarn_form]       'single' | 'ply2' | 'slub' | 'core_spun'
 * @param {object} [args.slub]            slub params if yarn_form==='slub'
 */
function analyzeYarn(args = {}) {
  const countNe = parseFloat(args.count_ne) || null;
  const fibers  = args.fibers || { cotton: 100 };

  // Resolve fibre grade (default combed Upland). Recycled forced if requested.
  const gradeKey = FIBER_GRADES[args.fiber_grade] ? args.fiber_grade : DEFAULT_FIBER_GRADE;
  const grade = FIBER_GRADES[gradeKey];

  // Resolve spinning system — auto by count if not given.
  let spinKey = args.spinning_system;
  if (!SPINNING_SYSTEMS[spinKey]) {
    if (!countNe)        spinKey = DEFAULT_SPINNING.medium;
    else if (countNe >= 40) spinKey = 'combed';
    else if (countNe >= 20) spinKey = 'combed';
    else                  spinKey = 'carded';
    // recycled / coarse → open-end is typical
    if (gradeKey === 'recycled') spinKey = 'open_end';
  }
  const spin = SPINNING_SYSTEMS[spinKey];

  const phys = blendPhysical(fibers);
  const diameter_mm = yarnDiameterMm(countNe, phys.density);
  const tex = neToTex(countNe);

  // Spinning limit check — can this grade+system reach this count?
  const maxCount = Math.min(grade.max_count, spin.count_max);
  const minCount = spin.count_min;
  let spinnable = true, spinWarning = null;
  if (countNe && countNe > maxCount) {
    spinnable = false;
    spinWarning = `Count ${countNe}s exceeds the spinning limit for ${grade.label} on a ${spin.label} system (max ~${maxCount}s). Use a finer fibre grade (e.g. ${grade.rank > 2 ? 'combed/compact ELS' : 'Supima compact'}) or a finer system.`;
  } else if (countNe && countNe < minCount) {
    spinWarning = `Count ${countNe}s is coarser than typical for ${spin.label} (min ~${minCount}s). Open-end/rotor is the economical choice for coarse counts.`;
  }

  // Tenacity (RKM) — system base × fibre-blend strength × grade strength.
  const rkm = parseFloat((spin.rkm * phys.rkm_idx * grade.strength_idx).toFixed(1));
  // CSP (count-strength product, approx) — calibrated so combed 30s ≈ 2430.
  // CSP = lea-strength(lbf) × Ne; here proxied from RKM. Real value is count-
  // dependent, so treat as an indicative band, not a lab figure.
  const csp = countNe ? Math.round(rkm * countNe * 4.5) : null;
  // Evenness U% — system base / grade evenness (better grade → lower U%).
  const u_pct = parseFloat((spin.u_pct / grade.evenness_idx).toFixed(1));

  // Torque (spirality driver) — system torque × form factor. Maps to quality-engine yarn_type.
  let formKey, torque = spin.torque_idx;
  const form = (args.yarn_form || 'single').toLowerCase();
  if (form === 'ply2' || form === 'ply_2') { torque *= 0.26; formKey = 'ply_2'; }
  else if (form === 'core_spun')           { torque *= 0.9;  formKey = 'single_' + (spinKey === 'carded' ? 'carded' : 'combed'); }
  else { // single — map system to quality-engine torque bucket
    formKey = spinKey === 'compact' ? 'single_compact'
            : spinKey === 'combed'  ? 'single_combed'
            : spinKey === 'carded'  ? 'single_carded'
            : spinKey === 'open_end'? 'single_open_end'
            : spinKey === 'vortex'  ? 'single_vortex'
            : 'single_combed';
  }

  // Quality rank (1 best .. 7) and price index (fibre × system).
  const quality_rank = grade.rank;
  const price_idx = parseFloat((grade.price_idx * spin.cost_idx).toFixed(2));

  // Pilling tendency note (hairiness × short-fibre content).
  const pilling_tendency = parseFloat((spin.hairiness_idx * (2 - grade.evenness_idx)).toFixed(2));

  // Slub handling
  let slub = null;
  if (form === 'slub') {
    slub = slubEffectiveCount(countNe, args.slub || {});
  }

  // Uster Statistics profile — count-grounded evenness, IPI, hairiness, USP.
  const uster = usterProfile({
    count_ne: countNe,
    spinning_system: spinKey,
    grade_key: gradeKey,
  });
  // Prefer Uster's count-grounded U% over the flat system value.
  const u_final = (uster && uster.ok && uster.u_pct != null) ? uster.u_pct : u_pct;
  if (uster && uster.ok && uster.fibre_count_flag) {
    spinWarning = spinWarning ? spinWarning : uster.fibre_count_flag;
  }

  return {
    ok: true,
    count_ne: countNe,
    tex: tex ? parseFloat(tex.toFixed(2)) : null,
    diameter_mm,
    fiber_grade: { key: gradeKey, ...grade },
    spinning_system: { key: spinKey, ...spin },
    yarn_form: form,
    blend_physical: phys,
    properties: {
      tenacity_rkm: rkm,
      tenacity_rating: rkm >= 18 ? 'High' : rkm >= 15 ? 'Good' : rkm >= 12 ? 'Average' : 'Low',
      csp,
      evenness_u_pct: u_final,
      evenness_rating: u_final <= 9.5 ? 'Excellent' : u_final <= 11 ? 'Good' : u_final <= 13 ? 'Average' : 'Poor',
      hairiness_h: uster && uster.ok ? uster.hairiness_h : null,
      hairiness_idx: spin.hairiness_idx,
      torque_idx: parseFloat(torque.toFixed(2)),
      pilling_tendency,
    },
    uster: uster && uster.ok ? uster : null,
    quality_rank,
    price_index: price_idx,
    spinnable,
    spinning_limit: { min: minCount, max: maxCount },
    quality_engine_yarn_type: formKey,   // feeds spirality torque model
    slub,
    warnings: spinWarning ? [spinWarning] : [],
    test_standards: 'Strength ASTM D2256/D1907 · Evenness Uster (ASTM D1425) · CSP ASTM D1578',
    note: `${grade.label} · ${spin.label} · ${form}. ${grade.note}`,
  };
}

// ============================================================
// 6. RECOMMEND the right yarn grade/system for a target count + fabric
// ============================================================
function recommendYarnGrade(countNe, fabricCategory) {
  if (!countNe) return null;
  let system, grade, reason;

  if (countNe >= 60) {
    system = 'compact'; grade = 'supima';
    reason = 'Very fine count — requires ELS fibre (Supima/Giza) on a compact system to reach this fineness with adequate strength.';
  } else if (countNe >= 40) {
    system = 'combed'; grade = 'combed_upland';
    reason = 'Fine count — must be combed to remove short fibres; compact recommended for premium hand.';
  } else if (countNe >= 20) {
    system = 'combed'; grade = 'combed_upland';
    reason = 'Medium count — combed Upland is the quality standard for jersey/interlock.';
  } else if (countNe >= 10) {
    system = 'carded'; grade = 'carded_upland';
    reason = 'Coarse-medium count — carded Upland is economical and sufficient; open-end for sweat/fleece.';
  } else {
    system = 'open_end'; grade = 'carded_upland';
    reason = 'Coarse count — open-end/rotor is the fast, economical choice (denim, heavy fleece).';
  }

  // Fleece/terry loops & sweat often use OE for bulk.
  if (['fleece', 'terry'].some(k => (fabricCategory || '').includes(k))) {
    if (countNe < 24) { system = 'open_end'; reason += ' Fleece/terry loop benefits from bulky open-end yarn.'; }
  }

  return { recommended_grade: grade, recommended_system: system, reason, grade_label: FIBER_GRADES[grade].label, system_label: SPINNING_SYSTEMS[system].label };
}

module.exports = {
  analyzeYarn,
  recommendYarnGrade,
  blendCountFactor,
  blendPhysical,
  slubEffectiveCount,
  yarnDiameterMm,
  FIBER_GRADES,
  SPINNING_SYSTEMS,
  FIBER_PROPERTIES,
};
