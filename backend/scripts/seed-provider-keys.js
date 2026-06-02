/**
 * Seed script: Migrate existing API keys from .env to database
 * Run once after migrate-providers-v2.js
 * Usage: node backend/scripts/seed-provider-keys.js
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const crypto = require('crypto');
const { query: dbQuery } = require('../config/database');

const ENCRYPTION_KEY = crypto.scryptSync(process.env.DB_PASS || 'knitadvisor-secret', 'salt', 32);

function encryptApiKey(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

const ENV_KEYS = {
  'groq': process.env.GROQ_API_KEY,
  'gemini': process.env.GEMINI_API_KEY,
  'mistral': process.env.MISTRAL_API_KEY,
  'cohere': process.env.COHERE_API_KEY,
  'openai': process.env.OPENAI_API_KEY,
};

const DEFAULT_MODELS = {
  'groq': ['llama-3.3-70b-versatile', 'llama-2-70b-chat'],
  'gemini': ['gemini-1.5-flash', 'gemini-1.5-pro'],
  'mistral': ['mistral-small-latest', 'mistral-large-latest'],
  'cohere': ['command-r', 'command-r-plus'],
  'openai': ['gpt-4o-mini', 'gpt-4-turbo'],
};

async function run() {
  console.log('Seeding provider API keys and models...\n');

  // Get existing providers
  const providers = await dbQuery('SELECT id, provider_type FROM ai_provider_stats');

  for (const provider of providers) {
    const providerType = provider.provider_type;
    const apiKey = ENV_KEYS[providerType];

    if (apiKey) {
      // Add API key
      const encrypted = encryptApiKey(apiKey);
      await dbQuery(
        'INSERT INTO ai_provider_keys (provider_id, key_index, api_key_encrypted, is_active, is_healthy) VALUES (?, 1, ?, 1, 1)',
        [provider.id, encrypted]
      );
      console.log(`✓ Added API key for ${providerType}`);
    }

    // Add default models
    const models = DEFAULT_MODELS[providerType] || [];
    for (const modelName of models) {
      await dbQuery(
        'INSERT INTO ai_provider_models (provider_id, model_name, is_active, is_healthy) VALUES (?, ?, 1, 1) ON DUPLICATE KEY UPDATE is_active = 1',
        [provider.id, modelName]
      );
      console.log(`  → Model: ${modelName}`);
    }
  }

  console.log('\n✓ Seed complete!');
  console.log('\nVerify in database:');
  console.log('  SELECT * FROM ai_provider_keys;');
  console.log('  SELECT * FROM ai_provider_models;');
  process.exit(0);
}

run().catch(e => {
  console.error('Seed failed:', e);
  process.exit(1);
});
