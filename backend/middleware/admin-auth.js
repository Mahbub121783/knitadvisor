/**
 * Admin Session Token Authentication
 * 100% Database-driven session store
 * Token = crypto.randomBytes(32).toString('hex') stored as SHA256 hash in DB
 * Passed via X-Admin-Token header
 */
const crypto = require('crypto');
const { query: dbQuery } = require('../config/database');

// Ensure admin_sessions table exists
let tableChecked = false;
async function ensureSessionsTable() {
  if (tableChecked) return;
  try {
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        token_hash  VARCHAR(64) NOT NULL UNIQUE,
        ip_address  VARCHAR(45) DEFAULT NULL,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at  TIMESTAMP DEFAULT NULL,
        is_active   TINYINT DEFAULT 1
      ) ENGINE=InnoDB
    `);
    tableChecked = true;
  } catch (err) {
    console.warn('[AdminAuth] Could not ensure sessions table:', err.message);
  }
}

// adminAuth middleware
async function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: no token' });
  }

  try {
    await ensureSessionsTable();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const rows = await dbQuery(
      'SELECT id FROM admin_sessions WHERE token_hash = ? AND expires_at > NOW() AND is_active = 1',
      [tokenHash]
    );
    if (rows.length > 0) {
      req.adminId = rows[0].id;
      return next();
    }
  } catch (dbErr) {
    console.error('[AdminAuth] Session validation failed:', dbErr.message);
    return res.status(500).json({ error: 'Internal database authentication error' });
  }

  return res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
}

// generateToken
async function generateToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
}

// createSession
async function createSession(tokenHash, ipAddress) {
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours
  await ensureSessionsTable();
  await dbQuery(
    'INSERT INTO admin_sessions (token_hash, ip_address, expires_at) VALUES (?, ?, ?)',
    [tokenHash, ipAddress, expiresAt]
  );
  return { expiresAt };
}

// deleteSession
async function deleteSession(tokenHash) {
  try {
    await dbQuery('DELETE FROM admin_sessions WHERE token_hash = ?', [tokenHash]);
  } catch (err) {
    console.error('[AdminAuth] Failed to delete session:', err.message);
  }
}

module.exports = {
  adminAuth,
  generateToken,
  createSession,
  deleteSession,
  ensureSessionsTable
};
