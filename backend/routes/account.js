/**
 * Signed-in customer's own data — /api/account/*
 *
 *   GET    /summary             totals, most-used fabrics, username + when it can change next
 *   GET    /dashboard           the home page in one call: usage, work in progress, market, security
 *   GET    /calculations        their calculation history (paged, searchable)
 *   DELETE /calculations/:id    remove one
 *   DELETE /calculations        clear all
 *   PATCH  /profile             name and company
 *   POST   /username            change username (self-service, 60-day cooldown)
 *   POST   /password            change password (ends their other sessions)
 *   GET    /security            email verified? two-step mode
 *   POST   /verify-email/send   mail an activation code to the account email
 *   POST   /verify-email        {code} — confirm the account email
 *   POST   /two-step/app/start  {password} — a new authenticator secret (off until confirmed)
 *   POST   /two-step/app/confirm {code} — turn on authenticator-app two-step
 *   POST   /two-step/email      {password} — turn on emailed-code two-step (verified email only)
 *   POST   /two-step/off        {password} — back to password-only sign-in
 *   GET    /sessions            signed-in devices; DELETE /sessions/:id signs one out
 *   POST   /sessions/others/end sign every other device out
 *   GET    /activity            the account's recent security events
 *   POST   /email/start         {password, new_email} — code to the new address
 *   POST   /email/confirm       {code} — switch, tell the old inbox, end other devices
 *   POST   /delete              {password, confirm: 'DELETE'} — remove the account
 *   GET    /universities        allow-listed universities, for the student-plan picker
 *   GET    /student/status      this account's student verification state
 *   POST   /student/apply       start a verification (a listed university + email, or "Other")
 *   POST   /student/verify-code confirm the code mailed to the university email
 *   POST   /student/document    upload the ID card / admission document (read on the server, then decided)
 *   POST   /student/resend-code, /student/change-email, /student/details, /student/withdraw, /student/renew
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
const totp = require('../engine/domain/totp');
const security = require('../services/security');
const { clearSessionCookie } = require('../middleware/user-auth');
const {
  matchUniversityDomain, resolveOutcome, resolvePlanLimits, STUDENT_DURATION_DAYS,
} = require('../engine/domain/student-eligibility');
const {
  studentApprovedEmail, studentPendingReviewEmail, emailChangedSelfEmail, accountDeletedEmail,
} = require('../mail/templates');
const mailClient = require('../mail/client');
const {
  validateProfile, validatePasswordChange, validateUsernameChange, validateEmailOnly, USERNAME_CHANGE_COOLDOWN_DAYS,
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

// ── Home dashboard ──────────────────────────────────────────────────────
// Everything the signed-in home page shows, in one round trip: today's usage,
// the latest calculations, cost sheets and studio designs (each costed or
// summarised), the yarn prices the costing uses today, and account health.
// Each block fails on its own: one slow table never blanks the whole page.
const costSheetRepo = require('../db/repositories/cost-sheet-repo');
const studioRepo = require('../db/repositories/studio-repo');
const yarnPriceRepo = require('../db/repositories/yarn-price-repo');
const costing = require('../engine/domain/costing-engine');
const costSheet = require('../engine/domain/cost-sheet');

const MARKET_WATCH = [
  ['combed_regular', 30], ['combed_regular', 24], ['carded_regular', 30], ['cvc_60_40', 30],
  ['pc_65_35', 30], ['viscose_regular', 30], ['filament_150d', 0], ['spandex_40d', 0],
];
const livePrice = (key, ne, country) => yarnPriceRepo.lookup(key, ne, undefined, { country });
const r4 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10000) / 10000);

function sheetCard(row) {
  const sh = row.sheet || {};
  const head = sh.header || {};
  const card = {
    id: row.id, name: row.name, updated_at: row.updated_at, versions: row.versions, has_picture: !!row.has_picture,
    buyer: head.buyer || null, order_no: head.order_no || null,
    sizes: Array.isArray(sh.sizes) ? sh.sizes.slice(0, 12) : [], shells: Array.isArray(sh.shells) ? sh.shells.length : 0,
    quantity: (sh.order || {}).quantity || null, fob: null, margin_pct: null, status: 'incomplete', note: null,
  };
  try {
    const r = costSheet.analyse(sh, { live: livePrice });
    if (!r.success) { card.note = String(r.error || '').slice(0, 140); return card; }
    const fobs = r.per_size.map((p) => p.fob_pc).filter((v) => v > 0);
    card.fob = fobs.length ? { min: r4(Math.min(...fobs)), max: r4(Math.max(...fobs)) } : null;
    const m = r.per_size.map((p) => p.profit_margin_pct).filter((v) => v != null && isFinite(v));
    card.margin_pct = m.length ? Math.round(m.reduce((t, v) => t + v, 0) / m.length * 10) / 10 : null;
    card.warnings = (r.warnings || []).length;
    card.status = 'costed';
  } catch (_) { card.note = 'Could not be costed right now.'; }
  return card;
}

function designCard(row) {
  const d = row.design || {};
  const f = d.fields || {};
  return {
    id: row.id, name: row.name, updated_at: row.updated_at,
    bed: d.bed || (d.D ? 'rib' : 'single'), feeds: Array.isArray(d.C) ? d.C.length : 0,
    needles: Array.isArray(d.C) && Array.isArray(d.C[0]) ? d.C[0].length : 0,
    rolls: Array.isArray(d.rolls) ? d.rolls.length : 0,
    gsm: +f['st-gsm'] || null, count: +f['st-ne'] || null, gauge: +f['st-gauge'] || null, lycra: !!d.lycra,
    // a small corner of the cylinder programme (K / T / M) for the card's thumbnail
    grid: Array.isArray(d.C) ? d.C.slice(0, 8).map((r) => (Array.isArray(r) ? r.slice(0, 16).map((c) => String(c || '-')[0]).join('') : '')) : [],
  };
}

function marketBlock() {
  const st = yarnPriceRepo.status();
  const prices = MARKET_WATCH.map(([key, ne]) => {
    const row = costing.SM_PRICE_MATRIX[key];
    if (!row) return null;
    const r = costing.resolveYarnPrice(key, ne, livePrice, 'BD');
    if (r.price == null) return null;
    const ps = r.price_source || {};
    return { key, label: row.label, count: ne || null, price: r4(r.price),
      kind: String(ps.kind || '').startsWith('market') ? 'market' : 'reference', date: ps.last_updated || null };
  }).filter(Boolean);
  // the feed's state, never its publisher
  return {
    feed: st.available ? { last_updated: st.last_updated, age_days: st.age_days, freshness: st.freshness, items: st.items } : { freshness: 'none' },
    prices,
  };
}

const settle = (p) => Promise.resolve(p).then((v) => v, (e) => { console.error('[Account] dashboard block failed:', e.message); return null; });

router.get('/dashboard', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const uid = req.user.id;
  try {
    const [row, stats, calcs, sheets, designs, used, sessions, events] = await Promise.all([
      userRepo.users.findById(uid),
      settle(userRepo.calculations.stats(uid)),
      settle(userRepo.calculations.list(uid, { page: 1, limit: 6 })),
      settle(costSheetRepo.sheets.list(uid)),
      settle(studioRepo.designs.list(uid)),
      settle(usageRepo.todayCount(uid)),
      settle(userRepo.sessions.list(uid, req.sessionTokenHash)),
      settle(userRepo.events.list(uid, 6)),
    ]);
    const { plan, dailyLimit } = resolvePlanLimits(row);
    const sheetCards = (sheets || []).slice(0, 6).map(sheetCard);
    const designCards = (designs || []).slice(0, 6).map(designCard);
    const calcCards = ((calcs && calcs.rows) || []).map((c) => ({
      id: c.id, fabric_id: c.fabric_id, fabric: c.fabric_name || c.fabric_id, gsm: c.gsm != null ? Number(c.gsm) : null,
      composition: c.composition, runs: c.run_count, at: c.last_run_at, summary: c.summary || {}, params: c.params || null,
    }));
    const money = (v) => '$' + Number(v).toFixed(2);
    const timeline = [
      ...calcCards.map((c) => ({ kind: 'calculation', id: c.id, title: c.fabric, sub: [c.gsm ? c.gsm + ' GSM' : null, c.composition].filter(Boolean).join(' · '), at: c.at })),
      ...sheetCards.map((s) => ({ kind: 'cost_sheet', id: s.id, title: s.name,
        sub: s.fob ? `FOB ${money(s.fob.min)}${s.fob.max !== s.fob.min ? '–' + money(s.fob.max) : ''} · ${s.sizes.length} sizes` : `${s.sizes.length} sizes · not costed yet`, at: s.updated_at })),
      ...designCards.map((d) => ({ kind: 'design', id: d.id, title: d.name,
        sub: `${d.bed === 'rib' ? 'Double bed' : 'Single bed'} · ${d.feeds} feeds${d.rolls ? ` · ${d.rolls} trial rolls` : ''}`, at: d.updated_at })),
    ].filter((t) => t.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 10);

    let market = null;
    try { market = marketBlock(); } catch (e) { console.error('[Account] dashboard market failed:', e.message); }

    res.json({
      success: true,
      user: { full_name: row.full_name, username: row.username, company: row.company, member_since: row.created_at, last_login_at: row.last_login_at,
        student_status: row.student_status || null },
      usage: { plan, daily_limit: dailyLimit, used_today: used == null ? null : Number(used) },
      totals: {
        calculations: stats ? stats.distinct_specs : null, runs: stats ? stats.total_runs : null, specs_30d: stats ? stats.specs_30d : null,
        cost_sheets: sheets ? sheets.length : null, designs: designs ? designs.length : null,
        top_fabrics: stats ? stats.top_fabrics : [],
      },
      calculations: calcCards, cost_sheets: sheetCards, designs: designCards, timeline, market,
      security: {
        email_verified: !!row.email_verified, two_factor: row.two_factor || 'off',
        devices: sessions ? sessions.length : null,
        recent: (events || []).map((e) => ({ kind: e.kind, what: EVENT_LABEL[e.kind] || e.kind, at: e.created_at, device: security.deviceLabel(e.user_agent) })),
      },
    });
  } catch (err) { fail(res, 'dashboard', err, 'Could not load your dashboard.'); }
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
    await security.record(req.user.id, 'password_changed', req);
    res.json({ success: true });
  } catch (err) { fail(res, 'password', err, 'Could not change your password.'); }
});

// ── Security: email verification and two-step sign-in ───────────────────
const securityLimiter = createRateLimiter({
  name: 'account-security', max: 12, windowMs: 15 * 60 * 1000,
  message: 'Too many attempts. Try again in a few minutes.',
});

// changing how the account signs in asks for the password again
async function passwordOk(req) {
  const row = await userRepo.users.findById(req.user.id);
  const pw = typeof (req.body || {}).password === 'string' ? req.body.password : '';
  return row && pw && verifyPassword(pw, row.password_hash) ? row : null;
}

const codeError = (reason) => (reason === 'expired' ? 'This code has expired. Send a new one.'
  : reason === 'too_many_attempts' ? 'Too many wrong attempts. Send a new code.' : 'That code is not right.');

router.get('/security', async (req, res) => {
  try {
    const row = await userRepo.users.findById(req.user.id);
    res.json({ success: true, email: row.email, email_verified: !!row.email_verified, two_factor: row.two_factor || 'off' });
  } catch (err) { fail(res, 'security', err, 'Could not read your security settings.'); }
});

router.post('/verify-email/send', securityLimiter, async (req, res) => {
  try {
    const row = await userRepo.users.findById(req.user.id);
    if (row.email_verified) return res.json({ success: true, already: true });
    await issueAndSend(row.id, 'activation', { to: row.email, fullName: row.full_name });
    res.json({ success: true, message: `A code is on its way to ${row.email}. If it is not in your inbox within a minute, check spam.` });
  } catch (err) { fail(res, 'verify-email/send', err, 'Could not send the code.'); }
});

router.post('/verify-email', securityLimiter, async (req, res) => {
  try {
    const row = await userRepo.users.findById(req.user.id);
    if (row.email_verified) return res.json({ success: true });
    const c = await userRepo.codes.latest(row.id, 'activation');
    const r = checkCode(String((req.body || {}).code || '').trim(), c);
    if (!r.ok) {
      if (r.reason === 'mismatch') await userRepo.codes.incrementAttempts(c.id);
      return res.status(400).json({ success: false, error: codeError(r.reason) });
    }
    await userRepo.codes.consume(c.id);
    await userRepo.users.markEmailVerified(row.id);
    await security.record(row.id, 'email_verified', req);
    res.json({ success: true });
  } catch (err) { fail(res, 'verify-email', err, 'Could not verify your email.'); }
});

router.post('/two-step/app/start', securityLimiter, async (req, res) => {
  try {
    const row = await passwordOk(req);
    if (!row) return res.status(403).json({ success: false, error: 'Your password is incorrect.' });
    const secret = totp.newSecret();
    await userRepo.users.setTotpPending(row.id, totp.seal(secret));
    res.json({ success: true, secret: secret.replace(/(.{4})/g, '$1 ').trim(), otpauth: totp.otpauthUri(secret, row.email) });
  } catch (err) { fail(res, 'two-step/app/start', err, 'Could not start two-step setup.'); }
});

router.post('/two-step/app/confirm', securityLimiter, async (req, res) => {
  try {
    const row = await userRepo.users.findById(req.user.id);
    if (!row.totp_pending) return res.status(400).json({ success: false, error: 'Start the setup again.' });
    const step = totp.verify(totp.open(row.totp_pending), String((req.body || {}).code || '').trim());
    if (step == null) return res.status(400).json({ success: false, error: 'That code is not right. Use the newest code in the app, and make sure the phone sets its time automatically.' });
    await userRepo.users.setTwoFactor(row.id, 'app', row.totp_pending);
    await userRepo.users.setTotpLastStep(row.id, step);
    await security.record(row.id, 'two_step_on', req, 'authenticator app');
    res.json({ success: true, two_factor: 'app' });
  } catch (err) { fail(res, 'two-step/app/confirm', err, 'Could not turn on two-step sign-in.'); }
});

router.post('/two-step/email', securityLimiter, async (req, res) => {
  try {
    const row = await passwordOk(req);
    if (!row) return res.status(403).json({ success: false, error: 'Your password is incorrect.' });
    if (!row.email_verified) return res.status(400).json({ success: false, error: 'Verify your email first — the sign-in codes are sent there.' });
    await userRepo.users.setTwoFactor(row.id, 'email');
    await security.record(row.id, 'two_step_on', req, 'email code');
    res.json({ success: true, two_factor: 'email' });
  } catch (err) { fail(res, 'two-step/email', err, 'Could not turn on two-step sign-in.'); }
});

router.post('/two-step/off', securityLimiter, async (req, res) => {
  try {
    const row = await passwordOk(req);
    if (!row) return res.status(403).json({ success: false, error: 'Your password is incorrect.' });
    await userRepo.users.setTwoFactor(row.id, 'off');
    await security.record(row.id, 'two_step_off', req);
    res.json({ success: true, two_factor: 'off' });
  } catch (err) { fail(res, 'two-step/off', err, 'Could not turn off two-step sign-in.'); }
});

// ── Devices, activity, email change, delete ─────────────────────────────
router.get('/sessions', async (req, res) => {
  try {
    const rows = await userRepo.sessions.list(req.user.id, req.sessionTokenHash);
    res.json({
      success: true,
      sessions: rows.map((r) => ({ id: r.id, device: security.deviceLabel(r.user_agent), ip: r.ip, created_at: r.created_at, last_seen_at: r.last_seen_at, current: r.current })),
    });
  } catch (err) { fail(res, 'sessions', err, 'Could not list your devices.'); }
});

router.delete('/sessions/:id', securityLimiter, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(id > 0)) return res.status(400).json({ success: false, error: 'Unknown device.' });
    const ok = await userRepo.sessions.removeById(req.user.id, id);
    if (ok) await security.record(req.user.id, 'device_signed_out', req);
    res.json({ success: ok });
  } catch (err) { fail(res, 'sessions/delete', err, 'Could not sign that device out.'); }
});

router.post('/sessions/others/end', securityLimiter, async (req, res) => {
  try {
    await userRepo.sessions.removeOthers(req.user.id, req.sessionTokenHash);
    await security.record(req.user.id, 'other_devices_signed_out', req);
    res.json({ success: true });
  } catch (err) { fail(res, 'sessions/others', err, 'Could not sign the other devices out.'); }
});

const EVENT_LABEL = {
  login: 'Signed in', login_failed: 'Wrong password or code', password_changed: 'Password changed',
  password_reset: 'Password reset by email code', two_step_on: 'Two-step sign-in turned on', two_step_off: 'Two-step sign-in turned off',
  email_verified: 'Email verified', email_changed: 'Sign-in email changed', device_signed_out: 'A device was signed out',
  other_devices_signed_out: 'All other devices were signed out',
};
router.get('/activity', async (req, res) => {
  try {
    const rows = await userRepo.events.list(req.user.id, 25);
    res.json({ success: true, events: rows.map((r) => ({ what: EVENT_LABEL[r.kind] || r.kind, kind: r.kind, detail: r.detail, device: security.deviceLabel(r.user_agent), ip: r.ip, at: r.created_at })) });
  } catch (err) { fail(res, 'activity', err, 'Could not read your account activity.'); }
});

router.post('/email/start', securityLimiter, async (req, res) => {
  try {
    const row = await passwordOk(req);
    if (!row) return res.status(403).json({ success: false, error: 'Your password is incorrect.' });
    const v = validateEmailOnly({ email: (req.body || {}).new_email });
    if (!v.ok) return res.status(400).json({ success: false, error: v.errors[0] });
    const email = v.value.email;
    if (email === String(row.email).toLowerCase()) return res.status(400).json({ success: false, error: 'That is already your email.' });
    if (await userRepo.users.findByEmail(email)) return res.status(409).json({ success: false, error: 'Another account already uses that email.' });
    await userRepo.users.setPendingEmail(row.id, email);
    await issueAndSend(row.id, 'email_change', { to: email, fullName: row.full_name });
    res.json({ success: true, message: `We sent a code to ${email}. Enter it to finish — your sign-in email does not change until then.` });
  } catch (err) { fail(res, 'email/start', err, 'Could not start the email change.'); }
});

router.post('/email/confirm', securityLimiter, async (req, res) => {
  try {
    const row = await userRepo.users.findById(req.user.id);
    if (!row.pending_email) return res.status(400).json({ success: false, error: 'Start the email change again.' });
    const c = await userRepo.codes.latest(row.id, 'email_change');
    const r = checkCode(String((req.body || {}).code || '').trim(), c);
    if (!r.ok) {
      if (r.reason === 'mismatch') await userRepo.codes.incrementAttempts(c.id);
      return res.status(400).json({ success: false, error: codeError(r.reason) });
    }
    await userRepo.codes.consume(c.id);
    const oldEmail = row.email;
    const { row: done, conflict } = await userRepo.users.confirmEmailChange(row.id);
    if (conflict || !done) return res.status(409).json({ success: false, error: 'Another account took that email meanwhile.' });
    // whoever changed it, the old inbox is told, and other devices are signed out
    await userRepo.sessions.removeOthers(row.id, req.sessionTokenHash);
    await security.record(row.id, 'email_changed', req, `${oldEmail} → ${done.email}`);
    const n = emailChangedSelfEmail({ fullName: row.full_name, newEmail: done.email });
    mailClient.sendMail({ to: oldEmail, subject: n.subject, html: n.html, text: n.text }).catch(() => {});
    res.json({ success: true, email: done.email });
  } catch (err) { fail(res, 'email/confirm', err, 'Could not change your email.'); }
});

router.post('/delete', securityLimiter, async (req, res) => {
  try {
    const row = await passwordOk(req);
    if (!row) return res.status(403).json({ success: false, error: 'Your password is incorrect.' });
    if ((req.body || {}).confirm !== 'DELETE') return res.status(400).json({ success: false, error: 'Type DELETE to confirm.' });
    await userRepo.users.remove(row.id);
    const n = accountDeletedEmail({ fullName: row.full_name });
    mailClient.sendMail({ to: row.email, subject: n.subject, html: n.html, text: n.text }).catch(() => {});
    clearSessionCookie(req, res);
    res.json({ success: true });
  } catch (err) { fail(res, 'delete', err, 'Could not delete your account.'); }
});

// ── Student plan (verification v2) ───────────────────────────────────────
// The rules live in engine/domain/student-verify.js, the reading and the
// decision in services/student-docs.js. These routes only move the applicant
// through the steps: start → code → details + document → read → decided,
// with resend, change of email, withdraw, re-apply after 30 days and renewal.
const sv = require('../engine/domain/student-verify');
const studentDocs = require('../services/student-docs');

const REAPPLY_DAYS = 30;
const RENEW_WINDOW_DAYS = 45;
const RESEND_COOLDOWN_S = 60;
const RESEND_PER_DAY = 5;
const MAX_EMAIL_CHANGES = 5;
const DOC_WAIT_MS = 25000;

/** What the applicant may do next, from their history. */
function options(history) {
  const latest = history[0] || null;
  const now = Date.now();
  const active = history.find((h) => h.status === 'active');
  const out = { apply: false, apply_after: null, renew: false, withdraw: false, change_email: false };
  if (latest && latest.status === 'pending') {
    out.withdraw = true;
    out.change_email = !latest.renewal_of && !!latest.university_id;
    return out;
  }
  if (active) {
    const left = active.expires_at ? new Date(active.expires_at).getTime() - now : Infinity;
    out.renew = left <= RENEW_WINDOW_DAYS * 86400000 && !!active.student_email && !!active.university_id;
    return out;
  }
  if (!latest || ['expired', 'withdrawn'].includes(latest.status)) {
    out.apply = true;
    out.renew = !!latest && latest.status === 'expired' && !!latest.student_email && !!latest.university_id;
    return out;
  }
  // rejected / revoked: after the waiting period (or when an admin re-opens it)
  const after = latest.reapply_after ? new Date(latest.reapply_after)
    : new Date(new Date(latest.decided_at || latest.created_at).getTime() + REAPPLY_DAYS * 86400000);
  out.apply = after.getTime() <= now;
  out.apply_after = out.apply ? null : after.toISOString();
  return out;
}

