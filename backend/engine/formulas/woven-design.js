/**
 * WOVEN STRUCTURE DESIGN — grid, draft, peg plan, denting
 * =======================================================
 * Companion to engine/formulas/woven.js, which holds the book's RULES. This
 * file holds the DERIVATIONS those rules make possible: given a weave grid,
 * work out the drafting plan, the lifting (peg) plan, the denting order and
 * the float geometry — the four things a weaver actually needs to set a loom.
 *
 * Source for the plan vocabulary and the draft types:
 *   Gokarneshan, "Fabric Structure and Design" (2005), ch.1 p.7-13.
 *
 * WHY THIS IS A DERIVATION AND NOT A LOOKUP
 * -----------------------------------------
 * The book prints ~90 numbered figures whose grids the PDF text layer
 * scrambles, so none of them were transcribed. That turns out to matter far
 * less than it sounds, because a draft and a peg plan are not facts to be
 * copied — they follow from the design with no freedom at all:
 *
 *   Two warp ends may share a heald shaft if and only if they lift
 *   identically on every pick of the repeat.
 *
 * That single sentence determines the minimum heald count, the drafting
 * order, and (with the design) the peg plan. It is also self-checking:
 * re-expanding a draft and a peg plan must reproduce the design it came from,
 * cell for cell. expandPlan() does exactly that and every generator in this
 * file is put through it by scripts/verify-woven-design.js.
 *
 * GRID CONVENTION (shared with woven.js): grid[pick][end], true = warp up.
 */
'use strict';

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

// ─────────────────────────────────────────────────────────────
// FLOAT GEOMETRY
// ─────────────────────────────────────────────────────────────

/** Cyclic run lengths of `value` in a repeating sequence. */
function cyclicRuns(seq, value) {
  const n = seq.length;
  if (seq.every(v => v === value)) return [Infinity];   // a thread that never binds
  if (!seq.includes(value)) return [];
  // Rotate so the sequence starts at a transition; then the runs are plain runs.
  let start = 0;
  while (!(seq[start] === value && seq[(start - 1 + n) % n] !== value)) start++;
  const runs = [];
  let len = 0;
  for (let i = 0; i < n; i++) {
    const v = seq[(start + i) % n];
    if (v === value) len++;
    else if (len) { runs.push(len); len = 0; }
  }
  if (len) runs.push(len);
  return runs;
}

/**
 * Float lengths and intersection count for a weave.
 *
 * A warp float is a run of consecutive picks the end passes OVER, so it is
 * read down a column. A weft float is a run of consecutive ends the pick
 * passes over, read along a row where the warp is down.
 *
 * `average_float` is threads per repeat divided by intersections per repeat —
 * the ratio that decides how closely a weave can be set. Plain weave is the
 * limiting case at 1.0: every thread binds at every crossing.
 */
function analyseFloats(grid) {
  const picks = grid.length;
  const ends = grid[0].length;

  const warpFloats = [];
  let warpIntersections = 0;
  for (let e = 0; e < ends; e++) {
    const col = grid.map(row => row[e]);
    warpFloats.push(...cyclicRuns(col, true).filter(Number.isFinite));
    for (let p = 0; p < picks; p++) if (col[p] !== col[(p + 1) % picks]) warpIntersections++;
  }

  const weftFloats = [];
  let weftIntersections = 0;
  for (let p = 0; p < picks; p++) {
    const row = grid[p];
    weftFloats.push(...cyclicRuns(row, false).filter(Number.isFinite));
    for (let e = 0; e < ends; e++) if (row[e] !== row[(e + 1) % ends]) weftIntersections++;
  }

  const max = a => (a.length ? Math.max(...a) : 0);
  const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const r2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

  // Intersections counted over the whole repeat. Plain weave changes state at
  // every crossing in both directions, which makes both averages exactly 1.
  const warpAvg = warpIntersections ? (ends * picks) / warpIntersections : Infinity;
  const weftAvg = weftIntersections ? (ends * picks) / weftIntersections : Infinity;
  const combined = (warpAvg + weftAvg) / 2;

  return {
    repeat_ends: ends,
    repeat_picks: picks,
    warp_float_max: max(warpFloats),
    weft_float_max: max(weftFloats),
    warp_float_mean: r2(mean(warpFloats)),
    weft_float_mean: r2(mean(weftFloats)),
    warp_intersections_per_repeat: warpIntersections,
    weft_intersections_per_repeat: weftIntersections,
    average_float: r2(combined),
    // How much more loosely than plain this weave may be set, all else equal.
    // Plain is 1.00 by construction; a 5-end satin sits near 0.4.
    firmness_vs_plain: r2(1 / combined),
    warp_up_fraction: r2(grid.flat().filter(Boolean).length / (ends * picks)),
    source: 'DERIVED',
    basis: 'counted directly off the weave repeat — no empirical constant involved',
  };
}

// ─────────────────────────────────────────────────────────────
// DRAFTING PLAN
// ─────────────────────────────────────────────────────────────

const colKey = (grid, e) => grid.map(row => (row[e] ? '1' : '0')).join('');

