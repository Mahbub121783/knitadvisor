-- ============================================================================
-- 004 — Stop storing the answer in the query log
--
-- query_logs was 15 MB for 1,519 rows. 12 MB of that was result_json: the full
-- ~30 KB engine response, copied into the log on every cache miss.
--
--   result_json total   12 MB across 734 rows   (avg 16 KB compressed)
--   input_text total   162 kB across 1,519 rows
--
-- Nothing ever read it. The column is written by logs-repo.record() and appears
-- in no SELECT anywhere in the codebase — the admin panel's JSON viewer reads
-- result_cache, not this. It was 80% of the table's size serving no query.
--
-- WHY THE ANSWER DOES NOT NEED STORING
-- ------------------------------------
-- The engine is deterministic: calculate() is synchronous, touches no network,
-- and returns the same spec for the same inputs forever. query_logs already
-- stores input_text — the complete request body — and cache_key. So the answer
-- is not lost by dropping it; it is recoverable two ways, exactly:
--
--   still cached   result_cache holds the identical payload under cache_key
--                  for 30 days
--   any age        re-run the stored inputs through the engine; determinism
--                  guarantees byte-identical output, and it costs ~1 ms
--
-- Storing a value that can be recomputed exactly, in under a millisecond, from
-- data already in the same row is the definition of redundant. It cost backup
-- size, prune time and vacuum churn on the hottest table in the schema.
--
-- The log's job is analytics — what was asked, how often, how fast, by whom.
-- It was never meant to be an archive of answers.
--
-- Retention stays 180 days (QUERY_LOG_RETENTION_DAYS); the table just gets
-- roughly five times smaller for the same history.
-- ============================================================================

-- +no-transaction

ALTER TABLE query_logs DROP COLUMN IF EXISTS result_json;

-- DROP COLUMN only marks the column dropped; the row images keep the old data
-- until each page is rewritten. VACUUM FULL rewrites the table now so the space
-- is actually returned rather than waiting for organic churn that may never
-- come for rows nobody updates.
--
-- This takes an ACCESS EXCLUSIVE lock. At this table's size that is well under
-- a second, and every write to it is already fire-and-forget with a swallowed
-- rejection, so a blocked insert costs a log line and never an answer.
VACUUM FULL query_logs;

ANALYZE query_logs;
