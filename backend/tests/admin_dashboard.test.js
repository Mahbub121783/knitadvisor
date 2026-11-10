// The admin home: what it says needs attention, the numbers it derives, and that one failing query leaves a hole in one card, not a blank page.
const assert = require('assert');
const path = require('path');
console.log('--- Running Admin Dashboard Tests ---');

// a stand-in database: every query the dashboard asks is answered by matching its SQL
const state = { fail: new Set(), rows: {} };
const clientPath = require.resolve('../db/client');
const answer = (sql) => {
  const has = (re) => re.test(sql);
  const keyOf = [
    ['users', /FROM app_users\s*$/], ['signups', /AS signups/], ['calcs', /AS calcs FROM user_calculations/], ['api series', /FROM api_key_daily WHERE day > .* GROUP BY 1/],
    ['api now', /AS active_keys/], ['revenue', /FROM api_orders WHERE status = 'paid' GROUP BY currency/], ['revenue series', /to_char\(date_trunc/], ['engines', /AS calculation_runs/],
    ['top api', /sum\(m\.calls\)::int AS calls/], ['top calcs', /AS runs/], ['near quota', /k\.monthly_limit, u\.email/], ['expiring', /k\.expires_at < now\(\)/],
    ['orders', /AS paid_no_key/], ['security', /AS bad_key_sources_1h/], ['security events', /e\.kind <> 'login'/], ['health', /^SELECT 1$/], ['charge gaps', /FROM charge_gaps/],
    ['price feed', /FROM yarn_price_syncs ORDER BY/], ['activity', /UNION ALL/],
  ].find(([, re]) => has(re));
  return keyOf ? keyOf[0] : null;
};
const reply = (sql, one) => {
  const k = answer(sql.trim());
  if (!k) throw new Error('unexpected SQL: ' + sql.slice(0, 80));
  if (state.fail.has(k)) throw new Error('boom ' + k);
  const v = state.rows[k];
  return one ? (Array.isArray(v) ? v[0] : v) || null : (Array.isArray(v) ? v : v ? [v] : []);
};
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: {
  query: async (sql) => reply(sql, false), queryOne: async (sql) => reply(sql, true), poolStats: () => ({ total: 3, idle: 2, waiting: 0, initialised: true }), getPool() {}, transaction() {}, testConnection() {}, close() {},
} };
const repo = require('../db/repositories/admin-dashboard-repo');
const catalogue = require('../engine/domain/api-catalogue');
const runtime = { build: 'abc1234', mail: 'ok', cacheMem: 10, cacheDb: 20 };

const base = () => ({
  users: { total: 120, new_range: 12, new_prev: 8, disabled: 1, paid: 5, students: 7, active_24h: 9, active_7d: 40 },
  signups: [{ d: new Date().toISOString().slice(0, 10), signups: 3 }], calcs: [], 'api series': [], 'revenue series': [],
  'api now': { active_keys: 3, suspended_keys: 0, customers: 2, calls_month: 5000, calls_prev_month: 4000, calls_today: 120, errors_7d: 5, calls_7d: 900 },
  revenue: [{ currency: 'USD', month: '60.00', prev_month: '30.00', total: '180.00', orders: 4 }, { currency: 'BDT', month: '0', prev_month: '0', total: '5000', orders: 1 }],
  engines: { calculations: 300, calculation_runs: 900, warp_designs: 4, weft_designs: 22, cost_sheets: 9, scans: 6, designs_range: 5, sheets_range: 2, scans_range: 1, calcs_range: 40 },
  'top api': [{ email: 'a@x', calls: 4000, keys: 1, plan: 'pro' }], 'top calcs': [], 'near quota': [], expiring: [],
  orders: { pending: 0, oldest_hours: 0, paid_no_key: 0 }, security: { failed_24h: 1, failed_7d: 3, failing_ips: 1, logins_24h: 30, bad_key_sources_1h: 0 }, 'security events': [],
  health: [{ ok: 1 }], 'charge gaps': { open: 0, hits_7d: 0 }, 'price feed': { started_at: new Date(), ok: true, newest_quote: '2026-11-09', rows_stored: 40, age_s: 3600, failed_3d: 0 }, activity: [],
});
const run = async (over, extra) => { state.fail = new Set(); state.rows = { ...base(), ...(over || {}) }; return repo.build({ days: 7, apiCatalogue: catalogue, runtime, queues: (extra || {}).queues }); };

