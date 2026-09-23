/**
 * Signed-in customer's own data — /api/account/*
 *
 *   GET    /summary             totals, most-used fabrics, username + when it can change next
 *   GET    /calculations        their calculation history (paged, searchable)
 *   DELETE /calculations/:id    remove one
 *   DELETE /calculations        clear all
 *   PATCH  /profile             name and company
 *   POST   /username            change username (self-service, 60-day cooldown)
 *   POST   /password            change password (ends their other sessions)
 *   GET    /universities        allow-listed universities, for the student-plan picker
 *   GET    /student/status      this account's student verification state
 *   POST   /student/apply       start a verification (a listed university + email, or "Other")
 *   POST   /student/verify-code confirm the code mailed to the university email
 *   POST   /student/document    upload the ID card / admission document
 *
 * Every route is behind requireUser and only ever reads or writes rows keyed to
 * req.user.id — there is no user id in any URL or body to tamper with.
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');

const userRepo = require('../db/repositories/user-repo');
const universityRepo = require('../db/repositories/university-repo');
const studentRepo = require('../db/repositories/student-repo');
const usageRepo = require('../db/repositories/usage-repo');
const { requireUser } = require('../middleware/user-auth');
const { hashPassword, verifyPassword } = require('../middleware/password');
const { createRateLimiter } = require('../middleware/rate-limiter');
const { studentDocUpload, relativePath, absolutePath } = require('../middleware/upload');
const { issueAndSend } = require('../services/account-codes');
const { issueCode, checkCode } = require('../engine/domain/otp');
const {
  matchUniversityDomain, resolveOutcome, resolvePlanLimits, STUDENT_DURATION_DAYS,
} = require('../engine/domain/student-eligibility');
const {
  studentApprovedEmail, studentPendingReviewEmail,
} = require('../mail/templates');
const mailClient = require('../mail/client');
const {
  validateProfile, validatePasswordChange, validateUsernameChange, USERNAME_CHANGE_COOLDOWN_DAYS,
} = require('../engine/domain/auth-validation');

const passwordLimiter = createRateLimiter({
  name: 'account-password',
  max: 6,
  windowMs: 15 * 60 * 1000,
  message: 'Too many password attempts. Try again in a few minutes.',
});
const usernameLimiter = createRateLimiter({
  name: 'account-username',
  max: 6,
  windowMs: 15 * 60 * 1000,
  message: 'Too many attempts. Try again in a few minutes.',
});
const studentApplyLimiter = createRateLimiter({
  name: 'account-student-apply',
  max: 8,
  windowMs: 15 * 60 * 1000,
  message: 'Too many attempts. Try again in a few minutes.',
});
const studentCodeLimiter = createRateLimiter({
  name: 'account-student-code',
  max: 10,
  windowMs: 15 * 60 * 1000,
  message: 'Too many attempts. Try again in a few minutes.',
});
const studentDocLimiter = createRateLimiter({
  name: 'account-student-doc',
  max: 8,
  windowMs: 15 * 60 * 1000,
  message: 'Too many uploads. Try again in a few minutes.',
});

router.use(requireUser);

function fail(res, label, err, message) {
  console.error(`[Account] ${label} failed:`, err.message);
  res.status(500).json({ success: false, error: message });
}

router.get('/summary', async (req, res) => {
  try {
    const [stats, row] = await Promise.all([
      userRepo.calculations.stats(req.user.id),
      userRepo.users.findById(req.user.id),
    ]);
    const nextUsernameChangeAt = row && row.username_changed_at
      ? new Date(new Date(row.username_changed_at).getTime() + USERNAME_CHANGE_COOLDOWN_DAYS * 86400000)
      : null;
    res.json({
      success: true,
      stats,
      member_since: row ? row.created_at : null,
      plan_interest: row ? row.plan_interest : null,
      username: row ? row.username : null,
      username_changeable_at: nextUsernameChangeAt && nextUsernameChangeAt.getTime() > Date.now()
        ? nextUsernameChangeAt.toISOString() : null,
    });
  } catch (err) { fail(res, 'summary', err, 'Could not load your summary.'); }
});

router.get('/calculations', async (req, res) => {
  try {
    const list = await userRepo.calculations.list(req.user.id, {
      page: req.query.page, limit: req.query.limit,
      search: String(req.query.search || '').trim().slice(0, 80) || undefined,
    });
    res.json({ success: true, ...list });
  } catch (err) { fail(res, 'list', err, 'Could not load your calculations.'); }
});

router.delete('/calculations/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Invalid id.' });
  try {
    const removed = await userRepo.calculations.remove(req.user.id, id);
    if (!removed) return res.status(404).json({ success: false, error: 'Calculation not found.' });
    res.json({ success: true });
  } catch (err) { fail(res, 'delete', err, 'Could not delete that calculation.'); }
});

router.delete('/calculations', async (req, res) => {
  try {
    const removed = await userRepo.calculations.clear(req.user.id);
    res.json({ success: true, removed });
  } catch (err) { fail(res, 'clear', err, 'Could not clear your history.'); }
});

router.patch('/profile', async (req, res) => {
  const v = validateProfile(req.body);
  if (!v.ok) return res.status(400).json({ success: false, error: v.errors[0] });
  try {
    const user = await userRepo.users.updateProfile(req.user.id, { fullName: v.value.full_name, company: v.value.company });
    res.json({ success: true, user });
  } catch (err) { fail(res, 'profile', err, 'Could not save your details.'); }
});

router.post('/username', usernameLimiter, async (req, res) => {
  const v = validateUsernameChange(req.body);
  if (!v.ok) return res.status(400).json({ success: false, error: v.errors[0] });
  try {
    const row = await userRepo.users.findById(req.user.id);
    if (!row) return res.status(404).json({ success: false, error: 'Account not found.' });

    if (row.username_changed_at) {
      const elapsedDays = (Date.now() - new Date(row.username_changed_at).getTime()) / 86400000;
      if (elapsedDays < USERNAME_CHANGE_COOLDOWN_DAYS) {
        const waitDays = Math.ceil(USERNAME_CHANGE_COOLDOWN_DAYS - elapsedDays);
        return res.status(429).json({
          success: false,
          error: `You can change your username again in ${waitDays} day${waitDays === 1 ? '' : 's'}.`,
        });
      }
    }

    if (v.value.username.toLowerCase() === row.username.toLowerCase()) {
      return res.status(400).json({ success: false, error: 'That is already your username.' });
    }

    const { row: updated, conflict } = await userRepo.users.setUsername(req.user.id, v.value.username);
    if (conflict) return res.status(409).json({ success: false, error: 'That username is already taken.' });
    res.json({ success: true, username: updated.username });
  } catch (err) { fail(res, 'username', err, 'Could not change your username.'); }
});

router.post('/password', passwordLimiter, async (req, res) => {
  const row = await userRepo.users.findById(req.user.id).catch(() => null);
  const v = validatePasswordChange(req.body, row && row.email.toLowerCase());
  if (!v.ok) return res.status(400).json({ success: false, error: v.errors[0] });
  try {
    if (!row || !verifyPassword(v.value.current_password, row.password_hash)) {
      return res.status(403).json({ success: false, error: 'Your current password is incorrect.' });
    }
    await userRepo.users.updatePassword(req.user.id, hashPassword(v.value.new_password));
    // A password change is usually a reaction to a worry; leaving other devices
    // signed in would defeat it. This session stays so the person is not bounced.
    await userRepo.sessions.removeOthers(req.user.id, req.sessionTokenHash);
    res.json({ success: true });
  } catch (err) { fail(res, 'password', err, 'Could not change your password.'); }
});

// ── Student plan ─────────────────────────────────────────────────────────

/**
 * Checks whether a verification now qualifies for the automatic path and, if
 * so, activates it — shared by the document-upload and verify-code routes
 * since either one can be the step that completes the set (the flow does
 * not force a strict order between "confirm the code" and "upload the
 * document").
 * @returns {Promise<boolean>} whether it was just auto-approved
 */
