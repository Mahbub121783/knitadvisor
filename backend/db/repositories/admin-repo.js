/**
 * Admin users and sessions.
 *
 * Password hashing lives in middleware/password.js; this module only stores and
 * reads what that produces. Sessions are validated against expires_at in SQL so
 * an expired token can never be accepted by application logic that forgot to
 * check.
 */
const { query, queryOne } = require('../client');

const SESSION_HOURS = parseInt(process.env.ADMIN_SESSION_HOURS, 10) || 8;

const users = {
  findByUsername(username) {
    return queryOne('SELECT id, username, password_hash FROM admin_users WHERE username = $1', [username]);
  },

  first() {
    return queryOne('SELECT id, username, password_hash FROM admin_users ORDER BY id LIMIT 1');
  },

  count: async () => Number((await queryOne('SELECT count(*)::int AS count FROM admin_users')).count),

  updatePassword(id, passwordHash) {
    return query('UPDATE admin_users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
  },

  updateUsername(id, username) {
    return query('UPDATE admin_users SET username = $1 WHERE id = $2', [username, id]);
  },

  create(username, passwordHash) {
    return queryOne(
      'INSERT INTO admin_users (username, password_hash) VALUES ($1, $2) RETURNING id',
      [username, passwordHash]
    );
  },
};

const sessions = {
  /** Returns the session row for a valid, unexpired token hash, else null. */
  findValid(tokenHash) {
    return queryOne(
      'SELECT id, created_at, expires_at FROM admin_sessions WHERE token_hash = $1 AND expires_at > now()',
      [tokenHash]
    );
  },

  async create(tokenHash, ipAddress) {
    // ip_address is inet; a malformed value would abort the insert and with it
    // the login, so anything unparseable is stored as NULL instead.
    const ip = isInet(ipAddress) ? ipAddress : null;
    const row = await queryOne(
      `INSERT INTO admin_sessions (token_hash, ip_address, expires_at)
       VALUES ($1, $2, now() + make_interval(hours => $3))
       RETURNING expires_at`,
      [tokenHash, ip, SESSION_HOURS]
    );
    return { expiresAt: row.expires_at };
  },

  remove(tokenHash) {
    return query('DELETE FROM admin_sessions WHERE token_hash = $1', [tokenHash]);
  },

  removeAll() {
    return query('DELETE FROM admin_sessions');
  },

  count: async () => Number((await queryOne('SELECT count(*)::int AS count FROM admin_sessions WHERE expires_at > now()')).count),

  /** Removes expired sessions. Called by cron. */
  async prune() {
    const rows = await query('DELETE FROM admin_sessions WHERE expires_at <= now() RETURNING id');
    return rows.length;
  },
};

function isInet(value) {
  if (typeof value !== 'string' || !value) return false;
  const v = value.replace(/^::ffff:/, '');
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(v) || /^[0-9a-f:]+$/i.test(value);
}

module.exports = { users, sessions };
