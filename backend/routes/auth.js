/**
 * Customer accounts — /api/auth/*
 *
 *   POST /signup                create an account (unverified), mail an activation code
 *   POST /verify-email          {email, code} — activates the account and signs in
 *   POST /resend-activation     {email} — a fresh activation code, rate-limited
 *   GET  /username-availability ?username= — live check while typing, format + uniqueness
 *   POST /login                 {identifier, password[, code, method]} — email OR username. A code
 *                               is asked for ONLY when the account turned on two-step sign-in.
 *   POST /forgot-password       {identifier} — mails a password-reset code to the account's real email
 *   POST /reset-password        {identifier, code, new_password} — resets and signs in
 *   POST /logout                end the session
 *   GET  /me                    who am I (200 with the user, 401 when signed out)
 *
 * Distinct from the admin login in routes/admin.js: different table, different
 * cookie, and an admin token is never accepted here or the reverse.
 */
const express = require('express');
const router = express.Router();

const userRepo = require('../db/repositories/user-repo');
const { hashPassword, verifyPassword } = require('../middleware/password');
const { createRateLimiter } = require('../middleware/rate-limiter');
const {
  newToken, hashToken, readCookie, COOKIE_NAME,
  setSessionCookie, clearSessionCookie, loadUser,
} = require('../middleware/user-auth');
const {
  validateSignup, validateLogin, validateEmailOnly, validateVerifyCode,
  validateForgotPassword, validateResetPassword, usernameProblem,
} = require('../engine/domain/auth-validation');
const { checkCode } = require('../engine/domain/otp');
const totp = require('../engine/domain/totp');
const { issueAndSend } = require('../services/account-codes');
const universityRepo = require('../db/repositories/university-repo');
const security = require('../services/security');

const signupLimiter = createRateLimiter({
  name: 'auth-signup', max: 8, windowMs: 60 * 60 * 1000,
  message: 'Too many sign-up attempts from this network. Please try again later.',
});
const loginLimiter = createRateLimiter({
  name: 'auth-login', max: 10, windowMs: 5 * 60 * 1000,
  message: 'Too many sign-in attempts. Try again in a few minutes.',
});
// Codes themselves are rate-limited by MAX_ATTEMPTS in otp.js; this bounds how
// often a NEW code can be requested, so a resend button cannot be used to spam
// the mailbox or as a cheap way to keep resetting the attempt counter.
const codeRequestLimiter = createRateLimiter({
  name: 'auth-code-request', max: 5, windowMs: 60 * 60 * 1000,
  message: 'Too many code requests. Please wait before asking for another.',
});
const codeVerifyLimiter = createRateLimiter({
  name: 'auth-code-verify', max: 20, windowMs: 15 * 60 * 1000,
  message: 'Too many attempts. Please wait before trying again.',
});
// Typed per keystroke (debounced client-side) — same headroom as the app's
// existing fuzzy-search endpoints (search.js), not the tighter auth limiters.
const usernameCheckLimiter = createRateLimiter({
  name: 'auth-username-check', max: 120, windowMs: 60 * 1000,
  message: 'Too many checks — slow down a moment.',
});

// A real verifyPassword() against a throwaway hash, so "no such email" and
// "wrong password" cost the same time and timing cannot enumerate accounts.
const DUMMY_HASH = hashPassword('not-a-real-password-just-burns-the-same-cpu');

function publicUser(u) {
  return {
    id: u.id, email: u.email, username: u.username, full_name: u.full_name, company: u.company,
    email_verified: !!u.email_verified, two_factor: u.two_factor || 'off',
  };
}

const CODE_MSG = {
  too_many_attempts: 'Too many wrong attempts. Request a new code.',
  expired: 'This code has expired. Request a new one.',
};

async function startSession(req, res, userId) {
  const { rawToken, tokenHash } = newToken();
  const c = security.clientOf(req);
  const session = await userRepo.sessions.create(userId, tokenHash, c.ip, c.userAgent);
  setSessionCookie(req, res, rawToken, session.maxAgeSeconds);
}

