/**
 * KnitAdvisor — Virtual lightbox: how a cloth looks under the lights a buyer, a shop and a QA room use.
 *
 *   D65 (daylight), TL84 and CWF (shop fluorescents), A (tungsten), and a UV lamp (360 nm black light).
 *
 * A colour typed as a hex or an RGB is one colour under one light. A real cloth is a reflectance curve, and its colour moves when the
 * light moves. This engine rebuilds a smooth reflectance curve from the colour (the least wiggly curve that gives exactly that colour
 * in daylight), lights it with each source, and reports Lab, the ΔE2000 from daylight and a swatch of what it looks like. Three more things a
 * single colour cannot show:
 *
 *   OPTICAL BRIGHTENER   a white or a pastel with brightener glows blue where the light carries ultraviolet: daylight a lot, a black light
 *                        entirely, a shop fluorescent a little, tungsten none. The glow is added to the reflectance as an emission
 *                        band at 440 nm, so b* falls and L* rises under UV and the cloth looks different in every box.
 *   METAMERISM           two dyes that match in daylight and part under a shop light — a cotton-polyester blend dyed with a reactive
 *                        and a disperse dye is the classic. With two measured curves the ΔE2000 under each light is worked out (law).
 *                        Without them the engine says how likely it is from the dye classes and the depth of the shade (estimate) and
 *                        asks for the two readings.
 *   COLOUR INCONSTANCY   the mean ΔE2000 of the cloth's own colour between daylight and the three artificial lights: how much a colour
 *                        changes on its way from the mill's lightbox to the shop.
 *
 * Basis: law = the colorimetry (CIE 1931 observer, Lab, CIEDE2000) and the lighting of a curve by a source; estimate = the lamp spectra
 * (D65 and A are the CIE tables; TL84 and CWF are modelled from the lamp's mercury lines and phosphor bands and fitted to its published
 * chromaticity), the reconstructed curve, the brightener's strength and the metamerism risk. A spectrophotometer reading of the dyed cloth
 * under each source replaces each. No outside source is named in what this returns.
 */
'use strict';
const SP = require('./spectral');
const { dE00 } = require('./melange-engine');

class LightboxError extends Error { constructor(m) { super(m); this.name = 'LightboxError'; } }

const T = SP._tables, WL = SP.WL;
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sum = (a, f) => a.reduce((t, v, i) => t + f(v, i), 0);

// TL84 (a tri-phosphor fluorescent) and CWF (a halophosphate "cool white"): Hg lines + phosphor bands, fitted to the lamps' published chromaticity
const TL84 = [0, 0, 0.019, 0.401, 0.53, 0.046, 0.02, 0.092, 0.211, 0.242, 0.139, 0.04, 0.007, 0.101, 0.775, 0.775, 0.113, 0.091, 0.242, 0.244, 0.293, 1.092, 0.356, 0.007, 0, 0, 0, 0, 0, 0, 0];
const CWF = [0.163, 0.236, 0.336, 0.622, 0.793, 0.667, 0.741, 0.813, 0.86, 0.88, 0.879, 0.868, 0.857, 0.868, 1.096, 1.205, 0.997, 1.111, 1.274, 1.185, 1.2, 1.211, 1.186, 1.122, 1.018, 0.883, 0.727, 0.567, 0.418, 0.291, 0.191];
// the visible leakage of a 360 nm black light: a faint violet line
const BLB = WL.map((l) => 0.04 * Math.exp(-0.5 * ((l - 405) / 6) ** 2));

