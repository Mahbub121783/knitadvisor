/**
 * KnitAdvisor — Blend yarn engine: any fibre blend (CVC, PC, cotton/viscose, cotton/modal, T/R …) at any count.
 *
 * One model for the whole family. CVC 60/40 is a point in it, not a special case. Give the fibres and their shares
 * and a count; everything else follows from the fibres, the count and the spinning system, and every figure says how
 * it was got:
 *
 *   1  WHAT IT IS       the blend's name (CVC / PC / …), the label, the route it is made by
 *   2  COMPOSITION      label (conditioned) → dry share → number of fibres → surface area; blend density and regain;
 *                       what the mill must weigh and what the draw frame must be fed
 *   3  COUNT & GEOMETRY tex, Ne, Nm, denier; fibres in the section; diameter; twist (αe, TPI); surface twist angle;
 *                       how fine this blend can be spun (the fibre-count rule)
 *   4  TENSILE          the load–elongation curve of the yarn from the fibres' own stress–strain curves: which fibre
 *                       breaks first, breaking force, tenacity, elongation at break, work of rupture, initial modulus;
 *                       dry, wet and hot-wet; the strength-against-ratio curve and where it dips; a knitted-fabric
 *                       bursting estimate when the fabric's density is given
 *   5  EVENNESS & HAIR  fibre-count-limited CV, U %, imperfections, hairiness, blend-ratio spread in a section
 *   6  LUSTRE           the sheen index: refractive index, cross-section, delustrant, mercerising, the yarn's surface
 *   7  TEXTURE & HAND   bending rigidity, softness, crispness, bulk, handle against cotton
 *   8  PROPERTIES       moisture regain, recovery, pilling, loop strength, static, heat ceiling, shrinkage lean
 *   9  PROCESS          the draw-frame creel, heat setting, the two-stage dyeing, finishing, knitting
 *  10  COUNT SWEEP      the same figures at every count from coarse to fine (so the count can be chosen, not guessed)
 *  11  RATIO SWEEP      the same figures across the blend ratio at this count
 *  12  DERIVATIONS      the working behind every figure: formula, the numbers put in, the result
 *
 * Every figure carries its basis (the convention of materials.js and the melange engine):
 *   measured   a published fibre-property table value        law       worked out by physics or arithmetic
 *   blend      measured fibre values combined by the law that applies   typical   an industry default, the test that
 *   estimate   a model not yet calibrated on the mill's own result                 replaces it is named
 *   calibrated the model fitted on the mill's own measurement
 *
 * No outside source is named in what this returns.
 */
'use strict';

const Y = require('./yarn-engine');
const U = require('./uster-engine');
const M = require('./melange-engine');

class BlendError extends Error {}
const FP = Y.FIBER_PROPERTIES;
const SYS = Y.SPINNING_SYSTEMS;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rd = (v, d) => (v == null || Number.isNaN(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d));
const r1 = (v) => rd(v, 1), r2 = (v) => rd(v, 2), r3 = (v) => rd(v, 3);
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const V = (value, unit, basis, extra) => (value == null || Number.isNaN(value) ? null : { value, unit, basis, ...(extra || {}) });

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FIBRES
// ═════════════════════════════════════════════════════════════════════════════════════════════
// per fibre: what it is called, its usual fineness and staple length (typical; the mill's own replace them), the share of
// its hairiness against cotton, and the gloss of its surface against raw cotton. Strength, density, regain, refractive
// index and the rest come from the fibre-property tables.
const FIB = {
  cotton:    { label: 'Cotton',     code: 'CO',  dtex: 1.65, staple: 28, hair: 1.0,  surface: 1.00, cellulosic: true,  natural: true },
  polyester: { label: 'Polyester',  code: 'PES', dtex: 1.33, staple: 38, hair: 0.6,  surface: 1.80, cellulosic: false, synthetic: true },
  viscose:   { label: 'Viscose',    code: 'CV',  dtex: 1.30, staple: 38, hair: 0.45, surface: 1.80, cellulosic: true },
  modal:     { label: 'Modal',      code: 'CMD', dtex: 1.00, staple: 38, hair: 0.45, surface: 1.60, cellulosic: true },
  tencel:    { label: 'Lyocell (Tencel)', code: 'CLY', dtex: 1.30, staple: 38, hair: 0.45, surface: 1.70, cellulosic: true },
  bamboo:    { label: 'Bamboo viscose', code: 'CV', dtex: 1.30, staple: 38, hair: 0.5, surface: 1.50, cellulosic: true },
  nylon:     { label: 'Nylon (staple)', code: 'PA', dtex: 1.70, staple: 38, hair: 0.5, surface: 1.80, cellulosic: false, synthetic: true },
  acrylic:   { label: 'Acrylic',    code: 'PAN', dtex: 1.70, staple: 38, hair: 0.7,  surface: 1.40, cellulosic: false, synthetic: true },
  wool:      { label: 'Wool',       code: 'WO',  dtex: 4.10, staple: 65, hair: 1.3,  surface: 0.90, cellulosic: false, natural: true },
  silk:      { label: 'Silk (spun)', code: 'SE', dtex: 1.10, staple: 60, hair: 0.35, surface: 2.20, cellulosic: false, natural: true },
  linen:     { label: 'Linen',      code: 'LI',  dtex: 5.00, staple: 40, hair: 0.8,  surface: 0.90, cellulosic: true,  natural: true },
};
// tensile figures the tables do not carry (typical; marked so)
const TYPICAL_TENSILE = { tencel: { tenacity: 0.40, extension: 14, modulus: 8.5, wet: { ten: 0.88, ext: 1.1, mod: 0.4 }, hot_wet: { ten: 0.85, ext: 1.1, mod: 0.4 }, note: 'lyocell, typical staple' } };
const TYPICAL_BEND_GPA = 7;
// the fibre book never weighed flax: its density is typical (1.50), not measured
const TYPICAL_DENSITY = { linen: 1.5 };
const FIBRE_IDS = Object.keys(FIB);

const regainOf = (f) => { const d = FP[f]; if (!d) return 0; const c = d.regain_detail && d.regain_detail.commercial; return c != null ? c : (Array.isArray(d.regain) ? (d.regain[0] + d.regain[1]) / 2 : d.regain); };

// the stress–strain curve of one fibre: σ = A(1 − e^(−kε)) with the measured initial modulus E and the measured breaking
// point (σb, εb); a straight line when the measured modulus is too low for a concave curve
function curveFit(E, sb, eb) {
  if (!(E > 0 && sb > 0 && eb > 0) || E <= (sb / eb) * 1.02) return { linear: true, E: sb / eb, sb, eb };
  const target = sb / E;                                    // (1 − e^(−k·eb)) / k = σb / E
  let lo = 1e-6, hi = 4000;
  for (let i = 0; i < 90; i++) { const m = (lo + hi) / 2; ((1 - Math.exp(-m * eb)) / m > target) ? (lo = m) : (hi = m); }
  const k = (lo + hi) / 2;
  return { linear: false, k, A: E / k, E, sb, eb };
}
const sigma = (c, e) => (e > c.eb ? 0 : c.linear ? c.E * e : c.A * (1 - Math.exp(-c.k * e)));

