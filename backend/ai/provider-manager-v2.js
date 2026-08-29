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
const { query: dbQuery } = require('../db/client');

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
// The key used to be derived from the literal string 'knitadvisor-secret' with
// the literal salt 'salt', both committed to a public repository. Encrypting
// with a published key is not encryption: anyone who could read the database
// could decrypt every provider key in it. The secret now comes from the
// environment and the module refuses to touch key material without it.
//
// LEGACY_SECRET stays only so scripts/reencrypt-provider-keys.js can migrate
// rows written under the old scheme. It is never used to encrypt anything new,
// and reading through it is opt-in per call.
const LEGACY_SECRET = 'knitadvisor-secret';
const LEGACY_SALT = 'salt';

let _encryptionKey = null;
function getEncryptionKey() {
  if (_encryptionKey) return _encryptionKey;
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'API_KEY_ENCRYPTION_SECRET is missing or too short (min 16 chars). ' +
      'Set it in backend/.env — provider API keys cannot be read or written without it.'
    );
  }
  const salt = process.env.API_KEY_ENCRYPTION_SALT || 'knitadvisor-key-v2';
  _encryptionKey = crypto.scryptSync(secret, salt, 32);
  return _encryptionKey;
}

function legacyEncryptionKey() {
  return crypto.scryptSync(LEGACY_SECRET, LEGACY_SALT, 32);
}

