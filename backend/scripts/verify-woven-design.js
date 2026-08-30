#!/usr/bin/env node
/**
 * VERIFY THE WOVEN STRUCTURE LAYER
 * ================================
 * The companion to scripts/verify-woven-rules.js, which checks that the rules
 * extracted from Gokarneshan (2005) reproduce the book's own printed tables.
 * This one checks the layer built ON those rules: that every generated weave
 * is the weave it claims to be, that every loom plan re-weaves its own design,
 * that the cloth arithmetic lands on real cloth, and — the check that matters
 * most — that no construction in the catalog has drifted away from the book
 * data it says it came from.
 *
 * Run it before shipping any change to engine/formulas/woven*.js,
 * engine/catalog/woven-derivatives.js or engine/domain/woven-engine.js.
 *
 *   node scripts/verify-woven-design.js
 *
 * Exit code 0 means every check passed. Anything else means the woven layer
 * should not be trusted until the failure is understood.
 */
'use strict';

const path = require('path');
const woven = require(path.join(__dirname, '..', 'engine', 'formulas', 'woven'));
const design = require(path.join(__dirname, '..', 'engine', 'formulas', 'woven-design'));
const cloth = require(path.join(__dirname, '..', 'engine', 'formulas', 'woven-cloth'));
const { WOVEN_DERIVATIVES, buildWeaveGrid } = require(path.join(__dirname, '..', 'engine', 'catalog', 'woven-derivatives'));
const { calculateWoven, listWovenFabrics } = require(path.join(__dirname, '..', 'engine', 'domain', 'woven-engine'));
const book = require(path.join(__dirname, '..', 'data', 'woven-reference.json'));

let passed = 0;
const failures = [];

function check(ok, label, detail = '') {
  if (ok) { passed++; return true; }
  failures.push(`${label}${detail ? '  —  ' + detail : ''}`);
  return false;
}

function section(title) {
  console.log(`\n${title}`);
  console.log('─'.repeat(title.length));
}

// ═════════════════════════════════════════════════════════════
section('1. Every loom plan re-weaves its own design');
// ═════════════════════════════════════════════════════════════
// The draft and the peg plan are the only outputs of this layer a weaver acts
// on directly. They cannot be checked against the book — the book prints them
// as figures — but they can be checked against themselves: expanding them must
// give back the design they were derived from, cell for cell.

for (const f of WOVEN_DERIVATIVES) {
  const built = buildWeaveGrid(f.weave);
  if (!built.grid) {
    check(built.grid_status === 'FIGURE_NOT_TRANSCRIBED',
      `${f.id}: a missing grid is declared, not silently empty`, built.grid_status);
    continue;
  }
  const draft = design.deriveDraft(built.grid);
  const peg = design.derivePegPlan(built.grid, draft);
  check(design.gridsEqual(built.grid, design.expandPlan(draft, peg)),
    `${f.id}: draft (${draft.healds} healds, ${draft.type.slug}) + peg plan re-expand to the design`);
}

// ═════════════════════════════════════════════════════════════
section('2. Generated weaves are the weaves they claim to be');
// ═════════════════════════════════════════════════════════════

// Plain — the book's limiting case: every thread binds at every crossing.
{
  const g = woven.generateTwill(1, 1).grid;
  const fl = design.analyseFloats(g);
  const dr = design.deriveDraft(g);
  check(fl.repeat_ends === 2 && fl.repeat_picks === 2, 'plain repeats on 2 x 2');
  check(fl.average_float === 1, 'plain has an average float of exactly 1', String(fl.average_float));
  check(fl.firmness_vs_plain === 1, 'plain is the firmness baseline, 1.00');
  check(fl.warp_float_max === 1 && fl.weft_float_max === 1, 'plain has no float longer than one');
  check(dr.healds === 2 && dr.type.slug === 'straight', 'plain draws straight on two shafts');
}

