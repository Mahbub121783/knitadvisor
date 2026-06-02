/**
 * Emergency Admin Routes — diagnostics + fixes when SSH unavailable
 * All endpoints are intentionally unauthenticated for emergency recovery.
 * Sensitive data (passwords) are never returned.
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { query: dbQuery, testConnection } = require('../config/database');

// ── Helper: ensure admin_sessions table ──────────────────────────────────────
async function ensureSessionsTable() {
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      token_hash  VARCHAR(64) NOT NULL UNIQUE,
      ip_address  VARCHAR(45) DEFAULT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at  TIMESTAMP DEFAULT NULL,
      is_active   TINYINT DEFAULT 1,
      INDEX idx_token_hash (token_hash),
      INDEX idx_expires_at (expires_at)
    ) ENGINE=InnoDB
  `);
}

// ── POST /emergency/create-admin-sessions ─────────────────────────────────────
router.post('/create-admin-sessions', async (req, res) => {
  try {
    await ensureSessionsTable();
    return res.json({
      ok: true,
      message: 'admin_sessions table ready (created or already existed)',
      next_steps: [
        'Restart Node.js app in cPanel: Stop → wait 3s → Start',
        'Then try login at /admin.html'
      ]
    });
  } catch (err) {
    console.error('[Emergency Create Sessions Error]', err);
    return res.status(500).json({ error: 'Failed to create table', message: err.message });
  }
});

// ── GET /emergency/db-status ──────────────────────────────────────────────────
router.get('/db-status', async (req, res) => {
  const connected = await testConnection();

  if (!connected) {
    return res.status(500).json({
      database: 'connection_failed',
      db_host: process.env.DB_HOST || 'localhost',
      db_user: process.env.DB_USER || '(not set)',
      db_name: process.env.DB_NAME || '(not set)',
      db_port: process.env.DB_PORT || '3306',
      hint: 'Check DB_HOST, DB_USER, DB_PASS, DB_NAME in .env on the server'
    });
  }

  try {
    const tables = await dbQuery(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY table_name"
    );
    const names = tables.map(t => t.table_name);

    return res.json({
      database: 'connected',
      db_host: process.env.DB_HOST || 'localhost',
      db_name: process.env.DB_NAME || '(not set)',
      tables_total: names.length,
      admin_sessions_exists: names.includes('admin_sessions'),
      ai_provider_stats_exists: names.includes('ai_provider_stats'),
      tables: names
    });
  } catch (err) {
    return res.status(500).json({ database: 'query_failed', error: err.message });
  }
});

// ── GET /emergency/auth-status ────────────────────────────────────────────────
router.get('/auth-status', async (req, res) => {
  const dbConnected = await testConnection();

  let sessionTableExists = false;
  let sessionCount = 0;
  let adminUsersCount = 0;

  if (dbConnected) {
    try {
      const res1 = await dbQuery(
        "SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='admin_sessions'"
      );
      sessionTableExists = (res1[0]?.cnt || 0) > 0;

      if (sessionTableExists) {
        const res2 = await dbQuery('SELECT COUNT(*) as cnt FROM admin_sessions WHERE expires_at > NOW()');
        sessionCount = res2[0]?.cnt || 0;
      }

      const res3 = await dbQuery("SELECT COUNT(*) as cnt FROM admin_users");
      adminUsersCount = res3[0]?.cnt || 0;
    } catch { /* ignore */ }
  }

  const status = !dbConnected ? 'DB_DOWN' : !sessionTableExists ? 'MISSING_TABLE' : 'READY';

  return res.json({
    status,
    db_connected: dbConnected,
    admin_users_in_db: adminUsersCount,
    admin_sessions_table_exists: sessionTableExists,
    active_sessions: sessionCount,
    fix_needed: status !== 'READY',
    fix_url: status === 'MISSING_TABLE'
      ? 'POST /emergency/create-admin-sessions'
      : status === 'DB_DOWN'
      ? 'Check DB credentials in server .env'
      : null
  });
});

