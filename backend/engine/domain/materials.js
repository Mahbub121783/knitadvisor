/**
 * Parts 1–2 — fibre and yarn, as the parts the rest of the engine attaches to.
 *
 * Every number comes out as { value, unit, basis } and says where it came from:
 *   measured   the fibre property tables, or a test the mill gives (HVI, evenness, tensile, twist …)
 *   law        worked out by physics from other numbers here (diameter from count, density and packing;
 *              bending rigidity from the fibre's and the number of fibres; twist angle from twist and diameter)
 *   blend      measured fibre values mixed by the law that applies (volume for density, mass for regain …)
 *   bound      a physical limit, not an estimate (a yarn's bending rigidity lies between its fibres free to
 *              slip and its fibres locked into a rod)
 *   typical    an industry default where nothing was measured — each one names the test that replaces it
 *
 * FIBRE (part 1): density, regain, fineness, tensile (tenacity, extension, modulus, wet), specific flexural and
 * torsional rigidity and the fibre's own rigidities, friction (fibre on fibre, on steel), elastic recovery
 * at 1/5/10 % strain, swelling, and the polymer's thermal behaviour (melting, glass transition, heat-setting).
 * YARN (part 2): count in every system, packing and diameter, fibres in the section, twist and its surface
 * angle, bending and torsional rigidity, residual torque (what drives spirality), strength and extension,
 * yarn-on-yarn and yarn-on-metal friction, recovery, evenness, and the quality tests that measure each.
 *
 * Nothing here is fitted to fabric records. No outside source is named in what this returns.
 */
'use strict';

const Y = require('./yarn-engine');
const U = require('./uster-engine');

class MaterialError extends Error {}
const FP = Y.FIBER_PROPERTIES;
const V = (value, unit, basis, extra) => (value == null || Number.isNaN(value) ? null : { value: round(value), unit, basis, ...(extra || {}) });
const round = (v) => (typeof v !== 'number' ? v : Math.abs(v) >= 100 ? Math.round(v * 10) / 10 : Math.abs(v) >= 1 ? Math.round(v * 1000) / 1000 : +v.toPrecision(4));
const mid = (v) => (Array.isArray(v) ? (v[0] + v[1]) / 2 : v);

// ── typical values that no table here measures — each replaced by the test named ──────────────
// fibre fineness (dtex) — replaced by micronaire / vibroscope / the filament count
const FINENESS = { cotton: 1.65, polyester: 1.4, viscose: 1.3, modal: 1.0, tencel: 1.3, bamboo: 1.3, acrylic: 1.7, wool: 4.4, silk: 1.1, linen: 20, polypropylene: 2.2, polyethylene: 2.0, nylon: 3.3, elastane: 44 };
// staple length (mm) — replaced by HVI UHML / fibrograph; null = filament
const STAPLE = { cotton: 28, polyester: 38, viscose: 38, modal: 38, tencel: 38, bamboo: 38, acrylic: 40, wool: 75, linen: 300, silk: null, nylon: null, polypropylene: 38, polyethylene: 38, elastane: null };
// polymer thermal behaviour (°C) — glass transition and the heat-setting window of a thermoplastic
const POLYMER = {
  polyester: { tg: [70, 80], heat_set: [180, 200] }, nylon: { tg: [45, 60], heat_set: [170, 195] }, polypropylene: { tg: [-15, -5], heat_set: [120, 135] },
  acrylic: { tg: [85, 105], heat_set: [130, 150] }, elastane: { tg: [-60, -40], heat_set: [175, 195] }, polyethylene: { tg: [-120, -100], heat_set: null },
};
// packing fraction of the yarn section by how it is made — replaced by a measured diameter
const PACKING = { compact: 0.63, siro_compact: 0.63, combed: 0.6, carded: 0.58, siro: 0.6, open_end: 0.55, vortex: 0.58, filament: 0.7, textured: 0.35, mono: 1.0, elastane: 0.9 };
// twist multiplier αe (turns/inch ÷ √Ne) knitting yarns are spun at — replaced by a twist test
const ALPHA_E = { compact: 3.3, siro_compact: 3.2, combed: 3.5, carded: 3.7, siro: 3.4, open_end: 4.2, vortex: 3.6 };
const SPUN = new Set(['compact', 'siro_compact', 'combed', 'carded', 'siro', 'open_end', 'vortex']);

