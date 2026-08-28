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
const providerManager = require('../ai/provider-manager-v2');
const memCache = require('../cache/memory-cache');
const { resultCache } = require('../db/repositories/cache-repo');
const logsRepo = require('../db/repositories/logs-repo');
const adminRepo = require('../db/repositories/admin-repo');
const { query: dbQuery } = require('../db/client');
const { verifyPassword, hashPassword, isLegacyHash } = require('../middleware/password');
const { createRateLimiter } = require('../middleware/rate-limiter');
const crypto = require('crypto');

const CSV_EXPORT_LIMIT = parseInt(process.env.CSV_EXPORT_LIMIT, 10) || 10000;

// A leading =, +, - or @ makes Excel treat the cell as a formula, so text a
// visitor typed into the calculator can execute when staff open the export.
const CSV_FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];
function csvCell(value) {
  const v = value == null ? '' : String(value);
  const safe = CSV_FORMULA_PREFIXES.includes(v.charAt(0)) ? "'" + v : v;
  return '"' + safe.replace(/"/g, '""') + '"';
}

// The global limiter is mounted on /api only, so before this the login endpoint
// took unlimited guesses. Passwords were also unsalted SHA-256, which a GPU
// grinds at billions of candidates per second — the two together made the admin
// panel brute-forceable from the open internet.
const loginLimiter = createRateLimiter({
  name: 'admin-login',
  max: 10,
  windowMs: 5 * 60 * 1000,
  message: 'Too many login attempts. Try again in a few minutes.',
});

// ============================================================
// PUBLIC: Login / Logout / Ping
// ============================================================

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'admin.html'));
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    // Fetch by username, then verify in the application. The old query matched
    // username AND hash in SQL, which only works when every stored hash uses one
    // scheme — salted hashes can't be recomputed without first reading the salt.
    const rows = await dbQuery(
      'SELECT id, password_hash FROM admin_users WHERE username = $1 LIMIT 1',
      [username]
    );

    if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Transparently migrate the row off unsalted SHA-256 now that we hold the
    // plaintext and know it is correct.
    if (isLegacyHash(rows[0].password_hash)) {
      dbQuery('UPDATE admin_users SET password_hash = $1 WHERE id = $2', [hashPassword(password), rows[0].id])
        .then(() => console.log('[Login] Upgraded legacy password hash for user id', rows[0].id))
        .catch(err => console.error('[Login] Hash upgrade failed:', err.message));
    }

    const { rawToken, tokenHash } = await generateToken();
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const sessionResult = await createSession(tokenHash, ip);

    res.json({
      ok: true,
      token: rawToken,
      expires_at: sessionResult.expiresAt,
    });
  } catch (err) {
    // Don't return err.message — database errors name tables, columns and hosts.
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
    // Reads the cron-refreshed rollup instead of aggregating query_logs live.
    // The old query also bucketed by the server's date, which is Mountain time
    // — "today" flipped around midday in Bangladesh.
    res.json(await logsRepo.todayStats());
  } catch (err) {
    console.error('[Log Stats Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/logs', adminAuth, async (req, res) => {
  try {
    res.json(await logsRepo.list({
      page:      parseInt(req.query.page, 10) || 1,
      fabric:    req.query.fabric,
      dateFrom:  req.query.date_from,
      dateTo:    req.query.date_to,
      fromCache: req.query.from_cache,
      nlOnly:    req.query.nl_only === 'true',
      search:    req.query.search,
    }));
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
    const annotated = await Promise.all(providers.map(async p => {
      const keys = await providerManager.getProviderKeys(p.id);
      return {
        ...p,
        key_is_set: keys.length > 0
      };
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
    const rows = await dbQuery('SELECT * FROM ai_provider_stats WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Provider not found' });

    const provider = rows[0];
    const keys = await providerManager.getProviderKeys(id);

    if (!keys.length) {
      return res.status(400).json({ error: 'API key not configured (no active keys found in database)' });
    }

    const startMs = Date.now();
    const result = await providerManager.testProvider(provider);
    const responseMs = Date.now() - startMs;

    // Mark healthy in DB on success
    await dbQuery(
      'UPDATE ai_provider_stats SET is_healthy = true, cooldown_until = NULL WHERE id = $1',
      [id]
    );

    res.json({ ok: true, response_ms: responseMs, provider: provider.provider_name, model: provider.model_name, result });
  } catch (err) {
    console.error('[Provider Test Error]', err);
    // Mark unhealthy on failure
    const id = parseInt(req.params.id);
    await dbQuery('UPDATE ai_provider_stats SET is_healthy = false WHERE id = $1', [id]).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/providers/:id/model', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { model_name } = req.body;
    if (!model_name || !model_name.trim()) return res.status(400).json({ error: 'model_name required' });
    await dbQuery('UPDATE ai_provider_stats SET model_name = $1 WHERE id = $2', [model_name.trim(), id]);
    
    // Make sure the model also exists in ai_provider_models for this provider,
    // active and healthy.
    await dbQuery(
      `INSERT INTO ai_provider_models (provider_id, model_name, is_active, is_healthy)
       VALUES ($1, $2, true, true)
       ON CONFLICT (provider_id, model_name) DO UPDATE SET is_active = true, is_healthy = true`,
      [id, model_name.trim()]
    );
    
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
    const dbStats = await resultCache.stats();
    res.json({
      db_entries: Number(dbStats.entries) || 0,
      db_hits: Number(dbStats.total_hits) || 0,
      mem_size: memStats.size,
      oldest_entry: dbStats.oldest,
      newest_entry: dbStats.newest,
    });
  } catch (err) {
    console.error('[Cache Stats Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/cache/entries', adminAuth, async (req, res) => {
  try {
    res.json(await resultCache.list({
      page: parseInt(req.query.page, 10) || 1,
      limit: parseInt(req.query.limit, 10) || 20,
    }));
  } catch (err) {
    console.error('[Cache Entries Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/cache/entry/:key', adminAuth, async (req, res) => {
  try {
    const entry = await resultCache.entry(req.params.key);
    if (!entry) return res.status(404).json({ error: 'Cache entry not found' });
    res.json(entry);
  } catch (err) {
    console.error('[Cache Entry Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/cache/flush', adminAuth, async (req, res) => {
  try {
    memCache.clear();
    const deleted = await resultCache.flush();

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
    await resultCache.remove(key);

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
    const format = req.query.format; // 'csv' for download
    const filters = {
      fabric:   req.query.fabric,
      dateFrom: req.query.date_from,
      dateTo:   req.query.date_to,
      search:   req.query.search,
    };

    if (format === 'csv') {
      // Bounded rather than "no pagination — get all": an unbounded export
      // grows with the log table and eventually builds a response big enough
      // to take the process down.
      const { rows } = await logsRepo.list({ ...filters, page: 1, limit: CSV_EXPORT_LIMIT });
      // The old CSV read r.parsed_composition and r.ip_address, neither of
      // which exists on query_logs — both columns came out empty in every
      // export ever produced. Dropped rather than left as silent blanks.
      const header = ['ID', 'Time', 'Input', 'Fabric', 'GSM', 'Gauge', 'Dia',
                      'AI Provider', 'Response Ms', 'From Cache'].join(',') + '\n';
      const csv = rows.map(r => [
        r.id,
        r.created_at.toISOString(),
        csvCell(r.input_text),
        csvCell(r.parsed_fabric),
        r.parsed_gsm ?? '',
        r.parsed_gauge ?? '',
        r.parsed_dia ?? '',
        csvCell(r.ai_provider),
        r.response_ms ?? '',
        r.from_cache ? '1' : '0',
      ].join(','));
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="inquiries_${Date.now()}.csv"`);
      return res.send(header + csv.join('\n'));
    }

    res.json(await logsRepo.list({
      ...filters,
      page: parseInt(req.query.page, 10) || 1,
      limit: parseInt(req.query.limit, 10) || 50,
    }));
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

    if (!verifyPassword(current_password, admin.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    if (!new_username && !new_password) {
      return res.status(400).json({ error: 'Provide new_username or new_password' });
    }
    if (new_password && new_password.length < 12) {
      return res.status(400).json({ error: 'New password must be at least 12 characters' });
    }

    if (new_username) {
      await dbQuery('UPDATE admin_users SET username = $1 WHERE id = $2', [new_username, admin.id]);
    }
    if (new_password) {
      await dbQuery('UPDATE admin_users SET password_hash = $1 WHERE id = $2', [hashPassword(new_password), admin.id]);
      // A password change should not leave older sessions alive — that is the
      // one moment someone is most likely reacting to a suspected compromise.
      await dbQuery('DELETE FROM admin_sessions').catch(() => {});
    }

    res.json({
      ok: true,
      message: new_password
        ? 'Credentials updated. All sessions were signed out — log in again.'
        : 'Credentials updated successfully in the database.',
    });
  } catch (err) {
    console.error('[Settings Credentials Error]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
