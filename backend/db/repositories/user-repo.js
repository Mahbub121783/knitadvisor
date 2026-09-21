/**
 * Customer accounts and their sessions (tables from migration 027).
 * Separate from admin-repo.js on purpose — see the migration header.
 */
const { query, queryOne } = require('../client');

const SESSION_DAYS = parseInt(process.env.USER_SESSION_DAYS, 10) || 14;

const users = {
  findByEmail(email) {
    return queryOne(
      'SELECT id, email, full_name, company, password_hash, disabled FROM app_users WHERE lower(email) = lower($1)',
      [email]
    );
  },

  /** Returns the new row, or null when the email is already registered. */
  async create({ email, fullName, company, planInterest, passwordHash }) {
    const rows = await query(
      `INSERT INTO app_users (email, full_name, company, plan_interest, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (lower(email)) DO NOTHING
       RETURNING id, email, full_name, company`,
      [email, fullName, company, planInterest || null, passwordHash]
    );
    return rows[0] || null;
  },

  findById(id) {
    return queryOne(
      'SELECT id, email, full_name, company, plan_interest, password_hash, created_at, last_login_at FROM app_users WHERE id = $1',
      [id]
    );
  },

  async updateProfile(id, { fullName, company }) {
    const rows = await query(
      'UPDATE app_users SET full_name = $2, company = $3 WHERE id = $1 RETURNING id, email, full_name, company',
      [id, fullName, company]
    );
    return rows[0] || null;
  },

  updatePassword(id, passwordHash) {
    return query('UPDATE app_users SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
  },

  touchLogin(id) {
    return query('UPDATE app_users SET last_login_at = now() WHERE id = $1', [id]);
  },

  async count() {
    return Number((await queryOne('SELECT count(*)::int AS count FROM app_users')).count);
  },

  /** Newest first. `search` matches name, email or company (case-insensitive). */
  async listForAdmin({ page = 1, limit = 25, search } = {}) {
    const pageN = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const term = search ? '%' + String(search).replace(/[\\%_]/g, m => '\\' + m) + '%' : null;
    const where = term
      ? "WHERE full_name ILIKE $1 OR email ILIKE $1 OR coalesce(company, '') ILIKE $1"
      : '';
    const params = term ? [term] : [];
    const total = Number((await queryOne('SELECT count(*)::int AS count FROM app_users ' + where, params)).count);
    const rows = await query(
      'SELECT id, email, full_name, company, plan_interest, disabled, created_at, last_login_at ' +
      'FROM app_users ' + where + ' ORDER BY created_at DESC, id DESC ' +
      'LIMIT ' + lim + ' OFFSET ' + ((pageN - 1) * lim),
      params
    );
    return { rows, total, page: pageN, pages: Math.max(1, Math.ceil(total / lim)) };
  },

  /** Disabling also ends every live session, so it takes effect immediately. */
  async setDisabled(id, disabled) {
    const rows = await query('UPDATE app_users SET disabled = $2 WHERE id = $1 RETURNING id, disabled', [id, !!disabled]);
    if (rows[0] && disabled) await query('DELETE FROM app_user_sessions WHERE user_id = $1', [id]);
    return rows[0] || null;
  },
};

const sessions = {
  /** The user behind a valid, unexpired token hash — or null. Disabled accounts never match. */
  findUserByTokenHash(tokenHash) {
    return queryOne(
      `SELECT u.id, u.email, u.full_name, u.company
         FROM app_user_sessions s
         JOIN app_users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT u.disabled`,
      [tokenHash]
    );
  },

  async create(userId, tokenHash) {
    const row = await queryOne(
      `INSERT INTO app_user_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(days => $3))
       RETURNING expires_at`,
      [userId, tokenHash, SESSION_DAYS]
    );
    return { expiresAt: row.expires_at, maxAgeSeconds: SESSION_DAYS * 86400 };
  },

  /** Ends every session for the user except the one making the request. */
  removeOthers(userId, keepTokenHash) {
    return query('DELETE FROM app_user_sessions WHERE user_id = $1 AND token_hash <> $2', [userId, keepTokenHash]);
  },

  remove(tokenHash) {
    return query('DELETE FROM app_user_sessions WHERE token_hash = $1', [tokenHash]);
  },

  purgeExpired() {
    return query('DELETE FROM app_user_sessions WHERE expires_at <= now()');
  },
};

const MAX_HISTORY_PER_USER = 300;

const calculations = {
  /**
   * Records a calculation, or — when the same inputs were run before — moves
   * that row to the top and counts the repeat. Keeps only the newest
   * MAX_HISTORY_PER_USER rows so history cannot grow without bound.
   */
  async record(userId, entry) {
    await query(
      `INSERT INTO user_calculations
         (user_id, params_hash, fabric_id, fabric_name, gsm, composition, params, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
       ON CONFLICT (user_id, params_hash) DO UPDATE
         SET run_count = user_calculations.run_count + 1,
             last_run_at = now(),
             fabric_name = EXCLUDED.fabric_name,
             summary = EXCLUDED.summary`,
      [userId, entry.params_hash, entry.fabric_id, entry.fabric_name, entry.gsm, entry.composition,
        JSON.stringify(entry.params), JSON.stringify(entry.summary)]
    );
    await query(
      `DELETE FROM user_calculations
        WHERE user_id = $1
          AND id NOT IN (SELECT id FROM user_calculations WHERE user_id = $1
                          ORDER BY last_run_at DESC, id DESC LIMIT ${MAX_HISTORY_PER_USER})`,
      [userId]
    );
  },

  async list(userId, { page = 1, limit = 20, search } = {}) {
    const pageN = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const term = search ? '%' + String(search).replace(/[\\%_]/g, m => '\\' + m) + '%' : null;
    const where = term
      ? "WHERE user_id = $1 AND (coalesce(fabric_name, fabric_id) ILIKE $2 OR coalesce(composition, '') ILIKE $2)"
      : 'WHERE user_id = $1';
    const params = term ? [userId, term] : [userId];
    const total = Number((await queryOne('SELECT count(*)::int AS count FROM user_calculations ' + where, params)).count);
    const rows = await query(
      'SELECT id, fabric_id, fabric_name, gsm, composition, params, summary, run_count, created_at, last_run_at ' +
      'FROM user_calculations ' + where + ' ORDER BY last_run_at DESC, id DESC ' +
      'LIMIT ' + lim + ' OFFSET ' + ((pageN - 1) * lim),
      params
    );
    return { rows, total, page: pageN, pages: Math.max(1, Math.ceil(total / lim)) };
  },

  async remove(userId, id) {
    const rows = await query('DELETE FROM user_calculations WHERE user_id = $1 AND id = $2 RETURNING id', [userId, id]);
    return rows.length > 0;
  },

  async clear(userId) {
    const rows = await query('DELETE FROM user_calculations WHERE user_id = $1 RETURNING id', [userId]);
    return rows.length;
  },

  async stats(userId) {
    const totals = await queryOne(
      `SELECT count(*)::int AS distinct_specs,
              coalesce(sum(run_count), 0)::int AS total_runs,
              count(*) FILTER (WHERE last_run_at > now() - interval '30 days')::int AS specs_30d,
              max(last_run_at) AS last_run_at
         FROM user_calculations WHERE user_id = $1`,
      [userId]
    );
    const top = await query(
      `SELECT coalesce(fabric_name, fabric_id) AS fabric, sum(run_count)::int AS runs
         FROM user_calculations WHERE user_id = $1
        GROUP BY 1 ORDER BY runs DESC, fabric LIMIT 3`,
      [userId]
    );
    return { ...totals, top_fabrics: top };
  },
};

module.exports = { users, sessions, calculations, SESSION_DAYS, MAX_HISTORY_PER_USER };
