/**
 * Process dimensions — what the wet route does to the SIZE of the cloth.
 *
 * The Studio's finished state is the one the factory records measure: it already carries the usual route (scour, dye, soap, soften; a heat-set for
 * elastane and polyester). So this module does not re-derive the usual shrinkage: it returns the CHANGE a route makes by departing from the usual one,
 * as points of length and width shrinkage after a home wash, and a note for each:
 *
 *   no heat-set on an elastane cloth        the elastane is not set: the cloth relaxes more in the wash          (+ length, + width)
 *   heat-set hot on polyester / nylon       the thermoplastic fibre is set: dimensions stabilise                  (− shrinkage)
 *   cold or short heat-set                  set only in part                                                      (+ a little)
 *   wool in an alkaline or hot, agitated bath  the scales mesh: felting shrinkage on top of relaxation            (+ area)
 *   viscose / modal                         higher wet extension: more width shrinkage than cotton                (+ width)
 *   a dark shade                            the longer, hotter dye and soaping sequence works the cloth more      (+ a little)
 *   a resin (anti-crease) finish            cross-links the cellulose: residual shrinkage falls                  (− 25 %)
 *
 * Basis: ESTIMATE. The directions are textile practice; the sizes are typical orders of magnitude, not fitted to this mill. A before / after reading of
 * one lot (the Studio's trial-roll step, finished state) replaces them. They are NOT applied to the Studio's weight and width, which are measured.
 */
'use strict';

const r1 = (x) => Math.round(x * 10) / 10;
const share = (mix, ids) => ids.reduce((t, k) => t + (+(mix || {})[k] || 0), 0);

/**
 * analyse({ fibres: {cotton: 60, polyester: 40, elastane: 5}, steps: [{id, t_c}], shade, finishes: [...], base: {length_pct, width_pct} })
 * base: the Studio's after-wash shrinkage (negative = shrinks) of the usual route, to scale a percentage change on.
 */
function analyse(p) {
  const mix = p.fibres || {}, steps = Array.isArray(p.steps) ? p.steps : [];
  const tot = Object.values(mix).reduce((t, v) => t + (+v || 0), 0) || 100;
  const pct = (ids) => (share(mix, ids) / tot) * 100;
  const elastane = pct(['elastane']), thermo = pct(['polyester', 'nylon']), wool = pct(['wool']), regen = pct(['viscose', 'modal', 'tencel', 'bamboo']);
  const hs = steps.find((s) => s.id === 'heatset' || /heat/i.test(s.label || ''));
  const hsT = hs && +hs.t_c > 0 ? +hs.t_c : 0;
  const alkaline = steps.some((s) => (+s.ph >= 10 && /scour|boil|alkali/i.test((s.id || '') + (s.label || ''))) || /caustic/i.test(JSON.stringify(s.chemicals || [])));
  const hotDye = steps.some((s) => /dye/i.test(s.id || '') && +s.t_c >= 100);
  const base = p.base || { length_pct: 0, width_pct: 0 };
  let dl = 0, dw = 0; const notes = [];
  const add = (l, w, text) => { dl += l; dw += w; notes.push({ length_pts: r1(l), width_pts: r1(w), text }); };

  if (elastane >= 1 && hsT < 170) add(1.2 + 0.1 * elastane, 1.8 + 0.15 * elastane, hsT ? `Heat-set at ${hsT} °C is below the 170–190 °C an elastane cloth is set at: the elastane is only partly set and the cloth relaxes further in the wash.` : 'No heat-set on an elastane cloth: the elastane is not set, so it relaxes in the first wash and the cloth shrinks more and loses width.');
  if (thermo >= 30 && hsT >= 180) add(-0.01 * thermo * Math.abs(base.length_pct || 3), -0.01 * thermo * Math.abs(base.width_pct || 4), `Heat-set at ${hsT} °C on ${Math.round(thermo)} % polyester / nylon: the thermoplastic fibre is set and the dimensions stabilise.`);
  else if (thermo >= 30 && hsT === 0 && !hotDye) add(0.8, 1.0, `${Math.round(thermo)} % polyester / nylon with no heat-set: the synthetic part is not set and can relax in the wash.`);
  if (wool >= 20 && (alkaline || hotDye)) add(0.07 * wool, 0.07 * wool, `${Math.round(wool)} % wool in ${alkaline ? 'an alkaline' : 'a hot'}, agitated bath: the scales mesh and the cloth felts, on top of the usual relaxation. Wool is scoured near neutral and cool, or made shrink-resist.`);
  if (regen >= 20) add(0.3 + 0.02 * regen, 0.8 + 0.06 * regen, `${Math.round(regen)} % viscose / modal: the fibre swells and extends more when wet than cotton does, so width shrinkage is higher.`);
  if (p.shade === 'dark') add(0.4, 0.5, 'A dark shade: the longer, hotter dyeing and the extra soaping and rinsing work the cloth more before it is finished.');
  const fin = Array.isArray(p.finishes) ? p.finishes : [];
  if (fin.includes('anti_crease') || p.resin) { const l = -0.25 * (Math.abs(base.length_pct) + dl), w = -0.25 * (Math.abs(base.width_pct) + dw); add(l, w, 'A resin (anti-crease) finish cross-links the cellulose: the residual shrinkage falls by about a quarter.'); }

  // shrinkage is negative: more shrinkage = more negative
  const length_pct = r1(base.length_pct - dl), width_pct = r1(base.width_pct - dw);
  const area = (1 + length_pct / 100) * (1 + width_pct / 100) - (1 + base.length_pct / 100) * (1 + base.width_pct / 100);
  return {
    changes: notes, delta_length_pts: r1(dl), delta_width_pts: r1(dw), after_wash: { length_pct, width_pct, base },
    gsm_change_pct: r1((1 / (1 + area) - 1) * 100),
    basis: 'estimate: the directions are textile practice; the sizes are typical, not fitted to this mill. The Studio\'s measured weight and width are not changed by them: a trial roll of the finished state replaces them.',
  };
}

module.exports = { analyse };
