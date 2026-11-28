/**
 * Admin: plans and the subscriptions set by hand (mounted inside /admin).
 *
 *   GET  /api/subs/overview                  plans with how many hold them, counts, the latest changes
 *   PUT  /api/plans/:code                    create or edit a plan
 *   GET  /api/subs?filter=&plan=&search=     accounts and what each is on today
 *   GET  /api/subs/:userId                   one account: now, usage today, history
 *   POST /api/subs/assign                    set a plan on one or many accounts (ids or emails)
 *   POST /api/subs/:userId/extend            more days
 *   POST /api/subs/:userId/end               end it now
 *   POST /api/subs/:userId/factory           answers from the factory work orders, on or off
 */
const express = require('express');
const { adminAuth } = require('../middleware/admin-auth');
const repo = require('../db/repositories/subscription-repo');
const usageRepo = require('../db/repositories/usage-repo');
const plans = require('../services/plans');
const S = require('../engine/domain/subscriptions');
const mailClient = require('../mail/client');
const { noticeMail } = require('../mail/templates');

const router = express.Router();
const MAX_BULK = 200;
const ADMIN = 'admin';
const idOf = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 && String(n) === String(v) ? n : null; };
const dhaka = (d) => new Date(d).toLocaleDateString('en-GB', { timeZone: process.env.BUSINESS_TIMEZONE || 'Asia/Dhaka', day: 'numeric', month: 'long', year: 'numeric' });

const wrap = (what, fn) => async (req, res) => {
  try { res.json(await fn(req, res)); } catch (err) {
    if (err instanceof S.SubscriptionError) return res.status(400).json({ error: err.message });
    console.error(`[Admin subscriptions] ${what}:`, err.message);
    res.status(500).json({ error: `Could not ${what}.` });
  }
};

/** An account as the panel shows it: its columns and the plan in force today. */
const view = (u, cat) => {
  const now = S.resolve(u, cat);
  return { id: u.id, email: u.email, full_name: u.full_name, username: u.username, company: u.company, disabled: u.disabled, email_verified: u.email_verified,
    plan_interest: u.plan_interest, factory_access: !!u.factory_access, last_login_at: u.last_login_at, created_at: u.created_at,
    set_plan: u.plan_code, set_until: u.plan_expires_at, own_daily_limit: u.plan_daily_limit, note: u.plan_note, student_status: u.student_status,
    now: { plan: now.plan, name: now.name, daily_limit: now.dailyLimit, ends_at: now.expiresAt, days_left: now.daysLeft, source: now.source } };
};

async function tell(user, lines, subject) {
  try {
    const mail = noticeMail({ fullName: user.full_name, title: subject, subject: `KnitAdvisor: ${subject.toLowerCase()}`, lines, action: 'Your plan and how long it runs are shown on your dashboard.' });
    const sent = await mailClient.sendMail({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text });
    return !!(sent && sent.sent);
  } catch (err) {
    console.error('[Admin subscriptions] e-mail:', err.message);       // the plan is already changed: only the letter failed
    return false;
  }
}
const planLines = (plan, after) => [
  `Your KnitAdvisor plan is now ${plan.name}.`,
  after.plan_expires_at ? `It runs until ${dhaka(after.plan_expires_at)}.` : 'It has no end date.',
  (after.plan_daily_limit ?? plan.daily_limit) == null ? 'Requests: unlimited.' : `Requests: ${after.plan_daily_limit ?? plan.daily_limit} a day.`,
];

router.get('/api/subs/overview', adminAuth, wrap('load the subscriptions', async () => {
  const [list, counts, summary, recent] = await Promise.all([repo.plans.list(), repo.plans.counts(), repo.subscriptions.summary(), repo.subscriptions.recent(15)]);
  const by = Object.fromEntries(counts.map((c) => [c.code, c.users]));
  return { plans: list.map((p) => ({ ...p, users: by[p.code] || 0 })), summary, recent };
}));

router.put('/api/plans/:code', adminAuth, wrap('save the plan', async (req) => {
  const plan = await repo.plans.upsert(S.validatePlan(String(req.params.code), req.body));
  plans.invalidate();
  return { ok: true, plan };
}));

router.get('/api/subs', adminAuth, wrap('load the accounts', async (req) => {
  const out = await repo.subscriptions.list({ filter: req.query.filter, plan: req.query.plan || undefined, search: req.query.search || undefined, page: req.query.page, limit: req.query.limit });
  const cat = await plans.catalogue();
  return { ...out, rows: out.rows.map((u) => view(u, cat)) };
}));

