const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });
const { query } = require('../backend/config/database');
const providerManager = require('../backend/ai/provider-manager-v2');

async function check() {
  try {
    console.log('--- PROVIDER STATS ---');
    const stats = await query('SELECT * FROM ai_provider_stats');
    console.table(stats);

    console.log('\n--- PROVIDER MODELS ---');
    const models = await query('SELECT * FROM ai_provider_models');
    console.table(models);

    console.log('\n--- PROVIDER KEYS (Decrypted) ---');
    const keys = await query('SELECT * FROM ai_provider_keys');
    for (const key of keys) {
      let decrypted = 'FAILED TO DECRYPT';
      try {
        decrypted = providerManager.decryptApiKey(key.api_key_encrypted);
      } catch (err) {
        decrypted = `Error: ${err.message}`;
      }
      console.log(`Key ID: ${key.id}, Provider ID: ${key.provider_id}, Index: ${key.key_index}, Active: ${key.is_active}, Healthy: ${key.is_healthy}`);
      console.log(`  Encrypted: ${key.api_key_encrypted}`);
      console.log(`  Decrypted: ${decrypted}`);
    }
  } catch (err) {
    console.error('Error querying providers data:', err);
  }
  process.exit(0);
}

check();
