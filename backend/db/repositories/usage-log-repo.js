/**
 * The usage log and the verdicts people give on answers (migration 050). Days are Asia/Dhaka days.
 */
const { query, queryOne } = require('../client');

const tz = () => process.env.BUSINESS_TIMEZONE || 'Asia/Dhaka';
const FOLD_SECONDS = 20;
const like = (s) => '%' + String(s).replace(/[\\%_]/g, (m) => '\\' + m) + '%';

const events = {
  /**
   * Writes one request. A live tool's change within a few seconds of the last one replaces that row (steps counts
   * them); the same request again the same day counts up `runs`.
   */
  async record(e, live) {
    if (live) {
      const folded = await query(
        `UPDATE usage_events SET input_hash = $3, input = $4::jsonb, result = $5::jsonb, ok = $6, status = $7, error = $8, ms = $9, build = $10, plan = $11,
                steps = steps + 1, last_at = now()
          WHERE id = (SELECT id FROM usage_events WHERE actor = $1 AND tool = $2 AND last_at > now() - make_interval(secs => $12) ORDER BY last_at DESC LIMIT 1)
          RETURNING id`,
        [e.actor, e.tool, e.input_hash, JSON.stringify(e.input), JSON.stringify(e.result), e.ok, e.status, e.error, e.ms, e.build, e.plan, FOLD_SECONDS]
      );
      if (folded.length) return folded[0].id;
    }
    const repeat = await query(
      `UPDATE usage_events SET runs = runs + 1, last_at = now(), result = $5::jsonb, ok = $6, status = $7, error = $8, ms = $9, build = $10
        WHERE id = (SELECT id FROM usage_events WHERE actor = $1 AND tool = $2 AND input_hash = $3 AND day = (now() AT TIME ZONE $4)::date ORDER BY last_at DESC LIMIT 1)
        RETURNING id`,
      [e.actor, e.tool, e.input_hash, tz(), JSON.stringify(e.result), e.ok, e.status, e.error, e.ms, e.build]
    );
    if (repeat.length) return repeat[0].id;
    const row = await queryOne(
      `INSERT INTO usage_events (day, user_id, actor, plan, tool, input_hash, input, result, ok, status, error, ms, build)
       VALUES ((now() AT TIME ZONE $1)::date, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13) RETURNING id`,
      [tz(), e.user_id, e.actor, e.plan, e.tool, e.input_hash, JSON.stringify(e.input), JSON.stringify(e.result), e.ok, e.status, e.error, e.ms, e.build]
    );
    return row.id;
  },

  prune(days) { return query('DELETE FROM usage_events WHERE day < (now() AT TIME ZONE $1)::date - $2::int RETURNING id', [tz(), days]).then((r) => r.length); },

  async list({ from, to, tool, search, errors, userId, page = 1, limit = 50 } = {}) {
    const { where, params } = range('e', from, to);
    const add = (sql, v) => { params.push(v); where.push(sql.replace(/\$\?/g, '$' + params.length)); };
    if (tool) add('e.tool = $?', tool);
    if (userId) add('e.user_id = $?', userId);
    if (errors) where.push('NOT e.ok');
    if (search) add("(u.email ILIKE $? OR u.full_name ILIKE $? OR coalesce(u.company, '') ILIKE $? OR e.input::text ILIKE $?)", like(search));
    const clause = 'WHERE ' + where.join(' AND ');
    const pageN = Math.max(1, parseInt(page, 10) || 1), lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const total = Number((await queryOne(`SELECT count(*)::int AS count FROM usage_events e LEFT JOIN app_users u ON u.id = e.user_id ${clause}`, params)).count);
    const rows = await query(
      `SELECT e.id, e.day, e.created_at, e.last_at, e.actor, e.plan, e.tool, e.input, e.result, e.ok, e.status, e.error, e.ms, e.runs, e.steps, u.id AS user_id, u.email, u.full_name, u.company
         FROM usage_events e LEFT JOIN app_users u ON u.id = e.user_id ${clause} ORDER BY e.last_at DESC, e.id DESC LIMIT ${lim} OFFSET ${(pageN - 1) * lim}`, params);
    return { rows, total, page: pageN, pages: Math.max(1, Math.ceil(total / lim)) };
  },

  /** For the export: in id order, a page at a time, so a large day never sits in memory at once. */
  batch({ from, to, after = 0, limit = 500 }) {
    const { where, params } = range('e', from, to);
    params.push(after); where.push(`e.id > $${params.length}`);
    return query(
      `SELECT e.id, e.day, e.created_at, e.last_at, e.actor, e.plan, e.tool, e.input, e.result, e.ok, e.status, e.error, e.ms, e.runs, e.steps, e.build, u.email, u.full_name, u.company
         FROM usage_events e LEFT JOIN app_users u ON u.id = e.user_id WHERE ${where.join(' AND ')} ORDER BY e.id LIMIT ${Math.min(1000, limit)}`, params);
  },

  async overview({ from, to } = {}) {
    const r = range('e', from, to), clause = 'WHERE ' + r.where.join(' AND ');
    const [totals, tools, people, failures, answered] = await Promise.all([
      queryOne(`SELECT count(*)::int AS requests, coalesce(sum(runs + steps - 1), 0)::int AS calls, count(DISTINCT actor)::int AS people,
                       count(DISTINCT user_id)::int AS accounts, count(*) FILTER (WHERE NOT ok)::int AS failed FROM usage_events e ${clause}`, r.params),
      query(`SELECT tool, count(*)::int AS requests, count(DISTINCT actor)::int AS people, count(*) FILTER (WHERE NOT ok)::int AS failed FROM usage_events e ${clause} GROUP BY tool ORDER BY requests DESC LIMIT 40`, r.params),
      query(`SELECT u.id AS user_id, u.email, u.full_name, u.company, count(*)::int AS requests, count(DISTINCT e.tool)::int AS tools, max(e.last_at) AS last_at
               FROM usage_events e JOIN app_users u ON u.id = e.user_id ${clause} GROUP BY u.id ORDER BY requests DESC LIMIT 15`, r.params),
      query(`SELECT tool, error, status, count(*)::int AS times, count(DISTINCT actor)::int AS people FROM usage_events e ${clause} AND NOT ok GROUP BY tool, error, status ORDER BY times DESC LIMIT 15`, r.params),
      query(`SELECT coalesce(result->>'by', '—') AS by, count(*)::int AS requests FROM usage_events e ${clause} AND tool IN ('calculate', 'studio/analyse') AND ok GROUP BY 1 ORDER BY 2 DESC`, r.params),
    ]);
    return { totals, tools, people, failures, answered };
  },
};

