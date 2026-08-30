/**
 * WOVEN FABRIC FORMULAS
 * =====================
 * Relations for woven structure, extracted from:
 *   Gokarneshan, "Fabric Structure and Design", New Age International (2005).
 *
 * Every export below carries the book page it comes from. Where a function does
 * something the book does NOT state — computing a numeric twill angle, for
 * instance, when the book only names three bands — that is marked DERIVED and
 * kept separate from the book's own claim, so a later reader can tell which is
 * which. The provenance ladder in engine/domain/ exists for the same reason.
 *
 * SCOPE: this is woven only. The knit engine (engine/formulas/weft.js,
 * loop-length.js, yarn.js) is untouched by it — the two share no relations,
 * because a woven cloth is built from interlacement and a knitted one from
 * intermeshed loops. Nothing here is reachable from calculate().
 */
'use strict';

// ─────────────────────────────────────────────────────────────
// WEAVE REPEAT — p.8
// ─────────────────────────────────────────────────────────────

/**
 * "For any weave the repeat size is the sum of the warp and weft floats."
 * Book p.8, worked example: a 2/1 twill repeats on 3 x 3.
 */
function weaveRepeatSize(warpFloat, weftFloat) {
  const n = warpFloat + weftFloat;
  return { repeat_ends: n, repeat_picks: n, notation: `${warpFloat}/${weftFloat}`, source: 'BOOK_VERIFIED', page: 8 };
}

// ─────────────────────────────────────────────────────────────
// SATIN / SATEEN MOVE NUMBERS — p.28 (rules), p.30 (table)
// ─────────────────────────────────────────────────────────────

/**
 * The book's four rules for choosing a move number (p.28):
 *   (a) it must not equal the repeat of the weave
 *   (b) it must not be one less than the repeat size
 *   (c) it must not be a factor of the repeat size
 *   (d) it must not be a multiple of a factor of the repeat size
 *
 * Rules (c) and (d) together are exactly "share no common factor with the
 * repeat" — a move that is a multiple of any factor of N shares that factor
 * with N. So the four rules reduce to: gcd(move, N) === 1, and
 * 2 <= move <= N-2. That reduction is checked against the book's own table
 * by scripts/verify-woven-rules.js; it reproduces all ten rows exactly,
 * including the absence of a 6-end satin (6 admits no coprime move in range).
 */
function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

function validateMoveNumber(repeat, move) {
  const failed = [];
  if (move === repeat) failed.push('equals the repeat size');
  if (move === repeat - 1) failed.push('is one less than the repeat size');
  if (move > 1 && repeat % move === 0) failed.push('is a factor of the repeat size');
  if (move > 1 && gcd(move, repeat) > 1 && repeat % move !== 0) {
    failed.push('is a multiple of a factor of the repeat size');
  }
  if (move < 2) failed.push('must be at least 2');
  return { valid: failed.length === 0, failed_rules: failed, source: 'BOOK_VERIFIED', page: 28 };
}

/**
 * Every usable move number for a satin/sateen of the given repeat.
 * `primary` is the half the book prints; `reciprocal` is N - move, which the
 * book says "may be taken" instead and which produces the mirrored weave.
 */
function suitableMoveNumbers(repeat) {
  const all = [];
  for (let m = 2; m <= repeat - 2; m++) if (gcd(m, repeat) === 1) all.push(m);
  return {
    repeat,
    all,
    primary: all.filter(m => m <= repeat / 2),
    constructible: all.length > 0,
    source: 'BOOK_VERIFIED',
    page: 30,
  };
}

/** The book's printed table, kept verbatim so the derivation can be checked against it. */
const BOOK_MOVE_NUMBERS = Object.freeze({
  5: [2], 7: [2, 3], 8: [3], 9: [2, 4], 10: [3],
  11: [2, 3, 4, 5], 12: [5], 13: [2, 3, 4, 5, 6], 14: [3, 5], 15: [2, 4, 7],
});

// ─────────────────────────────────────────────────────────────
// GRID GENERATORS
// ─────────────────────────────────────────────────────────────

/**
 * A weave grid is picks x ends, true = warp overlap (the 'X' of the book's
 * canvas method, p.8), false = weft overlap.
 */
function generateTwill(warpFloat, weftFloat, { direction = 'Z' } = {}) {
  const n = warpFloat + weftFloat;
  const grid = [];
  for (let pick = 0; pick < n; pick++) {
    const row = [];
    for (let end = 0; end < n; end++) {
      const offset = direction === 'Z' ? (end - pick) : (end + pick);
      row.push(((offset % n) + n) % n < warpFloat);
    }
    grid.push(row);
  }
  return { grid, repeat: n, notation: `${warpFloat}/${weftFloat}`, direction, source: 'BOOK_VERIFIED', page: 22 };
}

/**
 * Satin (warp faced) / sateen (weft faced) on `repeat` ends with `move`.
 * "Satin is a warp faced rearranged twill and sateen is a rearranged weft
 * faced twill. Thus satin is the reverse side of sateen." — p.27
 */
function generateSatin(repeat, move, { face = 'warp' } = {}) {
  const check = validateMoveNumber(repeat, move);
  if (!check.valid) return { error: 'INVALID_MOVE_NUMBER', ...check };

  const grid = Array.from({ length: repeat }, () => Array(repeat).fill(face === 'warp'));
  for (let pick = 0; pick < repeat; pick++) {
    const end = (pick * move) % repeat;
    grid[pick][end] = face !== 'warp';       // the single binding point in each pick
  }
  return {
    grid, repeat, move, face,
    binding_points_per_pick: 1,
    source: 'BOOK_VERIFIED', page: 27,
  };
}

