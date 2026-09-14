/**
 * Knowledge Assistant routes — POST /api/assistant/ask.
 *
 * This is the first route in the app that spends real external money per
 * request (Voyage embeddings + Anthropic generation), so it carries two
 * guards neither /api/calculate nor any other route needs: a tighter,
 * dedicated rate limit, and a hard daily spend cap checked against the
 * actual logged cost in assistant_queries (not a guessed request count).
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { createRateLimiter } = require('../middleware/rate-limiter');
const { answerQuestion } = require('../engine/domain/knowledge-assistant-engine');
const knowledgeRepo = require('../db/repositories/knowledge-repo');
const knowledgeKeys = require('../ai/knowledge-keys');
const voyageClient = require('../ai/voyage-client');
const anthropicClient = require('../ai/anthropic-client');

const askLimiter = createRateLimiter({
  name: 'assistant-ask',
  max: 8,
  windowMs: 60 * 60 * 1000, // 1 hour
  message: 'Too many questions — please wait before asking another.',
});

// A coarse, cheap-to-check daily ceiling on total estimated spend. This is a
// SAFETY NET, not a precision budget (per-process, and Passenger may run
// more than one worker — same caveat the general rate limiter documents) —
// its job is to stop a runaway cost event, not meter billing exactly.
const DAILY_BUDGET_USD = parseFloat(process.env.ASSISTANT_DAILY_BUDGET_USD) || 5.0;

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 16);
}

router.post('/ask', askLimiter, async (req, res) => {
  const startTime = Date.now();
  const question = (req.body && req.body.question) || '';

  try {
    const spentToday = await knowledgeRepo.todaySpendUsd();
    if (spentToday >= DAILY_BUDGET_USD) {
      return res.status(503).json({
        success: false,
        error: 'The Knowledge Assistant has reached its daily usage budget — please try again tomorrow.',
      });
    }

    const [anthropicKey, voyageKey] = await Promise.all([
      knowledgeKeys.getAnthropicKey(),
      knowledgeKeys.getVoyageKey(),
    ]);
    if (!anthropicKey || !voyageKey) {
      return res.status(503).json({
        success: false,
        error: 'The Knowledge Assistant is not configured yet (missing API key).',
      });
    }

    const result = await answerQuestion({
      question,
      embedFn: (text, inputType) => voyageClient.embed(text, voyageKey, inputType),
      searchFn: (embedding, questionText, topK) => knowledgeRepo.search(embedding, questionText, topK),
      generateFn: (systemPrompt, q) => anthropicClient.generate(systemPrompt, q, anthropicKey),
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    knowledgeRepo.recordQuery({
      question,
      answerPreview: (result.answer || '').slice(0, 200),
      sourcesUsed: result.sources,
      chunksRetrieved: result.chunks_retrieved,
      embeddingTokens: result.embedding_tokens,
      inputTokens: result.input_tokens,
      outputTokens: result.output_tokens,
      costUsdEstimate: result.cost_usd_estimate,
      grounded: result.grounded,
      responseMs: Date.now() - startTime,
      ipHash: hashIp(req.ip),
    }).catch(() => {}); // logging must never break the response it describes

    res.json({
      success: true,
      answer: result.answer,
      grounded: result.grounded,
      sources: result.sources,
      response_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[Assistant] /ask failed:', err.message);
    res.status(500).json({ success: false, error: 'The Knowledge Assistant is temporarily unavailable.' });
  }
});

module.exports = router;
