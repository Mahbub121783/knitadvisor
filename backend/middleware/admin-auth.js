/**
 * Admin Session Token Authentication
 * Token = crypto.randomBytes(32).toString('hex') stored as SHA256 hash
 * Passed via X-Admin-Token header, validated against admin_sessions table
 */
const crypto = require('crypto');
const { query: dbQuery } = require('../config/database');

async function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: no token' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const rows = await dbQuery(
      'SELECT id FROM admin_sessions WHERE token_hash = ? AND expires_at > NOW()',
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
    }

    req.adminId = rows[0].id;
    next();
  } catch (err) {
    console.error('[Admin Auth Error]', err);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

async function generateToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
}

async function createSession(tokenHash, ipAddress) {
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours
  await dbQuery(
    'INSERT INTO admin_sessions (token_hash, ip_address, expires_at) VALUES (?, ?, ?)',
    [tokenHash, ipAddress, expiresAt]
  );
}

async function deleteSession(tokenHash) {
  await dbQuery(
    'DELETE FROM admin_sessions WHERE token_hash = ?',
    [tokenHash]
  );
}

module.exports = {
  adminAuth,
  generateToken,
  createSession,
  deleteSession,
};