/** What the applicant is shown about their document — the findings, never the fraud rules. */
function publicChecks(v) {
  const c = v.doc_check || {};
  const a = c.analysis;
  const read = c.read || {};
  if (!v.document_path) return null;
  if (v.doc_state === 'queued' || v.doc_state === 'checking') return { state: 'checking' };
  if (!a) return { state: v.doc_state, method: read.method || null };
  const yn = (x) => (x == null ? null : x ? 'yes' : 'no');
  return {
    state: v.doc_state, method: a.method, readable: a.readable,
    name: a.name && a.name.score != null ? (a.name.score >= 0.75 ? 'yes' : a.name.score >= 0.5 ? 'partly' : 'no') : null,
    university: a.university ? yn(a.university.score >= 0.6) : null,
    student_id: a.id_match == null ? null : yn(a.id_match),
    valid_until: a.valid_until, expired: a.expired,
    student_document: yn(a.keywords && a.keywords.length > 0),
    qr: a.qr ? yn(a.qr.domain_match) : null,
    notes: a.notes || [],
  };
}

function publicVerification(v) {
  if (!v) return null;
  return {
    id: v.id, status: v.status, university_id: v.university_id, university_name: v.university_name,
    student_email: v.student_email, email_verified: !!v.student_email_verified_at,
    has_document: !!v.document_path, doc_state: v.doc_state, checks: publicChecks(v),
    student_id: v.student_id, department: v.department, grad_year: v.grad_year,
    renewal: !!v.renewal_of, reason: v.reason, expires_at: v.expires_at, created_at: v.created_at,
  };
}