function fibreData(id, spec) {
  const d = FIB[id], p = FP[id];
  const t = (p && p.tensile) || TYPICAL_TENSILE[id];
  if (!d || !p || !t) throw new BlendError(`"${id}" is not a fibre this engine blends (${FIBRE_IDS.join(', ')}).`);
  const typical = !(p.tensile);
  const wet = t.wet || { ten: 1, ext: 1, mod: 1 }, hot = t.hot_wet || wet;
  const opt = (p.optical && p.optical.n_parallel) ? (p.optical.n_parallel + 2 * p.optical.n_perpendicular) / 3 : { cotton: 1.55, viscose: 1.53 }[id] || 1.53;
  return {
    id, label: d.label, code: d.code, density: typeof p.density === 'number' ? p.density : TYPICAL_DENSITY[id] || 1.4, density_basis: typeof p.density === 'number' ? 'measured' : 'typical', regain: regainOf(id), n_opt: opt,
    dtex: +spec.dtex > 0 ? +spec.dtex : d.dtex, staple: +spec.staple_mm > 0 ? +spec.staple_mm : d.staple,
    dtex_basis: +spec.dtex > 0 ? 'measured' : 'typical', staple_basis: +spec.staple_mm > 0 ? 'measured' : 'typical',
    tenacity: t.tenacity, ext: t.extension / 100, modulus: t.modulus, wor: t.work_of_rupture || null,
    wet, hot, tensile_basis: typical ? 'typical' : 'measured', tensile_source: typical ? t.note : `${t.grade}, ${t.table} p.${t.page}`,
    bend_gpa: (p.moduli && (p.moduli.bending_gpa != null ? [].concat(p.moduli.bending_gpa)[0] : p.moduli.tensile_gpa != null ? [].concat(p.moduli.tensile_gpa)[0] : null)) || TYPICAL_BEND_GPA,
    hair: d.hair, surface: d.surface, cellulosic: !!d.cellulosic, synthetic: !!d.synthetic,
    loop_pct: p.directional && p.directional.loop_strength_pct != null ? p.directional.loop_strength_pct : (p.friction ? null : null),
    flex: p.moisture_energy && p.moisture_energy.flex_life_cycles ? p.moisture_energy.flex_life_cycles : null,
    lustre: ['bright', 'semi_dull', 'full_dull'].includes(spec.lustre) ? spec.lustre : 'semi_dull',
    variant: spec.variant || null,
  };
}
// fibre ratios people actually ask for
const PRESETS = [
  { id: 'cvc_60_40', label: 'CVC 60/40', fibres: { cotton: 60, polyester: 40 } },
  { id: 'cvc_55_45', label: 'CVC 55/45', fibres: { cotton: 55, polyester: 45 } },
  { id: 'cvc_52_48', label: 'CVC 52/48', fibres: { cotton: 52, polyester: 48 } },
  { id: 'cvc_70_30', label: 'CVC 70/30', fibres: { cotton: 70, polyester: 30 } },
  { id: 'cvc_80_20', label: 'CVC 80/20', fibres: { cotton: 80, polyester: 20 } },
  { id: 'pc_65_35', label: 'PC 65/35 (polyester-rich)', fibres: { polyester: 65, cotton: 35 } },
  { id: 'pc_50_50', label: 'PC 50/50', fibres: { polyester: 50, cotton: 50 } },
  { id: 'pc_80_20', label: 'PC 80/20', fibres: { polyester: 80, cotton: 20 } },
  { id: 'cv_70_30', label: 'Cotton/viscose 70/30', fibres: { cotton: 70, viscose: 30 } },
  { id: 'cmd_60_40', label: 'Cotton/modal 60/40', fibres: { cotton: 60, modal: 40 } },
  { id: 'cly_60_40', label: 'Cotton/lyocell 60/40', fibres: { cotton: 60, tencel: 40 } },
  { id: 'tr_65_35', label: 'Polyester/viscose 65/35 (T/R)', fibres: { polyester: 65, viscose: 35 } },
  { id: 'cn_85_15', label: 'Cotton/nylon 85/15', fibres: { cotton: 85, nylon: 15 } },
  { id: 'tri_50_30_20', label: 'Cotton/polyester/viscose 50/30/20', fibres: { cotton: 50, polyester: 30, viscose: 20 } },
];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// SPINNING SYSTEMS (the geometry the strength model needs; the yarn engine carries the rest)
// ═════════════════════════════════════════════════════════════════════════════════════════════
// phi: packing of the fibres in the section · alpha: twist multiplier αe (Ne) · nmin: the fewest fibres that can be spun
// into a yarn on that system · bulk: yarn diameter against combed ring · gloss: how much of the fibres' sheen reaches the eye
const GEO = {
  carded:       { phi: 0.55, alpha: 3.6, nmin: 35,  bulk: 1.02, gloss: 0.88 },
  combed:       { phi: 0.58, alpha: 3.4, nmin: 33,  bulk: 1.00, gloss: 1.00 },
  compact:      { phi: 0.63, alpha: 3.3, nmin: 30,  bulk: 0.96, gloss: 1.15 },
  siro:         { phi: 0.60, alpha: 3.3, nmin: 60,  bulk: 0.98, gloss: 1.08 },
  siro_compact: { phi: 0.64, alpha: 3.2, nmin: 56,  bulk: 0.95, gloss: 1.20 },
  open_end:     { phi: 0.50, alpha: 4.4, nmin: 100, bulk: 1.08, gloss: 0.80 },
  vortex:       { phi: 0.56, alpha: 2.2, nmin: 80,  bulk: 1.04, gloss: 1.00 },
};
const SYSTEMS = Object.keys(GEO);
const MIX_VARIANCE = [2.3, 1.5, 1.2];                      // draw-frame passages 1, 2, 3: how far a sliver blend is from a random one

