/**
 * Admin session token authentication.
 *
 * Token = crypto.randomBytes(32).toString('hex'), stored as a SHA-256 hash and
 * presented in the X-Admin-Token header. Hashing the token at rest means a
 * database read does not hand out live sessions.
 *
 * The CREATE TABLE IF NOT EXISTS that used to run on every request path is
 * gone — the table is owned by db/migrations/001_initial_schema.sql, and
 * db/seed.js refuses to start against a schema that has not been migrated.
 */
const crypto = require('crypto');
const adminRepo = require('../db/repositories/admin-repo');

async function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: no token' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    // Expiry is enforced in SQL, so a caller that forgets to check cannot
    // accidentally accept a stale session.
    const session = await adminRepo.sessions.findValid(tokenHash);
    if (session) {
      req.sessionId = session.id;
      return next();
    }
  } catch (dbErr) {
    console.error('[AdminAuth] Session validation failed:', dbErr.message);
    return res.status(500).json({ error: 'Internal database authentication error' });
  }

  return res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
}

function generateToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
}

function createSession(tokenHash, ipAddress) {
  return adminRepo.sessions.create(tokenHash, ipAddress);
}

async function deleteSession(tokenHash) {
  try {
    await adminRepo.sessions.remove(tokenHash);
  } catch (err) {
    console.error('[AdminAuth] Failed to delete session:', err.message);
  }
}

module.exports = { adminAuth, generateToken, createSession, deleteSession };
