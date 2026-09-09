/**
 * Real-order validation scoring
 * ==============================
 *
 * Turns a stored real_order_validations row into a side-by-side comparison
 * against what the engine says TODAY. Nothing here is a formula — this is
 * the "reasoning that compares" the top of formulas/index.js describes, so
 * it lives in domain/, not formulas/.
 *
 * Deliberately re-runs calculate() on every read instead of trusting a
 * prediction stored at entry time: a formula fixed next month should make
 * last month's record score better immediately, not stay frozen against
 * whatever the engine used to say. That is the entire point of a
 * calibration loop — it has to track the CURRENT engine, or it is just a
 * diary.
 *
 * What is scored and what is not:
 *   count_ne, sl_mm  — the engine predicts these; a real mill order records
 *                       what was actually used. Directly comparable.
 *   gsm              — NOT scored as an engine error. GSM is an INPUT (the
 *                       target the engine is asked to hit), not an output —
 *                       comparing actual_gsm to the target tells you about
 *                       the mill's finishing/knitting execution that day,
 *                       not about whether the engine's formula was right.
 *                       Reported separately, clearly labelled, never folded
 *                       into the accuracy stats below.
 */
'use strict';

const { calculate } = require('../index');
const { FAB_BUCKET_ALIAS } = require('./factory-knowledge');

/** Same structural family a fabric's real count/SL data actually comes from
 * (see source-confidence.js's family_alias) — grouping by this instead of
 * the raw fabric_id means a handful of records per exact derivative still
 * accumulate into a bucket large enough to say something. */
function familyOf(fabricId) {
  return FAB_BUCKET_ALIAS[fabricId] || fabricId;
}

function pctError(actual, predicted) {
  if (actual == null || predicted == null || predicted === 0) return null;
  return Math.round(((actual - predicted) / predicted) * 1000) / 10; // signed, 1 decimal
}

/**
 * Score one record against the current engine.
 * @returns {object} scored record — never throws; a spec that no longer
 *   calculates (e.g. a fabric ID since removed) reports `calc_error` instead
 *   of crashing the whole list/summary.
 */
function scoreRecord(row) {
  const base = {
    id: row.id,
    fabric_id: row.fabric_id,
    mill_name: row.mill_name || null,
    order_ref: row.order_ref || null,
    notes: row.notes || null,
    created_at: row.created_at,
    target_gsm: row.spec_input?.gsm ?? null,
    actual: {
      count_ne: row.actual_count_ne != null ? Number(row.actual_count_ne) : null,
      sl_mm: row.actual_sl_mm != null ? Number(row.actual_sl_mm) : null,
      gsm: row.actual_gsm != null ? Number(row.actual_gsm) : null,
    },
  };

  let result;
  try {
    result = calculate(row.spec_input || {});
  } catch (err) {
    return { ...base, calc_error: err.message, predicted: null, errors: null };
  }
  if (result.error) {
    return { ...base, calc_error: result.error, predicted: null, errors: null };
  }

  const predicted = {
    count_ne: result.yarn?.count_ne ?? null,
    sl_mm: result.loop_length?.value_mm ?? null,
    source_confidence: result.yarn?.source_confidence || null,
  };

  return {
    ...base,
    calc_error: null,
    predicted,
    errors: {
      count_pct: pctError(base.actual.count_ne, predicted.count_ne),
      sl_pct: pctError(base.actual.sl_mm, predicted.sl_mm),
      // Execution deviation, not an engine error — see file header.
      gsm_vs_target_pct: pctError(base.actual.gsm, base.target_gsm),
    },
  };
}

/**
 * Aggregate scored records by structural family and by confidence tier, so
 * the question "is 'Estimated' actually worse than 'Factory data' in real
 * orders?" has an answer once enough records exist, instead of staying a
 * plausible-sounding assumption forever.
 */
function summarize(scoredRecords) {
  const usable = scoredRecords.filter(r => !r.calc_error);
  const failed = scoredRecords.length - usable.length;

  function bucketStats(rows, keyFn) {
    const groups = new Map();
    for (const r of rows) {
      const key = keyFn(r);
      if (key == null) continue;
      if (!groups.has(key)) groups.set(key, { count_errs: [], sl_errs: [], n: 0 });
      const g = groups.get(key);
      g.n += 1;
      if (r.errors.count_pct != null) g.count_errs.push(r.errors.count_pct);
      if (r.errors.sl_pct != null) g.sl_errs.push(r.errors.sl_pct);
    }
    const out = [];
    for (const [key, g] of groups) {
      out.push({
        key,
        n: g.n,
        count_mean_abs_pct: meanAbs(g.count_errs),
        count_bias_pct: meanSigned(g.count_errs), // + = engine under-predicts, - = over-predicts
        count_n: g.count_errs.length,
        sl_mean_abs_pct: meanAbs(g.sl_errs),
        sl_bias_pct: meanSigned(g.sl_errs),
        sl_n: g.sl_errs.length,
      });
    }
    // Most-sampled group first — that is the one worth trusting.
    return out.sort((a, b) => b.n - a.n);
  }

  return {
    total_records: scoredRecords.length,
    usable_records: usable.length,
    failed_records: failed, // spec no longer calculates (e.g. a removed fabric id) — shown, not hidden
    overall: {
      count_mean_abs_pct: meanAbs(usable.map(r => r.errors.count_pct).filter(v => v != null)),
      count_bias_pct: meanSigned(usable.map(r => r.errors.count_pct).filter(v => v != null)),
      sl_mean_abs_pct: meanAbs(usable.map(r => r.errors.sl_pct).filter(v => v != null)),
      sl_bias_pct: meanSigned(usable.map(r => r.errors.sl_pct).filter(v => v != null)),
    },
    by_family: bucketStats(usable, r => familyOf(r.fabric_id)),
    by_confidence_tier: bucketStats(usable, r => r.predicted?.source_confidence?.tier ?? null),
  };
}

function meanAbs(arr) {
  if (!arr.length) return null;
  return Math.round((arr.reduce((s, v) => s + Math.abs(v), 0) / arr.length) * 10) / 10;
}
function meanSigned(arr) {
  if (!arr.length) return null;
  return Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10;
}

module.exports = { scoreRecord, summarize };
