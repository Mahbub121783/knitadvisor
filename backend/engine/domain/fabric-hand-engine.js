/**
 * KnitAdvisor — Fabric hand engine: the physics numbers of a knitted cloth and what they say about how it feels.
 *
 * A fabric tester (the Kawabata KES-F set, or the FAST set) puts a strip of cloth through a few small, gentle deformations and
 * reads off a handful of numbers — the same numbers a buyer's hand finds without a machine. This engine gives those numbers for a
 * knit that has only been DRAWN, from what the Studio already knows: the yarn (fibres, count, spinning), the loop length and
 * density, the structure, the elastane, the finish.
 *
 *   TENSILE      load against stretch, along the wales and across them, up to a set load (default 200 gf/cm; 500 on request):
 *                LT linearity, WT energy, RT resilience, EMT the stretch reached. Taken from the stretch engine's J-curve, so the
 *                loops-then-yarn physics, the jam and the yarn's own recovery are the same ones the cloth stretch card uses.
 *   SHEAR        G rigidity, 2HG and 2HG5 hysteresis: the loops rotate against the friction of their crossings.
 *   BENDING      B rigidity, 2HB hysteresis, both ways: every yarn that crosses the strip bends — the sum over its fibres of
 *                E·π·d⁴/64 (the fibres slide), stiffened by the twist, carried through the loops, and raised by tightness.
 *   COMPRESSION  T0 thickness, Tm under 50 gf/cm², LC linearity, WC energy, RC resilience.
 *   SURFACE      MIU friction, MMD its variation, SMD roughness (estimated: no tester is in the loop).
 *   WEIGHT       W mg/cm².
 *
 * And the HAND, in plain words and as five scores 0–10 (stiffness, smoothness, fullness, springiness, drape), each worked out from the
 * numbers above; the same cloth is set against a reference (a 30s combed cotton single jersey, same finish) so that every figure
 * has a meaning. The scores are THIS engine's scale, not a published hand-value formula.
 *
 * Every figure carries its basis (the convention of the other engines):
 *   law        worked out by physics or arithmetic from the inputs
 *   blend      measured fibre values combined by the law that applies (the bending of the yarn)
 *   measured   a figure of the stretch engine that rests on the factory records
 *   estimate   a model not yet calibrated on the mill's own cloth — shear, surface, compression and the hand scores are these
 * The structure constants, the twist stiffening and the finish multipliers are estimates: they are stated, and a tester reading on
 * the mill's own cloth is what replaces them. No outside source is named.
 */
'use strict';

const BY = require('./blend-yarn-engine');
const SE = require('./stretch-engine');

class HandError extends Error { constructor(m) { super(m); this.name = 'HandError'; } }

const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const V = (value, unit, basis, extra) => (value == null || !Number.isFinite(value) ? null : { value, unit, basis, ...(extra || {}) });

