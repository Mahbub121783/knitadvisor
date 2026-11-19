/**
 * KnitAdvisor — Burnout lab: which fibre of a cloth each chemical dissolves, and what is left.
 *
 * The standard way to find out what a blend really is, and the way a devoré (burnout) cloth is made: a reagent that dissolves one fibre and leaves
 * the others. Give the fibres of the cloth (and the yarn each feed lays) and this says, for each reagent:
 *
 *   what dissolves     the fibres the reagent takes (all of them), attacks (some of their weight) or leaves
 *   what is left       the weight left as a share of the cloth, the residue's composition, the weight in g/m²
 *   each feed          how much of every yarn is gone; a feed whose fibres all dissolve vanishes from the cloth
 *   the cloth          whether what is left still holds together (a knitted cloth needs a feed that knits; tucks and floats alone fall apart)
 *
 * Reagents and who they dissolve are the usual fibre-analysis and devoré practice: 75 % sulphuric acid (cellulosics, silk, nylon),
 * 80 % formic acid (nylon), 5 % hot caustic soda (wool, silk; polyester loses weight), alkaline hypochlorite (wool, silk), hot DMF (elastane, acrylic),
 * hot xylene (polypropylene). The weight a "partial" attack takes is typical. Basis: law for the arithmetic of what is left, typical for the
 * solubility table. A real burnout test on a swatch of the lot replaces it. No outside source is named.
 */
'use strict';

const r1 = (x) => Math.round(x * 10) / 10;

// 1 = dissolves, a fraction = attacked (that share of its weight is lost), 0 = left
const REAGENTS = [
  { id: 'h2so4', label: '75 % sulphuric acid', conditions: '50 °C, 30–60 min, then rinse and neutralise', use: 'Quantifies cotton, viscose, modal, linen or silk against polyester, acrylic, wool or elastane; makes a devoré on a cellulose / polyester yarn.',
    hazard: 'Strong acid: fume cupboard, acid-resistant gloves and apron; add the acid to water, never the reverse.',
    acts: { cotton: 1, linen: 1, viscose: 1, modal: 1, tencel: 1, bamboo: 1, silk: 1, nylon: 1, cdp: 0.02, polyester: 0, acrylic: 0, wool: 0, polypropylene: 0, elastane: 0 } },
  { id: 'formic', label: '80 % formic acid', conditions: '20 °C, 15 min, shake; rinse', use: 'Takes nylon (polyamide) out of a blend; leaves cotton, polyester, wool, elastane and acrylic.',
    hazard: 'Corrosive vapour: fume cupboard.',
    acts: { nylon: 1, silk: 0.25, cotton: 0, linen: 0, viscose: 0.05, modal: 0, tencel: 0, bamboo: 0.05, polyester: 0, cdp: 0, acrylic: 0, wool: 0, polypropylene: 0, elastane: 0 } },
  { id: 'naoh', label: '5 % caustic soda, boiling', conditions: '100 °C, 10 min; rinse and neutralise', use: 'Dissolves wool and silk out of a blend with cotton, nylon or acrylic; polyester loses some weight (the weight loss is real, not an error).',
    hazard: 'Hot caustic: eye protection and gloves; never heat in a closed vessel.',
    acts: { wool: 1, silk: 1, polyester: 0.08, cdp: 0.1, cotton: 0, linen: 0, viscose: 0.03, modal: 0.02, tencel: 0.02, bamboo: 0.03, nylon: 0, acrylic: 0.03, polypropylene: 0, elastane: 0.02 } },
  { id: 'hypochlorite', label: 'alkaline sodium hypochlorite', conditions: '20 °C, 40 min, shaken; rinse', use: 'Dissolves wool and silk; used for wool / polyester and wool / cotton analysis.',
    hazard: 'Releases chlorine on contact with acid: keep apart from the acids.',
    acts: { wool: 1, silk: 1, elastane: 0.15, nylon: 0.05, cotton: 0.01, polyester: 0, acrylic: 0, linen: 0.01, viscose: 0.02, modal: 0.01, tencel: 0.01, bamboo: 0.02, cdp: 0, polypropylene: 0 } },
  { id: 'dmf', label: 'dimethylformamide (DMF)', conditions: '90–95 °C, 10 min; rinse', use: 'Dissolves elastane (and acrylic): the elastane content of a stretch cloth.',
    hazard: 'Toxic solvent: fume cupboard and gloves; dispose as solvent waste.',
    acts: { elastane: 1, acrylic: 1, cotton: 0, linen: 0, viscose: 0, modal: 0, tencel: 0, bamboo: 0, polyester: 0, cdp: 0, nylon: 0.02, wool: 0, silk: 0, polypropylene: 0 } },
  { id: 'xylene', label: 'xylene, hot', conditions: '~140 °C, 3 min; rinse', use: 'Dissolves polypropylene.',
    hazard: 'Flammable, toxic vapour: fume cupboard, no flame.',
    acts: { polypropylene: 1, elastane: 0.05, cotton: 0, linen: 0, viscose: 0, modal: 0, tencel: 0, bamboo: 0, polyester: 0, cdp: 0, nylon: 0, acrylic: 0, wool: 0, silk: 0 } },
];
const LABEL = { cotton: 'cotton', linen: 'linen', viscose: 'viscose', modal: 'modal', tencel: 'lyocell', bamboo: 'bamboo viscose', polyester: 'polyester', cdp: 'cationic polyester', nylon: 'nylon', acrylic: 'acrylic', wool: 'wool', silk: 'silk', elastane: 'elastane', polypropylene: 'polypropylene' };

