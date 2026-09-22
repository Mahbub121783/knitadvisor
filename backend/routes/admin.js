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
const validationRepo = require('../db/repositories/validation-repo');
const rfqRepo = require('../db/repositories/rfq-repo');
const userRepo = require('../db/repositories/user-repo');
const { isValidStatus, VALID_STATUSES } = require('../engine/domain/rfq-engine');
const { scoreRecord, summarize } = require('../engine/domain/validation-scoring');
const { calculate } = require('../engine/index');
const { query: dbQuery } = require('../db/client');
const { verifyPassword, hashPassword, isLegacyHash } = require('../middleware/password');
const { createRateLimiter } = require('../middleware/rate-limiter');
const crypto = require('crypto');
const { validateEmailOnly, passwordProblem } = require('../engine/domain/auth-validation');
const { issueAndSend } = require('../services/account-codes');
const mailClient = require('../mail/client');
const { passwordChangedByAdminEmail, emailChangedNoticeEmail } = require('../mail/templates');

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
      // Security review 2026-09-13: failed attempts went unlogged, so an
      // ongoing brute-force run (bounded to 10/5min by loginLimiter, but not
      // prevented) left no trail once that window reset — nothing to look at
      // in stderr.log after the fact. Username, not password, is logged.
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      console.warn(`[Login] Failed attempt for username "${username}" from ${ip}`);
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

