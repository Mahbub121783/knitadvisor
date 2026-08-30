/**
 * WOVEN CLOTH ARITHMETIC — mass, cover, crimp, consumption
 * ========================================================
 * The numeric half of the woven layer. woven.js holds the book's rules and
 * woven-design.js derives the loom plans; this file turns a construction
 * (ends/inch, picks/inch, two yarn counts, two crimps) into the numbers a
 * merchandiser is asked for: GSM, cover factor, yarn split, consumption.
 *
 * PROVENANCE — read this before trusting a number
 * -----------------------------------------------
 * Not everything here comes from Gokarneshan (2005). The book gives real
 * constructions and their crimps but states no mass or cover equation, so the
 * relations below are labelled by where they actually come from:
 *
 *   STANDARD  — the definition of the count system itself, so it carries no
 *               empirical constant at all: tex = 590.5 / Ne, and mass equals
 *               thread length times linear density. Nothing to distrust.
 *   PEIRCE    — Peirce's cloth cover factor, K = K1 + K2 - K1.K2/28. The 28 is
 *               an empirical maximum for the cotton system and is NOT in this
 *               book; it is named here so a reader can weigh it separately.
 *   BOOK      — crimp percentages the book prints for specific cloths.
 *   ASSUMED   — a default crimp used when the caller supplies none. Always
 *               reported back with `crimp_source: 'ASSUMED'` so it is never
 *               mistaken for a measurement.
 *
 * WHY THIS IS NOT IN THE KNIT ENGINE
 * ----------------------------------
 * A knitted fabric's weight comes from loop length and stitch density; a woven
 * one's comes from thread spacing and crimp. They share no term. calculate()
 * is untouched and stays knit-only.
 */
'use strict';

const INCHES_PER_METRE = 39.3700787;
const NE_TO_TEX = 590.5;

// ─────────────────────────────────────────────────────────────
// COUNT PARSING
// ─────────────────────────────────────────────────────────────

/**
 * Read the count strings the book's own tables use — "2/80s", "30s",
 * "2/14s & 36s", "60 tex two fold". Returns the RESULTANT count, which is
 * what mass depends on: two 80s singles twisted together behave as one 40s.
 *
 * A string naming two different yarns is reported as ambiguous with the first
 * taken, rather than silently averaged — the caller should ask rather than
 * guess which one is on the beam.
 */
