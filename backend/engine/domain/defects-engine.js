/**
 * KnitAdvisor — Defect simulator: barré (stripes across the cloth) and grinning (the yarn behind showing through the face).
 *
 *   BARRÉ     A circular knitting machine feeds the same cloth from many feeders. If the loop one feeder knits is a little longer than its
 *             neighbour's (a tension or a stitch-cam difference), or the yarn on two packages differs a little in count, every course of that
 *             feeder is a little more or less dense, and the difference repeats once a revolution: stripes across the cloth, seen most in a
 *             plain, medium-shade cloth in a hard light. Here: the feeder-to-feeder loop-length spread (the VDQ tolerance, taken as ±3σ),
 *             the package-to-package count spread, the cover change they make, the lightness step that gives (ΔL*), how visible it is, the
 *             loop-length tolerance that keeps it invisible, and the stripe pattern one revolution draws.
 *   GRINNING  A back or binder yarn that differs in colour from the face shows through the gaps of the loops and at their edges, most when the
 *             cloth is stretched on the body. Here: the colour difference (ΔE2000) between the two, the share of the face the back yarn
 *             is visible in at rest, at 20 % and at 40 % stretch, and the verdict. The usual trigger is a colour difference above 25, a porosity
 *             above 15 % and a visible share above 8 %.
 *
 * Basis: law = the arithmetic (spreads add in quadrature, the open area of the loops, ΔE2000); estimate = the lightness a cover change makes (by shade and
 * structure), the visibility thresholds and the edge visibility of a back yarn: a mill's own stripe-visibility rating replaces them.
 * No outside source is named.
 */
'use strict';
const { dE00, hexToLab } = require('./melange-engine');

const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const V = (value, unit, basis, extra) => (value == null || !Number.isFinite(value) ? null : { value, unit, basis, ...(extra || {}) });

