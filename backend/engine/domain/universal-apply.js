// The universal loop model asked on behalf of an engine: a needle diagram (any weft construction), a composition and a
// weight → counts, stitch lengths, gauge and elastane, in the same shape as a work-order recipe.
'use strict';

const U = require('./universal-model');
const RAP = require('./recipe-apply');

const LOOP_BLENDS = [0, 20, 35, 40, 50, 65, 100];
const STAPLE_COUNTS = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 44, 50, 60];
const elastaneDenier = (gsm) => (gsm < 165 ? 20 : gsm < 225 ? 30 : gsm < 340 ? 40 : 70);
const r2 = (v) => Math.round(v * 100) / 100;
const SYNTH = ['polyester', 'nylon', 'acrylic', 'polypropylene'];
const BINDERS = [75, 100, 150, 200];

/**
 * @param q { C, D, roles, gating, gsm, fibres: { cotton: 60, ... } (elastane apart), elastane, half, style, brushed, yd, plated, ends, gauge, fabricId }
 * @returns a recipe-shaped design, or null where the model should not answer
 */
function modelFor(q) {
  const M = U.model();
  if (!M.ok || process.env.KA_NO_MODEL) return null;
  const gsm = +q.gsm;
  if (!(gsm >= 90 && gsm <= 520) || !q.C) return null;
  const cells = [q.C, q.D].filter(Boolean).flatMap((g) => g.map((r) => (Array.isArray(r) ? r.join('') : String(r))));
  // loop transfer is not in the records the constants come from
  if (cells.some((r) => /[ER]/.test(r))) return null;
  const cloth = q.fabricId ? RAP.clothOf(q.fabricId) : null;
  // where the engines judged better than the model on knitted orders (tools/universal-fit.js), they keep the answer
  if (cloth && (M.spec.engine_better || []).includes(cloth)) return null;
  // a weight well outside what this cloth was ever knitted at is left to the engines, which say when it cannot be reached
  const seen = cloth ? M.own(cloth, !!q.elastane) : null;
  if (seen && seen.gsm && (gsm < seen.gsm[0] * 0.9 || gsm > seen.gsm[1] * 1.1)) return null;
  const d = U.diagram({ C: q.C, D: q.D, roles: q.roles, gating: q.D ? (q.gating === 'interlock' ? 'interlock' : 'rib') : 'single' });
  if (!d.faceFeeds.length) return null;
  // beyond what it was taught (floats on one bed, stacks of held loops, more needles out) the Studio's own laws answer
  const dom = M.spec.domain || {};
  if (Object.keys(dom).some((k) => d[k] > dom[k] + (k === 'held' ? 0 : 0.08))) return null;
  const mix = q.fibres && Object.keys(q.fibres).length ? { ...q.fibres } : { cotton: 100 };
  delete mix.elastane;
  const tot = Object.values(mix).reduce((t, v) => t + v, 0) || 100;
  Object.keys(mix).forEach((k) => { mix[k] = (mix[k] * 100) / tot; });
  const poly = mix.polyester || 0;
  const binderFilament = !!(d.binder && poly >= 8);
  const style = q.style || 'combed';
  const m = { mix, elastane: !!q.elastane, half: !!q.half, style, brushed: !!q.brushed, binderFilament, yd: !!q.yd, plated: !!q.plated, ends: q.ends || (q.plated ? 2 : 1) };
  const faceFeed = d.faceFeeds[0], loopFeed = d.feeds.findIndex((f) => f.role === 'loop'), binderFeed = d.feeds.findIndex((f) => f.role === 'binder');
  // the sheet's convention: a stitch length per needle of both beds; the engines count the loop itself on interlock gating
  const factor = d.interlock ? 2 : 1;
  // the blend of each yarn: one blend everywhere; with a laid-in loop and a filament binder, the face stays cellulosic and the
  // loop carries the rest of the synthetic. The finest filament that holds the composition inside the label tolerance is taken
  let pick = null;
  for (const binderDenier of binderFilament ? BINDERS : [null]) {
    const o = M.design(d, { ...m, binderDenier }, gsm, { cloth, gauge: +q.gauge > 0 ? +q.gauge : null, counts: STAPLE_COUNTS, faceNe: +q.count > 0 ? +q.count : null });
    if (!o || !o.sl_per_feed.every((v) => v > 0.4 && v < 12)) continue;
    let faceMix = mix, loopMix = mix, miss = 0;
    if (d.inlay && binderFilament) {
      const cell = Object.fromEntries(Object.entries(mix).filter(([k]) => !SYNTH.includes(k)));
      const base = Object.keys(cell).length ? Object.keys(cell).sort((a, b) => cell[b] - cell[a])[0] : 'cotton';
      const mass = (i, tex) => o.sl_per_feed[i] * tex * (d.feeds[i].n / d.W);
      let mf = 0, ml = 0, mb = 0;
      d.feeds.forEach((f, i) => {
        if (f.role === 'loop') ml += mass(i, 590.5 / o.loop_ne);
        else if (f.role === 'binder') mb += mass(i, binderDenier / 9);
        else mf += mass(i, o.face_tex);
      });
      const want = ((poly / 100) * (mf + ml + mb) - mb) / (ml || 1);
      const p = LOOP_BLENDS.reduce((b, x) => (Math.abs(x - want * 100) < Math.abs(b - want * 100) ? x : b), 0);
      faceMix = { [base]: 100 };
      loopMix = p === 0 ? { [base]: 100 } : p === 100 ? { polyester: 100 } : { [base]: 100 - p, polyester: p };
      miss = Math.abs((100 * (mb + (ml * p) / 100)) / (mf + ml + mb || 1) - poly);
    }
    if (!pick || miss < pick.miss) pick = { o, faceMix, loopMix, miss };
    if (miss <= 3) break;
  }
  if (!pick) return null;
  const { o, faceMix, loopMix } = pick;
  const slSheet = o.sl_per_feed;
  const sl = d.inlay ? [slSheet[faceFeed], ...(binderFeed >= 0 ? [slSheet[binderFeed]] : []), slSheet[loopFeed]] : [...new Set(slSheet)];
  const judged = (M.spec.judged || {})[cloth && (M.spec.residuals || []).some((r) => r.cloth === cloth) ? 'new_weight_or_composition' : 'never_knitted_construction'] || {};
  const known = !!(cloth && (M.spec.residuals || []).some((r) => r.cloth === cloth));
  return {
    model: true, cloth, known: false, known_construction: known,
    face: { ne: o.face_ne, ply: m.ends > 1 && !q.plated ? m.ends : 1, mix: faceMix, style },
    binder: d.binder ? (o.binder && o.binder.denier ? { denier: o.binder.denier, filaments: o.binder.denier >= 150 ? 144 : 72, material: 'polyester' } : { ne: o.face_ne, ply: 1, mix: faceMix, style }) : null,
    loop: d.inlay && o.loop_ne ? { ne: o.loop_ne, ply: 1, mix: loopMix, style: 'carded' } : null,
    sl: sl.map(r2), sl_loop_mm: sl.map((v) => r2(v * factor)), sl_per_feed_engine: slSheet.map((v) => r2(v * factor)), face_feed: faceFeed,
    sl_basis: factor === 2 ? 'counted over both beds\' needles (half the loop)' : 'per needle',
    // inside the tightness and on a gauge that knitted orders of this cloth ran
    proven: !!(seen && seen.tfq && o.tightness >= seen.tfq[0] && o.tightness <= seen.tfq[1] && (seen.gset || []).includes(o.gauge)),
    gauge: o.gauge, dia: null, elastane_denier: q.elastane ? elastaneDenier(gsm) : null, half: !!q.half, composition: null, tightness: o.tightness,
    typical_error: { sl_pct: judged.sl_err_med, gsm_pct: judged.gsm_err_med },
    note: `Universal loop model: designed from the needle diagram${known ? ' of a construction the model knows' : ' (a construction it has not been taught: the closest cloths guide it)'}. Typical difference from knitted orders${judged.sl_err_med != null ? `: stitch length about ${judged.sl_err_med} %` : ''}; confirm with a trial roll.`,
  };
}

module.exports = { modelFor, elastaneDenier, COUNTS: STAPLE_COUNTS };