// ── POST /emergency/fix-all ────────────────────────────────────────────────────
// Runs all auto-repair steps in sequence
router.post('/fix-all', async (req, res) => {
  const results = {};

  // Hot-reload environment variables in memory first
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      require('dotenv').config({ path: envPath, override: true });
    }
    const dbConfig = require('../config/database');
    if (dbConfig.resetPool) {
      dbConfig.resetPool();
    }
    results.hot_reload = 'success';
  } catch (reloadErr) {
    results.hot_reload = 'FAILED: ' + reloadErr.message;
  }

  // Step 1: DB connection
  results.db_connected = await testConnection();

  if (!results.db_connected) {
    return res.status(500).json({
      ok: false,
      results,
      message: 'Database connection failed — cannot run auto-repair. Check DB credentials in .env on the server.'
    });
  }

  // Step 2: Create admin_sessions
  try {
    await ensureSessionsTable();
    results.admin_sessions_table = 'ready';
  } catch (err) {
    results.admin_sessions_table = 'FAILED: ' + err.message;
  }

  // Step 3: Verify admin users exist in DB
  try {
    const adminRows = await dbQuery('SELECT COUNT(*) as cnt FROM admin_users');
    results.admin_users_in_db = adminRows[0]?.cnt || 0;
  } catch (err) {
    results.admin_users_in_db = 0;
  }

  // Try to touch tmp/restart.txt to trigger Passenger restart
  let touchedRestart = false;
  try {
    const fs = require('fs');
    const path = require('path');
    const tmpDir = path.join(__dirname, '..', '..', 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    fs.writeFileSync(path.join(tmpDir, 'restart.txt'), String(Date.now()), 'utf8');
    touchedRestart = true;
  } catch (touchErr) {
    // ignore
  }
  results.passenger_restart_triggered = touchedRestart;

  const allOk = results.db_connected && results.admin_sessions_table === 'ready';

  return res.json({
    ok: allOk,
    results,
    message: allOk
      ? 'All repairs complete! Hot-reloaded and triggered server restart.'
      : 'Some repairs failed. Check results above.',
    next_step: 'Passenger restart triggered via tmp/restart.txt'
  });
});

// ── POST /emergency/test-login ────────────────────────────────────────────────
// Simulates a login without storing session — tests credentials + DB write
router.post('/test-login', async (req, res) => {
  const { username, password } = req.body || {};
  
  let credentialsOk = false;
  try {
    const passHash = crypto.createHash('sha256').update(password || '').digest('hex');
    const adminRows = await dbQuery(
      'SELECT id FROM admin_users WHERE username = ? AND password_hash = ?',
      [username, passHash]
    );
    credentialsOk = adminRows.length > 0;
  } catch (err) {
    console.error('[Emergency Test Login Error]', err.message);
  }

  let dbWriteOk = false;
  let dbWriteError = null;
  let tableExists = false;

  try {
    await ensureSessionsTable();
    tableExists = true;

    // Try a dry-run insert + immediate delete
    const testHash = 'emergency_test_' + crypto.randomBytes(8).toString('hex');
    const expires = new Date(Date.now() + 60000);
    await dbQuery(
      'INSERT INTO admin_sessions (token_hash, ip_address, expires_at) VALUES (?, ?, ?)',
      [testHash, '127.0.0.1', expires]
    );
    await dbQuery('DELETE FROM admin_sessions WHERE token_hash = ?', [testHash]);
    dbWriteOk = true;
  } catch (err) {
    dbWriteError = err.message;
  }

  return res.json({
    credentials_ok: credentialsOk,
    db_write_ok: dbWriteOk,
    db_write_error: dbWriteError,
    admin_sessions_table_exists: tableExists,
    login_would_succeed: credentialsOk && dbWriteOk,
    verdict: credentialsOk && dbWriteOk
      ? '✓ LOGIN WILL WORK after app restart'
      : !credentialsOk
      ? '✗ Wrong username or password'
      : '✗ DB write failing — ' + dbWriteError
  });
});

