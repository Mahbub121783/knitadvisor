/**
 * AI Provider Manager — Rolling Fallback with Ranking System
 * Tries providers in priority order; skips unhealthy/exhausted; marks failures for cooldown
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

async function getProviders() {
  const rows = await dbQuery(
    'SELECT * FROM ai_provider_stats ORDER BY priority ASC'
  );
  return rows;
}

async function parse(text) {
  const providers = await getProviders();
  const enabled = providers.filter(p => p.is_enabled);

  for (const provider of enabled) {
    // Skip if unhealthy and still in cooldown
    if (!provider.is_healthy && provider.cooldown_until && new Date(provider.cooldown_until) > new Date()) {
      continue;
    }

    // Skip if daily limit exhausted
    if (provider.tokens_today >= provider.daily_limit) {
      continue;
    }

    try {
      const result = await callProvider(provider, text);

      // Success: update stats
      await dbQuery(
        'UPDATE ai_provider_stats SET tokens_today = tokens_today + ?, requests_today = requests_today + 1, is_healthy = 1, cooldown_until = NULL WHERE id = ?',
        [result.tokens_used, provider.id]
      );

      return {
        ...result.parsed,
        provider_used: provider.provider_name,
        tokens_used: result.tokens_used
      };
    } catch (error) {
      console.error(`[Provider ${provider.provider_name} Error]`, error.message);

      // Mark unhealthy + set 5min cooldown
      const cooldownUntil = new Date(Date.now() + 5 * 60 * 1000);
      await dbQuery(
        'UPDATE ai_provider_stats SET failures_today = failures_today + 1, is_healthy = 0, last_failure_at = NOW(), cooldown_until = ? WHERE id = ?',
        [cooldownUntil, provider.id]
      );
    }
  }

  throw new Error('All AI providers unavailable or exhausted');
}

async function callProvider(provider, text) {
  const { provider_name, api_key_env, model_name, api_url } = provider;

  if (provider_name === 'groq') {
    return await callGroq(text, api_key_env, model_name);
  } else if (provider_name === 'gemini') {
    return await callGemini(text, api_key_env, model_name, api_url);
  } else if (provider_name === 'mistral') {
    return await callMistral(text, api_key_env, model_name, api_url);
  } else if (provider_name === 'cohere') {
    return await callCohere(text, api_key_env, model_name, api_url);
  }

  throw new Error(`Unknown provider: ${provider_name}`);
}

async function callGroq(text, api_key_env, modelName) {
  const apiKey = process.env[api_key_env];
  if (!apiKey) throw new Error(`${api_key_env} not configured`);

  const groq = new Groq({ apiKey });
  const response = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text }
    ],
    model: modelName,
    temperature: 0.1,
    response_format: { type: 'json_object' }
  });

  const content = response.choices[0].message.content;
  const parsed = JSON.parse(content);
  const tokensUsed = (response.usage?.total_tokens || 100);

  return { parsed, tokens_used: tokensUsed };
}

async function callGemini(text, api_key_env, modelName, apiUrl) {
  const apiKey = process.env[api_key_env];
  if (!apiKey) throw new Error(`${api_key_env} not configured`);

  const url = `${apiUrl}/${modelName}:generateContent?key=${apiKey}`;
  const response = await axios.post(url, {
    contents: [{
      parts: [{ text: `${SYSTEM_PROMPT}\n\n${text}` }]
    }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  });

  const content = response.data.candidates[0].content.parts[0].text;
  const parsed = JSON.parse(content);
  const tokensUsed = (response.data.usageMetadata?.totalTokenCount || 100);

  return { parsed, tokens_used: tokensUsed };
}

async function callMistral(text, api_key_env, modelName, apiUrl) {
  const apiKey = process.env[api_key_env];
  if (!apiKey) throw new Error(`${api_key_env} not configured`);

  const response = await axios.post(apiUrl, {
    model: modelName,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text }
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  }, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });

  const content = response.data.choices[0].message.content;
  const parsed = JSON.parse(content);
  const tokensUsed = (response.data.usage?.total_tokens || 100);

  return { parsed, tokens_used: tokensUsed };
}

async function callCohere(text, api_key_env, modelName, apiUrl) {
  const apiKey = process.env[api_key_env];
  if (!apiKey) throw new Error(`${api_key_env} not configured`);

  const response = await axios.post(apiUrl, {
    model: modelName,
    message: text,
    preamble: SYSTEM_PROMPT
  }, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });

  const content = response.data.text;
  const parsed = JSON.parse(content);
  const tokensUsed = (response.data.meta?.tokens?.output_tokens || 100);

  return { parsed, tokens_used: tokensUsed };
}

async function updatePriority(id, newPriority) {
  const currentRow = await dbQuery('SELECT priority FROM ai_provider_stats WHERE id = ?', [id]);
  if (!currentRow.length) throw new Error('Provider not found');

  const oldPriority = currentRow[0].priority;
  const otherRow = await dbQuery('SELECT id FROM ai_provider_stats WHERE priority = ?', [newPriority]);

  if (otherRow.length > 0) {
    await dbQuery('UPDATE ai_provider_stats SET priority = ? WHERE id = ?', [oldPriority, otherRow[0].id]);
  }

  await dbQuery('UPDATE ai_provider_stats SET priority = ? WHERE id = ?', [newPriority, id]);
}

async function toggleEnabled(id, enabled) {
  await dbQuery('UPDATE ai_provider_stats SET is_enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
}

async function updateApiKey(providerName, keyValue) {
  const row = await dbQuery('SELECT api_key_env FROM ai_provider_stats WHERE provider_name = ?', [providerName]);
  if (!row.length) throw new Error('Provider not found');

  const envVar = row[0].api_key_env;
  const fs = require('fs');
  const path = require('path');

  const envPath = path.join(__dirname, '..', '..', '.env');
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

module.exports = {
  parse,
  getProviders,
  updatePriority,
  toggleEnabled,
  updateApiKey,
  resetDailyStats
};
