-- ============================================================================
-- 041 — API keys: KnitAdvisor's engines sold as an API
--
-- A customer buys API access, an admin issues a key for their account, and the
-- customer's own system calls /api/v1/... with it (Authorization: Bearer ka_live_...).
--
-- Only a SHA-256 of the key is kept (the key is 256 random bits, so a plain
-- hash is enough — nothing to brute-force); the full key is shown once, at
-- creation. The prefix is kept so the owner and the admin can tell keys apart.
--
-- A key belongs to a customer account (app_users): it acts as that account, on
-- an allow-list of engine endpoints only (never the account itself — password,
-- sessions, saved designs). Plan, monthly call limit and per-minute rate are on
-- the key, so the admin can move a customer between plans, or give one an
-- agreed figure, without touching code.
--
-- api_key_usage is the monthly quota counter (one atomic UPSERT per call, on the
-- Asia/Dhaka calendar month); api_key_daily is the per-day history the owner and
-- the admin read — written after the response, never on the request's path.
-- ============================================================================

CREATE TABLE api_keys (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  prefix         text NOT NULL,
  key_hash       text NOT NULL,
  plan           text NOT NULL DEFAULT 'beta',
  monthly_limit  integer NOT NULL CHECK (monthly_limit >= 0),
  per_min_limit  integer NOT NULL CHECK (per_min_limit >= 1),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  allowed_ips    text[],
  note           text,
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz,
  revoked_at     timestamptz
);
CREATE UNIQUE INDEX uq_api_keys_hash ON api_keys (key_hash);
CREATE INDEX idx_api_keys_user ON api_keys (user_id);

CREATE TABLE api_key_usage (
  key_id  integer NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  period  text NOT NULL,                 -- 'YYYY-MM', Asia/Dhaka
  calls   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, period)
);

CREATE TABLE api_key_daily (
  key_id    integer NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  day       date NOT NULL,               -- Asia/Dhaka
  calls     integer NOT NULL DEFAULT 0,
  errors    integer NOT NULL DEFAULT 0,  -- 4xx / 5xx answers
  PRIMARY KEY (key_id, day)
);
