/**
 * AI Provider Manager — Multi-Instance Rolling Fallback
 * Supports: priority | round-robin | weighted | fastest strategies
 * Multiple instances of the same provider type allowed (e.g. groq_1, groq_2)
 */
const Groq = require('groq-sdk');
const axios = require('axios');
const { query: dbQuery } = require('../config/database');

// System prompt shared across all providers (from groq-parser.js)
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
   - If they say "terry", map to "terry_fabric"
   - If they say "fleece", map to "fleece"
   - If they say "jersey" or "single jersey", map to "single_jersey"
   - If they say "slub" (Bangla: স্লাব/স্লাব সুতা), map to "slub_sj"
   - If they say "auto stripe" (Bangla: অটো স্ট্রাইপ) / "engineered stripe" / "stripe jersey", map to "auto_stripe_sj"
   - If they say "melange" / "mélange" / "heather" (Bangla: মেলাঞ্জ/হেদার) and they still mean a jersey base, map to "single_jersey"
   - If they say "rib", default to "rib_1x1" unless they specify 2x1 or 2x2.
   - If they say "pique" or "polo", map to "pique"
3. "dia": machine diameter in inches (number). If they say "30 dia" -> 30.
4. "gauge": machine gauge (number). If they say "24 gauge" or "24G" -> 24.
5. "rpm": machine rpm (number).
6. "composition": Extract any fiber composition percentages mentioned (e.g., "50% cotton 50% polyester", "95% cotton 5% spandex", "CVC"). If no composition is mentioned, do not include this field.
7. "buyer": If they mention a buyer brand (e.g. "H&M", "Zara", "OVS", "C&A"), extract it.

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

// ── Known provider types & their defaults ─────────────────────────────────────
const PROVIDER_DEFAULTS = {
  groq:    { model: 'llama-3.3-70b-versatile', daily_limit: 14400, per_min_limit: 30, api_url: 'https://api.groq.com/openai/v1/chat/completions' },
  gemini:  { model: 'gemini-1.5-flash',        daily_limit: 50000, per_min_limit: 15, api_url: 'https://generativelanguage.googleapis.com/v1beta/models' },
  mistral: { model: 'mistral-small-latest',    daily_limit: 10000, per_min_limit: 10, api_url: 'https://api.mistral.ai/v1/chat/completions' },
  cohere:  { model: 'command-r',               daily_limit:  1000, per_min_limit:  5, api_url: 'https://api.cohere.ai/v1/chat' },
  openai:  { model: 'gpt-4o-mini',             daily_limit: 10000, per_min_limit: 60, api_url: 'https://api.openai.com/v1/chat/completions' },
};

// ── Round-robin cursor (in-process, resets on server restart) ─────────────────
let rrCursor = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getProviders() {
  return dbQuery('SELECT * FROM ai_provider_stats ORDER BY priority ASC');
}

async function getStrategy() {
  try {
    const rows = await dbQuery("SELECT cfg_value FROM ai_provider_config WHERE cfg_key = 'strategy'");
    return rows[0]?.cfg_value || 'priority';
  } catch {
    return 'priority';
  }
}

async function setStrategy(strategy) {
  await dbQuery(
    "INSERT INTO ai_provider_config (cfg_key, cfg_value) VALUES ('strategy', ?) ON DUPLICATE KEY UPDATE cfg_value = ?",
    [strategy, strategy]
  );
}

function isAvailable(provider) {
  if (!provider.is_enabled) return false;
  if (provider.tokens_today >= provider.daily_limit) return false;
  if (provider.cooldown_until && new Date(provider.cooldown_until) > new Date()) return false;
  return true;
}

async function expireCooldown(provider) {
  if (provider.cooldown_until && new Date(provider.cooldown_until) <= new Date()) {
    await dbQuery(
      'UPDATE ai_provider_stats SET is_healthy = 1, cooldown_until = NULL WHERE id = ?',
      [provider.id]
    );
    provider.is_healthy = 1;
    provider.cooldown_until = null;
  }
}

// ── Check if provider has API key configured ─────────────────────────────────
function hasApiKey(provider) {
  const envVar = provider.api_key_env;
  return envVar && process.env[envVar];
}

