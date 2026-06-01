-- ============================================================
-- KnitAdvisor Database Schema v1.0
-- MySQL 5.7+ / 8.0 compatible
-- Run this FIRST on cPanel phpMyAdmin
-- ============================================================
-- (Database creation is managed via cPanel. Select your database e.g. tecnedub_knitadvisor and import this file directly)


-- ============================================================
-- 1. FABRICS — master list of all knit structures
-- ============================================================
CREATE TABLE IF NOT EXISTS fabrics (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug          VARCHAR(50) NOT NULL UNIQUE,
  name          VARCHAR(120) NOT NULL,
  name_bn       VARCHAR(120) DEFAULT NULL,
  category      ENUM('single_jersey','rib','interlock','warp_knit') NOT NULL,
  base_fabric   VARCHAR(50) DEFAULT NULL COMMENT 'slug of parent structure',

  gsm_min       SMALLINT UNSIGNED NOT NULL DEFAULT 80,
  gsm_max       SMALLINT UNSIGNED NOT NULL DEFAULT 400,
  gauge_min     TINYINT UNSIGNED NOT NULL DEFAULT 10,
  gauge_max     TINYINT UNSIGNED NOT NULL DEFAULT 36,
  typical_gauge TINYINT UNSIGNED DEFAULT NULL,

  ll_multiplier FLOAT(5,3) DEFAULT NULL COMMENT 'Loop length multiplier vs base (SJ=1.0)',
  ll_source     VARCHAR(30) DEFAULT 'ESTIMATED',

  machine_type  VARCHAR(80) DEFAULT NULL,
  is_multi_yarn TINYINT(1) NOT NULL DEFAULT 0,
  is_warp_knit  TINYINT(1) NOT NULL DEFAULT 0,

  appearance    TEXT DEFAULT NULL,
  machine_note  TEXT DEFAULT NULL,

  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  sort_order    SMALLINT NOT NULL DEFAULT 100,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_category (category),
  INDEX idx_active (is_active)
) ENGINE=InnoDB;

-- ============================================================
-- 2. FABRIC_COUNT_FORMULAS — GSM→Count regression coefficients
-- ============================================================
CREATE TABLE IF NOT EXISTS fabric_count_formulas (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fabric_id     INT UNSIGNED NOT NULL,
  formula_type  ENUM('regression','lookup','multi_yarn','denier_based') NOT NULL DEFAULT 'regression',

  coeff_a       FLOAT(8,4) DEFAULT NULL COMMENT 'slope: Count = a*GSM + b',
  coeff_b       FLOAT(8,4) DEFAULT NULL COMMENT 'intercept',
  gsm_min       SMALLINT UNSIGNED DEFAULT NULL,
  gsm_max       SMALLINT UNSIGNED DEFAULT NULL,

  source        ENUM('PDF_VERIFIED','LOOKUP_DERIVED','ESTIMATED','INDUSTRY_STANDARD') NOT NULL DEFAULT 'ESTIMATED',
  source_file   VARCHAR(150) DEFAULT NULL,
  notes         TEXT DEFAULT NULL,
  version       INT UNSIGNED NOT NULL DEFAULT 1,

  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (fabric_id) REFERENCES fabrics(id) ON DELETE CASCADE,
  INDEX idx_fabric (fabric_id),
  INDEX idx_active (is_active)
) ENGINE=InnoDB;

-- ============================================================
-- 3. FABRIC_PATTERNS — K/T/M structural notation
-- ============================================================
CREATE TABLE IF NOT EXISTS fabric_patterns (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fabric_id           INT UNSIGNED NOT NULL,
  pattern_name        VARCHAR(100) DEFAULT 'default',

  courses_per_repeat  TINYINT UNSIGNED NOT NULL DEFAULT 1,
  wales_per_repeat    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  pattern_type        ENUM('single','double','warp') NOT NULL DEFAULT 'single',

  -- JSON 2D array: [["K","T"],["T","K"]]
  pattern_cylinder    JSON NOT NULL COMMENT 'Cylinder bed K/T/M grid',
  pattern_dial        JSON DEFAULT NULL COMMENT 'Dial bed K/T/M grid (null for single bed)',

  -- Cam arrangement: [{"feed":1,"cylinder":"K","dial":"K","note":"..."}]
  cam_arrangement     JSON DEFAULT NULL,

  -- Needle arrangement description
  needle_butt_pattern VARCHAR(40) DEFAULT NULL COMMENT 'e.g. ABAB, AABB',
  needle_description  TEXT DEFAULT NULL,

  is_default          TINYINT(1) NOT NULL DEFAULT 1,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (fabric_id) REFERENCES fabrics(id) ON DELETE CASCADE,
  INDEX idx_fabric (fabric_id)
) ENGINE=InnoDB;

-- ============================================================
-- 4. YARN_COUNT_LOOKUP — GSM↔count mapping tables
--    Used for fabrics with lookup (not regression): terry, fleece, etc.
--    Also for validation cross-reference
-- ============================================================
CREATE TABLE IF NOT EXISTS yarn_count_lookup (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fabric_id       INT UNSIGNED NOT NULL,

  gsm             SMALLINT UNSIGNED DEFAULT NULL COMMENT 'exact GSM point',
  gsm_min         SMALLINT UNSIGNED DEFAULT NULL COMMENT 'range start (if range)',
  gsm_max         SMALLINT UNSIGNED DEFAULT NULL COMMENT 'range end',

  count_display   VARCHAR(50) NOT NULL COMMENT 'e.g. 30/1, 34/1+40D, 30/1+20/1',
  yarn1_ne        FLOAT(5,1) DEFAULT NULL COMMENT 'primary yarn count Ne',
  yarn2_ne        FLOAT(5,1) DEFAULT NULL COMMENT 'secondary yarn count Ne (fleece loop, terry pile)',
  binder_denier   SMALLINT UNSIGNED DEFAULT NULL COMMENT 'binder/elastane denier',

  source          VARCHAR(80) DEFAULT 'PDF_VERIFIED',

  FOREIGN KEY (fabric_id) REFERENCES fabrics(id) ON DELETE CASCADE,
  INDEX idx_fabric (fabric_id),
  INDEX idx_gsm (gsm)
) ENGINE=InnoDB;

