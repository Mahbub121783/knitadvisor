/**
 * Learning from trial rolls: one machine's own profile, structure by structure.
 *
 * A roll knitted and measured says how far THIS machine's cloth falls from the
 * Studio's prediction: r = measured ÷ predicted, for finished GSM and open width.
 * The rule below was CHOSEN ON THE FACTORY RECORDS, not assumed: each gauge ×
 * diameter replayed as a machine, its records in order as rolls, every record
 * predicted out-of-fold and then again with what the earlier rolls taught
 * (tools/studio-learning-check.js). What it showed:
 *
 *   width   a machine × structure has a real, steady bias: learning it from the
 *           last 10 rolls cut the median width error 3.3 % → 2.9 % (±5 %: 68 → 71 %)
 *   GSM     what is left after the model is mostly roll-to-roll noise (yarn lot,
 *           finishing, weighing), not a machine bias: learning it from everything
 *           made predictions WORSE (3.9 → 4.5 %). From the same structure at a count
 *           within ±10 %, last 10, heavily shrunk, it is neutral to slightly better.
 *           So the GSM factor is learned only that way, and moves little.
 *
 *   factor   exp( Σ ln r ÷ (n + K) )      the last 10 rolls of this structure, shrunk
 *                                         towards "no effect" by K = 8 rolls' worth
 *   spread   the rolls' scatter around the factor, pooled with the cross-validated
 *            spread (K rolls' worth): a few rolls narrow the range a little, many more
 *
 *   a pool   a machine with no rolls of its own need not start from "no effect": other mills'
 *            rolls, shared as one clamped median per structure (machine-pool.js), are a prior
 *            worth w = a/(a+5) of the K rolls' worth, a = the mills behind it:
 *                factor = exp( (Σ ln r + K · w · ln prior) ÷ (n + K) )
 *            so with no rolls it is prior^w, and every roll of its own pulls it away from the pool.
 *            The spread is never narrowed by the pool.
 */
'use strict';

const MP = require('./machine-pool');
const K = 8, WINDOW = 10, COUNT_TOL = 0.1;
const Z80 = 1.2816;

/** σ of ln(measured ÷ predicted) from a cross-validated error distribution (p10/p90 of (pred − meas)/meas). */
function sigmaFromCV(e) {
  if (!e || e.p10 == null || e.p90 == null) return 0.06;
  return Math.max(0.01, (Math.log(1 + e.p90) - Math.log(1 + e.p10)) / (2 * Z80));
}

function learn(ratios, sigma0, prior) {
  const n = ratios.length;
  const lp = prior ? MP.weight(prior.a) * Math.log(prior.f) : 0;     // the pool's pseudo-observation, ln
  if (!n) return { factor: Math.exp(lp), sd: sigma0, n: 0 };
  const l = ratios.map(Math.log);
  const m = (l.reduce((t, v) => t + v, 0) + K * lp) / (n + K);
  const s2 = n >= 2 ? l.reduce((t, v) => t + (v - m) ** 2, 0) / (n - 1) : 0;
  const dof = Math.max(0, n - 1);
  const pooled = (K * sigma0 * sigma0 + dof * s2) / (K + dof);
  return { factor: Math.exp(m), sd: Math.sqrt(pooled * (1 + 1 / (n + K))), n };
}

/**
 * @param rolls  this machine's rolls, oldest first: [{ group, ne, gsm_ratio, width_ratio }]
 * @param ctx    { group, ne (the design's count, or null), gsmCV, widthCV }
 */
function learnProfile(rolls, ctx) {
  const same = (rolls || []).filter((r) => r.group === ctx.group).slice(-WINDOW);
  const near = same.filter((r) => r.gsm_ratio > 0 && (!(ctx.ne > 0) || !(r.ne > 0) || Math.abs(r.ne / ctx.ne - 1) <= COUNT_TOL));
  const pool = ctx.pool || { gsm: null, width: null };
  const g = learn(near.map((r) => r.gsm_ratio), sigmaFromCV(ctx.gsmCV), pool.gsm);
  const w = learn(same.filter((r) => r.width_ratio > 0).map((r) => r.width_ratio), sigmaFromCV(ctx.widthCV), pool.width);
  return {
    gsm_factor: g.factor, width_factor: w.factor, gsm_sd: g.sd, width_sd: w.sd, n: same.length, n_gsm: g.n, n_width: w.n, n_machine: (rolls || []).length, k: K, window: WINDOW,
    pooled_gsm: pool.gsm ? { accounts: pool.gsm.a, factor: pool.gsm.f } : null, pooled_width: pool.width ? { accounts: pool.width.a, factor: pool.width.f } : null,
  };
}

/** Share of cloths within ±x of the prediction, for a log-normal spread sd. */
function withinPct(sd, x) {
  const z = Math.log(1 + x) / sd / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return Math.round(Math.max(0, Math.min(1, erf)) * 100);
}
const band = (v, sd) => [v * Math.exp(-Z80 * sd), v * Math.exp(Z80 * sd)];

module.exports = { learnProfile, sigmaFromCV, withinPct, band, K, WINDOW, COUNT_TOL };
