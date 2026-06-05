const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { query } = require('../config/database');

async function update() {
  try {
    console.log('Inserting modern Gemini models into ai_provider_models...');
    const result = await query(
      `INSERT INTO ai_provider_models (provider_id, model_name, is_active, is_healthy) 
       VALUES 
         (2, 'gemini-2.0-flash', 1, 1),
         (2, 'gemini-2.5-flash', 1, 1),
         (2, 'gemini-flash-latest', 1, 1)
       ON DUPLICATE KEY UPDATE is_active = 1, is_healthy = 1`
    );
    console.log('✓ Successfully inserted/updated Gemini models in DB!', result);

    console.log('\nFetching current Gemini models from DB:');
    const rows = await query('SELECT * FROM ai_provider_models WHERE provider_id = 2');
    console.table(rows);
  } catch (err) {
    console.error('Update failed:', err.message);
  }
  process.exit(0);
}

update();