async function liveEmailTaken(norm, exceptId) {
  const other = await studentRepo.liveByEmailNorm(norm, exceptId);
  return !!other;
}
const TAKEN_MSG = 'This university email is already verifying another KnitAdvisor account. Each university inbox can verify one account.';

router.get('/universities', async (req, res) => {
  try {
    res.json({ success: true, universities: await universityRepo.listActive() });
  } catch (err) { fail(res, 'universities', err, 'Could not load the university list.'); }
});

router.get('/student/status', async (req, res) => {
  try {
    const [history, usedToday, row, codes] = await Promise.all([
      studentRepo.historyForUser(req.user.id),
      usageRepo.todayCount(req.user.id),
      userRepo.users.findById(req.user.id),
      userRepo.codes.recentStats(req.user.id, 'student_email', 24),
    ]);
    const latest = history.length ? await studentRepo.findById(history[0].id) : null;
    const full = history.length ? [{ ...history[0], ...latest }, ...history.slice(1)] : [];
    const { plan, dailyLimit } = resolvePlanLimits(row);
    const lastAt = codes && codes.last_at ? new Date(codes.last_at).getTime() : 0;
    res.json({
      success: true,
      plan, daily_limit: dailyLimit, used_today: usedToday,
      verification: publicVerification(latest),
      history: history.slice(0, 6).map((h) => ({ status: h.status, university_name: h.university_name, created_at: h.created_at, expires_at: h.expires_at, renewal: !!h.renewal_of, reason: h.reason })),
      can: {
        ...options(full),
        resend_at: lastAt ? new Date(lastAt + RESEND_COOLDOWN_S * 1000).toISOString() : null,
        resends_left: Math.max(0, RESEND_PER_DAY - ((codes && codes.sent) || 0)),
      },
      ocr: studentDocs.OCR_ON,
    });
  } catch (err) { fail(res, 'student status', err, 'Could not load your student status.'); }
});