function observer(S) {
  const k = sum(S, (s, i) => s * T.YB[i]);
  return { wx: S.map((s, i) => (s * T.XB[i]) / k), wy: S.map((s, i) => (s * T.YB[i]) / k), wz: S.map((s, i) => (s * T.ZB[i]) / k), white: [sum(S, (s, i) => s * T.XB[i]) / k, 1, sum(S, (s, i) => s * T.ZB[i]) / k], S, k };
}
// the share of the ultraviolet a source carries, relative to daylight (what excites a brightener)
const SOURCES = [
  { id: 'D65', label: 'D65 · daylight', cct: 6504, use: 'The master approval light; global buyers.', S: T.D65, uv: 1.0 },
  { id: 'TL84', label: 'TL84 · shop fluorescent', cct: 4000, use: 'European high-street retail.', S: TL84, uv: 0.12 },
  { id: 'CWF', label: 'CWF · cool white fluorescent', cct: 4230, use: 'US retail and department stores.', S: CWF, uv: 0.18 },
  { id: 'A', label: 'A · tungsten', cct: 2856, use: 'Boutique spotlights, home lighting.', S: T.A, uv: 0.03 },
  { id: 'UV', label: 'UV · black light (365 nm)', cct: null, use: 'QA: uneven brightener, spots, residues.', S: BLB, uv: 8.0, uvOnly: true },
];
const OBS = Object.fromEntries(SOURCES.map((s) => [s.id, observer(s.S)]));
// brightener: an emission band at 440 nm; strength at the radiance factor peak, by shade (0 beyond a light shade)
const OBA_BAND = WL.map((l) => Math.exp(-0.5 * ((l - 440) / 22) ** 2));
const OBA_K = 0.17;
const OBA_BODY = { white: 1.0, pastel: 0.45, light: 0.12, medium: 0, dark: 0, black: 0 };

function xyzOf(spec, id, fluor) {
  const o = OBS[id], src = SOURCES.find((s) => s.id === id);
  const refl = src.uvOnly ? spec.map(() => 0) : spec;                           // a black light shows no reflected daylight, only leakage and glow
  const glow = fluor ? OBA_BAND.map((b) => OBA_K * fluor * src.uv * b) : null;
  const R = refl.map((r, i) => r + (glow ? glow[i] : 0));
  return [sum(R, (r, i) => r * o.wx[i]) / o.white[0], sum(R, (r, i) => r * o.wy[i]), sum(R, (r, i) => r * o.wz[i]) / o.white[2]];
}
// Bradford chromatic adaptation: the colour as seen once the eye has adapted to the source's white, expressed against the D65 white. This is what a
// colour inconstancy figure compares (not a plain XYZ rescaling, which exaggerates the shift under a warm lamp).
const BRAD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
const BRADI = [[0.9869929, -0.1470543, 0.1599627], [0.4323053, 0.5183603, 0.0492912], [-0.0085287, 0.0400428, 0.9684867]];
const mv = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const W65 = [0.95047, 1, 1.08883];
function adapt(xyzAbs, whiteSrc) {
  const cs = mv(BRAD, whiteSrc), cd = mv(BRAD, W65), c = mv(BRAD, xyzAbs);
  return mv(BRADI, c.map((v, i) => v * cd[i] / cs[i]));
}
const labD65 = (xyzRelSrc, id) => labOf(adapt(xyzRelSrc.map((v, i) => v * OBS[id].white[i]), OBS[id].white).map((v, i) => v / W65[i]));
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const labOf = (xyz) => { const fx = f(xyz[0]), fy = f(xyz[1]), fz = f(xyz[2]); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; };
const linToHex = (lin) => '#' + lin.map((v) => { const c = clamp(v, 0, 1); const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(clamp(s, 0, 1) * 255).toString(16).padStart(2, '0'); }).join('');
const hexToLin = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
const toXYZ65 = (lin) => [0.4124564 * lin[0] + 0.3575761 * lin[1] + 0.1804375 * lin[2], 0.2126729 * lin[0] + 0.7151522 * lin[1] + 0.0721750 * lin[2], 0.0193339 * lin[0] + 0.1191920 * lin[1] + 0.9503041 * lin[2]];
const xyz65ToLin = (x) => [3.2404542 * x[0] - 1.5371385 * x[1] - 0.4985314 * x[2], -0.969266 * x[0] + 1.8760108 * x[1] + 0.041556 * x[2], 0.0556434 * x[0] - 0.2040259 * x[1] + 1.0572252 * x[2]];