function encryptApiKey(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', getEncryptionKey(), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptApiKey(encrypted, { legacy = false } = {}) {
  const [ivHex, encryptedHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const key = legacy ? legacyEncryptionKey() : getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── Core getters ──────────────────────────────────────────────────────────────
async function getProviders() {
  return dbQuery('SELECT * FROM ai_provider_stats ORDER BY priority ASC');
}

async function getProviderKeys(providerId) {
  return dbQuery('SELECT id, api_key_encrypted, key_index, is_active, is_healthy, cooldown_until FROM ai_provider_keys WHERE provider_id = $1 AND is_active = true ORDER BY key_index ASC', [providerId]);
}

async function getProviderModels(providerId, currentModelId) {
  // Self-healing check: Ensure the model_name from ai_provider_stats exists in ai_provider_models
  try {
    const stats = await dbQuery('SELECT model_name FROM ai_provider_stats WHERE id = $1', [providerId]);
    if (stats.length && stats[0].model_name) {
      const mainModel = stats[0].model_name.trim();
      if (mainModel) {
        await dbQuery(
          `INSERT INTO ai_provider_models (provider_id, model_name, is_active, is_healthy)
           VALUES ($1, $2, true, true)
           ON CONFLICT (provider_id, model_name) DO NOTHING`,
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
       WHERE provider_id = $1 AND is_active = true 
       ORDER BY CASE WHEN id = $2 THEN 0 ELSE 1 END ASC, is_healthy DESC, avg_response_ms ASC`,
      [providerId, currentModelId]
    );
  }
  return dbQuery(
    `SELECT id, model_name, is_active, is_healthy, avg_response_ms, cooldown_until 
     FROM ai_provider_models 
     WHERE provider_id = $1 AND is_active = true 
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
  // daily_limit counts REQUESTS per day (Groq free tier 14,400/day, Mistral
  // 10,000/day — see PROVIDER_DEFAULTS). This compared it against tokens_today
  // instead, and a request costs a few hundred tokens, so a provider was ruled
  // "over quota" after roughly 25-30 calls rather than fourteen thousand. Groq
  // and Mistral were both silently excluded that way, which is why parse() fell
  // through to Gemini and then reported every provider exhausted.
  if (provider.requests_today >= provider.daily_limit) return false;
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
  const deadline = Date.now() + PARSE_BUDGET_MS;
  await ensureDailyReset();
  const [providers, strategy] = await Promise.all([getProviders(), getStrategy()]);

  const ordered = orderProviders(providers, strategy);

  for (const provider of ordered) {
    if (Date.now() > deadline) {
      console.error('[Parse] Overall budget exhausted before trying', provider.provider_name);
      break;
    }
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
        if (Date.now() > deadline) break;
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
               SET tokens_today = tokens_today + $1,
                   requests_today = requests_today + 1,
                   current_key_id = $2,
                   current_model_id = $3
               WHERE id = $4`,
              [result.tokens_used, key.id, model.id, provider.id]
            ),
            // Update key stats
            dbQuery(
              `UPDATE ai_provider_keys
               SET tokens_today = tokens_today + $1,
                   failures_today = 0,
                   is_healthy = true,
                   cooldown_until = NULL,
                   last_used_at = now()
               WHERE id = $2`,
              [result.tokens_used, key.id]
            ),
            // Update model stats
            dbQuery(
              `UPDATE ai_provider_models
               SET requests_today = requests_today + 1,
                   failures_today = 0,
                   is_healthy = true,
                   cooldown_until = NULL,
                   avg_response_ms = $1
               WHERE id = $2`,
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
                 is_healthy = false,
                 last_failure_at = now(),
                 cooldown_until = $1
             WHERE id = $2`,
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
             is_healthy = false,
             cooldown_until = $1
         WHERE id = $2`,
        [cooldownUntil, key.id]
      );
    }

    // All keys failed for this provider — mark provider unhealthy, try next provider
    const cooldownUntil = new Date(Date.now() + 5 * 60 * 1000);
    await dbQuery(
      `UPDATE ai_provider_stats
       SET failures_today = failures_today + 1,
           is_healthy = false,
           last_failure_at = now(),
           cooldown_until = $1
       WHERE id = $2`,
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

const PROVIDER_TIMEOUT_MS = parseInt(process.env.AI_PROVIDER_TIMEOUT_MS, 10) || 12000;
const PARSE_BUDGET_MS = parseInt(process.env.AI_PARSE_BUDGET_MS, 10) || 25000;

function axiosOpts(extra = {}) {
  return { timeout: PROVIDER_TIMEOUT_MS, ...extra };
}

// ── Provider-specific callers ─────────────────────────────────────────────────
async function callGroq(text, apiKey, modelName) {
  // groq-sdk has its own default timeout and retry policy; pin both so this
  // path is bounded like the axios ones rather than relying on the default.
  const groq = new Groq({ apiKey, timeout: PROVIDER_TIMEOUT_MS, maxRetries: 1 });
  const response = await groq.chat.completions.create({
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: text }],
    model: modelName,
    temperature: 0.1,
    response_format: { type: 'json_object' }
  });
  const content = response.choices[0].message.content;
  return { parsed: JSON.parse(content), tokens_used: response.usage?.total_tokens || 100 };
}

// None of the provider calls below set a timeout, and axios has none by
// default. parse() walks providers x keys x models, so one unresponsive
// provider held the whole request open indefinitely — the client just hung
// with nothing logged. Each attempt is bounded, and parse() has an overall
// budget on top so the worst case stays bounded as models are added.
async function callGemini(text, apiKey, modelName, apiUrl) {
  const url = `${apiUrl}/${modelName}:generateContent?key=${apiKey}`;
  const response = await axios.post(url, {
    contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${text}` }] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
  }, axiosOpts());
  const content = response.data.candidates[0].content.parts[0].text;
  return { parsed: JSON.parse(content), tokens_used: response.data.usageMetadata?.totalTokenCount || 100 };
}

async function callMistral(text, apiKey, modelName, apiUrl) {
  const response = await axios.post(apiUrl, {
    model: modelName,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: text }],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  }, axiosOpts({ headers: { Authorization: `Bearer ${apiKey}` } }));
  const content = response.data.choices[0].message.content;
  return { parsed: JSON.parse(content), tokens_used: response.data.usage?.total_tokens || 100 };
}

async function callCohere(text, apiKey, modelName, apiUrl) {
  const response = await axios.post(apiUrl, {
    model: modelName,
    message: text,
    preamble: SYSTEM_PROMPT
  }, axiosOpts({ headers: { Authorization: `Bearer ${apiKey}` } }));
  const content = response.data.text;
  return { parsed: JSON.parse(content), tokens_used: response.data.meta?.tokens?.output_tokens || 100 };
}

async function callOpenAI(text, apiKey, modelName, apiUrl) {
  const response = await axios.post(apiUrl, {
    model: modelName,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: text }],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  }, axiosOpts({ headers: { Authorization: `Bearer ${apiKey}` } }));
  const content = response.data.choices[0].message.content;
  return { parsed: JSON.parse(content), tokens_used: response.data.usage?.total_tokens || 100 };
}