const UNITS = {
  ne: (v) => 590.5 / v, nm: (v) => 1000 / v, tex: (v) => v, dtex: (v) => v / 10, denier: (v) => v / 9, nw: (v) => 885.8 / v,
};

/** A composition as fibre → mass %, summing to 100. Accepts 'cotton', { cotton: 60, polyester: 40 } or [{ fibre, pct }]. */
function composition(c) {
  let o = {};
  if (typeof c === 'string') o[c] = 100;
  else if (Array.isArray(c)) c.forEach((x) => { if (x && x.fibre) o[x.fibre] = (o[x.fibre] || 0) + (+x.pct || 0); });
  else if (c && typeof c === 'object') o = { ...c };
  const keys = Object.keys(o).filter((k) => +o[k] > 0);
  if (!keys.length) throw new MaterialError('Give the fibre (or the blend, by mass %).');
  for (const k of keys) if (!FP[k]) throw new MaterialError(`"${k}" is not a fibre the tables know (${Object.keys(FP).join(', ')}).`);
  const sum = keys.reduce((t, k) => t + +o[k], 0);
  return Object.fromEntries(keys.map((k) => [k, (+o[k] * 100) / sum]));
}

const lo = (v) => (Array.isArray(v) ? v[0] : v);
const hi = (v) => (Array.isArray(v) ? v[1] : v);
function mixMass(comp, get) {                       // mass-weighted mean of a property, over the fibres that have it
  let s = 0, w = 0; const missing = [];
  for (const [k, p] of Object.entries(comp)) { const v = mid(get(FP[k] || {}, k)); if (v == null || Number.isNaN(+v)) missing.push(k); else { s += p * v; w += p; } }
  return { value: w ? s / w : null, covered: w, missing };
}

// ── PART 1: FIBRE ──────────────────────────────────────────────────────────────────────────────
/**
 * @param comp   fibre or blend
 * @param tests  { micronaire, fibre_dtex, staple_mm, tenacity_cN_tex, elongation_pct } from the mill's fibre tests
 */
