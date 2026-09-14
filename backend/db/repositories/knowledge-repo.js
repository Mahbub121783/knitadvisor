/**
 * Knowledge Assistant repository — the RAG chunk store and its usage ledger.
 *
 * pgvector has no native node-postgres type: an embedding is sent as the
 * pgvector text literal `[0.1,0.2,...]` and cast with `::vector` in the SQL,
 * which is what `toVectorLiteral` below exists for.
 */
const { query, queryOne } = require('../client');

function toVectorLiteral(embedding) {
  if (!Array.isArray(embedding)) throw new Error('embedding must be an array of numbers');
  return `[${embedding.join(',')}]`;
}

/** Insert or refresh one knowledge chunk (keyed on source_module + source_ref). */
async function upsertChunk({ sourceModule, sourceRef, title, content, contentHash, embedding, embeddingModel }) {
  await query(
    `INSERT INTO knowledge_chunks
       (source_module, source_ref, title, content, content_hash, embedding, embedding_model, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::vector,$7,now())
     ON CONFLICT (source_module, source_ref) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       content_hash = EXCLUDED.content_hash,
       embedding = EXCLUDED.embedding,
       embedding_model = EXCLUDED.embedding_model,
       updated_at = now()`,
    [sourceModule, sourceRef, title, content, contentHash, toVectorLiteral(embedding), embeddingModel]
  );
}

/** content_hash for every existing chunk, so the indexer can skip unchanged content. */
async function existingHashes() {
  const rows = await query('SELECT source_module, source_ref, content_hash FROM knowledge_chunks');
  const map = new Map();
  for (const r of rows) map.set(`${r.source_module}::${r.source_ref}`, r.content_hash);
  return map;
}

async function chunkCount() {
  const row = await queryOne('SELECT count(*)::int AS n FROM knowledge_chunks');
  return row ? row.n : 0;
}

/**
 * Hybrid retrieval: vector cosine distance ranks the primary candidates,
 * pg_trgm similarity on exact terminology is blended in as a secondary
 * score so a query naming a specific textile term (e.g. "pique") is not
 * lost to a semantically-nearby-but-wrong neighbourhood. Both run in one
 * query rather than two round trips.
 */
async function search(queryEmbedding, questionText, topK = 6) {
  return query(
    `SELECT
       source_module, source_ref, title, content,
       1 - (embedding <=> $1::vector) AS vector_similarity,
       similarity(content, $2) AS trgm_similarity,
       (0.75 * (1 - (embedding <=> $1::vector))) + (0.25 * similarity(content, $2)) AS blended_score
     FROM knowledge_chunks
     ORDER BY blended_score DESC
     LIMIT $3`,
    [toVectorLiteral(queryEmbedding), questionText, topK]
  );
}

/** Records one assistant query for cost/abuse visibility — never blocks the response on failure. */
async function recordQuery(entry) {
  try {
    await query(
      `INSERT INTO assistant_queries
         (question, answer_preview, sources_used, chunks_retrieved,
          embedding_tokens, input_tokens, output_tokens, cost_usd_estimate,
          grounded, response_ms, ip_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        entry.question,
        entry.answerPreview ?? null,
        entry.sourcesUsed ? JSON.stringify(entry.sourcesUsed) : null,
        entry.chunksRetrieved ?? 0,
        entry.embeddingTokens ?? null,
        entry.inputTokens ?? null,
        entry.outputTokens ?? null,
        entry.costUsdEstimate ?? null,
        entry.grounded ?? null,
        entry.responseMs ?? null,
        entry.ipHash ?? null,
      ]
    );
  } catch (err) {
    console.error('[KnowledgeAssistant] Failed to record query:', err.message);
  }
}

/** Total estimated spend so far today (server-local date — a coarse budget guard, not a billing figure). */
async function todaySpendUsd() {
  const row = await queryOne(
    `SELECT coalesce(sum(cost_usd_estimate), 0)::numeric AS total
     FROM assistant_queries WHERE created_at >= date_trunc('day', now())`
  );
  return row ? Number(row.total) : 0;
}

/** Paged usage log for the admin panel. */
async function listQueries({ page = 1, limit = 25 } = {}) {
  const [{ count }] = await query('SELECT count(*)::int AS count FROM assistant_queries');
  const rows = await query(
    `SELECT id, question, answer_preview, sources_used, chunks_retrieved,
            input_tokens, output_tokens, cost_usd_estimate, grounded, response_ms, created_at
     FROM assistant_queries ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, (page - 1) * limit]
  );
  return { rows, total: count, page, pages: Math.ceil(count / limit) };
}

module.exports = {
  toVectorLiteral,
  upsertChunk,
  existingHashes,
  chunkCount,
  search,
  recordQuery,
  todaySpendUsd,
  listQueries,
};
