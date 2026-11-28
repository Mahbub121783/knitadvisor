/**
 * Plans, the subscriptions the admin sets on accounts, and the history of every change (migration 049).
 * Every change is one transaction: the account row is locked, changed, and the change written to the history.
 */
const { query, queryOne, transaction } = require('../client');
const S = require('../../engine/domain/subscriptions');

const USER_COLS = 'id, email, full_name, username, company, disabled, email_verified, is_paid, student_status, student_expires_at, plan_interest, ' +
  'plan_code, plan_started_at, plan_expires_at, plan_daily_limit, plan_note, factory_access, created_at, last_login_at';
const like = (s) => '%' + String(s).replace(/[\\%_]/g, (m) => '\\' + m) + '%';

const plans = {
  list() { return query('SELECT code, name, daily_limit, default_days, rank, active, note FROM app_plans ORDER BY rank, code'); },
  /** How many accounts hold each plan now. */
  counts() {
    return query(`SELECT plan_code AS code, count(*)::int AS users FROM app_users
                   WHERE plan_code IS NOT NULL AND (plan_expires_at IS NULL OR plan_expires_at > now()) GROUP BY plan_code`);
  },
  upsert(p) {
    return queryOne(
      `INSERT INTO app_plans (code, name, daily_limit, default_days, rank, active, note) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (code) DO UPDATE SET name = $2, daily_limit = $3, default_days = $4, rank = $5, active = $6, note = $7, updated_at = now()
       RETURNING code, name, daily_limit, default_days, rank, active, note`,
      [p.code, p.name, p.daily_limit, p.default_days, p.rank, p.active, p.note]
    );
  },
};

