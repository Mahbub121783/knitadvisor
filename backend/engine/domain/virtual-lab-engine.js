/**
 * KnitAdvisor — Virtual lab: the lab tests of a cloth that is only drawn, and how a hundred rolls of it will spread.
 *
 *   AIR PERMEABILITY   how much air goes through at 100 Pa (the usual test pressure), mm/s and CFM. The open area of the loops (the light
 *                      engine's, law on the loop geometry) is a set of holes of side s in a cloth T thick: flow = Cd · open · v₀ ÷ (1 + T/s),
 *                      v₀ = √(2ΔP/ρ) the speed of air through a clean hole. The constant is set so that a 30s combed cotton jersey reads
 *                      700 mm/s, the usual reading for one; the CHANGE with open area and thickness is the hole-flow law. Estimate.
 *   THERMAL RESISTANCE Rct (m²·K/W) and clo (1 clo = 0.155 m²K/W): the thickness over the conductivity of the air-and-fibre mixture,
 *                      λ = ½(parallel + series), fibre fraction φ = GSM ÷ (1000·ρ·T). Dry, still air, plain cloth. Estimate.
 *   SPC                a hundred rolls of the same cloth: yarn count, stitch length and finishing each vary by their own spread; the roll
 *                      weight and width follow (GSM ∝ tex ÷ ℓ; width ∝ ℓ). Gives the lot mean, σ, Cp and Cpk against ±spec, the share of
 *                      rolls in spec, a shade pass rate and a histogram. Cpk is given twice: with the machine set exactly to target, and set
 *                      from the Studio's number with no trial roll (the model's own typical error as a bias). Seeded: the same cloth gives
 *                      the same hundred rolls.
 *
 * Basis: law = the hole-flow and conduction arithmetic; estimate = the calibration constants, the thickness and the spreads, which
 * a mill's own readings (ISO 9237 air permeability, ISO 11092 Rct, a 100-roll weight log) replace. No outside source is named.
 */
'use strict';
const LIGHT = require('./fabric-light-engine');

class LabError extends Error { constructor(m) { super(m); this.name = 'LabError'; } }

const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const V = (value, unit, basis, extra) => (value == null || !Number.isFinite(value) ? null : { value, unit, basis, ...(extra || {}) });

const RHO_AIR = 1.2, DP = 100;                       // kg/m³, Pa (the usual test pressure)
const V0 = Math.sqrt((2 * DP) / RHO_AIR) * 1000;     // mm/s, air through a clean hole at 100 Pa
const LAMBDA_AIR = 0.026, LAMBDA_FIBRE = 0.30;       // W/(m·K)
const CLO = 0.155;                                   // m²K/W per clo
const DENS = { cotton: 1.52, polyester: 1.39, viscose: 1.49, modal: 1.52, tencel: 1.5, bamboo: 1.49, nylon: 1.14, acrylic: 1.19, wool: 1.31, silk: 1.34, linen: 1.5, polypropylene: 0.91, elastane: 1.2, cdp: 1.39 };
const REF = { wpc: 14.5, cpc: 19, loop_mm: 2.75, yarn_d_mm: 0.19, gsm: 150, T: 0.55, ap: 700 };
// what each end use asks of the cloth: air permeability (mm/s) and thermal resistance (clo) windows — typical, not a standard
const END_USES = {
  summer_tee:  { label: 'Summer T-shirt / polo', ap: [300, null], clo: [null, 0.20] },
  activewear:  { label: 'Activewear / sports', ap: [200, null], clo: [null, 0.25] },
  everyday:    { label: 'Everyday jersey / underwear', ap: [150, 1500], clo: [null, 0.30] },
  sweatshirt:  { label: 'Sweatshirt / hoodie', ap: [50, 400], clo: [0.20, null] },
  winter:      { label: 'Winter fleece / thermal', ap: [null, 250], clo: [0.30, null] },
  windproof:   { label: 'Wind-resistant outer layer', ap: [null, 60], clo: [null, null] },
};

