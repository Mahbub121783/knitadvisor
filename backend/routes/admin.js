/**
 * Admin Panel Routes
 * GET /admin — login page
 * POST /admin/login — authenticate
 * POST /admin/logout — destroy session
 * GET /admin/ping — check session validity
 * Protected /admin/api/* routes
 */
const express = require('express');
const path = require('path');
const router = express.Router();

const { adminAuth, generateToken, createSession, deleteSession } = require('../middleware/admin-auth');
const providerManager = require('../ai/provider-manager');
const memCache = require('../cache/memory-cache');
const dbCache = require('../cache/db-cache');
const { query: dbQuery } = require('../config/database');
const crypto = require('crypto');

// ============================================================
// PUBLIC: Login / Logout / Ping
// ============================================================

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'admin.html'));
});

router.post('/login', async (req, res) => {
  const { password } = req.body || {};

  if (!password) {
    return res.status(400).json({ error: 'password is required' });
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  try {
    const { rawToken, tokenHash } = await generateToken();
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    await createSession(tokenHash, ip);

    res.json({ ok: true, token: rawToken });
  } catch (err) {
    console.error('[Login Error]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', async (req, res) => {
  const token = req.headers['x-admin-token'];

  if (token) {
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await deleteSession(tokenHash);
    } catch (err) {
      console.error('[Logout Error]', err);
    }
  }

  res.json({ ok: true });
});

router.get('/ping', adminAuth, async (req, res) => {
  res.json({ ok: true });
});

// ============================================================
// PROTECTED: Admin API Routes
// ============================================================

// Query Logs
router.get('/api/logs/stats', adminAuth, async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT
        COUNT(*) AS today_total,
        ROUND(SUM(from_cache) / COUNT(*) * 100, 1) AS cache_hit_pct,
        ROUND(AVG(response_ms), 0) AS avg_response_ms,
        SUM(CASE WHEN input_type='natural_language' THEN 1 ELSE 0 END) AS nl_query_count
      FROM query_logs
      WHERE DATE(created_at) = CURDATE()`
    );

    const data = rows[0];
    res.json({
      today_total: data.today_total || 0,
      cache_hit_pct: data.cache_hit_pct || 0,
      avg_response_ms: data.avg_response_ms || 0,
      nl_query_count: data.nl_query_count || 0
    });
  } catch (err) {
    console.error('[Log Stats Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/logs', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 25;
    const offset = (page - 1) * limit;
    const fabric = req.query.fabric;
    const dateFrom = req.query.date_from;
    const dateTo = req.query.date_to;
    const fromCache = req.query.from_cache;
    const nlOnly = req.query.nl_only === 'true';

    let sql = 'SELECT * FROM query_logs WHERE 1=1';
    const params = [];

    if (fabric) {
      sql += ' AND parsed_fabric = ?';
      params.push(fabric);
    }
    if (dateFrom) {
      sql += ' AND DATE(created_at) >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ' AND DATE(created_at) <= ?';
      params.push(dateTo);
    }
    if (fromCache !== undefined && fromCache !== 'all') {
      sql += ' AND from_cache = ?';
      params.push(fromCache === '1' ? 1 : 0);
    }
    if (nlOnly) {
      sql += " AND input_type = 'natural_language'";
    }

    const countRows = await dbQuery(sql.replace('SELECT *', 'SELECT COUNT(*) as cnt'), params);
    const total = countRows[0]?.cnt || 0;

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await dbQuery(sql, params);

    res.json({
      rows,
      total,
      page,
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('[Logs Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// AI Providers
router.get('/api/providers', adminAuth, async (req, res) => {
  try {
    const providers = await providerManager.getProviders();
    res.json({ providers });
  } catch (err) {
    console.error('[Providers Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/providers/:id/priority', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { priority } = req.body;

    if (!priority || priority < 1 || priority > 4) {
      return res.status(400).json({ error: 'priority must be 1-4' });
    }

    await providerManager.updatePriority(id, priority);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Priority Update Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/providers/:id/enabled', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { enabled } = req.body;

    await providerManager.toggleEnabled(id, enabled);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Enable Toggle Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/providers/:id/apikey', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { key } = req.body;

    if (!key) {
      return res.status(400).json({ error: 'key is required' });
    }

    const rows = await dbQuery('SELECT provider_name FROM ai_provider_stats WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    await providerManager.updateApiKey(rows[0].provider_name, key);
    res.json({ ok: true });
  } catch (err) {
    console.error('[API Key Update Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/providers/:id/test', adminAuth, async (req, res) => {
  try {
    const startMs = Date.now();
    const result = await providerManager.parse('single_jersey 180 GSM');
    const responsMs = Date.now() - startMs;

    res.json({
      ok: true,
      response_ms: responsMs,
      provider: result.provider_used,
      result: result
    });
  } catch (err) {
    console.error('[Provider Test Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/providers/reset-stats', adminAuth, async (req, res) => {
  try {
    await providerManager.resetDailyStats();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Reset Stats Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// Cache Management
router.get('/api/cache/stats', adminAuth, async (req, res) => {
  try {
    const memStats = memCache.stats();
    const dbStats = await dbCache.stats();

    const cacheRows = await dbQuery(
      'SELECT COUNT(*) as cnt, SUM(hit_count) as hits, MIN(created_at) as oldest, MAX(created_at) as newest FROM result_cache WHERE expires_at > NOW()'
    );

    const data = cacheRows[0];
    res.json({
      db_entries: data.cnt || 0,
      db_hits: data.hits || 0,
      mem_size: memStats.size,
      oldest_entry: data.oldest,
      newest_entry: data.newest
    });
  } catch (err) {
    console.error('[Cache Stats Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/cache/entries', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const countRows = await dbQuery(
      'SELECT COUNT(*) as cnt FROM result_cache WHERE expires_at > NOW()'
    );
    const total = countRows[0].cnt || 0;

    const rows = await dbQuery(
      'SELECT cache_key, hit_count, created_at, expires_at FROM result_cache WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );

    res.json({
      rows,
      total,
      page,
      pages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('[Cache Entries Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/cache/entry/:key', adminAuth, async (req, res) => {
  try {
    const key = req.params.key;
    const rows = await dbQuery(
      'SELECT cache_key, result_json, hit_count, created_at, expires_at FROM result_cache WHERE cache_key = ?',
      [key]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Cache entry not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('[Cache Entry Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/cache/flush', adminAuth, async (req, res) => {
  try {
    memCache.clear();
    const deleted = await dbCache.flush();

    res.json({ ok: true, deleted });
  } catch (err) {
    console.error('[Cache Flush Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/cache/entry/:key', adminAuth, async (req, res) => {
  try {
    const key = req.params.key;

    memCache.del(key);
    await dbQuery('DELETE FROM result_cache WHERE cache_key = ?', [key]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[Cache Entry Delete Error]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
