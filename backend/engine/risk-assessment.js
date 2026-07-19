/**
 * KnitAdvisor — Fabric Risk Assessment Matching Engine
 * ======================================================
 *
 * Nearest-match search over the 50 real production job records in
 * backend/data/risk-assessment.json (built from Accurate_Fabric_Risk_Assessment.md
 * by backend/scripts/build-risk-assessment.js). Given the current query's
 * construction family, composition bucket, and GSM, finds the closest real
 * historical job and reports how documented risks, special instructions, and
 * process route it carries — plus its measured shrinkage, for calibrating the
 * predictive shrinkage model (quality-engine.js's `calibration` input).
 *
 * Deterministic nearest-neighbour, same method as factory-match.js. No AI.
 *
 * Confidence is intentionally conservative: only 50 records exist, spread
 * across many different compositions, so a "match" is only surfaced when it's
 * genuinely close — a distant nearest-neighbour is still the nearest, but
 * showing it as if it were representative would overstate what 50 records
 * spread this thin can actually support.
 */
'use strict';

const RISK_RECORDS = require('../data/risk-assessment.json');

// Fibre-family distance — same convention as factory-match.js's compDistance.
function compDistance(a, b) {
  if (a === b) return 0;
  const family = { cotton: 'c', cvc: 'c', pc: 'c', modal: 'r', viscose: 'r' };
  return family[a] === family[b] ? 0.5 : 1.2;
}

/**
 * @param {object} q  { construction, comp, gsm }
 * @returns {object|null} nearest match + confidence, or a not-ok result
 */
function matchRiskAssessment(q) {
  if (!q || !q.construction || !q.gsm) return { ok: false, reason: 'insufficient_query' };

  const pool = RISK_RECORDS.filter(r => r.construction === q.construction);
  if (pool.length === 0) return { ok: false, reason: 'no_construction_records' };

  const comp = ['cotton', 'cvc', 'pc', 'modal', 'viscose'].includes(q.comp) ? q.comp : 'cotton';

  const scored = pool.map(r => {
    const dComp = compDistance(r.comp, comp);
    const dGsm = Math.abs(r.gsm - q.gsm) / 40; // ~40 GSM ≈ 1 unit, matches factory-match.js's scale
    const dist = Math.sqrt(dComp * dComp + dGsm * dGsm);
    return { r, dist };
  }).sort((a, b) => a.dist - b.dist);

  const nearest = scored[0];
  let confidence = 'low', conf_pct = 45;
  if (nearest.dist <= 0.5)      { confidence = 'high';   conf_pct = 88; }
  else if (nearest.dist <= 1.0) { confidence = 'medium';  conf_pct = 68; }

  const r = nearest.r;
  return {
    ok: true,
    confidence,
    confidence_pct: conf_pct,
    distance: parseFloat(nearest.dist.toFixed(3)),
    // Only "high" confidence is close enough to treat as representative —
    // callers should gate display/calibration on this, not just `ok`.
    show: confidence === 'high',
    matched: {
      id: r.id,
      name: r.name,
      construction: r.construction,
      comp: r.comp,
      composition_raw: r.composition_raw,
      gsm: r.gsm,
      yarn_count_raw: r.yarn_count_raw,
      risk_tags: r.risk_tags,
      shrinkage: r.shrinkage,
      special_instructions: r.special_instructions,
      process_route: r.process_route,
      remarks: r.remarks,
    },
    dataset_size: RISK_RECORDS.length,
    source: `Real production risk-assessment records (${RISK_RECORDS.length} jobs)`,
  };
}

module.exports = { matchRiskAssessment };
