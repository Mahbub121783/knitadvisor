/**
 * KnitAdvisor — Process effects: what each wet-process chemical does to the cloth.
 *
 * The wet route of the cloth (yarn-chemistry-engine.js, every fibre of every yarn together) names the chemicals of every bath. Each of
 * the 27 chemicals of a knit dyehouse moves a few numbers of the finished cloth: its weight, how stiffly it bends, how it rubs, how
 * hairy it is, the colour it ends at (ΔL*, Δb*), and the wet-rubbing grade. This module reads the route, finds the chemicals, and adds
 * their effects up:
 *
 *   weight        additive, % of the cloth weight (the factory records already include the usual route; this is the change a
 *                 DIFFERENT chemical makes, shown for information — the Studio's weight is not changed by it)
 *   bending       multiplicative on the cloth's bending rigidity
 *   friction      multiplicative on the surface friction (MIU)
 *   hairiness     multiplicative on the surface hairs
 *   Δb*, ΔL*      additive colour shift of the finished cloth (a white's yellowing, a bleach's whitening, a brightener's glow)
 *   wet rubbing   additive, grades (the fastness)
 *
 * The softeners (21–23) are the Fabric hand engine's own finishes (softener / silicone), so their bending and friction are taken from
 * there and not counted twice: this module returns the bending and friction of every OTHER chemical for the hand engine to apply.
 *
 * Basis: estimate. These are typical effects of each chemical class at the usual dose, carried from dyehouse practice; none is fitted
 * to this mill's own cloth. A mill's before/after reading on one lot (weight, bending, rubbing) replaces each with a measurement.
 * No outside source is named in what this returns.
 */
'use strict';

const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;

