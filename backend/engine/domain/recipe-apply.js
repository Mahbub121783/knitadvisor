// The recipe book asked on behalf of an engine: a catalogue fabric, a composition and a weight → the settings the mill's
// own work orders knit, in the units the engines use.
'use strict';

const RB = require('./recipe-book');

// catalogue fabric → the cloth of the work orders
const CLOTH = {
  single_jersey: 'single_jersey', heavy_jersey: 'heavy_jersey', plated_jersey: 'plated_jersey',
  fleece_3_thread: 'fleece_brushed', fleece_diagonal: 'fleece_diagonal', french_terry: 'fleece_loopback', fleece_2_thread: 'terry_2t',
  rib_1x1: 'rib_1x1', lycra_rib_1x1: 'rib_1x1', rib_2x2: 'rib_2x2', lycra_rib_2x2: 'rib_2x2',
  rib_2x1: 'rib_2x1', rib_3x2: 'rib_3x2', rib_3x3: 'rib_3x3', rib_4x1: 'rib_4x1', rib_4x2: 'rib_4x2', rib_4x3: 'rib_4x3', rib_5x3: 'rib_5x3',
  interlock: 'interlock', ponte_di_roma: 'ponte_di_roma', pique_single: 'pique', lacoste_single: 'lacoste_single', waffle_knit: 'waffle_tuck',
};
const NEEDS_ELASTANE = new Set(['lycra_rib_1x1', 'lycra_rib_2x2']);
// the sheet writes the stitch length of an interlock and a ponte over both beds' needles: half the loop the engines count
const halfBasis = (cloth, sl) => (/interlock|ponte/.test(cloth) && sl.length && sl[0] < 2 ? 2 : 1);

const clothOf = (fabricId) => CLOTH[fabricId] || null;

/**
 * @param q { fabricId, gsm, fibres: { cotton: 80, polyester: 20 } (elastane apart), elastane (bool), brushed (bool, fleece),
 *            half (bool), style: 'combed'|'carded'|'melange'|'rotor', colour, yd, stripe, slub, book }
 * @returns the recipe, or null where the work orders say nothing near enough
 */
function recipeFor(q) {
  let cloth = clothOf(q.fabricId);
  if (!cloth || !(+q.gsm > 0)) return null;
  if (cloth === 'fleece_brushed' && q.brushed === false) cloth = 'fleece_loopback';
  if (cloth === 'fleece_loopback' && q.brushed === true) cloth = 'fleece_brushed';
  const book = q.book || RB.book();
  if (!book.size) return null;
  const mix = q.fibres && Object.keys(q.fibres).length ? { ...q.fibres } : { cotton: 100 };
  delete mix.elastane;
  const el = NEEDS_ELASTANE.has(q.fabricId) || !!q.elastane;
  const ask = { cloth, el, half: !!q.half, gsm: +q.gsm, mix, style: q.style || 'combed', colour: q.colour, yd: !!q.yd, stripe: !!q.stripe, slub: !!q.slub };
  const r = book.lookup(ask);
  if (!r || !r.yarns.face) return null;
  const distance = RB.compDistance(mix, r.composition);
  if (distance > 5) return null;                          // orders more than a label's tolerance off the composition asked are a different cloth
  const factor = halfBasis(cloth, r.sl);
  const y = r.yarns, count = (x) => (!x ? null : x.fil ? { denier: x.d, filaments: x.f, material: x.mat } : { ne: x.ne, ply: x.ply || 1, mix: x.mix, style: x.style });
  return {
    cloth, known: r.known, orders: r.orders, orders_seen: r.orders_seen, agreement_pct: r.agreement_pct, gsm_used: r.gsm_used,
    face: count(y.face), binder: count(y.binder), loop: count(y.loop), second: count(y.second),
    sl: r.sl, sl_loop_mm: r.sl.map((v) => Math.round(v * factor * 100) / 100), sl_basis: factor === 2 ? 'the sheet counts both beds\' needles (half the loop)' : 'per needle',
    gauge: r.gauge, dia: r.dia, elastane_denier: r.elastane_denier, half: r.half,
    composition: r.composition, composition_off_pts: Math.round(distance * 10) / 10, alternatives: r.alternatives,
    note: r.known
      ? `${r.orders_seen} factory R&D work order${r.orders_seen === 1 ? '' : 's'} knit this cloth at ${r.gsm} GSM, ${r.agreement_pct} % of them with these yarns.`
      : `No work order at ${r.gsm} GSM: carried from orders at ${r.gsm_used.slice(0, 4).join(', ')} GSM.`,
  };
}

module.exports = { recipeFor, clothOf, CLOTH, halfBasis };