/**
 * analyse({ fibres: {cotton: 60, polyester: 40}, feeds: [{ feed, role, mix, mass_share_pct, knits }], gsm })
 */
function analyse(input) {
  const p = input && typeof input === 'object' ? input : {};
  const fibres = p.fibres && typeof p.fibres === 'object' ? Object.entries(p.fibres).filter(([, v]) => +v > 0).map(([k, v]) => [k, +v]) : [];
  if (!fibres.length) throw new Error('Give the fibres of the cloth, for example cotton 60 and polyester 40.');
  const tot = fibres.reduce((t, [, v]) => t + v, 0);
  const share = Object.fromEntries(fibres.map(([k, v]) => [k, v / tot]));
  const gsm = +p.gsm > 0 ? +p.gsm : null;
  const feeds = Array.isArray(p.feeds) ? p.feeds : [];
  const rows = REAGENTS.map((rg) => {
    const f = (k) => (Object.prototype.hasOwnProperty.call(rg.acts, k) ? rg.acts[k] : 0);
    const lost = fibres.reduce((t, [k]) => t + share[k] * f(k), 0);
    const left = 1 - lost;
    const dissolved = fibres.filter(([k]) => f(k) >= 0.9).map(([k]) => LABEL[k] || k);
    const attacked = fibres.filter(([k]) => f(k) > 0.01 && f(k) < 0.9).map(([k]) => `${LABEL[k] || k} (loses ${r1(f(k) * 100)} % of its weight)`);
    const untouched = fibres.filter(([k]) => f(k) <= 0.01).map(([k]) => LABEL[k] || k);
    const residue = fibres.map(([k]) => [k, share[k] * (1 - f(k))]).filter(([, v]) => v > 0.0005);
    const rt = residue.reduce((t, [, v]) => t + v, 0);
    // each feed: how much of its yarn is gone
    const perFeed = feeds.map((fd) => {
      const mix = fd.mix && typeof fd.mix === 'object' ? fd.mix : null;
      if (!mix) return null;
      const mt = Object.values(mix).reduce((t, v) => t + (+v || 0), 0) || 100;
      const gone = Object.entries(mix).reduce((t, [k, v]) => t + ((+v || 0) / mt) * f(k), 0);
      return { feed: fd.feed, role: fd.role, yarn_gone_pct: r1(gone * 100), vanishes: gone >= 0.97, knits: !!fd.knits, mass_share_pct: +fd.mass_share_pct || null };
    }).filter(Boolean);
    const stays = perFeed.filter((x) => !x.vanishes);
    const holds = perFeed.length ? stays.some((x) => x.knits) : null;
    const word = left >= 0.995 ? 'nothing dissolves: the reagent does not touch this cloth' : left <= 0.03 ? 'everything dissolves' : holds === false ? 'what is left cannot hold together: no feed that knits remains' : `${dissolved.length ? dissolved.join(' and ') + ' dissolve' + (dissolved.length === 1 ? 's' : '') : attacked.length ? 'a partial attack only' : 'nothing dissolves'}`;
    return {
      id: rg.id, label: rg.label, conditions: rg.conditions, use: rg.use, hazard: rg.hazard,
      dissolves: dissolved, attacks: attacked, leaves: untouched,
      weight_left_pct: r1(left * 100), weight_lost_pct: r1(lost * 100),
      gsm_after: gsm ? Math.round(gsm * left) : null,
      residue: Object.fromEntries(residue.map(([k, v]) => [k, r1((v / rt) * 100)])),
      feeds: perFeed, holds_together: holds,
      useful: dissolved.length > 0 && left > 0.03,
      word,
    };
  });
  const best = rows.filter((r) => r.useful).sort((a, b) => b.weight_lost_pct - a.weight_lost_pct);
  return {
    success: true,
    fibres: Object.fromEntries(fibres.map(([k]) => [k, r1(share[k] * 100)])),
    reagents: rows,
    suggested: best.length ? best[0].id : null,
    note: 'Which reagent separates which fibre of this cloth. Cotton and polyester: sulphuric acid. Wool or silk beside cotton or polyester: caustic soda or hypochlorite. Nylon: formic acid. Elastane: DMF.',
    basis: { law: ['the weight left after dissolving the fibres a reagent takes', 'a feed vanishes when all its fibres dissolve'], typical: ['which fibre each reagent takes', 'the weight a partial attack removes'], replaced_by: 'a burnout test on a swatch of the lot' },
  };
}

function catalogue() { return { reagents: REAGENTS.map((r) => ({ id: r.id, label: r.label, conditions: r.conditions })) }; }

module.exports = { analyse, catalogue, REAGENTS };
