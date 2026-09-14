const assert = require('assert');
const {
  answerQuestion, validateQuestion, buildSystemPrompt, isGrounded,
  estimateCostUsd, extractSources, NOT_COVERED_PREFIX,
} = require('../engine/domain/knowledge-assistant-engine');

async function main() {
  console.log('--- Running Knowledge Assistant Engine Tests ---');

  // ==========================================================================
  // 1. Question validation — length bounds, trimming.
  // ==========================================================================
  assert.strictEqual(validateQuestion('').ok, false, 'Empty question should fail');
  assert.strictEqual(validateQuestion('  hi').ok, false, 'Too-short question should fail (2 chars after trim)');
  assert.strictEqual(validateQuestion('a'.repeat(501)).ok, false, 'Over-length question should fail');
  const ok = validateQuestion('  What is a pique knit?  ');
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.question, 'What is a pique knit?', 'Should trim whitespace');
  console.log('  Question validation OK (bounds + trimming)');

  // ==========================================================================
  // 2. System prompt construction — must embed every chunk's content and
  //    enforce the NOT_COVERED sentinel instruction.
  // ==========================================================================
  {
    const chunks = [
      { title: 'Cotton wet strength', source_module: 'fibre_advisory', content: 'Cotton gains strength when wet due to...' },
      { title: 'Popcorn blister structure', source_module: 'fabric_derivatives', content: 'Popcorn blister uses a 4-vs-6 course mismatch...' },
    ];
    const prompt = buildSystemPrompt(chunks);
    assert(prompt.includes('Cotton gains strength when wet'), 'Prompt should include chunk 1 content');
    assert(prompt.includes('Popcorn blister uses a 4-vs-6'), 'Prompt should include chunk 2 content');
    assert(prompt.includes(NOT_COVERED_PREFIX), 'Prompt must instruct the NOT_COVERED sentinel');
    assert(prompt.includes('ONLY'), 'Prompt must forbid outside knowledge');
    console.log('  System prompt correctly embeds all chunks + grounding rules');
  }

  // ==========================================================================
  // 3. Grounding detection — sentinel-based, not fuzzy text matching.
  // ==========================================================================
  assert.strictEqual(isGrounded('Cotton absorbs moisture readily because...'), true);
  assert.strictEqual(isGrounded(`${NOT_COVERED_PREFIX} This is not covered.`), false);
  assert.strictEqual(isGrounded(`  ${NOT_COVERED_PREFIX} leading whitespace`), false, 'Should trim before checking prefix');
  console.log('  Grounding detection (NOT_COVERED sentinel) correct');

  // ==========================================================================
  // 4. Cost estimation — hand-computed cross-check against the sourced rates
  //    (Voyage voyage-4-lite $0.02/M, Sonnet 5 $2/$10 per MTok).
  // ==========================================================================
  {
    const cost = estimateCostUsd({ embeddingTokens: 1000, inputTokens: 2000, outputTokens: 500 });
    const expected = (1000 * 0.02 / 1e6) + (2000 * 2 / 1e6) + (500 * 10 / 1e6);
    assert(Math.abs(cost - expected) < 1e-9, `Cost estimate mismatch: got ${cost}, expected ${expected}`);
    assert.strictEqual(estimateCostUsd({}), 0, 'No tokens should cost nothing');
    console.log(`  Cost estimation matches hand-computed value: $${cost}`);
  }

  // ==========================================================================
  // 5. extractSources — shape check, no leakage of chunk content into the
  //    source list (sources shown to the user must stay internal-navigation
  //    labels, never full text or an external URL).
  // ==========================================================================
  {
    const sources = extractSources([{ source_module: 'dyeing_faults', source_ref: 'crease_mark', title: 'Crease Marks', content: 'long text...' }]);
    assert.strictEqual(sources.length, 1);
    assert.deepStrictEqual(Object.keys(sources[0]).sort(), ['source_module', 'source_ref', 'title']);
    console.log('  extractSources returns only module/ref/title, never raw content');
  }

  // ==========================================================================
  // 6. Full orchestration — relevance floor skips generation entirely for an
  //    off-topic question (asserting the mocked generateFn is NEVER called).
  // ==========================================================================
  {
    let generateCalled = false;
    const result = await answerQuestion({
      question: 'What is the capital of France?',
      embedFn: async () => ({ embedding: [0.1, 0.2], tokens: 5 }),
      searchFn: async () => ([{ title: 'Unrelated', source_module: 'x', content: 'y', blended_score: 0.05 }]),
      generateFn: async () => { generateCalled = true; return { text: 'Paris', inputTokens: 10, outputTokens: 5, refused: false }; },
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.grounded, false);
    assert.strictEqual(result.generation_skipped, true);
    assert.strictEqual(generateCalled, false, 'generateFn must NOT be called below the relevance floor');
    assert.strictEqual(result.output_tokens, 0);
    console.log('  Relevance floor correctly skips generation for off-topic questions (cost saved)');
  }

  // ==========================================================================
  // 7. Full orchestration — on-topic question with strong relevance calls
  //    generateFn and returns grounded=true with sources.
  // ==========================================================================
  {
    const result = await answerQuestion({
      question: 'What causes crease marks in dyeing?',
      embedFn: async () => ({ embedding: [0.5, 0.5], tokens: 8 }),
      searchFn: async () => ([
        { title: 'Crease Marks', source_module: 'dyeing_faults', source_ref: 'crease_mark', content: 'Crease marks form when fabric folds during dyeing...', blended_score: 0.82 },
      ]),
      generateFn: async (systemPrompt, question) => {
        assert(systemPrompt.includes('Crease marks form when fabric folds'), 'System prompt must reach generateFn with the retrieved content');
        assert.strictEqual(question, 'What causes crease marks in dyeing?');
        return { text: 'Crease marks form from fabric folding under tension during the dyeing process (Source 1).', inputTokens: 120, outputTokens: 25, refused: false };
      },
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.grounded, true);
    assert.strictEqual(result.sources.length, 1);
    assert.strictEqual(result.sources[0].source_ref, 'crease_mark');
    assert(result.cost_usd_estimate > 0);
    console.log('  On-topic question correctly generates a grounded answer with sources');
  }

  // ==========================================================================
  // 8. Model declines to answer despite relevant chunks -> grounded=false,
  //    answer carries the NOT_COVERED sentinel (model followed instructions
  //    correctly rather than guessing).
  // ==========================================================================
  {
    const result = await answerQuestion({
      question: 'What is the exact tensile strength of viscose at 40% RH?',
      embedFn: async () => ({ embedding: [0.4], tokens: 6 }),
      searchFn: async () => ([{ title: 'Fibre mechanics', source_module: 'fibre_advisory', content: 'General wet/dry strength ratios...', blended_score: 0.6 }]),
      generateFn: async () => ({ text: `${NOT_COVERED_PREFIX} Exact tensile strength at 40% RH is not in the reference material.`, inputTokens: 90, outputTokens: 20, refused: false }),
    });
    assert.strictEqual(result.grounded, false);
    assert.strictEqual(result.sources.length, 0, 'A declined answer must not claim sources');
    console.log('  Model declining despite retrieved chunks is correctly reported as not-grounded');
  }

  // ==========================================================================
  // 9. Anthropic refusal (safety decline) handled distinctly, never thrown.
  // ==========================================================================
  {
    const result = await answerQuestion({
      question: 'How do I bypass a dyeing machine safety interlock?',
      embedFn: async () => ({ embedding: [0.3], tokens: 5 }),
      searchFn: async () => ([{ title: 'Dyeing machine safety', source_module: 'dyeing_theory', content: 'Safety interlocks prevent...', blended_score: 0.7 }]),
      generateFn: async () => ({ text: '', inputTokens: 50, outputTokens: 0, refused: true }),
    });
    assert.strictEqual(result.success, true, 'A refusal must be a clean result, not a throw');
    assert.strictEqual(result.grounded, false);
    console.log('  Anthropic refusal handled cleanly (no throw)');
  }

  // ==========================================================================
  // 10. Bad-input / missing-dependency handling.
  // ==========================================================================
  {
    const missingDeps = await answerQuestion({ question: 'valid question here' });
    assert.strictEqual(missingDeps.success, false);

    const badQuestion = await answerQuestion({
      question: 'hi',
      embedFn: async () => ({ embedding: [], tokens: 0 }),
      searchFn: async () => [],
      generateFn: async () => ({ text: '', inputTokens: 0, outputTokens: 0, refused: false }),
    });
    assert.strictEqual(badQuestion.success, false, 'Too-short question should fail cleanly');

    const embedThrows = await answerQuestion({
      question: 'a valid length question',
      embedFn: async () => { throw new Error('network down'); },
      searchFn: async () => [],
      generateFn: async () => ({ text: '', inputTokens: 0, outputTokens: 0, refused: false }),
    });
    assert.strictEqual(embedThrows.success, false);
    assert(/embed/.test(embedThrows.error));

    console.log('  Bad-input and dependency-failure handling OK (no throws)');
  }

  console.log('\nAll Knowledge Assistant Engine Tests Passed!');
}

main().catch(err => {
  console.error('\nKnowledge Assistant Engine Tests FAILED:', err);
  process.exitCode = 1;
});