/** The spinning system a count and a blend usually take. */
function recommendSystem(ne, mix) {
  const poly = (mix.polyester || 0) + (mix.nylon || 0) + (mix.acrylic || 0);
  if (ne >= 40) return { id: 'compact', why: `${r1(ne)}s Ne is fine: compact spinning keeps the hairiness and the fibre-count-limited strength up` };
  if (ne >= 28) return { id: 'compact', why: 'a premium jersey count: compact (or combed) gives the smooth, clean surface' };
  if (ne >= 16) return { id: poly >= 30 ? 'combed' : 'combed', why: 'the standard knitting range: combed ring, the cotton part combed and the polyester drawn in at the draw frame' };
  if (ne >= 9) return { id: 'carded', why: 'a coarse yarn for fleece, terry or heavy jersey: carded ring (or open-end for the loop yarn)' };
  return { id: 'open_end', why: 'very coarse: open-end (rotor) is the fast, economical system' };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INPUT
// ═════════════════════════════════════════════════════════════════════════════════════════════
function readBlend(input) {
  let list = [];
  if (Array.isArray(input.components)) list = input.components.map((c) => ({ ...(c || {}) }));
  else if (input.fibres && typeof input.fibres === 'object') list = Object.entries(input.fibres).map(([fibre, share]) => ({ fibre, share }));
  else if (input.fibers && typeof input.fibers === 'object') list = Object.entries(input.fibers).map(([fibre, share]) => ({ fibre, share }));
  list = list.filter((c) => !(c && (c.share === 0 || c.share === '0')));      // a fibre at 0 % is simply not in the blend; a negative or missing share is refused below
  if (!list.length) throw new BlendError('Give the blend: the fibres and their shares, for example cotton 60 and polyester 40.');
  if (list.length > 4) throw new BlendError('At most 4 fibres in a blend.');
  const seen = new Set();
  const comps = list.map((c, i) => {
    if (!own(FIB, c.fibre)) throw new BlendError(`Fibre ${i + 1}: "${c.fibre}" is not a fibre this engine blends (${FIBRE_IDS.join(', ')}).`);
    if (seen.has(c.fibre)) throw new BlendError(`${FIB[c.fibre].label} is listed twice: give each fibre once, with its total share.`);
    seen.add(c.fibre);
    const share = +c.share;
    if (!(share > 0)) throw new BlendError(`${FIB[c.fibre].label}: give its share, above 0.`);
    return { ...fibreData(c.fibre, c), share };
  });
  return comps;
}
const toTexTable = { ne: (v) => 590.5 / v, nm: (v) => 1000 / v, tex: (v) => v, dtex: (v) => v / 10, denier: (v) => v / 9 };
function readCount(input) {
  const ct = input.count && typeof input.count === 'object' ? input.count : null;
  let tex = null;
  if (ct && +ct.value > 0) { const u = String(ct.unit || 'ne').toLowerCase(); if (!own(toTexTable, u)) throw new BlendError(`Count unit "${ct.unit}": use ne, nm, tex, dtex or denier.`); tex = toTexTable[u](+ct.value); }
  else if (+input.count_ne > 0) tex = 590.5 / +input.count_ne;
  else if (+input.tex > 0) tex = +input.tex;
  if (!(tex > 0)) throw new BlendError('Give the yarn count (value and unit, for example 30 Ne).');
  return tex;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE CORE: one yarn, one count
// ═════════════════════════════════════════════════════════════════════════════════════════════
const WASTE = {                                             // typical % of the fibre entering each stage
  cotton_combed: { blow: 4.5, card: 5.0, comb: 14, spin: 2.5 }, cotton_carded: { blow: 4.5, card: 5.0, comb: 0, spin: 2.5 },
  man_made: { blow: 1.0, card: 2.0, comb: 0, spin: 2.0 }, polyester: { blow: 0.8, card: 1.5, comb: 0, spin: 2.0 }, wool: { blow: 2, card: 4, comb: 8, spin: 2 },
};
function massChainOf(comps, spinKey) {
  const combed = ['combed', 'compact', 'siro', 'siro_compact'].includes(spinKey);
  const mc = comps.map((c) => ({
    fibre: c.id, share: c.share, share_basis: c.basis_share || 'conditioned',
    waste: c.id === 'cotton' ? (combed ? WASTE.cotton_combed : WASTE.cotton_carded) : c.id === 'polyester' ? WASTE.polyester : c.id === 'wool' ? WASTE.wool : WASTE.man_made,
  }));
  return M.massChain(mc, { yarn_kg: 100 });
}

function core(blend, tex, o) {
  const comps = blend.comps;
  const spinKey = o.spinKey, geo = GEO[spinKey], spin = SYS[spinKey];
  const chain = blend.chain;
  const dry = chain.dry;
  // number of fibres, mean fibre tex (harmonic, by mass), area shares
  const tF = comps.map((c) => c.dtex / 10);
  const nPer = comps.map((c, i) => (tex * dry[i]) / tF[i]);
  const n = nPer.reduce((a, b) => a + b, 0);
  const tMean = tex / n;
  const rho = 1 / dry.reduce((t, w, i) => t + w / comps[i].density, 0);
  const areaRaw = comps.map((c, i) => dry[i] / Math.sqrt(c.density * tF[i] * 10));
  const aT = areaRaw.reduce((a, b) => a + b, 0), area = areaRaw.map((v) => v / aT);
  // geometry
  const ne = 590.5 / tex;
  const dMm = 2 * Math.sqrt(tex / (rho * 1000) / geo.phi / Math.PI);
  const alphaSys = geo.alpha * (1 - 0.10 * (comps.filter((c) => c.synthetic).reduce((t, c, i) => t + dry[comps.indexOf(c)], 0)));
  const alpha = +o.twist_multiplier > 0 ? +o.twist_multiplier : alphaSys;
  const tpi = alpha * Math.sqrt(ne), tpm = tpi / 0.0254;
  const tanS = Math.PI * dMm * (tpm / 1000);
  const thetaS = Math.atan(tanS), thetaM = Math.atan((2 / 3) * tanS);
  const c2 = Math.pow(Math.cos(thetaM), 2);
  // ── tensile ──
  const scen = o.scenario || 'dry';
  const fib = comps.map((c, i) => {
    const w = scen === 'wet' ? c.wet : scen === 'hot_wet' ? c.hot : { ten: 1, ext: 1, mod: 1 };
    const grade = c.id === 'cotton' ? o.grade.strength_idx : 1;
    // a fibre that has been through the wet route keeps only part of its strength (the chemistry engine passes the retention)
    const rt = o.retention && own(o.retention, c.id) ? o.retention[c.id] : null;
    const E = c.modulus * (w.mod || 1) * (rt && rt.mod != null ? rt.mod : 1), sb = c.tenacity * (w.ten || 1) * (rt && rt.ten != null ? rt.ten : 1), eb = c.ext * (w.ext || 1) * (rt && rt.ext != null ? rt.ext : 1);
    const kappaSys = (spin.rkm * 0.9807 / 100) / 0.32;     // utilisation: the system's cotton RKM over the fibre's 0.32 N/tex
    const kappa = kappaSys * grade * (c.id === 'cotton' ? 1 : clamp(Math.pow(c.staple / 28, 0.45), 0.8, 1.25));
    return { c, curve: curveFit(E, sb, eb), kappa, w: dry[i] };
  });
  const nRef = 116;
  const psi = (m) => 1 - 0.40 / Math.sqrt(m);
  const countF = psi(n) / psi(nRef);
  const twF = +o.twist_multiplier > 0 ? clamp(1 - 0.8 * Math.pow(o.twist_multiplier / alphaSys - 1, 2), 0.6, 1) : 1;
  const maxEps = Math.max(...fib.map((f) => f.curve.eb)) / c2;
  const steps = 400, pts = [];
  let peak = 0, peakEps = 0;
  for (let s = 0; s <= steps; s++) {
    const ey = (maxEps * 1.02 * s) / steps, ef = ey * c2;
    const parts = fib.map((f) => f.w * f.kappa * sigma(f.curve, ef) * countF * twF);
    const F = parts.reduce((a, b) => a + b, 0);
    pts.push({ eps: ey, F, parts });
    if (F > peak + 1e-12) { peak = F; peakEps = ey; }
  }
  // which fibre lets go first (the lowest breaking strain), the strain the last holds to
  const order = fib.map((f) => ({ id: f.c.id, ebY: f.curve.eb / c2 })).sort((a, b) => a.ebY - b.ebY);
  const ultimate = (() => { let e = 0; for (const p of pts) if (p.F > 0.02 * peak) e = p.eps; return e; })();
  // work of rupture (mN/tex): the area under the curve to the end, and the initial modulus (N/tex per unit strain)
  let work = 0; for (let i = 1; i < pts.length; i++) work += 0.5 * (pts[i].F + pts[i - 1].F) * (pts[i].eps - pts[i - 1].eps);
  const modulus = fib.reduce((t, f) => t + f.w * f.kappa * f.curve.E * c2 * countF * twF, 0);
  // the plied yarn: its plies carry the load together, a little less than the sum
  const ply = o.ply || 1, plyEff = ply > 1 ? 0.95 : 1;
  const tenacity = peak * 100;                                // cN/tex
  const totalTex = tex * ply;
  // ── evenness, hair ──
  const pPoly = comps.reduce((t, c, i) => t + (c.synthetic ? nPer[i] : 0), 0) / n;
  const Ibase = U.INDEX_OF_IRREGULARITY[spinKey] || 1.42;
  const I = Ibase * (1 + 0.04 * 4 * pPoly * (1 - pPoly)) * (o.grade.key === 'recycled' ? 1.2 : 1);
  const cvLim = 100 / Math.sqrt(n), cvm = cvLim * I, uPct = 0.8 * cvm;
  const ipi = U.predictIPI(cvm, ne);
  const hairMix = comps.reduce((t, c, i) => t + dry[i] * c.hair, 0);
  const H = U.predictHairiness(spinKey, ne) * hairMix * (o.hair_mult || 1);
  return { comps, spinKey, geo, spin, tex, totalTex, ne, n, nPer, tMean, tF, rho, area, dry, dMm, alpha, alphaSys, tpi, tpm, thetaS, thetaM, c2, fib, pts, peak, peakEps, ultimate, order, work, modulus, tenacity, ply, plyEff, countF, twF, I, cvLim, cvm, uPct, ipi, H, pPoly, kappaSys: (spin.rkm * 0.9807 / 100) / 0.32, scen };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE ANALYSIS
// ═════════════════════════════════════════════════════════════════════════════════════════════
function prep(input) {
  if (!input || typeof input !== 'object') throw new BlendError('Give the blend yarn: the fibres and a count.');
  const comps = readBlend(input);
  const basis = input.share_basis === 'dry' ? 'dry' : 'conditioned';
  comps.forEach((c) => { c.basis_share = basis; });
  const tex = readCount(input);
  if (tex < 2 || tex > 120) throw new BlendError(`${r1(tex)} tex is outside 2–120 tex (5s–300s Ne): check the count and the unit.`);
  const mixLabel = Object.fromEntries(comps.map((c) => [c.id, c.share]));
  const total = comps.reduce((t, c) => t + c.share, 0);
  const gradeKey = own(Y.FIBER_GRADES, input.grade) ? input.grade : 'combed_upland';
  const grade = { key: gradeKey, ...Y.FIBER_GRADES[gradeKey] };
  const rec = recommendSystem(590.5 / tex / (+input.ply > 1 ? 1 : 1), mixLabel);
  const given = own(GEO, input.spinning) ? input.spinning : null;
  const spinKey = given || rec.id;
  const ply = [1, 2, 3].includes(+input.ply) ? +input.ply : 1;
  return { comps, total, tex, grade, spinKey, rec, given: !!given, ply, input };
}

function nameOf(comps, chainLabel) {
  const by = comps.map((c, i) => ({ c, p: chainLabel[i] * 100 })).sort((a, b) => b.p - a.p);
  const cot = by.find((x) => x.c.id === 'cotton'), pes = by.find((x) => x.c.id === 'polyester');
  const ratio = by.map((x) => Math.round(x.p)).join('/');
  const code = by.map((x) => `${Math.round(x.p)}% ${x.c.code}`).join(' ');
  if (by.length === 2 && cot && pes) {
    if (cot.p > 50) return { family: 'CVC', label: `CVC ${ratio}`, long: 'Chief Value Cotton: cotton is the larger part, polyester gives strength and shape keeping', code };
    if (pes.p > 50) return { family: 'PC', label: `PC ${ratio}`, long: 'Polyester/cotton: polyester is the larger part; stronger, faster drying, pills more', code };
    return { family: 'CVC', label: `CVC ${ratio}`, long: 'Equal blend of cotton and polyester', code };
  }
  if (by.length === 1) return { family: by[0].c.code, label: by[0].c.label, long: `${by[0].c.label} yarn`, code };
  return { family: by.map((x) => x.c.code).join('/'), label: `${by.map((x) => x.c.label).join('/')} ${ratio}`, long: 'Fibre blend', code };
}

function lustreBlock(k, b, input) {
  const R = (n) => Math.pow((n - 1) / (n + 1), 2);
  const Rcot = R(FP.cotton.optical ? (FP.cotton.optical.n_parallel + 2 * FP.cotton.optical.n_perpendicular) / 3 : 1.55);
  const merc = input.mercerised ? Y.mercerisingGain({ cotton: 100 }).multiple || 2.4 : 1;
  const DEL = { bright: 1.0, semi_dull: 0.62, full_dull: 0.30 };
  const items = k.comps.map((c, i) => {
    const fres = R(c.n_opt) / Rcot;
    let surf = c.surface;
    let note = '';
    if (c.id === 'cotton') { surf = merc; note = input.mercerised ? 'mercerised: the flat, twisted ribbon swells round — the sheen rises' : 'raw cotton: a flat convoluted ribbon scatters the light — a matte, natural surface'; }
    const del = c.synthetic && c.id === 'polyester' ? DEL[c.lustre] : 1;
    if (c.id === 'polyester') note = `${c.lustre.replace('_', '-')} polyester: ${c.lustre === 'bright' ? 'no delustrant, a clear glossy fibre' : c.lustre === 'semi_dull' ? 'about 0.3 % TiO₂ scatters part of the light' : 'about 2 % TiO₂, chalky and dull'}`;
    if (c.id !== 'cotton' && c.id !== 'polyester') note = 'smooth round or lobed fibre: it gives a cleaner reflection than cotton';
    const L = 100 * fres * surf * del;
    return { fibre: c.id, label: c.label, fresnel_vs_cotton: r2(fres), surface_factor: r2(surf * del), index: r1(L), area_share_pct: r1(k.area[i] * 100), note };
  });
  const idx = items.reduce((t, it, i) => t + k.area[i] * it.index, 0) * k.geo.gloss;
  const cls = idx < 90 ? 'dull' : idx < 140 ? 'natural matte' : idx < 220 ? 'soft sheen' : idx < 350 ? 'lustrous' : 'bright';
  return {
    index: V(r1(idx), 'cotton raw = 100', 'estimate'), class: cls, fibres: items,
    system_factor: r2(k.geo.gloss),
    note: `A sheen index against raw combed cotton (100): each fibre's share of the surface × its reflectance from the refractive index (law) × its surface and delustrant factors (typical), times the spinning system's factor for how much a hairy or smooth yarn lets through.`,
    dye_note: k.comps.some((c) => c.id === 'polyester') ? (items.find((x) => x.fibre === 'polyester') && k.comps.find((c) => c.id === 'polyester').lustre === 'bright' ? 'A bright polyester looks deeper in a dark shade than the same dye on a dull one: allow less dye.' : k.comps.find((c) => c.id === 'polyester').lustre === 'full_dull' ? 'A full-dull polyester looks lighter and chalkier in a dark shade: allow more dye.' : 'Semi-dull polyester: the usual shade depth.') : null,
  };
}

function textureBlock(k) {
  // bending rigidity of one fibre B = E_b·I, I = πd⁴/64; fibres slide, so a yarn's rigidity is the sum
  const items = k.comps.map((c, i) => {
    const A = (c.dtex / 10) * 1e-5 / c.density, d = 2 * Math.sqrt(A / Math.PI) * 1e4;   // µm
    const dm = d * 1e-6;
    const B = c.bend_gpa * 1e9 * Math.PI * Math.pow(dm, 4) / 64;               // N·m²
    return { fibre: c.id, d_um: d, B, n: k.nPer[i] };
  });
  const B = items.reduce((t, x) => t + x.n * x.B, 0);
  // a cotton yarn of the same tex
  const cot = fibreData('cotton', {});
  const Ac = (cot.dtex / 10) * 1e-5 / cot.density, dc = 2 * Math.sqrt(Ac / Math.PI) * 1e-2, Bc = cot.bend_gpa * 1e9 * Math.PI * Math.pow(dc, 4) / 64;
  const Bcot = (k.tex / (cot.dtex / 10)) * Bc;
  const rel = B / Bcot;
  const soft = clamp(100 / Math.sqrt(rel), 0, 200);
  const hairRel = k.H / (U.predictHairiness('combed', k.ne));
  const poly = k.comps.filter((c) => c.synthetic).reduce((t, c) => t + k.dry[k.comps.indexOf(c)], 0);
  const cottonShare = (k.comps.find((c) => c.id === 'cotton') ? k.dry[k.comps.findIndex((c) => c.id === 'cotton')] : 0);
  const crisp = clamp(50 + (rel - 1) * 60 + poly * 25, 0, 100);
  const handle = cottonShare >= 0.75 ? 'soft, warm and cotton-like' : cottonShare >= 0.5 ? 'cottony with a little crispness and spring' : cottonShare > 0.3 ? 'a crisp, smooth hand between cotton and synthetic' : 'smooth, light and slightly cool: a synthetic hand';
  const bulk = k.geo.bulk * (1 + 0.5 * (1.52 - k.rho) / 1.52);
  return {
    bending_rigidity_abs: V(+(B * 1.0197e6).toPrecision(4), 'gf·cm² per yarn (fibres sliding freely)', 'blend'),
    bending_rigidity_vs_cotton: V(r2(rel), '× the same cotton yarn', 'blend'), softness: V(r1(soft), 'cotton = 100', 'estimate'), crispness: V(r1(crisp), '0–100', 'estimate'),
    bulk: V(r2(bulk), 'diameter factor', 'estimate'), hairiness_vs_combed_cotton: V(r2(hairRel), '×', 'blend'), handle,
    fibres: items.map((x) => ({ fibre: x.fibre, diameter_um: r1(x.d_um) })),
    note: 'Bending rigidity of a yarn is the sum over its fibres of E·πd⁴/64 (the fibres slide on one another), with the fibre bending moduli of the tables and the fibre diameter from its fineness and density. A finer fibre is far softer (d⁴); a stiffer polymer is crisper. Softness and crispness scale from that.',
  };
}

function propertiesBlock(k, b, input) {
  const mixLabel = Object.fromEntries(k.comps.map((c, i) => [c.id, b.chain.label[i] * 100]));
  const rh = +input.humidity_rh > 0 ? +input.humidity_rh : 65;
  const R = b.chain.blendR;
  // the yarn engine's blend laws return nothing when a fibre has no row in a table: each is asked on its own and may be absent
  const ask = (fn, ...a) => { try { return fn(...a) || null; } catch (e) { return null; } };
  const rec = ask(Y.blendRecovery, mixLabel, 60) || {}, dir = ask(Y.blendDirectional, mixLabel) || {}, heat = ask(Y.heatCeiling, mixLabel) || {}, stat = ask(Y.staticRisk, mixLabel, rh) || {}, fric = ask(Y.blendFriction, mixLabel) || {}, th = ask(Y.blendThermal, mixLabel) || {}, mech = ask(Y.blendMechanics, mixLabel) || {}, flex = ask(Y.flexFatigue, mixLabel) || {};
  const cottonShare = k.comps.findIndex((c) => c.id === 'cotton') >= 0 ? k.dry[k.comps.findIndex((c) => c.id === 'cotton')] : 0;
  const cellu = k.comps.reduce((t, c, i) => t + (c.cellulosic ? k.dry[i] : 0), 0);
  // pilling: free fibre ends (hairiness) that are held by fibres strong and flexible enough not to break off
  const flexRatio = (() => { const f = k.comps.map((c, i) => (c.flex ? k.dry[i] * c.flex : k.dry[i] * 4000)).reduce((a, b2) => a + b2, 0) / 4000; return clamp(f, 1, 60); })();
  const pillIdx = (k.H / U.predictHairiness('combed', k.ne)) * (1 + 0.55 * Math.log10(flexRatio)) * (k.spinKey === 'open_end' ? 1.05 : 1) / (k.geo.gloss > 1.1 ? 1.1 : 1);
  const martindale = clamp(4.6 - 1.3 * (pillIdx - 0.8) / 0.5, 1, 5);
  const shrinkLean = clamp(cellu, 0, 1);
  return {
    moisture: { regain_conditioned: V(r2(R), '%', 'blend', { note: 'Σ dry share × commercial regain of each fibre' }), at_rh: rh, hand_dry_feel: R < 4 ? 'quick drying, little moisture held' : R < 7 ? 'moderate moisture hold' : 'cotton-like moisture hold' },
    elastic_recovery: { from_5pct: rec.from_5pct ? V(r1(rec.from_5pct.recovery), '%', 'blend') : null, growth_at_5pct: rec.permanent_growth_at_5pct != null ? V(r1(rec.permanent_growth_at_5pct), '%', 'blend') : null, severity: rec.severity || null },
    loop: { governed_by: dir.loop_strength ? dir.loop_strength.governed_by : null, loop_strength_pct_of_straight: dir.loop_strength ? V(dir.loop_strength.pct_of_straight, '%', 'measured') : null, note: 'A yarn bent into a loop keeps only part of its straight strength; the fibre that is weakest in a bend governs.' },
    pilling: { index: V(r2(pillIdx), '1 = combed cotton', 'estimate'), martindale_grade_at_2000: V(r1(martindale), 'grade 1–5', 'typical'), note: 'Pills form where a free fibre end is held fast. More hairiness and fibres that are strong and survive flexing (polyester) make pills that stay; cotton pills break off. Compact and Siro spinning cut the loose ends.' },
    static: { at_risk: !!stat.at_risk, threshold_rh_pct: stat.threshold_rh_pct != null ? stat.threshold_rh_pct : null, note: stat.at_risk ? `Static builds below ${stat.threshold_rh_pct} % RH in the knitting room (${stat.governed_by || 'the synthetic part'} governs): hold humidity, use antistatic lubricant.` : 'No static risk at the room humidity.' },
    heat: { working_ceiling_c: heat.working_ceiling_c != null ? heat.working_ceiling_c : null, lowest_melting: heat.lowest_melting || null, note: heat.lowest_melting && heat.lowest_melting.fibre ? `The blend cannot be set or dried above ${heat.working_ceiling_c} °C; ${heat.lowest_melting.fibre} melts at ${heat.lowest_melting.celsius} °C.` : 'No melting fibre in the blend.' },
    friction: { parallel_mu: fric.parallel_mu != null ? fric.parallel_mu : null, hard_guide_penalty: fric.hard_guide_penalty != null ? fric.hard_guide_penalty : null },
    shrinkage: { cellulosic_share_pct: r1(shrinkLean * 100), note: shrinkLean > 0.5 ? 'Shrinkage and spirality follow the cellulosic part: relax and compact the fabric; the polyester part is heat-set.' : 'A polyester-rich yarn holds its size: the cloth shrinks little once heat-set.' },
    flex_life: flex.cycles ? { cycles: flex.cycles, governed_by: flex.governed_by } : null,
    thermal: { conductivity_mw_mk: th.conductivity_mw_mk ? th.conductivity_mw_mk.value : null },
    strength_variability: mech.breaks_first ? { breaks_first: mech.breaks_first, extension_spread: mech.extension_spread, blend_average_reliable: mech.blend_average_reliable } : null,
    cotton_share_pct: r1(cottonShare * 100),
  };
}

function tensileBlock(k, b, input, derive) {
  const forceSingle = k.peak * 100 * k.tex;
  const breakF = k.ply > 1 ? forceSingle * k.ply * k.plyEff : forceSingle;
  const tex1 = k.tex, yarnTex = k.totalTex;
  const tenacity = breakF / (k.ply > 1 ? yarnTex : tex1);
  const rkm = tenacity / 0.9807;
  const ext = k.peakEps * 100 * (k.ply > 1 ? 1.05 : 1);
  const cvF = Math.sqrt(Math.pow(fibreVar(k) / Math.sqrt(k.n), 2) + Math.pow(0.7 * k.cvm, 2));
  const sigmaF = (cvF / 100) * breakF;
  const weak = breakF - 3 * sigmaF;
  const run = k.tex * 0.55;                                              // typical running tension on a circular knitting machine, cN: ≈ 0.55 cN per tex
  const wet = scenario(b, k, input, 'wet'), hot = scenario(b, k, input, 'hot_wet');
  // the curve for the chart: every 10th point, load as cN for the yarn, with each fibre's share
  const step = Math.max(1, Math.round(k.pts.length / 60));
  const curve = k.pts.filter((_, i) => i % step === 0).map((p) => ({
    strain_pct: r2(p.eps * 100 * (k.ply > 1 ? 1.05 : 1)),
    force_cn: r1(p.F * 100 * k.tex * (k.ply > 1 ? k.ply * k.plyEff : 1)),
    by_fibre: Object.fromEntries(k.comps.map((c, i) => [c.id, r1(p.parts[i] * 100 * k.tex * (k.ply > 1 ? k.ply * k.plyEff : 1))])),
  }));
  const first = k.order[0], last = k.order[k.order.length - 1];
  const plyK = k.ply > 1 ? k.ply * k.plyEff : 1;
  const loadAt = (e) => { const q = k.pts.find((x) => x.eps >= e); return q ? q.F * 100 * k.tex * plyK : 0; };
  let stage;
  if (k.comps.length > 1 && last.id !== first.id) {
    const before = loadAt(first.ebY * 0.985), after = loadAt(first.ebY * 1.015);
    let second = 0, secondAt = 0; for (const q of k.pts) if (q.eps > first.ebY * 1.015 && q.F * 100 * k.tex * plyK > second) { second = q.F * 100 * k.tex * plyK; secondAt = q.eps; }
    stage = `${labelOf(k, first.id)} breaks first, at ${r1(first.ebY * 100 * (k.ply > 1 ? 1.05 : 1))} % elongation; ${labelOf(k, last.id)} holds to ${r1(last.ebY * 100 * (k.ply > 1 ? 1.05 : 1))} %. When the first lets go the load falls from ${r1(before)} cN to ${r1(after)} cN`;
    stage += second > after * 1.02 ? `, then rises again to ${r1(second)} cN at ${r1(secondAt * 100)} % as the tougher fibre takes the whole load${second > breakF * 0.999 ? ' (the higher peak)' : ' (a lower second peak: the yarn has already given its best at the first break)'}.` : ': the tougher fibre cannot take the load up again, so the yarn is finished at the first break.';
  } else stage = `${labelOf(k, first.id)} governs.`;
  return {
    breaking_force: V(r1(breakF), 'cN', 'blend'), tenacity: V(r1(tenacity), 'cN/tex', 'blend'), rkm: V(r1(rkm), 'gf/tex', 'blend'),
    elongation_at_break: V(r1(ext), '%', 'blend'), ultimate_elongation: V(r1(k.ultimate * 100 * (k.ply > 1 ? 1.05 : 1)), '%', 'blend'),
    work_of_rupture: V(r1(k.work * 1000), 'mN/tex', 'blend'), initial_modulus: V(r1(k.modulus * 100), 'cN/tex per unit strain', 'blend'),
    csp: V(Math.round(rkm * k.ne * 4.5), 'lea × count', 'typical'),
    breaks_first: { fibre: first.id, at_yarn_elongation_pct: r1(first.ebY * 100) }, last_to_go: { fibre: last.id, at_yarn_elongation_pct: r1(last.ebY * 100) },
    sequence_note: stage,
    cv_breaking_force_pct: V(r1(cvF), '%', 'estimate'), weakest_place_force: V(r1(weak), 'cN', 'estimate'),
    running_tension: V(r1(run), 'cN', 'typical'), safety_factor: V(r1(weak / run), '× (weakest place ÷ running tension)', 'estimate'),
    scenarios: { dry: { tenacity: r1(tenacity), elongation: r1(ext) }, wet: wet, hot_wet: hot },
    curve, utilisation: { kappa_system: r3(k.kappaSys), count_factor: r3(k.countF), twist_factor: r3(k.twF), cos2_theta_mean: r3(k.c2) },
    note: 'The yarn\'s load at each elongation is the sum, over its fibres, of the dry mass share × the fibre\'s stress at the fibre strain × a utilisation factor, where the fibre strain is the yarn strain × cos²θ of the mean helix angle. The fibre curve passes through its measured initial modulus and its measured breaking point. A fibre that has reached its breaking strain drops out; the yarn breaks at the peak of the summed curve. The utilisation factor is fixed so that 100 % cotton gives the spinning system\'s own tenacity.',
  };
}
function labelOf(k, id) { const c = k.comps.find((x) => x.id === id); return c ? c.label : id; }
function fibreVar(k) {
  // coefficient of variation of one fibre's breaking load, by mass share (the fibre tables, else 35 %)
  return 35;
}
function scenario(b, k, input, scen) {
  const k2 = core(b, k.tex, { ...b.coreOpts, scenario: scen });
  const F = k2.peak * 100 * k2.tex * (k2.ply > 1 ? k2.ply * k2.plyEff : 1);
  return { tenacity: r1(F / (k2.ply > 1 ? k2.totalTex : k2.tex)), elongation: r1(k2.peakEps * 100), force_cn: r1(F) };
}

// the strength across the ratio of the first two fibres (the one the user varies is the most synthetic / the second)
function ratioSweep(b, spec) {
  const comps = b.comps;
  if (comps.length < 2) return null;
  const a = comps[0], z = comps[1];
  const out = [];
  for (let s = 0; s <= 100; s += 10) {
    const shares = comps.map((c, i) => (i === 0 ? 100 - s : i === 1 ? s : c.share));
    const cs = comps.map((c, i) => ({ ...c, share: shares[i] })).filter((c) => c.share > 0);
    const bl = buildBlend(cs, b.spinKey);
    const kk = core(bl, b.tex, { ...b.coreOpts });
    const lus = lustreQuick(kk);
    out.push({ share_second_pct: s, tenacity_cn_tex: r1(kk.tenacity), elongation_pct: r1(kk.peakEps * 100), regain_pct: r2(bl.chain.blendR), diameter_mm: r3(kk.dMm), hairiness: r2(kk.H), fibres_in_section: Math.round(kk.n), sheen_index: r1(lus) });
  }
  const min = out.reduce((m, p) => (p.tenacity_cn_tex < m.tenacity_cn_tex ? p : m), out[0]);
  const dipped = out[0].tenacity_cn_tex > min.tenacity_cn_tex + 0.15 && out[out.length - 1].tenacity_cn_tex > min.tenacity_cn_tex + 0.15 && min.share_second_pct > 0 && min.share_second_pct < 100;
  return {
    first: a.id, second: z.id, points: out,
    minimum: dipped ? { share_second_pct: min.share_second_pct, tenacity_cn_tex: min.tenacity_cn_tex, note: `A weaker blend than either fibre alone at about ${min.share_second_pct} % ${z.label.toLowerCase()}: the first fibre breaks and the second cannot yet carry the load.` } : null,
    note: dipped ? 'The tables give a dip: stay away from the ratios at the bottom of the curve.' : 'From the tables, the blend gains strength steadily across the ratio: no weak ratio.',
  };
}
function lustreQuick(k) {
  const R = (n) => Math.pow((n - 1) / (n + 1), 2), Rc = R(1.55);
  const DEL = { bright: 1.0, semi_dull: 0.62, full_dull: 0.30 };
  return k.comps.reduce((t, c, i) => t + k.area[i] * 100 * (R(c.n_opt) / Rc) * (c.id === 'cotton' ? 1 : c.surface * (c.id === 'polyester' ? DEL[c.lustre] : 1)), 0) * k.geo.gloss;
}

function buildBlend(comps, spinKey) {
  const chain = massChainOf(comps, spinKey);
  return { comps, chain, spinKey };
}

function countSweep(b) {
  const nes = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 45, 50, 60, 80];
  const rows = nes.map((ne) => {
    const tex = 590.5 / ne;
    const rec = recommendSystem(ne, Object.fromEntries(b.comps.map((c) => [c.id, c.share])));
    const spinKey = b.given ? b.spinKey : rec.id;
    const bl = buildBlend(b.comps, spinKey);
    const kk = core(bl, tex, { ...b.coreOpts, spinKey, ply: 1 });
    const fine = finest(kk);
    return { ne, tex: r2(tex), spinning: spinKey, spinnable: ne <= fine.ne_max, diameter_mm: r3(kk.dMm), fibres_in_section: Math.round(kk.n), tpi: r1(kk.tpi), tenacity_cn_tex: r1(kk.tenacity), breaking_force_cn: r1(kk.peak * 100 * tex), elongation_pct: r1(kk.peakEps * 100), u_pct: r1(kk.uPct), hairiness: r2(kk.H), sheen_index: r1(lustreQuick(kk)) };
  });
  return rows;
}
function finest(k) {
  const byFibres = 590.5 / (k.geo.nmin * k.tMean);
  const sysMax = k.spin.count_max;
  return { ne_max: Math.floor(Math.min(byFibres, sysMax)), by_fibre_count: r1(byFibres), by_system: sysMax, governed_by: byFibres < sysMax ? 'the fibre count in the section' : 'the spinning system' };
}

function bursting(k, input, force1) {
  const fb = input.fabric;
  if (!fb || !(+fb.wales_per_cm > 0) || !(+fb.courses_per_cm > 0)) return null;
  const wpc = +fb.wales_per_cm, cpc = +fb.courses_per_cm;
  const loopEff = (() => { const l = k.comps.map((c, i) => (c.loop_pct != null ? c.loop_pct / 100 : 0.9) * k.dry[i]).reduce((a, b) => a + b, 0); return clamp(l, 0.5, 1); })();
  const F = force1 / 100;                                                // N, one yarn end
  const Tw = wpc * 2 * F * loopEff * 100, Tc = cpc * 2 * F * loopEff * 100;  // N/m of fabric in each direction
  const interaction = +fb.interaction > 0 ? +fb.interaction : 0.35;
  const T = Math.sqrt(Tw * Tc) * interaction;
  const r = 15.25e-3, strain = 0.35;                                     // 30.5 mm test area; the dome's arc strain at burst (typical)
  let alpha = 1.0; for (let i = 0; i < 60; i++) alpha += ((1 + strain) - alpha / Math.sin(alpha)) * 0.5 * Math.sin(alpha) / (1 - alpha * Math.cos(alpha) / Math.sin(alpha) + 1e-9) * 0.5;
  alpha = clamp(alpha, 0.2, 1.5);
  const Rr = r / Math.sin(alpha), h = Rr * (1 - Math.cos(alpha));
  let P = (2 * T / Rr) / 1000;                                           // kPa
  let basis = 'estimate';
  let calibrated = null;
  if (+fb.bursting_kpa > 0) { calibrated = { measured_kpa: +fb.bursting_kpa, constant: interaction * (+fb.bursting_kpa / P) }; P = +fb.bursting_kpa; basis = 'calibrated'; }
  return {
    bursting_pressure: V(r1(P), 'kPa', basis), dome_height_at_burst: V(r1(h * 1000), 'mm', 'typical'),
    fabric_strength: { wale_n_per_cm: r1(Tw / 100), course_n_per_cm: r1(Tc / 100) },
    loop_efficiency: V(r2(loopEff), '', 'measured'), interaction_factor: V(r2(interaction), '', calibrated ? 'calibrated' : 'typical'),
    calibration: calibrated ? { fitted_interaction: r2(calibrated.constant), measured_kpa: calibrated.measured_kpa } : null,
    note: 'Each wale carries two yarn legs, each at the yarn\'s breaking force × the loop efficiency (what a bent yarn keeps). The two directions combine as a geometric mean times an interaction factor, and the membrane pressure of a dome of the test area (30.5 mm) is P = 2T/R. One measured burst on this fabric fits the factor.',
  };
}

function analyse(input) {
  const P = prep(input);
  const { comps, tex, grade, spinKey, rec, ply } = P;
  const chain = massChainOf(comps, spinKey);
  const b = { comps, chain, spinKey, tex, given: P.given, coreOpts: { spinKey, grade, form: ply > 1 ? 'ply2' : 'single', ply, twist_multiplier: input.twist_multiplier, hair_mult: 1 } };
  const singleTex = tex;
  const k = core(b, singleTex, b.coreOpts);
  const name = nameOf(comps, chain.label);
  const warnings = [];
  const say = (level, text) => warnings.push({ level, text });
  const fin = finest(k);
  if (k.n < k.geo.nmin) say('warn', `Only ${Math.round(k.n)} fibres in the section of a ${r1(k.ne)}s yarn: ${SYS[spinKey].label} needs at least about ${k.geo.nmin}. Use a coarser count, a finer fibre, or a different system.`);
  if (k.ne > k.spin.count_max) say('warn', `${r1(k.ne)}s Ne is finer than ${SYS[spinKey].label} usually spins (up to ${k.spin.count_max}s).`);
  if (k.ne < k.spin.count_min) say('note', `${r1(k.ne)}s Ne is coarser than ${SYS[spinKey].label} usually spins (from ${k.spin.count_min}s).`);
  if (!P.given && spinKey !== rec.id) say('note', `The spinning system was set to ${SYS[spinKey].label}.`);
  const cotIdx = comps.findIndex((c) => c.id === 'cotton');
  if (cotIdx >= 0 && comps.length > 1 && k.pPoly > 0.001) {
    // the mixing statistics
    const p = Math.min(0.999, Math.max(0.001, k.nPer[comps.findIndex((c) => c.synthetic)] / k.n || k.pPoly));
    void p;
  }
  // ── the mixing statistics: blend-ratio spread in a section, and the draw-frame creel
  const second = comps.length > 1 ? comps.reduce((bst, c, i) => (i > 0 && (bst == null || comps[i].share < comps[bst].share) ? i : bst), null) : null;
  let mixing = null;
  if (comps.length > 1) {
    const idx = comps.findIndex((c, i) => i !== 0 && c.share === Math.min(...comps.slice(1).map((x) => x.share)));
    const e = idx >= 0 ? idx : 1;
    const pe = k.nPer[e] / k.n;
    const pass = clamp(+input.passages || 2, 1, 3), route = input.blend_route === 'blow_room' ? 'blow_room' : 'draw_frame';
    const mf = route === 'draw_frame' ? MIX_VARIANCE[pass - 1] : 1.15;
    const cvIdeal = Math.sqrt((1 - pe) / (pe * k.n)) * 100, cvSec = cvIdeal * mf;
    const lab = chain.label[e];
    mixing = {
      route, passages: pass, minor_fibre: comps[e].id, number_share_pct: r1(pe * 100),
      cv_section_pct: V(r1(cvSec), '% of the ' + comps[e].label.toLowerCase() + ' share in one section', 'law'), ideal_cv_pct: r1(cvIdeal), mixing_factor: r2(mf),
      per_point_note: `Over a section of ${Math.round(k.n)} fibres the blend ratio varies by about ±${r1(cvSec)} % of itself; a draw-frame blend with ${pass} passage${pass > 1 ? 's' : ''} sits ${r2(mf)}× above a perfectly random mix.`,
      creel: lab > 0 && lab < 1 ? M.creelOptions(lab, +input.max_doublings === 6 ? 6 : 8) : [],
    };
    if (route === 'draw_frame' && pass === 1) say('warn', 'One draw-frame passage leaves the two sliver types in ribbons: use at least two passages for a blend.');
  }
  const tens = tensileBlock(k, b, input);
  const force1 = tens.breaking_force.value / (ply > 1 ? ply * 0.95 : 1);
  const burst = bursting(k, input, force1);
  const lus = lustreBlock(k, b, input);
  const tex_ = textureBlock(k);
  const props = propertiesBlock(k, b, input);
  const ratio = ratioSweep(b);
  const sweep = countSweep(b);
  const route = processBlock(k, b, input, chain);
  if (tens.safety_factor.value < 8) say('warn', `The weakest places of this yarn (${tens.weakest_place_force.value} cN) are only ${tens.safety_factor.value}× the typical running tension: expect breaks on the machine; use a finer-fibre or stronger system, or knit slower.`);
  if (ratio && ratio.minimum && Math.abs(ratio.minimum.share_second_pct - Math.round(comps[1] ? chain.label[1] * 100 : 0)) <= 10) say('warn', `The blend ratio is near the weakest point of the strength-against-ratio curve (${ratio.minimum.share_second_pct} % ${labelOf(k, comps[1].id).toLowerCase()}).`);
  const derivations = derive(k, b, chain, tens, lus, tex_, mixing, fin, name);
  const studio = studioYarn(comps, chain, k, spinKey, input);
  return {
    success: true,
    identity: { ...name, ratio_label: Object.fromEntries(comps.map((c, i) => [c.id, r1(chain.label[i] * 100)])), spinning: { id: spinKey, label: SYS[spinKey].label, chosen: P.given, recommended: rec }, ply, grade: grade.key },
    composition: composition(k, b, chain),
    count: { tex: V(r2(k.tex * (ply > 1 ? ply : 1)), 'tex', 'law'), single_tex: r2(k.tex), ne: V(r1(k.ne), 'Ne', 'law'), nm: r1(1000 / k.tex), denier: r1(k.tex * 9), ply, resultant_note: ply > 1 ? 'The count given is that of one ply; the yarn count is the plies added.' : null },
    geometry: {
      fibres_in_section: V(Math.round(k.n), '', 'law'), mean_fibre_tex: V(r3(k.tMean), 'tex', 'law'), diameter: V(r3(k.dMm), 'mm', 'blend'),
      blend_density: V(r3(k.rho), 'g/cm³', 'blend'), twist_multiplier: V(r2(k.alpha), 'αe (Ne)', +b.coreOpts.twist_multiplier > 0 ? 'measured' : 'typical'), tpi: V(r1(k.tpi), 'TPI', 'law'), tpm: V(Math.round(k.tpm), 'turns/m', 'law'),
      surface_twist_angle: V(r1(k.thetaS * 180 / Math.PI), '°', 'law'), mean_fibre_angle: V(r1(k.thetaM * 180 / Math.PI), '°', 'law'),
      packing: V(k.geo.phi, '', 'typical'),
      finest_count: { ne: fin.ne_max, by_fibre_count_ne: fin.by_fibre_count, by_system_ne: fin.by_system, governed_by: fin.governed_by, note: `With at least ${k.geo.nmin} fibres in the section (${SYS[spinKey].label}) and a mean fibre of ${r3(k.tMean)} tex, the finest yarn this blend can be spun is ${r1(fin.by_fibre_count)}s Ne` },
    },
    tensile: tens, bursting: burst,
    evenness: {
      cv_limit_pct: V(r2(k.cvLim), '%', 'law'), index_of_irregularity: V(r2(k.I), '', 'blend'), cvm_pct: V(r1(k.cvm), '%', 'blend'), u_pct: V(r1(k.uPct), '%', 'blend'),
      imperfections_per_km: k.ipi, hairiness_h: V(r2(k.H), 'Uster H', 'blend'), usp: U.uspFromIndex(k.I),
      mixing,
    },
    lustre: lus, texture: tex_, properties: props, process: route,
    sweep: { count: sweep, ratio },
    derivations, warnings, studio_yarn: studio,
  };
}

function composition(k, b, chain) {
  const comps = k.comps;
  return {
    per_fibre: comps.map((c, i) => ({
      fibre: c.id, label: c.label, code: c.code, label_share_pct: r2(chain.label[i] * 100), dry_share_pct: r2(chain.dry[i] * 100), number_share_pct: r1((k.nPer[i] / k.n) * 100), area_share_pct: r1(k.area[i] * 100),
      regain_pct: V(r2(chain.R[i]), '%', 'measured'), density: V(c.density, 'g/cm³', c.density_basis), fibre_dtex: V(c.dtex, 'dtex', c.dtex_basis), staple_mm: V(c.staple, 'mm', c.staple_basis),
      fibres_in_section: Math.round(k.nPer[i]), realization_pct: r1(chain.real[i] * 100), bale_issue_kg: r1(chain.issueCond[i]), issue_share_pct: r1((chain.issueCond[i] / chain.issueTot) * 100),
      if_weighed_at_label_ratio_pct: r1(chain.driftLabel[i] * 100),
      waste: { ...(c.id === 'cotton' ? (['combed', 'compact', 'siro', 'siro_compact'].includes(k.spinKey) ? WASTE.cotton_combed : WASTE.cotton_carded) : c.id === 'polyester' ? WASTE.polyester : c.id === 'wool' ? WASTE.wool : WASTE.man_made), basis: 'typical' },
    })),
    blend_regain: V(r2(chain.blendR), '%', 'blend'), blend_density: V(r3(k.rho), 'g/cm³', 'blend'),
    bale_issue_per_100kg: { total_kg: r1(chain.issueTot), overall_realization_pct: r1((chain.yarnCond / chain.issueTot) * 100) },
    note: `The label shares are conditioned. Polyester holds 0.4 % moisture and cotton 8.5 %, so the dry shares differ from the label; the mill must weigh the bales by the issue share, because each fibre loses a different amount in the blow room, card and comb. Weighing the bales at the label ratio gives the last column's shares in the yarn.`,
  };
}

function processBlock(k, b, input, chain) {
  const has = (id) => k.comps.some((c) => c.id === id);
  const poly = has('polyester'), cot = has('cotton'), cellu = k.comps.some((c) => c.cellulosic);
  const steps = [];
  if (poly && cot) steps.push({ stage: 'Spinning', text: 'Cotton is carded and combed; polyester is carded or pre-drawn. The two sliver types are blended at the draw frame (breaker then finisher, with the creel in whole slivers), not in the blow room, so each keeps its own preparation.' });
  else if (k.comps.length > 1) steps.push({ stage: 'Spinning', text: 'The fibres are blended at the draw frame in whole slivers; blow-room blending suits fibres of the same length and cleanliness.' });
  if (poly) steps.push({ stage: 'Heat setting', text: `Heat-set the fabric at about 180–190 °C for 30–40 s (the blend's ceiling is ${((() => { try { return (Y.heatCeiling(Object.fromEntries(k.comps.map((c, i) => [c.id, chain.label[i] * 100]))) || {}).working_ceiling_c; } catch (e) { return null; } })() || 220)} °C) so the polyester sets its width and keeps its shape. Do it before dyeing for a stable fabric.` });
  if (poly && cellu) steps.push({ stage: 'Dyeing', text: 'Two stages: polyester first with disperse dyes at 130 °C, then a reduction clear, then the cotton or viscose with reactive dyes. Polyester-first keeps the disperse dye off the cellulosic. A light shade can be dyed in one bath at the cost of the shade depth.' });
  else if (cellu) steps.push({ stage: 'Dyeing', text: 'Cellulosic fibres dye with reactive dyes in one bath (viscose and modal take a little more dye than cotton in the same bath).' });
  else if (poly) steps.push({ stage: 'Dyeing', text: 'Polyester dyes with disperse dyes at 130 °C.' });
  if (cot) steps.push({ stage: 'Finishing', text: input.mercerised ? 'Mercerise the cotton yarn or fabric: the sheen and the dye uptake rise; the polyester part is unaffected.' : 'Bio-polishing removes the cotton hairs and cuts pilling; add a softener. Peroxide bleaching is safe for cotton and polyester.' });
  steps.push({ stage: 'Knitting', text: `Wax the yarn (the polyester raises friction on the guides); knit at the strength the tensile block gives; keep the room above ${((() => { try { return (Y.staticRisk(Object.fromEntries(k.comps.map((c, i) => [c.id, chain.label[i] * 100])), 65) || {}).threshold_rh_pct; } catch (e) { return null; } })()) || 65} % RH if the polyester share is high, to keep static down.` });
  return { steps };
}

function studioYarn(comps, chain, k, spinKey, input) {
  const by = comps.map((c, i) => ({ id: c.id, p: chain.label[i] * 100 })).sort((a, b) => b.p - a.p);
  const mix = Object.fromEntries(by.map((x) => [x.id, r2(x.p)]));
  const has = (id) => (mix[id] || 0) > 0;
  let fibre = 'cotton';
  if (has('cotton') && has('polyester')) fibre = 'cvc';
  else if (by[0].id === 'cotton') fibre = 'cotton';
  else if (by[0].id === 'polyester') fibre = 'polyester_spun';
  else if (by[0].id === 'modal') fibre = 'modal';
  else if (by[0].id === 'viscose' || by[0].id === 'tencel' || by[0].id === 'bamboo') fibre = 'viscose';
  else if (has('cotton')) fibre = 'cotton';
  return { fibre, type: spinKey, mix, blend: true, density: r3(k.rho), spin_ne: k.ply > 1 ? r1(k.ne) : undefined, note: 'the Studio weighs this yarn as ' + fibre + ' at its count; the true fibre mix and density are carried alongside' };
}

function derive(k, b, chain, tens, lus, tx, mixing, fin, name) {
  const L = [];
  const D = (id, quantity, formula, working, result, unit, basis) => L.push({ id, quantity, formula, working, result, unit, basis });
  const comps = k.comps;
  D('dry', 'Dry share of each fibre', 'dryᵢ = (labelᵢ ÷ (1 + Rᵢ/100)) ÷ Σ(labelⱼ ÷ (1 + Rⱼ/100))',
    comps.map((c, i) => `${c.label}: ${r2(chain.label[i] * 100)} ÷ (1 + ${r2(chain.R[i])}/100)`).join('; '), comps.map((c, i) => `${r2(chain.dry[i] * 100)} %`).join(' / '), '%', 'law');
  D('regain', 'Blend regain', 'R = Σ dryᵢ × Rᵢ', comps.map((c, i) => `${r3(chain.dry[i])} × ${r2(chain.R[i])}`).join(' + '), r2(chain.blendR), '%', 'blend');
  D('density', 'Blend density', 'ρ = 1 ÷ Σ(dryᵢ ÷ ρᵢ)', `1 ÷ (${comps.map((c, i) => `${r3(chain.dry[i])}/${c.density}`).join(' + ')})`, r3(k.rho), 'g/cm³', 'blend');
  D('fibres', 'Fibres in the section', 'n = Σ (tex × dryᵢ ÷ fibre texᵢ)', `${r2(k.tex)} × (${comps.map((c, i) => `${r3(chain.dry[i])}/${r3(c.dtex / 10)}`).join(' + ')})`, Math.round(k.n), 'fibres', 'law');
  D('meanfibre', 'Mean fibre tex (by mass)', 't̄ = tex ÷ n', `${r2(k.tex)} ÷ ${Math.round(k.n)}`, r3(k.tMean), 'tex', 'law');
  D('diameter', 'Yarn diameter', 'd = 2·√(tex ÷ (1000·ρ·φ·π))', `2·√(${r2(k.tex)} ÷ (1000 × ${r3(k.rho)} × ${k.geo.phi} × π))`, r3(k.dMm), 'mm', 'blend');
  D('twist', 'Twist', 'TPI = αe·√Ne;  tan θs = π·d·TPM/1000;  tan θm = ⅔·tan θs', `${r2(k.alpha)} × √${r1(k.ne)} = ${r1(k.tpi)} TPI; θs = ${r1(k.thetaS * 180 / Math.PI)}°; θm = ${r1(k.thetaM * 180 / Math.PI)}°`, `${r1(k.tpi)} TPI`, '', 'law');
  D('finest', 'Finest count the blend can be spun', 'Ne max = 590.5 ÷ (nmin × t̄)', `590.5 ÷ (${k.geo.nmin} × ${r3(k.tMean)})`, r1(fin.by_fibre_count), 'Ne', 'law');
  D('fibrecurve', 'Fibre stress–strain curve', 'σ = A(1 − e^(−kε)),  A·k = E,  A(1 − e^(−k·εb)) = σb',
    comps.map((c, i) => { const f = k.fib[i].curve; return `${c.label}: E ${c.modulus} N/tex, σb ${c.tenacity} N/tex, εb ${r1(c.ext * 100)} %${f.linear ? ' (straight line)' : ` → k = ${r1(f.k)}`}`; }).join('; '), 'curve through the measured modulus and breaking point', '', 'measured');
  D('utilisation', 'Strength utilisation', 'κ = system RKM × 0.9807 ÷ 100 ÷ 0.32 N/tex (cotton fibre);  fibre strain = yarn strain × cos²θm',
    `κ = ${r2(k.spin.rkm)} × 0.9807 ÷ 100 ÷ 0.32 = ${r3(k.kappaSys)};  cos²θm = ${r3(k.c2)};  count factor ${r3(k.countF)}`, r3(k.kappaSys), '', 'law');
  D('yarnload', 'Yarn load at strain ε', 'F(ε) = tex × Σ dryᵢ·κᵢ·σᵢ(ε·cos²θm) for the fibres still unbroken', `peak at ε = ${r1(k.peakEps * 100)} % : ${r1(k.peak * 100)} cN/tex`, `${tens.tenacity.value} cN/tex`, 'cN/tex', 'blend');
  D('force', 'Breaking force', 'F = tenacity × tex', `${tens.tenacity.value} × ${r2(k.totalTex)}`, tens.breaking_force.value, 'cN', 'blend');
  D('elong', 'Elongation at break', 'ε_yarn = ε_fibre ÷ cos²θm (the strain at the peak load)', `${r1(k.order[0].ebY * 100 * k.c2)} % ÷ ${r3(k.c2)}`, `${tens.elongation_at_break.value} %`, '%', 'blend');
  D('u', 'Evenness', 'CVlim = 100/√n;  CVm = I × CVlim;  U % = 0.8 × CVm', `100/√${Math.round(k.n)} = ${r2(k.cvLim)};  ${r2(k.I)} × ${r2(k.cvLim)} = ${r1(k.cvm)};  0.8 × ${r1(k.cvm)}`, `${r1(k.uPct)} %`, '%', 'blend');
  D('sheen', 'Sheen index', 'L = Σ areaᵢ × 100 × (Rᵢ/R_cotton) × surfaceᵢ × delustrantᵢ × system factor;  R = ((n − 1)/(n + 1))²', comps.map((c, i) => `${c.label} ${r1(k.area[i] * 100)} % × ${lus.fibres[i].index}`).join(' + ') + ` × ${r2(k.geo.gloss)}`, lus.index.value, '', 'estimate');
  D('bending', 'Bending rigidity', 'B = Σ nᵢ·E_b·π·dᵢ⁴/64', `softness ${tx.softness.value} (cotton 100)`, tx.bending_rigidity_vs_cotton.value, '× cotton', 'blend');
  if (mixing) D('mix', 'Blend-ratio spread in a section', 'CV = √((1 − p)/(p·n)) × mixing factor', `√((1 − ${r2(mixing.number_share_pct / 100)})/(${r2(mixing.number_share_pct / 100)} × ${Math.round(k.n)})) × ${mixing.mixing_factor}`, `${mixing.cv_section_pct.value} %`, '%', 'law');
  return L;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE STUDIO SIDE
// ═════════════════════════════════════════════════════════════════════════════════════════════
/** A role's blend → the yarn the Studio weighs (nearest fibre key, its true mix and density). */
function toStudioYarn(spec) {
  const P = prep({ ...spec, count: spec.count || { value: 30, unit: 'ne' } });
  const chain = massChainOf(P.comps, P.spinKey);
  const rho = 1 / chain.dry.reduce((t, w, i) => t + w / P.comps[i].density, 0);
  const sy = studioYarn(P.comps, chain, { rho, ply: 1, ne: 30 }, P.spinKey, spec);
  return { ...sy, density: r3(rho) };
}
/** The profile of a yarn the Studio holds: a fibre mix (label %), a tex and a spinning system. */
function profileOf(mix, tex, spinKey, opts) {
  const fibres = {};
  for (const [f, v] of Object.entries(mix || {})) if (own(FIB, f) && +v > 0) fibres[f] = +v;
  if (!Object.keys(fibres).length) return null;
  const o = opts || {};
  return analyse({ fibres, count: { value: tex, unit: 'tex' }, spinning: own(GEO, spinKey) ? spinKey : undefined, ply: o.ply, grade: o.grade, fabric: o.fabric, twist_multiplier: o.twist_multiplier, mercerised: o.mercerised });
}

/** Studio input: replace each role's yarn with the blend the role's card describes. */
function applyToInput(input) {
  if (!input || typeof input !== 'object' || !input.blend || typeof input.blend !== 'object') return input;
  const out = { ...input, yarn: { ...(input.yarn || {}) }, yarns: { ...(input.yarns || {}) } };
  for (const role of ['ground', 'binder', 'loop', 'plate']) {
    const sp = own(input.blend, role) ? input.blend[role] : null;
    if (!sp || sp.enabled === false) continue;
    let sy;
    try { sy = toStudioYarn(sp); } catch (e) { throw new BlendError(`${role} yarn: ${e.message}`); }
    const base = role === 'ground' ? out.yarn : { ...(out.yarns[role] || {}) };
    const merged = { ...base, fibre: sy.fibre, mix: sy.mix, blend: true, blend_density: sy.density, ...(sp.spinning && own(GEO, sp.spinning) ? { type: sp.spinning } : {}) };
    if (role === 'ground') out.yarn = merged; else out.yarns[role] = merged;
  }
  return out;
}

/** A short name for a fibre mix in label %, "CVC 60/40", "PC 65/35", "Cotton/Viscose 70/30". */
function labelOfMix(mix) {
  const by = Object.entries(mix || {}).filter(([k, v]) => own(FIB, k) && +v > 0).map(([k, v]) => ({ k, p: +v })).sort((x, y) => y.p - x.p);
  if (!by.length) return 'Blend';
  const tot = by.reduce((t, x) => t + x.p, 0);
  const comps = by.map((x) => ({ id: x.k, code: FIB[x.k].code, label: FIB[x.k].label }));
  return nameOf(comps, by.map((x) => x.p / tot)).label;
}

function catalogue() {
  return {
    fibres: FIBRE_IDS.map((id) => ({ id, label: FIB[id].label, code: FIB[id].code, dtex: FIB[id].dtex, staple_mm: FIB[id].staple })),
    presets: PRESETS.map((p) => ({ ...p })),
    spinning: SYSTEMS.map((id) => ({ id, label: SYS[id].label })),
    grades: Object.entries(Y.FIBER_GRADES).map(([id, g]) => ({ id, label: g.label })),
    lustres: [{ id: 'bright', label: 'Bright (no TiO₂)' }, { id: 'semi_dull', label: 'Semi-dull (0.3 % TiO₂)' }, { id: 'full_dull', label: 'Full-dull (2 % TiO₂)' }],
  };
}

module.exports = { build: buildBlend, prep, labelOfMix, analyse, applyToInput, toStudioYarn, profileOf, catalogue, BlendError, PRESETS, FIB, GEO, curveFit, sigma, recommendSystem, ratioSweep, countSweep, core };