/**
 * Assign every warp end to a heald shaft.
 *
 * Ends that lift identically on every pick MUST be able to share a shaft, and
 * ends that differ anywhere MUST NOT — so the minimum heald count is simply
 * the number of distinct columns, and the drafting order falls out of the
 * order those columns first appear.
 */
function deriveDraft(grid) {
  const ends = grid[0].length;
  const seen = new Map();
  const assignment = [];
  for (let e = 0; e < ends; e++) {
    const key = colKey(grid, e);
    if (!seen.has(key)) seen.set(key, seen.size);
    assignment.push(seen.get(key));
  }
  const healds = seen.size;
  return {
    healds,
    assignment,                       // assignment[end] = heald index (0-based)
    type: classifyDraft(assignment, healds),
    notation: assignment.map(h => h + 1).join('-'),
    source: 'DERIVED',
    basis: 'two ends share a heald if and only if they lift identically on every pick',
  };
}

/**
 * Name the drafting order using the book's own vocabulary (p.9-13). Only the
 * shapes the book defines are named; anything else is reported as irregular
 * rather than forced into a category it does not fit.
 */
function classifyDraft(assignment, healds) {
  const n = assignment.length;
  if (healds === n && assignment.every((h, i) => h === i)) {
    return { slug: 'straight', name: 'Straight draft', page: 9, ends_per_shaft: 1,
             note: 'The peg plan is identical to the design, so no separate peg plan is needed.' };
  }
  // The book's test for a straight draft is that "the drafting order progresses
  // successively from the first to the last heald frame" (p.9) — it does not
  // require one end per shaft. A weft rib or a matt draws several consecutive
  // ends onto each shaft and still progresses successively, so it is straight.
  if (n % healds === 0) {
    const group = n / healds;
    if (assignment.every((h, i) => h === Math.floor(i / group))) {
      return { slug: 'straight', name: 'Straight draft', page: 9, ends_per_shaft: group,
               note: `The order progresses successively from the first to the last shaft, ${group} consecutive ends per shaft.` };
    }
  }
  // Pointed: straight up to a peak, then mirrored back down.
  const peak = assignment.indexOf(healds - 1);
  if (peak > 0 && peak < n - 1) {
    let mirrored = true;
    for (let i = 0; i <= peak && mirrored; i++) if (assignment[i] !== i) mirrored = false;
    for (let i = peak + 1; i < n && mirrored; i++) if (assignment[i] !== 2 * peak - i) mirrored = false;
    if (mirrored) return { slug: 'pointed', name: 'Pointed draft', page: 11,
                           note: 'The straight draft is reversed after half the repeat warp way.' };
  }
  // Skip / sateen: a permutation of the shafts advancing by a constant step.
  if (healds === n) {
    const step = ((assignment[1] - assignment[0]) % healds + healds) % healds;
    const constant = assignment.every((h, i) => h === (assignment[0] + i * step) % healds);
    if (constant && step > 1) {
      return healds > 5
        ? { slug: 'sateen', name: 'Sateen draft', page: 11, step,
            note: 'Used for weaves with a repeat size of more than 5.' }
        : { slug: 'skip', name: 'Skip draft', page: 10, step,
            note: 'Distributes ends more uniformly to prevent abrasion from overcrowding.' };
    }
    return { slug: 'broken', name: 'Broken draft', page: 11,
             note: 'Resembles the pointed draft but the pointed effect is broken. Suits herringbone twills.' };
  }
  return { slug: 'irregular', name: 'Irregular draft', page: null,
           note: 'Does not match any of the eight orders the book names; drawn end by end.' };
}

// ─────────────────────────────────────────────────────────────
// PEG (LIFTING) PLAN
// ─────────────────────────────────────────────────────────────

/**
 * peg[pick][heald] = true when that shaft is raised for that pick.
 *
 * Every end on a shaft lifts the same way by construction, so reading the
 * first end of each shaft is exact rather than a sample.
 */
function derivePegPlan(grid, draft) {
  const firstEndOf = [];
  draft.assignment.forEach((h, e) => { if (firstEndOf[h] === undefined) firstEndOf[h] = e; });
  const peg = grid.map(row => firstEndOf.map(e => row[e]));
  return {
    peg,
    picks: peg.length,
    healds: draft.healds,
    lifts_per_pick: peg.map(row => row.filter(Boolean).length),
    source: 'DERIVED',
  };
}

/**
 * Rebuild the design from a draft and a peg plan — the identity that makes
 * the two plans trustworthy. If this ever disagrees with the grid it came
 * from, the derivation is wrong and the caller should refuse to use it.
 */
function expandPlan(draft, pegPlan) {
  return pegPlan.peg.map(row => draft.assignment.map(h => row[h]));
}

function gridsEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((row, i) => row.length === b[i].length && row.every((v, j) => !!v === !!b[i][j]));
}

// ─────────────────────────────────────────────────────────────
// DENTING AND REED
// ─────────────────────────────────────────────────────────────

/**
 * Reed plan. The reed count in the stockport system is dents per inch, and
 * ends per dent is chosen so the groups do not split the weave repeat —
 * a repeat straddling two dents shows as a reed mark down the cloth.
 */
