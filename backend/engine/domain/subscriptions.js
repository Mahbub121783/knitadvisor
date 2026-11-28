/**
 * Subscription rules — pure, no I/O.
 *
 * What an account may use today comes from, in this order:
 *   1. the subscription the admin set (plan_code), while it has not ended;
 *   2. the old "paid" switch, for any row still carrying it;
 *   3. a verified, unexpired student (the Education plan's limit);
 *   4. free.
 * A subscription to the Free plan is a deliberate demotion and wins over the
 * student status while it lasts.
 */
const { FREE_DAILY_LIMIT, STUDENT_DAILY_LIMIT, STUDENT_DURATION_DAYS } = require('./student-eligibility');

const DAY = 86400000;
const MAX_DAYS = 3660;

/** Used when the plan table cannot be read: the same plans migration 049 creates. */
const DEFAULT_PLANS = Object.freeze([
  { code: 'free', name: 'Free', daily_limit: FREE_DAILY_LIMIT, default_days: null, rank: 0, active: true },
  { code: 'edu', name: 'Education (student)', daily_limit: STUDENT_DAILY_LIMIT, default_days: STUDENT_DURATION_DAYS, rank: 10, active: true },
  { code: 'floor', name: 'Floor', daily_limit: 50, default_days: 30, rank: 20, active: true },
  { code: 'mill', name: 'Mill', daily_limit: null, default_days: 30, rank: 30, active: true },
  { code: 'buying_house', name: 'Buying House', daily_limit: null, default_days: 30, rank: 40, active: true },
  { code: 'unlimited', name: 'Unlimited', daily_limit: null, default_days: null, rank: 50, active: true },
]);

class SubscriptionError extends Error {}

/** @returns {Map<string, object>} code → plan; the core plans are always present */
function catalogueOf(rows) {
  const m = new Map(DEFAULT_PLANS.map((p) => [p.code, p]));
  (rows || []).forEach((r) => m.set(r.code, r));
  return m;
}

const timeOf = (v) => (v ? new Date(v).getTime() : null);
const daysLeft = (until, now) => (until == null ? null : Math.max(0, Math.ceil((until - now) / DAY)));

/** The subscription in force, or null (none set, or ended). */
function activeSubscription(user, now = Date.now()) {
  if (!user || !user.plan_code) return null;
  const end = timeOf(user.plan_expires_at);
  return end != null && !(end > now) ? null : { code: user.plan_code, ends: end };
}

/**
 * @returns {{plan: string, name: string, dailyLimit: number|null, expiresAt: Date|null, daysLeft: number|null,
 *   source: 'subscription'|'paid'|'student'|'free'}}
 */
function resolve(user, catalogue = catalogueOf(), now = Date.now()) {
  const plan = (code) => catalogue.get(code) || catalogue.get('free');
  const out = (code, name, dailyLimit, ends, source) => ({ plan: code, name, dailyLimit, expiresAt: ends == null ? null : new Date(ends), daysLeft: daysLeft(ends, now), source });
  const sub = activeSubscription(user, now);
  if (sub) {
    const p = plan(sub.code);
    const own = user.plan_daily_limit;
    return out(p.code, p.name, own != null ? Number(own) : p.daily_limit, sub.ends, 'subscription');
  }
  if (user && user.is_paid) return out('paid', 'Unlimited', null, null, 'paid');
  const stu = user && user.student_status === 'active' ? timeOf(user.student_expires_at) : null;
  if (stu != null && stu > now) return out('student', 'Student', plan('edu').daily_limit, stu, 'student');
  return out('free', plan('free').name, plan('free').daily_limit, null, 'free');
}

const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/**
 * When a new or changed subscription ends.
 * @param {object} opt { mode: 'default'|'days'|'until'|'lifetime', days, until: 'YYYY-MM-DD', from: 'now'|'after_current' }
 * @param {object} plan the plan being set
 * @param {Date|string|null} current the running subscription's end, for from = 'after_current'
 * @returns {Date|null} null = no end date
 */
function expiryFor(opt, plan, current = null, now = Date.now()) {
  const mode = (opt && opt.mode) || 'default';
  if (mode === 'lifetime') return null;
  if (mode === 'until') {
    const s = String((opt && opt.until) || '');
    // the end of that day in Dhaka (UTC+6)
    const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T23:59:59+06:00`) : NaN;
    if (!Number.isFinite(t) || new Date(t + 6 * 3600000).toISOString().slice(0, 10) !== s) throw new SubscriptionError('Give the last day as a date (YYYY-MM-DD).');
    if (!(t > now)) throw new SubscriptionError('The last day has already passed.');
    if (t > now + MAX_DAYS * DAY) throw new SubscriptionError('That is more than ten years away; choose "no end date" instead.');
    return new Date(t);
  }
  let days;
  if (mode === 'default') { days = plan.default_days; if (days == null) return null; } else if (mode === 'days') days = Number(opt.days);
  else throw new SubscriptionError('Choose how long: the plan\'s usual length, a number of days, a last day, or no end date.');
  if (!intIn(days, 1, MAX_DAYS)) throw new SubscriptionError(`The number of days must be a whole number from 1 to ${MAX_DAYS}.`);
  const end = timeOf(current);
  const start = opt && opt.from === 'after_current' && end != null && end > now ? end : now;
  return new Date(start + days * DAY);
}

/** Days added to a running (or just ended) subscription. */
function extendedExpiry(current, days, now = Date.now()) {
  if (!intIn(Number(days), 1, MAX_DAYS)) throw new SubscriptionError(`The number of days must be a whole number from 1 to ${MAX_DAYS}.`);
  const end = timeOf(current);
  return new Date((end != null && end > now ? end : now) + Number(days) * DAY);
}

function direction(fromPlan, toPlan) {
  if (!fromPlan) return 'new';
  if (fromPlan.code === toPlan.code) return 'renewal';
  return toPlan.rank > fromPlan.rank ? 'promotion' : toPlan.rank < fromPlan.rank ? 'demotion' : 'change';
}

const blank = (v) => v === '' || v === null || v === undefined;

/** An admin's edit of a plan (or a new one), checked. */
function validatePlan(code, body) {
  const b = body || {};
  if (!/^[a-z][a-z0-9_]{1,29}$/.test(String(code))) throw new SubscriptionError('The plan code is 2–30 small letters, digits or underscores, starting with a letter.');
  const name = String(b.name || '').trim();
  if (name.length < 2 || name.length > 60) throw new SubscriptionError('Give the plan a name of 2–60 characters.');
  const num = (v, lo, hi, what) => { if (blank(v)) return null; const n = Number(v); if (!intIn(n, lo, hi)) throw new SubscriptionError(`${what} must be a whole number from ${lo} to ${hi}, or empty.`); return n; };
  const out = {
    code, name,
    daily_limit: num(b.daily_limit, 0, 1000000, 'Requests a day'),
    default_days: num(b.default_days, 1, MAX_DAYS, 'The usual length in days'),
    rank: num(b.rank, 0, 1000, 'The rank') || 0,
    active: b.active !== false,
    note: String(b.note || '').slice(0, 300) || null,
  };
  if (code === 'free' && !out.active) throw new SubscriptionError('The Free plan cannot be switched off: every account without a subscription uses it.');
  return out;
}

module.exports = { DEFAULT_PLANS, MAX_DAYS, SubscriptionError, catalogueOf, activeSubscription, resolve, expiryFor, extendedExpiry, direction, validatePlan, daysLeft };