// A successful sign-in by any route: lock cleared, owner told if the device is new, recorded.
async function signedIn(req, res, user, how) {
  await userRepo.users.clearFailedLogins(user.id);
  await userRepo.users.touchLogin(user.id);
  await security.alertIfNewDevice(user, req);
  await security.record(user.id, 'login', req, how);
  await startSession(req, res, user.id);
}

router.post('/signup', signupLimiter, async (req, res) => {
  const v = validateSignup(req.body);
  if (!v.ok) return res.status(400).json({ success: false, error: v.errors[0], errors: v.errors });

  try {
    const { email, username, password, full_name, company, plan_interest } = v.value;
    const { row: user, conflictField } = await userRepo.users.create({
      email, username, fullName: full_name, company, planInterest: plan_interest, passwordHash: hashPassword(password),
    });
    if (!user) {
      const message = conflictField === 'username'
        ? 'That username is already taken. Try another.'
        : 'An account with this email already exists. Try signing in.';
      return res.status(409).json({ success: false, error: message, conflict: conflictField });
    }
    await issueAndSend(user.id, 'activation', { to: user.email, fullName: user.full_name });
    // No session yet — the account cannot do anything until the code lands.
    res.status(201).json({
      success: true, verification_required: true, email: user.email,
      message: 'Enter the 6-digit code we emailed you to activate your account.',
    });
  } catch (err) {
    console.error('[Auth] signup failed:', err.message);
    res.status(500).json({ success: false, error: 'Could not create your account. Please try again.' });
  }
});

router.post('/verify-email', codeVerifyLimiter, async (req, res) => {
  const v = validateVerifyCode(req.body);
  if (!v.ok) return res.status(400).json({ success: false, error: v.errors[0] });

  try {
    const { email, code } = v.value;
    const user = await userRepo.users.findByEmail(email);
    if (!user) return res.status(400).json({ success: false, error: 'Invalid or expired code.' });
    if (user.email_verified) {
      // Already activated (a second tab, a stale page) — sign them in rather
      // than telling them "invalid code" for a code that already worked.
      await signedIn(req, res, user, 'activation code');
      return res.json({ success: true, user: publicUser(user) });
    }

    const row = await userRepo.codes.latest(user.id, 'activation');
    const result = checkCode(code, row);
    if (!result.ok) {
      if (result.reason === 'mismatch') await userRepo.codes.incrementAttempts(row.id);
      const msg = result.reason === 'too_many_attempts'
        ? 'Too many wrong attempts. Request a new code.'
        : result.reason === 'expired' ? 'This code has expired. Request a new one.'
        : 'Invalid or expired code.';
      return res.status(400).json({ success: false, error: msg, reason: result.reason });
    }

    await userRepo.codes.consume(row.id);
    await userRepo.users.markEmailVerified(user.id);
    await signedIn(req, res, { ...user, email_verified: true }, 'activation code');
    res.json({ success: true, user: publicUser({ ...user, email_verified: true }) });
  } catch (err) {
    console.error('[Auth] verify-email failed:', err.message);
    res.status(500).json({ success: false, error: 'Could not verify your email. Please try again.' });
  }
});

router.post('/resend-activation', codeRequestLimiter, async (req, res) => {
  const v = validateEmailOnly(req.body);
  if (!v.ok) return res.status(400).json({ success: false, error: v.errors[0] });

  // Same response whether or not the account exists / is already verified —
  // this endpoint must not become a way to check who has signed up.
  const generic = { success: true, message: 'If that account needs activating, a new code is on its way.' };
  try {
    const user = await userRepo.users.findByEmail(v.value.email);
    if (user && !user.email_verified) {
      await issueAndSend(user.id, 'activation', { to: user.email, fullName: user.full_name });
    }
    res.json(generic);
  } catch (err) {
    console.error('[Auth] resend-activation failed:', err.message);
    res.json(generic); // a mail hiccup should not tell an attacker anything either
  }
});

