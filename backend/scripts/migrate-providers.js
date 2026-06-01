/**
 * Migration: extend ai_provider_stats for multi-instance + strategy support
 * Run once: node backend/scripts/migrate-providers.js
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const { query } = require('../config/database');

async function run() {
  console.log('Running provider schema migration...');

  // 1. Add display_name column if missing
  await safeAlter(`ALTER TABLE ai_provider_stats ADD COLUMN display_name VARCHAR(60) DEFAULT NULL AFTER provider_name`);

  // 2. Add provider_type column (the actual API type: groq/gemini/mistral/cohere/openai)
  await safeAlter(`ALTER TABLE ai_provider_stats ADD COLUMN provider_type VARCHAR(20) DEFAULT NULL AFTER display_name`);

  // 3. Add avg_response_ms column
  await safeAlter(`ALTER TABLE ai_provider_stats ADD COLUMN avg_response_ms INT UNSIGNED NOT NULL DEFAULT 0`);

  // 4. Remove UNIQUE constraint on provider_name so multiple instances are allowed
  // First check if unique index exists
  const indexes = await query(`SHOW INDEX FROM ai_provider_stats WHERE Key_name != 'PRIMARY'`);
  const uniqueIdx = indexes.find(i => i.Column_name === 'provider_name' && i.Non_unique === 0);
  if (uniqueIdx) {
    await query(`ALTER TABLE ai_provider_stats DROP INDEX ${uniqueIdx.Key_name}`);
    console.log(`  Dropped UNIQUE index: ${uniqueIdx.Key_name}`);
  }

  // 5. Create ai_provider_config table for global strategy setting
  await query(`
    CREATE TABLE IF NOT EXISTS ai_provider_config (
      id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      cfg_key    VARCHAR(40) NOT NULL UNIQUE,
      cfg_value  VARCHAR(100) NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
  console.log('  ai_provider_config table ready');

  // Insert default strategy
  await query(`
    INSERT INTO ai_provider_config (cfg_key, cfg_value)
    VALUES ('strategy', 'priority')
    ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
  `);

  // 6. Backfill provider_type from provider_name for existing rows
  await query(`UPDATE ai_provider_stats SET provider_type = provider_name WHERE provider_type IS NULL`);
  // Backfill display_name
  await query(`UPDATE ai_provider_stats SET display_name = UPPER(provider_name) WHERE display_name IS NULL`);

  console.log('Migration complete.');
  process.exit(0);
}

async function safeAlter(sql) {
  try {
    await query(sql);
    console.log(`  OK: ${sql.substring(0, 60)}...`);
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME' || e.message.includes('Duplicate column')) {
      console.log(`  SKIP (already exists): ${sql.substring(40, 80)}`);
    } else {
      console.error(`  FAIL: ${e.message}`);
    }
  }
}

run().catch(e => { console.error(e); process.exit(1); });