function dentingPlan(repeatEnds, endsPerInch, endsPerDent = 2) {
  const dentsPerInch = endsPerInch / endsPerDent;
  const splitsRepeat = repeatEnds % endsPerDent !== 0;
  return {
    ends_per_dent: endsPerDent,
    dents_per_inch: Math.round(dentsPerInch * 100) / 100,
    reed_count_stockport: Math.round(dentsPerInch),
    dents_per_repeat: Math.round((repeatEnds / endsPerDent) * 100) / 100,
    splits_repeat: splitsRepeat,
    warning: splitsRepeat
      ? `A repeat of ${repeatEnds} ends does not divide by ${endsPerDent} ends per dent, so the repeat straddles dents and may show a reed mark.`
      : null,
    source: 'DERIVED',
  };
}

// ─────────────────────────────────────────────────────────────
// GENERATORS THE BOOK'S RULES DETERMINE
// ─────────────────────────────────────────────────────────────

/**
 * Warp rib a/b — plain weave extended in the warp direction, so each end
 * floats over `a` then under `b` picks and the cords run across the cloth.
 * Book p.17. Repeat is 2 ends x (a+b) picks.
 */
function generateWarpRib(a = 2, b = 2) {
  const picks = a + b;
  const grid = [];
  for (let p = 0; p < picks; p++) grid.push([p < a, !(p < a)]);
  return { grid, notation: `${a}/${b} warp rib`, source: 'BOOK_VERIFIED', page: 17 };
}

/** Weft rib a/b — the same extension in the weft direction; the transpose. */
function generateWeftRib(a = 2, b = 2) {
  const ends = a + b;
  const row = Array.from({ length: ends }, (_, e) => e < a);
  return { grid: [row, row.map(v => !v)], notation: `${a}/${b} weft rib`, source: 'BOOK_VERIFIED', page: 18 };
}

/**
 * Matt / hopsack a/b — plain weave extended in BOTH directions at once,
 * which is why it is the product of the two rib weaves. Book p.19.
 */
function generateMatt(a = 2, b = 2) {
  const n = a + b;
  const grid = [];
  for (let p = 0; p < n; p++) {
    const row = [];
    for (let e = 0; e < n; e++) row.push((p < a) === (e < a));
    grid.push(row);
  }
  return { grid, notation: `${a}/${b} matt`, source: 'BOOK_VERIFIED', page: 19 };
}

/**
 * Pointed / zigzag twill — the base twill read through a pointed order, which
 * is what the pointed draft physically does to it. Book p.11 names the draft
 * and p.25 the wavy twill it produces. Repeat is 2n-2 ends on n healds.
 */
function generatePointedTwill(warpFloat, weftFloat, { direction = 'Z' } = {}) {
  const n = warpFloat + weftFloat;
  const order = [];
  for (let i = 0; i < 2 * n - 2; i++) order.push(i < n ? i : 2 * n - 2 - i);
  const base = [];
  for (let p = 0; p < n; p++) {
    const row = [];
    for (let e = 0; e < n; e++) {
      const off = direction === 'Z' ? e - p : e + p;
      row.push(((off % n) + n) % n < warpFloat);
    }
    base.push(row);
  }
  return {
    grid: base.map(row => order.map(e => row[e])),
    notation: `${warpFloat}/${weftFloat} pointed twill`,
    healds_expected: n,
    source: 'DERIVED',
    basis: 'the base twill read through the pointed drafting order the book defines on p.11',
    page: 11,
  };
}

/**
 * Corkscrew — a twill of odd repeat whose floats differ by one, with its
 * picks rearranged in satin order so the warp floats line up into vertical
 * cords. Book p.31 states the two constraints (odd repeat, floats differing
 * by one) but prints the result as a figure rather than as a construction,
 * so the rearrangement below is DERIVED and labelled as such.
 */
function generateCorkscrew(warpFloat, weftFloat, { move = 2 } = {}) {
  const n = warpFloat + weftFloat;
  const z = (p, e) => (((e - p) % n) + n) % n < warpFloat;
  const grid = [];
  for (let p = 0; p < n; p++) {
    const row = [];
    // The ENDS are taken in satin order, which is what gathers each end's
    // overlaps into one continuous float and so forms the vertical cord the
    // weave is named for. Rearranging the picks instead breaks the float into
    // pieces and produces an ordinary rearranged twill, not a corkscrew.
    for (let i = 0; i < n; i++) row.push(z(p, (i * move) % n));
    grid.push(row);
  }
  return {
    grid, notation: `${warpFloat}/${weftFloat} corkscrew`, move,
    source: 'DERIVED',
    basis: 'twill ends rearranged in satin order; p.31 constraints checked by validateCorkscrew(), and the defining property — one unbroken warp float per end — is asserted by scripts/verify-woven-design.js',
    page: 31,
  };
}

module.exports = {
  analyseFloats,
  deriveDraft,
  classifyDraft,
  derivePegPlan,
  expandPlan,
  gridsEqual,
  dentingPlan,
  generateWarpRib,
  generateWeftRib,
  generateMatt,
  generatePointedTwill,
  generateCorkscrew,
  cyclicRuns,
  gcd,
};
