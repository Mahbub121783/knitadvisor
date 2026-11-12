/**
 * A woven cloth read off a photo, worked back to a construction the woven engine can calculate.
 *
 * The phone measures three things it can see: the weave (its lattice in thread units — plain, twill and its
 * hand, satin, basket, oxford…), the ends and picks per cm, and the colours of the two thread sets. It cannot
 * see the yarn count. So the count comes from what the person knows, in this order:
 *
 *   1. counts typed in             → used as given                                  (SUPPLIED)
 *   2. a GSM typed in              → both counts solved from the mass relation        (CALCULATED)
 *                                    at the standard quality's warp / weft tex ratio
 *   3. neither                     → the standard quality's cover factor carried to   (ESTIMATED)
 *                                    the measured sett: K = threads per inch / sqrt(Ne)
 *                                    is what a cloth is designed to, so a cloth with more
 *                                    ends per inch than the standard is, to first order,
 *                                    woven from proportionally finer yarn
 *
 * Every number says which of the three it is. Nothing here is a lookup of a finished answer: the standard
 * quality supplies the weave's draft, the crimp baseline and a cover target; the arithmetic is the woven
 * engine's own (tex = 590.5 / Ne, mass = thread length × linear density, Peirce cover).
 */

'use strict';

const { calculateWoven } = require('./woven-engine');
const { getWovenFabric } = require('../catalog/woven-derivatives');
const cloth = require('../formulas/woven-cloth');

class WovenReverseError extends Error {}

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const CM_PER_INCH = 2.54;

/** The standard quality nearest the weave that was read — the source of the draft, crimp and cover target. */
function pickQuality(weave, epi, opts = {}) {
  const cls = String(weave.cls || '');
  const notation = String(weave.notation || '');
  const steep = weave.angle_deg != null && weave.angle_deg > 60;
  if (cls === 'plain' || cls === 'threads') {
    if (epi >= 90) return { id: 'woven_plain_shirting', why: 'plain weave at ' + Math.round(epi) + ' ends per inch — a shirting set' };
    return { id: 'woven_sheeting', why: 'plain weave at ' + Math.round(epi) + ' ends per inch — a sheeting / canvas set' };
  }
  if (cls === 'twill') {
    if (opts.denim) return { id: 'woven_denim', why: 'twill with an indigo warp over a light weft' };
    if (notation === '2/2') return steep ? { id: 'woven_gabardine', why: '2/2 twill at a steep angle' } : { id: 'woven_serge', why: '2/2 twill near 45 degrees' };
    if (notation === '3/1' || notation === '1/3' || weave.repeat === 4) return { id: 'woven_denim', why: 'a 4-thread twill (3/1) — the denim construction, here without indigo' };
    return { id: 'woven_drill', why: 'a 3-thread twill (2/1) — drill / chino' };
  }
  if (cls === 'satin') {
    if (weave.face === 'weft') return { id: 'woven_sateen_5', why: 'a satin with the weft on the face — sateen' };
    if (weave.repeat === 8) return { id: 'woven_satin_8', why: 'an 8-end satin' };
    return { id: 'woven_satin_5', why: 'a 5-end satin, warp on the face' };
  }
  if (cls === 'basket') return { id: 'woven_matt', why: '2/2 basket — matt / hopsack' };
  if (cls === 'half_basket_warp' || cls === 'half_basket_weft') {
    if (/oxford/i.test(weave.name || '')) return { id: 'woven_oxford', why: 'ends working in pairs over single picks — oxford' };
    return { id: 'woven_warp_rib', why: 'picks working in pairs — a warp rib' };
  }
  throw new WovenReverseError('This weave cannot be matched to a woven quality yet.');
}

function nearestCount(ne) {
  // commercial cotton counts are whole numbers; finer than 40s they go in fives
  const n = ne >= 40 ? Math.round(ne / 5) * 5 : Math.round(ne);
  return Math.max(1, n);
}