const feedback = {
  add(f) {
    return queryOne(
      `INSERT INTO usage_feedback (day, user_id, actor, tool, verdict, input, shown, actual, note, build)
       VALUES ((now() AT TIME ZONE $1)::date, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10) RETURNING id`,
      [tz(), f.user_id, f.actor, f.tool, f.verdict, JSON.stringify(f.input), JSON.stringify(f.shown), JSON.stringify(f.actual), f.note, f.build]
    );
  },
  list({ from, to, verdict, open, limit = 200 } = {}) {
    const { where, params } = range('f', from, to);
    if (verdict) { params.push(verdict); where.push(`f.verdict = $${params.length}`); }
    if (open) where.push('NOT f.handled');
    return query(
      `SELECT f.id, f.day, f.created_at, f.actor, f.tool, f.verdict, f.input, f.shown, f.actual, f.note, f.build, f.handled, u.email, u.full_name, u.company
         FROM usage_feedback f LEFT JOIN app_users u ON u.id = f.user_id WHERE ${where.join(' AND ')} ORDER BY f.created_at DESC LIMIT ${Math.min(5000, limit)}`, params);
  },
  counts({ from, to } = {}) {
    const r = range('f', from, to);
    return queryOne(`SELECT count(*)::int AS total, count(*) FILTER (WHERE verdict = 'right')::int AS right, count(*) FILTER (WHERE verdict = 'close')::int AS close,
                            count(*) FILTER (WHERE verdict = 'wrong')::int AS wrong FROM usage_feedback f WHERE ${r.where.join(' AND ')}`, r.params);
  },
  setHandled(id, handled) { return queryOne('UPDATE usage_feedback SET handled = $2 WHERE id = $1 RETURNING id, handled', [id, !!handled]); },
};

/** WHERE parts for a range of Dhaka days; without one, today. */
function range(alias, from, to) {
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const params = [tz()];
  const today = '(now() AT TIME ZONE $1)::date';
  const f = day(from), t = day(to);
  const where = [];
  if (f) { params.push(f); where.push(`${alias}.day >= $${params.length}::date`); } else where.push(`${alias}.day >= ${today}`);
  if (t) { params.push(t); where.push(`${alias}.day <= $${params.length}::date`); } else where.push(`${alias}.day <= ${today}`);
  // $1 is only referenced when a bound is open: keep the parameter list and the text in step
  if (f && t) where.push('$1::text IS NOT NULL');
  return { where, params };
}

module.exports = { events, feedback, range, FOLD_SECONDS };
