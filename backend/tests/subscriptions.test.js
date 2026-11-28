// Plans set by hand: what an account may use today, how long a subscription runs, and what a plan edit may say.
'use strict';
const assert = require('assert');
const S = require('../engine/domain/subscriptions');

console.log('--- Running Subscription Tests ---');
const NOW = Date.parse('2026-11-27T10:00:00+06:00');
const DAY = 86400000;
const cat = S.catalogueOf();
const user = (o) => ({ is_paid: false, student_status: 'none', student_expires_at: null, plan_code: null, plan_expires_at: null, plan_daily_limit: null, ...o });
const on = (o) => S.resolve(user(o), cat, NOW);

{
  assert.deepStrictEqual([on({}).plan, on({}).dailyLimit, on({}).source], ['free', 5, 'free']);
  const stu = on({ student_status: 'active', student_expires_at: new Date(NOW + 10 * DAY) });
  assert.deepStrictEqual([stu.plan, stu.dailyLimit, stu.daysLeft], ['student', 30, 10]);
  const mill = on({ plan_code: 'mill', plan_expires_at: new Date(NOW + 2.5 * DAY), student_status: 'active', student_expires_at: new Date(NOW + 10 * DAY) });
  assert.deepStrictEqual([mill.plan, mill.name, mill.dailyLimit, mill.daysLeft, mill.source], ['mill', 'Mill', null, 3, 'subscription']);
  // ended: back to what the account is by itself
  assert.strictEqual(on({ plan_code: 'mill', plan_expires_at: new Date(NOW - 1000) }).plan, 'free');
  assert.strictEqual(on({ plan_code: 'mill', plan_expires_at: new Date(NOW - 1000), student_status: 'active', student_expires_at: new Date(NOW + DAY) }).plan, 'student');
  // no end date
  const u = on({ plan_code: 'unlimited' });
  assert(u.expiresAt === null && u.daysLeft === null && u.dailyLimit === null);
  // a demotion to Free holds even for a verified student; the account's own limit wins over the plan's
  assert.strictEqual(on({ plan_code: 'free', student_status: 'active', student_expires_at: new Date(NOW + DAY) }).dailyLimit, 5);
  assert.strictEqual(on({ plan_code: 'mill', plan_daily_limit: 200 }).dailyLimit, 200);
  assert.strictEqual(on({ plan_code: 'floor', plan_daily_limit: 0 }).dailyLimit, 0);
  // the old paid switch still counts for a row that carries it
  assert.deepStrictEqual([on({ is_paid: true }).dailyLimit, on({ is_paid: true }).source], [null, 'paid']);
  // the admin's own free and education limits move every account on them
  const mine = S.catalogueOf([{ code: 'free', name: 'Free', daily_limit: 40, rank: 0, active: true }, { code: 'edu', name: 'Education', daily_limit: null, rank: 10, active: true }]);
  assert.strictEqual(S.resolve(user({}), mine, NOW).dailyLimit, 40);
  assert.strictEqual(S.resolve(user({ student_status: 'active', student_expires_at: new Date(NOW + DAY) }), mine, NOW).dailyLimit, null);
  assert.strictEqual(S.resolve(user({ plan_code: 'gone' }), cat, NOW).plan, 'free', 'an unknown plan reads as free, not as unlimited');
  assert.strictEqual(S.resolve(null, cat, NOW).plan, 'free');
  console.log('✓ the plan in force: subscription, else the old paid switch, else student, else free; an ended one falls back');
}
{
  const mill = cat.get('mill'), un = cat.get('unlimited');
  const end = (opt, plan = mill, cur = null) => { const d = S.expiryFor(opt, plan, cur, NOW); return d && d.getTime(); };
  assert.strictEqual(end({}), NOW + 30 * DAY, "the plan's usual length");
  assert.strictEqual(end({ mode: 'default' }, un), null);
  assert.strictEqual(end({ mode: 'lifetime' }), null);
  assert.strictEqual(end({ mode: 'days', days: 7 }), NOW + 7 * DAY);
  assert.strictEqual(end({ mode: 'days', days: 30, from: 'after_current' }, mill, new Date(NOW + 5 * DAY)), NOW + 35 * DAY, 'added after the running period');
  assert.strictEqual(end({ mode: 'days', days: 30, from: 'after_current' }, mill, new Date(NOW - 5 * DAY)), NOW + 30 * DAY, 'an ended period counts from today');
  assert.strictEqual(end({ mode: 'until', until: '2026-12-31' }), Date.parse('2026-12-31T23:59:59+06:00'), 'the end of that day in Dhaka');
  for (const bad of [{ mode: 'days', days: 0 }, { mode: 'days', days: 1.5 }, { mode: 'days', days: 99999 }, { mode: 'until', until: '2026-02-31' }, { mode: 'until', until: '2020-01-01' }, { mode: 'until', until: 'soon' }, { mode: 'until', until: '2099-01-01' }, { mode: 'forever' }]) {
    assert.throws(() => S.expiryFor(bad, mill, null, NOW), S.SubscriptionError, JSON.stringify(bad));
  }
  assert.strictEqual(S.extendedExpiry(new Date(NOW + DAY), 10, NOW).getTime(), NOW + 11 * DAY);
  assert.strictEqual(S.extendedExpiry(new Date(NOW - DAY), 10, NOW).getTime(), NOW + 10 * DAY);
  assert.throws(() => S.extendedExpiry(null, -3, NOW), S.SubscriptionError);
  assert.deepStrictEqual([S.direction(null, mill), S.direction(mill, mill), S.direction(cat.get('floor'), mill), S.direction(un, mill)], ['new', 'renewal', 'promotion', 'demotion']);
  console.log('✓ lengths: the usual one, days, a last day, no end; renewals add on; bad lengths are refused');
}
{
  const p = S.validatePlan('mill_pro', { name: ' Mill Pro ', daily_limit: '', default_days: '90', rank: 35 });
  assert.deepStrictEqual([p.name, p.daily_limit, p.default_days, p.rank, p.active], ['Mill Pro', null, 90, 35, true]);
  assert.strictEqual(S.validatePlan('free', { name: 'Free', daily_limit: 25 }).daily_limit, 25);
  for (const [code, body] of [['Mill', { name: 'x x' }], ['__proto__', { name: 'abc' }], ['ok_code', { name: '' }], ['ok_code', { name: 'abc', daily_limit: -1 }], ['ok_code', { name: 'abc', default_days: 'ten' }], ['free', { name: 'Free', active: false }]]) {
    assert.throws(() => S.validatePlan(code, body), S.SubscriptionError, code + JSON.stringify(body));
  }
  console.log('✓ plan edits are checked; the Free plan cannot be switched off');
}
{
  const ACC = require('../engine/domain/recipe-access');
  delete process.env.KA_RECIPE_ACCOUNTS;
  assert(ACC.allowedAccount({ email: 'a@b.com', email_verified: true, factory_access: true }), 'switched on in the panel');
  assert(!ACC.allowedAccount({ email: 'a@b.com', email_verified: false, factory_access: true }), 'only with a verified e-mail');
  assert(!ACC.allowedAccount({ email: 'a@b.com', email_verified: true, factory_access: false }));
  assert(!ACC.allowedAccount({ email: 'a@b.com', email_verified: true, factory_access: 'yes' }));
  console.log('✓ factory work orders: only an account switched on (or named on the server), with a verified e-mail');
}
console.log('Subscription tests passed');
