/**
 * Anthropic Messages API — thin client using the official SDK
 * (@anthropic-ai/sdk), per this app's own instruction that Claude calls
 * always go through the official SDK, never a raw-HTTP or OpenAI-shaped
 * shim (see the other providers' shims in provider-manager-v2.js, which are
 * NOT the pattern to copy here).
 *
 * Model: Claude Sonnet 5 ($2/$10 per MTok) — a deliberate, cost-conscious
 * choice over Opus 5 for this specific route. This is short, grounded Q&A
 * over retrieved context on a public, unauthenticated page — not complex
 * agentic reasoning — and Sonnet-tier quality is the right fit for that
 * shape of workload. Configurable via ASSISTANT_MODEL if that judgment
 * changes later.
 */
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.ASSISTANT_MODEL || 'claude-sonnet-5';
const MAX_TOKENS = 2048;

/**
 * @param {string} systemPrompt — the grounding instructions + retrieved context
 * @param {string} question — the user's question
 * @param {string} apiKey
 * @returns {Promise<{text: string, inputTokens: number, outputTokens: number, refused: boolean}>}
 */
async function generate(systemPrompt, question, apiKey) {
  if (!apiKey) throw new Error('Anthropic API key not configured — add it in the admin panel under AI Providers (type "anthropic").');

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: question }],
  });

  // Always check stop_reason before reading content — a "refusal" carries no
  // usable text block, and stop_details is populated only in that case.
  if (response.stop_reason === 'refusal') {
    return {
      text: '',
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
      refused: true,
    };
  }

  const textBlock = response.content.find(b => b.type === 'text');

  return {
    text: textBlock ? textBlock.text : '',
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    refused: false,
  };
}

module.exports = { generate, MODEL };