router.post('/student/apply', studentApplyLimiter, async (req, res) => {
  try {
    const history = await studentRepo.historyForUser(req.user.id);
    const can = options(history.length ? [{ ...history[0], ...(await studentRepo.findById(history[0].id)) }, ...history.slice(1)] : []);
    if (!can.apply) {
      const latest = history[0];
      const msg = latest && latest.status === 'pending' ? 'You already have an application in progress — continue it, change its email, or withdraw it.'
        : history.some((h) => h.status === 'active') ? (can.renew ? 'Your student plan is active — use Renew to extend it.' : 'Your student plan is already active.')
        : can.apply_after ? `You can apply again from ${new Date(can.apply_after).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`
        : 'You cannot apply right now.';
      return res.status(409).json({ success: false, error: msg, apply_after: can.apply_after });
    }
    let details;
    try { details = sv.cleanDetails(req.body || {}); } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
    const c = security.clientOf(req);
    const universityId = req.body && req.body.university_id != null && req.body.university_id !== '' ? parseInt(req.body.university_id, 10) : null;

    if (universityId) {
      const uni = await universityRepo.findById(universityId);
      if (!uni || !uni.active || uni.kind === 'staff') return res.status(400).json({ success: false, error: 'Please choose a university from the list.' });
      const studentEmail = String((req.body && req.body.student_email) || '').trim().toLowerCase();
      if (!sv.validEmail(studentEmail)) return res.status(400).json({ success: false, error: 'Enter a valid university email address.' });
      if (!matchUniversityDomain(studentEmail, [uni])) {
        return res.status(400).json({ success: false, error: `That email doesn't match ${uni.name}'s student domain (@${uni.domain}).` });
      }
      const norm = sv.normalizeStudentEmail(studentEmail);
      if (await liveEmailTaken(norm)) return res.status(409).json({ success: false, error: TAKEN_MSG });
      if (details.student_id && await studentRepo.liveByStudentId(uni.id, details.student_id)) {
        return res.status(409).json({ success: false, error: 'This student ID is already verifying another account.' });
      }
      let row;
      try {
        row = await studentRepo.create({ userId: req.user.id, universityId: uni.id, universityName: uni.name, studentEmail, studentEmailNorm: norm,
          studentId: details.student_id, department: details.department, gradYear: details.grad_year, ip: c.ip, ua: c.userAgent });
      } catch (e) {
        if (e.code === '23505') return res.status(409).json({ success: false, error: /student_id/.test(e.constraint || '') ? 'This student ID is already verifying another account.' : TAKEN_MSG });
        throw e;
      }
      await issueAndSend(req.user.id, 'student_email', { to: studentEmail, fullName: req.user.full_name });
      return res.json({ success: true, verification_id: row.id, needs_code: true, needs_document: true });
    }

    // not on the list — no inbox to prove it, so the document and an admin decide
    const otherName = String((req.body && req.body.university_name_other) || '').trim().slice(0, 160);
    if (otherName.length < 2) return res.status(400).json({ success: false, error: 'Enter your university’s name.' });
    const row = await studentRepo.create({ userId: req.user.id, universityId: null, universityName: otherName,
      studentId: details.student_id, department: details.department, gradYear: details.grad_year, ip: c.ip, ua: c.userAgent });
    res.json({ success: true, verification_id: row.id, needs_code: false, needs_document: true });
  } catch (err) { fail(res, 'student apply', err, 'Could not start your student application.'); }
});

