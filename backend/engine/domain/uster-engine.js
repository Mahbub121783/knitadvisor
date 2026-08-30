/**
 * KnitAdvisor — USTER® Statistics Engine v1.0
 * ===========================================
 *
 * Implements the classical Uster evenness/quality formulas used worldwide to
 * benchmark spun yarn, so the yarn analysis is grounded in real metrology
 * instead of flat lookup values.
 *
 * Formulas implemented (Uster / textile metrology):
 *   • Fibres in cross-section          n = Tex_yarn / Tex_fibre
 *   • Limit (ideal) irregularity       CVlim% = 100 / √n         (Martindale)
 *   • Index of Irregularity            I = CVm_actual / CVlim     (≥ 1.0)
 *   • Mass irregularity conversion     U% = 0.80 × CVm
 *   • Imperfection Index (IPI/km)      thin(-50%) + thick(+50%) + neps(+200%)
 *   • Hairiness (Uster H)              system + count dependent
 *   • USP — Uster Statistics Percentile (where the yarn ranks, 5%=best)
 *   • Knitting end-break / efficiency  from CVm & IPI (Uster correlation)
 *
 * Fibre fineness from Micronaire:  Tex_fibre ≈ Micronaire × 0.0394  (cotton)
 *   (Mic 4.0 → ~0.158 tex ≈ 1.58 dtex, the textbook value.)
 *
 * Sources: Uster Statistics 2018 application handbook; Martindale (1945) limit
 * irregularity; Klein "Manual of Textile Technology"; ASTM D1425 (evenness).
 *
 * Benchmark bands are representative of Uster Statistics percentile levels for
 * cotton ring/rotor/air-jet yarns. Treat as indicative quality grading, not a
 * substitute for an actual Uster Tester report.
 */

'use strict';

// Index of Irregularity (CVm / CVlim) typical by spinning system.
// Lower = closer to the ideal random yarn = better evenness.
const INDEX_OF_IRREGULARITY = {
  compact:  1.28,
  combed:   1.42,
  carded:   1.58,
  open_end: 1.50,
  vortex:   1.45,
};

// Uster Hairiness (H) base by system at a reference 30s; scaled by count.
const HAIRINESS_BASE = {
  compact:  3.8,
  combed:   5.2,
  carded:   6.4,
  open_end: 5.0,
  vortex:   3.0,
};

// Micronaire (numeric) by fibre grade for fibre-fineness → fibre count.
const GRADE_MICRONAIRE = {
  supima: 3.9, giza: 4.0, combed_upland: 4.3, carded_upland: 4.5,
  bci: 4.3, organic: 4.4, cmia: 4.4, recycled: 4.8,
};

// Fibre-grade multiplier on the Index of Irregularity (mild for normal grades;
// recycled is the special case — short broken fibres → much higher irregularity).
const GRADE_I_MULT = {
  supima: 0.95, giza: 0.96, combed_upland: 1.00, carded_upland: 1.03,
  bci: 1.00, organic: 1.02, cmia: 1.01, recycled: 1.45,
};

function neToTex(ne) { return ne > 0 ? 590.5 / ne : null; }

/** Cotton fibre linear density (tex) from Micronaire. */
function fibreTexFromMic(mic) {
  return (mic || 4.2) * 0.0394;
}

/** Number of fibres in the yarn cross-section. */
function fibresInCrossSection(count_ne, mic) {
  const texYarn = neToTex(count_ne);
  if (!texYarn) return null;
  const texFibre = fibreTexFromMic(mic);
  return Math.round(texYarn / texFibre);
}

/** Limit (ideal) irregularity — Martindale. */
function limitIrregularity(nFibres) {
  if (!nFibres || nFibres <= 0) return null;
  return parseFloat((100 / Math.sqrt(nFibres)).toFixed(2));
}

/** USP rating from the Index of Irregularity (representative Uster bands). */
function uspFromIndex(I) {
  // I≈1.25 → top 5% mills; 1.4 → 25%; 1.55 → 50%; 1.75 → 75%; ≥1.95 → 95%.
  if (I <= 1.30) return { usp: 5,  label: 'USP 5% — world-class (top 5% of mills)' };
  if (I <= 1.42) return { usp: 25, label: 'USP 25% — premium (better than 75% of mills)' };
  if (I <= 1.58) return { usp: 50, label: 'USP 50% — industry median' };
  if (I <= 1.78) return { usp: 75, label: 'USP 75% — below median (75% of mills are better)' };
  return            { usp: 95, label: 'USP 95% — bottom band; quality risk' };
}

/**
 * Imperfection Index (per km), representative Uster-aligned model.
 * Scales with mass irregularity (CVm) and yarn fineness.
 * Returns thin(-50%), thick(+50%), neps(+200%) and total IPI.
 */
function predictIPI(cvm, count_ne) {
  // Base scaling: imperfections grow ~ (CVm)^2; finer yarn shows more.
  const fineFactor = 1 + Math.max(0, (count_ne - 20)) * 0.025;
  const x = Math.max(0, cvm - 7.5);
  const thin  = Math.round(x * x * 0.55 * fineFactor);          // -50%
  const thick = Math.round(x * x * 1.15 * fineFactor);          // +50%
  const neps  = Math.round(x * x * 1.70 * fineFactor);          // +200%
  return { thin, thick, neps, ipi: thin + thick + neps };
}

