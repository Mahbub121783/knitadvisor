-- ============================================================================
-- 028 — Per-user calculation history
--
-- Until now "recent calculations" lived in the browser's localStorage: six
-- entries, one device, gone when the site data is cleared. Accounts (027) make
-- a real history possible — every calculation a signed-in user runs is kept
-- with the exact inputs that produced it, so it can be re-opened, and with the
-- headline figures at the time, so the list is useful without re-running each.
--
-- params_hash makes a repeat of the same inputs one row rather than many: the
-- result page re-runs the calculation on load, and "the same spec again" is the
-- same calculation, not a new one. The row moves to the top and run_count
-- climbs instead.
--
-- summary is a snapshot, deliberately NOT recomputed on read — yarn prices
-- move, and a history that silently rewrote old figures would stop being a
-- record. Re-opening a row runs the engine fresh on the stored params.
-- ============================================================================

CREATE TABLE user_calculations (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  params_hash   text NOT NULL,
  fabric_id     text NOT NULL,
  fabric_name   text,
  gsm           numeric(7,2) NOT NULL,
  composition   text,
  params        jsonb NOT NULL,
  summary       jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_count     integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_run_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, params_hash)
);
CREATE INDEX idx_user_calculations_recent ON user_calculations (user_id, last_run_at DESC);
