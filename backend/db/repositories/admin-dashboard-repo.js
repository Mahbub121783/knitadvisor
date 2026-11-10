/**
 * The admin home in one read: what needs attention, how the business and the API are doing,
 * growth over a chosen range, who uses the engines most, how the system is, what the
 * security events say, and what just happened.
 *
 * Every block is its own query run through `settle`, so one slow or failing query leaves
 * a hole in one card, never a blank page. Dates are days on the Asia/Dhaka calendar.
 */
'use strict';
const { query, queryOne, poolStats } = require('../client');

const tz = () => process.env.BUSINESS_TIMEZONE || 'Asia/Dhaka';
const num = (v) => (v == null ? 0 : +v);
const settle = async (name, fn, errors) => {
  try { return await fn(); } catch (e) { errors.push(name); console.error('[Admin dashboard]', name, e.message); return null; }
};

/** A day-by-day series with the empty days filled in, so a chart's axis is honest. */
function fillDays(rows, days, keys) {
  const by = new Map(rows.map((r) => [String(r.d).slice(0, 10), r]));
  const out = [];
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: tz() }));
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(today); dt.setDate(today.getDate() - i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const r = by.get(key) || {};
    const o = { date: key };
    keys.forEach((k) => { o[k] = num(r[k]); });
    out.push(o);
  }
  return out;
}

