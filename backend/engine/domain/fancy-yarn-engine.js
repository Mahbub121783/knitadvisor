/**
 * KnitAdvisor — Fancy yarn engine: slub, flame, nep, bouclé, chenille, air-jet textured and filament core-spun yarns.
 *
 * A fancy yarn is a plain yarn with an EFFECT built into it, and the effect changes everything a plain yarn's count says: the mass is
 * not where the count says, the strength is carried by only part of it, the diameter is set by a loop or a pile and not by the count,
 * and the evenness is the effect itself. For each form the engine works out, from the effect's own parameters and the fibres:
 *
 *   1  COUNT      the resultant count, and the parts it is made of (the declared base count of a slub, the three yarns of a bouclé,
 *                 the core and the pile of a chenille, the core and the sheath of a core-spun yarn, the feed and the overfeed of an ATY)
 *   2  MASS       what share of the yarn's mass each part is, by fibre and by part, and the length of each part per length of yarn
 *   3  TENSILE    which part carries the load (a slub breaks in its thin place, a bouclé on its core, a core-spun yarn on its filament
 *                 core, then its sheath), run through the blend yarn engine for the staple part
 *   4  EVENNESS   the mass variation the effect makes (two-level law for a slub; sampled for a flame), the thick places and neps per km
 *   5  GEOMETRY   the diameter the effect sets (loop height solved from the overfeed, pile length, slub thickness) and the parameters the
 *                 3D yarn view draws it from — what is on the screen is this engine's yarn
 *   6  HAND       hairiness, bulk, sheen and shedding, handed to the look engine
 *   7  KNITTING   the finest gauge it will pass, tension and feed, what to avoid
 *   8  DERIVATIONS the working behind every figure
 *
 * Every figure carries its basis (the convention of the other yarn engines): measured · law · blend · typical · estimate. The mass and
 * overfeed balances and the two-level evenness are laws; strength factors, hairiness, shedding and the gauge limit are typical, to be
 * replaced by the mill's own test. No outside source is named in what this returns.
 */
'use strict';

const BY = require('./blend-yarn-engine');
const Y = require('./yarn-engine');

class FancyError extends Error {}
const FP = Y.FIBER_PROPERTIES;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rd = (v, d) => (v == null || Number.isNaN(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d));
const r1 = (v) => rd(v, 1), r2 = (v) => rd(v, 2), r3 = (v) => rd(v, 3);
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const V = (value, unit, basis, extra) => (value == null || Number.isNaN(value) ? null : { value, unit, basis, ...(extra || {}) });

const FORMS = {
  slub:     { label: 'Slub', staple: true, what: 'Thick places spun into a yarn at intervals: the declared count is the base yarn, the knitted count is coarser.' },
  flame:    { label: 'Flame (irregular slub)', staple: true, what: 'Slubs of every length and thickness at irregular intervals: a random, flamed look.' },
  nep:      { label: 'Nep yarn', staple: true, what: 'A plain yarn with small coloured knots of fibre spaced along it.' },
  boucle:   { label: 'Bouclé', staple: true, what: 'A fine ground yarn, a binder wound round it, and an effect yarn fed in far faster, so it stands out in loops.' },
  chenille: { label: 'Chenille', staple: true, what: 'A short pile gripped between two fine twisted strands, standing out on every side: a caterpillar.' },
  core_fil: { label: 'Core-spun, filament core', staple: true, what: 'A bundle of polyester filaments in the middle, a staple sheath spun round it: the strength of a filament with the surface of the staple.' },
  lurex:    { label: 'Metallic (Lurex film yarn)', staple: false, what: 'A thin slit film of metallised polyester, flat as a ribbon: it sparkles but is stiff and has no hairs. It is knitted plated with a carrier yarn, never alone.' },
  aty:      { label: 'Air-jet textured (ATY)', staple: false, what: 'A multifilament yarn overfed through an air jet: loops and entanglements stand out of its core, a spun-yarn look from a filament.' },
};
const FORM_IDS = Object.keys(FORMS);
const DEFAULTS = {
  slub: { thickness: 1.8, length_cm: 4, spacing_cm: 12 },
  flame: { thickness: 3, length_mm: 14, spacing_cm: 12 },
  nep: { per_cm: 0.6, size: 2.2, colour: '#1d3f8a' },
  boucle: { effect_share: 0.6, overfeed: 3.2, spacing_mm: 1.6 },
  chenille: { pile_share: 0.72, pile_mm: 1.6, pile_density: 24 },
  core_fil: { core_denier: 40, core_dpf: 1.5 },
  aty: { overfeed_pct: 22 },
  lurex: { width_mm: 0.37, thickness_um: 12 },
};
// the look each form hands to the look engine: sheen and hairiness against a plain yarn, and a hand shift (typical)
const LOOK = {
  slub: { sheen: 1.0, hair: 1.05, soft: 0 }, flame: { sheen: 1.0, hair: 1.1, soft: 0 }, nep: { sheen: 1.0, hair: 1.05, soft: -2 },
  boucle: { sheen: 0.8, hair: 1.9, soft: 8 }, chenille: { sheen: 0.7, hair: 3.0, soft: 18 }, core_fil: { sheen: 1.0, hair: 0.8, soft: 0 }, aty: { sheen: 0.45, hair: 0.18, soft: 4 }, lurex: { sheen: 6.0, hair: 0, soft: -6 },
};

