/**
 * Scheduled maintenance endpoint.
 *
 * Follows the convention already used across this account's other apps:
 *   GET /internal-cron?job=<name>&secret=<INTERNAL_CRON_SECRET>
 * so a single cPanel cron line per job, all hitting one endpoint, matches how
 * api.onlinetextileschool.com is already driven.
 *
 * Why an HTTP endpoint rather than cron running node directly: the app already
 * holds a warm connection pool and the decrypted config, and a cPanel cron
 * shelling into the Passenger virtualenv would need its own environment,
 * its own pool, and would race the running app for the same rows.
 *
 * Everything here was previously either not happening at all (expired cache
 * rows accumulated forever, stderr.log grew unbounded, no backups) or bolted
 * onto a request path (the daily provider-counter reset ran lazily on whichever
 * unlucky visitor was first through the door after midnight).
 */
const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

const { query, queryOne, poolStats } = require('../db/client');
const { resultCache, vizCache } = require('../db/repositories/cache-repo');
const logsRepo = require('../db/repositories/logs-repo');
const adminRepo = require('../db/repositories/admin-repo');
const providerManager = require('../ai/provider-manager-v2');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.env.HOME || '/home/tecnedub', 'backups', 'knitadvisor');
const BACKUP_KEEP_DAYS = parseInt(process.env.BACKUP_KEEP_DAYS, 10) || 14;
const LOG_MAX_BYTES = parseInt(process.env.LOG_MAX_BYTES, 10) || 5 * 1024 * 1024;
const QUERY_LOG_RETENTION_DAYS = parseInt(process.env.QUERY_LOG_RETENTION_DAYS, 10) || 180;

