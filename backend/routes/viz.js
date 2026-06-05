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
const { query } = require('../config/database');

// ─────────────────────────────────────────────────────────────
// GET /api/viz-config/:fabric_id
// Returns the viz_configs row for a fabric. Falls back gracefully.
// ─────────────────────────────────────────────────────────────
router.get('/viz-config/:fabric_id', async (req, res) => {
  const { fabric_id } = req.params;
  try {
    const rows = await query(
      'SELECT * FROM viz_configs WHERE fabric_id = ?',
      [fabric_id]
    );
    if (rows.length > 0) {
      const cfg = rows[0];
      if (cfg.bar_colors && typeof cfg.bar_colors === 'string') {
        try { cfg.bar_colors = JSON.parse(cfg.bar_colors); } catch (_) {}
      }
      return res.json({ ok: true, config: cfg, default: false });
    }
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
    const cached = await query(
      'SELECT path_json FROM viz_render_cache WHERE cache_key = ? AND expires_at > NOW()',
      [cacheKey]
    );
    if (cached.length > 0) {
      await query(
        'UPDATE viz_render_cache SET hit_count = hit_count + 1, last_hit = NOW() WHERE cache_key = ?',
        [cacheKey]
      );
      const payload = JSON.parse(cached[0].path_json);
      return res.json({ ok: true, from_cache: true, ...payload });
    }
  } catch (_) { /* cache miss — continue */ }

  // Load viz_config for this fabric (or use defaults)
  let config = {};
  try {
    const cfgRows = await query('SELECT * FROM viz_configs WHERE fabric_id = ?', [fabric_id]);
    if (cfgRows.length > 0) {
      config = cfgRows[0];
      if (config.bar_colors && typeof config.bar_colors === 'string') {
        try { config.bar_colors = JSON.parse(config.bar_colors); } catch (_) {}
      }
    }
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
    await query(
      `INSERT INTO viz_render_cache (cache_key, fabric_id, path_json, render_ms, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))
       ON DUPLICATE KEY UPDATE
         path_json = VALUES(path_json),
         render_ms = VALUES(render_ms),
         hit_count = 0,
         expires_at = VALUES(expires_at)`,
      [cacheKey, fabric_id, JSON.stringify(payload), payload.render_ms]
    );
  } catch (cacheErr) {
    // Cache write failure is non-fatal — still return the result
    console.warn('[VizRoute] cache write skipped:', cacheErr.message);
  }

  res.json({ ok: true, from_cache: false, ...payload });
});

module.exports = router;