// ── constants (all estimates unless said) ───────────────────────────────────────────────────────
const GF_CM_TO_N_M = 0.980665;             // 1 gf/cm = 9.80665 mN / 0.01 m = 0.98 N/m
const TF_REF = 15.9;                       // the tightness factor of the reference (30s Ne on 2.8 mm)
const TWIST_LOCK = { carded: 1.5, combed: 1.6, compact: 1.8, siro: 1.7, siro_compact: 1.9, open_end: 1.4, vortex: 1.5, filament: 1.0 };   // twist stops fibres sliding: a yarn is stiffer than the free sum
// fibre-on-fibre friction (dry), mass-weighted for the yarn
const MU = { cotton: 0.36, polyester: 0.34, viscose: 0.30, modal: 0.30, tencel: 0.28, bamboo: 0.30, nylon: 0.30, acrylic: 0.30, polypropylene: 0.28, wool: 0.28, silk: 0.24, linen: 0.30 };
// structure: bending carried by the loops, shear stiffness, how many yarn diameters thick, how much it compresses, surface relief
const STRUCT = {
  jersey:    { bend: 1.00, shear: 1.00, thick: 3.1, comp: 0.40, lc: 0.40, relief: 1.0, rc: 0 },
  pique:     { bend: 1.10, shear: 1.30, thick: 3.5, comp: 0.38, lc: 0.40, relief: 1.8, rc: 0 },
  rib:       { bend: 1.10, shear: 1.25, thick: 3.8, comp: 0.36, lc: 0.42, relief: 1.3, rc: 1 },
  interlock: { bend: 1.15, shear: 1.60, thick: 4.5, comp: 0.30, lc: 0.45, relief: 0.9, rc: 2 },
  purl:      { bend: 1.05, shear: 1.00, thick: 4.4, comp: 0.38, lc: 0.40, relief: 1.6, rc: 0 },
  fleece:    { bend: 0.95, shear: 1.50, thick: 3.1, comp: 0.55, lc: 0.33, relief: 1.1, rc: -4 },
  terry:     { bend: 0.95, shear: 1.50, thick: 3.1, comp: 0.55, lc: 0.33, relief: 3.2, rc: -4 },
  plush:     { bend: 0.90, shear: 1.60, thick: 3.1, comp: 0.65, lc: 0.30, relief: 0.7, rc: -4 },
  mesh:      { bend: 0.85, shear: 0.80, thick: 3.2, comp: 0.35, lc: 0.40, relief: 1.8, rc: 0 },
  warp:      { bend: 1.20, shear: 2.20, thick: 3.0, comp: 0.30, lc: 0.45, relief: 0.8, rc: 1 },
};
const LOOP_LAYER = 2.2;                       // loop-yarn diameters of thickness a fleece's back layer adds (estimate)
// finishes: multipliers on the numbers (bending, bending hysteresis, shear, friction, roughness, compression resilience, compressibility)
const FINISHES = {
  none:     { label: 'No chemical finish', B: 1.00, HB: 1.00, G: 1.00, MIU: 1.00, SMD: 1.00, RC: 0, comp: 1.00 },
  softener: { label: 'Softener', B: 0.78, HB: 0.75, G: 0.82, MIU: 0.84, SMD: 0.92, RC: 1, comp: 1.04 },
  silicone: { label: 'Silicone softener', B: 0.66, HB: 0.62, G: 0.72, MIU: 0.72, SMD: 0.88, RC: 3, comp: 1.06 },
  resin:    { label: 'Resin (crisp) finish', B: 1.60, HB: 1.45, G: 1.50, MIU: 0.96, SMD: 1.00, RC: 4, comp: 0.86 },
};
const BRUSHED = { none: null, face: { SMD: 1.55, MMD: 1.35, MIU: 1.08, B: 0.92, comp: 1.18, T: 1.30, RC: -3 }, back: { SMD: 1.20, MMD: 1.15, MIU: 1.04, B: 0.94, comp: 1.14, T: 1.22, RC: -3 } };

const KIND_ID = { jersey: 'single_jersey', pique: 'pique', rib: 'rib_1x1', interlock: 'interlock', purl: 'purl', fleece: 'fleece', terry: 'french_terry', plush: 'velour_plush', mesh: 'pointelle', warp: 'tricot' };
function kindOf(p) { return own(KIND_ID, p.structure) ? p.structure : SE.kindOf(p.fabricId || p.structure || '', p.category || ''); }
function fabricIdOf(p, kind) { return own(KIND_ID, p.structure) ? KIND_ID[p.structure] : (p.fabricId || p.structure || KIND_ID[kind] || ''); }
function frictionOf(mix) {
  const t = Object.keys(mix).filter((k) => own(MU, k)).reduce((s, k) => s + (+mix[k] || 0), 0);
  if (!(t > 0)) return 0.33;
  return Object.keys(mix).filter((k) => own(MU, k)).reduce((s, k) => s + MU[k] * (+mix[k] || 0), 0) / t;
}

/** The strain (fraction) and the load reached, on a curve of {e %, t N/m}, at a load in N/m; null when the cloth breaks first. */
function atLoad(curve, T) {
  for (let i = 1; i < curve.length; i++) {
    if (curve[i].t >= T) {
      const a = curve[i - 1], b = curve[i], f = b.t > a.t ? (T - a.t) / (b.t - a.t) : 0;
      return { e: (a.e + f * (b.e - a.e)) / 100, rec: a.rec + f * (b.rec - a.rec), i, reached: true };
    }
  }
  const z = curve[curve.length - 1];
  return { e: z.e / 100, rec: z.rec, i: curve.length - 1, reached: false, t: z.t };
}
/** The energy ∫F dε up to a strain, F in gf/cm, strain as a fraction: gf·cm/cm². */
function energyTo(curve, eMax) {
  let w = 0;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i], ea = a.e / 100, eb = b.e / 100;
    if (ea >= eMax) break;
    const eEnd = Math.min(eb, eMax), f = eb > ea ? (eEnd - ea) / (eb - ea) : 0, tEnd = a.t + f * (b.t - a.t);
    w += 0.5 * (a.t + tEnd) / GF_CM_TO_N_M * (eEnd - ea);
  }
  return w;
}

