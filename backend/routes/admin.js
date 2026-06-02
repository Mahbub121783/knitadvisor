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

const { adminAuth, generateToken, createSession, deleteSession, buildMemToken } = require('../middleware/admin-auth');
const providerManager = require('../ai/provider-manager-v2');
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
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const passHash = crypto.createHash('sha256').update(password).digest('hex');
    const rows = await dbQuery(
      'SELECT id FROM admin_users WHERE username = ? AND password_hash = ?',
      [username, passHash]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const { rawToken, tokenHash } = await generateToken();
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const sessionResult = await createSession(tokenHash, ip);

    // If DB is down, return a signed composite token (hash.sig) that works without DB
    const responseToken = sessionResult.mode === 'mem'
      ? buildMemToken(rawToken)
      : rawToken;

    res.json({
      ok: true,
      token: responseToken,
      session_mode: sessionResult.mode,
      expires_at: sessionResult.expiresAt,
    });
  } catch (err) {
    console.error('[Login Error]', err);
    res.status(500).json({ error: 'Login failed', detail: err.message });
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
    const [providers, strategy] = await Promise.all([
      providerManager.getProviders(),
      providerManager.getStrategy()
    ]);
    const annotated = providers.map(p => ({
      ...p,
      key_is_set: !!(process.env[p.api_key_env] && process.env[p.api_key_env].trim().length > 0)
    }));
    res.json({ providers: annotated, strategy });
  } catch (err) {
    console.error('[Providers Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// Get available provider types for Add Provider modal
router.get('/api/providers/types', adminAuth, async (req, res) => {
  res.json({ types: providerManager.getProviderTypes() });
});

// Get/set fallback strategy
router.get('/api/providers/strategy', adminAuth, async (req, res) => {
  try {
    const strategy = await providerManager.getStrategy();
    res.json({ strategy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/providers/strategy', adminAuth, async (req, res) => {
  try {
    const { strategy } = req.body;
    const valid = ['priority', 'round_robin', 'weighted', 'fastest'];
    if (!valid.includes(strategy)) return res.status(400).json({ error: 'Invalid strategy. Use: ' + valid.join(', ') });
    await providerManager.setStrategy(strategy);
    res.json({ ok: true, strategy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a new provider instance
router.post('/api/providers', adminAuth, async (req, res) => {
  try {
    const { provider_type, display_name, api_key_env, model_name, api_url, daily_limit, per_min_limit } = req.body;
    if (!provider_type) return res.status(400).json({ error: 'provider_type required' });
    if (!api_key_env) return res.status(400).json({ error: 'api_key_env required' });
    const providerName = await providerManager.addProvider({ provider_type, display_name, api_key_env, model_name, api_url, daily_limit, per_min_limit });
    res.json({ ok: true, provider_name: providerName });
  } catch (err) {
    console.error('[Add Provider Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete a provider instance
router.delete('/api/providers/:id', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await providerManager.deleteProvider(id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Delete Provider Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/providers/:id/priority', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { priority } = req.body;

    if (!priority || priority < 1) {
      return res.status(400).json({ error: 'priority must be >= 1' });
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
    if (!key) return res.status(400).json({ error: 'key is required' });
    await providerManager.updateApiKey(id, key);
    res.json({ ok: true });
  } catch (err) {
    console.error('[API Key Update Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/providers/:id/test', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const rows = await dbQuery('SELECT * FROM ai_provider_stats WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Provider not found' });

    const provider = rows[0];
    const apiKey = process.env[provider.api_key_env];

    if (!apiKey || !apiKey.trim()) {
      return res.status(400).json({ error: `API key not configured (${provider.api_key_env} is empty)` });
    }

    const startMs = Date.now();
    const result = await providerManager.testProvider(provider);
    const responseMs = Date.now() - startMs;

    // Mark healthy in DB on success
    await dbQuery(
      'UPDATE ai_provider_stats SET is_healthy = 1, cooldown_until = NULL WHERE id = ?',
      [id]
    );

    res.json({ ok: true, response_ms: responseMs, provider: provider.provider_name, model: provider.model_name, result });
  } catch (err) {
    console.error('[Provider Test Error]', err);
    // Mark unhealthy on failure
    const id = parseInt(req.params.id);
    await dbQuery('UPDATE ai_provider_stats SET is_healthy = 0 WHERE id = ?', [id]).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/providers/:id/model', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { model_name } = req.body;
    if (!model_name || !model_name.trim()) return res.status(400).json({ error: 'model_name required' });
    await dbQuery('UPDATE ai_provider_stats SET model_name = ? WHERE id = ?', [model_name.trim(), id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Model Update Error]', err);
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

// ============================================================
// Inquiries — paginated query_logs with CSV download support
// ============================================================

router.get('/api/inquiries', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const format = req.query.format; // 'csv' for download

    let sql = 'SELECT * FROM query_logs';
    const params = [];
    const conditions = [];

    if (req.query.fabric) { conditions.push('parsed_fabric = ?'); params.push(req.query.fabric); }
    if (req.query.date_from) { conditions.push('DATE(created_at) >= ?'); params.push(req.query.date_from); }
    if (req.query.date_to) { conditions.push('DATE(created_at) <= ?'); params.push(req.query.date_to); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');

    if (format === 'csv') {
      // No pagination for CSV — get all
      const rows = await dbQuery(sql + ' ORDER BY created_at DESC', params);
      const header = 'ID,Time,Input,Fabric,GSM,Gauge,Dia,Composition,AI Provider,Response Ms,From Cache,IP\n';
      const csvRows = rows.map(r => [
        r.id,
        r.created_at,
        `"${(r.input_text||'').replace(/"/g,'""')}"`,
        r.parsed_fabric||'',
        r.parsed_gsm||'',
        r.parsed_gauge||'',
        r.parsed_dia||'',
        `"${(r.parsed_composition||'').replace(/"/g,'""')}"`,
        r.ai_provider||'',
        r.response_ms||'',
        r.from_cache?'1':'0',
        r.ip_address||''
      ].join(','));
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="inquiries_${Date.now()}.csv"`);
      return res.send(header + csvRows.join('\n'));
    }

    const countRows = await dbQuery(sql.replace('SELECT *', 'SELECT COUNT(*) as cnt'), params);
    const total = countRows[0]?.cnt || 0;
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const rows = await dbQuery(sql, params);
    res.json({ rows, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[Inquiries Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Settings — read/update admin credentials
// ============================================================

router.get('/api/settings', adminAuth, async (req, res) => {
  try {
    const rows = await dbQuery('SELECT username FROM admin_users LIMIT 1');
    const username = rows[0]?.username || 'knitadvisor';
    res.json({
      username,
      yarn_prices_note: 'Yarn prices are defined in backend/engine/costing-engine.js SM_PRICE_MATRIX. Use POST /admin/api/settings/yarn-price to override a single entry in the DB overrides table (future feature).',
    });
  } catch (err) {
    console.error('[Settings Get Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/settings/credentials', adminAuth, async (req, res) => {
  try {
    const { new_username, new_password, current_password } = req.body || {};
    if (!current_password) {
      return res.status(400).json({ error: 'Current password is required' });
    }

    // Fetch the first admin user from the database
    const rows = await dbQuery('SELECT * FROM admin_users LIMIT 1');
    if (!rows.length) {
      return res.status(500).json({ error: 'No admin user found in database' });
    }
    const admin = rows[0];

    const currentHash = crypto.createHash('sha256').update(current_password).digest('hex');
    if (currentHash !== admin.password_hash) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    if (!new_username && !new_password) {
      return res.status(400).json({ error: 'Provide new_username or new_password' });
    }

    if (new_username) {
      await dbQuery('UPDATE admin_users SET username = ? WHERE id = ?', [new_username, admin.id]);
    }
    if (new_password) {
      const newHash = crypto.createHash('sha256').update(new_password).digest('hex');
      await dbQuery('UPDATE admin_users SET password_hash = ? WHERE id = ?', [newHash, admin.id]);
    }

    res.json({ ok: true, message: 'Credentials updated successfully in the database.' });
  } catch (err) {
    console.error('[Settings Credentials Error]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