function readSpec(input) {
  if (!input || typeof input !== 'object') throw new FancyError('Give the fancy yarn: its form, fibres and count.');
  const form = input.form;
  if (!own(FORMS, form)) throw new FancyError(`"${form}" is not a fancy yarn form this engine knows (${FORM_IDS.join(', ')}).`);
  const fibres = {};
  const src = input.fibres || input.fibers;
  if (src && typeof src === 'object') for (const [f, v] of Object.entries(src)) if (+v > 0 && own(BY.FIB, f)) fibres[f] = +v;
  const filamentFibre = form === 'aty' || form === 'lurex';
  if (!filamentFibre && !Object.keys(fibres).length) throw new FancyError('Give the yarn\'s fibres and their shares, for example cotton 100.');
  const pIn = { ...DEFAULTS[form], ...(input.params && typeof input.params === 'object' ? input.params : {}) };
  if (form === 'lurex') {
    // a film yarn's count is its film: width × thickness × density (mm × µm × g/cm³ = tex)
    const w = clamp(+pIn.width_mm || 0.37, 0.1, 2), t = clamp(+pIn.thickness_um || 12, 6, 40);
    return { form, fibres: {}, tex: w * t * 1.4, p: { width_mm: w, thickness_um: t }, spinning: input.spinning };
  }
  const ct = input.count && typeof input.count === 'object' ? input.count : null;
  const conv = { ne: (v) => 590.5 / v, nm: (v) => 1000 / v, tex: (v) => v, dtex: (v) => v / 10, denier: (v) => v / 9 };
  let tex = null;
  if (ct && +ct.value > 0) { const u = String(ct.unit || 'ne').toLowerCase(); if (!own(conv, u)) throw new FancyError(`Count unit "${ct.unit}": use ne, nm, tex, dtex or denier.`); tex = conv[u](+ct.value); }
  else if (+input.tex > 0) tex = +input.tex;
  if (!(tex > 0)) throw new FancyError('Give the yarn count (value and unit): the count of the yarn as it is knitted.');
  if (tex < 2 || tex > 400) throw new FancyError(`${r1(tex)} tex is outside 2–400 tex: check the count and the unit.`);
  const p = { ...DEFAULTS[form], ...(input.params && typeof input.params === 'object' ? input.params : {}) };
  return { form, fibres, tex, p, spinning: input.spinning };
}

// the staple part of a fancy yarn, through the blend yarn engine. A part coarser than the engine's 120 tex is taken at 120 tex and its force scaled up
// by the tex (the tenacity of a coarse yarn does not change: the force is proportional to the mass)
const staple = (spec, tex) => {
  const sp = spec.spinning && BY.GEO[spec.spinning] ? spec.spinning : undefined;
  const t = Math.min(tex, 120), r = BY.analyse({ fibres: spec.fibres, count: { value: t, unit: 'tex' }, spinning: sp });
  if (tex > 120) { const k = tex / t; r.tensile = { ...r.tensile, breaking_force: { ...r.tensile.breaking_force, value: r1(r.tensile.breaking_force.value * k) } }; }
  return r;
};
const yarnDiameter = (tex, rho) => Math.sqrt(tex) / 28 * Math.sqrt(1.52 / (rho || 1.52));