// ============================================================
// OVERVIEW — one aggregated call for the dashboard's command-center tab.
// Every figure here is read straight from existing repos/tables (the
// materialized-view rollups logs-repo already builds, rfqRepo.counts(),
// user-repo's new-signup/session counts) — nothing is computed client-side
// from a truncated log sample the way the old "Top Fabrics" card was.
// ============================================================
router.get('/api/overview', adminAuth, async (req, res) => {
  try {
    const [
      todayStats, series, topFabrics, rfqCounts, userTotal, userNew, activeSessions, providers,
      memStats, dbCacheStats,
    ] = await Promise.all([
      logsRepo.todayStats(),
      logsRepo.dailySeries(14),
      logsRepo.topFabrics(6),
      rfqRepo.counts(),
      userRepo.users.count(),
      userRepo.users.newCounts(),
      userRepo.sessions.countActive(),
      providerManager.getProviders(),
      Promise.resolve(memCache.stats()),
      resultCache.stats(),
    ]);

    const yesterday = series.length >= 2 ? series[series.length - 2] : null;
    const providerHealth = providers.map(p => ({
      provider_name: p.provider_name, model_name: p.model_name, priority: p.priority,
      is_enabled: p.is_enabled, is_healthy: p.is_healthy, requests_today: p.requests_today,
    }));
    const activeProviders = providers.filter(p => p.is_enabled && p.is_healthy).length;

    // Plain, disclosed heuristics — not a fabricated "AI insight". Each rule is
    // named so the threshold it fired on is visible in the response, not hidden
    // client-side logic that could silently diverge from what is displayed.
    const alerts = [];
    for (const p of providers) {
      if (p.is_enabled && !p.is_healthy) {
        alerts.push({ level: 'warn', text: p.provider_name + ' is enabled but unhealthy — check its key/quota.', tab: 'tab-providers' });
      }
    }
    if (rfqCounts.pending > 0) {
      alerts.push({
        level: rfqCounts.pending >= 5 ? 'warn' : 'info',
        text: rfqCounts.pending + (rfqCounts.pending === 1 ? ' RFQ is' : ' RFQs are') + ' awaiting review.',
        tab: 'tab-rfq',
      });
    }
    if (todayStats.today_total >= 20 && todayStats.cache_hit_pct < 50) {
      alerts.push({
        level: 'info',
        text: 'Cache hit rate is ' + todayStats.cache_hit_pct + '% today (usually higher) — a price sync or deploy may have just invalidated it.',
        tab: 'tab-cache',
      });
    }

    res.json({
      today: todayStats,
      yesterday_total: yesterday ? Number(yesterday.total_queries) : null,
      series: series.map(r => ({ date: r.stat_date, total: Number(r.total_queries), cache_hits: Number(r.cache_hits) })),
      top_fabrics: topFabrics.map(r => ({ fabric: r.fabric, count: Number(r.query_count), avg_gsm: r.avg_gsm ? Number(r.avg_gsm) : null })),
      rfq: { counts: rfqCounts, total: Object.values(rfqCounts).reduce((a, b) => a + b, 0) },
      users: { total: userTotal, new_today: userNew.today, new_7d: userNew.last_7d, active_sessions: activeSessions },
      providers: { active: activeProviders, total: providers.length, health: providerHealth },
      cache: { mem_size: memStats.size, db_entries: Number(dbCacheStats.entries) || 0 },
      alerts,
    });
  } catch (err) {
    console.error('[Overview Error]', err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

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
// RFQ (Request For Quotation) — admin-side management. Buyer-facing submit
// and status lookup live in routes/rfq.js; this is the review/quote side.
// ============================================================
router.get('/api/rfq', adminAuth, async (req, res) => {
  try {
    const [list, statusCounts] = await Promise.all([
      rfqRepo.list({
        page: parseInt(req.query.page, 10) || 1,
        limit: parseInt(req.query.limit, 10) || 25,
        status: req.query.status || undefined,
        search: req.query.search || undefined,
      }),
      rfqRepo.counts(),
    ]);
    res.json({ ...list, status_counts: statusCounts });
  } catch (err) {
    console.error('[RFQ Admin List Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// Customer accounts (the calculator sign-ups). Read-only except for disabling.
router.get('/api/users', adminAuth, async (req, res) => {
  try {
    res.json(await userRepo.users.listForAdmin({
      page: req.query.page, limit: req.query.limit, search: req.query.search || undefined,
    }));
  } catch (err) {
    console.error('[Users Admin List Error]', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

router.get('/api/users/:id', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    const user = await userRepo.users.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const [stats, recent, activeSessions] = await Promise.all([
      userRepo.calculations.stats(id),
      userRepo.calculations.list(id, { page: 1, limit: 8 }),
      userRepo.sessions.countForUser(id),
    ]);
    res.json({
      id: user.id, email: user.email, full_name: user.full_name, company: user.company,
      plan_interest: user.plan_interest, disabled: user.disabled, email_verified: user.email_verified,
      created_at: user.created_at, last_login_at: user.last_login_at,
      stats, recent_calculations: recent.rows, active_sessions: activeSessions,
    });
  } catch (err) {
    console.error('[User Detail Error]', err);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

// Admin-set email and password. Both are trusted-operator actions with no
// "prove you know the current one" step (that is what /api/users/:id being
// behind adminAuth already is) — unlike the customer's own self-service
// change in routes/account.js, which does require the current password.
router.patch('/api/users/:id/email', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const v = validateEmailOnly(req.body);
    if (!Number.isInteger(id) || !v.ok) {
      return res.status(400).json({ error: (v.errors && v.errors[0]) || 'A user id and a valid email are required' });
    }
    const before = await userRepo.users.findById(id);
    if (!before) return res.status(404).json({ error: 'User not found' });

    const { row, conflict } = await userRepo.users.setEmail(id, v.value.email);
    if (conflict) return res.status(409).json({ error: 'Another account already uses that email address.' });
    if (!row) return res.status(404).json({ error: 'User not found' });

    // The account just lost its verified status (setEmail always does that) —
    // send the new owner-to-be their activation code immediately so admin
    // does not have to separately remember to trigger it.
    issueAndSend(row.id, 'activation', { to: row.email, fullName: row.full_name }).catch(() => {});
    if (before.email !== row.email) {
      const notice = emailChangedNoticeEmail({ fullName: row.full_name, newEmail: row.email });
      mailClient.sendMail({ to: before.email, subject: notice.subject, html: notice.html }).catch(() => {});
    }
    res.json({ ok: true, id: row.id, email: row.email });
  } catch (err) {
    console.error('[Users Admin Email Error]', err);
    res.status(500).json({ error: 'Failed to update the email address' });
  }
});

router.post('/api/users/:id/reset-password', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    const user = await userRepo.users.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const problem = passwordProblem(req.body && req.body.new_password, user.email.toLowerCase());
    if (problem) return res.status(400).json({ error: problem });

    await userRepo.users.updatePassword(id, hashPassword(req.body.new_password));
    // Same reasoning as a self-service change or a code-based reset: a
    // password change ends every existing session, admin-initiated or not.
    await userRepo.sessions.removeAllForUser(id);
    const notice = passwordChangedByAdminEmail({ fullName: user.full_name });
    mailClient.sendMail({ to: user.email, subject: notice.subject, html: notice.html }).catch(() => {});
    res.json({ ok: true, id });
  } catch (err) {
    console.error('[Users Admin Reset Password Error]', err);
    res.status(500).json({ error: 'Failed to reset the password' });
  }
});

router.patch('/api/users/:id/disabled', adminAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || typeof (req.body || {}).disabled !== 'boolean') {
      return res.status(400).json({ error: 'A user id and a boolean "disabled" are required' });
    }
    const row = await userRepo.users.setDisabled(id, req.body.disabled);
    if (!row) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, id: row.id, disabled: row.disabled });
  } catch (err) {
    console.error('[Users Admin Disable Error]', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.get('/api/rfq/:id', adminAuth, async (req, res) => {
  try {
    const rfq = await rfqRepo.getById(parseInt(req.params.id, 10));
    if (!rfq) return res.status(404).json({ error: 'RFQ not found' });
    res.json(rfq);
  } catch (err) {
    console.error('[RFQ Admin Detail Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/rfq/:id/status', adminAuth, async (req, res) => {
  try {
    const { status, admin_notes } = req.body || {};
    if (!isValidStatus(status)) return res.status(400).json({ error: `Invalid status. Valid: ${VALID_STATUSES.join(', ')}` });
    const updated = await rfqRepo.updateStatus(parseInt(req.params.id, 10), status, admin_notes);
    if (!updated) return res.status(404).json({ error: 'RFQ not found' });
    res.json({ ok: true, rfq: updated });
  } catch (err) {
    console.error('[RFQ Admin Status Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/rfq/line-items/:lineId', adminAuth, async (req, res) => {
  try {
    const { quoted_price_usd, quoted_notes } = req.body || {};
    if (quoted_price_usd != null && (!Number.isFinite(parseFloat(quoted_price_usd)) || parseFloat(quoted_price_usd) < 0)) {
      return res.status(400).json({ error: 'quoted_price_usd must be zero or a positive number.' });
    }
    const updated = await rfqRepo.updateLineItemQuote(parseInt(req.params.lineId, 10), {
      quotedPriceUsd: quoted_price_usd != null ? parseFloat(quoted_price_usd) : null,
      quotedNotes: quoted_notes,
    });
    if (!updated) return res.status(404).json({ error: 'Line item not found' });
    res.json({ ok: true, line_item: updated });
  } catch (err) {
    console.error('[RFQ Admin Line Item Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Settings — read/update admin credentials
// ============================================================

// ============================================================
// YARN PRICES — the live market list
// ============================================================
//
// The costing engine used to run entirely on a matrix typed into a source file
// and headed "Updated May 2026". By September it was 3% high on cotton and 5-7%
// high on CVC and PC, and nothing in the system could report that, because a
// typed constant has no date. These two endpoints are the whole of the manual
// control: one to see the state, one to refresh it now.

router.get('/api/yarn-prices', adminAuth, async (req, res) => {
  try {
    const yarnPrices = require('../db/repositories/yarn-price-repo');
    const { REFRESH_DAYS } = require('../jobs/yarn-price-sync');
    const { getPriceFromMatrix } = require('../engine/domain/costing-engine');

    // The last few attempts, successful or not. A sync that fails quietly is
    // the dangerous case: the old quotes stay in place and go on looking
    // current, so "when did it last RUN" and "when did it last WORK" are shown
    // as separate columns rather than one green tick.
    const syncs = await dbQuery(
      `SELECT id, started_at, finished_at, ok, trigger, rows_seen, rows_stored,
              rows_rejected, newest_quote, error, sources
         FROM yarn_price_syncs ORDER BY started_at DESC LIMIT 10`);

    // Per source, as it stands right now — not as it stood on the last run.
    // "The run worked" and "every source worked" are different answers, and a
    // dashboard that cannot tell them apart will show a green tick over a
    // source that has been failing for a month.
    const perSource = await dbQuery(
      `SELECT source, country, count(*) AS quotes, max(quoted_on) AS newest,
              max(fetched_at) AS last_seen
         FROM yarn_price_quotes
        GROUP BY source, country
        ORDER BY source, country`);

    // Sources the code knows about, whether or not they have ever returned a
    // row. A source that has never been connected must appear as "not
    // connected" rather than being absent, or nobody will remember it exists.
    const et = require('../jobs/price-sources/emergingtextiles');
    const known = [
      { source: 'texbazar', label: 'TexBazar (Bangladesh daily list)',
        configured: true, kind: 'public page' },
      { source: et.SOURCE, label: 'EmergingTextiles (multi-country API)',
        configured: et.isConfigured(), kind: 'subscription API',
        note: et.isConfigured() ? null
          : 'no API key configured — set ET_API_KEY and ET_ENDPOINTS to connect' },
    ];

    const quotes = await dbQuery(
      `SELECT DISTINCT ON (market, item_key, count_ne)
              market, item_key, count_ne, raw_label, price, currency, unit,
              price_usd_kg, quoted_on
         FROM yarn_price_quotes
        ORDER BY market, item_key, count_ne, quoted_on DESC`);

    res.json({
      status: yarnPrices.status(),
      refresh_days: REFRESH_DAYS,
      sources: known.map(k => ({
        ...k,
        countries: perSource.filter(r => r.source === k.source)
          .map(r => ({ country: r.country, quotes: Number(r.quotes),
                       newest: String(r.newest).slice(0, 10),
                       last_seen: r.last_seen })),
        quotes: perSource.filter(r => r.source === k.source)
          .reduce((a, r) => a + Number(r.quotes), 0),
      })),
      quoted_countries: yarnPrices.quotedCountries(),
      // Each quote beside what the built-in list would have said. This column
      // is the point of the screen: the drift is invisible until the two
      // numbers are next to each other, and it was 3-7% before anyone looked.
      quotes: quotes.filter(q => q.market === yarnPrices.COSTING_MARKET).map(q => {
        const ne = Number(q.count_ne);
        const ref = getPriceFromMatrix(q.item_key, ne);
        const usd = Number(q.price_usd_kg);
        return {
          item_key: q.item_key,
          count_ne: ne,
          label: q.raw_label,
          as_published: `${q.currency === 'USD' ? '$' : '৳'}${Number(q.price)} / ${q.unit}`,
          usd_per_kg: usd,
          reference_price: ref,
          reference_gap_pct: ref ? Math.round(((usd - ref) / ref) * 1000) / 10 : null,
          quoted_on: String(q.quoted_on).slice(0, 10),
        };
      }),
      // The domestic cash list is stored and shown separately, never silently
      // substituted: on the same product the two are twenty-odd per cent apart.
      local_market: quotes.filter(q => q.market === 'local_bdt').map(q => ({
        item_key: q.item_key,
        count_ne: Number(q.count_ne),
        label: q.raw_label,
        as_published: `৳${Number(q.price)} / ${q.unit}`,
        usd_per_kg: Number(q.price_usd_kg),
        quoted_on: String(q.quoted_on).slice(0, 10),
      })),
      syncs,
    });
  } catch (err) {
    console.error('[Yarn Prices Get Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// The button. `force: true` because someone pressing it has a reason, and
// making them wait out the seven-day window is how a feature gets called
// broken. The snapshot the engine reads is reloaded on success — without that
// the new quotes would sit in the database until the next restart, which is
// "stored but not shipped" wearing a different hat.
router.post('/api/yarn-prices/refresh', adminAuth, async (req, res) => {
  try {
    const { syncYarnPrices } = require('../jobs/yarn-price-sync');
    const yarnPrices = require('../db/repositories/yarn-price-repo');
    const result = await syncYarnPrices({ trigger: 'manual', force: true });
    if (result.ok) await yarnPrices.load();
    // A failed gate is not a server error — it is the gate doing its job, and
    // the reasons are the useful part of the reply.
    res.status(result.ok ? 200 : 422).json({ ...result, status: yarnPrices.status() });
  } catch (err) {
    console.error('[Yarn Prices Refresh Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// Dyeing chemical prices — the editable, dated override layer on top of the
// frozen recipe cards (022_dyeing_chemical_prices.sql / dyeing-price-book.js).
// A recipe's own extracted price is used until an admin sets one here; the
// `PATCH` below writes the row and reloads the in-memory snapshot in the same
// request, exactly like the yarn-price refresh above — no restart needed.
router.get('/api/dyeing-prices', adminAuth, async (req, res) => {
  try {
    const rows = await dbQuery(
      `SELECT chemical_name, unit_price_tk, updated_at
         FROM dyeing_chemical_prices
        ORDER BY chemical_name`);

    // Chemicals that exist in real recipe cards but have no row above — every
    // one of these priced at more than one Tk/kg across different recipes
    // (migration 022 deliberately skipped backfilling them; see its header).
    // Surfaced separately so an admin can SEE them and choose to set a
    // unifying price, rather than them being invisible because they simply
    // have no row to list.
    const unresolved = await dbQuery(
      `SELECT commercial_name AS chemical_name,
              array_agg(DISTINCT unit_price_tk ORDER BY unit_price_tk) AS prices_seen
         FROM dyeing_recipe_chemicals
        WHERE commercial_name IS NOT NULL AND unit_price_tk > 0
          AND commercial_name NOT IN (SELECT chemical_name FROM dyeing_chemical_prices)
        GROUP BY commercial_name
        ORDER BY commercial_name`);

    res.json({
      prices: rows.map(r => ({
        chemical_name: r.chemical_name,
        unit_price_tk: Number(r.unit_price_tk),
        updated_at: r.updated_at,
      })),
      unresolved: unresolved.map(r => ({
        chemical_name: r.chemical_name,
        prices_seen: r.prices_seen.map(Number),
      })),
    });
  } catch (err) {
    console.error('[Dyeing Prices Get Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/api/dyeing-prices/:name', adminAuth, async (req, res) => {
  try {
    const name = req.params.name;
    const { unit_price_tk } = req.body;
    if (!(unit_price_tk > 0)) {
      return res.status(400).json({ error: 'unit_price_tk must be a positive number' });
    }

    await dbQuery(
      `INSERT INTO dyeing_chemical_prices (chemical_name, unit_price_tk, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (chemical_name) DO UPDATE SET unit_price_tk = $2, updated_at = now()`,
      [name, unit_price_tk]
    );

    const dyeingPriceBook = require('../engine/domain/dyeing-price-book');
    await dyeingPriceBook.reload();
    res.json({ ok: true, status: dyeingPriceBook.status() });
  } catch (err) {
    console.error('[Dyeing Price Update Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// REAL-ORDER VALIDATION — closing the loop the engine never had
//
// Admin-entered real mill order outcomes (spec + what was actually used/
// produced), scored live against the CURRENT engine on every read — never
// against a prediction frozen at entry time. See engine/domain/
// validation-scoring.js for why, and 024_real_order_validation.sql for the
// table this reads from.
// ============================================================

router.get('/api/validation/records', adminAuth, async (req, res) => {
  try {
    const { rows, total, page, pages } = await validationRepo.list({
      page: parseInt(req.query.page, 10) || 1,
      limit: parseInt(req.query.limit, 10) || 20,
      fabric: req.query.fabric || null,
    });
    res.json({ records: rows.map(scoreRecord), total, page, pages });
  } catch (err) {
    console.error('[Validation List Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/validation/records', adminAuth, async (req, res) => {
  try {
    const { spec_input, actual_count_ne, actual_sl_mm, actual_gsm, mill_name, order_ref, notes } = req.body || {};

    if (!spec_input || typeof spec_input !== 'object' || !spec_input.fabric || !spec_input.gsm) {
      return res.status(400).json({ error: 'spec_input with at least fabric and gsm is required' });
    }
    if (actual_count_ne == null && actual_sl_mm == null && actual_gsm == null) {
      return res.status(400).json({ error: 'At least one of actual_count_ne, actual_sl_mm, actual_gsm is required' });
    }

    // Reject a spec that does not calculate at all (typo'd fabric id, missing
    // required field) at entry time — storing it would only surface the
    // problem later as a silent calc_error in every list/summary read.
    const testResult = calculate(spec_input);
    if (testResult.error) {
      return res.status(400).json({ error: `spec_input does not calculate: ${testResult.error}` });
    }

    const row = await validationRepo.add({
      fabric_id: spec_input.fabric,
      spec_input,
      actual_count_ne, actual_sl_mm, actual_gsm,
      mill_name, order_ref, notes,
    });
    res.json({ ok: true, record: scoreRecord(row) });
  } catch (err) {
    console.error('[Validation Add Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/validation/records/:id', adminAuth, async (req, res) => {
  try {
    await validationRepo.remove(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (err) {
    console.error('[Validation Delete Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/validation/summary', adminAuth, async (req, res) => {
  try {
    const rows = await validationRepo.all();
    res.json(summarize(rows.map(scoreRecord)));
  } catch (err) {
    console.error('[Validation Summary Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/settings', adminAuth, async (req, res) => {
  try {
    const rows = await dbQuery('SELECT username FROM admin_users LIMIT 1');
    const username = rows[0]?.username || 'knitadvisor';
    res.json({
      username,
      yarn_prices_note: 'Costing uses the market list where it has a quote and the reference '
        + 'matrix in backend/engine/domain/costing-engine.js where it does not. See '
        + 'GET /admin/api/yarn-prices for what is loaded and POST /admin/api/yarn-prices/refresh '
        + 'to pull the list now.',
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