// ── Auth ────────────────────────────────────────────────────────────────────
// Compared with timingSafeEqual: these jobs mutate data and trigger backups, so
// the secret should not be recoverable a byte at a time from response timing.
function authorised(req) {
  const provided = req.query.secret || req.get('x-cron-secret') || '';
  const expected = process.env.INTERNAL_CRON_SECRET || '';
  if (!expected || expected.length < 16) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Jobs ────────────────────────────────────────────────────────────────────
const JOBS = {
  /**
   * Roll the AI provider daily counters over.
   * provider-manager also does this lazily, but lazily means the first visitor
   * after midnight pays for it and a quiet night leaves counters stale.
   */
  async 'reset-daily-stats'() {
    await providerManager.ensureDailyReset();
    const rows = await query('SELECT provider_name, requests_today, tokens_today FROM ai_provider_stats ORDER BY priority');
    return { providers: rows };
  },

  /**
   * Pull the published yarn price list.
   *
   * The costing engine ran for four months on a typed matrix that had drifted
   * 3-7% without anything being able to say so, because a number in a source
   * file carries no date. This is what stops that recurring.
   *
   * It no-ops inside its own seven-day window, so the cron line can be run
   * daily without hammering someone else's site — the schedule lives in the
   * job rather than in the crontab, where it can be reasoned about.
   *
   * A successful sync reloads the snapshot the engine reads. Without that the
   * new quotes would sit in PostgreSQL until the next restart, which is the
   * same "stored but not shipped" failure in a different costume.
   */
  async 'sync-yarn-prices'() {
    const { syncYarnPrices } = require('../jobs/yarn-price-sync');
    const yarnPrices = require('../db/repositories/yarn-price-repo');
    const result = await syncYarnPrices({ trigger: 'schedule' });
    if (result.ok && !result.skipped) await yarnPrices.load();
    return result;
  },

  /** Delete expired cache rows and dead sessions. */
  async 'prune-cache'() {
    const [results, viz, sessions] = await Promise.all([
      resultCache.prune(),
      vizCache.prune(),
      adminRepo.sessions.prune(),
    ]);
    return { result_cache_deleted: results, viz_cache_deleted: viz, sessions_deleted: sessions };
  },

  /** Drop query logs past the retention window. */
  async 'prune-logs'() {
    const deleted = await logsRepo.prune(QUERY_LOG_RETENTION_DAYS);
    return { deleted, retention_days: QUERY_LOG_RETENTION_DAYS };
  },

  /** Rebuild the dashboard rollups. */
  async 'refresh-analytics'() {
    const started = Date.now();
    await logsRepo.refreshAnalytics();
    return { refreshed_ms: Date.now() - started };
  },

  /**
   * Reclaim space and refresh planner statistics.
   * The cache tables churn heavily — every expired row is dead tuples that
   * autovacuum on a busy shared host may not get to promptly.
   */
  async 'vacuum-analyze'() {
    const tables = ['result_cache', 'viz_render_cache', 'query_logs', 'admin_sessions'];
    const done = [];
    for (const t of tables) {
      // Table names are from this fixed list, never from the request.
      await query(`VACUUM (ANALYZE) ${t}`);
      done.push(t);
    }
    return { vacuumed: done };
  },

  /** pg_dump to ~/backups/knitadvisor, oldest removed past the keep window. */
  async 'db-backup'() {
    fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(BACKUP_DIR, `knitadvisor-${stamp}.dump`);

    await new Promise((resolve, reject) => {
      execFile(
        'pg_dump',
        ['--format=custom', '--no-owner', '--no-acl', '--file', file,
         '--host', process.env.PGHOST, '--port', String(process.env.PGPORT || 5432),
         '--username', process.env.PGUSER, process.env.PGDATABASE],
        // Password via the environment, never on the command line — argv is
        // readable by every process on a shared host.
        { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD }, timeout: 120000 },
        (err, _stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve()
      );
    });

    fs.chmodSync(file, 0o600);
    const size = fs.statSync(file).size;

    const cutoff = Date.now() - BACKUP_KEEP_DAYS * 86400_000;
    let removed = 0;
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      if (!f.startsWith('knitadvisor-') || !f.endsWith('.dump')) continue;
      const full = path.join(BACKUP_DIR, f);
      if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); removed++; }
    }
    return { file: path.basename(file), bytes: size, old_backups_removed: removed, keep_days: BACKUP_KEEP_DAYS };
  },

  /**
   * Truncate stderr.log once it passes the size cap.
   * Passenger appends to it forever; nothing rotates it. The tail is kept so a
   * recent crash is still diagnosable after a trim.
   */
  async 'rotate-logs'() {
    const logPath = path.join(__dirname, '..', 'stderr.log');
    if (!fs.existsSync(logPath)) return { rotated: false, reason: 'no stderr.log' };
    const before = fs.statSync(logPath).size;
    if (before < LOG_MAX_BYTES) return { rotated: false, bytes: before, limit: LOG_MAX_BYTES };

    const keep = Buffer.alloc(Math.min(before, 256 * 1024));
    const fd = fs.openSync(logPath, 'r');
    fs.readSync(fd, keep, 0, keep.length, Math.max(0, before - keep.length));
    fs.closeSync(fd);
    fs.writeFileSync(logPath, `--- log truncated ${new Date().toISOString()} (was ${before} bytes) ---\n` + keep.toString('utf8'));
    return { rotated: true, bytes_before: before, bytes_after: fs.statSync(logPath).size };
  },

  /**
   * Close connections this app left idle in a transaction.
   * Mirrors the kill-idle-connections job already running for the OTS API. A
   * shared Postgres has a global connection ceiling, so one app leaking idle
   * backends degrades every other app on the account.
   */
  async 'kill-idle-connections'() {
    const rows = await query(
      `SELECT pg_terminate_backend(pid) AS terminated, pid
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND state IN ('idle in transaction', 'idle in transaction (aborted)')
         AND state_change < now() - interval '5 minutes'`
    );
    return { terminated: rows.length, pool: poolStats() };
  },
};

// ── Routing ─────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  if (!authorised(req)) {
    // Deliberately vague and identical for a bad secret and a missing one.
    return res.status(403).json({ error: 'Forbidden' });
  }

  const name = String(req.query.job || '');
  const job = Object.prototype.hasOwnProperty.call(JOBS, name) ? JOBS[name] : null;
  if (!job) {
    return res.status(400).json({ error: 'Unknown job', available: Object.keys(JOBS) });
  }

  const started = Date.now();
  try {
    const result = await job();
    const ms = Date.now() - started;
    console.log(`[Cron] ${name} ok in ${ms}ms —`, JSON.stringify(result));
    res.json({ ok: true, job: name, duration_ms: ms, ...result });
  } catch (err) {
    console.error(`[Cron] ${name} FAILED:`, err.message);
    res.status(500).json({ ok: false, job: name, error: err.message });
  }
});

module.exports = router;
module.exports.JOB_NAMES = Object.keys(JOBS);