// ── Admin functions ───────────────────────────────────────────────────────────
async function addApiKey(providerId, apiKeyPlaintext, keyIndex) {
  const encrypted = encryptApiKey(apiKeyPlaintext);
  await dbQuery(
    `INSERT INTO ai_provider_keys (provider_id, key_index, api_key_encrypted, is_active)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (provider_id, key_index)
     DO UPDATE SET api_key_encrypted = EXCLUDED.api_key_encrypted`,
    [providerId, keyIndex || 1, encrypted]
  );
}

async function updateApiKey(providerId, key) {
  const encrypted = encryptApiKey(key);
  await dbQuery(
    `INSERT INTO ai_provider_keys (provider_id, key_index, api_key_encrypted, is_active, is_healthy)
     VALUES ($1, 1, $2, true, true)
     ON CONFLICT (provider_id, key_index)
     DO UPDATE SET api_key_encrypted = EXCLUDED.api_key_encrypted,
                   is_active         = true,
                   is_healthy        = true,
                   cooldown_until    = NULL`,
    [providerId, encrypted]
  );
}

async function getApiKeysInfo(providerId) {
  const keys = await dbQuery('SELECT id, key_index, is_active, is_healthy, failures_today, tokens_today, last_used_at FROM ai_provider_keys WHERE provider_id = $1', [providerId]);
  return keys;
}

async function addModel(providerId, modelName) {
  await dbQuery(
    `INSERT INTO ai_provider_models (provider_id, model_name, is_active, is_healthy)
     VALUES ($1, $2, true, true)
     ON CONFLICT (provider_id, model_name) DO UPDATE SET is_active = true`,
    [providerId, modelName]
  );
}

async function getModelsInfo(providerId) {
  const models = await dbQuery(
    'SELECT id, model_name, is_active, is_healthy, avg_response_ms, requests_today, failures_today, last_failure_at FROM ai_provider_models WHERE provider_id = $1',
    [providerId]
  );
  return models;
}

async function toggleKeyActive(keyId, isActive) {
  await dbQuery('UPDATE ai_provider_keys SET is_active = $1 WHERE id = $2', [isActive, keyId]);
}

async function toggleModelActive(modelId, isActive) {
  await dbQuery('UPDATE ai_provider_models SET is_active = $1 WHERE id = $2', [isActive, modelId]);
}

async function updatePriority(id, newPriority) {
  const currentRow = await dbQuery('SELECT priority FROM ai_provider_stats WHERE id = $1', [id]);
  if (!currentRow.length) throw new Error('Provider not found');
  const oldPriority = currentRow[0].priority;
  const otherRow = await dbQuery('SELECT id FROM ai_provider_stats WHERE priority = $1 AND id != $2', [newPriority, id]);
  if (otherRow.length > 0) {
    await dbQuery('UPDATE ai_provider_stats SET priority = $1 WHERE id = $2', [oldPriority, otherRow[0].id]);
  }
  await dbQuery('UPDATE ai_provider_stats SET priority = $1 WHERE id = $2', [newPriority, id]);
}

async function toggleEnabled(id, enabled) {
  await dbQuery('UPDATE ai_provider_stats SET is_enabled = $1 WHERE id = $2', [enabled, id]);
}