// Twill — p.8: "the repeat size is the sum of the warp and weft floats".
for (const [wf, ef] of [[1, 2], [2, 1], [3, 1], [2, 2], [4, 1], [3, 2], [5, 3]]) {
  const spec = woven.weaveRepeatSize(wf, ef);
  const g = woven.generateTwill(wf, ef).grid;
  const fl = design.analyseFloats(g);
  const dr = design.deriveDraft(g);
  check(fl.repeat_ends === spec.repeat_ends && fl.repeat_picks === spec.repeat_picks,
    `twill ${wf}/${ef} repeats on ${spec.repeat_ends} x ${spec.repeat_picks} (book p.8 rule)`);
  check(fl.warp_float_max === wf && fl.weft_float_max === ef,
    `twill ${wf}/${ef} floats are ${wf} warp and ${ef} weft`,
    `got ${fl.warp_float_max}/${fl.weft_float_max}`);
  check(dr.healds === wf + ef && dr.type.slug === 'straight',
    `twill ${wf}/${ef} draws straight on ${wf + ef} shafts`);
  check(Math.abs(fl.warp_up_fraction - wf / (wf + ef)) < 0.02,
    `twill ${wf}/${ef} shows ${wf} of every ${wf + ef} threads as warp`);
}

// Satin — the defining property is one binding point per pick AND per end.
// Anything else is a rearranged twill, not a satin.
for (const [repeat, moves] of Object.entries(woven.BOOK_MOVE_NUMBERS)) {
  const n = Number(repeat);
  for (const move of moves) {
    const g = woven.generateSatin(n, move).grid;
    const perPick = g.map(row => row.filter(v => !v).length);
    const perEnd = Array.from({ length: n }, (_, e) => g.filter(row => !row[e]).length);
    check(perPick.every(v => v === 1), `satin ${n}/${move}: exactly one binding point in every pick`);
    check(perEnd.every(v => v === 1), `satin ${n}/${move}: exactly one binding point in every end`);
    const fl = design.analyseFloats(g);
    check(fl.warp_float_max === n - 1, `satin ${n}/${move}: the warp float runs ${n - 1}`, String(fl.warp_float_max));
  }
}

// Sateen is the same weave seen from the other side (p.27), so the two must be
// exact complements of one another.
{
  const satin = woven.generateSatin(5, 2).grid;
  const sateen = woven.generateSatin(5, 2, { face: 'weft' }).grid;
  check(satin.every((row, p) => row.every((v, e) => v === !sateen[p][e])),
    'sateen is the exact complement of the satin — the book\'s "reverse side" claim, p.27');
}

// Rib and matt — the matt is the two ribs applied at once, so it must equal
// their agreement cell by cell. This is the p.19 statement made checkable.
{
  const warpRib = design.generateWarpRib(2, 2).grid;
  const weftRib = design.generateWeftRib(2, 2).grid;
  const matt = design.generateMatt(2, 2).grid;
  check(warpRib.length === 4 && warpRib[0].length === 2, 'warp rib 2/2 repeats on 2 ends x 4 picks');
  check(weftRib.length === 2 && weftRib[0].length === 4, 'weft rib 2/2 repeats on 4 ends x 2 picks');
  const product = matt.every((row, p) => row.every((v, e) => v === (warpRib[p][0] === weftRib[0][e])));
  check(product, 'matt 2/2 is plain extended in both directions at once (p.19)');
  check(design.deriveDraft(matt).healds === 2, 'matt 2/2 needs only two shafts');
}

// Corkscrew — p.31 gives two constraints and the vertical cord is the point of
// the weave, so both are asserted rather than assumed.
{
  const g = design.generateCorkscrew(3, 2, { move: 2 }).grid;
  const v = woven.validateCorkscrew(5, 3, 2);
  check(v.valid, 'corkscrew 3/2 satisfies the p.31 constraints', v.failed_rules.join('; '));
  const oneFloatPerEnd = Array.from({ length: 5 }, (_, e) =>
    design.cyclicRuns(g.map(row => row[e]), true)).every(runs => runs.length === 1 && runs[0] === 3);
  check(oneFloatPerEnd, 'corkscrew: every end carries ONE unbroken warp float of 3 — the vertical cord the weave is named for');
}

// Pointed twill — the pointed draft halves the shafts a zigzag would otherwise
// need, which is the reason the book gives for using it (p.11).
{
  const g = design.generatePointedTwill(2, 2).grid;
  const dr = design.deriveDraft(g);
  check(g[0].length === 6, 'pointed twill 2/2 repeats on 2n-2 = 6 ends', String(g[0].length));
  check(dr.healds === 4, 'pointed twill 2/2 still needs only the base twill\'s 4 shafts', String(dr.healds));
  check(dr.type.slug === 'pointed', 'pointed twill is recognised as a pointed draft', dr.type.slug);
}

