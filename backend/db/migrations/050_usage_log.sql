-- ============================================================================
-- 050 — What people ask the engines, what they are told, and whether it was right
--
-- query_logs (002/004) counts calculator requests for the dashboard and keeps no
-- answer; the engines change, so an old request re-run today does not show what
-- the person saw. To judge accuracy day by day this keeps, per request: who (the
-- account, or a hashed address for a guest), which tool, the inputs, the
-- headline of the answer given, and the build that gave it.
--
-- usage_events    one row per distinct request per person per Dhaka day; a
--                 repeat counts up `runs`. The Studio answers every change on
--                 screen, so changes seconds apart are folded into one row that
--                 holds where the person settled (steps = how many).
-- usage_feedback  the person's own verdict on an answer, with what their floor
--                 actually runs where they give it. This is the evidence the
--                 engines are corrected from.
--
-- Rows are removed after USAGE_LOG_RETENTION_DAYS (default 90: the days are downloaded as they come); an account that
-- is deleted takes its rows with it.
-- ============================================================================

CREATE TABLE usage_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day         date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_at     timestamptz NOT NULL DEFAULT now(),
  user_id     integer REFERENCES app_users(id) ON DELETE CASCADE,
  actor       text NOT NULL,                 -- 'u:<id>', 'k:<api key id>' or 'g:<hashed address>'
  plan        text,
  tool        text NOT NULL,
  input_hash  text NOT NULL,
  input       jsonb NOT NULL,
  result      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ok          boolean NOT NULL,
  status      smallint NOT NULL,
  error       text,
  ms          integer,
  runs        integer NOT NULL DEFAULT 1,
  steps       integer NOT NULL DEFAULT 1,
  build       text
);
CREATE INDEX idx_usage_events_day ON usage_events (day DESC, id DESC);
CREATE INDEX idx_usage_events_actor ON usage_events (actor, tool, last_at DESC);
CREATE INDEX idx_usage_events_user ON usage_events (user_id, last_at DESC);

CREATE TABLE usage_feedback (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day         date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  user_id     integer REFERENCES app_users(id) ON DELETE CASCADE,
  actor       text NOT NULL,
  tool        text NOT NULL,
  verdict     text NOT NULL CHECK (verdict IN ('right', 'close', 'wrong')),
  input       jsonb NOT NULL,
  shown       jsonb NOT NULL DEFAULT '{}'::jsonb,
  actual      jsonb NOT NULL DEFAULT '{}'::jsonb,
  note        text,
  build       text,
  handled     boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_usage_feedback_day ON usage_feedback (day DESC, id DESC);
