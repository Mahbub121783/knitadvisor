-- ============================================================================
-- 001 — Initial PostgreSQL schema
--
-- Ported from the MySQL schema, not transcribed from it. Differences that
-- matter, and why:
--
--   * timestamptz everywhere. MySQL's TIMESTAMP stored naive local time, and
--     the server runs in MDT while the business runs in Bangladesh, so every
--     "today" comparison was silently off by twelve hours.
--   * JSONB for the payload columns. They were LONGTEXT holding JSON, so the
--     database could not validate them and nothing could query inside them.
--   * Real foreign keys. The AI provider tables referenced each other by id
--     with nothing enforcing it, so deleting a provider orphaned its keys and
--     models and left the app reading rows that pointed at nothing.
--   * CHECK constraints for the invariants the code already assumed.
--   * Five tables are deliberately NOT carried over — fabrics,
--     fabric_count_formulas, fabric_patterns, formula_history and
--     yarn_count_lookup. Nothing queries them; the engine's fabric data lives
--     in backend/engine/*.js. They were dead weight in every backup.
-- ============================================================================

-- ── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE query_input_type AS ENUM ('form', 'natural_language');
CREATE TYPE viz_sheen_model  AS ENUM ('matte', 'gradient', 'high_sheen');

-- ── updated_at trigger ──────────────────────────────────────────────────────
-- Postgres has no ON UPDATE CURRENT_TIMESTAMP, so the behaviour the MySQL
-- schema relied on becomes an explicit trigger.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

-- ── Admin ───────────────────────────────────────────────────────────────────
CREATE TABLE admin_users (
  id            integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  username      varchar(50)  NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  -- Rejects the bare 64-hex unsalted SHA-256 the old scheme wrote, so the
  -- legacy format cannot be reintroduced by a stray script.
  CONSTRAINT admin_users_hash_is_salted CHECK (password_hash !~ '^[0-9a-f]{64}$')
);
CREATE TRIGGER admin_users_updated_at BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE admin_sessions (
  id         bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  token_hash char(64)    NOT NULL UNIQUE,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX admin_sessions_expires_at_idx ON admin_sessions (expires_at);

-- ── AI providers ────────────────────────────────────────────────────────────
CREATE TABLE ai_provider_stats (
  id                      integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  provider_name           varchar(20) NOT NULL UNIQUE,
  display_name            varchar(60),
  provider_type           varchar(20),
  priority                smallint    NOT NULL DEFAULT 1,
  -- daily_limit counts REQUESTS per day. It used to be compared against a
  -- token counter, which excluded providers after ~30 calls instead of
  -- thousands; the comment below pins the unit down so it stays that way.
  daily_limit             integer     NOT NULL DEFAULT 10000,
  per_min_limit           integer     NOT NULL DEFAULT 30,
  tokens_today            bigint      NOT NULL DEFAULT 0,
  requests_today          integer     NOT NULL DEFAULT 0,
  failures_today          integer     NOT NULL DEFAULT 0,
  is_healthy              boolean     NOT NULL DEFAULT true,
  is_enabled              boolean     NOT NULL DEFAULT true,
  last_failure_at         timestamptz,
  cooldown_until          timestamptz,
  api_key_env             varchar(50) NOT NULL,
  api_key_source          varchar(20) NOT NULL DEFAULT 'env',
  model_name              varchar(60),
  api_url                 varchar(200),
  current_model_id        integer,
  current_key_id          integer,
  model_switching_enabled boolean     NOT NULL DEFAULT true,
  key_switching_enabled   boolean     NOT NULL DEFAULT true,
  reset_at                timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_provider_priority_positive CHECK (priority > 0),
  CONSTRAINT ai_provider_limits_positive   CHECK (daily_limit > 0 AND per_min_limit > 0),
  CONSTRAINT ai_provider_counters_nonneg   CHECK (tokens_today >= 0 AND requests_today >= 0 AND failures_today >= 0)
);
COMMENT ON COLUMN ai_provider_stats.daily_limit IS
  'Requests permitted per day (NOT tokens). Compared against requests_today.';
CREATE INDEX ai_provider_stats_priority_idx ON ai_provider_stats (priority) WHERE is_enabled;
CREATE TRIGGER ai_provider_stats_updated_at BEFORE UPDATE ON ai_provider_stats
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ai_provider_keys (
  id                integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  provider_id       integer      NOT NULL REFERENCES ai_provider_stats(id) ON DELETE CASCADE,
  key_index         integer      NOT NULL DEFAULT 1,
  api_key_encrypted varchar(500) NOT NULL,
  is_active         boolean      NOT NULL DEFAULT true,
  is_healthy        boolean      NOT NULL DEFAULT true,
  failures_today    integer      NOT NULL DEFAULT 0,
  tokens_today      bigint       NOT NULL DEFAULT 0,
  last_used_at      timestamptz,
  cooldown_until    timestamptz,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ai_provider_keys_unique_index UNIQUE (provider_id, key_index),
  -- Stored form is ivHex:cipherHex. A value without the separator is a
  -- plaintext key that escaped encryption; refuse to store it.
  CONSTRAINT ai_provider_keys_encrypted_shape CHECK (api_key_encrypted LIKE '%:%')
);
CREATE INDEX ai_provider_keys_provider_idx ON ai_provider_keys (provider_id, key_index) WHERE is_active;

CREATE TABLE ai_provider_models (
  id              integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  provider_id     integer      NOT NULL REFERENCES ai_provider_stats(id) ON DELETE CASCADE,
  model_name      varchar(100) NOT NULL,
  is_active       boolean      NOT NULL DEFAULT true,
  is_healthy      boolean      NOT NULL DEFAULT true,
  avg_response_ms integer      NOT NULL DEFAULT 0,
  requests_today  integer      NOT NULL DEFAULT 0,
  failures_today  integer      NOT NULL DEFAULT 0,
  last_failure_at timestamptz,
  cooldown_until  timestamptz,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ai_provider_models_unique UNIQUE (provider_id, model_name)
);
CREATE INDEX ai_provider_models_provider_idx ON ai_provider_models (provider_id) WHERE is_active;

-- The self-references are added after both tables exist. ON DELETE SET NULL,
-- not CASCADE: losing the "currently selected model" must not delete the
-- provider row itself.
ALTER TABLE ai_provider_stats
  ADD CONSTRAINT ai_provider_stats_current_model_fk
    FOREIGN KEY (current_model_id) REFERENCES ai_provider_models(id) ON DELETE SET NULL,
  ADD CONSTRAINT ai_provider_stats_current_key_fk
    FOREIGN KEY (current_key_id)   REFERENCES ai_provider_keys(id)   ON DELETE SET NULL;

CREATE TABLE ai_provider_config (
  cfg_key    varchar(40)  PRIMARY KEY,
  cfg_value  varchar(500) NOT NULL,
  updated_at timestamptz  NOT NULL DEFAULT now()
);
CREATE TRIGGER ai_provider_config_updated_at BEFORE UPDATE ON ai_provider_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ai_provider_meta (
  meta_key   varchar(32) PRIMARY KEY,
  meta_value varchar(32) NOT NULL
);

-- ── Caches ──────────────────────────────────────────────────────────────────
CREATE TABLE result_cache (
  cache_key   char(32)    PRIMARY KEY,
  result_json jsonb       NOT NULL,
  hit_count   integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_hit    timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  CONSTRAINT result_cache_hit_count_nonneg CHECK (hit_count >= 0)
);
CREATE INDEX result_cache_expires_at_idx ON result_cache (expires_at);

CREATE TABLE viz_render_cache (
  id         integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  cache_key  varchar(64) NOT NULL UNIQUE,
  fabric_id  varchar(64) NOT NULL,
  path_json  jsonb       NOT NULL,
  render_ms  integer,
  hit_count  integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_hit   timestamptz,
  expires_at timestamptz NOT NULL
);
CREATE INDEX viz_render_cache_expires_at_idx ON viz_render_cache (expires_at);
CREATE INDEX viz_render_cache_fabric_idx     ON viz_render_cache (fabric_id);

-- ── Visualization config ────────────────────────────────────────────────────
CREATE TABLE viz_configs (
  id                integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  fabric_id         varchar(64)     NOT NULL UNIQUE,
  fabric_category   varchar(32)     NOT NULL,
  machine_type      varchar(32)     NOT NULL,
  sheen_model       viz_sheen_model NOT NULL DEFAULT 'matte',
  loop_head_ratio   numeric(4,3)    NOT NULL DEFAULT 0.300,
  loop_height_ratio numeric(4,3)    NOT NULL DEFAULT 0.950,
  foot_splay_ratio  numeric(4,3)    NOT NULL DEFAULT 0.200,
  layer_count       smallint        NOT NULL DEFAULT 2,
  bar_colors        jsonb,
  animate_default   boolean         NOT NULL DEFAULT false,
  created_at        timestamptz     NOT NULL DEFAULT now(),
  updated_at        timestamptz     NOT NULL DEFAULT now(),
  -- These are geometry ratios the renderer multiplies into loop dimensions.
  -- A value outside (0,2] produced silently broken meshes rather than an error.
  CONSTRAINT viz_configs_ratios_sane CHECK (
    loop_head_ratio   > 0 AND loop_head_ratio   <= 2 AND
    loop_height_ratio > 0 AND loop_height_ratio <= 2 AND
    foot_splay_ratio  > 0 AND foot_splay_ratio  <= 2
  ),
  CONSTRAINT viz_configs_layer_count_sane CHECK (layer_count BETWEEN 1 AND 8)
);
CREATE TRIGGER viz_configs_updated_at BEFORE UPDATE ON viz_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Query logs ──────────────────────────────────────────────────────────────
CREATE TABLE query_logs (
  id             bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  input_text     varchar(500),
  input_type     query_input_type NOT NULL DEFAULT 'form',
  parsed_fabric  varchar(50),
  parsed_gsm     integer,
  parsed_dia     smallint,
  parsed_gauge   smallint,
  result_json    jsonb,
  response_ms    integer,
  from_cache     boolean     NOT NULL DEFAULT false,
  cache_key      char(32),
  ai_provider    varchar(20),
  ai_tokens_used integer,
  ip_hash        char(32),
  user_agent     varchar(200),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT query_logs_gsm_sane CHECK (parsed_gsm IS NULL OR parsed_gsm BETWEEN 0 AND 20000)
);
CREATE INDEX query_logs_created_at_idx ON query_logs (created_at DESC);
CREATE INDEX query_logs_fabric_idx     ON query_logs (parsed_fabric, created_at DESC);
CREATE INDEX query_logs_cache_key_idx  ON query_logs (cache_key);

-- Full-text search over the raw request text, so the admin log filter can do
-- more than an exact fabric match. tsvector/tsquery are core Postgres — this
-- host has no contrib extensions available, so pg_trgm fuzzy matching is not
-- an option, but FTS covers the "find the query that mentioned viscose" case.
ALTER TABLE query_logs
  ADD COLUMN input_search tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(input_text, ''))) STORED;
CREATE INDEX query_logs_input_search_idx ON query_logs USING gin (input_search);