(async () => {
  // a quiet system says so
  let d = await run();
  assert.deepStrictEqual(d.attention, [], 'nothing to do: an empty list');
  assert.strictEqual(d.users.trend_pct, 50, '12 new against 8 before: +50 %');
  assert.strictEqual(d.api.error_pct_7d, 0.6, 'errors are a share of calls, to a tenth');
  assert.strictEqual(d.api.month_trend_pct, 25);
  assert.strictEqual(d.series.signups.length, 7, 'a 7-day range has 7 days, empty ones filled');
  assert.strictEqual(d.series.signups[6].signups, 3); assert.strictEqual(d.series.signups[0].signups, 0);
  assert.strictEqual(d.revenue[0].currency, 'USD', 'the biggest currency leads'); assert.strictEqual(d.revenue[0].month, 60);
  assert.strictEqual(d.series.revenue_currency, 'USD'); assert.strictEqual(d.series.revenue.length, 6);
  assert.strictEqual(d.health.db_ms >= 0 && d.health.build === 'abc1234' && d.health.pool.total === 3, true);
  assert.deepStrictEqual(d.partial_errors, []);

  // what needs attention, with the rule that fired
  d = await run({ orders: { pending: 2, oldest_hours: 30, paid_no_key: 1 } });
  assert(d.attention.some((a) => /2 API orders waiting.*oldest 30 h/.test(a.text) && a.level === 'warn' && a.tab === 'tab-apikeys'), 'an order waiting a day is a warning');
  assert(d.attention.some((a) => /1 paid order has not turned into a key/.test(a.text)));
  d = await run({ orders: { pending: 1, oldest_hours: 2, paid_no_key: 0 } });
  assert(d.attention.find((a) => /waiting for a payment check/.test(a.text)).level === 'info', 'a fresh order is only a notice');
  d = await run({ 'near quota': [{ id: 1, name: 'ERP', prefix: 'ka_live_aa', plan: 'beta', monthly_limit: null, email: 'big@x', calls: 950 }, { id: 2, name: 'x', prefix: 'ka_live_bb', plan: 'pro', monthly_limit: 1000, email: 'ok@x', calls: 400 }] });
  assert(d.attention.some((a) => /1 API key is at 90% or more.*big@x/.test(a.text) && a.level === 'warn'), "a beta key at 950 of 1,000 is near its plan's limit; one at 40% is not");
  assert.strictEqual(d.near_quota.length, 1);
  d = await run({ 'near quota': [{ id: 3, name: 'custom', prefix: 'ka_live_cc', plan: 'pro', monthly_limit: 50, email: 'tiny@x', calls: 46 }] });
  assert(d.attention.some((a) => /tiny@x/.test(a.text)), "a key's own limit beats its plan's");
  d = await run({ expiring: [{ id: 4, name: 'k', prefix: 'p', expires_at: new Date(Date.now() + 86400000), email: 'soon@x' }] });
  assert(d.attention.some((a) => /expires within 7 days.*soon@x/.test(a.text)));
  d = await run({ 'api now': { ...base()['api now'], errors_7d: 400, calls_7d: 900 } });
  assert(d.attention.some((a) => /44% of API calls.*returned an error/.test(a.text)));
  d = await run({ 'api now': { ...base()['api now'], errors_7d: 5, calls_7d: 20 } });
  assert(!d.attention.some((a) => /returned an error/.test(a.text)), 'a handful of calls proves nothing');
  d = await run({ security: { ...base().security, failed_24h: 25, failing_ips: 4 } });
  assert(d.attention.some((a) => /25 failed sign-ins in 24 hours from 4 addresses/.test(a.text) && a.level === 'warn'));
  d = await run({ security: { ...base().security, bad_key_sources_1h: 2 } });
  assert(d.attention.some((a) => /2 addresses tried wrong API keys/.test(a.text)));
  d = await run({ 'price feed': { ...base()['price feed'], age_s: 5 * 86400, ok: true } });
  assert(d.attention.some((a) => /last synced 5 days ago/.test(a.text)));
  d = await run({ 'price feed': { ...base()['price feed'], failed_3d: 3 } });
  assert(d.attention.some((a) => /failed 3 times in 3 days/.test(a.text)));
  d = await run({ 'charge gaps': { open: 4, hits_7d: 17 } });
  assert(d.attention.some((a) => /4 charge-book gaps open \(17 lookups/.test(a.text) && a.tab === 'tab-charges'));
  const slow = await run(); // the stand-in answers instantly; a slow database and a mail fault are driven through the runtime
  state.rows = { ...base() }; d = await repo.build({ days: 7, apiCatalogue: catalogue, runtime: { ...runtime, mail: 'login_failed' } });
  assert(d.attention.some((a) => /mail service reports "login_failed"/.test(a.text) && a.tab === 'tab-settings'));
  d = await repo.build({ days: 7, apiCatalogue: catalogue, runtime: { ...runtime, mail: 'unchecked' } });
  assert(!d.attention.some((a) => /mail service/.test(a.text)), 'unchecked is not a fault');

  // the website's own queues join the list, warnings first
  d = await run({ orders: { pending: 1, oldest_hours: 2, paid_no_key: 0 } }, { queues: [{ level: 'warn', text: 'Groq is enabled but unhealthy', tab: 'tab-providers', count: null }, { level: 'info', text: '2 RFQs are awaiting review.', tab: 'tab-rfq', count: 2 }] });
  assert.strictEqual(d.attention[0].level, 'warn', 'warnings come first');
  assert(d.attention.length === 3 && d.attention.every((a, i, all) => i === 0 || !(all[i - 1].level === 'info' && a.level === 'warn')));

  // who is using it, and the engines
  assert.strictEqual(d.top_api[0].email, 'a@x'); assert.strictEqual(d.engines.warp_designs, 4); assert.strictEqual(d.engines.calculation_runs, 900);

  // one failing query: one card is empty, the rest of the page still loads
  state.rows = base(); state.fail = new Set(['users', 'top api', 'price feed']);
  d = await repo.build({ days: 30, apiCatalogue: catalogue, runtime });
  assert.deepStrictEqual(d.partial_errors.sort(), ['price feed', 'top api', 'users'].sort(), 'the cards that could not load are named');
  assert.strictEqual(d.users, null); assert.deepStrictEqual(d.top_api, []); assert.strictEqual(d.price_feed, null);
  assert(d.api && d.api.calls_month === 5000 && d.series.signups.length === 30 && d.engines.calculations === 300, 'everything else is there');
  assert(!d.attention.some((a) => /price feed/.test(a.text)), 'a feed that could not be read raises no false alarm');

  // an empty database: zeros, not crashes
  state.fail = new Set(); state.rows = {};
  d = await repo.build({ days: 90, apiCatalogue: catalogue, runtime });
  assert(d.series.api.length === 90 && d.series.api.every((x) => x.calls === 0) && d.activity.length === 0 && d.revenue.length === 0 && d.series.revenue.length === 6);

  // wiring: the route, the page, the loader
  const fs = require('fs');
  const route = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');
  assert(/router\.get\('\/api\/dashboard', adminAuth/.test(route) && /\[7, 30, 90\]/.test(route), 'an admin-only route with three ranges');
  const html = fs.readFileSync(path.join(__dirname, '../../frontend/admin.html'), 'utf8');
  ['dh-attention', 'dh-kpis', 'dh-ch-signups', 'dh-ch-api', 'dh-ch-rev', 'dh-top-api', 'dh-top-calcs', 'dh-engines', 'dh-health', 'dh-security', 'dh-activity'].forEach((id) => assert(html.includes(`id="${id}"`), id));
  const js = fs.readFileSync(path.join(__dirname, '../../frontend/assets/js/admin.js'), 'utf8');
  assert(/async function loadDashboard/.test(js) && /\/admin\/api\/dashboard\?range=/.test(js) && /wireDashboard\(\);\s*loadDashboard\(\)/.test(js));
  console.log('Admin dashboard tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