/** Uster Hairiness (H) — system base scaled by count (finer → lower H). */
function predictHairiness(system, count_ne) {
  const base = HAIRINESS_BASE[system] != null ? HAIRINESS_BASE[system] : HAIRINESS_BASE.combed;
  const scale = Math.sqrt(30 / Math.max(6, count_ne)); // ref 30s
  return parseFloat((base * scale).toFixed(2));
}

/**
 * Knitting performance from yarn quality (Uster correlation).
 * Driven mainly by the count-normalised Index of Irregularity (so a fine yarn
 * near its physical limit is not unfairly penalised), plus a mild count-scaled
 * imperfection term.
 * @param {number} I    index of irregularity
 * @param {number} ipi  imperfections per km (number)
 * @param {number} count_ne
 */
function knittingPerformance(I, ipi, count_ne) {
  const breakIdx = parseFloat((Math.max(0, (I - 1.2)) * 2.0 + (ipi / (300 + count_ne * 15))).toFixed(2));
  let rating, efficiency_pct, note;
  if (breakIdx <= 0.6)      { rating = 'Excellent'; efficiency_pct = 92; note = 'Clean yarn — minimal stops, holes, or needle marks.'; }
  else if (breakIdx <= 1.2) { rating = 'Good';      efficiency_pct = 88; note = 'Acceptable knitting; occasional stops at higher speed.'; }
  else if (breakIdx <= 2.0) { rating = 'Average';   efficiency_pct = 82; note = 'Watch thick places/neps — risk of holes & needle damage; clear yarn or reduce speed.'; }
  else                      { rating = 'Poor';      efficiency_pct = 74; note = 'High imperfections — frequent stops, holes, fly. Use cleared/waxed yarn and lower RPM.'; }
  return { break_index: breakIdx, rating, expected_efficiency_pct: efficiency_pct, note };
}

/**
 * Full Uster profile for a yarn.
 * @param {object} args { count_ne, spinning_system, grade_key, micronaire?, grade_evenness_idx? }
 */
function usterProfile(args = {}) {
  const count_ne = parseFloat(args.count_ne);
  if (!count_ne || count_ne <= 0) return { ok: false, reason: 'count_unavailable' };

  const system = INDEX_OF_IRREGULARITY[args.spinning_system] ? args.spinning_system : 'combed';
  const mic = args.micronaire || GRADE_MICRONAIRE[args.grade_key] || 4.3;

  const nFibres = fibresInCrossSection(count_ne, mic);
  const cvLimit = limitIrregularity(nFibres);

  // Actual CVm = limit × index of irregularity. Index = spinning-system base ×
  // fibre-grade multiplier (gentle for normal grades; strong for recycled).
  const I_system = INDEX_OF_IRREGULARITY[system];
  const gradeMult = GRADE_I_MULT[args.grade_key] != null ? GRADE_I_MULT[args.grade_key] : 1.0;
  const I = parseFloat((I_system * gradeMult).toFixed(3));
  const cvm = cvLimit ? parseFloat((cvLimit * I).toFixed(2)) : null;
  const u_pct = cvm ? parseFloat((cvm * 0.80).toFixed(2)) : null;

  const ipi = cvm ? predictIPI(cvm, count_ne) : null;
  const hairiness = predictHairiness(system, count_ne);
  const usp = uspFromIndex(I);
  const performance = (cvm && ipi) ? knittingPerformance(I, ipi.ipi, count_ne) : null;

  // Spinnability sanity from fibre count (ring needs ~33+, rotor ~100+).
  let fibreCountFlag = null;
  if (nFibres != null) {
    if (system === 'open_end' && nFibres < 100) fibreCountFlag = `Only ${nFibres} fibres in cross-section — below the ~100 minimum for stable rotor spinning. Use ring or a coarser count.`;
    else if (nFibres < 33) fibreCountFlag = `Only ${nFibres} fibres in cross-section — below the ~33 minimum for ring spinning. Needs finer (ELS) fibre to spin this count.`;
  }

  return {
    ok: true,
    fibres_in_cross_section: nFibres,
    micronaire_used: mic,
    fibre_tex: parseFloat(fibreTexFromMic(mic).toFixed(4)),
    cv_limit_pct: cvLimit,
    index_of_irregularity: I,
    cvm_pct: cvm,
    u_pct,
    imperfections_per_km: ipi,
    hairiness_h: hairiness,
    usp_rating: usp,
    knitting_performance: performance,
    fibre_count_flag: fibreCountFlag,
    formula_trace: {
      n: `n = Tex_yarn(${neToTex(count_ne).toFixed(2)}) / Tex_fibre(${fibreTexFromMic(mic).toFixed(4)}) = ${nFibres}`,
      cv_limit: `CVlim = 100/√${nFibres} = ${cvLimit}%`,
      cvm: `CVm = CVlim × I(${I}) = ${cvm}%  →  U% = 0.8×CVm = ${u_pct}%`,
    },
    test_reference: 'Uster Statistics 2018; Martindale limit irregularity; ASTM D1425',
    note: 'Benchmarked against representative Uster percentile bands. For a binding figure, test on an Uster Tester 6.',
  };
}

module.exports = {
  usterProfile,
  fibresInCrossSection,
  limitIrregularity,
  predictIPI,
  predictHairiness,
  knittingPerformance,
  uspFromIndex,
  INDEX_OF_IRREGULARITY,
  GRADE_MICRONAIRE,
};