// ── Strategy: select ordered list of providers to try ────────────────────────
function orderProviders(providers, strategy) {
  const eligible = providers.filter(p => isAvailable(p) && p.is_healthy);

  if (!eligible.length) {
    // All unhealthy — try only those with API keys configured
    return providers.filter(p => p.is_enabled && hasApiKey(p));
  }

  if (strategy === 'round_robin') {
    // Rotate starting point across eligible providers
    if (rrCursor >= eligible.length) rrCursor = 0;
    const rotated = [...eligible.slice(rrCursor), ...eligible.slice(0, rrCursor)];
    rrCursor = (rrCursor + 1) % eligible.length;
    return rotated;
  }

  if (strategy === 'fastest') {
    // Sort by avg_response_ms ascending (0 means untested → put last)
    return [...eligible].sort((a, b) => {
      const aMs = a.avg_response_ms || 99999;
      const bMs = b.avg_response_ms || 99999;
      return aMs - bMs;
    });
  }

  if (strategy === 'weighted') {
    // Weighted: providers with lower failure rate get higher chance
    // Simple: sort by (failures_today / max(requests_today,1)) ASC then priority
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

// ── Main parse() ──────────────────────────────────────────────────────────────
async function parse(text) {
  const [providers, strategy] = await Promise.all([getProviders(), getStrategy()]);

  // Auto-expire stale cooldowns
  for (const p of providers) await expireCooldown(p);

  const ordered = orderProviders(providers, strategy);

  for (const provider of ordered) {
    try {
      const t0 = Date.now();
      const result = await callProvider(provider, text);
      const ms = Date.now() - t0;

      // Update stats with rolling avg response time
      const newAvg = provider.avg_response_ms
        ? Math.round((provider.avg_response_ms * 0.8) + (ms * 0.2))
        : ms;

      await dbQuery(
        `UPDATE ai_provider_stats
         SET tokens_today = tokens_today + ?,
             requests_today = requests_today + 1,
             is_healthy = 1,
             cooldown_until = NULL,
             avg_response_ms = ?
         WHERE id = ?`,
        [result.tokens_used, newAvg, provider.id]
      );

      return {
        ...result.parsed,
        provider_used: provider.provider_name,
        provider_display: provider.display_name || provider.provider_name.toUpperCase(),
        tokens_used: result.tokens_used,
        response_ms: ms
      };
    } catch (error) {
      console.error(`[Provider ${provider.provider_name}/${provider.id} Error]`, error.message);
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
  }

  throw new Error('All AI providers unavailable or exhausted');
}

// ── Call individual provider ──────────────────────────────────────────────────
async function callProvider(provider, text) {
  const type = provider.provider_type || provider.provider_name;
  if (type === 'groq')    return callGroq(text, provider.api_key_env, provider.model_name);
  if (type === 'gemini')  return callGemini(text, provider.api_key_env, provider.model_name, provider.api_url);
  if (type === 'mistral') return callMistral(text, provider.api_key_env, provider.model_name, provider.api_url);
  if (type === 'cohere')  return callCohere(text, provider.api_key_env, provider.model_name, provider.api_url);
  if (type === 'openai')  return callOpenAI(text, provider.api_key_env, provider.model_name, provider.api_url);
  throw new Error(`Unknown provider type: ${type}`);
}

// ── Direct test (bypasses cooldown/health/enabled checks) ─────────────────────
async function testProvider(provider) {
  const TEST_TEXT = 'single jersey 180 GSM 30 dia 24 gauge';
  return callProvider(provider, TEST_TEXT);
}

// ── Add a new provider instance ───────────────────────────────────────────────
async function addProvider({ provider_type, display_name, api_key_env, model_name, api_url, daily_limit, per_min_limit }) {
  const defaults = PROVIDER_DEFAULTS[provider_type] || {};

  // Auto-assign priority (max + 1)
  const rows = await dbQuery('SELECT MAX(priority) AS maxP FROM ai_provider_stats');
  const nextPriority = (rows[0]?.maxP || 0) + 1;

  // Auto-generate provider_name: provider_type + _N
  const existing = await dbQuery('SELECT provider_name FROM ai_provider_stats WHERE provider_type = ?', [provider_type]);
  const providerName = existing.length === 0 ? provider_type : `${provider_type}_${existing.length + 1}`;

  await dbQuery(
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
      model_name || defaults.model,
      api_url || defaults.api_url
    ]
  );

  return providerName;
}

// ── Delete a provider instance ────────────────────────────────────────────────
async function deleteProvider(id) {
  await dbQuery('DELETE FROM ai_provider_stats WHERE id = ?', [id]);
}

// ── Update priority (swap) ────────────────────────────────────────────────────
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

// ── Write API key to .env + process.env ──────────────────────────────────────
async function updateApiKey(providerId, keyValue) {
  const row = await dbQuery('SELECT api_key_env FROM ai_provider_stats WHERE id = ?', [providerId]);
  if (!row.length) throw new Error('Provider not found');
  const envVar = row[0].api_key_env;

  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '..', '.env');

  if (!fs.existsSync(envPath)) throw new Error(`Cannot find .env at: ${envPath}`);

  let envContent = fs.readFileSync(envPath, 'utf8');
  const regex = new RegExp(`^${envVar}=.*$`, 'm');
  if (regex.test(envContent)) {
    envContent = envContent.replace(regex, `${envVar}=${keyValue}`);
  } else {
    envContent += `\n${envVar}=${keyValue}`;
  }
  fs.writeFileSync(envPath, envContent, 'utf8');
  process.env[envVar] = keyValue;
}

async function resetDailyStats() {
  await dbQuery(
    'UPDATE ai_provider_stats SET tokens_today = 0, requests_today = 0, failures_today = 0, is_healthy = 1, cooldown_until = NULL'
  );
}

// ── List live GROQ models ─────────────────────────────────────────────────────
async function getGroqModels(apiKey) {
  const response = await axios.get('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  return response.data.data
    .map(m => m.id)
    .filter(id => !id.includes('whisper') && !id.includes('guard') && !id.includes('tts'));
}

// ── Provider type definitions (for Add Provider UI) ───────────────────────────
function getProviderTypes() {
  return Object.entries(PROVIDER_DEFAULTS).map(([type, d]) => ({
    type,
    default_model: d.model,
    default_daily_limit: d.daily_limit,
    default_per_min_limit: d.per_min_limit,
    default_api_url: d.api_url,
    env_var_hint: type.toUpperCase() + '_API_KEY',
  }));
}

// ── Provider-specific API callers ─────────────────────────────────────────────
async function callGroq(text, api_key_env, modelName) {
  const apiKey = process.env[api_key_env];
  if (!apiKey) throw new Error(`${api_key_env} not configured`);
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

async function callGemini(text, api_key_env, modelName, apiUrl) {
  const apiKey = process.env[api_key_env];
  if (!apiKey) throw new Error(`${api_key_env} not configured`);
  const url = `${apiUrl}/${modelName}:generateContent?key=${apiKey}`;
  const response = await axios.post(url, {
    contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${text}` }] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
  });
  const content = response.data.candidates[0].content.parts[0].text;
  return { parsed: JSON.parse(content), tokens_used: response.data.usageMetadata?.totalTokenCount || 100 };
}

async function callMistral(text, api_key_env, modelName, apiUrl) {
  const apiKey = process.env[api_key_env];
  if (!apiKey) throw new Error(`${api_key_env} not configured`);
  const response = await axios.post(apiUrl, {
    model: modelName,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: text }],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  }, { headers: { Authorization: `Bearer ${apiKey}` } });
  const content = response.data.choices[0].message.content;
  return { parsed: JSON.parse(content), tokens_used: response.data.usage?.total_tokens || 100 };
}

async function callCohere(text, api_key_env, modelName, apiUrl) {
  const apiKey = process.env[api_key_env];
  if (!apiKey) throw new Error(`${api_key_env} not configured`);
  const response = await axios.post(apiUrl, {
    model: modelName,
    message: text,
    preamble: SYSTEM_PROMPT
  }, { headers: { Authorization: `Bearer ${apiKey}` } });
  const content = response.data.text;
  return { parsed: JSON.parse(content), tokens_used: response.data.meta?.tokens?.output_tokens || 100 };
}

async function callOpenAI(text, api_key_env, modelName, apiUrl) {
  const apiKey = process.env[api_key_env];
  if (!apiKey) throw new Error(`${api_key_env} not configured`);
  const response = await axios.post(apiUrl, {
    model: modelName,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: text }],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  }, { headers: { Authorization: `Bearer ${apiKey}` } });
  const content = response.data.choices[0].message.content;
  return { parsed: JSON.parse(content), tokens_used: response.data.usage?.total_tokens || 100 };
}

module.exports = {
  parse,
  getProviders,
  getStrategy,
  setStrategy,
  getProviderTypes,
  testProvider,
  callProvider,
  addProvider,
  deleteProvider,
  updatePriority,
  toggleEnabled,
  updateApiKey,
  resetDailyStats,
  getGroqModels,
};
