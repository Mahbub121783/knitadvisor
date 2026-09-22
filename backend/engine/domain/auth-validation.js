/**
 * Customer sign-up / sign-in validation — pure, no database, no I/O.
 *
 * Kept out of the route so the rules can be tested without a server and so the
 * route file reads as wiring, the same split rfq-engine.js uses.
 */

const { isValidCodeFormat } = require('./otp');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const PLAN_INTERESTS = ['floor', 'mill', 'buying_house'];
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128; // scrypt cost is per-byte of input; bound it so a huge body is not a CPU lever
// A 10-character password of one class ("aaaaaaaaaa") is still a fast guess;
// requiring 3 of the 4 common classes blocks that without demanding a
// specific symbol/position the way naive rules do (which just push people to
// "Password1!" every time). No dictionary check — that needs a wordlist this
// app doesn't carry — so this is a floor, not a full strength meter.
const PASSWORD_CLASSES = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/];
const PASSWORD_MIN_CLASSES = 3;

function normalizeEmail(email) {
  return String(email == null ? '' : email).trim().toLowerCase();
}

function passwordClassCount(password) {
  return PASSWORD_CLASSES.reduce((n, re) => n + (re.test(password) ? 1 : 0), 0);
}

/** One rule, reused everywhere a NEW password is chosen (signup, self-service
 *  change, reset, and an admin setting one for a user) — a login's password
 *  field is never run through this, only the account it is trying to become. */
function passwordProblem(password, email) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  if (email && password.toLowerCase() === email) return 'Password must not be the same as your email.';
  if (passwordClassCount(password) < PASSWORD_MIN_CLASSES) {
    return `Password must include at least ${PASSWORD_MIN_CLASSES} of: lowercase letters, uppercase letters, numbers, symbols.`;
  }
  return null;
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
  const pwProblem = passwordProblem(password, email);
  if (pwProblem) errors.push(pwProblem);

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

function validateProfile(body) {
  const b = body || {};
  const fullName = String(b.full_name == null ? '' : b.full_name).trim();
  const company = String(b.company == null ? '' : b.company).trim();
  if (fullName.length < 2 || fullName.length > 120) return { ok: false, errors: ['Enter your full name (2–120 characters).'] };
  if (company.length > 160) return { ok: false, errors: ['Company name must be at most 160 characters.'] };
  return { ok: true, errors: [], value: { full_name: fullName, company: company || null } };
}

function validatePasswordChange(body, email) {
  const b = body || {};
  const current = typeof b.current_password === 'string' ? b.current_password : '';
  if (!current || current.length > PASSWORD_MAX) return { ok: false, errors: ['Enter your current password.'] };
  const problem = passwordProblem(b.new_password, email);
  if (problem) return { ok: false, errors: [problem] };
  if (b.new_password === current) return { ok: false, errors: ['Choose a password different from your current one.'] };
  return { ok: true, errors: [], value: { current_password: current, new_password: b.new_password } };
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

function validateEmailOnly(body) {
  const email = normalizeEmail((body || {}).email);
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return { ok: false, errors: ['Enter a valid email address.'] };
  return { ok: true, errors: [], value: { email } };
}

function validateVerifyCode(body) {
  const b = body || {};
  const email = normalizeEmail(b.email);
  if (!email || !EMAIL_RE.test(email)) return { ok: false, errors: ['Enter a valid email address.'] };
  if (!isValidCodeFormat(b.code)) return { ok: false, errors: ['Enter the 6-digit code from your email.'] };
  return { ok: true, errors: [], value: { email, code: b.code } };
}

function validateResetPassword(body) {
  const b = body || {};
  const email = normalizeEmail(b.email);
  if (!email || !EMAIL_RE.test(email)) return { ok: false, errors: ['Enter a valid email address.'] };
  if (!isValidCodeFormat(b.code)) return { ok: false, errors: ['Enter the 6-digit code from your email.'] };
  const problem = passwordProblem(b.new_password, email);
  if (problem) return { ok: false, errors: [problem] };
  return { ok: true, errors: [], value: { email, code: b.code, new_password: b.new_password } };
}

/** Same-origin relative path only — anything else would make login an open redirect. */
function safeNextPath(next) {
  if (typeof next !== 'string') return '/app.html';
  if (!/^\/[A-Za-z0-9._~\-/]*(\?[A-Za-z0-9._~\-=&%]*)?$/.test(next) || next.startsWith('//')) return '/app.html';
  return next;
}

module.exports = {
  validateSignup, validateLogin, validateProfile, validatePasswordChange,
  validateEmailOnly, validateVerifyCode, validateResetPassword,
  normalizeEmail, safeNextPath, passwordProblem,
  PASSWORD_MIN, PASSWORD_MAX, PASSWORD_MIN_CLASSES, PLAN_INTERESTS,
};