/** Locks the account, applies `change(user)` (columns to set and the history line), writes both. */
function changing(userId, admin, change) {
  return transaction(async (q) => {
    const [user] = await q(`SELECT ${USER_COLS} FROM app_users WHERE id = $1 FOR UPDATE`, [userId]);
    if (!user) throw new S.SubscriptionError('That account does not exist.');
    const { set, event } = change(user);
    const keys = Object.keys(set);
    const [after] = await q(
      `UPDATE app_users SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING ${USER_COLS}`,
      [userId, ...keys.map((k) => set[k])]
    );
    await q(
      `INSERT INTO app_subscription_events (user_id, admin, action, from_plan, to_plan, expires_at, daily_limit, factory_access, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [userId, String(admin || 'admin').slice(0, 80), event.action, user.plan_code || (user.is_paid ? 'paid' : null), after.plan_code, after.plan_expires_at,
        after.plan_daily_limit, after.factory_access, event.note ? String(event.note).slice(0, 500) : null]
    );
    return { before: user, after };
  });
}

const subscriptions = {
  /** Sets a plan. opts: { mode, days, until, from, daily_limit, note, factory_access } */
  assign(userId, plan, opts, admin) {
    return changing(userId, admin, (user) => {
      const current = S.activeSubscription(user) ? user.plan_expires_at : null;
      const expires = S.expiryFor(opts, plan, current);
      const own = opts.daily_limit === '' || opts.daily_limit == null ? null : Number(opts.daily_limit);
      if (own != null && !(Number.isInteger(own) && own >= 0 && own <= 1000000)) throw new S.SubscriptionError('The account\'s own daily limit must be a whole number, or empty to follow the plan.');
      const set = { plan_code: plan.code, plan_started_at: new Date(), plan_expires_at: expires, plan_daily_limit: own, is_paid: false,
        plan_note: opts.note ? String(opts.note).slice(0, 500) : null };
      if (typeof opts.factory_access === 'boolean') set.factory_access = opts.factory_access;
      return { set, event: { action: 'assign', note: opts.note } };
    });
  },
  /** More days on the subscription the account holds (also one that has just ended). */
  extend(userId, days, note, admin) {
    return changing(userId, admin, (user) => {
      if (!user.plan_code) throw new S.SubscriptionError('This account has no subscription to extend: give it a plan first.');
      if (user.plan_expires_at == null) throw new S.SubscriptionError('This subscription has no end date: there is nothing to extend.');
      return { set: { plan_expires_at: S.extendedExpiry(user.plan_expires_at, days) }, event: { action: 'extend', note: note || `+${Number(days)} days` } };
    });
  },
  /** Ends the subscription at once: the account goes back to student (if verified) or free. */
  end(userId, note, admin) {
    return changing(userId, admin, (user) => {
      if (!user.plan_code && !user.is_paid) throw new S.SubscriptionError('This account has no subscription.');
      return { set: { plan_code: null, plan_started_at: null, plan_expires_at: null, plan_daily_limit: null, plan_note: null, is_paid: false }, event: { action: 'end', note } };
    });
  },
  /** Answers from the factory work orders: for the owner and people the owner trusts, nothing to do with the plan. */
  setFactoryAccess(userId, on, note, admin) {
    return changing(userId, admin, () => ({ set: { factory_access: !!on }, event: { action: on ? 'factory_on' : 'factory_off', note } }));
  },

  history(userId, limit = 50) {
    return query('SELECT at, admin, action, from_plan, to_plan, expires_at, daily_limit, factory_access, note FROM app_subscription_events WHERE user_id = $1 ORDER BY at DESC, id DESC LIMIT $2', [userId, limit]);
  },
  recent(limit = 20) {
    return query(`SELECT e.at, e.admin, e.action, e.from_plan, e.to_plan, e.expires_at, e.note, u.id AS user_id, u.email, u.full_name
                    FROM app_subscription_events e JOIN app_users u ON u.id = e.user_id ORDER BY e.at DESC, e.id DESC LIMIT $1`, [limit]);
  },

  findByEmails(emails) {
    return query(`SELECT ${USER_COLS} FROM app_users WHERE lower(email) = ANY($1::text[])`, [emails.map((e) => String(e).trim().toLowerCase())]);
  },
  findById(id) { return queryOne(`SELECT ${USER_COLS} FROM app_users WHERE id = $1`, [id]); },

  /** filter: all | subscribed | expiring (7 days) | expired | student | free | factory */
  async list({ filter = 'subscribed', plan, search, page = 1, limit = 25 } = {}) {
    const where = [], params = [];
    const add = (sql, v) => { params.push(v); where.push(sql.replace(/\$\?/g, '$' + params.length)); };
    const running = '(plan_code IS NOT NULL AND (plan_expires_at IS NULL OR plan_expires_at > now()))';
    const student = "(student_status = 'active' AND student_expires_at > now())";
    if (filter === 'subscribed') where.push(`(${running} OR is_paid)`);
    else if (filter === 'expiring') where.push("(plan_code IS NOT NULL AND plan_expires_at > now() AND plan_expires_at <= now() + interval '7 days')");
    else if (filter === 'expired') where.push('(plan_code IS NOT NULL AND plan_expires_at <= now())');
    else if (filter === 'student') where.push(student);
    else if (filter === 'free') where.push(`NOT ${running} AND NOT is_paid AND NOT coalesce(${student}, false)`);
    else if (filter === 'factory') where.push('factory_access');
    if (plan) add('plan_code = $?', plan);
    if (search) add("(full_name ILIKE $? OR email ILIKE $? OR coalesce(username, '') ILIKE $? OR coalesce(company, '') ILIKE $?)", like(search));
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const pageN = Math.max(1, parseInt(page, 10) || 1), lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const total = Number((await queryOne('SELECT count(*)::int AS count FROM app_users ' + clause, params)).count);
    // soonest to end first; open-ended after those; accounts without a subscription newest first
    const rows = await query(`SELECT ${USER_COLS} FROM app_users ${clause}
      ORDER BY (plan_code IS NULL), plan_expires_at ASC NULLS LAST, created_at DESC, id DESC LIMIT ${lim} OFFSET ${(pageN - 1) * lim}`, params);
    return { rows, total, page: pageN, pages: Math.max(1, Math.ceil(total / lim)) };
  },

  summary() {
    return queryOne(`SELECT
        count(*)::int AS accounts,
        count(*) FILTER (WHERE (plan_code IS NOT NULL AND plan_code <> 'free' AND (plan_expires_at IS NULL OR plan_expires_at > now())) OR is_paid)::int AS subscribed,
        count(*) FILTER (WHERE plan_code IS NOT NULL AND plan_expires_at > now() AND plan_expires_at <= now() + interval '7 days')::int AS expiring_7d,
        count(*) FILTER (WHERE plan_code IS NOT NULL AND plan_expires_at <= now() AND plan_expires_at > now() - interval '30 days')::int AS expired_30d,
        count(*) FILTER (WHERE student_status = 'active' AND student_expires_at > now())::int AS students,
        count(*) FILTER (WHERE factory_access)::int AS factory
      FROM app_users`);
  },
};

module.exports = { plans, subscriptions };