// ─────────────────────────────────────────────────────────────
// DERIVATION RULES
// ─────────────────────────────────────────────────────────────

/**
 * Broken twill — "the most suitable number to skip is one less than half the
 * number of threads in the repeat of the twill, i.e. (N/2 - 1)". Book p.34,
 * worked example N=4 gives 4/2 - 1 = 1.
 */
function brokenTwillSkip(repeatThreads) {
  return {
    ends_to_miss: repeatThreads / 2 - 1,
    constraint: 'no similar ends must be missed in any two or three consecutive repeats',
    source: 'BOOK_VERIFIED', page: 34,
  };
}

/**
 * Brighton honeycomb — "Length of longest float is N/2 - 1, where N is the
 * repeat size" and "the number of threads in a repeat must be a multiple of 4".
 * Book p.39.
 */
function brightonHoneycomb(repeatSize) {
  return {
    longest_float: repeatSize / 2 - 1,
    valid_repeat: repeatSize % 4 === 0,
    cells_per_repeat: 4,
    draft: 'straight',
    reversible: false,
    source: 'BOOK_VERIFIED', page: 39,
  };
}

/**
 * Twill angle. The book (p.24) states three BANDS and no equation:
 *   epi = ppi  -> 45 degrees
 *   epi > ppi  -> obtuse, steep twill
 *   ppi > epi  -> acute, flat twill
 * The numeric angle below is DERIVED from that statement, not quoted: it is
 * the angle whose tangent is epi/ppi, which is the only continuous function
 * that satisfies all three of the book's bands and returns exactly 45 at
 * equality. It is reported separately from `band` so that a reader can trust
 * the band absolutely and the number only as far as the derivation.
 */
function twillAngle(endsPerInch, picksPerInch) {
  if (!(endsPerInch > 0 && picksPerInch > 0)) return null;
  const band =
    endsPerInch === picksPerInch ? { label: '45 degree twill', angle_deg: 45 } :
    endsPerInch > picksPerInch ? { label: 'steep / high angle twill', note: 'obtuse, greater than 45 degrees' } :
                                 { label: 'flat / low angle twill', note: 'acute, less than 45 degrees' };
  return {
    band: { ...band, source: 'BOOK_VERIFIED', page: 24 },
    angle_deg: Math.round(Math.atan(endsPerInch / picksPerInch) * (180 / Math.PI) * 10) / 10,
    angle_source: 'DERIVED',
    angle_basis: 'atan(epi/ppi) — the continuous function satisfying the three bands the book names on p.24',
  };
}

/** Corkscrew constraints — p.31. */
function validateCorkscrew(repeat, warpFloat, weftFloat) {
  const failed = [];
  if (repeat % 2 === 0) failed.push('repeat size must be an odd number');
  if (Math.abs(warpFloat - weftFloat) !== 1) {
    failed.push('one float must exceed the other by exactly one');
  }
  return { valid: failed.length === 0, failed_rules: failed, source: 'BOOK_VERIFIED', page: 31 };
}

// ─────────────────────────────────────────────────────────────
// COLOUR AND WEAVE EFFECTS — ch.15, p.122-126
// ─────────────────────────────────────────────────────────────

/**
 * "In such an effect the weave tends to show a discontinuity of the colours of
 * the warp and weft and the colour shows on the face of the fabric,
 * irrespective of the warp or weft float." — p.122
 *
 * Three inputs are required (the book names exactly these on p.122):
 * the order of warping, the order of wefting, and the weave.
 *
 * At each intersection the visible colour is the warp colour where the warp
 * overlaps, and the weft colour where it does not. Running this on the book's
 * own six worked examples reproduces each named effect; see
 * scripts/verify-woven-rules.js.
 */
function expandColourOrder(order) {
  // "2 dark, 2 light" -> ['D','D','L','L']
  const out = [];
  for (const part of String(order).split(',')) {
    const m = part.trim().match(/^(\d+)\s+(\S+)/);
    if (!m) continue;
    const [, count, name] = m;
    for (let i = 0; i < Number(count); i++) out.push(name[0].toUpperCase());
  }
  return out;
}

function colourWeaveEffect(weaveGrid, warpingOrder, weftingOrder) {
  const warp = Array.isArray(warpingOrder) ? warpingOrder : expandColourOrder(warpingOrder);
  const weft = Array.isArray(weftingOrder) ? weftingOrder : expandColourOrder(weftingOrder);
  if (!weaveGrid.length || !warp.length || !weft.length) return null;

  const picks = weaveGrid.length;
  const ends = weaveGrid[0].length;
  // The pattern repeats on the LCM of the weave repeat and the colour repeat.
  const lcm = (a, b) => (a * b) / gcd(a, b);
  const totalEnds = lcm(ends, warp.length);
  const totalPicks = lcm(picks, weft.length);

  const effect = [];
  for (let p = 0; p < totalPicks; p++) {
    const row = [];
    for (let e = 0; e < totalEnds; e++) {
      const warpUp = weaveGrid[p % picks][e % ends];
      row.push(warpUp ? warp[e % warp.length] : weft[p % weft.length]);
    }
    effect.push(row);
  }
  return {
    effect,
    repeat_ends: totalEnds,
    repeat_picks: totalPicks,
    warping_order: warp.join(''),
    wefting_order: weft.join(''),
    source: 'BOOK_VERIFIED', page: 122,
  };
}

module.exports = {
  weaveRepeatSize,
  validateMoveNumber,
  suitableMoveNumbers,
  BOOK_MOVE_NUMBERS,
  generateTwill,
  generateSatin,
  brokenTwillSkip,
  brightonHoneycomb,
  twillAngle,
  validateCorkscrew,
  expandColourOrder,
  colourWeaveEffect,
};
