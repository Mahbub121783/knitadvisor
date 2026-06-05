const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const providerManager = require('../ai/provider-manager-v2');
const { query } = require('../config/database');

async function test() {
  try {
    const statsRows = await query('SELECT * FROM ai_provider_stats WHERE id = 2');
    console.log('Testing Gemini connection (id=2)...');
    const result = await providerManager.testProvider(statsRows[0]);
    console.log('✓ Success! Gemini test succeeded!');
    console.log('Result details:', {
      provider_used: result.provider_used,
      model_used: result.model_used,
      response_ms: result.response_ms
    });

    const updatedStats = await query('SELECT model_name, current_model_id FROM ai_provider_stats WHERE id = 2');
    console.log('Updated stats in DB:', updatedStats[0]);
  } catch (err) {
    console.error('✗ Gemini test failed:', err.message);
  }
  process.exit(0);
}

test();