// ═════════════════════════════════════════════════════════════
section('3. Catalog constructions still match the book data');
// ═════════════════════════════════════════════════════════════
// The strongest check here. A catalog row that says BOOK_VERIFIED must be
// findable in data/woven-reference.json with the same sett — otherwise someone
// has edited a number and the citation has quietly become false.

for (const f of WOVEN_DERIVATIVES) {
  if (f.sett.source !== 'BOOK_VERIFIED') continue;
  const hit = book.constructions.find(c =>
    c.weave_slug === f.weave_slug &&
    (c.ends_per_inch === f.sett.epi || c.ends_per_inch == null) &&
    (c.picks_per_inch === f.sett.ppi || c.picks_per_inch == null));
  if (!check(!!hit, `${f.id}: its BOOK_VERIFIED sett exists in woven-reference.json`,
      `${f.sett.epi} x ${f.sett.ppi} on weave "${f.weave_slug}"`)) continue;
  check(hit.page === f.sett.page,
    `${f.id}: cites the same page as the extracted record`, `catalog p.${f.sett.page}, data p.${hit.page}`);
  const wantWarp = cloth.parseCount(f.sett.warp_count);
  const gotWarp = cloth.parseCount(hit.warp_count);
  check(wantWarp && gotWarp && Math.abs(wantWarp.resultant_ne - gotWarp.resultant_ne) < 0.01,
    `${f.id}: warp count matches the book record`, `catalog "${f.sett.warp_count}", data "${hit.warp_count}"`);
}

// Every weave_slug used by the catalog must be a weave the book actually has.
for (const f of WOVEN_DERIVATIVES) {
  check(book.weaves.some(w => w.slug === f.weave_slug),
    `${f.id}: weave slug "${f.weave_slug}" exists in the extracted weave list`);
}

// ═════════════════════════════════════════════════════════════
section('4. Count parsing');
// ═════════════════════════════════════════════════════════════
{
  const cases = [
    ['2/80s', 40, 'a folded 2/80s behaves as a 40s'],
    ['30s', 30, 'a single 30s is a 30s'],
    ['2/6s', 3, 'a coarse folded 2/6s behaves as a 3s'],
    ['18s', 18, 'plain single count'],
  ];
  for (const [raw, want, why] of cases) {
    const got = cloth.parseCount(raw);
    check(got && Math.abs(got.resultant_ne - want) < 0.001, `parseCount("${raw}") -> ${want} Ne — ${why}`,
      got ? String(got.resultant_ne) : 'null');
  }
  const tex = cloth.parseCount('60 tex two fold');
  check(tex && Math.abs(tex.tex - 120) < 0.001, 'parseCount("60 tex two fold") -> 120 tex resultant',
    tex ? String(tex.tex) : 'null');
  check(cloth.parseCount('2/14s & 36s').ambiguous,
    'a construction naming two warps is flagged ambiguous rather than silently resolved');
}

// ═════════════════════════════════════════════════════════════
section('5. Cloth arithmetic lands on real cloth');
// ═════════════════════════════════════════════════════════════
// The mass relation carries no empirical constant, so the only way it can be
// wrong is a unit slip — and a unit slip shows up immediately against a cloth
// whose weight is common knowledge in the trade.

{
  const denim = cloth.clothWeight({ epi: 56, ppi: 44, warpNe: 8, weftNe: 6, averageFloat: 2 });
  check(denim.oz_per_sq_yd >= 9.5 && denim.oz_per_sq_yd <= 11.5,
    'the book\'s denim (56 x 44, 8s/6s, p.130) weighs 9.5-11.5 oz/yd2 — the classic 10 oz denim',
    `${denim.oz_per_sq_yd} oz/yd2`);

  const shirting = cloth.clothWeight({ epi: 84, ppi: 80, warpNe: 40, weftNe: 40, averageFloat: 1 });
  check(shirting.gsm >= 90 && shirting.gsm <= 115,
    'the book\'s plain shirting (84 x 80, 2/80s, p.130) weighs 90-115 g/m2',
    `${shirting.gsm} g/m2`);

  check(Math.abs(shirting.warp_share_pct - 51.7) < 3,
    'a shirting set 84 x 80 in one count puts a little over half its weight in the warp',
    `${shirting.warp_share_pct}%`);
}

