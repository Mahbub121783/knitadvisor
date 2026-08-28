-- ============================================================================
-- 002 — Analytics rollup
--
-- The admin dashboard ran COUNT(*), AVG() and SUM(CASE...) across query_logs on
-- every page load, and the "top fabrics" panel pulled 100 raw log rows to the
-- browser and counted them in JavaScript. That is fine at a thousand rows and
-- quietly becomes the slowest thing on the page as logs accumulate.
--
-- The rollup is a materialized view refreshed by cron rather than a live view,
-- because the dashboard does not need second-accuracy and the whole point is to
-- keep the read off the hot table.
--
-- Timezone note: "today" for this business is Asia/Dhaka, not the server's
-- Mountain time. Bucketing by the server's local date put the day boundary at
-- roughly noon Bangladesh time.
-- ============================================================================

CREATE MATERIALIZED VIEW mv_daily_query_stats AS
SELECT
  (created_at AT TIME ZONE 'Asia/Dhaka')::date              AS stat_date,
  count(*)                                                  AS total_queries,
  count(*) FILTER (WHERE from_cache)                        AS cache_hits,
  count(*) FILTER (WHERE input_type = 'natural_language')   AS nl_queries,
  round(avg(response_ms) FILTER (WHERE NOT from_cache))     AS avg_compute_ms,
  round(avg(response_ms))                                   AS avg_response_ms,
  count(DISTINCT ip_hash)                                   AS distinct_visitors,
  sum(coalesce(ai_tokens_used, 0))                          AS ai_tokens_used
FROM query_logs
GROUP BY 1;

-- REFRESH CONCURRENTLY needs a unique index and avoids taking an exclusive
-- lock, so the dashboard keeps reading while cron refreshes.
CREATE UNIQUE INDEX mv_daily_query_stats_date_idx ON mv_daily_query_stats (stat_date);

CREATE MATERIALIZED VIEW mv_fabric_popularity AS
SELECT
  parsed_fabric                                             AS fabric,
  count(*)                                                  AS query_count,
  count(*) FILTER (WHERE from_cache)                        AS cache_hits,
  round(avg(parsed_gsm))                                    AS avg_gsm,
  max(created_at)                                           AS last_queried_at
FROM query_logs
WHERE parsed_fabric IS NOT NULL
GROUP BY 1;

CREATE UNIQUE INDEX mv_fabric_popularity_fabric_idx ON mv_fabric_popularity (fabric);

-- Called by the refresh-analytics cron job. Wrapped in a function so the job
-- stays a single call and the CONCURRENTLY detail lives with the schema.
CREATE OR REPLACE FUNCTION refresh_analytics() RETURNS void AS $fn$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_query_stats;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fabric_popularity;
END;
$fn$ LANGUAGE plpgsql;
