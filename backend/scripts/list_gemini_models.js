const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { query } = require('../config/database');
const crypto = require('crypto');
const axios = require('axios');

const ENCRYPTION_KEY = crypto.scryptSync('knitadvisor-secret', 'salt', 32);

function decryptApiKey(encrypted) {
  const [ivHex, encryptedHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function listModels() {
  try {
    const keys = await query('SELECT api_key_encrypted FROM ai_provider_keys WHERE provider_id = 2');
    if (!keys.length) {
      console.log('No Gemini key saved in database!');
      process.exit(0);
    }
    const apiKey = decryptApiKey(keys[0].api_key_encrypted);
    console.log('Using API key:', apiKey);

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    try {
      const response = await axios.get(url);
      console.log('✓ Success! Models returned by Google:');
      const models = response.data.models || [];
      console.log(models.map(m => m.name));
    } catch (err) {
      console.error('✗ Failed to list models.');
      console.error('Status:', err.response?.status);
      console.error('Error details:', JSON.stringify(err.response?.data));
    }
  } catch (err) {
    console.error('Script error:', err.message);
  }
  process.exit(0);
}

listModels();