// id, stage, name, what it is for, then its effect: gsm (%), bend ×, fric ×, hair ×, db (Δb*), dL (ΔL*), wet (rub grades), and a note
const CHEM = [
  { id: 1,  stage: 'Pretreat',  name: 'Detergent / wetting agent',      match: /detergent|wetting/i,                  gsm: 0,      bend: 1,    fric: 1,    hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'wets the cloth evenly: the baseline' },
  { id: 2,  stage: 'Pretreat',  name: 'Sequestering agent',             match: /sequester/i,                          gsm: 0,      bend: 1,    fric: 1,    hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'holds hardness and metals: no patchy shade' },
  { id: 3,  stage: 'Pretreat',  name: 'Hydrogen peroxide',              match: /hydrogen peroxide|peroxide \(/i,      gsm: -0.02,  bend: 1,    fric: 1,    hair: 1, db: -3.5, dL: 0.5, wet: 0,   note: 'bleaches the natural colour: b* falls (whiter)' },
  { id: 4,  stage: 'Pretreat',  name: 'Peroxide stabiliser',            match: /stabili[sz]er/i,                      gsm: 0,      bend: 1,    fric: 1,    hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'keeps the peroxide gentle on the cellulose' },
  { id: 5,  stage: 'Pretreat',  name: 'Caustic soda',                   match: /caustic soda/i,                       gsm: -0.03,  bend: 0.98, fric: 1.02, hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'scours wax and pectin; swells the cotton (yarn about 4 % thicker)' },
  { id: 6,  stage: 'Pretreat',  name: 'Peroxide killer',                match: /peroxide killer|catalase/i,           gsm: 0,      bend: 1,    fric: 1,    hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'removes residual peroxide: no dye spots' },
  { id: 7,  stage: 'Pretreat',  name: 'Acetic acid',                    match: /acetic acid|formic acid/i,            gsm: 0,      bend: 1,    fric: 1,    hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'sets the pH for the enzyme and the disperse dye' },
  { id: 8,  stage: 'Dyeing',    name: 'Soda ash',                       match: /soda ash/i,                           gsm: 0,      bend: 1,    fric: 1,    hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'alkali that fixes the reactive dye' },
  { id: 9,  stage: 'Dyeing',    name: 'Salt (Glauber\'s or common)',    match: /salt/i,                               gsm: 0,      bend: 1,    fric: 1,    hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'drives the dye onto the fibre' },
  { id: 10, stage: 'Dyeing',    name: 'Levelling / dispersing agent',   match: /levelling|leveling|dispersing/i,      gsm: 0,      bend: 1,    fric: 1,    hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'even uptake: no patchy or streaky dyeing' },
  { id: 11, stage: 'Dyeing',    name: 'Multifunctional levelling agent', match: /multifunctional/i,                   gsm: 0,      bend: 0.98, fric: 0.95, hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'bath lubrication in a dark shade' },
  { id: 12, stage: 'Dyeing',    name: 'Anti-creasing agent',            match: /anti-?creas/i,                        gsm: 0,      bend: 1,    fric: 0.9,  hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'lubricates the rope: no permanent creases' },
  { id: 13, stage: 'Dyeing',    name: 'Anti-foaming agent',             match: /anti-?foam/i,                         gsm: 0,      bend: 1,    fric: 1,    hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'no foam spots in a high-temperature jet' },
  { id: 14, stage: 'Dyeing',    name: 'Reducing agent (hydrosulphite)', match: /hydrosulphite|thiourea|reducing agent/i, gsm: 0,   bend: 1,    fric: 1,    hair: 1, db: 0,    dL: 0,   wet: 0.5, note: 'clears surplus disperse dye off the cotton: cleaner wash and rub fastness' },
  { id: 15, stage: 'Dyeing',    name: 'Acid buffer',                    match: /acid buffer|sodium acetate|ammonium sulphate/i, gsm: 0, bend: 1, fric: 1, hair: 1, db: 0,   dL: 0,   wet: 0,   note: 'holds the pH of a 130 °C disperse bath' },
  { id: 16, stage: 'Dyeing',    name: 'Optical brightener (OBA)',       match: /brightener/i,                         gsm: 0,      bend: 1,    fric: 1,    hair: 1, db: -6.0, dL: 2.5, wet: 0,   note: 'absorbs UV, glows blue-white: b* falls, L* rises (strongest under UV)' },
  { id: 17, stage: 'After',     name: 'Soaping agent',                  match: /soaping/i,                            gsm: 0,      bend: 1,    fric: 1,    hair: 1, db: 0,    dL: 0,   wet: 0.5, note: 'strips unfixed dye: better wash and rub fastness' },
  { id: 18, stage: 'After',     name: 'Fixing agent',                   match: /fixing agent/i,                       gsm: 0,      bend: 1.02, fric: 1,    hair: 1, db: 0,    dL: -0.2, wet: 0.5, note: 'locks the dye: shade shift ≤ 0.3 ΔE' },
  { id: 19, stage: 'After',     name: 'Cellulase enzyme (bio-polish)',  match: /cellulase/i,                          gsm: -0.025, bend: 0.95, fric: 0.92, hair: 0.15, db: 0, dL: 0,   wet: 0,   note: 'cuts the surface hairs: hairiness × 0.15, pilling up, bursting about 7 % down' },
  { id: 20, stage: 'After',     name: 'Anti-back-staining agent',       match: /back.?stain/i,                        gsm: 0,      bend: 1,    fric: 1,    hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'keeps white yarns white beside a dark one' },
  { id: 21, stage: 'Finishing', name: 'Cationic softener',              match: /cationic softener|cationic or silicone/i, gsm: 0.5, bend: 0.7,  fric: 0.85, hair: 1, db: 1.8,  dL: 0,   wet: 0,   note: 'fluffy handle; yellows a white (b* + 1.8)', hand: 'softener' },
  { id: 22, stage: 'Finishing', name: 'Silicone softener',              match: /silicone softener|silicone or non-ionic/i, gsm: 0.5, bend: 0.75, fric: 0.55, hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'silky, slippery; shine up about 25 %; an overdose lets seams slip', hand: 'silicone' },
  { id: 23, stage: 'Finishing', name: 'Hydrophilic softener',           match: /hydrophilic|non-ionic softener/i,     gsm: 0.5,    bend: 0.8,  fric: 0.8,  hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'matt, softer; wicking up about 80 %', hand: 'softener' },
  { id: 24, stage: 'Finishing', name: 'Water repellent (DWR)',          match: /water repellent|dwr/i,                gsm: 1.0,    bend: 1.12, fric: 0.95, hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'hydrophobic barrier (contact angle about 135°): a drop rolls off' },
  { id: 25, stage: 'Finishing', name: 'Wet-rubbing improver',           match: /wet.?rub/i,                           gsm: 0.5,    bend: 1.05, fric: 0.9,  hair: 1, db: 0,    dL: 0,   wet: 1.0, note: 'a thin elastic film: wet rubbing + 1 grade' },
  { id: 26, stage: 'Finishing', name: 'GSM improver',                   match: /gsm improver/i,                       gsm: 3.0,    bend: 1.1,  fric: 1.02, hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'polymer pick-up on the stenter: firmer handle, +3 % weight' },
  { id: 27, stage: 'Finishing', name: 'Oil remover',                    match: /oil remover/i,                        gsm: 0,      bend: 1,    fric: 1,    hair: 1, db: 0,    dL: 0,   wet: 0,   note: 'emulsifies knitting oil: no dark needle-oil stains' },
];
const BY_ID = Object.fromEntries(CHEM.map((c) => [c.id, c]));
// extra finishes a technologist can ask for on top of the compiled route (chemistry.process.finishes)
const FINISH_CHEM = { dwr: 24, wet_rub: 25, gsm_improver: 26, hydrophilic: 23, oil_remover: 27, anti_crease: 12 };
const SOFT_IDS = [21, 22, 23];

function identify(name) {
  const hit = CHEM.filter((c) => c.match.test(name || ''));
  const soft = hit.filter((c) => SOFT_IDS.includes(c.id));
  if (soft.length > 1 || /no cationic/i.test(name || '')) {
    // one softener per name: 'Silicone or non-ionic softener (no cationic …)' is the silicone; 'Cationic or silicone softener' (the compiler's
    // default, type not chosen) is taken as the commonest, the cationic
    const pick = /no cationic/i.test(name || '') ? 22 : /cationic or silicone/i.test(name || '') ? 21 : [22, 21, 23].find((id) => soft.some((c) => c.id === id));
    return hit.filter((c) => !SOFT_IDS.includes(c.id) || c.id === pick);
  }
  return hit;
}

/**
 * effects(steps, ctx) — steps: the route steps of yarn-chemistry-engine ({id, label, chemicals:[{name}]}); ctx: { finishes: [ 'dwr', … ],
 * dark: whether the shade is dark (fixing agent, wet-rub improver auto) }.
 * Returns the chemicals found, the totals, and what the hand engine should apply.
 */
function effects(steps, ctx) {
  const c = ctx || {};
  const seen = new Map();
  const add = (chem, step) => { const k = chem.id; if (!seen.has(k)) seen.set(k, { chem, steps: [] }); if (step && !seen.get(k).steps.includes(step)) seen.get(k).steps.push(step); };
  (steps || []).forEach((s) => (s.chemicals || []).forEach((x) => identify(x.name).forEach((ch) => add(ch, s.label))));
  (Array.isArray(c.bath_chemicals) ? c.bath_chemicals : []).forEach((n) => identify(n).forEach((ch) => add(ch, 'dye bath')));
  // the chemicals that ride with a step without being named in it
  const has = (id) => (steps || []).some((s) => s.id === id);
  if (has('dye_disperse')) { add(BY_ID[13], 'high-temperature jet'); add(BY_ID[15], 'disperse dyeing'); }
  if (c.dark && (has('dye_reactive') || has('dye_disperse') || has('dye_acid'))) add(BY_ID[11], 'dark shade');
  (Array.isArray(c.finishes) ? c.finishes : []).forEach((f) => { if (FINISH_CHEM[f]) add(BY_ID[FINISH_CHEM[f]], 'extra finish'); });
  const list = [...seen.values()].sort((a, b) => a.chem.id - b.chem.id);
  const tot = { gsm_pct: 0, bending: 1, friction: 1, hairiness: 1, delta_b: 0, delta_L: 0, wet_rub_grades: 0 };
  const other = { bending: 1, friction: 1 };                               // every chemical but the softeners: for the hand engine
  let soft = null;
  list.forEach(({ chem }) => {
    tot.gsm_pct += chem.gsm; tot.bending *= chem.bend; tot.friction *= chem.fric; tot.hairiness *= chem.hair; tot.delta_b += chem.db; tot.delta_L += chem.dL; tot.wet_rub_grades += chem.wet;
    if (SOFT_IDS.includes(chem.id)) soft = soft || chem.hand; else { other.bending *= chem.bend; other.friction *= chem.fric; }
  });
  return {
    chemicals: list.map(({ chem, steps: st }) => ({ id: chem.id, stage: chem.stage, name: chem.name, in: st, gsm_pct: chem.gsm, bending: chem.bend, friction: chem.fric, hairiness: chem.hair, delta_b: chem.db, delta_L: chem.dL, wet_rub_grades: chem.wet, effect: chem.note })),
    totals: { gsm_pct: r2(tot.gsm_pct), bending: r3(tot.bending), friction: r3(tot.friction), hairiness: r3(tot.hairiness), delta_b: r1(tot.delta_b), delta_L: r1(tot.delta_L), wet_rub_grades: r1(tot.wet_rub_grades) },
    hand: { finish: soft, bending: r3(other.bending), friction: r3(other.friction), note: 'the softener is the hand engine\'s own finish; every other chemical\'s bending and friction ride on top' },
    colour: { delta_b: r1(tot.delta_b), delta_L: r1(tot.delta_L), note: tot.delta_b > 0.5 ? 'the route yellows the cloth (b* up): a risk on a white or a pastel' : tot.delta_b < -0.5 ? 'the route whitens the cloth (b* down)' : 'no colour shift expected' },
    basis: 'estimate',
    note: 'Typical effect of each chemical at the usual dose, from dyehouse practice. A before/after reading of one lot (weight, bending, rubbing) replaces each estimate with a measurement. The Studio\'s weight is not changed: the factory records already include the usual route.',
  };
}

function catalogue() { return { chemicals: CHEM.map(({ match, hand, ...c }) => c), finishes: Object.entries(FINISH_CHEM).map(([id, n]) => ({ id, label: BY_ID[n].name })) }; }

module.exports = { effects, catalogue, CHEM, FINISH_CHEM, identify };