const scale = (x, lo, hi) => 10 * clamp((Math.log(Math.max(x, 1e-9)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)), 0, 1);
const lin = (x, lo, hi) => 10 * clamp((x - lo) / (hi - lo), 0, 1);

function prepare(input) {
  const p = input && typeof input === 'object' ? input : {};
  const fibres = {};
  Object.entries(p.fibres || p.fibers || { cotton: 100 }).forEach(([k, v]) => { if (own(BY.FIB, k) && +v > 0) fibres[k] = +v; });
  const elast = +p.elastane_pct > 0 ? +p.elastane_pct : 0;
  if (!Object.keys(fibres).length) throw new HandError('Give the fibres of the yarn, e.g. {"cotton": 100}.');
  const count = p.count && +p.count.value > 0 ? p.count : { value: +p.tex > 0 ? +p.tex : 30, unit: +p.tex > 0 ? 'tex' : 'ne' };
  const spinning = p.spinning && own(BY.GEO, p.spinning) ? p.spinning : p.filament ? undefined : 'combed';
  let prof;
  try { prof = BY.analyse({ fibres, count, spinning }); } catch (e) { if (e instanceof BY.BlendError) throw new HandError(e.message); throw e; }
  const tex = prof.count.tex.value;
  const kind = kindOf(p);
  const fin = own(FINISHES, p.finish && p.finish.chemical) ? p.finish.chemical : (p.finish && p.finish.resin ? 'resin' : p.finish && p.finish.softener ? (p.finish.softener === 'silicone' ? 'silicone' : 'softener') : 'none');
  const brushed = p.finish && own(BRUSHED, p.finish.brushed) && p.finish.brushed !== 'none' ? p.finish.brushed : 'none';
  const loadGf = clamp(+p.load_gf_cm > 0 ? +p.load_gf_cm : 200, 20, 500);
  return { p, fibres, elast, count, spinning, prof, tex, kind, fin, brushed, loadGf };
}