function fibre(comp0, tests = {}) {
  const comp = composition(comp0);
  const names = Object.keys(comp), single = names.length === 1 ? names[0] : null;
  const unmeasured = new Set();
  const note = (m, what) => { m.missing.forEach((k) => unmeasured.add(`${k}: ${what}`)); return m; };

  // density: volumes add
  const invRho = names.reduce((t, k) => t + comp[k] / 100 / (FP[k].density || 1.3), 0);
  if (names.some((k) => !FP[k].density)) names.filter((k) => !FP[k].density).forEach((k) => unmeasured.add(`${k}: density`));
  const rho = 1 / invRho;
  const regain = note(mixMass(comp, (f) => f.regain), 'moisture regain');

  // fineness: a test wins; cotton's from micronaire
  let dtex, dBasis;
  if (+tests.fibre_dtex > 0) { dtex = +tests.fibre_dtex; dBasis = 'measured'; }
  else if (+tests.micronaire > 0 && comp.cotton) { dtex = +tests.micronaire * 0.394; dBasis = 'law'; }
  else { dtex = names.reduce((t, k) => t + (comp[k] / 100) * (FINENESS[k] || 1.5), 0); dBasis = 'typical'; }
  const texF = dtex / 10;
  const stapleMix = names.every((k) => STAPLE[k] == null) ? null : names.reduce((t, k) => t + (comp[k] / 100) * (STAPLE[k] || 0), 0);

  // tensile
  const mech = single ? FP[single].tensile || {} : null;
  const bm = single ? null : Y.blendMechanics(comp);
  const ten = +tests.tenacity_cN_tex > 0 ? V(+tests.tenacity_cN_tex / 100, 'N/tex', 'measured') : single ? V(mech.tenacity, 'N/tex', 'measured') : bm && V(bm.tenacity_upper_bound_n_tex, 'N/tex', 'bound', { note: `blend: the fibre that breaks first (${bm.breaks_first}) caps it` });
  const ext = +tests.elongation_pct > 0 ? V(+tests.elongation_pct, '%', 'measured') : single ? V(mech.extension, '%', 'measured') : bm && V(bm.extension_pct, '%', 'blend');
  const modulus = single ? V(mech.modulus, 'N/tex', 'measured') : bm && V(bm.modulus_n_tex, 'N/tex', 'blend');
  const wet = single ? (mech.wet ? { tenacity: V(mech.wet.ten, '× dry', 'measured'), modulus: V(mech.wet.mod, '× dry', 'measured') } : null) : bm && bm.wet ? { tenacity: V(bm.wet.tenacity, '× dry', 'blend'), modulus: V(bm.wet.modulus, '× dry', 'blend') } : null;

  // rigidities: specific (per tex²) measured, the fibre's own from its fineness — B = η · tex_f²
  const eta = note(mixMass(comp, (f) => f.directional && f.directional.flexural), 'flexural rigidity');
  const eps = note(mixMass(comp, (f) => f.directional && f.directional.torsional), 'torsional rigidity');
  // friction
  const muFF = note(mixMass(comp, (f) => f.friction && (f.friction.crossed ? mid(f.friction.crossed) : f.friction.parallel)), 'friction');
  const muSteel = note(mixMass(comp, (f) => f.friction && f.friction.guide && f.friction.guide.steel), 'friction on steel');
  // recovery
  const rec = (key) => note(mixMass(comp, (f) => f.recovery && f.recovery.rh60 && f.recovery.rh60[key]), `recovery from ${key.slice(1)} %`);
  const r1 = rec('e1'), r5 = rec('e5'), r10 = rec('e10');
  // swelling (water): diameter %
  const sw = note(mixMass(comp, (f) => f.swelling && f.swelling.diameter), 'swelling');
  // thermal: the weakest fibre sets the ceiling; thermoplastics heat-set
  const melts = names.map((k) => [k, FP[k].heat && FP[k].heat.melting_c]).filter(([, t]) => t);
  const thermo = names.filter((k) => POLYMER[k] && POLYMER[k].heat_set);
  const setLo = thermo.length ? Math.max(...thermo.map((k) => POLYMER[k].heat_set[0])) : null;
  const setHi = thermo.length ? Math.min(...thermo.map((k) => POLYMER[k].heat_set[1])) : null;

  const vb = (m, unit) => (m.value == null ? null : V(m.value, unit, single ? 'measured' : 'blend', m.covered < 100 ? { covers_pct: round(m.covered) } : undefined));
  return {
    composition: Object.fromEntries(names.map((k) => [k, round(comp[k])])),
    density: V(rho, 'g/cm³', single ? 'measured' : 'blend', single ? undefined : { rule: 'volumes add' }),
    regain: vb(regain, '%'),
    fineness: V(dtex, 'dtex', dBasis, dBasis === 'typical' ? { test: 'micronaire (cotton), vibroscope or the filament count' } : undefined),
    fibre_tex: V(texF, 'tex', dBasis === 'typical' ? 'typical' : 'law'),
    staple: stapleMix == null ? null : +tests.staple_mm > 0 ? V(+tests.staple_mm, 'mm', 'measured') : V(stapleMix, 'mm', 'typical', { test: 'HVI upper-half mean length or a fibrograph' }),
    tensile: { tenacity: ten, breaking_extension: ext, initial_modulus: modulus, wet },
    specific_flexural_rigidity: vb(eta, 'mN·mm²/tex²'), specific_torsional_rigidity: vb(eps, 'mN·mm²/tex²'),
    flexural_rigidity: eta.value == null ? null : V(eta.value * texF * texF, 'mN·mm²', 'law', { rule: 'specific rigidity × fibre tex²' }),
    torsional_rigidity: eps.value == null ? null : V(eps.value * texF * texF, 'mN·mm²', 'law', { rule: 'specific rigidity × fibre tex²' }),
    friction: { fibre_on_fibre: vb(muFF, ''), fibre_on_steel: vb(muSteel, '') },
    recovery: { from_1pct: vb(r1, '%'), from_5pct: vb(r5, '%'), from_10pct: vb(r10, '%') },
    swelling_diameter: vb(sw, '%'),
    thermal: {
      lowest_melting: melts.length ? V(Math.min(...melts.map(([, t]) => t)), '°C', 'measured', { fibre: melts.sort((a, b) => a[1] - b[1])[0][0] }) : null,
      glass_transition: thermo.length ? Object.fromEntries(thermo.map((k) => [k, V(mid(POLYMER[k].tg), '°C', 'typical', { range: POLYMER[k].tg })])) : null,
      heat_set: thermo.length ? (setLo <= setHi ? V((setLo + setHi) / 2, '°C', 'typical', { window: [setLo, setHi] }) : { value: null, unit: '°C', basis: 'typical', note: 'the fibres have no common heat-setting window — set for the most sensitive one' }) : null,
      thermoplastic: thermo.length ? thermo : [],
      note: thermo.length ? null : 'No thermoplastic fibre: dimensions are set by relaxation and compaction, not by heat.',
    },
    unmeasured: [...unmeasured],
  };
}

