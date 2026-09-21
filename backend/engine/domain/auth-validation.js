/**
 * Customer sign-up / sign-in validation — pure, no database, no I/O.
 *
 * Kept out of the route so the rules can be tested without a server and so the
 * route file reads as wiring, the same split rfq-engine.js uses.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const PLAN_INTERESTS = ['floor', 'mill', 'buying_house'];
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128; // scrypt cost is per-byte of input; bound it so a huge body is not a CPU lever

function normalizeEmail(email) {
  return String(email == null ? '' : email).trim().toLowerCase();
}

/**
 * @returns {{ok: boolean, errors: string[], value?: {email, password, full_name, company}}}
 */
function validateSignup(body) {
  const b = body || {};
  const errors = [];

  const email = normalizeEmail(b.email);
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) errors.push('Enter a valid work email address.');

  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length < PASSWORD_MIN) errors.push(`Password must be at least ${PASSWORD_MIN} characters.`);
  else if (password.length > PASSWORD_MAX) errors.push(`Password must be at most ${PASSWORD_MAX} characters.`);
  else if (password.toLowerCase() === email) errors.push('Password must not be the same as your email.');

  const fullName = String(b.full_name == null ? '' : b.full_name).trim();
  if (fullName.length < 2 || fullName.length > 120) errors.push('Enter your full name (2–120 characters).');

  const company = String(b.company == null ? '' : b.company).trim();
  if (company.length > 160) errors.push('Company name must be at most 160 characters.');

  // Unknown or absent plan is dropped rather than rejected — it is a hint, and
  // a stale button should not block someone from creating an account.
  const plan = PLAN_INTERESTS.includes(b.plan_interest) ? b.plan_interest : null;

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], value: { email, password, full_name: fullName, company: company || null, plan_interest: plan } };
}

function validateLogin(body) {
  const b = body || {};
  const email = normalizeEmail(b.email);
  const password = typeof b.password === 'string' ? b.password : '';
  if (!email || !password || email.length > 254 || password.length > PASSWORD_MAX) {
    return { ok: false, errors: ['Enter your email and password.'] };
  }
  return { ok: true, errors: [], value: { email, password } };
}

/** Same-origin relative path only — anything else would make login an open redirect. */
function safeNextPath(next) {
  if (typeof next !== 'string') return '/app.html';
  if (!/^\/[A-Za-z0-9._~\-/]*(\?[A-Za-z0-9._~\-=&%]*)?$/.test(next) || next.startsWith('//')) return '/app.html';
  return next;
}

module.exports = {
  validateSignup, validateLogin, normalizeEmail, safeNextPath,
  PASSWORD_MIN, PASSWORD_MAX, PLAN_INTERESTS,
};
