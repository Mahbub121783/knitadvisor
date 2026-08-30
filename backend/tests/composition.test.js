const assert = require('assert');
const { parseComposition, FIBER_ALIASES } = require('../engine/domain/composition-engine');

console.log('--- Running Composition Parsing Tests ---');

const fibres = s => {
  const r = parseComposition(s);
  assert(r, `"${s}" did not parse at all`);
  return r.fibers;
};

// ── ISO generic codes ───────────────────────────────────────────────────
// Buyers write compositions this way on care labels and in specs. None of
// these parsed before; "95% CO 5% EL" came back as cotton and POLYESTER.
// Sources: Morton & Hearle Appendix II (p.740-742) for the manufactured-fibre
// codes; ISO 2076 for the natural ones, which that appendix does not cover.
const CODE_CASES = [
  ['100% CO', { cotton: 100 }],
  ['100% WO', { wool: 100 }],
  ['100% PA', { nylon: 100 }],
  ['100% PAN', { acrylic: 100 }],
  ['60% CV 40% PES', { viscose: 60, polyester: 40 }],
  ['95% CO 5% EL', { cotton: 95, elastane: 5 }],
  ['92% PES 8% EL', { polyester: 92, elastane: 8 }],
  ['70% CO 30% LI', { cotton: 70, linen: 30 }],
  ['48% CMD 52% CO', { viscose: 48, cotton: 52 }],
];

for (const [input, want] of CODE_CASES) {
  const got = fibres(input);
  console.log(`  ${input.padEnd(20)} -> ${JSON.stringify(got)}`);
  assert.deepStrictEqual(got, want, `"${input}" parsed as ${JSON.stringify(got)}`);
}

// The elastane flag is what drives plating, shrinkage and machine setup, so a
// mis-read code does not merely mislabel the blend — it switches a whole branch
// of the calculation off.
const stretch = parseComposition('95% CO 5% EL');
assert(stretch.has_elastane === true, 'a CO/EL blend must be recognised as containing elastane');
assert(stretch.elastane_pct === 5, `elastane_pct was ${stretch.elastane_pct}`);
console.log('  elastane flag set from the ISO code: ok');

// ── The written-out forms must still work ───────────────────────────────
const WORD_CASES = [
  ['100% Cotton', { cotton: 100 }],
  ['95% Cotton 5% Elastane', { cotton: 95, elastane: 5 }],
  ['65% Polyester 35% Cotton', { polyester: 65, cotton: 35 }],
  ['60% Cotton 40% Polyester', { cotton: 60, polyester: 40 }],
  ['85% Cotton 15% Viscose', { cotton: 85, viscose: 15 }],
];
for (const [input, want] of WORD_CASES) {
  assert.deepStrictEqual(fibres(input), want, `"${input}" regressed`);
}
console.log('  written-out compositions unchanged: ok');

// ── Short inputs must not be resolved by substring ──────────────────────
// This is the defect the codes were added around. resolveFiber compared each
// alias against the input in BOTH directions, so any two-letter string reached
// whichever alias happened to contain it — "el" found the mis-spelled alias
// 'recycel polyester'. A code now has to be listed to be understood.
const NONSENSE = ['100% ZQ', '100% XX', '100% QQ'];
for (const input of NONSENSE) {
  const r = parseComposition(input);
  const parsed = r && Object.keys(r.fibers || {}).length > 0;
  assert(!parsed, `"${input}" should not resolve to a fibre, got ${JSON.stringify(r && r.fibers)}`);
}
console.log('  unknown two-letter codes resolve to nothing rather than guessing: ok');

// Every alias short enough to be ambiguous must be an exact entry, since short
// inputs no longer match by substring at all.
const shortAliases = Object.keys(FIBER_ALIASES).filter(a => a.length < 4);
assert(shortAliases.length > 0, 'the short-code table went missing');
for (const alias of shortAliases) {
  const got = fibres(`100% ${alias.toUpperCase()}`);
  assert.deepStrictEqual(got, { [FIBER_ALIASES[alias]]: 100 },
    `short alias "${alias}" no longer resolves`);
}
console.log(`  all ${shortAliases.length} short aliases resolve exactly: ok`);

// ── Fibres the parser can now produce must be known downstream ──────────
// Adding wool and acrylic to the parser is only useful if the physics table
// carries them; otherwise blendPhysical silently skips the fibre and falls back
// to cotton's density and regain.
const { FIBER_PROPERTIES } = require('../engine/domain/yarn-engine');
const produced = [...new Set(Object.values(FIBER_ALIASES))];
const unknown = produced.filter(f => !FIBER_PROPERTIES[f]);
console.log(`  parser can produce ${produced.length} fibres; ${unknown.length} have no physical properties: ${unknown.join(', ') || 'none'}`);
assert(!unknown.includes('wool') && !unknown.includes('acrylic'),
  'wool and acrylic must have density and regain, since the parser now emits them');

// A blend containing a fibre with no physical properties must SAY so. It used
// to renormalise over the fibres it knew, so "70% cotton 30% linen" returned
// cotton's density exactly and the linen left no trace.
const { blendPhysical } = require('../engine/domain/yarn-engine');
const mixed = blendPhysical({ cotton: 70, linen: 30 });
assert.deepStrictEqual(mixed.unweighed, ['linen'], 'the unweighed fibre must be named');
assert.strictEqual(mixed.weighed_pct, 70, `only 70% was weighed, got ${mixed.weighed_pct}`);
const known = blendPhysical({ cotton: 60, polyester: 40 });
assert.deepStrictEqual(known.unweighed, [], 'a fully known blend reports nothing unweighed');
assert.strictEqual(known.weighed_pct, 100);
console.log('  a blend reports the fibres it could not weigh: ok');

console.log('All Composition Parsing Tests Passed!');
