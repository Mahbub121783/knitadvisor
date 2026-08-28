/**
 * Query logs and the analytics rollups built on them.
 *
 * The dashboard reads come from materialized views (mv_daily_query_stats,
 * mv_fabric_popularity) refreshed by cron, not from live aggregates over the
 * log table. The "today" bucket is Asia/Dhaka — the server clock is Mountain
 * time, so a server-local date put the day boundary near midday in Bangladesh.
 */
const { query, queryOne } = require('../client');

const BUSINESS_TZ = process.env.BUSINESS_TIMEZONE || 'Asia/Dhaka';

async function record(entry) {
  try {
    await query(
      `INSERT INTO query_logs
         (input_text, input_type, parsed_fabric, parsed_gsm, parsed_dia, parsed_gauge,
          result_json, response_ms, from_cache, cache_key, ai_provider, ai_tokens_used,
          ip_hash, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        entry.input_text ?? null,
        entry.input_type || 'form',
        entry.parsed_fabric ?? null,
        entry.parsed_gsm ?? null,
        entry.parsed_dia ?? null,
        entry.parsed_gauge ?? null,
        entry.result_json ? JSON.stringify(entry.result_json) : null,
        entry.response_ms ?? null,
        !!entry.from_cache,
        entry.cache_key ?? null,
        entry.ai_provider ?? null,
        entry.ai_tokens_used ?? null,
        entry.ip_hash ?? null,
        entry.user_agent ?? null,
      ]
    );
  } catch (err) {
    // Logging must never break the request it is describing.
    console.error('[Logs] Failed to record query:', err.message);
  }
}

/** Dashboard headline numbers for the current business day. */
async function todayStats() {
  const row = await queryOne(
    `SELECT total_queries, cache_hits, nl_queries, avg_response_ms, distinct_visitors
     FROM mv_daily_query_stats
     WHERE stat_date = (now() AT TIME ZONE $1)::date`,
    [BUSINESS_TZ]
  );
  if (!row) return { today_total: 0, cache_hit_pct: 0, avg_response_ms: 0, nl_query_count: 0, distinct_visitors: 0 };
  return {
    today_total: Number(row.total_queries),
    cache_hit_pct: row.total_queries > 0
      ? Math.round((Number(row.cache_hits) / Number(row.total_queries)) * 1000) / 10
      : 0,
    avg_response_ms: Number(row.avg_response_ms) || 0,
    nl_query_count: Number(row.nl_queries),
    distinct_visitors: Number(row.distinct_visitors),
  };
}

/** Daily series for charting. */
async function dailySeries(days = 30) {
  return query(
    `SELECT stat_date, total_queries, cache_hits, nl_queries, avg_response_ms, distinct_visitors
     FROM mv_daily_query_stats
     WHERE stat_date > (now() AT TIME ZONE $1)::date - $2::int
     ORDER BY stat_date`,
    [BUSINESS_TZ, days]
  );
}

async function topFabrics(limit = 6) {
  return query(
    `SELECT fabric, query_count, cache_hits, avg_gsm, last_queried_at
     FROM mv_fabric_popularity ORDER BY query_count DESC LIMIT $1`,
    [limit]
  );
}

/**
 * Paged log listing.
 *
 * `search` uses the generated tsvector column rather than LIKE, so the admin
 * can find "the query that mentioned viscose" instead of only filtering by an
 * exact fabric id.
 */
async function list({ page = 1, limit = 25, fabric, dateFrom, dateTo, fromCache, nlOnly, search } = {}) {
  const where = [];
  const params = [];
  const add = (clause, value) => { params.push(value); where.push(clause.replace('$?', `$${params.length}`)); };

  if (fabric)   add('parsed_fabric = $?', fabric);
  if (dateFrom) add('created_at >= $?::date', dateFrom);
  if (dateTo)   add("created_at < ($?::date + 1)", dateTo);
  if (fromCache !== undefined && fromCache !== 'all') add('from_cache = $?', fromCache === '1' || fromCache === true);
  if (nlOnly)   where.push("input_type = 'natural_language'");
  if (search)   add("input_search @@ plainto_tsquery('simple', $?)", search);

  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [{ count }] = await query(`SELECT count(*)::int AS count FROM query_logs ${clause}`, params);

  const rows = await query(
    `SELECT id, input_text, input_type, parsed_fabric, parsed_gsm, parsed_dia, parsed_gauge,
            response_ms, from_cache, cache_key, ai_provider, ai_tokens_used, created_at
     FROM query_logs ${clause}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit]
  );

  return { rows, total: count, page, pages: Math.ceil(count / limit) };
}

/** Deletes logs older than the retention window. Called by cron. */
async function prune(retentionDays = 180) {
  const rows = await query(
    'DELETE FROM query_logs WHERE created_at < now() - make_interval(days => $1) RETURNING id',
    [retentionDays]
  );
  return rows.length;
}

async function refreshAnalytics() {
  await query('SELECT refresh_analytics()');
}

module.exports = { record, todayStats, dailySeries, topFabrics, list, prune, refreshAnalytics };