router.get('/username-availability', usernameCheckLimiter, async (req, res) => {
  const raw = String(req.query.username || '').trim();
  const problem = usernameProblem(raw);
  if (problem) return res.json({ available: false, reason: problem });
  try {
    const existing = await userRepo.users.findByUsername(raw);
    res.json({ available: !existing });
  } catch (err) {
    console.error('[Auth] username-availability failed:', err.message);
    // Unknown, not false — a DB hiccup here must not block a signup the
    // eventual INSERT would have allowed; the real uniqueness check still
    // happens there regardless of what this convenience endpoint said.
    res.json({ available: null });
  }
});

// Public on purpose — the student-plan picker on the signup form needs this
// list before an account (and therefore a session) exists. Read-only, no
// PII, same generous per-minute budget as username-availability.
router.get('/universities', usernameCheckLimiter, async (req, res) => {
  try {
    res.json({ success: true, universities: await universityRepo.listActive() });
  } catch (err) {
    console.error('[Auth] universities failed:', err.message);
    res.json({ success: true, universities: [] }); // a listing hiccup must not block signup itself
  }
});

// Password first. A code is asked for only when the account has two-step
// sign-in on — an account whose activation mail never arrived signs in with
// its password like any other (it is reminded to verify on the account page).
router.post('/login', loginLimiter, async (req, res) => {
  const v = validateLogin(req.body);
  if (!v.ok) return res.status(400).json({ success: false, error: v.errors[0] });

  try {
    const { identifier, password } = v.value;
    const row = await userRepo.users.findByIdentifier(identifier);
    // an account locked by wrong passwords stays locked even for the right one:
    // otherwise the lock would only slow a guesser down until they hit it
    if (row && row.locked_until && new Date(row.locked_until) > new Date()) {
      verifyPassword(password, DUMMY_HASH);
      const mins = Math.max(1, Math.ceil((new Date(row.locked_until) - Date.now()) / 60000));
      return res.status(429).json({ success: false, code: 'LOCKED', error: `Too many wrong passwords. Sign-in for this account is paused for ${mins} more minute${mins > 1 ? 's' : ''}. You can reset your password instead.` });
    }
    const ok = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !ok || row.disabled) {
      console.warn(`[Auth] Failed sign-in for "${identifier}" from ${req.ip || 'unknown'}`);
      if (row && !row.disabled) await wrongAttempt(row, req, 'password');
      return res.status(401).json({ success: false, error: 'Incorrect email/username or password.' });
    }

    const mode = row.two_factor || 'off';
    if (mode !== 'off') {
      const code = String((req.body || {}).code || '').trim();
      // with an app on, "email me a code instead" is the way back in after
      // losing the phone — only to an address that was proven
      const useEmail = mode === 'email' || ((req.body || {}).method === 'email' && row.email_verified);
      if (!code) {
        if (useEmail) await issueAndSend(row.id, 'login', { to: row.email, fullName: row.full_name });
        return res.json({
          success: false, two_factor_required: true, method: useEmail ? 'email' : 'app',
          can_email: mode === 'app' && !!row.email_verified,
          message: useEmail ? `Enter the 6-digit code we emailed to ${maskEmail(row.email)}.` : 'Enter the 6-digit code from your authenticator app.',
        });
      }
      if (useEmail) {
        const c = await userRepo.codes.latest(row.id, 'login');
        const r = checkCode(code, c);
        if (!r.ok) {
          if (r.reason === 'mismatch') { await userRepo.codes.incrementAttempts(c.id); await wrongAttempt(row, req, 'email code'); }
          return res.status(400).json({ success: false, two_factor_required: true, method: 'email', error: CODE_MSG[r.reason] || 'That code is not right.' });
        }
        await userRepo.codes.consume(c.id);
      } else {
        let step = null;
        try { step = row.totp_secret ? totp.verify(totp.open(row.totp_secret), code, row.totp_last_step) : null; }
        catch (e) { console.error('[Auth] two-step secret unreadable:', e.message); }
        if (step == null) await wrongAttempt(row, req, 'app code');
        if (step == null) return res.status(400).json({ success: false, two_factor_required: true, method: 'app', can_email: !!row.email_verified, error: 'That code is not right. Check the time on your phone and use the newest code.' });
        await userRepo.users.setTotpLastStep(row.id, step);
      }
    }

    await signedIn(req, res, row, mode === 'off' ? 'password' : `password + ${mode === 'app' ? 'app' : 'email'} code`);
    res.json({ success: true, user: publicUser(row) });
  } catch (err) {
    console.error('[Auth] login failed:', err.message);
    res.status(500).json({ success: false, error: 'Sign-in failed. Please try again.' });
  }
});

