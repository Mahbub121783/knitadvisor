/**
 * Part 6 — loop geometry from brick laws on the stitch graph (v0).
 *
 * The relaxed cell of ANY structure — the width each needle slot takes and the height of one repeat — built from
 * laws about the bricks the stitch graph lists, not from a table per family. The laws carry four numbers, all
 * learned from the first floors only (plain jersey, its elastane variant, and a 1×1 rib):
 *
 *   plain loop     a knit loop of length ℓ takes a cell w₀·ℓ wide and h₀·ℓ high          (jersey)
 *   stacking       a wale is as tall as the loops it holds per repeat: tucks add no height, a loop held over
 *                  missed courses is ONE loop high (the courses it spans close up round it)    (law)
 *   plated         loops plated into one course (binder behind face) take the face loop's cell  (law)
 *   rib gating     the wales of both beds stand side by side in a slot, collapsed by φ          (1×1 rib)
 *   interlock      the beds face each other: a slot is one wale wide, the dial wale behind      (law)
 *   elastane       the loops close up by the factors the jersey with and without elastane show (jersey+L)
 *
 * What is not a law here yet (said, not guessed): how a tuck widens a wale, how a float narrows it, how a
 * needle left out opens the rib. Judged by tools/floor-skip.js: the laws are learned from the floors given
 * and asked for the families never shown — with no table of those families anywhere.
 */
'use strict';

const median = (a) => { const s = a.filter((v) => Number.isFinite(v)).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

/** The features of a structure the laws read, from its stitch graph. */
function featuresOf(g) {
  const knitWales = g.needles.filter((n) => g.loops.some((L) => L.needle === n.id && L.kind !== 'tuck'));
  const perWale = knitWales.map((n) => g.loops.filter((L) => L.needle === n.id && L.kind !== 'tuck').length);
  return {
    slots: g.period.needles, courses: g.period.courses, wales: knitWales.length,
    beds: new Set(knitWales.map((n) => n.bed)).size, gating: g.gating,
    loops_per_wale: perWale.length ? perWale.reduce((a, b) => a + b, 0) / perWale.length : 0,
    tucks: g.loops.filter((L) => L.kind === 'tuck').length,
    plated: g.loops.some((L) => L.plated_feeds > 1),
  };
}

/**
 * Learn the constants from cells measured on the first floors.
 * @param cells [{ kind: 'jersey'|'jersey+L'|'rib', w_l, H_l }]  slot width and loop height in loop lengths
 */
function calibrate(cells) {
  const pick = (k, f) => median(cells.filter((c) => c.kind === k).map(f));
  const w0 = pick('jersey', (c) => c.w_l), h0 = pick('jersey', (c) => c.H_l);
  if (w0 == null || h0 == null) throw new Error('The laws need plain jersey to learn the loop cell.');
  const ribW = pick('rib', (c) => c.w_l);
  const wL = pick('jersey+L', (c) => c.w_l), hL = pick('jersey+L', (c) => c.H_l);
  return {
    w0, h0,
    phi_rib: ribW != null ? ribW / (2 * w0) : null,
    elastane: wL != null && hL != null ? { w: wL / w0, h: hL / h0 } : null,
    learned_from: [...new Set(cells.map((c) => c.kind))],
  };
}

/**
 * The cell of a structure: slot width and repeat height, per law, in loop lengths (× ℓ for mm).
 * @returns { w_l, H_rep_l, laws: [names used], missing: [what no law covers yet] }
 */
function cell(g, K, opts = {}) {
  const f = featuresOf(g), laws = ['plain loop', 'stacking'], missing = [];
  let w;
  if (f.beds === 1) w = K.w0;
  else if (f.gating === 'interlock') { w = K.w0; laws.push('interlock: beds face to face'); }
  else {
    if (K.phi_rib == null) { missing.push('rib collapse (no rib taught)'); w = (f.wales / f.slots) * K.w0; }
    else { w = (f.wales / f.slots) * K.w0 * K.phi_rib; laws.push('rib gating: side by side, collapsed'); }
    if (f.wales / f.slots < 2) missing.push('how a needle left out opens the rib');
  }
  let H = f.loops_per_wale * K.h0;
  if (f.plated) laws.push('plated: the face loop\'s cell');
  if (opts.elastane) {
    if (K.elastane) { w *= K.elastane.w; H *= K.elastane.h; laws.push('elastane closes the loops up'); }
    else missing.push('elastane (no jersey with elastane taught)');
  }
  if (f.tucks) missing.push('how a tuck widens its wale');
  return { w_l: w, H_rep_l: H, laws, missing, features: f };
}

module.exports = { featuresOf, calibrate, cell };