/**
 * @param input {weave:{cls, repeat, notation, hand, face, name, angle_deg}, ends_per_cm, picks_per_cm,
 *               gsm?, composition?, warp_count?, weft_count?, denim?, confidence?}
 */
function reverse(input = {}) {
  const weave = input.weave || {};
  const epc = Number(input.ends_per_cm), ppc = Number(input.picks_per_cm);
  if (!(epc >= 4 && epc <= 120) || !(ppc >= 4 && ppc <= 120)) throw new WovenReverseError('Ends and picks per cm were not measured.');
  const epi = epc * CM_PER_INCH, ppi = ppc * CM_PER_INCH;
  const q = pickQuality(weave, epi, { denim: !!input.denim });
  const fabric = getWovenFabric(q.id);
  if (!fabric) throw new WovenReverseError('The matching woven quality is missing from the catalogue.');

  const book = { warp: cloth.parseCount(fabric.sett.warp_count), weft: cloth.parseCount(fabric.sett.weft_count) };
  const notes = [];
  let warpNe, weftNe, countSource, basis;
  const given = { warp: input.warp_count ? cloth.parseCount(String(input.warp_count)) : null, weft: input.weft_count ? cloth.parseCount(String(input.weft_count)) : null };

  if (given.warp && given.weft) {
    warpNe = given.warp.resultant_ne; weftNe = given.weft.resultant_ne; countSource = 'SUPPLIED';
    basis = 'the counts entered.';
  } else if (input.gsm > 0) {
    // the mass relation solved at this sett, the warp/weft tex ratio of the standard quality; one pass through
    // the engine afterwards puts the weave's own crimp in, and the counts are scaled once more to land on the GSM
    const ratio = book.warp.resultant_ne / book.weft.resultant_ne;
    const sol = cloth.countsForTargetGsm({ gsm: input.gsm, epi, ppi, ratio });
    if (!sol) throw new WovenReverseError('The GSM could not be turned into counts.');
    warpNe = sol.warp_ne; weftNe = sol.weft_ne;
    for (let i = 0; i < 3; i++) {
      const t = calculateWoven({ fabric_id: q.id, epi, ppi, warp_count: warpNe + 's', weft_count: weftNe + 's' });
      if (!t.success && t.success !== undefined) break;
      const g = t.weight && t.weight.gsm;
      if (!(g > 0)) break;
      const f = g / input.gsm;
      warpNe *= f; weftNe *= f;
    }
    if (given.warp) { warpNe = given.warp.resultant_ne; notes.push('Warp count as entered; the weft was solved from the GSM at the standard warp-to-weft ratio.'); }
    if (given.weft) { weftNe = given.weft.resultant_ne; notes.push('Weft count as entered; the warp was solved from the GSM at the standard warp-to-weft ratio.'); }
    countSource = 'CALCULATED';
    basis = 'solved from the GSM entered: GSM = (ends x (1 + warp crimp) x warp tex + picks x (1 + weft crimp) x weft tex) / 1000 per metre, at the standard quality\'s warp / weft count ratio (' + r2(ratio) + ').';
  } else {
    const kw = fabric.sett.epi / Math.sqrt(book.warp.resultant_ne), kf = fabric.sett.ppi / Math.sqrt(book.weft.resultant_ne);
    warpNe = given.warp ? given.warp.resultant_ne : Math.pow(epi / kw, 2);
    weftNe = given.weft ? given.weft.resultant_ne : Math.pow(ppi / kf, 2);
    countSource = 'ESTIMATED';
    basis = 'no GSM or count given, so each count is the one that gives this sett the standard quality\'s cover factor (warp K = ' + r1(kw) + ', weft K = ' + r1(kf) + ', K = threads per inch / sqrt(Ne)). Enter the GSM or the counts to replace this estimate.';
    notes.push('The yarn counts are estimated, not measured: a photo shows how many threads there are, not how heavy they are. Enter the GSM (weigh a 10 x 10 cm piece) and the counts are solved instead.');
  }
  if (countSource === 'ESTIMATED' && (warpNe < 3 || weftNe < 3 || warpNe > 150 || weftNe > 150)) {
    notes.push('These threads come out ' + (Math.min(warpNe, weftNe) < 3 ? 'far coarser' : 'far finer') + ' than woven cloth is made from (' + r1(warpNe) + 's warp, ' + r1(weftNe) + 's weft): the ends and picks per cm are probably off by the photo’s distance. Use the scan card, or set how far the phone was, and work it out again.');
  }
  warpNe = Math.min(200, Math.max(1, warpNe)); weftNe = Math.min(200, Math.max(1, weftNe));

  const calc = calculateWoven({ fabric_id: q.id, epi: r1(epi), ppi: r1(ppi), warp_count: r1(warpNe) + 's', weft_count: r1(weftNe) + 's', composition: input.composition || undefined });
  if (calc.success === false) throw new WovenReverseError(calc.message || 'The woven construction could not be calculated.');

  if (input.confidence === 'low') notes.push('The weave was read with low confidence — check the diagram against the cloth under a pick glass.');
  if (weave.cls === 'threads') notes.push('The threads were counted but the weave pattern was not resolved; plain weave was assumed for the arithmetic.');
  if (weave.cls === 'twill' && weave.hand) notes.push('Twill direction read from the photo: ' + (weave.hand === 'RH' ? 'right-hand (Z) — the lines rise to the right on the face' : 'left-hand (S) — the lines rise to the left on the face') + '. Seen from the back, a twill runs the other way.');

  return {
    family: 'woven',
    structure: q.id,
    label: fabric.name,
    quality: { id: q.id, name: fabric.name, family: fabric.family, why: q.why },
    weave: {
      read: weave.name || null, cls: weave.cls || null, notation: weave.notation || null, hand: weave.hand || null,
      face: weave.face || null, angle_deg: weave.angle_deg != null ? weave.angle_deg : null, matrix: Array.isArray(input.matrix) ? input.matrix : null,
    },
    measured: { ends_per_cm: r2(epc), picks_per_cm: r2(ppc), epi: r1(epi), ppi: r1(ppi), source: 'MEASURED' },
    counts: {
      warp: { ne: r1(warpNe), nearest: nearestCount(warpNe), tex: r1(590.5 / warpNe), source: given.warp ? 'SUPPLIED' : countSource },
      weft: { ne: r1(weftNe), nearest: nearestCount(weftNe), tex: r1(590.5 / weftNe), source: given.weft ? 'SUPPLIED' : countSource },
      basis,
    },
    gsm: calc.weight ? { value: Math.round(calc.weight.gsm), oz_per_sq_yd: calc.weight.oz_per_sq_yd, warp_share_pct: calc.weight.warp_share_pct, source: input.gsm > 0 ? 'SUPPLIED' : 'CALCULATED', target: input.gsm > 0 ? Number(input.gsm) : null } : null,
    crimp: calc.weight ? { warp_pct: calc.weight.warp_crimp_pct, weft_pct: calc.weight.weft_crimp_pct, source: calc.weight.warp_crimp_source, basis: calc.weight.crimp_basis } : null,
    cover: calc.cover || null,
    twill_angle: calc.twill_angle || null,
    structure_design: calc.structure && calc.structure.available ? { notation: calc.structure.notation, repeat_ends: calc.structure.repeat_ends, repeat_picks: calc.structure.repeat_picks, grid: calc.structure.grid } : null,
    fibre_advisory: calc.fibre_advisory || null,
    notes: notes.concat(calc.notes || []),
    full_params: { fabric_id: q.id, epi: r1(epi), ppi: r1(ppi), warp_count: r1(warpNe) + 's', weft_count: r1(weftNe) + 's', composition: input.composition || undefined },
  };
}

module.exports = { reverse, pickQuality, WovenReverseError };
