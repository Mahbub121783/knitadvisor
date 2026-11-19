/**
 * KnitAdvisor — Fabric light engine: how much light a knitted cloth lets through, and what shows behind it.
 *
 * A thin jersey in a pale shade is see-through; a dark, tight interlock is not. A buyer calls it "opacity" or "show-through" (skin,
 * a seam, an underlayer); a renderer needs it as subsurface scattering — the glow of light coming through the cloth. Both come from
 * the same few numbers:
 *
 *   OPEN AREA        the gaps between the loops: the yarn length in a cell × its diameter against the cell, open = e^(−c·cover)
 *                    (estimate; c is set so that a 30s cotton jersey is about 5 % open), more layers close it.
 *   FIBRE LIGHT      the light that goes through the yarn itself: T = e^(−μ·m), m the yarn mass per layer, μ the fibre mass
 *                    extinction, raised by the dye (the K/S of the shade, law).
 *   TOTAL            T_total = open + (1 − open) · T_fibre;  opacity = 1 − T_total.
 *   CONTRAST RATIO   the cloth over a black backing against over a white one (Kubelka–Munk with the cloth's reflectance Rc and
 *                    transmittance T): C = Rc ÷ (Rc + T²·Rb ÷ (1 − Rc·Rb)), Rb = 0.89. Near 1 is opaque.
 *   STRETCHED        the cell grows with the stretch, so the open area does: the same cloth at 20 and 40 % across.
 *   RENDER           the glow a back-lit cloth shows: the open area passes white light, the fibre passes the dye's own colour.
 *
 * Basis: law = arithmetic of the inputs (K/S, e^−x, Kubelka–Munk); estimate = the open-area constant and the fibre extinction, which
 * a spectrophotometer reading (opacity on black and white backings) on the mill's own cloth would replace. No outside source is named.
 */
'use strict';

class LightError extends Error { constructor(m) { super(m); this.name = 'LightError'; } }

const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const V = (value, unit, basis, extra) => (value == null || !Number.isFinite(value) ? null : { value, unit, basis, ...(extra || {}) });

const C_OPEN = 3.0;            // open = e^(−C·cover): a 30s cotton jersey ≈ 5 % open
const KAPPA = 0.78;            // the share of a loop's yarn length that covers the cell
const MU0 = 0.01;              // m²/g, the undyed fibre mass extinction
const RB = 0.89;               // the white backing's reflectance
const BODY = { white: 0.85, pastel: 0.6, light: 0.4, medium: 0.2, dark: 0.08, black: 0.04 };
const ks = (Y) => { const R = clamp(Y, 0.004, 0.98); return (1 - R) * (1 - R) / (2 * R); };