async function tryAutoApprove(verification, user) {
  const outcome = resolveOutcome({
    universityMatched: !!verification.university_id,
    emailVerified: !!verification.student_email_verified_at,
    hasDocument: !!verification.document_path,
  });
  if (outcome !== 'active') return false;
  const expiresAt = new Date(Date.now() + STUDENT_DURATION_DAYS * 86400000);
  await studentRepo.decide(verification.id, 'active', { decidedBy: 'auto', expiresAt });
  await userRepo.users.setStudentStatus(user.id, 'active', expiresAt);
  const { subject, html } = studentApprovedEmail({ fullName: user.full_name, expiresAt });
  mailClient.sendMail({ to: user.email, subject, html }).catch(() => {});
  return true;
}

router.get('/universities', async (req, res) => {
  try {
    res.json({ success: true, universities: await universityRepo.listActive() });
  } catch (err) { fail(res, 'universities', err, 'Could not load the university list.'); }
});

router.get('/student/status', async (req, res) => {
  try {
    const [verification, usedToday, row] = await Promise.all([
      studentRepo.latestForUser(req.user.id),
      usageRepo.todayCount(req.user.id),
      userRepo.users.findById(req.user.id),
    ]);
    const { plan, dailyLimit } = resolvePlanLimits(row);
    res.json({
      success: true,
      plan, daily_limit: dailyLimit, used_today: usedToday,
      verification: verification ? {
        id: verification.id,
        status: verification.status,
        university_name: verification.university_name,
        student_email: verification.student_email,
        email_verified: !!verification.student_email_verified_at,
        has_document: !!verification.document_path,
        reason: verification.reason,
        expires_at: verification.expires_at,
        created_at: verification.created_at,
      } : null,
    });
  } catch (err) { fail(res, 'student status', err, 'Could not load your student status.'); }
});