// ── GET /emergency/env-check ─────────────────────────────────────────────────
// Shows non-sensitive env config (no passwords exposed)
router.get('/env-check', async (req, res) => {
  return res.json({
    DB_HOST: process.env.DB_HOST || '(not set)',
    DB_USER: process.env.DB_USER || '(not set)',
    DB_PASS: process.env.DB_PASS ? '(set, length=' + process.env.DB_PASS.length + ')' : '(NOT SET)',
    DB_NAME: process.env.DB_NAME || '(not set)',
    DB_PORT: process.env.DB_PORT || '3306 (default)',
    PORT: process.env.PORT || '3001 (default)',
    NODE_ENV: process.env.NODE_ENV || '(not set)',
    node_version: process.version,
    uptime_seconds: Math.floor(process.uptime()),
  });
});

// ── POST /emergency/write-env ─────────────────────────────────────────────────
// Writes/updates .env with provided DB config
// SECURITY: Only accepts a known setup token to prevent abuse
router.post('/write-env', async (req, res) => {
  const { setup_token, db_host, db_user, db_pass, db_name, db_port } = req.body || {};

  // Setup token = password_hash from the first admin, or fallback to hash of 'knitadvisor2026'
  let expectedToken;
  try {
    const adminRows = await dbQuery('SELECT password_hash FROM admin_users LIMIT 1');
    expectedToken = adminRows[0]?.password_hash || crypto.createHash('sha256').update('knitadvisor2026').digest('hex');
  } catch (err) {
    expectedToken = crypto.createHash('sha256').update('knitadvisor2026').digest('hex');
  }

  if (setup_token !== expectedToken) {
    return res.status(403).json({ error: 'Invalid setup_token' });
  }

  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '..', '.env');

    let content = '';
    try { content = fs.readFileSync(envPath, 'utf8'); } catch { content = ''; }

    function setEnvVar(content, key, value) {
      if (!value) return content;
      const line = `${key}=${value}`;
      if (new RegExp(`^${key}=`, 'm').test(content)) {
        return content.replace(new RegExp(`^${key}=.*`, 'm'), line);
      }
      return content + `\n${line}`;
    }

    if (db_host) content = setEnvVar(content, 'DB_HOST', db_host);
    if (db_user) content = setEnvVar(content, 'DB_USER', db_user);
    if (db_pass) content = setEnvVar(content, 'DB_PASS', db_pass);
    if (db_name) content = setEnvVar(content, 'DB_NAME', db_name);
    if (db_port) content = setEnvVar(content, 'DB_PORT', db_port);

    fs.writeFileSync(envPath, content, 'utf8');

    // Hot-reload environment variables in memory
    try {
      require('dotenv').config({ path: envPath, override: true });
      const dbConfig = require('../config/database');
      if (dbConfig.resetPool) {
        dbConfig.resetPool();
      }
      // Re-initialize tables
      await dbConfig.initAdminDatabase();
      console.log('[Emergency] Environment hot-reloaded and database pool reset');
    } catch (reloadErr) {
      console.warn('[Emergency] Environment reload failed:', reloadErr.message);
    }

    // Try to touch tmp/restart.txt to trigger Passenger restart
    let touchedRestart = false;
    try {
      const tmpDir = path.join(__dirname, '..', '..', 'tmp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      fs.writeFileSync(path.join(tmpDir, 'restart.txt'), String(Date.now()), 'utf8');
      touchedRestart = true;
      console.log('[Emergency] Touched tmp/restart.txt for Passenger restart');
    } catch (touchErr) {
      console.warn('[Emergency] Could not touch tmp/restart.txt:', touchErr.message);
    }

    return res.json({
      ok: true,
      message: '.env updated. Hot-reloaded and triggered server restart.',
      passenger_restart_triggered: touchedRestart,
      updated_keys: [
        db_host && 'DB_HOST', db_user && 'DB_USER', db_pass && 'DB_PASS',
        db_name && 'DB_NAME', db_port && 'DB_PORT'
      ].filter(Boolean)
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to write .env', message: err.message });
  }
});

module.exports = router;