function parseCount(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return { ne: raw, plies: 1, resultant_ne: raw, raw: String(raw), ambiguous: false };

  const text = String(raw).trim();
  const ambiguous = /&|;|\(/.test(text);

  const tex = text.match(/(\d+(?:\.\d+)?)\s*tex/i);
  if (tex) {
    const t = Number(tex[1]);
    const folded = /two\s*fold|2\s*fold|\bdouble\b/i.test(text) ? 2 : 1;
    // A "60 tex two fold" yarn is 120 tex resultant — folding adds mass.
    const resultantTex = t * folded;
    return { ne: NE_TO_TEX / resultantTex, plies: folded, resultant_ne: NE_TO_TEX / resultantTex,
             tex: resultantTex, raw: text, ambiguous, system: 'tex' };
  }

  const folded = text.match(/(\d+)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (folded) {
    const plies = Number(folded[1]);
    const singles = Number(folded[2]);
    return { ne: singles, plies, resultant_ne: singles / plies, raw: text, ambiguous, system: 'Ne' };
  }

  const single = text.match(/(\d+(?:\.\d+)?)/);
  if (!single) return null;
  const n = Number(single[1]);
  return { ne: n, plies: 1, resultant_ne: n, raw: text, ambiguous, system: 'Ne' };
}

const neToTex = ne => NE_TO_TEX / ne;

// ─────────────────────────────────────────────────────────────
// CRIMP
// ─────────────────────────────────────────────────────────────

/**
 * Crimp is the extra length a thread takes because it bends round the threads
 * it crosses, so it raises weight and consumption in proportion. It rises with
 * the number of intersections, which is why plain crimps most and a satin
 * least — and `average_float` from woven-design.js measures exactly that.
 *
 * The book prints crimp only for a handful of cloths (velveteen 15-20%, the
 * extra-warp ground 22.5%). For everything else these defaults are ASSUMED and
 * say so. They are scaled off the float ratio rather than being one flat
 * number, so a satin is not charged a plain weave's crimp.
 */
function defaultCrimp(averageFloat = 1) {
  const f = Math.max(1, averageFloat);
  // Plain (float 1) -> 7% warp / 6% weft; the crimp falls as floats lengthen.
  const warp = 7 / Math.sqrt(f);
  const weft = 6 / Math.sqrt(f);
  return {
    warp_pct: Math.round(warp * 10) / 10,
    weft_pct: Math.round(weft * 10) / 10,
    source: 'ASSUMED',
    basis: 'scaled from a 7% / 6% plain-weave baseline by the square root of the average float, so longer floats are charged less crimp. Replace with a measured value whenever one exists.',
  };
}

// ─────────────────────────────────────────────────────────────
// MASS
// ─────────────────────────────────────────────────────────────

/**
 * Cloth weight in g/m², split into warp and weft.
 *
 *   ends in one metre of width   = EPI x 39.37
 *   length of each end per metre = 1 m x (1 + crimp)
 *   mass                         = length x tex / 1000
 *
 * Every step is the definition of a unit, so the only judgement in the whole
 * calculation is the crimp — which is why it is reported back beside the result.
 */
function clothWeight({ epi, ppi, warpNe, weftNe, warpCrimpPct = null, weftCrimpPct = null, averageFloat = 1 }) {
  if (!(epi > 0 && ppi > 0 && warpNe > 0 && weftNe > 0)) return null;

  const assumed = defaultCrimp(averageFloat);
  const cw = warpCrimpPct == null ? assumed.warp_pct : warpCrimpPct;
  const cf = weftCrimpPct == null ? assumed.weft_pct : weftCrimpPct;

  const warpTex = neToTex(warpNe);
  const weftTex = neToTex(weftNe);

  const warpGsm = epi * INCHES_PER_METRE * (1 + cw / 100) * warpTex / 1000;
  const weftGsm = ppi * INCHES_PER_METRE * (1 + cf / 100) * weftTex / 1000;
  const total = warpGsm + weftGsm;
  const r1 = v => Math.round(v * 10) / 10;

  return {
    gsm: r1(total),
    warp_gsm: r1(warpGsm),
    weft_gsm: r1(weftGsm),
    warp_share_pct: Math.round((warpGsm / total) * 1000) / 10,
    oz_per_sq_yd: Math.round((total / 33.906) * 100) / 100,
    warp_tex: Math.round(warpTex * 100) / 100,
    weft_tex: Math.round(weftTex * 100) / 100,
    warp_crimp_pct: cw,
    weft_crimp_pct: cf,
    // Reported per direction, because a cloth often has one measured crimp and
    // one assumed — the book gives corduroy's 20% weft crimp and no warp crimp
    // at all — and a single flag would hide which half is which.
    warp_crimp_source: warpCrimpPct == null ? 'ASSUMED' : 'SUPPLIED',
    weft_crimp_source: weftCrimpPct == null ? 'ASSUMED' : 'SUPPLIED',
    crimp_basis: (warpCrimpPct == null || weftCrimpPct == null) ? assumed.basis : null,
    source: 'STANDARD',
    basis: 'tex = 590.5 / Ne, and mass = thread length x linear density. No empirical constant.',
  };
}

/**
 * Solve the same relation backwards: what counts give a target GSM at a fixed
 * sett? The knit engine answers the equivalent question for GSM -> Ne, and a
 * merchandiser asks it in exactly the same words about a woven quality.
 *
 * `ratio` is weft tex divided by warp tex — 1 means both yarns the same count.
 */
function countsForTargetGsm({ gsm, epi, ppi, ratio = 1, warpCrimpPct = null, weftCrimpPct = null, averageFloat = 1 }) {
  if (!(gsm > 0 && epi > 0 && ppi > 0 && ratio > 0)) return null;
  const assumed = defaultCrimp(averageFloat);
  const cw = warpCrimpPct == null ? assumed.warp_pct : warpCrimpPct;
  const cf = weftCrimpPct == null ? assumed.weft_pct : weftCrimpPct;

  // gsm = [epi.(1+cw) + ppi.(1+cf).ratio] . 39.37 . warpTex / 1000
  const k = (epi * (1 + cw / 100) + ppi * (1 + cf / 100) * ratio) * INCHES_PER_METRE / 1000;
  const warpTex = gsm / k;
  const weftTex = warpTex * ratio;
  const r2 = v => Math.round(v * 100) / 100;

  return {
    warp_ne: r2(NE_TO_TEX / warpTex),
    weft_ne: r2(NE_TO_TEX / weftTex),
    warp_tex: r2(warpTex),
    weft_tex: r2(weftTex),
    ratio,
    crimp_source: assumed.source === 'ASSUMED' && (warpCrimpPct == null || weftCrimpPct == null) ? 'ASSUMED' : 'SUPPLIED',
    source: 'STANDARD',
    basis: 'the mass relation solved for tex; the crimp assumption carries straight through, so treat the answer as no firmer than the crimp.',
  };
}

// ─────────────────────────────────────────────────────────────
// COVER
// ─────────────────────────────────────────────────────────────

/**
 * Cover factor — how much of the cloth area the threads occupy.
 *
 * K1 = EPI / sqrt(Ne) and K2 = PPI / sqrt(Ne) are definitions in the cotton
 * system. The cloth cover K1 + K2 - K1.K2/28 is Peirce's, and the 28 is an
 * empirical figure for a maximally set plain weave in that system — it is NOT
 * from Gokarneshan. `saturation_pct` is that comparison made explicit.
 *
 * The weave matters and is reported alongside: a satin can be set far past a
 * plain weave's limit precisely because it intersects less, so a cover factor
 * near 28 means something different for a 3/1 twill than for a plain.
 */
function coverFactor({ epi, ppi, warpNe, weftNe, averageFloat = 1 }) {
  if (!(epi > 0 && ppi > 0 && warpNe > 0 && weftNe > 0)) return null;
  const k1 = epi / Math.sqrt(warpNe);
  const k2 = ppi / Math.sqrt(weftNe);
  const cloth = k1 + k2 - (k1 * k2) / 28;
  const r2 = v => Math.round(v * 100) / 100;

  // A weave that intersects less can be set more closely before it jams; the
  // float ratio is the honest way to say by how much, without a second constant.
  const practicalCeiling = 28 * Math.sqrt(Math.max(1, averageFloat));

  return {
    warp_cover: r2(k1),
    weft_cover: r2(k2),
    cloth_cover: r2(cloth),
    saturation_pct: Math.round((cloth / practicalCeiling) * 1000) / 10,
    practical_ceiling: r2(practicalCeiling),
    jammed: cloth >= practicalCeiling,
    source: 'PEIRCE',
    basis: 'K = K1 + K2 - K1.K2/28 in the cotton system. The 28 is an empirical plain-weave maximum and does not come from Gokarneshan (2005); the ceiling is widened by the square root of the average float because a longer float intersects less and jams later.',
  };
}

// ─────────────────────────────────────────────────────────────
// CONSUMPTION
// ─────────────────────────────────────────────────────────────

/**
 * Yarn required for a piece of cloth, in kilograms, split warp and weft.
 * Width is finished width in inches; length in metres.
 *
 * Warp is bought by the beam, so total ends matters as much as weight — both
 * are returned. Wastage is applied as a flat percentage and reported, not
 * folded silently into the total.
 */
function consumption({ epi, ppi, warpNe, weftNe, widthInch, lengthM,
                       warpCrimpPct = null, weftCrimpPct = null, averageFloat = 1, wastagePct = 3 }) {
  if (!(widthInch > 0 && lengthM > 0)) return null;
  const w = clothWeight({ epi, ppi, warpNe, weftNe, warpCrimpPct, weftCrimpPct, averageFloat });
  if (!w) return null;

  const areaM2 = (widthInch / INCHES_PER_METRE) * lengthM;
  const warpKg = (w.warp_gsm * areaM2) / 1000;
  const weftKg = (w.weft_gsm * areaM2) / 1000;
  const gross = (warpKg + weftKg) * (1 + wastagePct / 100);
  const r3 = v => Math.round(v * 1000) / 1000;

  return {
    area_m2: Math.round(areaM2 * 100) / 100,
    total_ends: Math.round(epi * widthInch),
    warp_length_m: Math.round(lengthM * (1 + w.warp_crimp_pct / 100) * 100) / 100,
    warp_kg: r3(warpKg),
    weft_kg: r3(weftKg),
    net_kg: r3(warpKg + weftKg),
    wastage_pct: wastagePct,
    gross_kg: r3(gross),
    gsm: w.gsm,
    source: 'STANDARD',
  };
}

module.exports = {
  parseCount,
  neToTex,
  defaultCrimp,
  clothWeight,
  countsForTargetGsm,
  coverFactor,
  consumption,
  INCHES_PER_METRE,
  NE_TO_TEX,
};