// the smoothest reflectance curve (cosine basis, high orders penalised) that has this colour (relative XYZ, D65) — a few clamping passes keep it physical (0–1)
function reconstruct(hex) {
  const lin = hexToLin(hex), t = toXYZ65(lin).map((v, i) => v / [0.95047, 1, 1.08883][i]);
  const K = 6, o = OBS.D65;
  const basis = (j) => WL.map((l) => Math.cos((j * Math.PI * (l - 400)) / 300));
  const B = Array.from({ length: K }, (_, j) => basis(j));
  const A = [o.wx, o.wy, o.wz].map((w, r) => B.map((b) => sum(b, (v, i) => v * w[i]) / (r === 1 ? 1 : 1)));
  // relative XYZ: x and z are normalised by the white, y is not
  const rows = [o.wx.map((v) => v / o.white[0]), o.wy, o.wz.map((v) => v / o.white[2])];
  const Ar = rows.map((w) => B.map((b) => sum(b, (v, i) => v * w[i])));
  void A;
  const wts = Array.from({ length: K }, (_, j) => 1 + 4 * j * j);
  let target = t.slice(), c = null, R = null;
  for (let pass = 0; pass < 12; pass++) {
    // min Σ w c² s.t. Ar c = target: c = W⁻¹ Arᵀ (Ar W⁻¹ Arᵀ)⁻¹ target
    const M = Ar.map((ri) => Ar.map((rj) => sum(ri, (v, k) => (v * rj[k]) / wts[k])));
    const inv = inv3(M), y = inv.map((row) => sum(row, (v, i) => v * target[i]));
    c = Array.from({ length: K }, (_, k) => sum(y, (v, r) => v * Ar[r][k]) / wts[k]);
    R = WL.map((_, i) => sum(c, (v, k) => v * B[k][i]));
    const clipped = R.map((v) => clamp(v, 0.012, 0.98));
    const got = [0, 1, 2].map((r) => sum(clipped, (v, i) => v * rows[r][i]));
    const err = Math.max(...got.map((v, i) => Math.abs(v - t[i])));
    R = clipped;
    if (err < 1e-4) break;
    target = target.map((v, i) => v + (t[i] - got[i]));
  }
  const got = [0, 1, 2].map((r) => sum(R, (v, i) => v * rows[r][i]));
  const labT = labOf(t), labG = labOf(got);
  return { spec: R.map(r3), error_de: r3(dE00(labT, labG)) };
}
function inv3(m) {
  const [a, b, c] = m[0], [d, e, g] = m[1], [h, i, j] = m[2];
  const det = a * (e * j - g * i) - b * (d * j - g * h) + c * (d * i - e * h);
  if (Math.abs(det) < 1e-14) throw new LightboxError('The colour cannot be turned into a reflectance curve.');
  return [[(e * j - g * i) / det, (c * i - b * j) / det, (b * g - c * e) / det], [(g * h - d * j) / det, (a * j - c * h) / det, (c * d - a * g) / det], [(d * i - e * h) / det, (b * h - a * i) / det, (a * e - b * d) / det]];
}

// what a viewer sees: the cast of the light is only partly discounted (incomplete adaptation, D = 0.6): an illustration, not a measurement
function swatch(xyzRelSrc, id) {
  const D = 0.6, w = OBS[id].white;
  const abs = xyzRelSrc.map((v, i) => v * w[i]);                       // the light as it falls (source white Y = 1)
  const full = adapt(abs, w);                                           // fully adapted to the source
  const mix = full.map((v, k) => D * v + (1 - D) * abs[k] * 0.97);
  return linToHex(xyz65ToLin(mix));
}

/**
 * analyse({ colour: '#rrggbb', shade, oba: 0..1, classes: ['reactive','disperse'], spectra: { a, b } })
 */