function compute(input, isRef) {
  const P = prepare(input), { p, fibres, elast, prof, tex, kind, fin, brushed, loadGf } = P;
  // the wet-process chemicals of the route (process-effects.js, when the chemistry card is on): their bending and friction on top of the finish
  const PX = p.finish && p.finish.process && typeof p.finish.process === 'object' ? p.finish.process : null;
  const pxB = PX && +PX.bending > 0 ? clamp(+PX.bending, 0.5, 1.6) : 1, pxM = PX && +PX.friction > 0 ? clamp(+PX.friction, 0.5, 1.5) : 1;
  const F0 = FINISHES[fin], F = pxB === 1 && pxM === 1 ? F0 : { ...F0, B: F0.B * pxB, HB: F0.HB * pxB, G: F0.G * (1 + 0.5 * (pxB - 1)), MIU: F0.MIU * pxM };
  const K = STRUCT[kind] || STRUCT.jersey, BR = BRUSHED[brushed];
  const loopMm = +p.loop_mm > 0.5 ? +p.loop_mm : r2(10 * Math.sqrt(tex) / TF_REF);
  const stretchIn = { fabricId: fabricIdOf(p, kind), category: p.category || '', loopMm, tex, countNe: 590.5 / tex, fibers: elast > 0 ? { ...scaleTo(fibres, 100 - elast), elastane: elast } : fibres, elastanePct: elast, rkm: prof.tensile.tenacity.value,
    yarnDiaMm: +p.yarn_d_mm > 0 ? +p.yarn_d_mm : undefined, gsm: +p.gsm > 0 ? +p.gsm : undefined, lycraDenier: +p.elastane_denier > 0 ? +p.elastane_denier : null, yarnRecovery: p.yarnRecovery };
  const ST = SE.analyzeStretch(stretchIn);
  const wpc = +p.wpc > 0 ? +p.wpc : ST.geometry.wpc, cpc = +p.cpc > 0 ? +p.cpc : ST.geometry.cpc;
  const d = +p.yarn_d_mm > 0 ? +p.yarn_d_mm : ST.geometry.yarn_diameter_mm;
  // the weight the loops of the ground yarn alone would have; what is above it is more yarn in the strip (a second feed, a pile, a second layer)
  const gsmModel = wpc * cpc * (loopMm / 10) * tex / 1e5 * 1e4;
  const gsm = +p.gsm > 0 ? +p.gsm : gsmModel;
  const ratio = clamp(gsm / gsmModel, 0.8, 3.2);
  const tf = Math.sqrt(tex) / (loopMm / 10);

  // ── bending ────────────────────────────────────────────────────────────────────────────────
  const free = prof.texture.bending_rigidity_abs.value;                              // gf·cm², fibres sliding freely
  const lock = TWIST_LOCK[p.filament ? 'filament' : P.spinning || 'combed'] || 1.5;
  const By = free * lock;
  const tight = clamp(Math.pow(tf / TF_REF, 0.6), 0.6, 1.8);
  const bwale = By * wpc * 2 * ratio * K.bend * tight * F.B * (BR ? BR.B : 1);
  const bcourse = By * cpc * 1 * ratio * K.bend * tight * F.B * (BR ? BR.B : 1);
  const mu = frictionOf(fibres);
  const hbRatio = clamp(0.35 + 1.1 * (mu / 0.36) * Math.pow(tight, 0.8) * F.HB, 0.25, 1.8);       // 2HB / B
  const wMgCm2 = gsm * 0.1, wGfCm2 = gsm * 1e-4;
  const cLen = (b) => Math.cbrt(b / wGfCm2);                                          // bending length, cm
  const bmean = Math.sqrt(bwale * bcourse);

  // ── tensile (the stretch engine's own curve) ─────────────────────────────────────────────────
  const T = loadGf * GF_CM_TO_N_M;
  const dirTensile = (D) => {
    const c = D.curve, at = atLoad(c, T), eM = at.e, Fm = at.reached ? loadGf : at.t / GF_CM_TO_N_M;
    const wt = energyTo(c, eM), lt = eM > 0 ? wt / (0.5 * Fm * eM) : 1;
    const rec = clamp(at.rec / 100, 0.05, 1);
    return { emt: eM * 100, wt, lt: clamp(lt, 0.15, 1.2), rt: 100 * Math.pow(rec, 3), reached: at.reached, fm: Fm, rec: at.rec, steps: [5, 20, 50, 100, 200, 500].filter((g) => g <= 500).map((g) => { const a = atLoad(c, g * GF_CM_TO_N_M); return { load_gf_cm: g, stretch_pct: a.reached ? r1(a.e * 100) : null }; }) };
  };
  const tw = dirTensile(ST.directions.width), tl = dirTensile(ST.directions.length);

  // ── shear (estimated: friction of the loop crossings) ───────────────────────────────────────────
  const cross = clamp(Math.sqrt((wpc * cpc) / 262), 0.5, 2);
  const G = 0.30 * K.shear * (mu / 0.36) * cross * Math.pow(tight, 0.7) * Math.pow(ratio, 0.5) * F.G;
  const HG = 1.7 * G * (0.8 + 0.4 * (mu / 0.36)), HG5 = 3.7 * G * (0.8 + 0.4 * (mu / 0.36));

  // ── compression (estimated) ───────────────────────────────────────────────────────────────────
  const hair = prof.texture.hairiness_vs_combed_cotton.value;
  // a fleece or a loopback is a jersey ground PLUS a layer of the loop yarn lying on its back: that layer is about two loop-yarn diameters (the floats
  // arched over the needles), so it is added when the loop yarn's diameter is known (modelled; before this a fleece was as thin as the jersey it is built on)
  const loopD = (kind === 'fleece' || kind === 'terry') && +p.loop_d_mm > 0 ? +p.loop_d_mm : 0;
  const T0 = (d * K.thick * Math.pow(clamp(tf / TF_REF, 0.6, 1.6), 0.35) * ((SE._KINDS[kind] && SE._KINDS[kind].bulk) || 1) + loopD * LOOP_LAYER) * (BR ? BR.T : 1) * (elast > 0 ? 1 - Math.min(0.12, elast * 0.01) : 1);
  const comp = clamp(K.comp * F.comp * (BR ? BR.comp : 1) * (1 + 0.12 * (hair - 1)) * (elast > 0 ? 0.92 : 1), 0.12, 0.8);
  const Tm = T0 * (1 - comp), dT = (T0 - Tm) / 10;                                   // cm
  const LC = K.lc, WC = LC * 25 * dT;
  const e5 = ST.fibre_recovery.points[2].recovery_pct;
  const RC = clamp(25 + 0.45 * e5 + K.rc + F.RC + (BR ? BR.RC : 0), 25, 80);

  // ── surface (estimated) ───────────────────────────────────────────────────────────────────────
  const relief = K.relief;
  const SMD = (1.0 + 24 * d * relief * Math.pow(hair, 0.25)) * F.SMD * (BR ? BR.SMD : 1);
  const MIU = clamp((0.14 + 0.38 * (mu - 0.2) + 0.05 * Math.log(Math.max(0.5, hair)) + 0.02 * relief) * F.MIU * (BR ? BR.MIU : 1), 0.1, 0.6);
  const MMD = clamp((0.006 + 0.05 * (MIU - 0.15) + 0.002 * relief) * (BR ? BR.MMD : 1) * (F.MIU < 1 ? 0.9 : 1), 0.004, 0.06);

  // ── the hand ───────────────────────────────────────────────────────────────────────────────────
  const stiff = scale(bmean, 0.008, 0.45);
  const smooth = 10 - (0.5 * scale(SMD, 2.2, 14) + 0.3 * scale(MIU, 0.14, 0.5) + 0.2 * scale(MMD, 0.006, 0.03));
  const full = 0.6 * scale(T0, 0.3, 2.2) + 0.4 * scale(WC, 0.1, 1.2);
  const spring = 0.6 * lin(RC, 38, 66) + 0.4 * lin((tw.rt + tl.rt) / 2, 25, 70);
  const cMean = Math.sqrt(cLen(bwale) * cLen(bcourse));
  const drape = 10 - scale(cMean, 0.9, 2.6);

  const out = {
    kind, kind_label: SE._KINDS[kind] ? SE._KINDS[kind].label : kind,
    inputs: { loopMm, tex, gsm, wpc, cpc, d, ratio, tf, mu, hair, lock, tight, free, By, fin, brushed, elast, process_chemicals: !!PX, spinning: P.spinning || (p.filament ? 'filament' : 'combed'), ST, loadGf },
    num: { bwale, bcourse, bmean, hbRatio, G, HG, HG5, tw, tl, T0, Tm, comp, LC, WC, RC, SMD, MIU, MMD, wMgCm2, cMean, cw: cLen(bwale), cc: cLen(bcourse) },
    scores: { stiff, smooth, full, spring, drape },
  };
  if (!isRef) out.ref = reference(P);
  return out;
}
function scaleTo(m, total) { const t = Object.values(m).reduce((a, b) => a + b, 0) || 100; return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, (v / t) * total])); }

