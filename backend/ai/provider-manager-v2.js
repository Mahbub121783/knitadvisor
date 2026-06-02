/**
 * Advanced AI Provider Manager v2
 *
 * Features:
 * - Multiple API keys per provider (fallback across 5 keys before switching providers)
 * - Multiple models per provider (intelligent model switching)
 * - Per-model health tracking with cooldown
 * - Model sticky behavior: once a model works, keep using it until failure
 * - Database-driven configuration (NO env vars for API keys)
 * - Strategies: priority | round_robin | weighted | fastest
 */
const Groq = require('groq-sdk');
const axios = require('axios');
const crypto = require('crypto');
const { query: dbQuery } = require('../config/database');

const SYSTEM_PROMPT = `You are an expert knitting assistant for KnitAdvisor.
Your task is to parse a user's natural language request (in Bengali, English, or Banglish) and extract the required parameters for fabric calculation.

Available fabric types:
single_jersey, heavy_jersey, auto_stripe_sj, slub_sj
terry_fabric, fleece
rib_1x1, rib_2x1, rib_2x2, rib_flat_knit
interlock
pique, polo_pique, lacoste
waffle
design_jersey, knit_eyelet, pointelle
mesh_fabric
collar_cuff
tricot_plain, tricot_satin, raschel_lace, powernet, spacer_fabric

Rules for extraction:
1. "gsm": target fabric weight in g/m2 (number). Usually 100-500.
2. "fabric": map the user's requested fabric to one of the exact types above.
3. "dia": machine diameter in inches (number).
4. "gauge": machine gauge (number).
5. "rpm": machine rpm (number).
6. "composition": Extract fiber composition percentages if mentioned.
7. "buyer": Extract buyer brand if mentioned.

Output format MUST be valid JSON only, with no markdown formatting or extra text.
Example output:
{
  "fabric": "terry_fabric",
  "gsm": 200,
  "dia": 30,
  "gauge": 20,
  "composition": "50% Cotton 50% Polyester",
  "buyer": "H&M",
  "confidence": "high",
  "message": "Parameters extracted successfully."
}

If you cannot determine at least the GSM and fabric type, set "confidence" to "low" and explain in "message".`;

const PROVIDER_DEFAULTS = {
  groq:    { daily_limit: 14400, per_min_limit: 30, api_url: 'https://api.groq.com/openai/v1/chat/completions' },
  gemini:  { daily_limit: 50000, per_min_limit: 15, api_url: 'https://generativelanguage.googleapis.com/v1beta/models' },
  mistral: { daily_limit: 10000, per_min_limit: 10, api_url: 'https://api.mistral.ai/v1/chat/completions' },
  cohere:  { daily_limit:  1000, per_min_limit:  5, api_url: 'https://api.cohere.ai/v1/chat' },
  openai:  { daily_limit: 10000, per_min_limit: 60, api_url: 'https://api.openai.com/v1/chat/completions' },
};

let rrCursor = 0;

// ── AES-256 encryption/decryption for API keys ────────────────────────────────
const ENCRYPTION_KEY = crypto.scryptSync('knitadvisor-secret', 'salt', 32);

