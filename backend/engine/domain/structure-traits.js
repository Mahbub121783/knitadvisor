/**
 * What a weft needle programme is like, read from the programme itself — the
 * qualities a designer asks for when they say "open", "stretchy", "textured",
 * "flat" or "smooth". Each is an INDICATOR on 0…1 for ranking designs against
 * each other, built from the textbook rules of weft-knit structure (Spencer,
 * Knitting Technology), not a measured property:
 *
 *   stretch   widthwise extensibility. Rib (needles knitting on both beds
 *             alternately) opens most; single jersey next; interlock less (its
 *             two rib sets lock each other). A miss float ties the wales it
 *             crosses together; a tuck's held loop and its extra yarn do so less.
 *   open      see-through and air: eyelets (transfers) most, isolated tucks
 *             (the held loop leaves a hole beside it), long held loops; a double
 *             bed covers both sides.
 *   texture   surface relief: tucks (staggered, as in piqué), held loops that
 *             pile up over courses, misses on a double bed (blister, ottoman).
 *   flat      lies flat, little curl and spirality: a double bed balances both
 *             faces; on one bed tucks and misses counter the jersey's curl.
 *   smooth    a plain, even face: mostly knit, few holes and little relief.
 *
 * Also the programme's risks: the longest miss float (snags), the longest run of
 * non-knit stitches on one needle (held-loop strain), and the cell shares.
 */
'use strict';

const rowsOf = (g) => (g || []).map((r) => (Array.isArray(r) ? r.join('') : String(r)));
const clamp = (v) => Math.max(0, Math.min(1, v));

/** Longest cyclic run of characters from `set` in a string. */
function longestRun(s, set) {
  if (!s.length) return 0;
  if ([...s].every((c) => set.includes(c))) return s.length;
  let best = 0, run = 0;
  const t = s + s;
  for (const c of t) { run = set.includes(c) ? run + 1 : 0; best = Math.max(best, Math.min(run, s.length)); }
  return best;
}

function bedStats(rows) {
  const R = rows.length, W = R ? rows[0].length : 0;
  const n = { K: 0, T: 0, M: 0, E: 0, '-': 0 };
  let cells = 0, maxFloat = 0, maxHold = 0, maxTuck = 0, isolatedTucks = 0;
  for (const r of rows) {
    for (const c of r) { if (c in n) n[c]++; if (c !== '-') cells++; }
    maxFloat = Math.max(maxFloat, longestRun(r, 'M'));
  }
  for (let j = 0; j < W; j++) {
    const col = rows.map((r) => r[j]).join('');
    if (/^-+$/.test(col)) continue;
    maxHold = Math.max(maxHold, longestRun(col, 'TM'));
    maxTuck = Math.max(maxTuck, longestRun(col, 'T'));
  }
  // a tuck with knit loops on both sides in its course: the held loop leaves an open hole beside it
  rows.forEach((r) => { for (let j = 0; j < W; j++) if (r[j] === 'T' && r[(j + W - 1) % W] === 'K' && r[(j + 1) % W] === 'K') isolatedTucks++; });
  const f = (k) => (cells ? n[k] / cells : 0);
  return { cells, fK: f('K'), fT: f('T'), fM: f('M'), fE: f('E'), needleOut: W ? rows.length && [...Array(W).keys()].filter((j) => rows.every((r) => r[j] === '-')).length / W : 0, maxFloat, maxHold, maxTuck, isolated: cells ? isolatedTucks / cells : 0 };
}

/**
 * @param grid   { C: rows, D: rows | null }
 * @param gating 'rib' | 'interlock' (double bed only)
 */
function traitsOf(grid, gating) {
  const C = bedStats(rowsOf(grid.C));
  const D = grid.D ? bedStats(rowsOf(grid.D)) : null;
  let all = D ? ['fK', 'fT', 'fM', 'fE', 'isolated'].reduce((o, k) => ({ ...o, [k]: (C[k] * C.cells + D[k] * D.cells) / (C.cells + D.cells || 1) }), {}) : C;
  const dbl = !!D, inter = dbl && gating === 'interlock';
  // on interlock gating every needle knits every other feed by design (KM / MK): those misses are the
  // structure, not floats — only misses beyond that half count
  if (inter) all.fM = Math.max(0, (all.fM - 0.5) / 0.5);
  const holdF = Math.max(C.maxHold, D ? D.maxHold : 0);
  const floatF = Math.max(C.maxFloat, D ? D.maxFloat : 0);
  const stretchBase = !dbl ? 0.6 : inter ? 0.45 : 0.9;
  const stretch = clamp(stretchBase - 0.9 * all.fM - 0.35 * all.fT - 0.04 * Math.max(0, floatF - 1) + (dbl && !inter ? 0.15 * ((C.needleOut || 0) + (D.needleOut || 0)) : 0));
  // additive evidence, eased so that more of it always ranks higher and never pins at 100
  const ease = (x, k) => clamp(1 - Math.exp(-k * Math.max(0, x)));
  const open = ease((dbl ? 0.08 : 0.25) + 3.0 * all.fE + 0.9 * all.isolated + 0.3 * all.fT + 0.04 * Math.max(0, holdF - 1) + (dbl && !inter ? 0.25 * ((C.needleOut || 0) + (D.needleOut || 0)) : 0), 1.5);
  const texture = ease(0.08 + 1.0 * all.fT + (dbl ? 0.8 : 0.3) * all.fM + 0.06 * Math.max(0, holdF - 1) + 0.5 * all.fE, 1.7);
  const flat = clamp((dbl ? 0.82 : 0.22) + (dbl ? 0.1 : 0.9) * all.fT + (dbl ? 0.1 : 0.7) * all.fM);
  const smooth = clamp(1 - 1.1 * all.fT - 0.6 * all.fM - 2.5 * all.fE - 0.05 * Math.max(0, holdF - 1));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return {
    stretch: r3(stretch), open: r3(open), texture: r3(texture), flat: r3(flat), smooth: r3(smooth),
    shares: { knit: r3(all.fK), tuck: r3(all.fT), miss: r3(all.fM), transfer: r3(all.fE) },
    longest_float: floatF, longest_hold: holdF, double: dbl, gating: dbl ? gating : null,
    feature: [all.fK, all.fT, all.fM, all.fE, dbl ? 1 : 0, inter ? 1 : 0, Math.min(holdF, 6) / 6, Math.min(floatF, 6) / 6, all.isolated],
  };
}
const TRAITS = ['stretch', 'open', 'texture', 'flat', 'smooth'];
const distance = (a, b) => Math.sqrt(a.reduce((t, v, i) => t + (v - b[i]) ** 2, 0));

module.exports = { traitsOf, TRAITS, distance, longestRun };