// Forward and back must agree: the inverse solve is the same relation.
{
  const fwd = cloth.clothWeight({ epi: 56, ppi: 44, warpNe: 8, weftNe: 6, averageFloat: 2 });
  const back = cloth.countsForTargetGsm({
    gsm: fwd.gsm, epi: 56, ppi: 44,
    ratio: cloth.neToTex(6) / cloth.neToTex(8), averageFloat: 2,
  });
  check(Math.abs(back.warp_ne - 8) < 0.05 && Math.abs(back.weft_ne - 6) < 0.05,
    'solving the mass relation for the counts returns the counts it started from',
    `${back.warp_ne} / ${back.weft_ne}`);
}

// Cover factor definitions.
{
  const cv = cloth.coverFactor({ epi: 84, ppi: 80, warpNe: 40, weftNe: 40, averageFloat: 1 });
  check(Math.abs(cv.warp_cover - 84 / Math.sqrt(40)) < 0.01, 'warp cover is EPI / sqrt(Ne)');
  check(Math.abs(cv.cloth_cover - (cv.warp_cover + cv.weft_cover - cv.warp_cover * cv.weft_cover / 28)) < 0.01,
    'cloth cover follows Peirce, K1 + K2 - K1.K2/28');
  check(cv.source === 'PEIRCE',
    'the cover factor is labelled PEIRCE, not attributed to Gokarneshan — the 28 is not in that book');
}

// Crimp falls as floats lengthen; a satin must not be charged a plain's crimp.
{
  const plain = cloth.defaultCrimp(1);
  const satin = cloth.defaultCrimp(2.5);
  check(satin.warp_pct < plain.warp_pct,
    'the assumed crimp falls as the average float rises', `${plain.warp_pct}% -> ${satin.warp_pct}%`);
  check(plain.source === 'ASSUMED' && satin.source === 'ASSUMED',
    'an assumed crimp always says it is assumed');
}

// ═════════════════════════════════════════════════════════════
section('6. The engine refuses rather than guesses');
// ═════════════════════════════════════════════════════════════

{
  const honeycomb = calculateWoven({ fabric_id: 'woven_honeycomb' });
  check(honeycomb.success && honeycomb.structure.available === false,
    'honeycomb calculates its cloth numbers but reports no structure');
  check(honeycomb.structure.grid === null,
    'honeycomb returns no grid at all rather than a plausible-looking wrong one');
  check(honeycomb.notes.some(n => /p\.\d+/.test(n)),
    'the missing structure names the page the figure is on, so it can be checked by hand');

  const corduroy = calculateWoven({ fabric_id: 'woven_corduroy' });
  check(corduroy.cover === null,
    'a pile cloth reports no cover factor — its picks include pile that is not in the ground plane');
  check(corduroy.weight.weft_crimp_source === 'SUPPLIED' && corduroy.weight.weft_crimp_pct === 20,
    'corduroy uses the book\'s own 20% weft crimp (p.79), marked SUPPLIED');
  check(corduroy.weight.warp_crimp_source === 'ASSUMED',
    'and says plainly that its warp crimp is assumed, because the book gives none');

  const unknown = calculateWoven({ fabric_id: 'not_a_fabric' });
  check(unknown.success === false && unknown.error === 'UNKNOWN_WOVEN_FABRIC',
    'an unknown fabric id is refused, not defaulted');

  const denim = calculateWoven({ fabric_id: 'woven_denim' });
  check(denim.twill_angle.band.label === 'steep / high angle twill',
    'denim at 56 x 44 is a steep twill by the book\'s p.24 rule', denim.twill_angle.band.label);
  check(denim.twill_angle.angle_source === 'DERIVED',
    'the numeric twill angle is labelled DERIVED, kept apart from the book\'s band');
}

// The dropdown and the result page must not disagree about a fabric's weight.
{
  const list = listWovenFabrics();
  let drift = 0;
  for (const row of list) {
    const r = calculateWoven({ fabric_id: row.id });
    if (r.success && r.weight && row.nominal_gsm !== r.weight.gsm) drift++;
  }
  check(drift === 0, 'every dropdown weight equals the weight its own result page computes', `${drift} row(s) differ`);
  check(list.length === WOVEN_DERIVATIVES.length, 'every catalog row is listed');
}

// ═════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
if (failures.length) {
  console.log(`FAILED — ${passed} passed, ${failures.length} failed\n`);
  failures.forEach(f => console.log('  ✗ ' + f));
  console.log('\nThe woven layer should not be shipped until these are understood.');
  process.exit(1);
}
console.log(`PASSED — all ${passed} checks.`);
console.log('The loom plans re-weave their own designs, the generated weaves have the');
console.log('properties the book names, and no catalog citation has drifted from the data.');