router.post('/student/resend-code', studentCodeLimiter, async (req, res) => {
  try {
    const v = await studentRepo.latestForUser(req.user.id);
    if (!v || v.status !== 'pending' || !v.student_email) return res.status(400).json({ success: false, error: 'There is no university email waiting for a code.' });
    if (v.student_email_verified_at) return res.json({ success: true, already_verified: true });
    const s = await userRepo.codes.recentStats(req.user.id, 'student_email', 24);
    const wait = s && s.last_at ? Math.ceil((new Date(s.last_at).getTime() + RESEND_COOLDOWN_S * 1000 - Date.now()) / 1000) : 0;
    if (wait > 0) return res.status(429).json({ success: false, error: `Wait ${wait} seconds before asking for another code.`, retry_in: wait });
    if (s && s.sent >= RESEND_PER_DAY) return res.status(429).json({ success: false, error: 'That is the most codes for today. Try again tomorrow, or check the spam folder of your university email.' });
    await issueAndSend(req.user.id, 'student_email', { to: v.student_email, fullName: req.user.full_name });
    res.json({ success: true, sent_to: v.student_email, retry_in: RESEND_COOLDOWN_S });
  } catch (err) { fail(res, 'student resend', err, 'Could not send a new code.'); }
});

router.post('/student/change-email', studentApplyLimiter, async (req, res) => {
  try {
    const v = await studentRepo.latestForUser(req.user.id);
    if (!v || v.status !== 'pending' || v.renewal_of) return res.status(400).json({ success: false, error: 'There is no application whose email can be changed.' });
    if (v.email_changes >= MAX_EMAIL_CHANGES) return res.status(429).json({ success: false, error: 'The email was changed too many times. Withdraw this application and start again.' });
    const uniId = parseInt((req.body || {}).university_id, 10) || v.university_id;
    const uni = uniId ? await universityRepo.findById(uniId) : null;
    if (!uni || !uni.active || uni.kind === 'staff') return res.status(400).json({ success: false, error: 'Please choose a university from the list.' });
    const email = String((req.body || {}).student_email || '').trim().toLowerCase();
    if (!sv.validEmail(email) || !matchUniversityDomain(email, [uni])) return res.status(400).json({ success: false, error: `Enter your ${uni.name} email (@${uni.domain}).` });
    const norm = sv.normalizeStudentEmail(email);
    if (await liveEmailTaken(norm, v.id)) return res.status(409).json({ success: false, error: TAKEN_MSG });
    try { await studentRepo.changeEmail(v.id, { universityId: uni.id, universityName: uni.name, email, norm }); }
    catch (e) { if (e.code === '23505') return res.status(409).json({ success: false, error: TAKEN_MSG }); throw e; }
    await issueAndSend(req.user.id, 'student_email', { to: email, fullName: req.user.full_name });
    res.json({ success: true, sent_to: email });
  } catch (err) { fail(res, 'student change-email', err, 'Could not change the email.'); }
});