function lumOfHex(h) {
  if (!/^#[0-9a-f]{6}$/i.test(h || '')) return null;
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126729 * c[0] + 0.7151522 * c[1] + 0.072175 * c[2];
}
function tintOf(h, Y) {
  // the dye's own colour, saturated a little by passing through the fibre: sqrt of the linear colour, in sRGB-ish 0–1
  if (!/^#[0-9a-f]{6}$/i.test(h || '')) { const g = clamp(Math.sqrt(Y), 0, 1); return [g, g, g]; }
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => clamp(Math.pow(v, 0.7), 0, 1));
}

function openAt(cellMm2, lMm, dMm, layers, stretch) {
  const e = Math.max(0, stretch);
  const cell = cellMm2 * (1 + e) * (1 - 0.3 * Math.min(e, 1.2));
  const cover = (lMm * dMm * KAPPA) / Math.max(1e-6, cell);
  return Math.exp(-C_OPEN * cover) ** (1 + 0.6 * (Math.max(1, layers) - 1));
}

function analyse(input) {
  const p = input && typeof input === 'object' ? input : {};
  const wpc = +p.wpc, cpc = +p.cpc, l = +p.loop_mm, d = +p.yarn_d_mm, gsm = +p.gsm;
  if (!(wpc > 0 && cpc > 0 && l > 0 && d > 0 && gsm > 0)) throw new LightError('Give the loops per cm both ways, the loop length, the yarn diameter and the weight of the cloth.');
  const layers = clamp(Math.round(+p.layers || 1), 1, 3);
  let Y = Number.isFinite(+p.luminance) && p.luminance !== '' && p.luminance != null ? +p.luminance : lumOfHex(p.colour);
  if (Y == null) Y = BODY[p.shade] != null ? BODY[p.shade] : 0.2;
  Y = clamp(Y, 0.004, 0.98);
  const cell = 100 / (wpc * cpc);
  const KS = ks(Y);
  const mu = MU0 * (1 + 0.35 * Math.pow(KS, 0.8));
  const mLayer = gsm;                                       // the mass in the light path per projected area is the cloth weight, whatever the layers
  const tFib = Math.exp(-mu * mLayer);
  const raise = p.brushed && p.brushed !== 'none' ? 0.35 : 0;                 // a raised nap fills the gaps and adds fibre mass
  const at = (e) => {
    const open = openAt(cell, l, d, layers, e) * (1 - raise);
    const tot = open + (1 - open) * tFib;
    return { open, tot };
  };
  const rest = at(0), s20 = at(0.2), s40 = at(0.4);
  const Rc = clamp(Y * (1 - rest.tot) * 1.0, 0.001, 0.98);
  const tT = rest.tot;
  const Rw = Rc + (tT * tT * RB) / (1 - Rc * RB);
  const contrast = clamp(Rc / Rw, 0, 1);
  const opacity = 1 - rest.tot;
  const word = (o) => (o >= 0.92 ? 'opaque' : o >= 0.8 ? 'nearly opaque' : o >= 0.6 ? 'semi-sheer' : o >= 0.4 ? 'sheer' : 'see-through');
  const warnings = [];
  const say = (level, text) => warnings.push({ level, text });
  if (opacity < 0.6) say('warn', `Only ${Math.round(opacity * 100)} % opaque: a skin tone, a seam or an underlayer will show through. Darker shade, a heavier or tighter cloth, or a second layer closes it.`);
  else if (opacity < 0.8 && Y > 0.4) say('note', `A light shade at ${Math.round(opacity * 100)} % opacity: fine for outerwear, but check it for underwear, leggings and white garments (a contrast ratio above 0.85 is the usual limit for a white).`);
  if (1 - s20.tot < opacity - 0.15) say('note', `Stretched 20 % across the cloth drops to ${Math.round((1 - s20.tot) * 100)} % opaque: it will look thinner over a knee, a seat or a bust.`);
  const out = {
    success: true,
    open_area: V(r1(rest.open * 100), '% of the cloth', 'estimate'),
    fibre_transmittance: V(r1(tFib * 100), '% through the yarn', 'estimate'),
    transmittance: V(r1(rest.tot * 100), '% of the light', 'estimate'),
    opacity: V(r1(opacity * 100), '%', 'estimate', { word: word(opacity) }),
    contrast_ratio: V(r2(contrast), 'black backing ÷ white backing', 'estimate'),
    stretched: [{ stretch_pct: 20, opacity: V(r1((1 - s20.tot) * 100), '%', 'estimate'), open_area: V(r1(s20.open * 100), '%', 'estimate') }, { stretch_pct: 40, opacity: V(r1((1 - s40.tot) * 100), '%', 'estimate'), open_area: V(r1(s40.open * 100), '%', 'estimate') }],
    shade: { luminance: r3(Y), ks: V(r3(KS), 'K/S', 'law'), fibre_extinction: V(r3(mu), 'm²/g', 'estimate') },
    render: { open: r3(rest.open), fibre: r3(tFib), tint: tintOf(p.colour, Y).map(r3), open_stretched_20: r3(s20.open), gain: r2(clamp(0.6 + 1.4 * (rest.tot), 0.6, 2)) },
    warnings,
    derivations: [
      { id: 'open', quantity: 'Open area', formula: 'open = e^(−c·cover), cover = loop length × yarn diameter ÷ cell area', working: `cell ${r3(cell)} mm², loop ${r2(l)} mm, yarn ${r3(d)} mm${layers > 1 ? ', ' + layers + ' layers' : ''}`, result: r1(rest.open * 100), unit: '%', basis: 'estimate' },
      { id: 'fibre', quantity: 'Light through the yarn', formula: 'T = e^(−μ·m), μ = μ₀·(1 + 0.35·(K/S)^0.8)', working: `m = ${r1(mLayer)} g/m² in the light path, K/S ${r3(KS)}, μ ${r3(mu)}`, result: r1(tFib * 100), unit: '%', basis: 'estimate' },
      { id: 'contrast', quantity: 'Contrast ratio', formula: 'C = Rc ÷ (Rc + T²·Rb ÷ (1 − Rc·Rb)), Rb = 0.89', working: `Rc ${r3(Rc)}, T ${r3(tT)}`, result: r2(contrast), unit: '', basis: 'law' },
    ],
    basis: { law: ['K/S of the shade', 'Kubelka–Munk contrast ratio', 'the exponential extinction'], estimated: ['the open-area constant', 'the fibre mass extinction', 'the effect of a raised nap'], replaced_by: 'an opacity reading (reflectance over black and over white) on the mill\'s own cloth' },
  };
  return out;
}

function catalogue() { return { stretches_pct: [0, 20, 40], words: ['see-through', 'sheer', 'semi-sheer', 'nearly opaque', 'opaque'] }; }

module.exports = { analyse, catalogue, LightError };