// a wrong password or code: counted on the account, recorded, and when it
// locks the owner is told by mail
async function wrongAttempt(row, req, what) {
  const r = await userRepo.users.recordFailedLogin(row.id);
  await security.record(row.id, 'login_failed', req, what);
  if (r.failed === userRepo.LOCK_AFTER) security.alertLocked(row, req, 15);
}

function maskEmail(e) {
  const [u, d] = String(e).split('@');
  return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`;
}

router.post('/forgot-password', codeRequestLimiter, async (req, res) => {
  const v = validateForgotPassword(req.body);
  if (!v.ok) return res.status(400).json({ success: false, error: v.errors[0] });

  // Generic regardless of identifier kind — this must not become a way to
  // check whether a given email OR username is registered.
  const generic = { success: true, message: 'If that account exists, a reset code is on its way.' };
  try {
    const user = await userRepo.users.findByIdentifier(v.value.identifier);
    if (user && !user.disabled) {
      // Always the real address on file — a username never doubles as an inbox.
      await issueAndSend(user.id, 'password_reset', { to: user.email, fullName: user.full_name });
    }
    res.json(generic);
  } catch (err) {
    console.error('[Auth] forgot-password failed:', err.message);
    res.json(generic);
  }
});

router.post('/reset-password', codeVerifyLimiter, async (req, res) => {
  const v = validateResetPassword(req.body);
  if (!v.ok) return res.status(400).json({ success: false, error: v.errors[0] });

  try {
    const { identifier, code, new_password } = v.value;
    const user = await userRepo.users.findByIdentifier(identifier);
    if (!user) return res.status(400).json({ success: false, error: 'Invalid or expired code.' });

    const row = await userRepo.codes.latest(user.id, 'password_reset');
    const result = checkCode(code, row);
    if (!result.ok) {
      if (result.reason === 'mismatch') await userRepo.codes.incrementAttempts(row.id);
      const msg = result.reason === 'too_many_attempts'
        ? 'Too many wrong attempts. Request a new code.'
        : result.reason === 'expired' ? 'This code has expired. Request a new one.'
        : 'Invalid or expired code.';
      return res.status(400).json({ success: false, error: msg, reason: result.reason });
    }

    await userRepo.codes.consume(row.id);
    await userRepo.users.updatePassword(user.id, hashPassword(new_password));
    // A password reset is always a "someone may have had the old one" moment —
    // every existing session ends, matching the logged-in password-change flow.
    await userRepo.sessions.removeAllForUser(user.id);
    if (!user.email_verified) await userRepo.users.markEmailVerified(user.id);
    await security.record(user.id, 'password_reset', req);
    await signedIn(req, res, user, 'password reset');
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    console.error('[Auth] reset-password failed:', err.message);
    res.status(500).json({ success: false, error: 'Could not reset your password. Please try again.' });
  }
});

router.post('/logout', async (req, res) => {
  const token = readCookie(req.headers.cookie, COOKIE_NAME);
  if (token) {
    try { await userRepo.sessions.remove(hashToken(token)); }
    catch (err) { console.error('[Auth] logout failed to delete session:', err.message); }
  }
  clearSessionCookie(req, res);
  res.json({ success: true });
});

router.get('/me', async (req, res) => {
  // Signed-out is an expected answer, not an error the browser console should
  // shout about — but the status stays 401 so the front-end guard can rely on it.
  res.set('Cache-Control', 'no-store');
  try {
    const user = await loadUser(req);
    if (!user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED' });
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    console.error('[Auth] /me failed:', err.message);
    res.status(500).json({ success: false, error: 'Could not verify your session.' });
  }
});

module.exports = router;
