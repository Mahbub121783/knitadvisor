/**
 * Knowledge Assistant generation — reuses the SAME multi-provider rotation
 * infrastructure as provider-manager-v2.js's parse() (getProviders/
 * orderProviders/getProviderKeys/decryptApiKey — same encrypted-key storage,
 * same priority/health-based ordering), but calls each provider for a
 * free-text grounded answer instead of a JSON-object param extraction.
 *
 * Deliberately NOT routed through callProvider()/callGroq()/etc. in
 * provider-manager-v2.js — those five branches are hardcoded to the
 * NL-parsing SYSTEM_PROMPT and force `response_format: json_object`, neither
 * of which fits a free-text RAG answer. This file is the same shape as that
 * one's provider-specific callers, with its own system prompt and no JSON
 * constraint, so the existing NL-parsing feature is never touched.
 *
 * No Anthropic/Voyage — this app's own configured providers only (Groq,
 * Mistral, Gemini, Cohere, OpenAI — whichever are enabled with an active key).
 */
const Groq = require('groq-sdk');
const axios = require('axios');
const providerManager = require('./provider-manager-v2');

const PROVIDER_TIMEOUT_MS = parseInt(process.env.AI_PROVIDER_TIMEOUT_MS, 10) || 12000;

function axiosOpts(extra = {}) {
  return { timeout: PROVIDER_TIMEOUT_MS, ...extra };
}

async function callGroqChat(systemPrompt, question, apiKey, modelName) {
  const groq = new Groq({ apiKey, timeout: PROVIDER_TIMEOUT_MS, maxRetries: 1 });
  const response = await groq.chat.completions.create({
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: question }],
    model: modelName,
    temperature: 0.2,
  });
  const choice = response.choices[0];
  return {
    text: choice.message.content || '',
    inputTokens: response.usage?.prompt_tokens || 0,
    outputTokens: response.usage?.completion_tokens || 0,
  };
}

async function callMistralChat(systemPrompt, question, apiKey, modelName, apiUrl) {
  const response = await axios.post(apiUrl, {
    model: modelName,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: question }],
    temperature: 0.2,
  }, axiosOpts({ headers: { Authorization: `Bearer ${apiKey}` } }));
  const choice = response.data.choices[0];
  return {
    text: choice.message.content || '',
    inputTokens: response.data.usage?.prompt_tokens || 0,
    outputTokens: response.data.usage?.completion_tokens || 0,
  };
}

async function callGeminiChat(systemPrompt, question, apiKey, modelName, apiUrl) {
  const url = `${apiUrl}/${modelName}:generateContent?key=${apiKey}`;
  const response = await axios.post(url, {
    contents: [{ parts: [{ text: question }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { temperature: 0.2 },
  }, axiosOpts());
  const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return {
    text,
    inputTokens: response.data.usageMetadata?.promptTokenCount || 0,
    outputTokens: response.data.usageMetadata?.candidatesTokenCount || 0,
  };
}

async function callCohereChat(systemPrompt, question, apiKey, modelName, apiUrl) {
  const response = await axios.post(apiUrl, {
    model: modelName,
    message: question,
    preamble: systemPrompt,
  }, axiosOpts({ headers: { Authorization: `Bearer ${apiKey}` } }));
  return {
    text: response.data.text || '',
    inputTokens: response.data.meta?.tokens?.input_tokens || 0,
    outputTokens: response.data.meta?.tokens?.output_tokens || 0,
  };
}

async function callOpenAIChat(systemPrompt, question, apiKey, modelName, apiUrl) {
  const response = await axios.post(apiUrl, {
    model: modelName,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: question }],
    temperature: 0.2,
  }, axiosOpts({ headers: { Authorization: `Bearer ${apiKey}` } }));
  const choice = response.data.choices[0];
  return {
    text: choice.message.content || '',
    inputTokens: response.data.usage?.prompt_tokens || 0,
    outputTokens: response.data.usage?.completion_tokens || 0,
  };
}

function callByType(type, systemPrompt, question, apiKey, modelName, apiUrl) {
  if (type === 'groq') return callGroqChat(systemPrompt, question, apiKey, modelName);
  if (type === 'mistral') return callMistralChat(systemPrompt, question, apiKey, modelName, apiUrl);
  if (type === 'gemini') return callGeminiChat(systemPrompt, question, apiKey, modelName, apiUrl);
  if (type === 'cohere') return callCohereChat(systemPrompt, question, apiKey, modelName, apiUrl);
  if (type === 'openai') return callOpenAIChat(systemPrompt, question, apiKey, modelName, apiUrl);
  throw new Error(`Unsupported provider type for chat generation: ${type}`);
}

/**
 * Tries every enabled provider with an active key, in the same priority/
 * health order parse() uses, until one succeeds. None of these providers
 * expose an Anthropic-style safety-refusal signal via their API, so
 * `refused` is always false here — the NOT_COVERED grounding instruction in
 * the system prompt is this path's only "decline to answer" mechanism.
 *
 * @returns {Promise<{text: string, inputTokens: number, outputTokens: number, provider: string, refused: false}>}
 */
async function generateAnswer(systemPrompt, question) {
  const [providers, strategy] = await Promise.all([
    providerManager.getProviders(),
    providerManager.getStrategy(),
  ]);
  const ordered = providerManager.orderProviders(providers, strategy);

  const errors = [];
  for (const provider of ordered) {
    const keys = await providerManager.getProviderKeys(provider.id);
    const activeKey = keys.find(k => k.is_active);
    if (!activeKey) { errors.push(`${provider.provider_name}: no active key`); continue; }

    try {
      const apiKey = providerManager.decryptApiKey(activeKey.api_key_encrypted);
      const result = await callByType(provider.provider_type, systemPrompt, question, apiKey, provider.model_name, provider.api_url);
      if (!result.text.trim()) { errors.push(`${provider.provider_name}: empty response`); continue; }
      return { ...result, provider: provider.provider_name, refused: false };
    } catch (err) {
      errors.push(`${provider.provider_name}: ${err.message}`);
    }
  }

  throw new Error(errors.length
    ? `All AI providers failed or are unconfigured: ${errors.join('; ')}`
    : 'No AI provider is currently enabled for the Knowledge Assistant — add one in the admin panel under AI Providers.');
}

module.exports = { generateAnswer };