router.post('/student/verify-code', studentCodeLimiter, async (req, res) => {
  try {
    const v = await studentRepo.latestForUser(req.user.id);
    if (!v || !v.student_email || v.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'No pending university email to verify.' });
    }
    if (v.student_email_verified_at) return res.json({ success: true, already_verified: true, needs_document: !v.document_path && !v.renewal_of });
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
      return res.status(400).json({ success: false, error: messages[result.reason] || 'That code is incorrect.', can_resend: result.reason !== 'mismatch' });
    }
    if (v.renewal_of && await liveEmailTaken(sv.normalizeStudentEmail(v.student_email), v.renewal_of)) {
      return res.status(409).json({ success: false, error: TAKEN_MSG });
    }
    await userRepo.codes.consume(codeRow.id);
    await studentRepo.markEmailVerified(v.id);
    const out = await studentDocs.evaluate(v.id, { notify: !!v.document_path });
    res.json({ success: true, status: out.status, expires_at: out.expires_at || null, needs_document: !v.document_path && !v.renewal_of });
  } catch (err) { fail(res, 'student verify-code', err, 'Could not verify that code.'); }
});

router.post('/student/details', studentApplyLimiter, async (req, res) => {
  try {
    const v = await studentRepo.latestForUser(req.user.id);
    if (!v || v.status !== 'pending') return res.status(400).json({ success: false, error: 'There is no application in progress.' });
    let d;
    try { d = sv.cleanDetails(req.body || {}); } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
    if (d.student_id && v.university_id) {
      const other = await studentRepo.liveByStudentId(v.university_id, d.student_id, v.id);
      if (other) return res.status(409).json({ success: false, error: 'This student ID is already verifying another account.' });
    }
    try { await studentRepo.setDetails(v.id, d); }
    catch (e) { if (e.code === '23505') return res.status(409).json({ success: false, error: 'This student ID is already verifying another account.' }); throw e; }
    const out = v.document_path && v.doc_state === 'done' ? await studentDocs.evaluate(v.id) : { status: 'pending' };
    res.json({ success: true, status: out.status });
  } catch (err) { fail(res, 'student details', err, 'Could not save your details.'); }
});

