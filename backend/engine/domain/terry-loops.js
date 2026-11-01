/**
 * KnitAdvisor — terry loops: size and arrangement
 * ==============================================
 *
 * A terry is named by its loops: how big they are and how they are laid out.
 *
 * LOOPBACK (French) terry. The loop yarn tucks into the back of the face on
 * one needle in n and floats over the sinkers across the rest. The float
 * spans S = n · p (p = needle pitch) but carries n · l of yarn (l = loop
 * length per needle, set by the sinker), so the surplus stands off the back
 * as the loop. As a shallow arc over its chord S (parabola, arc length
 * L ≈ √(S² + 16h²/3)):
 *
 *     h = √( 3/16 · (L² − S²) ),   L = n·l,  S = n·p
 *
 * l > p is needed for any loop at all. Where the tuck sits from one loop feed
 * to the next lays the loops out: half-drop (standard), in columns
 * (straight), stepping one needle per feed (diagonal), stepping and returning
 * (zig-zag), or tying every second needle (1:1 micro).
 *
 * PLUSH (sinker-loop) terry. The pile yarn forms a loop over the high sinker
 * nib wherever it is selected: every needle (full plush), alternate needles
 * (1:1, vertical stripes), alternate needles shifting each course (checker),
 * or one needle in three stepping each course (diagonal). The loop height is
 * the sinker height; a selected position adds 2h of pile yarn.
 *
 * The size presets and arrangements are the common mill set-ups; names
 * differ from mill to mill ("cross terry", "baby terry"), so every option is
 * stated by its tuck/selection rule as well as by name. The loop lengths
 * behind the size presets are MODELLED around the one measured loopback order
 * (1.55 mm per needle on 20G, risk record 47).
 */
'use strict';

const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;

// ── loopback ────────────────────────────────────────────────────────────
// loop length per needle on 20G, mm (scaled by 20/G)
const LOOPBACK_SIZES = {
  // a loop needs more yarn per needle than the needle pitch (1.27 mm on 20G)
  micro:    { label: 'Micro (baby terry)', l20: 1.35 },
  small:    { label: 'Small loop',         l20: 1.45 },
  standard: { label: 'Standard loop',      l20: 1.55 },
  large:    { label: 'Large loop',         l20: 1.80 },
  jumbo:    { label: 'Jumbo loop',         l20: 2.00 },
};

// n = tuck repeat (one tuck in n needles); seq = tucking needle on each
// successive loop feed
const LOOPBACK_ARRANGEMENTS = {
  standard: { label: 'Standard (1:3 half-drop)', n: 4, seq: [3, 1],
    look: 'Loops in a brick (half-drop) layout — the even, all-over loop back most French terry has.',
    face: 'Tucks are spread out; the face stays a clean jersey.' },
  straight: { label: 'Straight (1:3, vertical lines)', n: 4, seq: [3],
    look: 'Every loop feed ties on the same needle, so the loops stack in columns — a ribbed-looking back.',
    face: 'All tucks fall on one needle in four: in light or solid shades a faint vertical tuck line can show on the face.' },
  diagonal: { label: 'Diagonal (1:3, one needle per feed)', n: 4, seq: [3, 2, 1, 0],
    look: 'The tie point steps one needle per loop feed, so the loops run in diagonal lines — a twill-like back.',
    face: 'A faint diagonal can show on a thin face in light shades.' },
  zigzag: { label: 'Zig-zag (1:3, step and return)', n: 4, seq: [3, 2, 1, 0, 1, 2],
    look: 'The tie point steps across and back, so the loops form chevrons (herringbone).',
    face: 'Like diagonal, but the line reverses — less visible than a straight diagonal.' },
  micro: { label: '1:1 (tie every second needle)', n: 2, seq: [1, 0],
    look: 'Short floats tied every second needle, alternating: small, dense, crossing loops — a fine, firm back.',
    face: 'Twice the tucks of a 1:3 terry: the face is firmer and a little narrower, and a coarse loop yarn can grin through a fine face.' },
  open: { label: 'Long float (1:5)', n: 6, seq: [5, 2],
    look: 'Long floats with big, loose loops — the softest, loftiest back.',
    face: 'Few tucks, clean face; the long floats snag more easily.' },
};

