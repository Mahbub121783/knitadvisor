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
 *   needle out     a slot is as wide as the wales it holds (wales ÷ slots), so a needle taken out of a rib
 *                  narrows it in proportion — judged on 2×2 rib from 1×1 only: width within 4 %          (law)
 *   tuck, one bed  a ground-yarn tuck spreads its wale and shortens the loops it is held on:
 *                  width × (1 + κ·t), loop height × (1 − λ·t), t = tucks per knit loop             (piqué)
 *                  (a loop yarn's tucks only tie its float in: a different brick, not counted)
 *
 * What is not a law here yet (said, not guessed): a tuck on a double bed (it stretches the loop up, the waffle
 * records show, instead of spreading it), how a float narrows a wale, a needle left out's effect on height.
 * Judged by tools/floor-skip.js: the laws are learned from the floors given and asked for the families never
 * shown — with no table of those families anywhere.
 */
'use strict';

const median = (a) => { const s = a.filter((v) => Number.isFinite(v)).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

/** The features of a structure the laws read, from its stitch graph. */
function featuresOf(g) {
  const knitWales = g.needles.filter((n) => g.loops.some((L) => L.needle === n.id && L.kind !== 'tuck'));
  const perWale = knitWales.map((n) => g.loops.filter((L) => L.needle === n.id && L.kind !== 'tuck').length);
  const ground = new Set(g.yarns.filter((y) => y.role !== 'loop').map((y) => y.id));
  const knits = g.loops.filter((L) => L.kind !== 'tuck').length;
  let floats = 0, oneBedCourses = 0;
  const seen = new Set();
  for (const ps of g.passes) {
    if (ps.spans) for (const sp of ps.spans) if (sp.kind === 'float') floats++;
    if (ps.visits && !seen.has(ps.course)) {
      seen.add(ps.course);
      const beds = new Set(ps.visits.filter((v) => v.act === 'K' || v.act === 'T').map((v) => v.needle.replace(/\d+$/, '')));
      if (g.beds.length > 1 && beds.size === 1) oneBedCourses++;
    }
  }
  return {
    floats, one_bed_courses: oneBedCourses,
    ground_tucks_per_knit: knits ? g.loops.filter((L) => L.kind === 'tuck' && L.yarns.some((y) => ground.has(y))).length / knits : 0,
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
  const ribW = pick('rib', (c) => c.w_l), ribH = pick('rib', (c) => c.H_l), r22H = pick('rib2x2', (c) => c.H_l);
  const wL = pick('jersey+L', (c) => c.w_l), hL = pick('jersey+L', (c) => c.H_l);
  const pW = pick('pique', (c) => c.w_l), pH = pick('pique', (c) => c.H_l), pT = pick('pique', (c) => c.tucks_per_knit);
  return {
    w0, h0,
    tuck: pW != null && pH != null && pT > 0 ? { kappa: (pW / w0 - 1) / pT, lambda: (1 - pH / h0) / pT, learned_at: pT } : null,
    phi_rib: ribW != null ? ribW / (2 * w0) : null,
    h_rib: ribH,
    // a needle left out of a rib: the loops' height falls in proportion to the share of the slot left empty (2×2 rib, one in three out)
    eta_out: ribH != null && r22H != null ? (1 - r22H / ribH) / (1 - (4 / 3) / 2) : null,
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
  }
  // a loop is a jersey loop high on one bed, a rib loop high on a rib-gated double bed
  const ribbed = f.beds > 1 && f.gating !== 'interlock' && K.h_rib != null;
  let H = f.loops_per_wale * (ribbed ? K.h_rib : K.h0);
  if (ribbed) laws.push('rib loop height');
  if (f.beds > 1 && f.gating !== 'interlock' && f.wales / f.slots < 2) {
    laws.push('needle out: a slot as wide as its wales');
    if (K.eta_out != null) { H *= Math.max(0.3, 1 - K.eta_out * (1 - f.wales / f.slots / 2)); laws.push('needle out: shorter loops'); }
    else missing.push('a needle left out\'s effect on loop height (no 2×2 rib taught)');
  }
  if (f.plated) laws.push('plated: the face loop\'s cell');
  if (opts.elastane) {
    if (K.elastane) { w *= K.elastane.w; H *= K.elastane.h; laws.push('elastane closes the loops up'); }
    else missing.push('elastane (no jersey with elastane taught)');
  }
  const t = f.ground_tucks_per_knit;
  if (t > 0 && f.beds === 1) {
    if (K.tuck) {
      // learned at one share of tucks: past half as much again the effect is held there, and said to be stretched
      const tc = Math.min(t, 1.5 * K.tuck.learned_at);
      w *= 1 + K.tuck.kappa * tc; H *= Math.max(0.3, 1 - K.tuck.lambda * tc); laws.push('tuck: spreads the wale, shortens the loop');
      if (t > tc) missing.push(`more tucks (${Math.round(t * 100) / 100} per knit loop) than the tuck law was learned on (${Math.round(K.tuck.learned_at * 100) / 100})`);
    }
    else missing.push('how a tuck spreads its wale (no piqué taught)');
  } else if (t > 0) missing.push('a tuck on a double bed (it stretches the loop up instead)');
  if (f.floats && f.beds === 1) missing.push('how a float pulls its wales together');
  if (f.one_bed_courses) missing.push('a double-bed course knitted on one bed only (milano, bourrelet)');
  return { w_l: w, H_rep_l: H, laws, missing, features: f };
}

module.exports = { featuresOf, calibrate, cell };
