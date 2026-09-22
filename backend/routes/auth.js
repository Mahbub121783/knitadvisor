/**
 * Customer accounts — /api/auth/*
 *
 *   POST /signup             create an account (unverified), mail an activation code
 *   POST /verify-email       {email, code} — activates the account and signs in
 *   POST /resend-activation  {email} — a fresh activation code, rate-limited
 *   POST /login              sign in (blocked until the email is verified)
 *   POST /forgot-password    {email} — mails a password-reset code
 *   POST /reset-password     {email, code, new_password} — resets and signs in
 *   POST /logout             end the session
 *   GET  /me                 who am I (200 with the user, 401 when signed out)
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
  validateSignup, validateLogin, validateEmailOnly, validateVerifyCode, validateResetPassword,
} = require('../engine/domain/auth-validation');
const { checkCode } = require('../engine/domain/otp');
const { issueAndSend } = require('../services/account-codes');

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

// A real verifyPassword() against a throwaway hash, so "no such email" and
// "wrong password" cost the same time and timing cannot enumerate accounts.
const DUMMY_HASH = hashPassword('not-a-real-password-just-burns-the-same-cpu');

function publicUser(u) {
  return { id: u.id, email: u.email, full_name: u.full_name, company: u.company };
}

async function startSession(req, res, userId) {
  const { rawToken, tokenHash } = newToken();
  const session = await userRepo.sessions.create(userId, tokenHash);
  setSessionCookie(req, res, rawToken, session.maxAgeSeconds);
}

router.post('/signup', signupLimiter, async (req, res) => {
  const v = validateSignup(req.body);
  if (!v.ok) return res.status(400).json({ success: false, error: v.errors[0], errors: v.errors });

  try {
    const { email, password, full_name, company, plan_interest } = v.value;
    const user = await userRepo.users.create({
      email, fullName: full_name, company, planInterest: plan_interest, passwordHash: hashPassword(password),
    });
    if (!user) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists. Try signing in.' });
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
      await userRepo.users.touchLogin(user.id);
      await startSession(req, res, user.id);
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
    await userRepo.users.touchLogin(user.id);
    await startSession(req, res, user.id);
    res.json({ success: true, user: publicUser(user) });
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

router.post('/login', loginLimiter, async (req, res) => {
  const v = validateLogin(req.body);
  if (!v.ok) return res.status(400).json({ success: false, error: v.errors[0] });

  try {
    const { email, password } = v.value;
    const row = await userRepo.users.findByEmail(email);
    const ok = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !ok || row.disabled) {
      console.warn(`[Auth] Failed sign-in for "${email}" from ${req.ip || 'unknown'}`);
      return res.status(401).json({ success: false, error: 'Incorrect email or password.' });
    }
    if (!row.email_verified) {
      return res.status(403).json({
        success: false, code: 'EMAIL_NOT_VERIFIED', email: row.email,
        error: 'Please verify your email before signing in.',
      });
    }
    await userRepo.users.touchLogin(row.id);
    await startSession(req, res, row.id);
    res.json({ success: true, user: publicUser(row) });
  } catch (err) {
    console.error('[Auth] login failed:', err.message);
    res.status(500).json({ success: false, error: 'Sign-in failed. Please try again.' });
  }
});

router.post('/forgot-password', codeRequestLimiter, async (req, res) => {
  const v = validateEmailOnly(req.body);
  if (!v.ok) return res.status(400).json({ success: false, error: v.errors[0] });

  const generic = { success: true, message: 'If that account exists, a reset code is on its way.' };
  try {
    const user = await userRepo.users.findByEmail(v.value.email);
    if (user && !user.disabled) {
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
    const { email, code, new_password } = v.value;
    const user = await userRepo.users.findByEmail(email);
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
    await userRepo.users.touchLogin(user.id);
    await startSession(req, res, user.id);
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