function loopbackSize(key, lengthMm, G) {
  if (+lengthMm > 0) return { key: 'custom', label: `${r2(+lengthMm)} mm per needle`, l: +lengthMm };
  const s = LOOPBACK_SIZES[key] || LOOPBACK_SIZES.standard;
  return { key: LOOPBACK_SIZES[key] ? key : 'standard', label: s.label, l: s.l20 * 20 / G };
}

/** Loop height, float and density of a loopback layout. */
function loopbackGeometry({ n, l, G, wpc, cpc }) {
  const p = 25.4 / G;
  const S = n * p, L = n * l;
  const h = L > S ? Math.sqrt(3 / 16 * (L * L - S * S)) : 0;
  return {
    needle_pitch_mm: r2(p), float_mm: r2(S), loop_yarn_per_float_mm: r2(L), loop_height_mm: r2(h),
    taut: L <= S,
    loops_per_cm2: r1(cpc * wpc / n), tucks_per_cm2: r1(cpc * wpc / n),
    // exposed loop area per loop relative to a standard 1:3 / 1.55 mm loop on 20G
    snag_area: h * S,
  };
}

/** The machine programme for a loopback layout, in the pattern engine's format. */
function loopbackPattern(arrKey) {
  const a = LOOPBACK_ARRANGEMENTS[arrKey] || LOOPBACK_ARRANGEMENTS.standard;
  const K = Array(a.n).fill('K');
  const grid = [], cam = [];
  a.seq.forEach((t, i) => {
    const row = Array.from({ length: a.n }, (_, k) => (k === t ? 'T' : 'M'));
    grid.push(K.slice(), K.slice(), row);
    const f = i * 3;
    cam.push(
      { feed: f + 1, cylinder: 'K', yarn: 'plated', note: 'Binder (tie-in) knits all needles' },
      { feed: f + 2, cylinder: 'K', yarn: 'ground', note: 'Face yarn knits all needles' },
      { feed: f + 3, cylinder: 'M/T', yarn: 'fleece', note: `Loop yarn tucks on track ${t + 1}, misses the other ${a.n - 1}` },
    );
  });
  return {
    pattern_cylinder: grid, cam_arrangement: cam,
    courses_per_repeat: grid.length, wales_per_repeat: a.n,
    needle_arrangement: { butt_pattern: 'ABCDEF'.slice(0, a.n), description: `${a.n}-track arrangement; loop yarn tucks on tracks ${a.seq.map(t => t + 1).join(', ')} in turn.` },
  };
}

// ── plush ───────────────────────────────────────────────────────────────
// sinker (high-nib) heights, mm
const PLUSH_SIZES = {
  micro:    { label: 'Micro loop', h: 1.0 },
  small:    { label: 'Small loop', h: 1.5 },
  standard: { label: 'Standard loop', h: 2.0 },
  large:    { label: 'Large loop', h: 2.5 },
  jumbo:    { label: 'Jumbo (towel) loop', h: 3.0 },
};

// phi = share of needle positions that carry a loop; sel(w, c) for the 3D
const PLUSH_ARRANGEMENTS = {
  full:      { label: 'Full plush (every needle)', phi: 1,
    look: 'A loop at every needle in every course — a solid, all-over pile.' },
  alternate: { label: '1:1 stripe (every second needle)', phi: 1 / 2,
    look: 'Loops on alternate needles, the same needles every course — fine vertical pile stripes.' },
  checker:   { label: 'Checker (alternate, shifting each course)', phi: 1 / 2,
    look: 'Loops on alternate needles, shifting one needle each course — an even, lighter pile with no stripes.' },
  diagonal:  { label: 'Diagonal (1 in 3, stepping each course)', phi: 1 / 3,
    look: 'One needle in three carries a loop, stepping one needle per course — pile in diagonal lines.' },
};

module.exports = {
  LOOPBACK_SIZES, LOOPBACK_ARRANGEMENTS, PLUSH_SIZES, PLUSH_ARRANGEMENTS,
  loopbackSize, loopbackGeometry, loopbackPattern,
};