router.post('/student/apply', studentApplyLimiter, async (req, res) => {
  try {
    // Reachable from the "I'm a student" link on index.html — either inline
    // during signup, or later from a live session on the landing page — but
    // only ever once per account, signed in or not. A rejected/revoked/
    // expired attempt is not a green light to just try again; an admin
    // reopening it is the only way back in from there.
    const current = await studentRepo.latestForUser(req.user.id);
    if (current) {
      const msg = current.status === 'active' ? 'Your student plan is already active.'
        : current.status === 'pending' ? 'You already have an application awaiting review.'
        : 'You’ve already applied for the student plan once. Contact us if you’d like it reconsidered.';
      return res.status(409).json({ success: false, error: msg });
    }

    const universityId = req.body && req.body.university_id != null ? parseInt(req.body.university_id, 10) : null;

    if (universityId) {
      const uni = await universityRepo.findById(universityId);
      if (!uni || !uni.active) return res.status(400).json({ success: false, error: 'Please choose a university from the list.' });
      const studentEmail = String((req.body && req.body.student_email) || '').trim().toLowerCase();
      if (!studentEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studentEmail)) {
        return res.status(400).json({ success: false, error: 'Enter a valid university email address.' });
      }
      const matched = matchUniversityDomain(studentEmail, [uni]);
      if (!matched) {
        return res.status(400).json({ success: false, error: `That email doesn't match ${uni.name}'s registered domain (@${uni.domain}).` });
      }
      const row = await studentRepo.create({
        userId: req.user.id, universityId: uni.id, universityName: uni.name, studentEmail,
      });
      await issueAndSend(req.user.id, 'student_email', { to: studentEmail, fullName: req.user.full_name });
      return res.json({ success: true, verification_id: row.id, needs_code: true, needs_document: true });
    }

    // "Other" — no domain to check, so no automatic path: document upload alone, reviewed by an admin.
    const otherName = String((req.body && req.body.university_name_other) || '').trim().slice(0, 160);
    if (otherName.length < 2) return res.status(400).json({ success: false, error: 'Enter your university’s name.' });
    const row = await studentRepo.create({ userId: req.user.id, universityId: null, universityName: otherName, studentEmail: null });
    res.json({ success: true, verification_id: row.id, needs_code: false, needs_document: true });
  } catch (err) { fail(res, 'student apply', err, 'Could not start your student application.'); }
});

