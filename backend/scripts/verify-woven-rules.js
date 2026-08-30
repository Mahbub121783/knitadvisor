#!/usr/bin/env node
/**
 * Verify the woven rules extracted from Gokarneshan against the book itself.
 *
 *   node scripts/verify-woven-rules.js
 *
 * WHY THIS EXISTS
 * ---------------
 * Extracting numbers from a PDF is not the same as extracting them correctly.
 * The last import that trusted a parse shipped four factory records with
 * concatenated GSM readings (143148, 264256) straight into the database.
 *
 * So nothing from this book is trusted because it was read carefully. Each
 * rule is re-derived independently and checked against the book's own printed
 * table and worked examples. A rule that cannot be reproduced is reported, not
 * imported.
 */
'use strict';

const W = require('../engine/formulas/woven');
const REF = require('../data/woven-reference.json');

let pass = 0, fail = 0;
const failures = [];

function check(ok, label, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : (fail++, failures.push(label + (detail ? ': ' + detail : '')));
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. Move numbers: derivation vs the book's printed table (p.30) ──────────
console.log('\nSATIN MOVE NUMBERS  derived from the p.28 rules vs the p.30 table');
for (const [repeatStr, bookList] of Object.entries(W.BOOK_MOVE_NUMBERS)) {
  const repeat = Number(repeatStr);
  const derived = W.suitableMoveNumbers(repeat).primary;
  check(eq(derived, bookList), `${repeat}-end satin`,
        `book ${JSON.stringify(bookList)} · derived ${JSON.stringify(derived)}`);
}
// The book's table skips 6. If the rules are right, 6 must be unconstructible.
const six = W.suitableMoveNumbers(6);
check(!six.constructible, '6-end satin is impossible, which is why the book omits it',
      `no move in 2..4 is coprime with 6`);

// ── 2. Worked examples stated in the text ──────────────────────────────────
console.log('\nWORKED EXAMPLES  the book states the answer; we recompute it');
const r = W.weaveRepeatSize(2, 1);
check(r.repeat_ends === 3 && r.repeat_picks === 3,
      'p.8  — "in case of a 2/1 twill the repeat size is 3 x 3"', `${r.repeat_ends} x ${r.repeat_picks}`);

const skip = W.brokenTwillSkip(4);
check(skip.ends_to_miss === 1,
      'p.34 — broken twill on N=4: "4/2 - 1 = 2 - 1 = 1"', `ends to miss = ${skip.ends_to_miss}`);

const b16 = W.brightonHoneycomb(16), b20 = W.brightonHoneycomb(20);
check(b16.valid_repeat && b20.valid_repeat && b16.longest_float === 7 && b20.longest_float === 9,
      'p.39 — Brighton honeycomb on repeats of 16 and 20 (Fig 5.2 B and C)',
      `longest floats ${b16.longest_float} and ${b20.longest_float}`);
check(!W.brightonHoneycomb(10).valid_repeat,
      'p.39 — a repeat of 10 is rejected: "repeat size is a multiple of 4"');

// 5-end regular satin with step number 3 (Fig 4.8 D); 8-end with step 3 (Fig 4.8 E)
check(W.validateMoveNumber(5, 3).valid && W.validateMoveNumber(8, 3).valid,
      'p.29 — Fig 4.8 D and E: 5-end and 8-end regular satins on step number 3');
// 4-end satins are called IRREGULAR in the book — they must fail the regular rules
check(!W.validateMoveNumber(4, 1).valid && !W.validateMoveNumber(4, 2).valid,
      'p.29 — Fig 4.8 A and B are named "irregular" satins, and both fail the p.28 rules',
      `move 2 ${W.validateMoveNumber(4, 2).failed_rules.join('; ')}`);

const cork = W.validateCorkscrew(7, 4, 3);
check(cork.valid, 'p.31 — corkscrew on a 7-thread repeat with floats differing by one (Fig 4.12)');
check(!W.validateCorkscrew(8, 4, 4).valid, 'p.31 — an even repeat with equal floats is rejected');

const ang = W.twillAngle(60, 60);
check(ang.band.angle_deg === 45 && ang.angle_deg === 45,
      'p.24 — "when the warp ends/inch is equal to the weft picks/inch, the twill angle will be 45"');
check(W.twillAngle(126, 38).band.label.startsWith('steep'),
      'p.24 — warp rib at 126 epi / 38 ppi is a steep twill', 'epi > ppi');

// ── 3. Colour and weave effects: reproduce the named figures ───────────────
console.log('\nCOLOUR AND WEAVE  do the p.123-126 recipes actually produce the named effect?');

const twill22 = W.generateTwill(2, 2).grid;
const twill31 = W.generateTwill(3, 1).grid;
const render = e => e.effect.map(row => row.join('')).join('\n');

// Hairline (p.125) — the sharpest falsifiable claim in the chapter: "these
// effects produce solid vertical or horizontal lines... each line of colour is
// equal to the width of one thread". Every column must be a single colour.
const solidColumns = e =>
  e.effect[0].every((_, c) => e.effect.every(row => row[c] === e.effect[0][c]));

const hairlineFigure = W.colourWeaveEffect(twill31, ['D', 'L'], ['L', 'D']);
check(solidColumns(hairlineFigure),
      'p.125 — hairline on 3/1 twill gives solid one-thread vertical lines',
      hairlineFigure.effect.map(r => r.join('')).join(' / '));

// The book's TEXT says "1 dark and 4 light". Its FIGURE 15.7 shows D L D L
// along both axes. Only one of the two can be right; test both and report.
const hairlineText = W.colourWeaveEffect(twill31, ['D', 'L', 'L', 'L', 'L'], ['D', 'L', 'L', 'L', 'L']);
check(!solidColumns(hairlineText),
      'p.125 — the printed "1 dark and 4 light" does NOT give solid lines (book typo; Fig 15.7 shows 1 and 1)',
      `repeat ${hairlineText.repeat_ends}x${hairlineText.repeat_picks}, columns not uniform`);

// Step pattern (p.125) — 2/2 twill, 1 dark 1 light both ways.
const step = W.colourWeaveEffect(twill22, ['D', 'L'], ['D', 'L']);
check(step.repeat_ends === 4 && step.repeat_picks === 4 && !solidColumns(step),
      'p.125 — step pattern on 2/2 twill, 1D 1L: diagonal zig-zag, not solid lines',
      `${step.repeat_ends}x${step.repeat_picks}`);

// Hound's tooth (p.124) — 2/2 twill, 4 dark 4 light both ways, repeat 8 x 8.
const hound = W.colourWeaveEffect(twill22, '4 dark, 4 light', '4 dark, 4 light');
const houndSolidBlocks = hound.effect.slice(0, 4).every(row => row.slice(0, 4).every(c => c === 'D'));
check(hound.repeat_ends === 8 && hound.repeat_picks === 8,
      "p.124 — hound's tooth repeats on 8 x 8 (LCM of the 4-thread weave and the 8-thread colouring)",
      `${hound.repeat_ends}x${hound.repeat_picks}`);
check(houndSolidBlocks,
      "p.124 — hound's tooth shows a solid colour block where warp and weft colours agree");

console.log('\n  hairline (Fig 15.7 colouring)        hound\'s tooth (p.124)');
const hl = hairlineFigure.effect.map(r => r.join(''));
const ht = hound.effect.map(r => r.join(''));
for (let i = 0; i < Math.max(hl.length, ht.length); i++) {
  console.log('   ' + (hl[i] || '    ').padEnd(36) + (ht[i] || ''));
}

// ── 4. Extracted data sanity ───────────────────────────────────────────────
console.log('\nEXTRACTED DATA  internal consistency of woven-reference.json');
const slugs = new Set(REF.weaves.map(w => w.slug));
const orphans = REF.constructions.filter(c => !slugs.has(c.weave_slug));
check(orphans.length === 0, 'every construction points at a known weave',
      orphans.map(o => o.cloth).join(', '));

const noPage = [...REF.weaves, ...REF.constructions, ...REF.glossary].filter(x => typeof x.page !== 'number');
check(noPage.length === 0, 'every weave, construction and glossary term carries a page citation',
      String(noPage.length) + ' missing');

const badPage = [...REF.weaves, ...REF.constructions, ...REF.glossary].filter(x => x.page < 1 || x.page > 139);
check(badPage.length === 0, 'every cited page falls inside the book (1-139)');

// Both densities must be present and positive where the book gave a single figure.
const badDensity = REF.constructions.filter(c =>
  (c.ends_per_inch !== undefined && !(c.ends_per_inch > 0)) ||
  (c.picks_per_inch !== undefined && !(c.picks_per_inch > 0)));
check(badDensity.length === 0, 'no zero or negative thread densities survived the parse',
      badDensity.map(c => c.cloth).join(', '));

// The concatenation failure mode that bit the factory import: a plausible-
// looking number that is really two readings joined. Densities above 600/inch
// are not physical for the cloths in this book (the highest the book prints is
// 520 for a twill back velveteen, and it says so explicitly).
const suspicious = REF.constructions.filter(c =>
  (c.ends_per_inch > 600) || (c.picks_per_inch > 600));
check(suspicious.length === 0, 'no density looks like two concatenated readings',
      suspicious.map(c => `${c.cloth} ${c.ends_per_inch}/${c.picks_per_inch}`).join(', '));

console.log('\n' + '='.repeat(64));
if (fail) {
  console.log(`  ${fail} FAILURE(S), ${pass} passed`);
  failures.forEach(f => console.log('   - ' + f));
  console.log('='.repeat(64));
  process.exit(1);
}
console.log(`  all ${pass} checks passed — the extraction reproduces the book`);
console.log('='.repeat(64));