const REF = {};
function reference(P) {
  const key = [P.kind, P.fin, P.brushed, P.loadGf].join('|');
  if (REF[key]) return REF[key];
  const r = compute({ structure: P.kind, fibres: { cotton: 100 }, count: { value: 30, unit: 'ne' }, spinning: 'combed', loop_mm: 2.8, finish: { chemical: P.fin, brushed: P.brushed }, load_gf_cm: P.loadGf }, true);
  return (REF[key] = r);
}

// ── words ───────────────────────────────────────────────────────────────────────────────────────
const bandWord = (x, list) => { for (const [lim, w] of list) if (x < lim) return w; return list[list.length - 1][1]; };
const WORDS = {
  stiff: [[1.8, 'very soft and limp'], [3.8, 'soft'], [5.8, 'medium body'], [7.6, 'firm and crisp'], [11, 'stiff, board-like']],
  smooth: [[3.2, 'rough, sandy'], [5, 'slightly textured'], [7, 'smooth'], [11, 'very smooth, silky']],
  full: [[2.5, 'thin and flat'], [4.5, 'light bulk'], [6.8, 'medium bulk, cushioned'], [11, 'full and bulky']],
  spring: [[3, 'dead, little spring'], [5.5, 'some spring'], [7.5, 'springy'], [11, 'lively, very springy']],
  drape: [[2.5, 'holds its shape, stands away from the body'], [5, 'moderate drape'], [7.5, 'soft drape'], [11, 'fluid, clings and falls']],
};
const USES = {
  baby: { label: 'Baby wear', stiff: [0, 3.6], smooth: [6, 10] },
  underwear: { label: 'Underwear / base layer', stiff: [0, 4.2], smooth: [5.5, 10] },
  tshirt: { label: 'T-shirt', stiff: [1.5, 5.2], smooth: [4.5, 10] },
  polo: { label: 'Polo / piqué shirt', stiff: [3.2, 6.4], smooth: [4, 10] },
  sweat: { label: 'Sweatshirt / fleece', stiff: [2.5, 6.4], full: [5, 10] },
  sport: { label: 'Sportswear', stiff: [1.2, 5], spring: [5, 10] },
};

