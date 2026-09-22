/**
 * Student verification attempts (migration 031) — one row per attempt, kept
 * as the audit trail even after a decision. app_users.student_status /
 * student_expires_at is a cache of the newest row here; callers update both
 * together (see routes/account.js and routes/admin.js) rather than this
 * module reaching into app_users itself, matching how user-repo.js's
 * setUsername/setEmail stay one layer away from the codes table.
 */
const { query, queryOne } = require('../client');

function findById(id) {
  return queryOne('SELECT * FROM app_student_verifications WHERE id = $1', [id]);
}

/** Newest attempt for this user, whatever its status — null if they never started one. */
function latestForUser(userId) {
  return queryOne(
    'SELECT * FROM app_student_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
}

async function create({ userId, universityId, universityName, studentEmail }) {
  const rows = await query(
    `INSERT INTO app_student_verifications (user_id, university_id, university_name, student_email)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, universityId || null, universityName, studentEmail || null]
  );
  return rows[0];
}

function markEmailVerified(id) {
  return query('UPDATE app_student_verifications SET student_email_verified_at = now() WHERE id = $1', [id]);
}

function setDocument(id, documentPath) {
  return query('UPDATE app_student_verifications SET document_path = $2 WHERE id = $1', [id, documentPath]);
}

/**
 * @param {'active'|'pending'|'rejected'|'revoked'|'expired'} status
 * @param {{decidedBy: string, reason?: string, expiresAt?: Date|null}} opts
 */
async function decide(id, status, { decidedBy, reason, expiresAt } = {}) {
  const rows = await query(
    `UPDATE app_student_verifications
        SET status = $2, decided_at = now(), decided_by = $3, reason = $4, expires_at = $5
      WHERE id = $1 RETURNING *`,
    [id, status, decidedBy || null, reason || null, expiresAt || null]
  );
  return rows[0] || null;
}

/** Paged, newest first. `status` filters to one status, or omit for all. */
async function listByStatus(status, { page = 1, limit = 25 } = {}) {
  const pageN = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const where = status ? 'WHERE v.status = $1' : '';
  const params = status ? [status] : [];
  const total = Number(
    (await queryOne(`SELECT count(*)::int AS count FROM app_student_verifications v ${where}`, params)).count
  );
  const rows = await query(
    `SELECT v.*, u.email AS account_email, u.username, u.full_name
       FROM app_student_verifications v JOIN app_users u ON u.id = v.user_id
       ${where}
      ORDER BY v.created_at DESC LIMIT ${lim} OFFSET ${(pageN - 1) * lim}`,
    params
  );
  return { rows, total, page: pageN, pages: Math.max(1, Math.ceil(total / lim)) };
}

/** Cron job hook — flips anything past its expiry, returns which users to also downgrade in app_users. */
async function expireDue() {
  return query(
    `UPDATE app_student_verifications
        SET status = 'expired', decided_at = now(), decided_by = 'auto'
      WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= now()
      RETURNING id, user_id`
  );
}

module.exports = { findById, latestForUser, create, markEmailVerified, setDocument, decide, listByStatus, expireDue };
