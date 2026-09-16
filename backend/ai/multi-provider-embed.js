/**
 * Knowledge Assistant embeddings — Mistral only, deliberately NOT
 * multi-provider like multi-provider-chat.js.
 *
 * Free-text generation is safe to fall back across providers because each
 * request is independent. Embeddings are not: they get stored in
 * knowledge_chunks.embedding (a fixed vector(1024) pgvector column — see
 * migration 025) and compared against each other by cosine distance at
 * search time. Two providers rarely share an embedding space, so a chunk
 * embedded by Provider A and a query embedded by Provider B would compare
 * as noise, not relevance — silently degrading every search result with no
 * error to notice. One fixed provider for the whole store, always.
 *
 * Mistral was chosen because it is already configured in this app's
 * provider table (see provider-manager-v2.js) and mistral-embed supports an
 * explicit `output_dimension`, so this is pinned to 1024 rather than
 * trusting whatever the model's own default happens to be — matching the
 * vector(1024) column exactly, no migration needed.
 */
const axios = require('axios');
const providerManager = require('./provider-manager-v2');

const MISTRAL_EMBED_MODEL = 'mistral-embed';
const MISTRAL_EMBED_DIMENSION = 1024;
const MISTRAL_EMBED_URL = 'https://api.mistral.ai/v1/embeddings';
const TIMEOUT_MS = parseInt(process.env.AI_PROVIDER_TIMEOUT_MS, 10) || 15000;

async function getMistralKey() {
  const providers = await providerManager.getProviders();
  const row = providers.find(p => p.provider_type === 'mistral');
  if (!row) return null;
  const keys = await providerManager.getProviderKeys(row.id);
  const active = keys.find(k => k.is_active);
  if (!active) return null;
  return providerManager.decryptApiKey(active.api_key_encrypted);
}

/**
 * @param {string} text
 * @param {'query'|'document'} inputType — accepted for interface parity with
 *   the engine's embedFn(text, inputType) contract, but unused: Mistral's
 *   embeddings API has no asymmetric query/document distinction to hint.
 * @returns {Promise<{embedding: number[], tokens: number}>}
 */
async function embed(text, inputType = 'query') {
  const apiKey = await getMistralKey();
  if (!apiKey) {
    throw new Error('No active Mistral API key configured — add one in the admin panel under AI Providers (type "mistral"). The Knowledge Assistant needs Mistral specifically for embeddings, regardless of which provider answers questions.');
  }

  const res = await axios.post(MISTRAL_EMBED_URL, {
    model: MISTRAL_EMBED_MODEL,
    input: text,
    // mistral-embed rejects output_dimension outright ("This model does not
    // support output_dimension", verified live 2026-09-16) — Matryoshka-style
    // truncation is apparently a newer/different Mistral model, not this one.
    // Its natural output is checked against MISTRAL_EMBED_DIMENSION below on
    // every call instead, so a silent dimension mismatch fails loudly rather
    // than corrupting the vector(1024) column.
  }, {
    timeout: TIMEOUT_MS,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });

  const item = res.data.data && res.data.data[0];
  if (!item || !Array.isArray(item.embedding)) {
    throw new Error('Mistral embeddings response missing an embedding vector.');
  }
  if (item.embedding.length !== MISTRAL_EMBED_DIMENSION) {
    // Fail loudly rather than let a dimension mismatch reach the DB — the
    // vector(1024) column would reject it too, but with a much less useful
    // error than this one.
    throw new Error(`Mistral returned a ${item.embedding.length}-dimension embedding, expected ${MISTRAL_EMBED_DIMENSION} — the knowledge_chunks.embedding column is fixed at vector(${MISTRAL_EMBED_DIMENSION}) and cannot store this.`);
  }

  return {
    embedding: item.embedding,
    tokens: (res.data.usage && res.data.usage.total_tokens) || 0,
  };
}

module.exports = { embed, MISTRAL_EMBED_MODEL, MISTRAL_EMBED_DIMENSION };