async function build({ days, apiCatalogue, runtime, queues }) {
  const errors = [];
  const T = tz();
  const S = (name, fn) => settle(name, fn, errors);

  const [users, signups, calcSeries, apiSeries, apiNow, revenue, revenueSeries, engines, topApi, topCalc, nearQuota, expiring, orders, security, secEvents, health, gaps, price, activity] = await Promise.all([
    S('users', () => queryOne(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE created_at > now() - make_interval(days => $1))::int AS new_range,
              count(*) FILTER (WHERE created_at <= now() - make_interval(days => $1) AND created_at > now() - make_interval(days => 2 * $1))::int AS new_prev,
              count(*) FILTER (WHERE disabled)::int AS disabled,
              count(*) FILTER (WHERE is_paid)::int AS paid,
              count(*) FILTER (WHERE student_status = 'active')::int AS students,
              count(*) FILTER (WHERE last_login_at > now() - interval '24 hours')::int AS active_24h,
              count(*) FILTER (WHERE last_login_at > now() - interval '7 days')::int AS active_7d
         FROM app_users`, [days])),
    S('signups', () => query(`SELECT (created_at AT TIME ZONE $2)::date AS d, count(*)::int AS signups FROM app_users WHERE created_at > now() - make_interval(days => $1 + 1) GROUP BY 1`, [days, T])),
    S('calcs', () => query(`SELECT (created_at AT TIME ZONE $2)::date AS d, count(*)::int AS calcs FROM user_calculations WHERE created_at > now() - make_interval(days => $1 + 1) GROUP BY 1`, [days, T])),
    S('api series', () => query(`SELECT day AS d, sum(calls)::int AS calls, sum(errors)::int AS errors FROM api_key_daily WHERE day > (now() AT TIME ZONE $2)::date - $1 GROUP BY 1`, [days, T])),
    S('api now', () => queryOne(
      `SELECT (SELECT count(*) FROM api_keys WHERE status = 'active')::int AS active_keys,
              (SELECT count(*) FROM api_keys WHERE status = 'suspended')::int AS suspended_keys,
              (SELECT count(DISTINCT user_id) FROM api_keys WHERE status = 'active')::int AS customers,
              (SELECT COALESCE(sum(calls), 0) FROM api_key_usage WHERE period = to_char(now() AT TIME ZONE $1, 'YYYY-MM'))::int AS calls_month,
              (SELECT COALESCE(sum(calls), 0) FROM api_key_usage WHERE period = to_char((now() AT TIME ZONE $1) - interval '1 month', 'YYYY-MM'))::int AS calls_prev_month,
              (SELECT COALESCE(sum(calls), 0) FROM api_key_daily WHERE day = (now() AT TIME ZONE $1)::date)::int AS calls_today,
              (SELECT COALESCE(sum(errors), 0) FROM api_key_daily WHERE day > (now() AT TIME ZONE $1)::date - 7)::int AS errors_7d,
              (SELECT COALESCE(sum(calls), 0) FROM api_key_daily WHERE day > (now() AT TIME ZONE $1)::date - 7)::int AS calls_7d`, [T])),
    S('revenue', () => query(
      `SELECT currency,
              COALESCE(sum(amount) FILTER (WHERE (decided_at AT TIME ZONE $1) >= date_trunc('month', now() AT TIME ZONE $1)), 0) AS month,
              COALESCE(sum(amount) FILTER (WHERE (decided_at AT TIME ZONE $1) >= date_trunc('month', now() AT TIME ZONE $1) - interval '1 month' AND (decided_at AT TIME ZONE $1) < date_trunc('month', now() AT TIME ZONE $1)), 0) AS prev_month,
              COALESCE(sum(amount), 0) AS total, count(*)::int AS orders
         FROM api_orders WHERE status = 'paid' GROUP BY currency ORDER BY total DESC`, [T])),
    S('revenue series', () => query(
      `SELECT to_char(date_trunc('month', decided_at AT TIME ZONE $1), 'YYYY-MM') AS m, currency, sum(amount) AS amount
         FROM api_orders WHERE status = 'paid' AND decided_at > now() - interval '6 months' GROUP BY 1, 2 ORDER BY 1`, [T])),
    S('engines', () => queryOne(
      `SELECT (SELECT count(*) FROM user_calculations)::int AS calculations,
              (SELECT COALESCE(sum(run_count), 0) FROM user_calculations)::int AS calculation_runs,
              (SELECT count(*) FROM studio_designs WHERE design->>'tech' = 'warp')::int AS warp_designs,
              (SELECT count(*) FROM studio_designs WHERE COALESCE(design->>'tech', '') <> 'warp')::int AS weft_designs,
              (SELECT count(*) FROM cost_sheets)::int AS cost_sheets,
              (SELECT count(*) FROM fabric_scans)::int AS scans,
              (SELECT count(*) FROM studio_designs WHERE created_at > now() - make_interval(days => $1))::int AS designs_range,
              (SELECT count(*) FROM cost_sheets WHERE created_at > now() - make_interval(days => $1))::int AS sheets_range,
              (SELECT count(*) FROM fabric_scans WHERE created_at > now() - make_interval(days => $1))::int AS scans_range,
              (SELECT count(*) FROM user_calculations WHERE created_at > now() - make_interval(days => $1))::int AS calcs_range`, [days])),
    S('top api', () => query(
      `SELECT u.email, u.full_name, u.company, sum(m.calls)::int AS calls, count(DISTINCT k.id)::int AS keys, max(k.plan) AS plan
         FROM api_key_usage m JOIN api_keys k ON k.id = m.key_id JOIN app_users u ON u.id = k.user_id
        WHERE m.period = to_char(now() AT TIME ZONE $1, 'YYYY-MM') GROUP BY u.email, u.full_name, u.company ORDER BY calls DESC LIMIT 6`, [T])),
    S('top calcs', () => query(
      `SELECT u.email, u.full_name, u.company, count(*)::int AS calcs, COALESCE(sum(c.run_count), 0)::int AS runs
         FROM user_calculations c JOIN app_users u ON u.id = c.user_id WHERE c.last_run_at > now() - make_interval(days => $1)
        GROUP BY u.email, u.full_name, u.company ORDER BY runs DESC LIMIT 6`, [days])),
    S('near quota', () => query(
      `SELECT k.id, k.name, k.prefix, k.plan, k.monthly_limit, u.email, COALESCE(m.calls, 0)::int AS calls
         FROM api_keys k JOIN app_users u ON u.id = k.user_id
         LEFT JOIN api_key_usage m ON m.key_id = k.id AND m.period = to_char(now() AT TIME ZONE $1, 'YYYY-MM')
        WHERE k.status = 'active'`, [T])),
    S('expiring', () => query(`SELECT k.id, k.name, k.prefix, k.expires_at, u.email FROM api_keys k JOIN app_users u ON u.id = k.user_id WHERE k.status = 'active' AND k.expires_at IS NOT NULL AND k.expires_at < now() + interval '7 days' ORDER BY k.expires_at LIMIT 10`)),
    S('orders', () => queryOne(`SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending, COALESCE(floor(extract(epoch FROM (now() - min(created_at) FILTER (WHERE status = 'pending'))) / 3600), 0)::int AS oldest_hours, count(*) FILTER (WHERE status = 'paid' AND key_id IS NULL)::int AS paid_no_key FROM api_orders`)),
    S('security', () => queryOne(
      `SELECT count(*) FILTER (WHERE kind = 'login_failed' AND created_at > now() - interval '24 hours')::int AS failed_24h,
              count(*) FILTER (WHERE kind = 'login_failed' AND created_at > now() - interval '7 days')::int AS failed_7d,
              count(DISTINCT ip) FILTER (WHERE kind = 'login_failed' AND created_at > now() - interval '24 hours')::int AS failing_ips,
              count(*) FILTER (WHERE kind = 'login' AND created_at > now() - interval '24 hours')::int AS logins_24h,
              (SELECT count(*) FROM rate_limit_hits WHERE bucket = 'apikey_fail' AND window_start > now() - interval '1 hour')::int AS bad_key_sources_1h
         FROM app_security_events`)),
    S('security events', () => query(
      `SELECT e.kind, e.ip, e.detail, e.created_at, u.email FROM app_security_events e JOIN app_users u ON u.id = e.user_id
        WHERE e.kind <> 'login' ORDER BY e.created_at DESC LIMIT 8`)),
    S('health', async () => {
      const t0 = Date.now(); await query('SELECT 1'); const dbMs = Date.now() - t0;
      const m = process.memoryUsage();
      return { db_ms: dbMs, pool: poolStats(), uptime_s: Math.floor(process.uptime()), node: process.version, rss_mb: Math.round(m.rss / 1048576), heap_mb: Math.round(m.heapUsed / 1048576), build: runtime.build, mail: runtime.mail, cache_mem: runtime.cacheMem, cache_db: runtime.cacheDb };
    }),
    S('charge gaps', () => queryOne(`SELECT count(*) FILTER (WHERE NOT resolved)::int AS open, COALESCE(sum(hits) FILTER (WHERE NOT resolved AND last_seen > now() - interval '7 days'), 0)::int AS hits_7d FROM charge_gaps`)),
    S('price feed', () => queryOne(`SELECT started_at, ok, newest_quote, rows_stored, EXTRACT(epoch FROM (now() - started_at))::int AS age_s, (SELECT count(*) FROM yarn_price_syncs WHERE NOT ok AND started_at > now() - interval '3 days')::int AS failed_3d FROM yarn_price_syncs ORDER BY started_at DESC LIMIT 1`)),
    S('activity', () => query(
      `(SELECT 'signup' AS kind, created_at AS at, email AS who, COALESCE(company, full_name) AS what, 'tab-users' AS tab FROM app_users ORDER BY created_at DESC LIMIT 6)
       UNION ALL (SELECT 'rfq', created_at, buyer_email, COALESCE(buyer_company, buyer_name) || ' · ' || status, 'tab-rfq' FROM rfq_requests ORDER BY created_at DESC LIMIT 6)
       UNION ALL (SELECT 'api_order', o.created_at, u.email, o.plan || ' × ' || o.months || ' mo · ' || o.status, 'tab-apikeys' FROM api_orders o JOIN app_users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 6)
       UNION ALL (SELECT 'api_key', k.created_at, u.email, 'key ' || k.name || ' · ' || k.plan, 'tab-apikeys' FROM api_keys k JOIN app_users u ON u.id = k.user_id ORDER BY k.created_at DESC LIMIT 6)
       UNION ALL (SELECT 'design', d.created_at, u.email, 'saved a ' || (CASE WHEN d.design->>'tech' = 'warp' THEN 'warp' ELSE 'weft' END) || ' design: ' || d.name, 'tab-users' FROM studio_designs d JOIN app_users u ON u.id = d.user_id ORDER BY d.created_at DESC LIMIT 6)
       UNION ALL (SELECT 'costsheet', c.created_at, u.email, 'costing sheet: ' || c.name, 'tab-users' FROM cost_sheets c JOIN app_users u ON u.id = c.user_id ORDER BY c.created_at DESC LIMIT 4)
       ORDER BY at DESC LIMIT 16`)),
  ]);

  // ── what needs attention, each with where to act ──
  const attention = [];
  const A = (level, text, tab, count) => attention.push({ level, text, tab, count: count == null ? null : count });
  if (orders && orders.pending > 0) A(orders.oldest_hours >= 24 ? 'warn' : 'info', `${orders.pending} API order${orders.pending > 1 ? 's' : ''} waiting for a payment check${orders.oldest_hours >= 1 ? ` (the oldest ${orders.oldest_hours >= 48 ? Math.floor(orders.oldest_hours / 24) + ' days' : orders.oldest_hours + ' h'})` : ''}.`, 'tab-apikeys', orders.pending);
  if (orders && orders.paid_no_key > 0) A('info', `${orders.paid_no_key} paid order${orders.paid_no_key > 1 ? 's have' : ' has'} not turned into a key yet — the customer has not pressed "Create my API key".`, 'tab-apikeys', orders.paid_no_key);
  const near = (nearQuota || []).filter((k) => { const lim = k.monthly_limit != null ? k.monthly_limit : (apiCatalogue.PLANS[k.plan] || apiCatalogue.PLANS.custom).monthly; return lim > 0 && k.calls / lim >= 0.9; });
  if (near.length) A('warn', `${near.length} API key${near.length > 1 ? 's are' : ' is'} at 90% or more of the month's calls: ${near.slice(0, 3).map((k) => k.email).join(', ')}${near.length > 3 ? '…' : ''} — an upgrade to offer, or a stop coming.`, 'tab-apikeys', near.length);
  if (expiring && expiring.length) A('info', `${expiring.length} API key${expiring.length > 1 ? 's expire' : ' expires'} within 7 days: ${expiring.slice(0, 3).map((k) => k.email).join(', ')}.`, 'tab-apikeys', expiring.length);
  if (apiNow && apiNow.calls_7d >= 50 && apiNow.errors_7d / apiNow.calls_7d > 0.25) A('warn', `${Math.round((apiNow.errors_7d / apiNow.calls_7d) * 100)}% of API calls in the last 7 days returned an error — a customer may be calling it wrongly.`, 'tab-apikeys');
  if (security && security.failed_24h >= 10) A('warn', `${security.failed_24h} failed sign-ins in 24 hours from ${security.failing_ips} address${security.failing_ips === 1 ? '' : 'es'} — look at the security card.`, 'tab-overview', security.failed_24h);
  if (security && security.bad_key_sources_1h > 0) A('info', `${security.bad_key_sources_1h} address${security.bad_key_sources_1h > 1 ? 'es' : ''} tried wrong API keys in the last hour.`, 'tab-apikeys', security.bad_key_sources_1h);
  if (price && (price.age_s > 3 * 86400 || price.failed_3d >= 2)) A('warn', price.failed_3d >= 2 ? `The yarn price sync failed ${price.failed_3d} times in 3 days.` : `The yarn price feed was last synced ${Math.floor(price.age_s / 86400)} days ago.`, 'tab-prices');
  if (gaps && gaps.open > 0) A('info', `${gaps.open} charge-book gap${gaps.open > 1 ? 's' : ''} open (${gaps.hits_7d} lookups in 7 days could not be answered) — fabrics the book cannot price yet.`, 'tab-charges', gaps.open);
  if (health && health.db_ms > 400) A('warn', `The database answered in ${health.db_ms} ms — slow.`, 'tab-overview');
  if (health && health.mail && !['ok', 'unchecked'].includes(health.mail)) A('warn', `The mail service reports "${health.mail}": sign-up codes and notifications may not be reaching customers.`, 'tab-settings');

  // the warnings first, then the notices; the website's own queues are part of the same list
  (queues || []).forEach((q) => attention.push(q));
  attention.sort((x, y) => (x.level === 'warn' ? 0 : 1) - (y.level === 'warn' ? 0 : 1));

  const apiDays = fillDays(apiSeries || [], days, ['calls', 'errors']);
  const rev = (revenue || []).map((r) => ({ currency: r.currency, month: +r.month, prev_month: +r.prev_month, total: +r.total, orders: r.orders }));
  const lead = rev[0] ? rev[0].currency : null;
  const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  return {
    range_days: days, partial_errors: errors, attention,
    users: users && { ...users, trend_pct: users.new_prev ? Math.round(((users.new_range - users.new_prev) / users.new_prev) * 100) : null },
    api: apiNow && { ...apiNow, error_pct_7d: apiNow.calls_7d ? Math.round((apiNow.errors_7d / apiNow.calls_7d) * 1000) / 10 : 0, month_trend_pct: apiNow.calls_prev_month ? Math.round(((apiNow.calls_month - apiNow.calls_prev_month) / apiNow.calls_prev_month) * 100) : null },
    orders, revenue: rev,
    series: {
      signups: fillDays(signups || [], days, ['signups']), calcs: fillDays(calcSeries || [], days, ['calcs']), api: apiDays,
      revenue_currency: lead, revenue: months.map((m) => ({ month: m, amount: (revenueSeries || []).filter((r) => r.m === m && r.currency === lead).reduce((t, r) => t + +r.amount, 0) })),
    },
    engines, top_api: topApi || [], top_calcs: topCalc || [], near_quota: near.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, email: k.email, calls: k.calls })), expiring: expiring || [],
    security: security && { ...security, events: secEvents || [] }, health, charge_gaps: gaps, price_feed: price, activity: activity || [],
  };
}

module.exports = { build };