// ── PART 2: YARN ───────────────────────────────────────────────────────────────────────────────
/**
 * @param spec { count, unit, ply, fibres, spinning, twist: { tpi|tpm|alpha_e }, filaments, waxed,
 *               tests: { rkm_cN_tex, elongation_pct, cvm_pct, thin, thick, neps, hairiness_H, twist_tpm, diameter_mm,
 *                        micronaire, fibre_dtex, staple_mm } }
 */
function yarn(spec) {
  const s = spec || {};
  const unit = String(s.unit || 'ne').toLowerCase();
  if (!UNITS[unit]) throw new MaterialError(`Count unit "${s.unit}" — use Ne, Nm, tex, dtex, denier or Nw.`);
  const c = +s.count;
  if (!(c > 0)) throw new MaterialError('Give the yarn count.');
  const ply = [1, 2, 3, 4].includes(+s.ply) ? +s.ply : 1;
  const texSingle = UNITS[unit](c), tex = texSingle * ply;
  if (tex < 0.5 || tex > 600) throw new MaterialError(`${round(tex)} tex is outside 0.5–600 tex — check the count and the unit.`);
  const t = s.tests || {};
  const spin = s.spinning || (s.filaments ? 'filament' : 'combed');
  if (!PACKING[spin]) throw new MaterialError(`Spinning "${spin}" — one of ${Object.keys(PACKING).join(', ')}.`);
  const fib = fibre(s.fibres || 'cotton', t);
  const rho = fib.density.value;
  const spun = SPUN.has(spin);

  // fibres in the section: the filament count, or yarn tex ÷ fibre tex
  const filaments = +s.filaments > 0 ? Math.round(+s.filaments) * ply : null;
  const texF = filaments ? tex / filaments : fib.fibre_tex.value;
  const nF = filaments || tex / texF;

  // packing and diameter: d = √(4 · tex / (1000 · π · ρ · φ))  (mm; tex in g/km, ρ in g/cm³)
  const phi = PACKING[spin];
  const dLaw = Math.sqrt((4 * tex) / (1000 * Math.PI * rho * phi));
  const diameter = +t.diameter_mm > 0 ? V(+t.diameter_mm, 'mm', 'measured', { packing_implied: round((4 * tex) / (1000 * Math.PI * rho * t.diameter_mm * t.diameter_mm)) }) : V(dLaw, 'mm', 'law', { rule: 'count, fibre density and packing', packing: phi });
  const d = diameter.value;

  // twist: a test wins; else the multiplier knitting yarns are spun at (spun yarns only)
  let tpm = null, twBasis = null;
  if (+t.twist_tpm > 0) { tpm = +t.twist_tpm; twBasis = 'measured'; }
  else if (s.twist && +s.twist.tpm > 0) { tpm = +s.twist.tpm; twBasis = 'measured'; }
  else if (s.twist && +s.twist.tpi > 0) { tpm = +s.twist.tpi * 39.37; twBasis = 'measured'; }
  else if (spun) { const ae = s.twist && +s.twist.alpha_e > 0 ? +s.twist.alpha_e : ALPHA_E[spin]; tpm = ae * Math.sqrt(590.5 / texSingle) * 39.37; twBasis = s.twist && +s.twist.alpha_e > 0 ? 'measured' : 'typical'; }
  const alphaE = tpm ? tpm / 39.37 / Math.sqrt(590.5 / texSingle) : null;
  const angle = tpm ? (Math.atan(Math.PI * d * (tpm / 1000)) * 180) / Math.PI : null;

  // rigidities: between fibres free to slip (n · B_f) and fibres locked into a rod (n² · B_f); at loop curvature
  // the fibres of a spun yarn slip, so the free value is the estimate
  const Bf = fib.flexural_rigidity ? fib.specific_flexural_rigidity.value * texF * texF : null;
  const Cf = fib.torsional_rigidity ? fib.specific_torsional_rigidity.value * texF * texF : null;
  const bend = Bf == null ? null : {
    free: V(nF * Bf, 'mN·mm²', 'bound', { rule: 'fibres free to slip: n × fibre rigidity' }),
    locked: V(nF * nF * Bf, 'mN·mm²', 'bound', { rule: 'fibres locked into one rod: n² × fibre rigidity' }),
    estimate: V(nF * Bf, 'mN·mm²', 'law', { rule: 'at loop curvature the fibres slip — the free value', test: 'a yarn bending test (pure bending or cantilever) to replace it' }),
  };
  const tors = Cf == null ? null : { free: V(nF * Cf, 'mN·mm²', 'bound'), locked: V(nF * nF * Cf, 'mN·mm²', 'bound') };
  // residual torque ∝ torsional rigidity × twist (rad/mm), told against combed 30s cotton at αe 3.5 = 1
  const REF = (() => { const tf = 0.165, n = 19.68 / tf, tw = 3.5 * Math.sqrt(30) * 39.37 / 1000 * 2 * Math.PI; return n * FP.cotton.directional.torsional * tf * tf * tw; })();
  const torque = Cf != null && tpm ? V((nF * Cf * (tpm / 1000) * 2 * Math.PI) / REF, '× combed 30s cotton', 'law', {
    drives: 'spirality in single jersey (with the number of feeders and the twist direction)',
    ...(spin === 'open_end' || spin === 'vortex' ? { note: 'the law is for ring-type twist; rotor and vortex yarns hold their twist in wrapper fibres, so their live torque is lower than this' } : {}),
  }) : null;

  // strength and extension
  const sys = Y.SPINNING_SYSTEMS[spin];
  const phys = Y.blendPhysical(fib.composition);
  let rkm;
  if (+t.rkm_cN_tex > 0) rkm = V(+t.rkm_cN_tex, 'cN/tex', 'measured');
  else if (sys) rkm = V(sys.rkm * (phys.rkm_idx || 1), 'cN/tex', 'typical', { test: 'single-end tensile tester' });
  else if (fib.tensile.tenacity) rkm = V(fib.tensile.tenacity.value * 100 * 0.85, 'cN/tex', 'typical', { rule: 'filament: about 85 % of the fibre tenacity', test: 'single-end tensile tester' });
  const elong = +t.elongation_pct > 0 ? V(+t.elongation_pct, '%', 'measured') : fib.tensile.breaking_extension ? V(fib.tensile.breaking_extension.value * (spun ? 0.8 : 0.95), '%', 'typical', { test: 'single-end tensile tester' }) : null;

  // friction: yarn on yarn from the fibres; on metal, a waxed knitting yarn runs at about 60 % of the bare value
  const waxed = s.waxed != null ? !!s.waxed : spun;
  const muYY = fib.friction.fibre_on_fibre ? V(fib.friction.fibre_on_fibre.value, '', fib.friction.fibre_on_fibre.basis) : null;
  const muYM = fib.friction.fibre_on_steel ? V(fib.friction.fibre_on_steel.value * (waxed ? 0.6 : 1), '', waxed ? 'typical' : fib.friction.fibre_on_steel.basis, waxed ? { rule: 'waxed: about 60 % of the bare value', test: 'yarn-to-metal friction tester' } : undefined) : null;

  // evenness: cotton-system spun yarns from the fibres in the section (limit irregularity × the system's index)
  let even = null;
  if (+t.cvm_pct > 0) even = { cvm: V(+t.cvm_pct, '%', 'measured'), limit: V(100 / Math.sqrt(nF), '%', 'law') };
  else if (spun && U.INDEX_OF_IRREGULARITY[spin]) {
    const lim = 100 / Math.sqrt(nF);
    even = { cvm: V(lim * U.INDEX_OF_IRREGULARITY[spin], '%', 'typical', { rule: 'limit irregularity × the spinning system\'s index', test: 'evenness tester (CVm, thin, thick, neps)' }), limit: V(lim, '%', 'law', { rule: '100 ÷ √(fibres in the section)' }) };
  }
  const hair = +t.hairiness_H > 0 ? V(+t.hairiness_H, 'H', 'measured') : null;

  return {
    count: { tex: V(tex, 'tex', 'law'), ne: V(590.5 / tex, 'Ne', 'law'), nm: V(1000 / tex, 'Nm', 'law'), dtex: V(tex * 10, 'dtex', 'law'), denier: V(tex * 9, 'den', 'law'), ply },
    spinning: spin, fibre: fib,
    fibres_in_section: V(nF, '', filaments ? 'measured' : 'law'),
    packing: +t.diameter_mm > 0 ? V(diameter.packing_implied, '', 'law') : V(phi, '', 'typical', { test: 'a measured yarn diameter (optical) replaces it' }),
    diameter,
    twist: tpm ? { tpm: V(tpm, 'turns/m', twBasis), alpha_e: V(alphaE, 'TPI/√Ne', twBasis), surface_angle: V(angle, '°', 'law', { rule: 'tan θ = π · d · twist' }) } : null,
    bending_rigidity: bend, torsional_rigidity: tors, residual_torque: torque,
    strength: { rkm, breaking_load: rkm ? V((rkm.value * tex) / 100, 'N', 'law') : null, elongation: elong },
    friction: { yarn_on_yarn: muYY, yarn_on_metal: muYM, waxed },
    recovery: fib.recovery,
    evenness: even, hairiness: hair,
    qc: QC_TESTS.filter((q) => q.for === 'yarn' || (q.for === 'cotton' && fib.composition.cotton)),
  };
}