function analyse(input) {
  const p = input && typeof input === 'object' ? input : {};
  if (!/^#[0-9a-f]{6}$/i.test(p.colour || '')) throw new LightboxError('Give the colour as a hex, such as #2a4d8f.');
  const shade = OBA_BODY[p.shade] != null ? p.shade : 'medium';
  const warnings = [];
  const say = (level, text) => warnings.push({ level, text });
  const rec = reconstruct(p.colour);
  const obaOn = p.oba === true || +p.oba > 0;
  const obaLevel = obaOn ? clamp(p.oba === true ? 1 : +p.oba, 0, 1.5) * OBA_BODY[shade] : 0;
  const rows = SOURCES.map((s) => {
    if (s.uvOnly) {
      // a black light in a dark room: only the glow and the faint violet leakage, read with the D65 observer weights (no adaptation)
      const R = (g) => WL.map((_, i) => BLB[i] * 0.25 + (g ? OBA_K * g * s.uv * OBA_BAND[i] : 0));
      const xyzU = (g) => { const o = OBS.D65, r = R(g); return [sum(r, (v, i) => v * o.wx[i]) / o.white[0], sum(r, (v, i) => v * o.wy[i]), sum(r, (v, i) => v * o.wz[i]) / o.white[2]]; };
      const x1 = xyzU(obaLevel), x0 = xyzU(0);
      return { src: s, xyz: x1, lab: labOf(x1), lab_no_oba: labOf(x0) };
    }
    const x0 = xyzOf(rec.spec, s.id, 0), x1 = xyzOf(rec.spec, s.id, obaLevel);
    return { src: s, xyz: x1, lab: labD65(x1, s.id), lab_no_oba: labD65(x0, s.id) };
  });
  const d65 = rows[0];  // D65 is the first source: its Bradford adaptation is the identity
  const out = rows.map((r) => {
    const s = r.src;
    return {
      id: s.id, label: s.label, cct_k: s.cct, use: s.use,
      lab: r.lab.map(r1), delta_e_vs_d65: s.uvOnly ? null : r2(dE00(d65.lab, r.lab)),
      swatch: s.uvOnly ? linToHex(xyz65ToLin(r.xyz.map((v, i) => v * W65[i] * 1.0))) : swatch(r.xyz, s.id),
      oba: obaLevel > 0 ? { delta_b: r1(r.lab[2] - r.lab_no_oba[2]), delta_L: r1(r.lab[0] - r.lab_no_oba[0]) } : null,
    };
  });
  const art = out.filter((o) => ['TL84', 'CWF', 'A'].includes(o.id));
  const inconstancy = art.reduce((t, o) => t + o.delta_e_vs_d65, 0) / art.length;
  // metamerism: two curves given → law; else the risk from the dye classes and the depth
  let metamerism;
  const sa = p.spectra && p.spectra.a != null ? SP.parse(p.spectra.a) : null, sb = p.spectra && p.spectra.b != null ? SP.parse(p.spectra.b) : null;
  if (sa && sb) {
    const per = SOURCES.filter((s) => !s.uvOnly).map((s) => ({ id: s.id, label: s.label, delta_e: r2(dE00(labOf(xyzOf(sa, s.id, 0)), labOf(xyzOf(sb, s.id, 0)))) }));
    const d65e = per[0].delta_e, worst = Math.max(...per.slice(1).map((x) => x.delta_e));
    metamerism = { basis: 'law', measured: true, per_source: per, d65_match_de: d65e, worst_de: worst, index_vs_d65: r2(worst), verdict: d65e > 1 ? 'the two curves do not match in daylight: this is a colour difference, not metamerism' : worst > 0.8 ? 'metameric: they match in daylight and part under a shop light' : 'no metamerism worth acting on', risk: worst > 0.8 ? 'high' : worst > 0.4 ? 'medium' : 'low' };
    if (worst > 0.8) say('warn', `The two dyed curves match in daylight (ΔE ${d65e}) but part by ΔE ${worst} under a shop light: above 0.8 the dye recipe needs reformulating.`);
  } else {
    const cls = Array.isArray(p.classes) ? [...new Set(p.classes.filter((c) => typeof c === 'string'))] : [];
    const dual = cls.length >= 2;
    const deep = ['medium', 'dark', 'black'].includes(shade);
    const pair = cls.includes('disperse') && cls.includes('reactive') ? 'a disperse and a reactive dye (the usual cotton-polyester pair)' : cls.includes('acid') && cls.includes('reactive') ? 'an acid and a reactive dye' : cls.includes('cationic') && cls.includes('reactive') ? 'a cationic and a reactive dye' : cls.includes('disperse') && cls.includes('acid') ? 'a disperse and an acid dye' : 'two dye classes';
    const risk = !dual ? 'low' : deep ? 'high' : 'medium';
    metamerism = { basis: 'estimate', measured: false, classes: cls, risk, verdict: !dual ? 'one dye class: the whole cloth is dyed with one family of dyes, so metamerism is unlikely' : `${pair} in one cloth: the two fibres carry dyes of different spectral shape that can match in daylight and part under a shop light${deep ? ', and a medium to dark shade shows it most' : ''}`, need: dual ? 'Read the two dyed fibres on a spectrophotometer (or give two 31-band curves) to get the ΔE2000 under TL84, CWF and A: above 0.8 the recipe needs reformulating.' : null };
    if (dual && risk === 'high') say('warn', `Metamerism risk: ${metamerism.verdict}. ${metamerism.need}`);
    else if (dual) say('note', `Metamerism risk is ${risk}: ${metamerism.verdict}. ${metamerism.need}`);
  }
  if (inconstancy > 3) say('warn', `This colour moves by ΔE ${r1(inconstancy)} on average between daylight and the shop lights (colour inconstancy): approve it under the light it will be sold in, not only D65.`);
  else if (inconstancy > 1.5) say('note', `The colour moves by ΔE ${r1(inconstancy)} on average between daylight and the shop lights: noticeable beside a swatch.`);
  if (rec.error_de > 1) say('note', `The colour is too saturated for a smooth reflectance curve to give it exactly (error ΔE ${rec.error_de}): the shifts under the other lights are indicative.`);
  const bOba = out.find((o) => o.id === 'D65').oba;
  if (obaLevel > 0 && bOba) {
    if (p.softener === 'cationic') say('warn', 'A cationic softener on an optical white yellows it (b* rises) and quenches the brightener: the white will look yellower under every light and dull under the black light.');
    say('note', `The brightener makes the cloth ${bOba.delta_b < 0 ? 'bluer' : 'less blue'} by Δb* ${r1(bOba.delta_b)} in daylight and glow under the black light: an uneven brightener shows as patches only there.`);
  }
  return {
    success: true,
    colour: { hex: p.colour.toLowerCase(), shade, lab_d65: d65.lab.map(r1) },
    reconstruction: { error_de: rec.error_de, basis: 'estimate', note: 'the smoothest reflectance curve that gives this colour in daylight' },
    illuminants: out,
    inconstancy_index: V(r2(inconstancy), 'mean ΔE2000, daylight to TL84, CWF and A', 'estimate'),
    oba: obaLevel > 0 ? { level: r2(obaLevel), note: 'emission band at 440 nm, strength by shade (white 1, pastel 0.45, light 0.12, none beyond)' } : null,
    metamerism, warnings,
    derivations: [
      { id: 'recon', quantity: 'Reflectance curve', formula: 'the smoothest non-negative curve with this colour in D65 (cosine basis, high orders penalised)', working: `error ΔE ${rec.error_de}`, result: rec.error_de, unit: 'ΔE', basis: 'estimate' },
      { id: 'light', quantity: 'Colour under a source', formula: 'XYZ = Σ (R(λ) + glow(λ)) · S(λ) · x̄ȳz̄(λ) ÷ Σ S·ȳ; Lab from the source white; glow = k · UV share · emission(440 nm)', working: `sources ${SOURCES.map((s) => s.id).join(', ')}`, result: out.length, unit: 'sources', basis: 'law' },
      { id: 'cii', quantity: 'Colour inconstancy', formula: 'mean ΔE2000(Lab under D65, Lab under TL84 / CWF / A)', working: art.map((o) => `${o.id} ${o.delta_e_vs_d65}`).join(', '), result: r2(inconstancy), unit: 'ΔE', basis: 'estimate' },
    ],
    basis: { law: ['CIE 1931 observer, Lab, CIEDE2000', 'lighting a reflectance curve with a source'], estimated: ['the TL84 and CWF spectra (modelled, fitted to the lamps\' chromaticity)', 'the reflectance curve of a colour', 'the brightener strength', 'the metamerism risk without two curves'], replaced_by: 'a spectrophotometer reading of the dyed cloth under each source, and of each fibre of a blend' },
  };
}
function V(value, unit, basis) { return Number.isFinite(value) ? { value, unit, basis } : null; }

function catalogue() {
  return { sources: SOURCES.map((s) => ({ id: s.id, label: s.label, cct_k: s.cct, use: s.use, uv_share: s.uv, tint: tint(s.id) })), dye_classes: ['reactive', 'disperse', 'acid', 'cationic', 'direct', 'vat'] };
}
/** the colour of a source's white relative to daylight, as linear RGB multipliers (for tinting the 3D scene) */
function tint(id) {
  const o = OBS[id]; if (!o) return [1, 1, 1];
  const lin = xyz65ToLin([o.white[0] * 0.95047 / OBS.D65.white[0], 1, o.white[2] * 1.08883 / OBS.D65.white[2]]);
  const m = Math.max(...lin);
  return lin.map((v) => r3(clamp(v / m, 0.05, 1)));
}

module.exports = { analyse, catalogue, tint, reconstruct, LightboxError, SOURCES };