// the height of a bouclé loop: the effect yarn leaves the core, rises to h and comes back (κ > 1 folds it back on itself); its length per
// length of yarn IS the overfeed, so the height is solved from it
function loopHeight(overfeed, spacing) {
  const kappa = 1.25, M = 28;
  const arc = (h) => { let s = 0, py = 0, pr = 0; for (let i = 1; i <= M; i++) { const t = i / M, yy = spacing * (t - kappa * Math.sin(2 * Math.PI * t) / (2 * Math.PI)), rho = h * Math.pow(Math.sin(Math.PI * t), 0.85); s += Math.hypot(yy - py, rho - pr); py = yy; pr = rho; } return s; };
  let lo = 0.01, hi = 14;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (arc(m) < overfeed * spacing) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

function analyse(input) {
  try { return analyse0(input); } catch (e) { if (e instanceof BY.BlendError) throw new FancyError(e.message); throw e; }
}
function analyse0(input) {
  const S = readSpec(input), F = FORMS[S.form], p = S.p;
  const warnings = [], say = (level, text) => warnings.push({ level, text });
  const derive = [], D = (id, quantity, formula, working, result, unit, basis) => derive.push({ id, quantity, formula, working, result, unit, basis });
  const tex = S.tex;
  const rho = S.form === 'aty' ? 1.38 : S.form === 'lurex' ? 1.4 : (() => { try { return staple(S, 19.7).composition.blend_density.value; } catch (e) { return 1.52; } })();
  let count = {}, mass = [], tens = null, even = null, geo = {}, hand = {}, knit = {};
  let d3 = {};                                                              // what the 3D yarn view draws it from

  if (S.form === 'slub' || S.form === 'flame') {
    const flame = S.form === 'flame';
    const m = clamp(+p.thickness || (flame ? 3 : 1.8), 1.15, 5);
    const len = clamp(+p.length_mm > 0 ? +p.length_mm : (+p.length_cm > 0 ? +p.length_cm * 10 : (flame ? 14 : 40)), 2, 200), gap = clamp(+p.spacing_cm > 0 ? +p.spacing_cm * 10 : 120, 5, 1500);
    let pFrac, extra, cvm, perKm;
    if (!flame) {
      pFrac = len / (len + gap); extra = (m - 1) * pFrac;
      cvm = ((m - 1) * Math.sqrt(pFrac * (1 - pFrac)) / (1 + pFrac * (m - 1))) * 100;
      perKm = 1e6 / (len + gap);
    } else {
      // sampled: lengths len·(0.55–1.45), mass ratios 1 + (m − 1)·(0.4–1), gaps gap·(0.6–1.4); a fixed seed, so the same flame gives the same figures
      let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
      let sum = 0, sum2 = 0, n = 0, pos = 0, slubs = 0, plain = 0;
      while (pos < 4e7) {
        const g = gap * (0.6 + 0.8 * rnd()), lk = len * (0.55 + 0.9 * rnd()), mk = 1 + (m - 1) * (0.4 + 0.6 * rnd());
        for (let x = 0; x < g; x += 2) { sum += 1; sum2 += 1; n++; } plain += g;
        for (let x = 0; x < lk; x += 2) { sum += mk; sum2 += mk * mk; n++; }
        pos += g + lk; slubs++;
      }
      const mean = sum / n, varr = sum2 / n - mean * mean;
      extra = mean - 1; cvm = (Math.sqrt(varr) / mean) * 100; pFrac = 1 - plain / pos; perKm = (slubs / pos) * 1e6;
    }
    const baseTex = tex / (1 + extra);
    const base = staple(S, baseTex);
    const F0 = base.tensile.breaking_force.value, thin = F0 * 0.9;
    count = { resultant_tex: tex, declared_base_tex: baseTex, declared_base_ne: 590.5 / baseTex, extra_mass_pct: extra * 100, slub_share_of_length_pct: pFrac * 100, slubs_per_km: perKm };
    mass = [{ part: 'base yarn', share_pct: 100 / (1 + extra) }, { part: 'the slubs\' extra mass', share_pct: (extra / (1 + extra)) * 100 }];
    tens = { source: base, force: thin, factor: 0.9, where: 'the thin place', note: 'A slub yarn breaks where it is thinnest: the base yarn, a little weaker (about 10 %) than a plain yarn of that count because the twist is drawn into the thin places.' };
    even = { cvm_pct: cvm, basis: flame ? 'estimate' : 'law', note: flame ? 'Sampled over 40 km of a random flame: lengths, thicknesses and gaps vary.' : 'Two levels of mass, a fraction p of the length at m times the base: CV = (m − 1)·√(p(1 − p)) ÷ (1 + p(m − 1)).' };
    geo = { diameter_plain_mm: yarnDiameter(baseTex, rho), diameter_slub_mm: yarnDiameter(baseTex * m, rho), thick_to_thin: Math.sqrt(m) };
    d3 = { form: S.form, fancy: flame ? { thickness: m, length_mm: len, spacing_mm: gap } : { thickness: m, length_mm: len, spacing_mm: gap } };
    hand = { hairiness_rel: base.texture.hairiness_vs_combed_cotton.value, bulk: 1 + 0.12 * extra, note: 'The thick places are softer and fuller, with less twist per length: they pill and wear first.' };
    knit = { d_eff: geo.diameter_slub_mm, notes: [`Knit at the resultant count (${r1(590.5 / tex)}s Ne): the loop length is set by the thick places, so the thin ones lie slack and the cloth is open between slubs.`, 'Slubs under 2 mm at needle level can catch in a fine-gauge hook or sinker: keep the slub no thicker than 3 times the base.'] };
    D('slub_mass', 'Extra mass of the slubs', flame ? 'mean over the sampled flame of (mass ratio − 1)' : 'extra = (m − 1) × length ÷ (length + gap)', flame ? `sampled mean ${r3(extra)}` : `(${m} − 1) × ${len} ÷ (${len} + ${gap})`, r3(extra), '', 'law');
    D('slub_base', 'Declared base count', 'base tex = resultant tex ÷ (1 + extra)', `${r2(tex)} ÷ (1 + ${r3(extra)})`, `${r1(baseTex)} tex = ${r1(590.5 / baseTex)}s Ne`, '', 'law');
    D('slub_cv', 'Mass variation', even.note, flame ? 'sampled' : `(${m} − 1)·√(${r3(pFrac)}·${r3(1 - pFrac)}) ÷ (1 + ${r3(pFrac)}·${r2(m - 1)})`, `${r1(cvm)} %`, '%', even.basis);
  } else if (S.form === 'nep') {
    const perCm = clamp(+p.per_cm || 0.6, 0.2, 12), size = clamp(+p.size || 2.2, 1.3, 4);
    const base = staple(S, tex), d = yarnDiameter(tex, rho), rn = (size * d) / 2;
    const massNep = (4 / 3) * Math.PI * Math.pow(rn, 3) * 0.45 * rho;       // mg (mm³ × g/cm³ = mg)
    const addTex = massNep * perCm * 100 * 1000 / 1000;                       // mg per m = tex
    count = { resultant_tex: tex, neps_per_cm: perCm, neps_per_km: perCm * 1e5, nep_diameter_mm: 2 * rn, nep_mass_mg: massNep, nep_mass_pct: (addTex / tex) * 100 };
    mass = [{ part: 'yarn', share_pct: 100 - (addTex / tex) * 100 }, { part: 'neps', share_pct: (addTex / tex) * 100 }];
    tens = { source: base, force: base.tensile.breaking_force.value * 0.97, factor: 0.97, where: 'the yarn beside a nep', note: 'A nep is a tangle held on the surface: it adds little mass and takes little of the load; the yarn is a touch weaker beside it.' };
    even = { cvm_pct: base.evenness.cvm_pct.value * 1.03, basis: 'estimate', note: 'The deliberate neps add a little to the mass variation of the plain yarn; the neps themselves are counted separately.' };
    geo = { diameter_plain_mm: d, nep_diameter_mm: 2 * rn };
    d3 = { form: 'nep', fancy: { per_cm: perCm, size, colour: p.colour } };
    hand = { hairiness_rel: base.texture.hairiness_vs_combed_cotton.value, bulk: 1, note: 'Small hard knots: they show as flecks and can be felt.' };
    knit = { d_eff: geo.nep_diameter_mm, notes: ['A nep is about twice the yarn diameter: the needle hook and the guide must clear it.', 'Neps shed colour and can be picked at in wear; the colour of the nep fibre is dyed with the yarn unless it is a different fibre.'] };
    D('nep_mass', 'Mass of the neps', 'm = 4/3·π·r³·packing·ρ per nep;  tex added = neps per m × m', `r = ${r3(rn)} mm, ${perCm} per cm`, `${r2((addTex / tex) * 100)} % of the yarn`, '', 'estimate');
  } else if (S.form === 'boucle') {
    const share = clamp(+p.effect_share || 0.6, 0.3, 0.85), q = clamp(+p.overfeed || 3.2, 1.8, 6), spacing = clamp(+p.spacing_mm || 1.6, 0.8, 10);
    const gT = tex * (1 - share) * 0.8, bT = tex * (1 - share) * 0.2, eShare = tex * share, eOwn = eShare / q;
    const h = loopHeight(q, spacing);
    const core = staple(S, gT + bT);
    const rg = yarnDiameter(gT, rho) / 2, re = yarnDiameter(eOwn, rho) / 2, dFull = 2 * (rg + re * 0.9 + h * 1.3);
    count = { resultant_tex: tex, ground_tex: gT, binder_tex: bT, effect_tex_per_its_own_length: eOwn, effect_tex_per_yarn_length: eShare, overfeed: q, effect_length_per_yarn_length: q };
    mass = [{ part: 'ground', share_pct: (gT / tex) * 100 }, { part: 'binder', share_pct: (bT / tex) * 100 }, { part: 'effect (loops)', share_pct: share * 100 }];
    tens = { source: core, force: core.tensile.breaking_force.value * 0.88, factor: 0.88, where: 'the ground and the binder', note: 'The loops are slack: the load is carried by the ground yarn and the binder alone, the effect yarn adds mass and no strength.' };
    even = { cvm_pct: null, basis: 'n/a', note: 'A bouclé\'s irregularity IS the effect: evenness is judged by eye, not by a mass test.' };
    geo = { loop_height_mm: h, loop_spacing_mm: spacing, diameter_core_mm: 2 * rg, diameter_full_mm: dFull, effect_diameter_mm: 2 * re };
    d3 = { form: 'boucle', fancy: { effect_share: share, overfeed: q, spacing_mm: spacing } };
    hand = { hairiness_rel: core.texture.hairiness_vs_combed_cotton.value * 1.9, bulk: dFull / yarnDiameter(tex, rho), note: 'Soft, bulky and rough to the eye: the loops catch the light unevenly and hide the stitch.' };
    knit = { d_eff: 2 * (rg + re) + 0.6 * h, notes: ['A bouclé needs an open gauge and a loose loop: the effect yarn catches in a fine hook.', 'Use positive, even feed and a low take-down; knit tuck-free, simple structures (jersey, rib) so the loops are not trapped.', 'Loops snag in wear: a bouclé belongs in a fabric that is not rubbed.'] };
    D('boucle_mass', 'Mass of the parts', 'effect = share × tex (per length of yarn); ground = 0.8·(1 − share)·tex; binder = 0.2·(1 − share)·tex', `${r1(share * 100)} % effect, ${r2(gT)} + ${r2(bT)} + ${r2(eShare)} tex`, `${r2(tex)} tex`, 'tex', 'law');
    D('boucle_overfeed', 'Overfeed and the effect yarn\'s own count', 'effect tex per its own length = effect mass per yarn length ÷ overfeed', `${r2(eShare)} ÷ ${q}`, `${r2(eOwn)} tex (${r1(590.5 / eOwn)}s Ne)`, '', 'law');
    D('boucle_loop', 'Loop height', 'the arch height h where the length of the arch = overfeed × the loop spacing (κ = 1.25 folds it into a loop)', `overfeed ${q}, spacing ${spacing} mm`, `${r2(h)} mm`, 'mm', 'law');
  } else if (S.form === 'chenille') {
    const share = clamp(+p.pile_share || 0.72, 0.4, 0.9), pl = clamp(+p.pile_mm || 1.6, 0.5, 4), dens = clamp(+p.pile_density || 24, 8, 40);
    const cT = tex * (1 - share), core = staple(S, cT);
    const rcore = yarnDiameter(cT / 2, rho) / 2 * 1.8, dFull = 2 * (rcore + pl);
    count = { resultant_tex: tex, core_tex: cT, pile_tex: tex * share, pile_share_pct: share * 100, pile_mm: pl, tufts_per_mm: dens };
    mass = [{ part: 'core (two twisted strands)', share_pct: (1 - share) * 100 }, { part: 'pile', share_pct: share * 100 }];
    tens = { source: core, force: core.tensile.breaking_force.value * 0.95, factor: 0.95, where: 'the core', note: 'The pile carries nothing: the core of two fine strands holds the whole load. A chenille is as strong as its core.' };
    even = { cvm_pct: null, basis: 'n/a', note: 'The pile makes the evenness: judged by eye.' };
    const shed = pl > 2.5 || dens < 14 ? 'high' : pl > 1.5 ? 'medium' : 'low';
    geo = { diameter_core_mm: 2 * rcore, diameter_full_mm: dFull, pile_mm: pl };
    d3 = { form: 'chenille', fancy: { pile_share: share, pile_mm: pl, pile_density: dens } };
    hand = { hairiness_rel: 3.0, bulk: dFull / yarnDiameter(tex, rho), shedding: shed, note: 'A velvet pile: it lies in the direction it is brushed, so the cloth shades differently from different sides.' };
    knit = { d_eff: 2 * (rcore + pl * 0.6), notes: ['A chenille is knitted in a coarse gauge (5–7 GG on a flat machine, 12 GG or coarser circular) with a loose loop: the pile must not be trapped.', 'Shedding: the pile works out of the core, worst when new and with friction; a short pile and a tight core twist shed least.', 'Do not mercerise or brush: the pile is already the surface.'] };
    D('chenille_mass', 'Pile and core', 'pile = share × tex;  core = (1 − share) × tex', `${r1(share * 100)} % pile of ${r2(tex)} tex`, `${r2(cT)} tex of core`, 'tex', 'law');
    D('chenille_d', 'Full diameter', 'D = 2·(core radius + pile length)', `2 × (${r3(rcore)} + ${pl})`, `${r2(dFull)} mm`, 'mm', 'typical');
  } else if (S.form === 'core_fil') {
    const den = clamp(+p.core_denier || 40, 10, 400), coreTex = Math.min(den / 9, tex * 0.45), dpf = clamp(+p.core_dpf || 1.5, 0.5, 6);
    const sheathTex = tex - coreTex, nF = clamp(Math.round(coreTex * 9 / dpf), 6, 40);
    const coreShare = coreTex / tex * 100;
    const fibres = { ...S.fibres };
    const merged = fibres.polyester > 0;
    const sheathTotal = Object.values(fibres).reduce((a, b) => a + b, 0);
    const comps = Object.entries(fibres).map(([f, v]) => ({ fibre: f, share: (v / sheathTotal) * (100 - coreShare) + (f === 'polyester' ? coreShare : 0) }));
    if (!merged) comps.push({ fibre: 'polyester', share: coreShare, staple_mm: 500, dtex: dpf / 0.9 });
    const comp = BY.analyse({ components: comps, count: { value: tex, unit: 'tex' }, spinning: S.spinning && BY.GEO[S.spinning] ? S.spinning : undefined });
    count = { resultant_tex: tex, core_tex: coreTex, core_denier: coreTex * 9, core_filaments: nF, sheath_tex: sheathTex, core_share_pct: coreShare };
    mass = [{ part: 'filament core', share_pct: coreShare }, { part: 'staple sheath', share_pct: 100 - coreShare }];
    tens = { source: comp, force: comp.tensile.breaking_force.value, factor: 1, where: 'the sheath first, then the filament core', note: 'The staple sheath breaks first (cotton at about 7 %), the polyester core carries on to its own break: the yarn is as strong as the core plus what the sheath gives, with a high ultimate elongation.', blendDetail: true };
    even = { cvm_pct: comp.evenness.cvm_pct.value, basis: 'blend', note: 'The sheath sets the evenness; the continuous core steadies it.' };
    geo = { diameter_mm: yarnDiameter(tex, rho), core_diameter_mm: 2 * Math.sqrt(coreTex / (1.38 * 1000 * 0.62 * Math.PI)) };
    d3 = { form: 'core_fil', fancy: { core_denier: den, core_dpf: dpf } };
    hand = { hairiness_rel: comp.texture.hairiness_vs_combed_cotton.value * 0.8, bulk: 0.98, note: 'The surface of the staple with the strength and recovery of a filament: sewing threads, denim, stretch-free strong knits.' };
    knit = { d_eff: geo.diameter_mm, notes: ['Knit like the plain yarn of the same count: the core makes it stronger, not thicker.', merged ? 'The sheath already contains polyester: the core is counted into it and cannot be told from the sheath polyester in the strength model.' : 'Dye as the blend: the polyester core needs disperse dye at 130 °C, the sheath its own class.'] };
    D('corefil_mass', 'Core and sheath', 'core tex = denier ÷ 9 (not above 45 % of the yarn);  sheath = yarn − core', `${den} D → ${r2(coreTex)} tex of ${r2(tex)}`, `${r1(coreShare)} % core`, '%', 'law');
  } else if (S.form === 'lurex') {
    const w = p.width_mm, tu = p.thickness_um, tmm = tu / 1000;
    const E = 4000;                                                         // N/mm², metallised PET film (typical)
    const F0 = 28 * tex;                                                    // cN: film tenacity about 28 cN/tex (typical)
    const B = E * w * Math.pow(tmm, 3) / 12;                                // N·mm² : a ribbon bends easily about its thin axis
    const bLim = 15 * tmm;                                                  // the film creases tighter than about this bend radius... (typical, mm)
    count = { resultant_tex: tex, film_width_mm: w, film_thickness_um: tu, film_denier: tex * 9 };
    mass = [{ part: 'metallised polyester film', share_pct: 100 }];
    tens = { source: null, force: F0, factor: 1, where: 'the film', note: 'A slit film: strong along its length (about 28 cN/tex) but it splits and creases across. It breaks at about 20-25 % elongation.' };
    even = { cvm_pct: 2.0, basis: 'typical', note: 'A film of even width and thickness: very even by mass; the sparkle varies with how the ribbon twists.' };
    geo = { film_width_mm: w, film_thickness_um: tu, bending_rigidity_n_mm2: B, min_bend_radius_mm: bLim, diameter_mm: Math.sqrt(w * w + tmm * tmm) };
    d3 = { form: 'lurex', fancy: { width_mm: w, thickness_um: tu } };
    hand = { hairiness_rel: 0, bulk: 0.5, note: 'Smooth, cool and glittering; a little crisp. It adds sparkle, not body: use 5-25 % of the cloth.' };
    knit = { d_eff: w * 1.1, notes: ['Never knit alone: plate it with a carrier yarn (polyester or nylon filament, or a fine spun yarn) on a plating feeder, held to the face so the film shows.', 'Keep the feeder tension low (about 0.5-1.5 cN) and the path free of twist: a twisted ribbon loses its sparkle and catches in the hook.', 'No tucks or floats on the ribbon: it crimps and cuts. Knit it on single jersey or plated rib.', 'Aluminium is attacked by alkali, chlorine and strong acid, and the film distorts above about 130 °C: no caustic scour, no hypochlorite, heat-set cool. Not dyed: the colour is the film\'s.'] };
    D('lurex_tex', 'Count of the film', 'tex = width (mm) × thickness (µm) × density (1.4 g/cm³)', `${w} × ${tu} × 1.4`, `${r1(tex)} tex (${r1(tex * 9)} denier)`, 'tex', 'law');
    D('lurex_b', 'Bending rigidity', 'B = E · w · t³ ÷ 12', `${E} N/mm² × ${w} mm × (${tmm} mm)³ ÷ 12`, `${(B * 1e3).toFixed(3)} mN·mm²`, 'N·mm²', 'estimate');
  } else {                                                                   // aty
    const ov = clamp((+p.overfeed_pct > 0 ? +p.overfeed_pct : 22) / 100, 0.05, 0.6);
    const den = tex * 9, nF = clamp(Math.round(den / 2.2), 10, 300);
    const t = FP.polyester.tensile, F0 = (t.tenacity * 100 * 1.06) * (1 - 0.18) * tex;       // filament tenacity a little above the staple's, less 18 % for the loops and entanglement
    count = { resultant_tex: tex, delivered_denier: den, overfeed_pct: ov * 100, filaments: nF, dpf: den / nF };
    mass = [{ part: 'core filaments', share_pct: 60 }, { part: 'effect filaments (overfed)', share_pct: 40 }];
    tens = { source: null, force: F0, factor: 0.82, where: 'the core filaments', note: 'The overfed filaments stand out in loops and carry little: the strength is that of the core, about 18 % below a flat yarn of the same denier.' };
    even = { cvm_pct: 2.5, basis: 'typical', note: 'The mass is even (continuous filaments); the unevenness is the loops on the surface.' };
    geo = { diameter_mm: yarnDiameter(tex, 1.38) * 1.35, loop_height_mm: yarnDiameter(tex, 1.38) * 1.2 };
    d3 = { form: 'aty', fancy: { overfeed_pct: ov * 100 } };
    hand = { hairiness_rel: 0.18 + 0.7 * ov, bulk: 1.35, note: 'A dry, spun-yarn hand and a matt look from a filament: no delustrant needed, and a good cover.' };
    knit = { d_eff: geo.diameter_mm, notes: ['Knit with a lubricated, low-tension feed: the loops catch on guides and eyelets.', 'Heat-set at 170–190 °C; the loops hold, the yarn does not shrink as a DTY does.', 'Boil-off shrinkage 3–5 %.'] };
    D('aty_strength', 'Strength', 'F = filament tenacity × 1.06 × (1 − 0.18) × tex', `${r1(t.tenacity * 100)} cN/tex × 1.06 × 0.82 × ${r2(tex)}`, `${r1(F0)} cN`, 'cN', 'typical');
  }
  // the common results
  const force = tens.force, tenacity = force / tex;
  const ext = tens.source ? tens.source.tensile.elongation_at_break.value : 18;
  const tensile = {
    breaking_force: V(r1(force), 'cN', tens.source ? 'blend' : 'typical'), tenacity: V(r1(tenacity), 'cN/tex of the whole yarn', tens.source ? 'blend' : 'typical'),
    elongation_at_break: V(r1(ext), '%', tens.source ? 'blend' : 'typical'), carried_by: tens.where, factor_vs_plain: V(r2(tens.factor), '', 'typical'), note: tens.note,
    ...(tens.blendDetail && tens.source ? { ultimate_elongation: tens.source.tensile.ultimate_elongation, breaks_first: tens.source.tensile.breaks_first, sequence: tens.source.tensile.sequence_note, curve: tens.source.tensile.curve } : {}),
  };
  D('force', 'Breaking force', 'F = the load-carrying part\'s force × its factor', `${r1(tens.source ? tens.source.tensile.breaking_force.value : force)} cN × ${r2(tens.factor)}`, `${r1(force)} cN`, 'cN', tens.source ? 'blend' : 'typical');
  const gaugeMax = Math.floor(25.4 / (2.1 * Math.max(knit.d_eff, 0.05)));
  knit = { effective_diameter_mm: V(r3(knit.d_eff), 'mm', 'estimate'), finest_gauge: V(gaugeMax, 'GG', 'typical', { note: 'the finest gauge whose needle pitch is 2.1 × the yarn\'s knitting diameter' }), notes: knit.notes };
  D('gauge', 'Finest gauge', 'GG ≤ 25.4 ÷ (2.1 × knitting diameter)', `25.4 ÷ (2.1 × ${r3(knit.effective_diameter_mm.value)})`, `${gaugeMax} GG`, 'GG', 'typical');
  if (S.form !== 'aty' && S.form !== 'lurex' && !Object.keys(S.fibres).length) say('warn', 'No fibres given.');
  if (S.form === 'lurex') say('note', `A ${r1(tex * 9)} denier film: knit it plated with a carrier yarn, never alone, and keep it out of caustic, chlorine and any bath hotter than about 130 °C.`);
  if (['boucle', 'chenille'].includes(S.form) && gaugeMax >= 20) say('note', `A ${S.form} at this count is fine enough for ${gaugeMax} GG, but its loops or pile catch in a fine hook: keep it in a coarse gauge.`);
  return {
    success: true,
    identity: { form: S.form, label: F.label, what: F.what, staple: F.staple },
    count: Object.fromEntries(Object.entries(count).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v])),
    count_labels: { resultant_ne: r1(590.5 / tex), resultant_nm: r1(1000 / tex), resultant_denier: r1(tex * 9), declared_base_ne: count.declared_base_ne ? r1(count.declared_base_ne) : null },
    mass: mass.map((m) => ({ part: m.part, share_pct: r1(m.share_pct) })),
    tensile, evenness: { cvm_pct: even.cvm_pct != null ? V(r1(even.cvm_pct), '%', even.basis) : null, note: even.note },
    geometry: Object.fromEntries(Object.entries(geo).map(([k, v]) => [k, typeof v === 'number' ? V(r3(v), k.endsWith('_mm') ? 'mm' : '', 'estimate') : v])),
    hand: { hairiness: V(r2(hand.hairiness_rel), '× combed cotton', 'estimate'), bulk: V(r2(hand.bulk), '× the plain yarn diameter', 'estimate'), shedding: hand.shedding || null, note: hand.note },
    look: { ...LOOK[S.form] },
    knitting: knit,
    render: d3,
    warnings, derivations: derive,
  };
}

