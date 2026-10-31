/**
 * POST /api/demo/calculate — the home page's live sample calculator.
 *
 * Public (no account), so it is fenced three ways:
 *   - inputs are whitelisted: eight constructions, four compositions, a
 *     shade list, the finishing / dyeing / surface-finish options, GSM and
 *     gauge clamped to sane ranges. Anything else is refused, so the demo can
 *     never become an unmetered copy of the full calculator.
 *   - the answer is trimmed: no costing breakdown, garment costing, formula
 *     trace or factory records — the price per kg is shown, the working
 *     behind it stays in the signed-in calculator.
 *   - a shared rate limit (database-counted, every worker sees one count)
 *     and an in-process cache of recent answers: dragging a slider back and
 *     forth over the same values costs nothing.
 */
'use strict';

const express = require('express');
const { calculate } = require('../engine/index');
const { createRateLimiter } = require('../middleware/rate-limiter');

const router = express.Router();

const FABRICS = new Set([
  'single_jersey', 'rib_1x1', 'rib_2x2', 'interlock',
  'lacoste_single', 'pique_single', 'french_terry', 'fleece_3_thread',
]);
const COMPOSITIONS = new Set([
  '100% Cotton', '60% Cotton 40% Polyester', '95% Cotton 5% Elastane', '100% Polyester',
]);
const SHADE = /^(1[1-9]-\d{4}|Jet Black)$/;     // TCX codes, plus the one name the page uses
const FINISHING = new Set(['greige', 'tubular_relaxed', 'compacted', 'heat_set']);
const DYEING = new Set(['reactive', 'pigment', 'disperse', 'garment_wash']);
const SURFACE = new Set(['peach_finish', 'brushed', 'enzyme_wash', 'silicone', 'mercerized', 'resin']);

const demoLimiter = createRateLimiter({
  name: 'demo_calculate',
  max: 120,
  windowMs: 10 * 60 * 1000,
  message: 'The live sample is busy — please wait a few minutes, or sign in to use the full calculator.',
});

const cache = new Map();          // key → trimmed result, newest last
const CACHE_MAX = 400;

function readInputs(b) {
  const fabric = String(b.fabric || '');
  if (!FABRICS.has(fabric)) return { error: 'This construction is not in the live sample.' };
  const gsm = Math.round(Number(b.gsm));
  if (!(gsm >= 100 && gsm <= 420)) return { error: 'GSM must be between 100 and 420 in the live sample.' };
  const p = { fabric, gsm, efficiency: 85 };
  if (b.composition) {
    if (!COMPOSITIONS.has(b.composition)) return { error: 'Unknown composition.' };
    p.composition = b.composition;
  }
  if (b.color_input) {
    if (!SHADE.test(String(b.color_input))) return { error: 'Unknown shade.' };
    p.color_input = String(b.color_input);
  }
  if (b.gauge) {
    const g = Math.round(Number(b.gauge));
    if (!(g >= 14 && g <= 32)) return { error: 'Gauge must be between 14 and 32.' };
    p.gauge = g;
  }
  for (const [k, set] of [['finishing_route', FINISHING], ['dyeing_method', DYEING], ['surface_finish', SURFACE]]) {
    if (b[k]) {
      if (!set.has(b[k])) return { error: `Unknown ${k.replace(/_/g, ' ')}.` };
      p[k] = b[k];
    }
  }
  return { p };
}

// What the page and its 3D view read; nothing more. An ALLOW-list: a field
// the engine gains later stays out of the public answer until it is added
// here on purpose. Held back for signed-in users (and said so to the page in
// `locked`): price per kg, process loss, the grey weight to knit, the
// per-shade grey weights, warnings (they quote those weights), and every
// other costing, production, advisory and factory-record block.
const KEEP = [
  'success', 'fabric', 'input', 'composition', 'color_resolved', 'fabric_physics',
  'yarn', 'loop_length', 'machine', 'physical_constraints', 'grammage', 'pattern', 'pique',
];
const LOCKED = ['grey', 'loss', 'price'];

function trim(r) {
  const out = {};
  for (const k of KEEP) if (r[k] !== undefined) out[k] = r[k];
  // the 3D view reads shrinkage; the rest of the quality block stays home
  const q = r.quality_prediction || {};
  out.quality_prediction = { shrinkage: q.shrinkage || null };
  // ...and the dyeing method name
  out.wet_processing = { dyeing_method: (r.wet_processing || {}).dyeing_method || null };
  // stitch length by shade without the grey weights beside it
  const sbs = r.sl_by_shade;
  out.sl_by_shade = sbs && sbs.rows
    ? { rows: sbs.rows.map(x => ({ shade: x.shade, sl_mm: x.sl_mm })) }
    : null;
  // the shade name the 3D view reads — without the grey-weight note beside it
  const col = r.color || {};
  out.color = { shade: col.shade || null, sl_factor: col.sl_factor, sl_direction: col.sl_direction };
  // carbon: the headline split only. Per-m2, per-garment, factor sources and
  // warnings stay with the signed-in calculator.
  const c = r.carbon_footprint;
  out.carbon = c ? {
    total: c.total_co2e_per_kg_fabric,
    fiber: c.fiber_co2e_per_kg_fabric,
    processing: c.processing.co2e_per_kg_fabric,
    vs_cotton_pct: c.vs_conventional_cotton_baseline.pct_difference,
    fibers: c.fiber_breakdown.filter(f => f.modeled).map(f => ({ fiber: f.fiber, pct: f.pct, variant: f.variant, co2e: f.contribution_co2e_per_kg_fabric })),
    unmodeled: c.fiber_breakdown.some(f => !f.modeled),
  } : null;
  out.demo = true;
  out.locked = LOCKED;
  return out;
}

router.post('/calculate', demoLimiter, (req, res) => {
  const { p, error } = readInputs(req.body || {});
  if (error) return res.status(400).json({ success: false, error });

  const key = JSON.stringify(p);
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return res.json(hit);
  }
  try {
    const t0 = Date.now();
    const result = calculate(p);
    if (!result || result.success === false) {
      return res.status(400).json({ success: false, error: (result && result.error) || 'Could not calculate this fabric.' });
    }
    const out = trim(result);
    out.response_ms = Date.now() - t0;
    cache.set(key, out);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    res.json(out);
  } catch (err) {
    console.error('[demo] calculate failed:', err.message);
    res.status(500).json({ success: false, error: 'Could not calculate this fabric.' });
  }
});

module.exports = router;
module.exports.readInputs = readInputs;
module.exports.trim = trim;
