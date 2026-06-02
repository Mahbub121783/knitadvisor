/**
 * Admin Session Token Authentication
 * Dual-mode: DB sessions (primary) + signed in-memory fallback (if DB unavailable)
 * Token = crypto.randomBytes(32).toString('hex') stored as SHA256 hash in DB
 * Passed via X-Admin-Token header
 */
const crypto = require('crypto');
const { query: dbQuery } = require('../config/database');

// ── In-memory fallback session store ────────────────────────────────────────
// Used when DB is unavailable. Keyed by tokenHash → { expires, created }
const memSessions = new Map();

// Sign a tokenHash with the admin password so we can verify it without DB
function signToken(tokenHash) {
  const secret = process.env.ADMIN_PASSWORD || 'knitadvisor2026';
  return crypto.createHmac('sha256', secret).update(tokenHash).digest('hex');
}

function buildMemToken(rawToken) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const sig = signToken(tokenHash);
  // format: hash.sig (both hex, no special chars)
  return `${tokenHash}.${sig}`;
}

function verifyMemToken(token) {
  try {
    const dot = token.lastIndexOf('.');
    if (dot < 0) return null;
    const tokenHash = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expectedSig = signToken(tokenHash);
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) return null;
    return tokenHash;
  } catch {
    return null;
  }
}

// ── Ensure admin_sessions table exists (auto-repair) ─────────────────────────
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
    // Ensure is_active column exists (handles tables created without it)
    await dbQuery(`
      ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS is_active TINYINT DEFAULT 1
    `).catch(() => {
      // MySQL 5.x doesn't support ADD COLUMN IF NOT EXISTS — ignore error, column may already exist
    });
    tableChecked = true;
  } catch (err) {
    console.warn('[AdminAuth] Could not ensure sessions table:', err.message);
  }
}

// ── adminAuth middleware ──────────────────────────────────────────────────────
async function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: no token' });
  }

  // 1) Try DB session validation first
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    // Use OR to handle tables that may not have is_active column yet
    const rows = await dbQuery(
      'SELECT id FROM admin_sessions WHERE token_hash = ? AND expires_at > NOW()',
      [tokenHash]
    );
    if (rows.length > 0) {
      req.adminId = rows[0].id;
      return next();
    }
  } catch (dbErr) {
    console.warn('[AdminAuth] DB check failed, trying mem fallback:', dbErr.message);
  }

  // 2) Fallback: verify signed in-memory token
  const tokenHash = verifyMemToken(token);
  if (tokenHash) {
    const session = memSessions.get(tokenHash);
    if (session && session.expires > Date.now()) {
      req.adminId = 'mem-' + tokenHash.slice(0, 8);
      return next();
    }
  }

  return res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
}

// ── generateToken ─────────────────────────────────────────────────────────────
async function generateToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
}

// ── createSession ─────────────────────────────────────────────────────────────
// Returns { mode: 'db' | 'mem', expiresAt }
// If DB fails, stores in memSessions and returns a signed composite token
async function createSession(tokenHash, ipAddress) {
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours

  // Try to auto-repair table then insert
  try {
    await ensureSessionsTable();
    await dbQuery(
      'INSERT INTO admin_sessions (token_hash, ip_address, expires_at) VALUES (?, ?, ?)',
      [tokenHash, ipAddress, expiresAt]
    );
    return { mode: 'db', expiresAt };
  } catch (dbErr) {
    console.warn('[AdminAuth] DB session store failed, using mem fallback:', dbErr.message);
    // Store in memory with TTL
    memSessions.set(tokenHash, { expires: expiresAt.getTime(), ip: ipAddress, created: Date.now() });
    return { mode: 'mem', expiresAt };
  }
}

// ── deleteSession ─────────────────────────────────────────────────────────────
async function deleteSession(tokenHash) {
  // Try DB first
  try {
    await dbQuery('DELETE FROM admin_sessions WHERE token_hash = ?', [tokenHash]);
  } catch {
    // ignore
  }
  // Also remove from mem
  memSessions.delete(tokenHash);
}

// ── Periodic cleanup of expired mem sessions ──────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memSessions.entries()) {
    if (v.expires < now) memSessions.delete(k);
  }
}, 15 * 60 * 1000);

module.exports = {
  adminAuth,
  generateToken,
  createSession,
  deleteSession,
  buildMemToken,
  ensureSessionsTable,
  getMemSessionCount: () => memSessions.size,
};
