/**
 * KnitAdvisor — Knowledge Assistant (RAG) Engine
 * =================================================
 *
 * Orchestrates: embed the question -> hybrid-search knowledge_chunks ->
 * build a strictly-grounded system prompt from the retrieved chunks ->
 * generate an answer -> report which sources were actually used.
 *
 * Every external call (embedding, DB search, generation) is INJECTED rather
 * than imported directly, the same dependency-injection shape costing-engine.js
 * uses for `live_prices` — it is what lets this engine's actual logic (prompt
 * construction, grounding detection, cost estimation, the relevance floor) be
 * unit-tested with no network and no database, matching this app's test
 * suite's own "dependency-free and DB-free" rule (scripts/run-tests.js).
 *
 * ── THE GROUNDING DISCIPLINE (why this exists at all) ──────────────────────
 * An LLM given a textile question and no constraint will confidently answer
 * from its general training knowledge — which may be subtly wrong, or just
 * not what THIS app's own reference data (the Morton & Hearle citations, the
 * factory fault records, the sourced SAM/wage-board numbers) actually says.
 * The system prompt built here hard-forbids that: answer ONLY from the
 * supplied context, and say so explicitly (a fixed, machine-checkable
 * sentinel — see NOT_COVERED_PREFIX) when the context does not cover the
 * question, rather than filling the gap with outside knowledge. This is the
 * same "say so, don't guess" convention already used throughout this
 * codebase's reference-data layer, applied to an LLM instead of a formula.
 *
 * ── COST CONTROL BY DESIGN ──────────────────────────────────────────────────
 * If the best retrieved chunk's blended relevance score is below
 * RELEVANCE_FLOOR, this engine returns "not covered" WITHOUT calling the
 * generation model at all — a clearly off-topic question costs one cheap
 * embedding call, not one embedding call plus one generation call.
 */

const NOT_COVERED_PREFIX = 'NOT_COVERED:';
const RELEVANCE_FLOOR = 0.35;
const DEFAULT_TOP_K = 6;
const MIN_QUESTION_LENGTH = 3;
const MAX_QUESTION_LENGTH = 500;

// Sourced pricing, current as of this engine's writing — see
// ai/voyage-client.js and ai/anthropic-client.js for the model choices these
// rates belong to. Kept here (not imported) because this file must stay
// network/SDK-free for the "pure engine" testing guarantee above.
const PRICING_USD_PER_TOKEN = {
  voyage_embedding: 0.02 / 1_000_000,   // voyage-4-lite
  sonnet5_input: 2 / 1_000_000,          // claude-sonnet-5 input
  sonnet5_output: 10 / 1_000_000,        // claude-sonnet-5 output
};

function round6(v) { return Math.round(v * 1e6) / 1e6; }

function validateQuestion(question) {
  const q = (question || '').trim();
  if (q.length < MIN_QUESTION_LENGTH) return { ok: false, error: `Question is too short (minimum ${MIN_QUESTION_LENGTH} characters).` };
  if (q.length > MAX_QUESTION_LENGTH) return { ok: false, error: `Question is too long (maximum ${MAX_QUESTION_LENGTH} characters).` };
  return { ok: true, question: q };
}

/** Builds the strictly-grounded system prompt from the retrieved chunks. */
function buildSystemPrompt(chunks) {
  const context = chunks.map((c, i) =>
    `[Source ${i + 1}: ${c.title} — ${c.source_module}]\n${c.content}`
  ).join('\n\n---\n\n');

  return `You are the KnitAdvisor Knowledge Assistant, answering questions about textile/knitting engineering using ONLY the reference material below — content this app's own engines already cite (fibre science, dyeing theory and faults, wet processing, garment costing methodology, woven/knit structure reference).

STRICT RULES:
1. Answer using ONLY the information in the "REFERENCE MATERIAL" section below. Do not use outside knowledge, even if you believe it is correct.
2. If the reference material does not contain enough information to answer the question, respond with EXACTLY this format and nothing else: "${NOT_COVERED_PREFIX} <one sentence naming what is not covered>". Do not guess or partially answer from outside knowledge in this case.
3. When you do answer, be concise and specific (typical answer: 2-5 sentences, more only if the question genuinely needs it). Reference which numbered source(s) you drew from where it aids trust, e.g. "(Source 2)".
4. Never invent a citation, a number, or a textile fact not present in the reference material.

REFERENCE MATERIAL:
${context}`;
}

/** True if the model answered from context rather than declining. */
function isGrounded(answerText) {
  return !(answerText || '').trim().startsWith(NOT_COVERED_PREFIX);
}

