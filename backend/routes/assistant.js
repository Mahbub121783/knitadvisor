/**
 * Knowledge Assistant routes — POST /api/assistant/ask.
 *
 * Runs on this app's own existing multi-provider AI infrastructure (Groq,
 * Mistral, and whichever others are enabled in the admin panel's AI
 * Providers screen — see ai/multi-provider-chat.js) for generation, and
 * Mistral specifically for embeddings (ai/multi-provider-embed.js — fixed
 * to one provider for a real technical reason, not a preference; see that
 * file). No Anthropic, no Voyage, no separate paid API of its own.
 *
 * Real per-token cost is not tracked (see knowledge-assistant-engine.js's
 * PRICING_USD_PER_TOKEN — deliberately $0, not fabricated across a rotating
 * multi-provider setup with unknown-in-advance pricing), so the daily spend
 * cap below is a harmless no-op today; the request-volume rate limit is
 * this route's real abuse guard, alongside each provider's own
 * daily_limit/per_min_limit already enforced in ai_provider_stats.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { createRateLimiter } = require('../middleware/rate-limiter');
const { answerQuestion } = require('../engine/domain/knowledge-assistant-engine');
const knowledgeRepo = require('../db/repositories/knowledge-repo');
const multiProviderEmbed = require('../ai/multi-provider-embed');
const multiProviderChat = require('../ai/multi-provider-chat');

const askLimiter = createRateLimiter({
  name: 'assistant-ask',
  max: 8,
  windowMs: 60 * 60 * 1000, // 1 hour
  message: 'Too many questions — please wait before asking another.',
});

// A coarse, cheap-to-check daily ceiling on total estimated spend. Harmless
// no-op while PRICING_USD_PER_TOKEN is $0 (see knowledge-assistant-engine.js) —
// kept as a safety net in case real per-provider pricing is wired in later.
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

    const result = await answerQuestion({
      question,
      embedFn: (text, inputType) => multiProviderEmbed.embed(text, inputType),
      searchFn: (embedding, questionText, topK) => knowledgeRepo.search(embedding, questionText, topK),
      generateFn: (systemPrompt, q) => multiProviderChat.generateAnswer(systemPrompt, q),
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
    // Embedding/generation failures (e.g. "no active Mistral key configured",
    // "all AI providers failed") carry a genuinely useful message — surface
    // it rather than a fully generic one, but never a raw stack trace.
    const clientMessage = /no active|not configured|no ai provider|all ai providers/i.test(err.message)
      ? err.message
      : 'The Knowledge Assistant is temporarily unavailable.';
    res.status(503).json({ success: false, error: clientMessage });
  }
});

module.exports = router;
