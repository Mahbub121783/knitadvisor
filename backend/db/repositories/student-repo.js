/**
 * Student verification attempts (migrations 031, 039) — one row per attempt,
 * kept as the audit trail even after a decision. app_users.student_status /
 * student_expires_at is a cache of the newest row here; callers update both
 * together (see routes/account.js, routes/admin.js, services/student-docs.js)
 * rather than this module reaching into app_users itself.
 */
const { query, queryOne } = require('../client');

// everything but the document's full text, which only the detail view needs
const LIST_COLS = `v.id, v.user_id, v.university_id, v.university_name, v.student_email, v.student_email_norm,
  v.student_email_verified_at, v.document_path, v.status, v.decided_at, v.decided_by, v.reason, v.expires_at, v.created_at,
  v.student_id, v.department, v.grad_year, v.doc_state, v.doc_checked_at, v.risk_score, v.review_state, v.reviewed_by,
  v.reviewed_at, v.renewal_of, (v.doc_check->>'score')::int AS doc_score, v.doc_check->>'verdict' AS doc_verdict`;

function findById(id) {
  return queryOne('SELECT * FROM app_student_verifications WHERE id = $1', [id]);
}

/** Newest attempt for this user, whatever its status — null if they never started one. */
function latestForUser(userId) {
  return queryOne('SELECT * FROM app_student_verifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [userId]);
}

/** Every attempt by this user, newest first (the account page's history). */
function historyForUser(userId) {
  return query(`SELECT id, university_name, status, decided_by, reason, expires_at, created_at, renewal_of FROM app_student_verifications
                 WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 10`, [userId]);
}

async function create(f) {
  const rows = await query(
    `INSERT INTO app_student_verifications (user_id, university_id, university_name, student_email, student_email_norm,
       student_id, department, grad_year, apply_ip, apply_ua, renewal_of, student_email_verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [f.userId, f.universityId || null, f.universityName, f.studentEmail || null, f.studentEmailNorm || null,
     f.studentId || null, f.department || null, f.gradYear || null, f.ip || null, f.ua ? String(f.ua).slice(0, 300) : null,
     f.renewalOf || null, null]
  );
  return rows[0];
}

function markEmailVerified(id) {
  return query('UPDATE app_student_verifications SET student_email_verified_at = now() WHERE id = $1', [id]);
}

function setDetails(id, d) {
  const sets = [], vals = [id];
  for (const k of ['student_id', 'department', 'grad_year']) {
    if (Object.prototype.hasOwnProperty.call(d, k)) { vals.push(d[k]); sets.push(`${k} = $${vals.length}`); }
  }
  if (!sets.length) return Promise.resolve();
  return query(`UPDATE app_student_verifications SET ${sets.join(', ')} WHERE id = $1`, vals);
}

function changeEmail(id, { universityId, universityName, email, norm }) {
  return query(
    `UPDATE app_student_verifications SET university_id = $2, university_name = $3, student_email = $4, student_email_norm = $5,
            student_email_verified_at = NULL, email_changes = email_changes + 1 WHERE id = $1`,
    [id, universityId, universityName, email, norm]
  );
}

/** A new document: it waits in the reading queue and the last reading is cleared. */
function setDocument(id, documentPath, mime) {
  return query(
    `UPDATE app_student_verifications SET document_path = $2, doc_mime = $3, doc_state = 'queued', doc_check = NULL,
            doc_text = NULL, doc_sha256 = NULL, doc_phash = NULL, doc_checked_at = NULL WHERE id = $1`,
    [id, documentPath, mime || null]
  );
}

function setDocState(id, state) {
  return query('UPDATE app_student_verifications SET doc_state = $2 WHERE id = $1', [id, state]);
}

function saveReading(id, r) {
  return query(
    `UPDATE app_student_verifications SET doc_state = $2, doc_sha256 = $3, doc_phash = $4, doc_text = $5, doc_check = $6,
            doc_checked_at = now() WHERE id = $1`,
    [id, r.state, r.sha256 || null, r.phash || null, r.text ? String(r.text).slice(0, 8000) : null, r.check ? JSON.stringify(r.check) : null]
  );
}

function saveRisk(id, risk, reviewState) {
  return query('UPDATE app_student_verifications SET risk_score = $2, risk = $3, review_state = coalesce($4, review_state) WHERE id = $1',
    [id, risk.score, JSON.stringify(risk), reviewState || null]);
}

/**
 * @param {'active'|'pending'|'rejected'|'revoked'|'expired'|'withdrawn'} status
 * @param {{decidedBy: string, reason?: string, expiresAt?: Date|null, reapplyAfter?: Date|null}} opts
 */
async function decide(id, status, { decidedBy, reason, expiresAt, reapplyAfter } = {}) {
  const rows = await query(
    `UPDATE app_student_verifications
        SET status = $2, decided_at = now(), decided_by = $3, reason = $4, expires_at = $5, reapply_after = $6
      WHERE id = $1 RETURNING *`,
    [id, status, decidedBy || null, reason || null, expiresAt || null, reapplyAfter || null]
  );
  return rows[0] || null;
}

function markReviewed(id, by) {
  return query(`UPDATE app_student_verifications SET review_state = 'reviewed', reviewed_by = $2, reviewed_at = now() WHERE id = $1`, [id, by || 'admin']);
}

function allowReapply(id) {
  return query('UPDATE app_student_verifications SET reapply_after = now() WHERE id = $1', [id]);
}

// ── what the risk check looks at ─────────────────────────────────────
function liveByEmailNorm(norm, exceptId) {
  return queryOne(`SELECT id, user_id FROM app_student_verifications WHERE student_email_norm = $1 AND status IN ('pending','active') AND id <> $2 LIMIT 1`, [norm, exceptId || 0]);
}
function liveByStudentId(universityId, studentId, exceptId) {
  return queryOne(`SELECT id, user_id FROM app_student_verifications WHERE university_id = $1 AND lower(student_id) = lower($2)
                    AND status IN ('pending','active') AND id <> $3 LIMIT 1`, [universityId, studentId, exceptId || 0]);
}
async function signals(row) {
  const [email, sid, sha, net, other] = await Promise.all([
    row.student_email_norm ? queryOne('SELECT count(*)::int AS n FROM app_student_verifications WHERE student_email_norm = $1 AND user_id <> $2', [row.student_email_norm, row.user_id]) : { n: 0 },
    row.student_id ? queryOne('SELECT count(*)::int AS n FROM app_student_verifications WHERE lower(student_id) = lower($1) AND coalesce(university_id, 0) = coalesce($2, 0) AND user_id <> $3', [row.student_id, row.university_id, row.user_id]) : { n: 0 },
    row.doc_sha256 ? queryOne('SELECT count(*)::int AS n FROM app_student_verifications WHERE doc_sha256 = $1 AND user_id <> $2', [row.doc_sha256, row.user_id]) : { n: 0 },
    row.apply_ip ? queryOne(`SELECT count(DISTINCT user_id)::int AS n FROM app_student_verifications WHERE apply_ip = $1 AND created_at > now() - interval '7 days'`, [row.apply_ip]) : { n: 0 },
    row.doc_phash ? query('SELECT doc_phash FROM app_student_verifications WHERE doc_phash IS NOT NULL AND user_id <> $1 ORDER BY created_at DESC LIMIT 3000', [row.user_id]) : [],
  ]);
  return { emailOther: email.n, studentIdOther: sid.n, shaOther: sha.n, sameNetwork: net.n, phashes: other.map((r) => r.doc_phash) };
}

/** Other applications that share something with this one — for the admin's side-by-side. */
function related(row) {
  return query(
    `SELECT v.id, v.user_id, v.status, v.university_name, v.student_email, v.student_id, v.created_at, u.email AS account_email, u.full_name,
            array_remove(ARRAY[
              CASE WHEN v.student_email_norm IS NOT NULL AND v.student_email_norm = $2 THEN 'same university email' END,
              CASE WHEN v.student_id IS NOT NULL AND lower(v.student_id) = lower($3) THEN 'same student ID' END,
              CASE WHEN v.doc_sha256 IS NOT NULL AND v.doc_sha256 = $4 THEN 'same document file' END,
              CASE WHEN v.apply_ip IS NOT NULL AND v.apply_ip = $5 THEN 'same network' END,
              CASE WHEN v.user_id = $6 THEN 'same account, earlier attempt' END], NULL) AS shares
       FROM app_student_verifications v JOIN app_users u ON u.id = v.user_id
      WHERE v.id <> $1 AND (
            (v.student_email_norm IS NOT NULL AND v.student_email_norm = $2)
         OR (v.student_id IS NOT NULL AND lower(v.student_id) = lower($3))
         OR (v.doc_sha256 IS NOT NULL AND v.doc_sha256 = $4)
         OR (v.apply_ip IS NOT NULL AND v.apply_ip = $5 AND v.created_at > now() - interval '30 days')
         OR v.user_id = $6)
      ORDER BY v.created_at DESC LIMIT 20`,
    [row.id, row.student_email_norm || '', row.student_id || '', row.doc_sha256 || '', row.apply_ip || '', row.user_id]
  );
}

/** Paged, newest first. `status` filters to one status; 'review' lists the post-approval queue. */
async function listByStatus(status, { page = 1, limit = 25 } = {}) {
  const pageN = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const where = status === 'review' ? `WHERE v.review_state = 'post_review' AND v.status = 'active'`
    : status ? 'WHERE v.status = $1' : '';
  const params = status && status !== 'review' ? [status] : [];
  const total = Number((await queryOne(`SELECT count(*)::int AS count FROM app_student_verifications v ${where}`, params)).count);
  const rows = await query(
    `SELECT ${LIST_COLS}, u.email AS account_email, u.username, u.full_name
       FROM app_student_verifications v JOIN app_users u ON u.id = v.user_id
       ${where}
      ORDER BY v.created_at DESC LIMIT ${lim} OFFSET ${(pageN - 1) * lim}`,
    params
  );
  return { rows, total, page: pageN, pages: Math.max(1, Math.ceil(total / lim)) };
}

function counts() {
  return queryOne(`SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
                          count(*) FILTER (WHERE status = 'active' AND review_state = 'post_review')::int AS review,
                          count(*) FILTER (WHERE status = 'active')::int AS active
                     FROM app_student_verifications`);
}

/** Documents a restart left half-read. */
function unread() {
  return query(`SELECT id FROM app_student_verifications WHERE doc_state IN ('queued','checking') AND document_path IS NOT NULL AND status = 'pending' ORDER BY id LIMIT 50`);
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

/** Active plans ending within `days` that have not been reminded. */
function dueForReminder(days) {
  return query(
    `SELECT v.id, v.user_id, v.expires_at, v.university_name, u.email, u.full_name FROM app_student_verifications v JOIN app_users u ON u.id = v.user_id
      WHERE v.status = 'active' AND v.reminder_sent_at IS NULL AND v.expires_at IS NOT NULL
        AND v.expires_at > now() AND v.expires_at <= now() + ($1 || ' days')::interval LIMIT 200`, [String(days)]
  );
}
function markReminded(id) { return query('UPDATE app_student_verifications SET reminder_sent_at = now() WHERE id = $1', [id]); }

module.exports = {
  findById, latestForUser, historyForUser, create, markEmailVerified, setDetails, changeEmail, setDocument, setDocState,
  saveReading, saveRisk, decide, markReviewed, allowReapply, liveByEmailNorm, liveByStudentId, signals, related,
  listByStatus, counts, unread, expireDue, dueForReminder, markReminded,
};