router.get('/api/subs/:userId', adminAuth, wrap('load the account', async (req) => {
  const id = idOf(req.params.userId);
  if (!id) throw new S.SubscriptionError('Invalid account.');
  const u = await repo.subscriptions.findById(id);
  if (!u) throw new S.SubscriptionError('That account does not exist.');
  const [history, today] = await Promise.all([repo.subscriptions.history(id), usageRepo.todayCount(id)]);
  return { user: view(u, await plans.catalogue()), used_today: today, history };
}));

router.post('/api/subs/assign', adminAuth, wrap('set the plan', async (req) => {
  const b = req.body || {};
  const cat = S.catalogueOf(await repo.plans.list());
  const plan = cat.get(String(b.plan || ''));
  if (!plan) throw new S.SubscriptionError('Choose a plan.');
  if (!plan.active) throw new S.SubscriptionError(`The ${plan.name} plan is switched off.`);
  const ids = (Array.isArray(b.user_ids) ? b.user_ids : []).map((v) => idOf(v)).filter(Boolean);
  const emails = (Array.isArray(b.emails) ? b.emails : String(b.emails || '').split(/[\s,;]+/)).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  if (!ids.length && !emails.length) throw new S.SubscriptionError('Pick at least one account.');
  if (ids.length + emails.length > MAX_BULK) throw new S.SubscriptionError(`At most ${MAX_BULK} accounts at a time.`);
  const found = emails.length ? await repo.subscriptions.findByEmails(emails) : [];
  const results = emails.filter((e) => !found.some((u) => u.email.toLowerCase() === e)).map((email) => ({ email, ok: false, error: 'No account has this email. They must sign up first.' }));
  const all = [...new Set([...ids, ...found.map((u) => u.id)])];
  // a bad length or limit refuses the whole request before any account changes
  S.expiryFor(b, plan, null);
  for (const id of all) {
    try {
      const { before, after } = await repo.subscriptions.assign(id, plan, b, ADMIN);
      const had = S.activeSubscription(before);
      const mailed = b.notify ? await tell(after, planLines(plan, after), 'Your plan has changed') : undefined;
      results.push({ id, email: after.email, ok: true, change: S.direction(had ? cat.get(had.code) : null, plan), ends_at: after.plan_expires_at, mailed });
    } catch (err) {
      if (!(err instanceof S.SubscriptionError)) console.error('[Admin subscriptions] assign:', err.message);
      results.push({ id, ok: false, error: err instanceof S.SubscriptionError ? err.message : 'Could not change this account.' });
    }
  }
  return { ok: results.every((r) => r.ok), changed: results.filter((r) => r.ok).length, results };
}));

/** A change to one account, with an optional e-mail to its owner. */
function one(what, act) {
  return [adminAuth, wrap(what, async (req) => {
    const id = idOf(req.params.userId);
    if (!id) throw new S.SubscriptionError('Invalid account.');
    const b = req.body || {};
    const { after, mail } = await act(id, b);
    const mailed = b.notify && mail ? await tell(after, mail.lines, mail.subject) : undefined;
    return { ok: true, user: view(after, await plans.catalogue()), mailed };
  })];
}

router.post('/api/subs/:userId/extend', ...one('extend the subscription', async (id, b) => {
  const { after } = await repo.subscriptions.extend(id, Number(b.days), b.note, ADMIN);
  return { after, mail: { subject: 'Your plan has been extended', lines: [`Your KnitAdvisor plan now runs until ${dhaka(after.plan_expires_at)}.`] } };
}));
router.post('/api/subs/:userId/end', ...one('end the subscription', async (id, b) => {
  const { after } = await repo.subscriptions.end(id, b.note, ADMIN);
  return { after, mail: { subject: 'Your plan has ended', lines: ['Your KnitAdvisor subscription has ended. Your account stays, on the free plan (or your student plan if you have one).'] } };
}));
router.post('/api/subs/:userId/factory', ...one('change the factory access', async (id, b) => {
  if (typeof b.on !== 'boolean') throw new S.SubscriptionError('Say on or off.');
  return repo.subscriptions.setFactoryAccess(id, b.on, b.note, ADMIN);
}));

module.exports = router;