function analyse(input) {
  const c = compute(input, false), I = c.inputs, N = c.num, S = c.scores, R = c.ref, RN = R.num, RS = R.scores;
  const warnings = [];
  const say = (level, text) => warnings.push({ level, text });
  const dir = (t, label) => ({
    label, load_gf_cm: V(r1(t.reached ? I.loadGf : t.fm), 'gf/cm', 'law'),
    LT: V(r3(t.lt), 'linearity', 'estimate'), WT: V(r1(t.wt), 'gf·cm/cm²', 'estimate'), RT: V(r1(t.rt), '%', 'estimate'),
    EMT: V(r1(t.emt), '% stretch', 'measured'), reached: t.reached, steps: t.steps,
  });
  const tensile = { width: dir(N.tw, 'Across the wales (courses)'), length: dir(N.tl, 'Along the wales'), note: `The stretch engine's load–extension curve of this cloth is read up to ${I.loadGf} gf/cm. The load is fixed, so the stretch it reaches (EMT) is the figure that tells; LT is how straight the curve is, WT the work done, RT the share of that work that comes back.` };
  if (!N.tw.reached) say('note', `Across the wales the cloth breaks before ${I.loadGf} gf/cm; the tensile numbers there are at the breaking load.`);
  if (!N.tl.reached) say('note', `Along the wales the cloth breaks before ${I.loadGf} gf/cm; the tensile numbers there are at the breaking load.`);
  const shear = { G: V(r3(N.G), 'gf/(cm·deg)', 'estimate'), HG: V(r2(N.HG), 'gf/cm (2HG, at 0.5°)', 'estimate'), HG5: V(r2(N.HG5), 'gf/cm (2HG5, at 5°)', 'estimate'),
    note: 'The loops rotate against the friction of their crossings: the more crossings, the tighter the cloth and the rougher the fibre, the stiffer in shear. A warp knit is far stiffer (its loops are tied in); a pointelle far softer.' };
  const bending = { wale: V(r3(N.bwale), 'gf·cm²/cm', 'blend'), course: V(r3(N.bcourse), 'gf·cm²/cm', 'blend'), HB: V(r3(N.hbRatio * N.bmean), 'gf·cm/cm (2HB, mean)', 'estimate'), HB_over_B: V(r2(N.hbRatio), '2HB ÷ B', 'estimate'),
    yarn_free: V(+I.free.toPrecision(3), 'gf·cm² per yarn, fibres sliding', 'blend'), yarn_locked: V(+I.By.toPrecision(3), 'gf·cm² per yarn, with the twist', 'estimate'),
    bending_length: V(r2(N.cMean), 'cm (mean of both ways)', 'law'), note: 'Every yarn that crosses the strip bends: the sum over its fibres of E·π·d⁴/64 (fibres slide), stiffened by the twist, times the yarns across a centimetre of the strip, carried through the loops and raised by tightness. A finer fibre is far softer (d⁴).' };
  const compression = { T0: V(r3(N.T0), 'mm at 0.5 gf/cm²', 'estimate'), Tm: V(r3(N.Tm), 'mm at 50 gf/cm²', 'estimate'), compressed: V(r1(N.comp * 100), '% of the thickness', 'estimate'), LC: V(r2(N.LC), 'linearity', 'estimate'), WC: V(r2(N.WC), 'gf·cm/cm²', 'estimate'), RC: V(r1(N.RC), '%', 'estimate'),
    apparent_density: V(r3(I.gsm / N.T0 / 1000), 'g/cm³', 'law'), note: 'Thickness is the yarn diameter times the number of yarns the structure stacks; what 50 gf/cm² squashes is the air between the loops and in the pile; resilience follows the fibre\'s own recovery.' };
  const surface = { MIU: V(r3(N.MIU), 'friction coefficient', 'estimate'), MMD: V(r3(N.MMD), 'its mean deviation', 'estimate'), SMD: V(r2(N.SMD), 'µm roughness', 'estimate'), note: 'No tester is in the loop, so the surface figures are estimated from the fibres\' friction, the yarn\'s hairiness, its diameter and the relief of the structure.' };
  const weight = { W: V(r2(N.wMgCm2), 'mg/cm²', 'law'), gsm: V(r1(I.gsm), 'g/m²', 'law') };

  const ratio = (a, b) => (b > 0 ? r2(a / b) : null);
  const scores = Object.fromEntries([['stiffness', S.stiff, RS.stiff, WORDS.stiff], ['smoothness', S.smooth, RS.smooth, WORDS.smooth], ['fullness', S.full, RS.full, WORDS.full], ['springiness', S.spring, RS.spring, WORDS.spring], ['drape', S.drape, RS.drape, WORDS.drape]]
    .map(([k, v, rv, w]) => [k, { score: r1(v), word: bandWord(v, w), reference: r1(rv), vs_reference: r1(v - rv), basis: 'estimate' }]));
  const useFit = Object.entries(USES).map(([id, u]) => {
    const miss = [];
    Object.entries({ stiff: 'stiffness', smooth: 'smoothness', full: 'fullness', spring: 'springiness' }).forEach(([k, name]) => {
      if (!u[k]) return; const v = S[k];
      if (v < u[k][0]) miss.push(k === 'stiff' ? 'too limp' : `too little ${name}`); else if (v > u[k][1]) miss.push(k === 'stiff' ? 'too stiff' : `too much ${name}`);
    });
    return { id, label: u.label, fits: !miss.length, note: miss.length ? miss.join(', ') : 'in the usual window' };
  });
  const sum = `${scores.stiffness.word}, ${scores.smoothness.word}, ${scores.fullness.word}; ${scores.springiness.word}; ${scores.drape.word}.`;
  if (N.cMean > 2.3) say('warn', `A bending length of ${r1(N.cMean)} cm is stiff for a knit: it will stand away from the body. Finer yarn, a softener or a looser stitch lowers it.`);
  if (N.SMD > 9 && !(c.inputs.brushed && c.inputs.brushed !== 'none')) say('note', `A roughness of ${r1(N.SMD)} µm will read as a textured, even coarse surface.`);
  if (I.elast > 0) say('note', 'The elastane is in the stretch and the compaction of the cloth; its own bending is negligible, so the bending figures are those of the other yarns.');
  if (I.ratio > 1.6) say('note', `The cloth carries ${r1(I.ratio)} times the yarn of the ground feed alone (a second layer, a plated or pile yarn): the bending and the shear are scaled to it.`);

  const D = [];
  const dd = (id, quantity, formula, working, result, unit, basis) => D.push({ id, quantity, formula, working, result, unit, basis });
  dd('yarn_b', 'Bending rigidity of the yarn', 'B_y = Σ n·E_b·π·d⁴/64 × twist factor', `${I.free.toPrecision(3)} gf·cm² (fibres free) × ${r2(I.lock)} (${I.spinning}) = ${I.By.toPrecision(3)}`, +I.By.toPrecision(3), 'gf·cm²', 'estimate');
  dd('b_wale', 'Bending along the wales', 'B = B_y × wales/cm × 2 legs × yarn ratio × structure × tightness × finish', `${I.By.toPrecision(3)} × ${r1(I.wpc)} × 2 × ${r2(I.ratio)} × ${r2(STRUCT[c.kind].bend)} × ${r2(I.tight)} × finish`, r3(N.bwale), 'gf·cm²/cm', 'blend');
  dd('b_course', 'Bending across the wales', 'B = B_y × courses/cm × yarn ratio × structure × tightness × finish', `${I.By.toPrecision(3)} × ${r1(I.cpc)} × ${r2(I.ratio)} × ${r2(STRUCT[c.kind].bend)} × ${r2(I.tight)} × finish`, r3(N.bcourse), 'gf·cm²/cm', 'blend');
  dd('c', 'Bending length', 'c = (B ÷ W)^(1/3), W in gf/cm²', `(${r3(N.bmean)} ÷ ${(I.gsm * 1e-4).toPrecision(3)})^(1/3)`, r2(N.cMean), 'cm', 'law');
  dd('emt', 'Stretch at the set load (across)', 'the load–extension curve of the stretch engine at the load', `${I.loadGf} gf/cm = ${r1(I.loadGf * GF_CM_TO_N_M)} N/m`, r1(N.tw.emt), '%', 'measured');
  dd('lt', 'Tensile linearity', 'LT = WT ÷ (½·F·EMT), WT = ∫F dε', `WT = ${r1(N.tw.wt)} gf·cm/cm² (across)`, r3(N.tw.lt), '', 'estimate');
  dd('g', 'Shear rigidity', 'G = G₀ × structure × friction × crossings × tightness × finish', `0.30 × ${r2(STRUCT[c.kind].shear)} × ${r2(I.mu / 0.36)} × …`, r3(N.G), 'gf/(cm·deg)', 'estimate');
  dd('t0', 'Thickness', 'T₀ = yarn diameter × yarns stacked × bulk × raised pile', `${r3(I.d)} mm × ${STRUCT[c.kind].thick}`, r3(N.T0), 'mm', 'estimate');
  dd('wc', 'Compression energy', 'WC = LC × ½ × 50 × (T₀ − Tm)', `${r2(N.LC)} × 25 × ${r3((N.T0 - N.Tm) / 10)} cm`, r2(N.WC), 'gf·cm/cm²', 'estimate');

  // FAST-style, read straight from the same numbers
  const fast = {
    extensibility: { width: { E20: stepAt(N.tw, 20), E100: stepAt(N.tw, 100), E5: stepAt(N.tw, 5) }, length: { E20: stepAt(N.tl, 20), E100: stepAt(N.tl, 100), E5: stepAt(N.tl, 5) }, unit: '% at 5, 20 and 100 gf/cm' },
    bending_length_mm: r1(N.cMean * 10), bending_rigidity_uNm: r1(N.bmean * 98.0665), shear_rigidity_N_m: r1(N.G * 56.2),
    thickness_mm: { at_2_gf_cm2: r3(N.T0 * 0.97), at_100_gf_cm2: r3(N.Tm * 0.9) },
    note: 'The same numbers in the second tester\'s terms: extensibility at three light loads, bending length and rigidity, shear rigidity and thickness. Dimensional stability is the stretch engine\'s relaxation and the Studio\'s shrinkage, not repeated here.',
  };

  return {
    success: true,
    identity: { structure: c.kind_label, yarn: { count_tex: r1(I.tex), count_ne: r1(590.5 / I.tex), spinning: I.spinning, hairiness_vs_combed_cotton: r2(I.hair), friction: r2(I.mu) }, finish: { chemical: FINISHES[I.fin].label, brushed: I.brushed, process_chemicals: I.process_chemicals }, load_gf_cm: I.loadGf },
    geometry: { loop_mm: r2(I.loopMm), wales_per_cm: r1(I.wpc), courses_per_cm: r1(I.cpc), yarn_d_mm: r3(I.d), gsm: r1(I.gsm), yarn_ratio: r2(I.ratio), tightness_factor: r1(I.tf) },
    tensile, shear, bending, compression, surface, weight,
    hand: { summary: sum, scores, use_fit: useFit, note: 'The five scores run 0–10 on this engine\'s own scale, set against the same cloth\'s reference (30s combed cotton single jersey, same finish). They are read from the numbers above — they are not a published hand-value formula.' },
    reference: {
      label: '30s Ne combed cotton, same structure family, same finish', bending_wale: r3(RN.bwale), bending_course: r3(RN.bcourse), shear_G: r3(RN.G), thickness_mm: r3(RN.T0), WC: r2(RN.WC), smd: r2(RN.SMD),
      ratios: { bending: ratio(N.bmean, RN.bmean), shear: ratio(N.G, RN.G), thickness: ratio(N.T0, RN.T0), roughness: ratio(N.SMD, RN.SMD), compression_energy: ratio(N.WC, RN.WC) },
      scores: { stiffness: r1(RS.stiff), smoothness: r1(RS.smooth), fullness: r1(RS.full), springiness: r1(RS.spring), drape: r1(RS.drape) },
    },
    fast_style: fast,
    stretch: { kind: I.ST.kind_label, geometry: I.ST.geometry },
    warnings, derivations: D,
    basis: {
      law: ['the bending sum over the fibres, the bending length, weight and the energy integrals'],
      measured: ['the stretch curve and the yarn\'s recovery (the stretch engine, which rests on the factory records)'],
      estimated: ['shear, surface, compression and the five hand scores', 'the twist stiffening and the structure and finish multipliers'],
      replaced_by: 'a tester reading on the mill\'s own cloth: the estimates are stated so that a measurement can replace them',
    },
  };
}
function stepAt(t, g) { const s = t.steps.find((x) => x.load_gf_cm === g); return s ? s.stretch_pct : null; }

/** For the Studio: the same analysis from what it already knows. */
function fromStudio(spec) { return analyse(spec); }

function catalogue() {
  return {
    finishes: Object.keys(FINISHES).map((id) => ({ id, label: FINISHES[id].label })),
    brushed: [{ id: 'none', label: 'Not raised' }, { id: 'face', label: 'Raised on the face' }, { id: 'back', label: 'Raised on the back' }],
    loads: [{ id: 200, label: '200 gf/cm (usual for knits)' }, { id: 500, label: '500 gf/cm (the standard load)' }, { id: 100, label: '100 gf/cm' }],
    structures: Object.keys(STRUCT).map((id) => ({ id, label: SE._KINDS[id] ? SE._KINDS[id].label : id })),
    fibres: Object.keys(BY.FIB).map((id) => ({ id, label: BY.FIB[id].label })),
    spinning: Object.keys(BY.GEO),
    uses: Object.keys(USES).map((id) => ({ id, label: USES[id].label })),
  };
}

module.exports = { analyse, fromStudio, catalogue, HandError, STRUCT, FINISHES };