async function setStrategy(strategy) {
  await dbQuery(
    `INSERT INTO ai_provider_config (cfg_key, cfg_value) VALUES ('strategy', $1)
     ON CONFLICT (cfg_key) DO UPDATE SET cfg_value = EXCLUDED.cfg_value`,
    [strategy]
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
  const existing = await dbQuery('SELECT provider_name FROM ai_provider_stats WHERE provider_type = $1', [provider_type]);
  const providerName = existing.length === 0 ? provider_type : `${provider_type}_${existing.length + 1}`;

  const result = await dbQuery(
    `INSERT INTO ai_provider_stats
     (provider_name, display_name, provider_type, priority, daily_limit, per_min_limit, api_key_env, model_name, api_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
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

  // Postgres has no LAST_INSERT_ID(); the INSERT above carries RETURNING id.
  const newProviderId = result[0].id;

  // Also add the default model to ai_provider_models table
  const selectedModelName = model_name || defaultModels[provider_type] || 'gpt-4o-mini';
  await dbQuery(
    `INSERT INTO ai_provider_models (provider_id, model_name, is_active, is_healthy)
     VALUES ($1, $2, true, true)
     ON CONFLICT (provider_id, model_name) DO NOTHING`,
    [newProviderId, selectedModelName]
  );

  return providerName;
}

async function deleteProvider(id) {
  await dbQuery('DELETE FROM ai_provider_keys WHERE provider_id = $1', [id]);
  await dbQuery('DELETE FROM ai_provider_models WHERE provider_id = $1', [id]);
  await dbQuery('DELETE FROM ai_provider_stats WHERE id = $1', [id]);
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
        dbQuery('UPDATE ai_provider_stats SET current_model_id = $1, model_name = $2 WHERE id = $3', [model.id, model.model_name, provider.id]),
        dbQuery('UPDATE ai_provider_models SET is_healthy = true, cooldown_until = NULL WHERE id = $1', [model.id])
      ]);

      return result;
    } catch (err) {
      console.error(`[Test Connection failed for ${provider.provider_name} model ${model.model_name}]`, err.message);
      lastError = err;

      // Special case: 429 means the key is VALID, but free quota has been exhausted.
      // We should treat this as a successful key validation!
      if (err.response?.status === 429 || err.message?.includes('429')) {
        await Promise.all([
          dbQuery('UPDATE ai_provider_stats SET current_model_id = $1, model_name = $2 WHERE id = $3', [model.id, model.model_name, provider.id]),
          dbQuery('UPDATE ai_provider_models SET is_healthy = true, cooldown_until = NULL WHERE id = $1', [model.id])
        ]);
        return {
          rate_limited: true,
          model_used: model.model_name,
          provider_used: provider.provider_name,
          message: 'API Key is VALID, but Google says: Quota Exhausted (429). Please wait or set up billing.'
        };
      }

      // Mark this specific model as unhealthy/cooldown in DB
      const cooldownUntil = new Date(Date.now() + 5 * 60 * 1000);
      await dbQuery(
        'UPDATE ai_provider_models SET is_healthy = false, cooldown_until = $1 WHERE id = $2',
        [cooldownUntil, model.id]
      );
    }
  }

  throw new Error(lastError ? lastError.message : 'All models failed during connection test');
}

/**
 * Zero the per-day counters when the date rolls over.
 *
 * resetDailyStats() existed but nothing ever called it outside a manual admin
 * button, so "today's" counters were really since-the-beginning-of-time
 * counters. Combined with the limit check above, every provider eventually
 * crossed its daily limit permanently and the AI feature went dark with no
 * error anyone would see.
 */
let lastResetCheck = null;
async function ensureDailyReset() {
  const today = new Date().toISOString().slice(0, 10);
  if (lastResetCheck === today) return;   // already checked this process, this day

  try {
    // This used to CREATE TABLE IF NOT EXISTS with a trailing `ENGINE=InnoDB`,
    // left over from MySQL. Against PostgreSQL it threw 42601 on every call, so
    // the whole daily-reset check aborted into the catch below and the counters
    // it exists to reset never reset — the exact failure the function was
    // written to fix, reintroduced by the database migration and visible only
    // as a repeated line in stderr.
    //
    // The table is owned by db/migrations/001_initial_schema.sql, so there is
    // nothing to create here; a request-path CREATE TABLE was always the wrong
    // place to define schema.
    const rows = await dbQuery("SELECT meta_value FROM ai_provider_meta WHERE meta_key = 'last_reset_date'");
    const stored = rows.length ? rows[0].meta_value : null;

    if (stored !== today) {
      await resetDailyStats();
      await dbQuery(
        `INSERT INTO ai_provider_meta (meta_key, meta_value) VALUES ('last_reset_date', $1)
         ON CONFLICT (meta_key) DO UPDATE SET meta_value = EXCLUDED.meta_value`,
        [today]
      );
      console.log('[Providers] Daily counters reset for', today, stored ? `(last reset ${stored})` : '(first reset)');
    }
    lastResetCheck = today;
  } catch (err) {
    // A failed reset must not block parsing — worst case the counters stay stale
    // for this request and the next one retries.
    console.error('[Providers] Daily reset check failed:', err.message);
  }
}

async function resetDailyStats() {
  await Promise.all([
    dbQuery('UPDATE ai_provider_stats SET tokens_today = 0, requests_today = 0, failures_today = 0, is_healthy = true, cooldown_until = NULL'),
    dbQuery('UPDATE ai_provider_keys SET tokens_today = 0, failures_today = 0, is_healthy = true, cooldown_until = NULL'),
    dbQuery('UPDATE ai_provider_models SET requests_today = 0, failures_today = 0, is_healthy = true, cooldown_until = NULL')
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
  ensureDailyReset,
  encryptApiKey,
  decryptApiKey,
};