/** Studio input: each role's yarn takes its form and effect (an ATY makes it a filament yarn). */
function applyToInput(input) {
  if (!input || typeof input !== 'object' || !input.fancy || typeof input.fancy !== 'object') return input;
  const out = { ...input, yarn: { ...(input.yarn || {}) }, yarns: { ...(input.yarns || {}) } };
  for (const role of ['ground', 'binder', 'loop', 'plate']) {
    const sp = own(input.fancy, role) ? input.fancy[role] : null;
    if (!sp || sp.enabled === false || !own(FORMS, sp.form)) continue;
    const base = role === 'ground' ? out.yarn : { ...(out.yarns[role] || {}) };
    const merged = { ...base, form: sp.form, fancy: { ...DEFAULTS[sp.form], ...(sp.params || {}) } };
    if (sp.form === 'aty') { merged.fibre = 'polyester_filament'; merged.type = 'aty'; }
    if (sp.form === 'lurex') {
      const w = clamp(+((sp.params || {}).width_mm) || DEFAULTS.lurex.width_mm, 0.1, 2), t = clamp(+((sp.params || {}).thickness_um) || DEFAULTS.lurex.thickness_um, 6, 40);
      merged.fibre = 'polyester_filament'; merged.type = 'fdy'; merged.lustre = 'bright'; merged.count = r1(w * t * 1.4 * 9); merged.unit = 'denier'; merged.ply = 1; merged.metallic = true;
    }
    if (role === 'ground') out.yarn = merged; else out.yarns[role] = merged;
  }
  return out;
}

function catalogue() {
  return {
    forms: FORM_IDS.map((id) => ({ id, label: FORMS[id].label, what: FORMS[id].what, staple: FORMS[id].staple, defaults: DEFAULTS[id] })),
    fibres: Object.keys(BY.FIB).map((id) => ({ id, label: BY.FIB[id].label })),
    spinning: Object.keys(BY.GEO).map((id) => ({ id, label: Y.SPINNING_SYSTEMS[id].label })),
  };
}

module.exports = { analyse, applyToInput, catalogue, FancyError, FORMS, DEFAULTS, LOOK, loopHeight };