function estimateCostUsd({ embeddingTokens = 0, inputTokens = 0, outputTokens = 0 }) {
  return round6(
    embeddingTokens * PRICING_USD_PER_TOKEN.voyage_embedding +
    inputTokens * PRICING_USD_PER_TOKEN.sonnet5_input +
    outputTokens * PRICING_USD_PER_TOKEN.sonnet5_output
  );
}

function extractSources(chunks) {
  return chunks.map(c => ({
    source_module: c.source_module,
    source_ref: c.source_ref,
    title: c.title,
  }));
}

/**
 * @param {object} params
 *   question    — the user's question (required)
 *   embedFn     — (text, inputType) => Promise<{embedding: number[], tokens: number}>  (required)
 *   searchFn    — (embedding, questionText, topK) => Promise<chunk[]>  (required)
 *   generateFn  — (systemPrompt, question) => Promise<{text, inputTokens, outputTokens, refused}>  (required)
 *   topK        — default 6
 *   relevanceFloor — default 0.35
 */
async function answerQuestion(params = {}) {
  const startTime = Date.now();

  const validated = validateQuestion(params.question);
  if (!validated.ok) return { success: false, error: validated.error };

  if (typeof params.embedFn !== 'function' || typeof params.searchFn !== 'function' || typeof params.generateFn !== 'function') {
    return { success: false, error: 'embedFn, searchFn and generateFn are all required.' };
  }

  const question = validated.question;
  const topK = params.topK || DEFAULT_TOP_K;
  const relevanceFloor = params.relevanceFloor != null ? params.relevanceFloor : RELEVANCE_FLOOR;

  // ---- 1. Embed the question ----
  let embedResult;
  try {
    embedResult = await params.embedFn(question, 'query');
  } catch (err) {
    return { success: false, error: `Could not embed the question: ${err.message}` };
  }

  // ---- 2. Retrieve candidate chunks ----
  let chunks;
  try {
    chunks = await params.searchFn(embedResult.embedding, question, topK);
  } catch (err) {
    return { success: false, error: `Knowledge search failed: ${err.message}` };
  }

  const bestScore = chunks.length ? Number(chunks[0].blended_score) : 0;

  // ---- 3. Relevance floor: skip generation entirely for off-topic questions ----
  if (!chunks.length || bestScore < relevanceFloor) {
    return {
      success: true,
      grounded: false,
      answer: `${NOT_COVERED_PREFIX} This question doesn't appear to be covered by KnitAdvisor's knowledge base.`,
      sources: [],
      chunks_retrieved: chunks.length,
      best_relevance_score: round6(bestScore),
      embedding_tokens: embedResult.tokens,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd_estimate: estimateCostUsd({ embeddingTokens: embedResult.tokens }),
      response_ms: Date.now() - startTime,
      generation_skipped: true,
    };
  }

  // ---- 4. Generate, strictly grounded in the retrieved chunks ----
  const systemPrompt = buildSystemPrompt(chunks);
  let genResult;
  try {
    genResult = await params.generateFn(systemPrompt, question);
  } catch (err) {
    return { success: false, error: `Answer generation failed: ${err.message}` };
  }

  if (genResult.refused) {
    return {
      success: true,
      grounded: false,
      answer: `${NOT_COVERED_PREFIX} The assistant declined to answer this question.`,
      sources: [],
      chunks_retrieved: chunks.length,
      best_relevance_score: round6(bestScore),
      embedding_tokens: embedResult.tokens,
      input_tokens: genResult.inputTokens,
      output_tokens: genResult.outputTokens,
      cost_usd_estimate: estimateCostUsd({ embeddingTokens: embedResult.tokens, inputTokens: genResult.inputTokens, outputTokens: genResult.outputTokens }),
      response_ms: Date.now() - startTime,
      generation_skipped: false,
    };
  }

  const grounded = isGrounded(genResult.text);

  return {
    success: true,
    grounded,
    answer: genResult.text,
    sources: grounded ? extractSources(chunks) : [],
    chunks_retrieved: chunks.length,
    best_relevance_score: round6(bestScore),
    embedding_tokens: embedResult.tokens,
    input_tokens: genResult.inputTokens,
    output_tokens: genResult.outputTokens,
    cost_usd_estimate: estimateCostUsd({ embeddingTokens: embedResult.tokens, inputTokens: genResult.inputTokens, outputTokens: genResult.outputTokens }),
    response_ms: Date.now() - startTime,
    generation_skipped: false,
  };
}

module.exports = {
  answerQuestion,
  validateQuestion,
  buildSystemPrompt,
  isGrounded,
  estimateCostUsd,
  extractSources,
  NOT_COVERED_PREFIX,
  RELEVANCE_FLOOR,
  DEFAULT_TOP_K,
  MIN_QUESTION_LENGTH,
  MAX_QUESTION_LENGTH,
  PRICING_USD_PER_TOKEN,
};
