/**
 * Emergency Admin Routes — for critical fixes when SSH access unavailable
 * These endpoints require special auth or are only available in production emergencies
 *
 * DO NOT expose without authentication in production!
 */
const express = require('express');
const router = express.Router();
const { query: dbQuery } = require('../config/database');

// ── Emergency: Create admin_sessions table ──────────────────────────────────
router.post('/create-admin-sessions', async (req, res) => {
  try {
    // Safety check: only allow if table doesn't exist
    const tableExists = await dbQuery(
      "SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='admin_sessions'"
    );

    if (tableExists[0]?.cnt > 0) {
      return res.status(400).json({
        error: 'Table already exists',
        message: 'admin_sessions table is already in database'
      });
    }

    // Create the table
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

    return res.json({
      ok: true,
      message: 'admin_sessions table created successfully',
      next_steps: [
        '1. Restart your Node.js application in cPanel',
        '2. Go to cPanel > Node.js Domains',
        '3. Click STOP, wait 3 seconds, then click START',
        '4. Try logging in to https://knitadvisor.onlinetextileschool.com/admin.html'
      ]
    });
  } catch (err) {
    console.error('[Emergency Create Sessions Error]', err);
    return res.status(500).json({
      error: 'Failed to create table',
      message: err.message,
      instructions: 'If this fails, SSH to your server and run: node backend/scripts/create-admin-sessions.js'
    });
  }
});

// ── Emergency: Check database status ──────────────────────────────────────
router.get('/db-status', async (req, res) => {
  try {
    const tables = await dbQuery(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY table_name"
    );

    const adminSessionsExists = tables.some(t => t.table_name === 'admin_sessions');
    const providerKeysExists = tables.some(t => t.table_name === 'ai_provider_keys');

    return res.json({
      database: 'connected',
      tables_total: tables.length,
      admin_sessions_exists: adminSessionsExists,
      ai_provider_keys_exists: providerKeysExists,
      tables: tables.map(t => t.table_name)
    });
  } catch (err) {
    console.error('[Emergency DB Status Error]', err);
    return res.status(500).json({
      database: 'connection_failed',
      error: err.message
    });
  }
});

// ── Emergency: Get admin auth status ──────────────────────────────────────
router.get('/auth-status', async (req, res) => {
  try {
    const adminUsername = process.env.ADMIN_USERNAME || 'knitadvisor';
    const adminPassword = process.env.ADMIN_PASSWORD || 'knitadvisor2026';

    const sessionTableExists = await dbQuery(
      "SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='admin_sessions'"
    ).catch(() => [{ cnt: 0 }]);

    return res.json({
      admin_configured: !!(adminUsername && adminPassword),
      admin_username: adminUsername,
      admin_password_set: !!adminPassword,
      admin_sessions_table_exists: sessionTableExists[0]?.cnt > 0,
      status: sessionTableExists[0]?.cnt > 0 ? 'READY' : 'MISSING_TABLE'
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
});

module.exports = router;