// through the holes between the loops
function holeAir(open, cellMm2, T) {
  if (!(open > 0)) return 0;
  const s = Math.sqrt(open * cellMm2);             // the side of a hole, mm
  return open * V0 / (1 + T / s);
}
// through the fibre mass itself (Kozeny–Carman, fibres 14 µm across): a closed cloth, a fleece, a pile still pass air this way. mm/s at 100 Pa
function fibreAir(phi, TMm) {
  const e = clamp(1 - phi, 0.05, 0.995), df = 14e-6;
  const k = (df * df * e * e * e) / (180 * (1 - e) * (1 - e));          // m²
  return (DP / 1.8e-5) * k / (TMm / 1000) * 1000;
}
const phiOf = (gsm, rho, T) => clamp(gsm / (1000 * rho * T), 0.01, 0.9);
const K_AIR = (() => {
  const cell = 100 / (REF.wpc * REF.cpc);
  const o = LIGHT.analyse({ wpc: REF.wpc, cpc: REF.cpc, loop_mm: REF.loop_mm, yarn_d_mm: REF.yarn_d_mm, gsm: REF.gsm, shade: 'medium' }).render.open;
  const qf = (1 - o) * fibreAir(phiOf(REF.gsm, 1.52, REF.T), REF.T);
  return (REF.ap - qf) / holeAir(o, cell, REF.T);
})();

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(rnd) { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const SHADE_E = { white: 0.30, pastel: 0.28, light: 0.25, medium: 0.22, dark: 0.18, black: 0.15 };   // lot-to-lot ΔE00 per axis (estimate)

function analyse(input) {
  const p = input && typeof input === 'object' ? input : {};
  const wpc = +p.wpc, cpc = +p.cpc, l = +p.loop_mm, d = +p.yarn_d_mm, gsm = +p.gsm, T0 = +p.thickness_mm;
  if (!(wpc > 0 && cpc > 0 && l > 0 && d > 0 && gsm > 0 && T0 > 0)) throw new LabError('Give the loops per cm both ways, the loop length, the yarn diameter, the weight and the thickness of the cloth.');
  const warnings = [];
  const say = (level, text) => warnings.push({ level, text });
  const useId = END_USES[p.end_use] ? p.end_use : null;
  // the thickness the air and the heat go through: the cloth, plus a raised nap or a pile / loop yarn standing on it
  const nap = clamp(+p.nap_mm || 0, 0, 5), loopD = clamp(+p.loop_d_mm || 0, 0, 1.2);
  const T = T0 + nap + (loopD > 0 ? 2.5 * loopD : 0);

  // ── air permeability ───────────────────────────────────────────────────────────────────────────
  const light = LIGHT.analyse({ wpc, cpc, loop_mm: l, yarn_d_mm: d, gsm, layers: clamp(Math.round(+p.layers || 1), 1, 3), shade: p.shade || 'medium', brushed: p.brushed });
  const open = light.render.open;
  const cell = 100 / (wpc * cpc);
  // ── thermal resistance ─────────────────────────────────────────────────────────────────────────
  const fibres = p.fibres && typeof p.fibres === 'object' ? p.fibres : { cotton: 100 };
  const tot = Object.values(fibres).reduce((t, v) => t + (+v || 0), 0) || 100;
  const rho = 1 / Object.entries(fibres).reduce((t, [k, v]) => t + ((+v || 0) / tot) / (DENS[k] || 1.4), 0);
  // the cloth in layers, air and heat going through them in series: the base cloth (T0), and a raised nap and / or a pile or loop yarn on it,
  // each a thick, light layer (fibre fraction 0.04 for a nap, 0.10 for a pile or loops). The weight of those layers comes out of the cloth's.
  const layers = [];
  if (nap > 0) layers.push({ name: 'raised nap', h: nap, phi: 0.04 });
  if (loopD > 0) layers.push({ name: 'loop / pile yarn', h: 2.5 * loopD, phi: 0.10 });
  const massOf = (x) => rho * x.phi * x.h * 1000;                                 // g/m²
  const extraMass = Math.min(0.45 * gsm, layers.reduce((t, x) => t + massOf(x), 0));
  const gsmBase = gsm - extraMass;
  const phi = phiOf(gsmBase, rho, T0);                                             // fibre fraction of the base cloth
  const qHole = K_AIR * holeAir(open, cell, T0), qFibre = (1 - open) * fibreAir(phi, T0), qBase = qHole + qFibre;
  const resAir = (1 / qBase) + layers.reduce((t, x) => t + 1 / fibreAir(x.phi, x.h), 0);   // series: flow resistances add
  const ap = 1 / resAir;
  const lamOf = (f) => 0.5 * (((1 - f) * LAMBDA_AIR + f * LAMBDA_FIBRE) + 1 / ((1 - f) / LAMBDA_AIR + f / LAMBDA_FIBRE));
  const lam = lamOf(phi);
  const rct = (T0 / 1000) / lam + layers.reduce((t, x) => t + (x.h / 1000) / lamOf(x.phi), 0);
  const apLo = ap / 1.6, apHi = ap * 1.6;
  const air = {
    air_permeability: V(Math.round(ap), 'mm/s at 100 Pa', 'estimate', { range: [Math.round(apLo), Math.round(apHi)] }),
    cfm: V(r1(ap * 0.19685), 'ft³/min per ft²', 'estimate'),
    open_area: V(r1(open * 100), '% of the cloth', 'law'),
    hole_side: V(r3(Math.sqrt(open * cell)), 'mm', 'law'),
    thickness_in_path: V(r3(T), 'mm', 'estimate'),
    through_holes: V(Math.round(qHole), 'mm/s', 'estimate'), through_fibre: V(Math.round(qFibre), 'mm/s', 'estimate'), layers: layers.map((x) => ({ name: x.name, height_mm: r3(x.h), fibre_fraction: x.phi })),
    word: ap >= 1200 ? 'very breathable' : ap >= 400 ? 'breathable' : ap >= 150 ? 'moderate' : ap >= 40 ? 'low: warm and wind-resistant' : 'nearly airtight',
  };
  const thermal = {
    rct: V(r3(rct), 'm²·K/W', 'estimate'), clo: V(r3(rct / CLO), 'clo', 'estimate'),
    conductivity: V(r3(lam), 'W/(m·K)', 'estimate'), fibre_fraction: V(r3(phi), 'of the cloth volume', 'estimate'),
    word: rct / CLO >= 0.45 ? 'a heavy insulating cloth' : rct / CLO >= 0.25 ? 'warm' : rct / CLO >= 0.10 ? 'moderate' : 'a light, cool cloth',
  };
  // ── end use ────────────────────────────────────────────────────────────────────────────────────
  const fits = Object.entries(END_USES).map(([id, u]) => {
    const miss = [];
    if (u.ap[0] != null && ap < u.ap[0]) miss.push(`air permeability ${Math.round(ap)} is under the ${u.ap[0]} mm/s it needs`);
    if (u.ap[1] != null && ap > u.ap[1]) miss.push(`air permeability ${Math.round(ap)} is over the ${u.ap[1]} mm/s it allows`);
    if (u.clo[0] != null && rct / CLO < u.clo[0]) miss.push(`${r2(rct / CLO)} clo is under the ${u.clo[0]} clo it needs`);
    if (u.clo[1] != null && rct / CLO > u.clo[1]) miss.push(`${r2(rct / CLO)} clo is over the ${u.clo[1]} clo it allows`);
    return { id, label: u.label, fits: !miss.length, note: miss.length ? miss.join('; ') : 'in the usual window' };
  });
  if (useId) { const f = fits.find((x) => x.id === useId); if (!f.fits) say('warn', `For ${f.label}: ${f.note}.`); }

  // ── SPC: a hundred rolls ───────────────────────────────────────────────────────────────────────
  const n = clamp(Math.round(+p.rolls || 100), 20, 1000);
  const cvCount = clamp(+p.cv_count > 0 ? +p.cv_count : 0.8, 0.2, 6) / 100;                 // lot-to-lot yarn count, typical
  const tolSl = clamp(+p.tol_sl_mm > 0 ? +p.tol_sl_mm : 0.03, 0.005, 0.2);                   // ± stitch-length tolerance, mm (the VDQ setting)
  const cvSl = (tolSl / 3) / l;                                                              // taken as ±3σ
  const cvFin = clamp(+p.cv_finish > 0 ? +p.cv_finish : 1.0, 0.2, 6) / 100;                  // finishing: stenter overfeed, compaction
  const cvWFin = 0.01;                                                                       // finished width, stenter set
  const sGsm = Math.sqrt(cvCount ** 2 + cvSl ** 2 + cvFin ** 2), sW = Math.sqrt(cvSl ** 2 + cvWFin ** 2);
  const spec = clamp(+p.spec_pct > 0 ? +p.spec_pct : 5, 1, 20) / 100, specW = clamp(+p.spec_width_pct > 0 ? +p.spec_width_pct : 2, 0.5, 10) / 100;
  const bias = clamp(+p.model_error_pct > 0 ? +p.model_error_pct : 4, 0, 20) / 100;           // the Studio's typical error: a machine set up untried is off by this
  const cp = spec / (3 * sGsm), cpk0 = spec / (3 * sGsm), cpkBias = (spec - bias) / (3 * sGsm);
  const cpW = specW / (3 * sW);
  const rnd = mulberry(Math.round(gsm * 1000 + wpc * 10 + cpc));
  const rows = [];
  const eShade = SHADE_E[p.shade] != null ? SHADE_E[p.shade] : 0.22, dETol = 1.0;
  for (let i = 0; i < n; i++) {
    const zc = gauss(rnd), zs = gauss(rnd), zf = gauss(rnd), zw = gauss(rnd);
    const g = Math.exp(cvCount * zc - cvSl * zs + cvFin * zf), w = Math.exp(cvSl * zs + cvWFin * zw);
    const dE = eShade * Math.sqrt(gauss(rnd) ** 2 + gauss(rnd) ** 2 + gauss(rnd) ** 2);
    rows.push({ g, w, dE });
  }
  const mean = (a) => a.reduce((t, x) => t + x, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((t, x) => t + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
  const gs = rows.map((x) => x.g * gsm), ws = rows.map((x) => x.w);
  const inG = (x) => Math.abs(x / gsm - 1) <= spec;
  const passG = rows.filter((x) => Math.abs(x.g - 1) <= spec).length / n;
  const passGb = rows.filter((x) => Math.abs(x.g * (1 + bias) - 1) <= spec).length / n;
  const passW = rows.filter((x) => Math.abs(x.w - 1) <= specW).length / n;
  const passE = rows.filter((x) => x.dE <= dETol).length / n;
  void inG;
  const lo = Math.min(...gs), hi = Math.max(...gs), bins = 12, hist = Array(bins).fill(0);
  gs.forEach((x) => { hist[Math.min(bins - 1, Math.floor(((x - lo) / Math.max(1e-9, hi - lo)) * bins))]++; });
  const spc = {
    rolls: n,
    spreads: { yarn_count_cv_pct: V(r2(cvCount * 100), '%', 'estimate'), stitch_length_cv_pct: V(r2(cvSl * 100), '%', 'law', { from: `±${tolSl} mm taken as ±3σ of ${r2(l)} mm` }), finishing_cv_pct: V(r2(cvFin * 100), '%', 'estimate'), width_finish_cv_pct: V(r2(cvWFin * 100), '%', 'estimate') },
    gsm: { mean: V(r1(mean(gs)), 'g/m²', 'estimate'), sigma: V(r2(sd(gs)), 'g/m²', 'estimate'), sigma_pct: V(r2(sGsm * 100), '%', 'law'), min: r1(lo), max: r1(hi), spec_pct: r1(spec * 100),
      cp: V(r2(cp), '', 'law'), cpk_centred: V(r2(cpk0), '', 'law'), cpk_untried: V(r2(Math.max(0, cpkBias)), '', 'estimate', { bias_pct: r1(bias * 100), note: 'the machine set from the Studio\'s number with no trial roll: off by the model\'s typical error' }),
      in_spec_pct: V(r1(passG * 100), '% of rolls', 'estimate'), in_spec_untried_pct: V(r1(passGb * 100), '% of rolls', 'estimate'),
      histogram: { from: r1(lo), to: r1(hi), counts: hist } },
    width: { sigma_pct: V(r2(sW * 100), '%', 'law'), spec_pct: r1(specW * 100), cp: V(r2(cpW), '', 'law'), in_spec_pct: V(r1(passW * 100), '% of rolls', 'estimate') },
    shade: { delta_e_tolerance: dETol, pass_pct: V(r1(passE * 100), '% of rolls within ΔE00 ' + dETol, 'estimate'), mean_delta_e: V(r2(mean(rows.map((x) => x.dE))), 'ΔE00, roll to standard', 'estimate') },
    word: cpk0 >= 1.67 ? 'excellent' : cpk0 >= 1.33 ? 'capable' : cpk0 >= 1.0 ? 'marginal' : 'not capable',
  };
  if (cpk0 < 1.33) say('warn', `A weight spread of ${r2(sGsm * 100)} % (1σ) against ±${r1(spec * 100)} % gives Cp ${r2(cp)}: under the usual 1.33. The yarn count (${r2(cvCount * 100)} %) and the finishing (${r2(cvFin * 100)} %) set it; a tighter stitch-length tolerance only helps once those are tighter.`);
  if (cpkBias < 1.0) say('note', `Set up from the Studio's number with no trial roll, ${r1((1 - passGb) * 100)} % of rolls would fall outside ±${r1(spec * 100)} % (Cpk ${r2(Math.max(0, cpkBias))}): knit a trial roll and log it in Trial rolls to remove the ${r1(bias * 100)} % model bias.`);

  const out = {
    success: true, air, thermal,
    end_use: { selected: useId, fits },
    spc, warnings,
    derivations: [
      { id: 'air', quantity: 'Air permeability', formula: 'Q = K · open · v₀ ÷ (1 + T/s) + (1 − open) · Kozeny–Carman(φ, T);  v₀ = √(2ΔP/ρ), s = √(open · cell)', working: `base cloth ${Math.round(qBase)} (holes ${Math.round(qHole)} (open ${r3(open)}, cell ${r3(cell)} mm², s ${r3(Math.sqrt(open * cell))} mm, T ${r3(T)} mm, v₀ ${Math.round(V0)} mm/s, K ${r3(K_AIR)}) + fibre mass ${Math.round(qFibre)} (φ ${r3(phi)}))${layers.length ? ', in series with ' + layers.map((x) => x.name + ' ' + r2(x.h) + ' mm').join(' and ') : ''}`, result: Math.round(ap), unit: 'mm/s', basis: 'estimate' },
      { id: 'rct', quantity: 'Thermal resistance', formula: 'Rct = T ÷ λ, λ = ½(parallel + series), φ = GSM ÷ (1000·ρ·T)', working: `base φ ${r3(phi)}, λ ${r3(lam)} W/mK, T ${r3(T0)} mm${layers.length ? ' + ' + layers.map((x) => x.name + ' ' + r2(x.h) + ' mm').join(' + ') : ''}`, result: r3(rct), unit: 'm²K/W', basis: 'estimate' },
      { id: 'spc', quantity: 'Weight spread', formula: 'σ = √(cv_count² + cv_ℓ² + cv_finish²), Cp = ±spec ÷ 3σ', working: `√(${r2(cvCount * 100)}² + ${r2(cvSl * 100)}² + ${r2(cvFin * 100)}²) = ${r2(sGsm * 100)} %`, result: r2(cp), unit: 'Cp', basis: 'law' },
    ],
    basis: { law: ['hole-flow and conduction arithmetic', 'the spread of independent causes adds in quadrature', 'Cp and Cpk'], estimated: ['the air permeability calibration (30s jersey = 700 mm/s)', 'the cloth thickness', 'the spreads of count, finishing and width', 'the shade spread'], replaced_by: 'ISO 9237 air permeability, ISO 11092 thermal resistance and a 100-roll weight log from the mill' },
  };
  return out;
}

function catalogue() {
  return { end_uses: Object.entries(END_USES).map(([id, u]) => ({ id, label: u.label })), defaults: { rolls: 100, cv_count_pct: 0.8, tol_sl_mm: 0.03, cv_finish_pct: 1.0, spec_pct: 5, spec_width_pct: 2, model_error_pct: 4 }, reference: { label: '30s combed cotton jersey', air_permeability_mm_s: REF.ap } };
}

module.exports = { analyse, catalogue, LabError, END_USES };