const S0 = 0.7;                                                   // L* per % of cover, a medium plain jersey (estimate)
const SHADE = { white: 0.25, pastel: 0.5, light: 0.8, medium: 1.0, dark: 0.75, black: 0.35 };
const STRUCT = { jersey: 1.0, pique: 0.75, rib: 0.55, interlock: 0.65, purl: 0.6, fleece: 0.5, terry: 0.35, plush: 0.35, mesh: 0.6, warp: 0.5 };
const VISIBLE = 0.6, OBVIOUS = 1.2;                               // ΔL* of a regular stripe: seen / obvious
const EDGE = { plated: 0.12, loop: 0.10, binder: 0.08, double: 0.06 };

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(rnd) { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

function barre(p) {
  const l = +p.sl_mm;
  if (!(l > 0)) throw new Error('Give the loop length of the cloth.');
  const shade = SHADE[p.shade] != null ? p.shade : 'medium';
  const kind = STRUCT[p.kind] != null ? p.kind : 'jersey';
  const feeders = clamp(Math.round(+p.feeders) || 48, 2, 192);
  const tol = clamp(+p.tol_sl_mm > 0 ? +p.tol_sl_mm : 0.03, 0.002, 0.3);
  const cvC = clamp(+p.cv_count > 0 ? +p.cv_count : 0.8, 0.1, 6) / 100;
  const sl = tol / 3;                                              // ±tol is taken as ±3σ of one feeder's loop length
  const cSl = sl / l, cCnt = cvC / 2;                              // yarn diameter goes as √tex: half the count spread
  const sigmaCover = Math.sqrt(cSl * cSl + cCnt * cCnt);           // per feeder, relative cover
  const sDiff = sigmaCover * Math.SQRT2;                           // between two neighbouring feeders
  const S = S0 * SHADE[shade] * STRUCT[kind];
  const dL = S * sDiff * 100;                                      // typical lightness step between neighbouring feeders
  const rnd = mulberry(Math.round(l * 1000 + feeders * 7 + tol * 1e4));
  const n = Math.min(feeders, 64);
  const prof = Array.from({ length: n }, () => S * sigmaCover * 100 * gauss(rnd));          // ΔL* of each feeder against the mean
  const peak = Math.max(...prof) - Math.min(...prof);
  // the step between neighbours is S·√2·σ·100: the tolerance that keeps it at the visibility threshold (the count spread takes its share first)
  const lim = (VISIBLE / (S * 100 * Math.SQRT2)) ** 2 - cCnt ** 2;
  const tolInvisible = lim > 0 ? 3 * l * Math.sqrt(lim) : 0;
  const risk = dL >= OBVIOUS ? 'obvious' : dL >= VISIBLE ? 'visible' : dL >= VISIBLE * 0.5 ? 'faint' : 'invisible';
  const warnings = [];
  const say = (level, text) => warnings.push({ level, text });
  if (risk === 'obvious' || risk === 'visible') say('warn', `A loop-length spread of ±${tol} mm and a count spread of ${r2(cvC * 100)} % give a lightness step of ΔL* ${r2(dL)} between neighbouring feeders (${r1(peak)} from the lightest to the darkest feeder): ${risk} barré in a ${shade} ${kind === 'jersey' ? 'plain jersey' : kind}.${tolInvisible > 0 ? ` Keep the feeder loop length within ±${r3(tolInvisible)} mm.` : ' The yarn count spread alone is too wide: sort the packages by count.'}`);
  else if (risk === 'faint') say('note', `A lightness step of ΔL* ${r2(dL)} between feeders: faint barré, seen only in a hard, raking light.`);
  return {
    success: true,
    inputs: { sl_mm: l, feeders, tol_sl_mm: tol, cv_count_pct: r2(cvC * 100), shade, kind },
    cover_spread_pct: V(r2(sigmaCover * 100), '% of cover, one feeder', 'law', { from: `loop length ±${tol} mm taken as ±3σ of ${r2(l)} mm, and the count spread` }),
    neighbour_difference_pct: V(r2(sDiff * 100), '% of cover, between neighbouring feeders', 'law'),
    lightness_step: V(r2(dL), 'ΔL* between neighbouring feeders', 'estimate'),
    sensitivity: V(r2(S), 'L* per % of cover', 'estimate', { shade_factor: SHADE[shade], structure_factor: STRUCT[kind] }),
    risk, thresholds: { visible: VISIBLE, obvious: OBVIOUS },
    tolerance_for_invisible_mm: V(r3(tolInvisible), '± mm of loop length, per feeder', 'estimate'),
    profile: { feeders, courses_drawn: n, delta_l: prof.map(r2), peak_to_peak: r2(peak), note: 'the lightness of each feeder\'s courses against the mean: one revolution, repeated up the cloth' },
    warnings,
    derivations: [
      { id: 'cover', quantity: 'Cover spread of one feeder', formula: 'σ = √((tol/3 ÷ ℓ)² + (cv_count ÷ 2)²)', working: `√((${r3(sl)} ÷ ${r2(l)})² + (${r3(cvC / 2)})²)`, result: r3(sigmaCover), unit: '', basis: 'law' },
      { id: 'step', quantity: 'Lightness step', formula: 'ΔL* = S · √2 · σ · 100, S = S₀ · shade · structure', working: `${r2(S)} × ${r3(sDiff * 100)}`, result: r2(dL), unit: 'ΔL*', basis: 'estimate' },
    ],
    basis: { law: ['spreads add in quadrature', 'the difference of two neighbours is √2 σ'], estimated: ['the lightness a cover change makes by shade and structure', 'the visibility thresholds (0.6 seen, 1.2 obvious)'], replaced_by: 'a stripe-visibility rating of a trial roll under the buyer\'s light' },
  };
}

function grinning(p) {
  const face = /^#[0-9a-f]{6}$/i.test(p.face_hex || '') ? p.face_hex : null, back = /^#[0-9a-f]{6}$/i.test(p.back_hex || '') ? p.back_hex : null;
  const kinds = ['plated', 'loop', 'binder', 'double'];
  const kind = kinds.includes(p.back_kind) ? p.back_kind : null;
  if (!kind) return { success: true, applicable: false, status: 'na', text: 'One yarn, one layer: nothing behind the face to show through.' };
  if (!face || !back) return { success: true, applicable: true, status: 'not_checked', kind, text: 'A back or binder yarn is there: give its colour (and the face colour) to check whether it shows through.' };
  const dE = dE00(hexToLab(face), hexToLab(back));
  const open = [clamp(+p.open_rest || 0, 0, 0.9), clamp(+p.open_20 || 0, 0, 0.95), clamp(+p.open_40 || 0, 0, 0.97)];
  const edge = EDGE[kind];
  const vis = open.map((o) => clamp(o + edge * (1 - o), 0, 1));
  const g20 = vis[1] * Math.min(1, dE / 25);
  const trigger = dE > 25 && Math.max(...open) > 0.15 && vis[1] > 0.08;
  const status = trigger || g20 >= 0.06 ? 'warn' : g20 >= 0.03 ? 'note' : 'pass';
  const text = status === 'pass' ? `The back yarn differs from the face by ΔE ${r1(dE)} and is visible in ${r1(vis[1] * 100)} % of the face at 20 % stretch: it will not grin.`
    : `The back yarn differs from the face by ΔE ${r1(dE)} and shows in ${r1(vis[0] * 100)} % of the face at rest, ${r1(vis[1] * 100)} % at 20 % stretch and ${r1(vis[2] * 100)} % at 40 %: ${status === 'warn' ? 'it will grin when the cloth is worn and stretched' : 'a slight grin when stretched'}.`;
  return {
    success: true, applicable: true, status, kind, delta_e: V(r1(dE), 'ΔE2000, face to back yarn', 'law'),
    visible_back_pct: { rest: V(r1(vis[0] * 100), '% of the face', 'estimate'), s20: V(r1(vis[1] * 100), '% of the face', 'estimate'), s40: V(r1(vis[2] * 100), '% of the face', 'estimate') },
    porosity_pct: { rest: r1(open[0] * 100), s20: r1(open[1] * 100), s40: r1(open[2] * 100) },
    index: V(r3(g20), 'visible share × min(1, ΔE ÷ 25), at 20 % stretch', 'estimate'),
    rule: 'warn when ΔE > 25 and porosity > 15 % and the visible share > 8 %, or when the index passes 0.06',
    text,
    repair: status === 'warn' || status === 'note' ? 'Dye or choose the back yarn near the face colour (a melange or a matched shade), or close the cloth (a tighter loop, a finer gauge).' : null,
    basis: { law: ['the open area of the loops', 'ΔE2000'], estimated: ['the edge visibility of a back yarn (plated 12 %, loop yarn 10 %, binder 8 %)', 'the 0.06 index'] },
  };
}

module.exports = { barre, grinning, STRUCT, SHADE };
