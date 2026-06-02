/**
 * Migration v2: Advanced multi-key, multi-model AI provider system
 * Run once: node backend/scripts/migrate-providers-v2.js
 *
 * Creates:
 * - ai_provider_keys: Store multiple API keys per provider (encrypted in DB)
 * - ai_provider_models: Track health per model per provider
 * - Updated ai_provider_stats schema
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const { query } = require('../config/database');

async function run() {
  console.log('Running advanced provider migration v2...\n');

  // 1. Create ai_provider_keys table — stores encrypted API keys per provider
  console.log('[1/4] Creating ai_provider_keys table...');
  await safeCreate(`
    CREATE TABLE IF NOT EXISTS ai_provider_keys (
      id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      provider_id     INT UNSIGNED NOT NULL,
      key_index       INT UNSIGNED NOT NULL DEFAULT 1,
      api_key_encrypted VARCHAR(500) NOT NULL,
      is_active       TINYINT DEFAULT 1,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_used_at    TIMESTAMP NULL,
      failures_today  INT UNSIGNED DEFAULT 0,
      tokens_today    INT UNSIGNED DEFAULT 0,
      is_healthy      TINYINT DEFAULT 1,
      cooldown_until  TIMESTAMP NULL,
      UNIQUE KEY unique_provider_key (provider_id, key_index),
      FOREIGN KEY (provider_id) REFERENCES ai_provider_stats(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  // 2. Create ai_provider_models table — tracks health per model per provider
  console.log('[2/4] Creating ai_provider_models table...');
  await safeCreate(`
    CREATE TABLE IF NOT EXISTS ai_provider_models (
      id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      provider_id     INT UNSIGNED NOT NULL,
      model_name      VARCHAR(100) NOT NULL,
      is_active       TINYINT DEFAULT 1,
      is_healthy      TINYINT DEFAULT 1,
      avg_response_ms INT UNSIGNED DEFAULT 0,
      requests_today  INT UNSIGNED DEFAULT 0,
      failures_today  INT UNSIGNED DEFAULT 0,
      last_failure_at TIMESTAMP NULL,
      cooldown_until  TIMESTAMP NULL,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_provider_model (provider_id, model_name),
      FOREIGN KEY (provider_id) REFERENCES ai_provider_stats(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  // 3. Update ai_provider_stats table
  console.log('[3/4] Updating ai_provider_stats table...');
  await safeAlter(`ALTER TABLE ai_provider_stats ADD COLUMN api_key_source VARCHAR(20) DEFAULT 'env' COMMENT 'env|database'`);
  await safeAlter(`ALTER TABLE ai_provider_stats ADD COLUMN current_model_id INT UNSIGNED NULL COMMENT 'ID of currently active model'`);
  await safeAlter(`ALTER TABLE ai_provider_stats ADD COLUMN current_key_id INT UNSIGNED NULL COMMENT 'ID of currently active API key'`);
  await safeAlter(`ALTER TABLE ai_provider_stats ADD COLUMN model_switching_enabled TINYINT DEFAULT 1`);
  await safeAlter(`ALTER TABLE ai_provider_stats ADD COLUMN key_switching_enabled TINYINT DEFAULT 1`);

  // 4. Create ai_provider_config for global settings
  console.log('[4/4] Creating ai_provider_config table...');
  await safeCreate(`
    CREATE TABLE IF NOT EXISTS ai_provider_config (
      id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      cfg_key    VARCHAR(40) NOT NULL UNIQUE,
      cfg_value  VARCHAR(500) NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  // Insert default strategy if not exists
  await query(`
    INSERT INTO ai_provider_config (cfg_key, cfg_value)
    VALUES ('strategy', 'priority')
    ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
  `);

  console.log('\n✓ Migration v2 complete!');
  console.log('\nNext steps:');
  console.log('1. Remove API keys from .env file');
  console.log('2. Add API keys via admin panel');
  console.log('3. Update provider-manager.js to use new tables');
  console.log('4. Restart server');

  process.exit(0);
}

async function safeCreate(sql) {
  try {
    await query(sql);
    console.log('  ✓ Created/exists');
  } catch (e) {
    if (e.code === 'ER_TABLE_EXISTS_ERROR') {
      console.log('  ✓ Table already exists');
    } else {
      console.error(`  ✗ Error: ${e.message}`);
      throw e;
    }
  }
}

async function safeAlter(sql) {
  try {
    await query(sql);
    console.log(`  ✓ ${sql.substring(30, 80).trim()}`);
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME' || e.message.includes('Duplicate column')) {
      // Already exists, skip silently
    } else {
      console.error(`  ✗ Error: ${e.message}`);
    }
  }
}

run().catch(e => {
  console.error('\n✗ Migration failed:', e);
  process.exit(1);
});