router.post('/student/verify-code', studentCodeLimiter, async (req, res) => {
  try {
    const verification = await studentRepo.latestForUser(req.user.id);
    if (!verification || !verification.student_email || verification.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'No pending university email to verify.' });
    }
    if (verification.student_email_verified_at) {
      return res.json({ success: true, already_verified: true });
    }
    const codeRow = await userRepo.codes.latest(req.user.id, 'student_email');
    const result = checkCode(String((req.body && req.body.code) || ''), codeRow);
    if (!result.ok) {
      if (codeRow && result.reason === 'mismatch') await userRepo.codes.incrementAttempts(codeRow.id);
      const messages = {
        not_found: 'Request a new code first.',
        consumed: 'That code was already used. Request a new one.',
        expired: 'That code expired. Request a new one.',
        too_many_attempts: 'Too many wrong attempts. Request a new code.',
        mismatch: 'That code is incorrect.',
      };
      return res.status(400).json({ success: false, error: messages[result.reason] || 'That code is incorrect.' });
    }
    await userRepo.codes.consume(codeRow.id);
    await studentRepo.markEmailVerified(verification.id);

    // A document uploaded before the code was verified (order isn't enforced)
    // means every condition is now met — approve here rather than leaving it
    // stuck at "pending" until some other action happens to re-check it.
    if (verification.document_path) {
      const approved = await tryAutoApprove({ ...verification, student_email_verified_at: new Date() }, req.user);
      if (approved) return res.json({ success: true, needs_document: false, status: 'active' });
    }
    res.json({ success: true, needs_document: !verification.document_path });
  } catch (err) { fail(res, 'student verify-code', err, 'Could not verify that code.'); }
});

router.post('/student/document', studentDocLimiter, (req, res) => {
  studentDocUpload(req, res, async (uploadErr) => {
    if (uploadErr) {
      const msg = uploadErr.code === 'LIMIT_FILE_SIZE' ? 'That file is too large (8MB max).' : 'Upload a JPG, PNG or PDF.';
      return res.status(400).json({ success: false, error: msg });
    }
    if (!req.file) return res.status(400).json({ success: false, error: 'Attach your ID card or admission document.' });

    try {
      const verification = await studentRepo.latestForUser(req.user.id);
      if (!verification || verification.status !== 'pending') {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ success: false, error: 'Start an application first.' });
      }

      // Replace, not accumulate — an old upload for this same attempt is dead weight.
      if (verification.document_path) {
        fs.unlink(absolutePath(verification.document_path), () => {});
      }
      await studentRepo.setDocument(verification.id, relativePath(req));

      const approved = await tryAutoApprove({ ...verification, document_path: relativePath(req) }, req.user);
      if (approved) {
        const fresh = await studentRepo.findById(verification.id);
        return res.json({ success: true, status: 'active', expires_at: fresh.expires_at });
      }

      const { subject, html } = studentPendingReviewEmail({ fullName: req.user.full_name });
      mailClient.sendMail({ to: req.user.email, subject, html }).catch(() => {});
      res.json({ success: true, status: 'pending' });
    } catch (err) { fail(res, 'student document', err, 'Could not save your document.'); }
  });
});

module.exports = router;
