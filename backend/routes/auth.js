/**
 * Customer accounts — /api/auth/*
 *
 *   POST /signup   create an account and sign in
 *   POST /login    sign in
 *   POST /logout   end the session
 *   GET  /me       who am I (200 with the user, 401 when signed out)
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
const { validateSignup, validateLogin } = require('../engine/domain/auth-validation');

const signupLimiter = createRateLimiter({
  name: 'auth-signup',
  max: 8,
  windowMs: 60 * 60 * 1000,
  message: 'Too many sign-up attempts from this network. Please try again later.',
});
const loginLimiter = createRateLimiter({
  name: 'auth-login',
  max: 10,
  windowMs: 5 * 60 * 1000,
  message: 'Too many sign-in attempts. Try again in a few minutes.',
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
    await userRepo.users.touchLogin(user.id);
    await startSession(req, res, user.id);
    res.status(201).json({ success: true, user: publicUser(user) });
  } catch (err) {
    console.error('[Auth] signup failed:', err.message);
    res.status(500).json({ success: false, error: 'Could not create your account. Please try again.' });
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
    await userRepo.users.touchLogin(row.id);
    await startSession(req, res, row.id);
    res.json({ success: true, user: publicUser(row) });
  } catch (err) {
    console.error('[Auth] login failed:', err.message);
    res.status(500).json({ success: false, error: 'Sign-in failed. Please try again.' });
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