function encryptApiKey(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptApiKey(encrypted) {
  const [ivHex, encryptedHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── Core getters ──────────────────────────────────────────────────────────────
async function getProviders() {
  return dbQuery('SELECT * FROM ai_provider_stats ORDER BY priority ASC');
}

async function getProviderKeys(providerId) {
  return dbQuery('SELECT id, api_key_encrypted, key_index, is_active, is_healthy, cooldown_until FROM ai_provider_keys WHERE provider_id = ? AND is_active = 1 ORDER BY key_index ASC', [providerId]);
}

async function getProviderModels(providerId, currentModelId) {
  // Self-healing check: Ensure the model_name from ai_provider_stats exists in ai_provider_models
  try {
    const stats = await dbQuery('SELECT model_name FROM ai_provider_stats WHERE id = ?', [providerId]);
    if (stats.length && stats[0].model_name) {
      const mainModel = stats[0].model_name.trim();
      if (mainModel) {
        await dbQuery(
          'INSERT IGNORE INTO ai_provider_models (provider_id, model_name, is_active, is_healthy) VALUES (?, ?, 1, 1)',
          [providerId, mainModel]
        );
      }
    }
  } catch (err) {
    console.error('[getProviderModels self-healing error]', err.message);
  }

  if (currentModelId) {
    return dbQuery(
      `SELECT id, model_name, is_active, is_healthy, avg_response_ms, cooldown_until 
       FROM ai_provider_models 
       WHERE provider_id = ? AND is_active = 1 
       ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END ASC, is_healthy DESC, avg_response_ms ASC`,
      [providerId, currentModelId]
    );
  }
  return dbQuery(
    `SELECT id, model_name, is_active, is_healthy, avg_response_ms, cooldown_until 
     FROM ai_provider_models 
     WHERE provider_id = ? AND is_active = 1 
     ORDER BY is_healthy DESC, avg_response_ms ASC`,
    [providerId]
  );
}

async function getStrategy() {
  try {
    const rows = await dbQuery("SELECT cfg_value FROM ai_provider_config WHERE cfg_key = 'strategy'");
    return rows[0]?.cfg_value || 'priority';
  } catch {
    return 'priority';
  }
}

// ── Availability checks ───────────────────────────────────────────────────────
function isProviderAvailable(provider) {
  if (!provider.is_enabled) return false;
  if (provider.tokens_today >= provider.daily_limit) return false;
  if (provider.cooldown_until && new Date(provider.cooldown_until) > new Date()) return false;
  return true;
}

function isKeyHealthy(key) {
  if (!key.is_active) return false;
  if (!key.is_healthy) {
    if (key.cooldown_until && new Date(key.cooldown_until) > new Date()) return false;
    // Cooldown expired, reset health
    return true;
  }
  return true;
}

function isModelHealthy(model) {
  if (!model.is_active) return false;
  if (!model.is_healthy) {
    if (model.cooldown_until && new Date(model.cooldown_until) > new Date()) return false;
    // Cooldown expired, reset health
    return true;
  }
  return true;
}

// ── Strategy-based provider ordering ──────────────────────────────────────────
function orderProviders(providers, strategy) {
  const eligible = providers.filter(p => isProviderAvailable(p));

  if (!eligible.length) {
    return providers.filter(p => p.is_enabled);
  }

  if (strategy === 'round_robin') {
    if (rrCursor >= eligible.length) rrCursor = 0;
    const rotated = [...eligible.slice(rrCursor), ...eligible.slice(0, rrCursor)];
    rrCursor = (rrCursor + 1) % eligible.length;
    return rotated;
  }

  if (strategy === 'fastest') {
    return [...eligible].sort((a, b) => {
      const aMs = a.avg_response_ms || 99999;
      const bMs = b.avg_response_ms || 99999;
      return aMs - bMs;
    });
  }

  if (strategy === 'weighted') {
    return [...eligible].sort((a, b) => {
      const aRate = a.failures_today / Math.max(a.requests_today, 1);
      const bRate = b.failures_today / Math.max(b.requests_today, 1);
      if (Math.abs(aRate - bRate) > 0.01) return aRate - bRate;
      return a.priority - b.priority;
    });
  }

  // Default: priority order
  return [...eligible].sort((a, b) => a.priority - b.priority);
}

// ── Main parse() function ─────────────────────────────────────────────────────
async function parse(text) {
  const [providers, strategy] = await Promise.all([getProviders(), getStrategy()]);

  const ordered = orderProviders(providers, strategy);

  for (const provider of ordered) {
    // Get all API keys for this provider
    const keys = await getProviderKeys(provider.id);
    if (!keys.length) {
      console.error(`[Provider ${provider.provider_name}] No API keys configured`);
      continue;
    }

    // Try each API key for this provider
    for (const key of keys) {
      // Get all models for this provider (prioritizes current active model)
      const models = await getProviderModels(provider.id, provider.current_model_id);
      if (!models.length) {
        console.error(`[Provider ${provider.provider_name}] No models configured`);
        continue;
      }

      // Try each model for this key
      for (const model of models) {
        try {
          const decryptedKey = decryptApiKey(key.api_key_encrypted);
          const t0 = Date.now();

          const result = await callProvider(provider, model, decryptedKey, text);
          const ms = Date.now() - t0;

          // Success! Update stats
          const newAvg = model.avg_response_ms
            ? Math.round((model.avg_response_ms * 0.8) + (ms * 0.2))
            : ms;

          await Promise.all([
            // Update provider stats
            dbQuery(
              `UPDATE ai_provider_stats
               SET tokens_today = tokens_today + ?,
                   requests_today = requests_today + 1,
                   current_key_id = ?,
                   current_model_id = ?
               WHERE id = ?`,
              [result.tokens_used, key.id, model.id, provider.id]
            ),
            // Update key stats
            dbQuery(
              `UPDATE ai_provider_keys
               SET tokens_today = tokens_today + ?,
                   failures_today = 0,
                   is_healthy = 1,
                   cooldown_until = NULL,
                   last_used_at = NOW()
               WHERE id = ?`,
              [result.tokens_used, key.id]
            ),
            // Update model stats
            dbQuery(
              `UPDATE ai_provider_models
               SET requests_today = requests_today + 1,
                   failures_today = 0,
                   is_healthy = 1,
                   cooldown_until = NULL,
                   avg_response_ms = ?
               WHERE id = ?`,
              [newAvg, model.id]
            ),
          ]);

          return {
            ...result.parsed,
            provider_used: provider.provider_name,
            provider_display: provider.display_name || provider.provider_name.toUpperCase(),
            model_used: model.model_name,
            key_index: key.key_index,
            tokens_used: result.tokens_used,
            response_ms: ms
          };
        } catch (modelError) {
          console.error(`[${provider.provider_name}/${model.model_name}/key${key.key_index}]`, modelError.message);

          // Model failed — mark model unhealthy for 5 min, try next model
          const cooldownUntil = new Date(Date.now() + 5 * 60 * 1000);
          await dbQuery(
            `UPDATE ai_provider_models
             SET failures_today = failures_today + 1,
                 is_healthy = 0,
                 last_failure_at = NOW(),
                 cooldown_until = ?
             WHERE id = ?`,
            [cooldownUntil, model.id]
          );
          // Continue to next model
        }
      }

      // All models failed for this key — mark key unhealthy, try next key
      const cooldownUntil = new Date(Date.now() + 5 * 60 * 1000);
      await dbQuery(
        `UPDATE ai_provider_keys
         SET failures_today = failures_today + 1,
             is_healthy = 0,
             cooldown_until = ?
         WHERE id = ?`,
        [cooldownUntil, key.id]
      );
    }

    // All keys failed for this provider — mark provider unhealthy, try next provider
    const cooldownUntil = new Date(Date.now() + 5 * 60 * 1000);
    await dbQuery(
      `UPDATE ai_provider_stats
       SET failures_today = failures_today + 1,
           is_healthy = 0,
           last_failure_at = NOW(),
           cooldown_until = ?
       WHERE id = ?`,
      [cooldownUntil, provider.id]
    );
  }

  throw new Error('All AI providers, keys, and models exhausted');
}

// ── Call provider with API key and model ──────────────────────────────────────
async function callProvider(provider, model, apiKey, text) {
  const type = provider.provider_type || provider.provider_name;

  if (type === 'groq')    return callGroq(text, apiKey, model.model_name);
  if (type === 'gemini')  return callGemini(text, apiKey, model.model_name, provider.api_url);
  if (type === 'mistral') return callMistral(text, apiKey, model.model_name, provider.api_url);
  if (type === 'cohere')  return callCohere(text, apiKey, model.model_name, provider.api_url);
  if (type === 'openai')  return callOpenAI(text, apiKey, model.model_name, provider.api_url);

  throw new Error(`Unknown provider type: ${type}`);
}

// ── Provider-specific callers ─────────────────────────────────────────────────
async function callGroq(text, apiKey, modelName) {
  const groq = new Groq({ apiKey });
  const response = await groq.chat.completions.create({
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: text }],
    model: modelName,
    temperature: 0.1,
    response_format: { type: 'json_object' }
  });
  const content = response.choices[0].message.content;
  return { parsed: JSON.parse(content), tokens_used: response.usage?.total_tokens || 100 };
}

async function callGemini(text, apiKey, modelName, apiUrl) {
  const url = `${apiUrl}/${modelName}:generateContent?key=${apiKey}`;
  const response = await axios.post(url, {
    contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${text}` }] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
  });
  const content = response.data.candidates[0].content.parts[0].text;
  return { parsed: JSON.parse(content), tokens_used: response.data.usageMetadata?.totalTokenCount || 100 };
}

async function callMistral(text, apiKey, modelName, apiUrl) {
  const response = await axios.post(apiUrl, {
    model: modelName,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: text }],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  }, { headers: { Authorization: `Bearer ${apiKey}` } });
  const content = response.data.choices[0].message.content;
  return { parsed: JSON.parse(content), tokens_used: response.data.usage?.total_tokens || 100 };
}

async function callCohere(text, apiKey, modelName, apiUrl) {
  const response = await axios.post(apiUrl, {
    model: modelName,
    message: text,
    preamble: SYSTEM_PROMPT
  }, { headers: { Authorization: `Bearer ${apiKey}` } });
  const content = response.data.text;
  return { parsed: JSON.parse(content), tokens_used: response.data.meta?.tokens?.output_tokens || 100 };
}

async function callOpenAI(text, apiKey, modelName, apiUrl) {
  const response = await axios.post(apiUrl, {
    model: modelName,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: text }],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  }, { headers: { Authorization: `Bearer ${apiKey}` } });
  const content = response.data.choices[0].message.content;
  return { parsed: JSON.parse(content), tokens_used: response.data.usage?.total_tokens || 100 };
}

// ── Admin functions ───────────────────────────────────────────────────────────
async function addApiKey(providerId, apiKeyPlaintext, keyIndex) {
  const encrypted = encryptApiKey(apiKeyPlaintext);
  await dbQuery(
    'INSERT INTO ai_provider_keys (provider_id, key_index, api_key_encrypted, is_active) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE api_key_encrypted = ?',
    [providerId, keyIndex || 1, encrypted, encrypted]
  );
}

async function updateApiKey(providerId, key) {
  const encrypted = encryptApiKey(key);
  await dbQuery(
    'INSERT INTO ai_provider_keys (provider_id, key_index, api_key_encrypted, is_active, is_healthy) VALUES (?, 1, ?, 1, 1) ON DUPLICATE KEY UPDATE api_key_encrypted = ?, is_active = 1, is_healthy = 1, cooldown_until = NULL',
    [providerId, encrypted, encrypted]
  );
}

async function getApiKeysInfo(providerId) {
  const keys = await dbQuery('SELECT id, key_index, is_active, is_healthy, failures_today, tokens_today, last_used_at FROM ai_provider_keys WHERE provider_id = ?', [providerId]);
  return keys;
}

async function addModel(providerId, modelName) {
  await dbQuery(
    'INSERT INTO ai_provider_models (provider_id, model_name, is_active, is_healthy) VALUES (?, ?, 1, 1) ON DUPLICATE KEY UPDATE is_active = 1',
    [providerId, modelName]
  );
}

async function getModelsInfo(providerId) {
  const models = await dbQuery(
    'SELECT id, model_name, is_active, is_healthy, avg_response_ms, requests_today, failures_today, last_failure_at FROM ai_provider_models WHERE provider_id = ?',
    [providerId]
  );
  return models;
}

async function toggleKeyActive(keyId, isActive) {
  await dbQuery('UPDATE ai_provider_keys SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, keyId]);
}

async function toggleModelActive(modelId, isActive) {
  await dbQuery('UPDATE ai_provider_models SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, modelId]);
}

async function updatePriority(id, newPriority) {
  const currentRow = await dbQuery('SELECT priority FROM ai_provider_stats WHERE id = ?', [id]);
  if (!currentRow.length) throw new Error('Provider not found');
  const oldPriority = currentRow[0].priority;
  const otherRow = await dbQuery('SELECT id FROM ai_provider_stats WHERE priority = ? AND id != ?', [newPriority, id]);
  if (otherRow.length > 0) {
    await dbQuery('UPDATE ai_provider_stats SET priority = ? WHERE id = ?', [oldPriority, otherRow[0].id]);
  }
  await dbQuery('UPDATE ai_provider_stats SET priority = ? WHERE id = ?', [newPriority, id]);
}

async function toggleEnabled(id, enabled) {
  await dbQuery('UPDATE ai_provider_stats SET is_enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
}

async function setStrategy(strategy) {
  await dbQuery(
    "INSERT INTO ai_provider_config (cfg_key, cfg_value) VALUES ('strategy', ?) ON DUPLICATE KEY UPDATE cfg_value = ?",
    [strategy, strategy]
  );
}

function getProviderTypes() {
  const defaultModels = {
    groq: 'llama-3.3-70b-versatile',
    gemini: 'gemini-1.5-flash',
    mistral: 'mistral-small-latest',
    cohere: 'command-r',
    openai: 'gpt-4o-mini'
  };
  return Object.entries(PROVIDER_DEFAULTS).map(([type, d]) => ({
    type,
    default_model: defaultModels[type] || 'gpt-4o-mini',
    default_daily_limit: d.daily_limit,
    default_per_min_limit: d.per_min_limit,
    default_api_url: d.api_url,
    env_var_hint: type.toUpperCase() + '_API_KEY',
  }));
}

async function addProvider({ provider_type, display_name, api_key_env, model_name, api_url, daily_limit, per_min_limit }) {
  const defaults = PROVIDER_DEFAULTS[provider_type] || {};
  const defaultModels = {
    groq: 'llama-3.3-70b-versatile',
    gemini: 'gemini-1.5-flash',
    mistral: 'mistral-small-latest',
    cohere: 'command-r',
    openai: 'gpt-4o-mini'
  };

  // Auto-assign priority (max + 1)
  const rows = await dbQuery('SELECT MAX(priority) AS maxP FROM ai_provider_stats');
  const nextPriority = (rows[0]?.maxP || 0) + 1;

  // Auto-generate provider_name: provider_type + _N
  const existing = await dbQuery('SELECT provider_name FROM ai_provider_stats WHERE provider_type = ?', [provider_type]);
  const providerName = existing.length === 0 ? provider_type : `${provider_type}_${existing.length + 1}`;

  const result = await dbQuery(
    `INSERT INTO ai_provider_stats
     (provider_name, display_name, provider_type, priority, daily_limit, per_min_limit, api_key_env, model_name, api_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      providerName,
      display_name || providerName.toUpperCase(),
      provider_type,
      nextPriority,
      daily_limit || defaults.daily_limit || 10000,
      per_min_limit || defaults.per_min_limit || 10,
      api_key_env,
      model_name || defaultModels[provider_type] || 'gpt-4o-mini',
      api_url || defaults.api_url
    ]
  );

  const newProviderId = result.insertId;

  // Also add the default model to ai_provider_models table
  const selectedModelName = model_name || defaultModels[provider_type] || 'gpt-4o-mini';
  await dbQuery(
    'INSERT INTO ai_provider_models (provider_id, model_name, is_active, is_healthy) VALUES (?, ?, 1, 1)',
    [newProviderId, selectedModelName]
  );

  return providerName;
}

async function deleteProvider(id) {
  await dbQuery('DELETE FROM ai_provider_keys WHERE provider_id = ?', [id]);
  await dbQuery('DELETE FROM ai_provider_models WHERE provider_id = ?', [id]);
  await dbQuery('DELETE FROM ai_provider_stats WHERE id = ?', [id]);
}

async function testProvider(provider) {
  const keys = await getProviderKeys(provider.id);
  if (!keys.length) {
    throw new Error('No API keys configured in database for this provider');
  }
  const decryptedKey = decryptApiKey(keys[0].api_key_encrypted);

  const models = await getProviderModels(provider.id, provider.current_model_id);
  if (!models.length) {
    throw new Error('No models configured for this provider');
  }

  let lastError = null;
  for (const model of models) {
    try {
      const TEST_TEXT = 'single jersey 180 GSM 30 dia 24 gauge';
      const result = await callProvider(provider, model, decryptedKey, TEST_TEXT);

      // Success! Update this provider's active model and set health
      await Promise.all([
        dbQuery('UPDATE ai_provider_stats SET current_model_id = ?, model_name = ? WHERE id = ?', [model.id, model.model_name, provider.id]),
        dbQuery('UPDATE ai_provider_models SET is_healthy = 1, cooldown_until = NULL WHERE id = ?', [model.id])
      ]);

      return result;
    } catch (err) {
      console.error(`[Test Connection failed for ${provider.provider_name} model ${model.model_name}]`, err.message);
      lastError = err;
      // Mark this specific model as unhealthy/cooldown in DB
      const cooldownUntil = new Date(Date.now() + 5 * 60 * 1000);
      await dbQuery(
        'UPDATE ai_provider_models SET is_healthy = 0, cooldown_until = ? WHERE id = ?',
        [cooldownUntil, model.id]
      );
    }
  }

  throw new Error(lastError ? lastError.message : 'All models failed during connection test');
}

async function resetDailyStats() {
  await Promise.all([
    dbQuery('UPDATE ai_provider_stats SET tokens_today = 0, requests_today = 0, failures_today = 0, is_healthy = 1, cooldown_until = NULL'),
    dbQuery('UPDATE ai_provider_keys SET tokens_today = 0, failures_today = 0, is_healthy = 1, cooldown_until = NULL'),
    dbQuery('UPDATE ai_provider_models SET requests_today = 0, failures_today = 0, is_healthy = 1, cooldown_until = NULL')
  ]);
}

module.exports = {
  parse,
  getProviders,
  getProviderKeys,
  getProviderModels,
  getStrategy,
  orderProviders,
  addApiKey,
  updateApiKey,
  getApiKeysInfo,
  addModel,
  getModelsInfo,
  toggleKeyActive,
  toggleModelActive,
  updatePriority,
  toggleEnabled,
  setStrategy,
  getProviderTypes,
  addProvider,
  deleteProvider,
  testProvider,
  resetDailyStats,
  encryptApiKey,
  decryptApiKey,
};