router.post('/student/document', studentDocLimiter, (req, res) => {
  studentDocUpload(req, res, async (uploadErr) => {
    if (uploadErr) {
      const msg = uploadErr.code === 'LIMIT_FILE_SIZE' ? 'That file is too large (8MB max).' : 'Upload a JPG, PNG, WebP or PDF.';
      return res.status(400).json({ success: false, error: msg });
    }
    if (!req.file) return res.status(400).json({ success: false, error: 'Attach your ID card or admission document.' });
    const drop = () => fs.unlink(req.file.path, () => {});
    try {
      // the bytes decide what the file is, not the name or what the browser said
      const head = Buffer.alloc(16);
      const fd = fs.openSync(req.file.path, 'r');
      fs.readSync(fd, head, 0, 16, 0);
      fs.closeSync(fd);
      const mime = sv.sniffMime(head);
      if (!mime) { drop(); return res.status(400).json({ success: false, error: 'That file is not a real JPG, PNG, WebP or PDF.' }); }

      const v = await studentRepo.latestForUser(req.user.id);
      if (!v || v.status !== 'pending' || v.renewal_of) { drop(); return res.status(400).json({ success: false, error: 'Start an application first.' }); }
      if (v.document_path) fs.unlink(absolutePath(v.document_path), () => {});
      await studentRepo.setDocument(v.id, relativePath(req), mime);

      // read it now; answer as soon as it is decided, or say it is still being read
      const out = await studentDocs.enqueue(v.id, DOC_WAIT_MS);
      if (!out) return res.json({ success: true, status: 'checking' });
      const fresh = await studentRepo.findById(v.id);
      res.json({ success: true, status: out.status, expires_at: out.expires_at || null, checks: publicChecks(fresh), needs_code: !fresh.student_email_verified_at && !!fresh.student_email });
    } catch (err) { fail(res, 'student document', err, 'Could not save your document.'); }
  });
});

