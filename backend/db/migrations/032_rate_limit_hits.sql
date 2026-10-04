-- ============================================================================
-- 032 — Shared rate-limit counters
--
-- The scoped limiters (login, signup, code requests, student verification,
-- AI parse, RFQ submit, search, ...) counted in process memory. Passenger runs
-- more than one worker, so a "5 per 15 minutes" limit was really 5 per worker,
-- and a restart reset every counter to zero. For abuse control and for any
-- limit that protects paid AI quota or customer-facing mail, that is not a
-- limit at all.
--
-- One row per (limiter name, client IP). Counts are incremented with a single
-- atomic UPSERT, so concurrent requests across workers cannot both read "under
-- the limit" and both be let through. The global /api ceiling stays in memory
-- on purpose — writing a row for every API request would cost more than the
-- abuse it guards against.
-- ============================================================================

CREATE TABLE rate_limit_hits (
  bucket        text NOT NULL,
  key           text NOT NULL,
  window_start  timestamptz NOT NULL DEFAULT now(),
  count         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key)
);