/** What measures each property — the tests a mill already runs, and what they replace here. */
const QC_TESTS = [
  { for: 'cotton', property: 'fibre fineness, length, strength', test: 'HVI (micronaire, upper-half mean length, uniformity, strength g/tex, elongation)', replaces: 'typical fineness and staple' },
  { for: 'yarn', property: 'count', test: 'wrap reel and balance (count CV)', replaces: 'nothing — the count is given' },
  { for: 'yarn', property: 'twist', test: 'twist tester (untwist–retwist)', replaces: 'the typical twist multiplier' },
  { for: 'yarn', property: 'strength and extension', test: 'single-end tensile tester (RKM, elongation, CV)', replaces: 'the spinning system\'s typical RKM' },
  { for: 'yarn', property: 'evenness', test: 'evenness tester (CVm, thin −50 %, thick +50 %, neps +200 %, hairiness H)', replaces: 'the limit irregularity × system index' },
  { for: 'yarn', property: 'diameter', test: 'optical diameter measurement', replaces: 'the typical packing fraction' },
  { for: 'yarn', property: 'friction', test: 'yarn-to-metal friction tester (after waxing)', replaces: 'the waxed rule of thumb' },
];

module.exports = { fibre, yarn, composition, MaterialError, PACKING, ALPHA_E, FINENESS, POLYMER };
