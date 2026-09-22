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
 *
 * Every route is behind requireUser and only ever reads or writes rows keyed to
 * req.user.id — there is no user id in any URL or body to tamper with.
 */
const express = require('express');
const router = express.Router();

const userRepo = require('../db/repositories/user-repo');
const { requireUser } = require('../middleware/user-auth');
const { hashPassword, verifyPassword } = require('../middleware/password');
const { createRateLimiter } = require('../middleware/rate-limiter');
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

module.exports = router;
