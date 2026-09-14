/**
 * Voyage AI embeddings — thin, direct HTTP client (native fetch; Voyage has
 * no official Node SDK the way Anthropic does, so raw HTTP is the correct
 * choice here, not a shim).
 *
 * Model: voyage-4-lite ($0.02/M tokens — the cheapest current-generation
 * Voyage model; this app's knowledge base is a few hundred chunks, not
 * millions, so the cheapest tier is the right one, not a compromise).
 * Matryoshka-trained: the API is asked for the first 1024 of its native
 * 2048 dimensions via `output_dimension`, matching the `vector(1024)`
 * column in migration 025 — the two MUST agree, hence the shared constant.
 */
const VOYAGE_MODEL = 'voyage-4-lite';
const VOYAGE_DIMENSION = 1024;
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';

/**
 * @param {string} text
 * @param {string} apiKey
 * @param {'query'|'document'} inputType — Voyage's asymmetric-retrieval hint:
 *   'document' when embedding knowledge chunks for storage, 'query' when
 *   embedding a user's question at answer time. Using the right one measurably
 *   improves retrieval quality over embedding both the same way.
 * @returns {Promise<{embedding: number[], tokens: number}>}
 */
async function embed(text, apiKey, inputType = 'query') {
  if (!apiKey) throw new Error('Voyage API key not configured — add it in the admin panel under AI Providers (type "voyage").');

  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: text,
      model: VOYAGE_MODEL,
      input_type: inputType,
      output_dimension: VOYAGE_DIMENSION,
      output_dtype: 'float',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Voyage embeddings request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const item = data.data && data.data[0];
  if (!item || !Array.isArray(item.embedding)) {
    throw new Error('Voyage embeddings response missing an embedding vector.');
  }

  return {
    embedding: item.embedding,
    tokens: (data.usage && data.usage.total_tokens) || 0,
  };
}

module.exports = { embed, VOYAGE_MODEL, VOYAGE_DIMENSION };