-- ============================================================
-- 5. RESULT_CACHE — persistent calculation cache
-- ============================================================
CREATE TABLE IF NOT EXISTS result_cache (
  cache_key   CHAR(32) PRIMARY KEY COMMENT 'MD5 of normalized query',
  result_json JSON NOT NULL,
  hit_count   INT UNSIGNED NOT NULL DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_hit    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP NOT NULL,

  INDEX idx_expires (expires_at),
  INDEX idx_hits (hit_count DESC)
) ENGINE=InnoDB;

-- ============================================================
-- 6. QUERY_LOGS — every user calculation request
-- ============================================================
CREATE TABLE IF NOT EXISTS query_logs (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  input_text      VARCHAR(500) DEFAULT NULL COMMENT 'raw user input',
  input_type      ENUM('form','natural_language') NOT NULL DEFAULT 'form',

  parsed_fabric   VARCHAR(50) DEFAULT NULL,
  parsed_gsm      SMALLINT UNSIGNED DEFAULT NULL,
  parsed_dia      TINYINT UNSIGNED DEFAULT NULL,
  parsed_gauge    TINYINT UNSIGNED DEFAULT NULL,

  result_json     JSON DEFAULT NULL,
  response_ms     SMALLINT UNSIGNED DEFAULT NULL,

  from_cache      TINYINT(1) NOT NULL DEFAULT 0,
  cache_key       CHAR(32) DEFAULT NULL,

  ai_provider     VARCHAR(20) DEFAULT NULL,
  ai_tokens_used  SMALLINT UNSIGNED DEFAULT NULL,

  ip_hash         CHAR(32) DEFAULT NULL COMMENT 'MD5 of IP for privacy',
  user_agent      VARCHAR(200) DEFAULT NULL,

  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_created (created_at),
  INDEX idx_fabric (parsed_fabric),
  INDEX idx_cache (from_cache)
) ENGINE=InnoDB;

-- ============================================================
-- 7. AI_PROVIDER_STATS — provider health + token tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_provider_stats (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  provider_name   VARCHAR(20) NOT NULL UNIQUE,
  priority        TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1=highest priority',

  daily_limit     INT UNSIGNED NOT NULL DEFAULT 10000,
  per_min_limit   INT UNSIGNED NOT NULL DEFAULT 30,

  tokens_today    INT UNSIGNED NOT NULL DEFAULT 0,
  requests_today  INT UNSIGNED NOT NULL DEFAULT 0,
  failures_today  INT UNSIGNED NOT NULL DEFAULT 0,

  is_healthy      TINYINT(1) NOT NULL DEFAULT 1,
  is_enabled      TINYINT(1) NOT NULL DEFAULT 1,
  last_failure_at TIMESTAMP NULL DEFAULT NULL,
  cooldown_until  TIMESTAMP NULL DEFAULT NULL,

  api_key_env     VARCHAR(50) NOT NULL COMMENT 'env var name for API key',
  model_name      VARCHAR(60) DEFAULT NULL,
  api_url         VARCHAR(200) DEFAULT NULL,

  reset_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================================
-- 8. ADMIN_SESSIONS — simple session auth for admin panel
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_sessions (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash  CHAR(64) NOT NULL UNIQUE COMMENT 'SHA256 of session token',
  ip_address  VARCHAR(45) DEFAULT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP NOT NULL,

  INDEX idx_token (token_hash),
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB;

-- ============================================================
-- 9. FORMULA_HISTORY — audit trail for admin formula changes
-- ============================================================
CREATE TABLE IF NOT EXISTS formula_history (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fabric_id     INT UNSIGNED NOT NULL,
  field_changed VARCHAR(30) NOT NULL COMMENT 'coeff_a, coeff_b, ll_multiplier, etc',
  old_value     VARCHAR(100) DEFAULT NULL,
  new_value     VARCHAR(100) DEFAULT NULL,
  changed_by    VARCHAR(50) DEFAULT 'admin',
  changed_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (fabric_id) REFERENCES fabrics(id) ON DELETE CASCADE,
  INDEX idx_fabric (fabric_id),
  INDEX idx_changed (changed_at)
) ENGINE=InnoDB;

-- ============================================================
-- SEED: AI PROVIDERS (initial config)
-- ============================================================
INSERT INTO ai_provider_stats (provider_name, priority, daily_limit, per_min_limit, api_key_env, model_name, api_url) VALUES
('groq',    1, 14400, 30, 'GROQ_API_KEY',    'llama-3.1-70b-versatile',  'https://api.groq.com/openai/v1/chat/completions'),
('gemini',  2, 50000, 15, 'GEMINI_API_KEY',  'gemini-1.5-flash',         'https://generativelanguage.googleapis.com/v1beta/models'),
('mistral', 3, 10000, 10, 'MISTRAL_API_KEY', 'mistral-small-latest',     'https://api.mistral.ai/v1/chat/completions'),
('cohere',  4,  1000,  5, 'COHERE_API_KEY',  'command-r',                'https://api.cohere.ai/v1/chat')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;