router.post('/student/withdraw', studentApplyLimiter, async (req, res) => {
  try {
    const v = await studentRepo.latestForUser(req.user.id);
    if (!v || v.status !== 'pending') return res.status(400).json({ success: false, error: 'There is no application to withdraw.' });
    await studentRepo.decide(v.id, 'withdrawn', { decidedBy: 'applicant' });
    if (v.document_path) fs.unlink(absolutePath(v.document_path), () => {});
    const row = await userRepo.users.findById(req.user.id);
    if (row && row.student_status === 'pending') await userRepo.users.setStudentStatus(req.user.id, 'none', null);
    res.json({ success: true });
  } catch (err) { fail(res, 'student withdraw', err, 'Could not withdraw the application.'); }
});

// Renewal: one code to the same university inbox, no new document.
router.post('/student/renew', studentApplyLimiter, async (req, res) => {
  try {
    const history = await studentRepo.historyForUser(req.user.id);
    const full = history.length ? [{ ...history[0], ...(await studentRepo.findById(history[0].id)) }, ...history.slice(1)] : [];
    const can = options(full);
    if (!can.renew) return res.status(400).json({ success: false, error: 'Renewal opens in the last 45 days of your student plan.' });
    const base = full.find((h) => h.status === 'active') || full[0];
    const prev = await studentRepo.findById(base.id);
    const uni = await universityRepo.findById(prev.university_id);
    if (!uni || !uni.active || uni.kind === 'staff') return res.status(400).json({ success: false, error: 'Your university is no longer on the list — apply again instead.' });
    const c = security.clientOf(req);
    const row = await studentRepo.create({ userId: req.user.id, universityId: uni.id, universityName: uni.name, studentEmail: prev.student_email,
      studentId: prev.student_id, department: prev.department, gradYear: prev.grad_year, ip: c.ip, ua: c.userAgent, renewalOf: prev.id });
    await issueAndSend(req.user.id, 'student_email', { to: prev.student_email, fullName: req.user.full_name });
    res.json({ success: true, verification_id: row.id, needs_code: true, sent_to: prev.student_email });
  } catch (err) { fail(res, 'student renew', err, 'Could not start the renewal.'); }
});

module.exports = router;
