'use strict';

/**
 * KnitAdvisor — Visualization Routes (Internal)
 *
 * All computation runs on YOUR server using YOUR engine.
 * No external APIs, no AI provider keys, no third-party calls.
 *
 * Routes:
 *   GET  /api/viz-config/:fabric_id  — reads viz_configs from your DB
 *   POST /api/visualize              — generates + caches path data
 */

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

const { generateWeftKnitPaths, generateWarpKnitPaths } = require('../engine/viz-engine');
const vizRepo = require('../db/repositories/viz-repo');
const { vizCache } = require('../db/repositories/cache-repo');

// ─────────────────────────────────────────────────────────────
// GET /api/viz-config/:fabric_id
// Returns the viz_configs row for a fabric. Falls back gracefully.
// ─────────────────────────────────────────────────────────────
router.get('/viz-config/:fabric_id', async (req, res) => {
  const { fabric_id } = req.params;
  try {
    // bar_colors is jsonb, so it comes back as an array already — the old
    // string-sniff-and-JSON.parse fallback is no longer needed.
    const cfg = await vizRepo.findByFabric(fabric_id);
    if (cfg) return res.json({ ok: true, config: cfg, default: false });
    return res.json({ ok: true, config: null, default: true });
  } catch (err) {
    console.error('[VizRoute] viz-config error:', err.message);
    res.status(500).json({ ok: false, error: 'DB error' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/visualize
// Generates VizPathData for complex patterns (warp knit, large repeats).
// Results are cached in viz_render_cache (7-day TTL).
// ─────────────────────────────────────────────────────────────
router.post('/visualize', async (req, res) => {
  const startMs = Date.now();
  const { fabric_id, result_object } = req.body || {};

  if (!fabric_id || !result_object) {
    return res.status(400).json({ ok: false, error: 'fabric_id and result_object are required' });
  }

  // Deterministic cache key
  const keyInput = JSON.stringify({
    fabric_id,
    gauge:    (result_object.machine || {}).gauge_optimal,
    count_ne: (result_object.yarn    || {}).count_ne,
    bars:     ((result_object.warp_knit || {}).guide_bars || {}).count,
  });
  const cacheKey = crypto.createHash('md5').update(keyInput).digest('hex');

  // Check cache
  try {
    const cached = await vizCache.get(cacheKey);
    if (cached) return res.json({ ok: true, from_cache: true, ...cached });
  } catch (_) { /* cache miss — continue */ }

  // Load viz_config for this fabric (or use defaults)
  // bar_colors is jsonb now, so it arrives as an array — the old
  // "if it's a string, try to parse it and swallow failures" step is gone.
  let config = {};
  try {
    config = (await vizRepo.findByFabric(fabric_id)) || {};
  } catch (_) {}

  // Generate path data using our own engine
  const isWarpKnit = (result_object.fabric || {}).category === 'warp_knit'
    || (result_object.fabric || {}).machine_type === 'warp_knit_tricot'
    || (result_object.fabric || {}).machine_type === 'warp_knit_raschel';

  let payload = {};
  try {
    if (isWarpKnit) {
      payload.warp = generateWarpKnitPaths(result_object, config);
    } else {
      payload.weft = generateWeftKnitPaths(result_object, config);
    }
  } catch (genErr) {
    console.error('[VizRoute] path generation error:', genErr.message);
    return res.status(500).json({ ok: false, error: 'Visualization generation failed', detail: genErr.message });
  }

  payload.render_ms = Date.now() - startMs;

  // Store in viz_render_cache (7-day TTL, safe for production DB)
  try {
    await vizCache.set(cacheKey, fabric_id, payload, payload.render_ms);
  } catch (cacheErr) {
    // Cache write failure is non-fatal — still return the result
    console.warn('[VizRoute] cache write skipped:', cacheErr.message);
  }

  res.json({ ok: true, from_cache: false, ...payload });
});

module.exports = router;
