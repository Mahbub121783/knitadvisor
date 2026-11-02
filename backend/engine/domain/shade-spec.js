// KnitAdvisor — shade × composition: what the chosen colour really is, and
// whether the fibres can give it.
//
// A colour on a knit is not one thing. Four different routes hide behind the
// six shade buttons, and each one depends on the fibres:
//
//   DYED        black, dark, light/medium — the cloth is piece-dyed. Which
//               dye class and how many baths depends on the fibres.
//   MELANGE     the colour is in the FIBRE, blended before spinning. A grey
//               melange is not dyed at all: a dope-dyed (spun-dyed) black
//               viscose is blended with raw cotton — 90/10 C/V is a light
//               grey, 70/30 an anthra. The dark fibre share IS the shade, so
//               the composition and the shade cannot be chosen apart.
//               Without viscose there are other routes, each different:
//               dyed-cotton fibre (100 % cotton melange, dearer), a
//               dope-dyed polyester, or — in a cotton/polyester blend — a
//               cross-dyed HEATHER, where the cloth is dyed and only the
//               cotton takes the colour.
//   FLUORESCENT a neon needs a dye that re-emits light. Polyester takes
//               fluorescent disperse dyes and is the only fibre that reaches
//               hi-vis (EN ISO 20471); on cotton a "neon" is a brilliant
//               reactive that never glows like it and fades in sunlight.
//   WHITE       optic white (bleach + optical brightener), bleached without
//               brightener, ecru (scoured only) or an ivory tint — four
//               processes, four whites.
//
// This module resolves the shade against the composition, says whether the
// two fit, offers the compositions that would, and returns the colour the
// views should render, the price-list row for dyeing and the yarn premium.
//
// SOURCED/TRADE CONVENTION: standard Bangladesh melange compositions (ecru
// 98/2, grey 90/10, anthra 70/30 C/V), dye classes per fibre, hi-vis fibre
// requirement. MODELLED: melange lightness from the dark-fibre share, neon
// brightness per fibre, fastness bands, the yarn premiums. No source names
// leave this file.

'use strict';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (n) => Math.round(n * 10) / 10;

// ── colour helpers (sRGB hex <-> linear) ──────────────────────────────────
const hexToRgb = (h) => { const n = parseInt(String(h).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const toSrgb = (l) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
function mixLinear(hexA, hexB, tB) {
  const a = hexToRgb(hexA).map(toLin), b = hexToRgb(hexB).map(toLin);
  return rgbToHex(...a.map((v, i) => toSrgb(v * (1 - tB) + b[i] * tB)));
}
function lStar(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLin);
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
}
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

// ── fibre groups ──────────────────────────────────────────────────────────
function groups(fibers) {
  const f = fibers || { cotton: 100 };
  const g = (k) => Number(f[k]) || 0;
  const visc = g('viscose') + g('modal') + g('tencel') + g('lyocell') + g('bamboo');
  const poly = g('polyester');
  const cotton = g('cotton') + g('supima');
  const nylon = g('nylon');
  const elast = g('elastane') + g('spandex') + g('lycra');
  const total = Object.values(f).reduce((s, v) => s + (Number(v) || 0), 0) || 100;
  const hard = total - elast || 100;
  return { visc, poly, cotton, nylon, elast, total, hard, f };
}

// ── MELANGE ───────────────────────────────────────────────────────────────
// dark-fibre share range and default per type (trade convention)
const MELANGE_TYPES = {
  ecru:     { label: 'Ecru melange',     min: 1,  max: 4,  def: 2,  note: 'raw cotton with a few dark fibres — an oatmeal, speckled off-white' },
  grey:     { label: 'Grey melange',     min: 5,  max: 20, def: 10, note: 'the classic light-to-mid grey heather' },
  anthra:   { label: 'Anthra melange',   min: 25, max: 45, def: 30, note: 'a dark, anthracite grey' },
  charcoal: { label: 'Charcoal melange', min: 46, max: 70, def: 55, note: 'a deep charcoal, nearly black at a distance' },
  black:    { label: 'Black melange',    min: 71, max: 95, def: 85, note: 'black with a fine light fleck' },
  color:    { label: 'Colour melange',   min: 10, max: 80, def: 30, note: 'a dyed fibre blended with raw fibre — navy melange, red melange…' },
};
const typeFromShare = (p) => (p <= 4 ? 'ecru' : p <= 20 ? 'grey' : p <= 45 ? 'anthra' : p <= 70 ? 'charcoal' : 'black');
const LIGHT_RAW = '#EDE9DF';      // raw (unbleached) cotton / viscose in a melange yarn
const LIGHT_ECRU = '#E8E1CF';
const DARK_DOPE = '#1D1D20';      // spun-dyed black viscose

function melangeSpec(a, G) {
  const typeGiven = MELANGE_TYPES[a.melange_type] ? a.melange_type : null;
  const pctGiven = Number.isFinite(+a.melange_pct) && +a.melange_pct > 0 ? clamp(+a.melange_pct, 1, 95) : null;
  const suggestions = [];
  const notes = [];
  let status = 'ok', message = '';
  let carrier, carrierLabel, method, dark, premium = 0, costingShade = 'melange', wetShade = 'melange';
  let type = typeGiven, pct = pctGiven;

  const stdComp = (t, p) => {
    const d = p != null ? Math.round(p) : MELANGE_TYPES[t].def;
    return `${100 - d}% Cotton ${d}% Viscose`;
  };

  if (G.visc > 0) {
    // the standard route: dope-dyed viscose is the dark fibre
    carrier = 'viscose'; carrierLabel = 'spun-dyed (dope-dyed) viscose';
    method = 'fibre-blend melange: the dark viscose is blended with raw cotton before spinning — the cloth is not dyed';
    const share = G.visc / G.hard * 100;
    if (pct == null) pct = share;
    if (!type) type = typeFromShare(pct);
    const T = MELANGE_TYPES[type];
    if (type !== 'color' && (share < T.min - 0.5 || share > T.max + 0.5)) {
      status = 'mismatch';
      const fits = typeFromShare(share);
      message = `${Math.round(share)}% viscose makes a ${MELANGE_TYPES[fits].label.toLowerCase()}, not ${T.label.toLowerCase()} (${T.min}-${T.max}% dark viscose).`;
      suggestions.push({ label: `Use ${stdComp(type)}`, composition: stdComp(type), why: `the standard ${T.label.toLowerCase()}` });
      suggestions.push({ label: `Keep ${Math.round(share)}% viscose as ${MELANGE_TYPES[fits].label}`, melange_type: fits, why: 'the shade your composition already gives' });
      pct = share;
    } else {
      message = `${T.label}: ${Math.round(share)}% spun-dyed viscose in raw cotton — the standard route.`;
    }
    dark = type === 'color' && a.colorHex ? a.colorHex : DARK_DOPE;
    premium = 0.25;                                       // melange yarn over plain combed, USD/kg
  } else if (G.poly > 0 && G.cotton > 0) {
    if (!type) type = 'grey';
    if (G.poly <= 20) {
      carrier = 'polyester'; carrierLabel = 'spun-dyed polyester';
      method = 'fibre-blend melange with a spun-dyed polyester as the dark fibre';
      if (pct == null) pct = G.poly / G.hard * 100;
      dark = type === 'color' && a.colorHex ? a.colorHex : DARK_DOPE;
      status = 'note';
      message = `Possible with a spun-dyed polyester, but uncommon here: most mills spin melange with viscose.`;
      premium = 0.30;
    } else {
      carrier = 'cross_dye'; carrierLabel = 'cross-dyed heather (cotton dyed, polyester left white)';
      method = 'HEATHER, not melange: the cloth IS dyed — the cotton takes a reactive dye and the polyester stays white, so the two read as a fleck';
      status = 'note';
      message = `With ${Math.round(G.poly)}% polyester and no viscose this is a cross-dyed heather: the cloth is dyed (cotton only), not a fibre-blend melange.`;
      pct = G.cotton / G.hard * 100;                      // the coloured part is the cotton
      dark = a.colorHex || (type === 'grey' || type === 'ecru' ? '#4A4D55' : type === 'anthra' ? '#2E3036' : '#1F2024');
      costingShade = 'light_medium';                      // one reactive bath for the cotton
      wetShade = 'light_medium';
      notes.push('The polyester must NOT take the dye: reactive only, no disperse — a clear, white polyester is what makes the heather.');
    }
    suggestions.push({ label: `Use ${stdComp(type === 'color' ? 'grey' : type)}`, composition: stdComp(type === 'color' ? 'grey' : type), why: 'a true fibre-blend melange, no dyeing' });
  } else if (G.cotton > 0) {
    if (!type) type = 'grey';
    carrier = 'cotton'; carrierLabel = 'fibre-dyed cotton';
    method = 'cotton melange: cotton fibre is dyed loose (as fibre), then blended with raw cotton and spun — 100% cotton, but the fibre dyeing costs more';
    if (pct == null) pct = MELANGE_TYPES[type].def;
    dark = type === 'color' && a.colorHex ? a.colorHex : '#262628';
    status = 'note';
    message = `No viscose: a ${MELANGE_TYPES[type].label.toLowerCase()} in 100% cotton needs fibre-dyed cotton — possible, dearer, and the shade varies more lot to lot.`;
    premium = 0.55;
    suggestions.push({ label: `Use ${stdComp(type === 'color' ? 'grey' : type, pct)}`, composition: stdComp(type === 'color' ? 'grey' : type, pct), why: 'the standard, cheaper melange with spun-dyed viscose' });
  } else if (G.poly > 0) {
    if (!type) type = 'grey';
    carrier = 'polyester'; carrierLabel = 'spun-dyed polyester (or a cationic-dyeable heather)';
    method = '100% polyester heather: a spun-dyed polyester blended with raw, or a cationic-dyeable polyester cross-dyed';
    if (pct == null) pct = MELANGE_TYPES[type].def;
    dark = type === 'color' && a.colorHex ? a.colorHex : DARK_DOPE;
    status = 'note';
    message = 'A polyester heather: made with spun-dyed or cationic-dyeable polyester.';
    premium = 0.35;
  } else {
    if (!type) type = 'grey';
    carrier = 'fibre'; carrierLabel = 'dyed fibre';
    method = 'fibre-blend melange';
    if (pct == null) pct = MELANGE_TYPES[type].def;
    dark = a.colorHex || DARK_DOPE;
  }

  // What the eye sees. A dark fibre counts for far more than its share: it
  // absorbs, it is finer than the cotton (more fibres per gram) and it sits
  // on the surface as well as inside. Calibrated to the trade's own shades —
  // 2% ≈ L* 84 (ecru), 10% ≈ 73 (grey), 30% ≈ 56 (anthra), 55% ≈ 40
  // (charcoal), 85% ≈ 24 (black melange): lightness falls as share^0.65.
  const light = type === 'ecru' ? LIGHT_ECRU : carrier === 'cross_dye' ? '#F4F4F2' : LIGHT_RAW;
  const share = clamp(pct / 100, 0.005, 0.97);
  const Ll = lStar(light), Ld = lStar(dark);
  const wantL = Ll - (Ll - Ld) * Math.pow(share, 0.65);
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (lStar(mixLinear(light, dark, m)) > wantL) lo = m; else hi = m; }
  const cover = (lo + hi) / 2;
  const target = mixLinear(light, dark, cover);
  // Seen up close, the fibres are counted truthfully (10% dark is 10% dark
  // fibres); the light fibres then read greyer than raw cotton, because the
  // light reaching them has already passed dark ones. Solve that light-fibre
  // colour so the fibre mix averages back to the cloth's colour.
  const tl = hexToRgb(target).map(toLin), dl = hexToRgb(dark).map(toLin), ll = hexToRgb(light).map(toLin);
  const lightView = rgbToHex(...tl.map((t, i) => toSrgb(clamp((t - share * dl[i]) / (1 - share), 0, ll[i]))));
  if (G.elast > 0) notes.push('Elastane is fine in a melange: it is hidden in the loop and takes no colour.');
  notes.push(carrier === 'cross_dye'
    ? 'Lot-to-lot shade depends on the dyeing, as for any dyed cloth.'
    : 'Every lot of melange yarn differs a little: approve a yarn lot, and keep a whole order on one lot.');

  return {
    melange: {
      type, label: MELANGE_TYPES[type].label, about: MELANGE_TYPES[type].note,
      dark_fibre_pct: r1(pct), carrier, carrier_label: carrierLabel, method,
      dark_hex: dark, light_hex: light, target_hex: target,
      light_fraction: Math.round((1 - share) * 1000) / 1000, light_view_hex: lightView, lightness_L: r1(lStar(target)),
      yarn_premium_usd: premium,
      notes,
    },
    composition_check: { status, message, suggestions },
    render_hex: target,
    costing_shade: costingShade,
    wet_shade: wetShade,
    extra_surcharges: premium > 0 ? [{ name: `Melange yarn premium (${carrierLabel})`, amount: premium }] : [],
  };
}

// ── FLUORESCENT ───────────────────────────────────────────────────────────
const NEONS = {
  yellow:  { label: 'Neon yellow', hex: '#E5FF00', hivis: true },
  lime:    { label: 'Neon lime',   hex: '#B6FF1A', hivis: false },
  green:   { label: 'Neon green',  hex: '#3DFF2E', hivis: false },
  orange:  { label: 'Neon orange', hex: '#FF6A13', hivis: true },
  pink:    { label: 'Neon pink',   hex: '#FF2D95', hivis: false },
  magenta: { label: 'Neon magenta', hex: '#F21BD0', hivis: false },
  red:     { label: 'Fluorescent red', hex: '#FF2E3B', hivis: true },
};
// how close each fibre gets to a true neon (polyester = 100), and its light fastness
const FLUO_FIBRE = {
  polyester: { cap: 100, lf: 4, dye: 'fluorescent disperse dyes, 130 °C' },
  nylon:     { cap: 92,  lf: 3, dye: 'fluorescent acid dyes' },
  acrylic:   { cap: 90,  lf: 3, dye: 'fluorescent basic (cationic) dyes' },
  silk:      { cap: 70,  lf: 2, dye: 'acid dyes' },
  wool:      { cap: 65,  lf: 2, dye: 'acid dyes' },
  viscose:   { cap: 62,  lf: 2, dye: 'brilliant reactive dyes (no true fluorescence)' },
  modal:     { cap: 62,  lf: 2, dye: 'brilliant reactive dyes (no true fluorescence)' },
  cotton:    { cap: 55,  lf: 2, dye: 'brilliant reactive dyes (no true fluorescence)' },
};
function neonFromHex(hex) {
  if (!hex) return null;
  const [h, s] = rgbToHsl(hexToRgb(hex));
  if (s < 0.35) return null;
  if (h < 12 || h >= 345) return 'red';
  if (h < 40) return 'orange';
  if (h < 68) return 'yellow';
  if (h < 95) return 'lime';
  if (h < 160) return 'green';
  if (h >= 290) return h >= 318 ? 'pink' : 'magenta';
  return 'blue';
}

function fluorescentSpec(a, G) {
  let neon = NEONS[a.neon] ? a.neon : (neonFromHex(a.colorHex) || 'lime');
  const warnings = [];
  if (neon === 'blue') { warnings.push('There is no true fluorescent blue: a bright blue is achievable, but it will not glow. Treated as the nearest neon.'); neon = 'green'; }
  const N = NEONS[neon];
  // brightness and fastness, weighted by fibre (elastane takes nothing)
  let cap = 0, lf = 0, w = 0;
  const dyes = new Set();
  for (const [k, v] of Object.entries(G.f)) {
    const p = Number(v) || 0;
    if (!p || /elast|spandex|lycra/.test(k)) continue;
    const F = FLUO_FIBRE[k] || FLUO_FIBRE.cotton;
    cap += F.cap * p; lf += F.lf * p; w += p; dyes.add(F.dye);
  }
  const brightness = Math.round(cap / (w || 1));
  const fastness = Math.round(lf / (w || 1));
  const polyShare = G.poly / G.hard * 100;
  // what the cloth reaches: a cotton "neon" is duller and darker
  const base = a.colorHex && neonFromHex(a.colorHex) ? a.colorHex : N.hex;
  const [h, s, l] = rgbToHsl(hexToRgb(base));
  const k = brightness / 100;
  const achieved = hslToHex(h, clamp(s * (0.68 + 0.32 * k), 0, 1), clamp(l * (0.9 + 0.1 * k), 0, 1));
  const hivisOk = N.hivis && polyShare >= 65;
  let status = 'ok', message;
  const suggestions = [];
  if (polyShare >= 90) message = `${N.label} on polyester: full neon brightness with fluorescent disperse dyes.`;
  else if (polyShare >= 50) { status = 'note'; message = `${N.label}: the polyester glows, the ${Math.round(100 - polyShare)}% cotton does not — a slightly frosty neon (two baths).`; }
  else {
    status = 'mismatch';
    message = `${N.label} on ${G.cotton >= 50 ? 'cotton' : 'this blend'} reaches about ${brightness}% of a polyester neon: a bright colour, not a glowing one, and it fades in sunlight (light fastness ~${fastness}).`;
    suggestions.push({ label: 'Use 100% Polyester', composition: '100% Polyester', why: 'true neon, hi-vis capable' });
    if (G.cotton > 0) suggestions.push({ label: 'Use 65% Polyester 35% Cotton', composition: '65% Polyester 35% Cotton', why: 'mostly neon, cotton feel inside' });
  }
  if (N.hivis && !hivisOk) warnings.push(`Hi-vis (EN ISO 20471) needs fluorescent ${neon} on polyester (≥ 65% here); this composition cannot be certified.`);
  return {
    fluorescent: {
      neon, label: N.label, neon_hex: N.hex, achieved_hex: achieved,
      brightness_pct: brightness, light_fastness: fastness,
      dye_classes: [...dyes],
      hi_vis: { possible: hivisOk, colour_qualifies: N.hivis },
      notes: [
        'Fluorescent dyes fade under UV: wash cold, dry in shade; add a UV absorber for sportswear.',
        polyShare > 0 && G.cotton > 0 ? 'Two baths: fluorescent disperse for the polyester, a brilliant reactive for the cotton — match the two closely or it looks frosted.' : null,
        'No optical brightener in the same bath: it shifts a neon toward blue.',
      ].filter(Boolean),
    },
    composition_check: { status, message, suggestions },
    render_hex: achieved,
    glow: r1(clamp((brightness - 50) / 50, 0, 1) * 10) / 10,
    costing_shade: 'fluorescent',
    wet_shade: 'fluorescent',
    warnings,
  };
}

// ── WHITE ─────────────────────────────────────────────────────────────────
const WHITES = {
  optic:   { label: 'Optic white', hex: '#F7F9FF', wi: 145, process: 'peroxide bleach + optical brightener (OBA)', costing: 'white_melange' },
  bleached:{ label: 'Bleached white (no OBA)', hex: '#F3F2EC', wi: 75, process: 'peroxide bleach, no brightener — also the RFD (ready-for-dye) base', costing: 'white_melange' },
  ivory:   { label: 'Ivory / off-white', hex: '#F1EBDC', wi: 30, process: 'bleach, then a very light dye tint', costing: 'light_medium' },
  ecru:    { label: 'Ecru / natural', hex: '#E9E1CE', wi: 20, process: 'scour and soften only — the fibre\'s own colour', costing: 'melange' },
};
function whiteSpec(a, G) {
  const type = WHITES[a.white_type] ? a.white_type : 'optic';
  const W = WHITES[type];
  let status = 'ok', message = `${W.label}: ${W.process}.`;
  const notes = [];
  if (type === 'ecru' && G.poly >= 50) { status = 'note'; message = 'Polyester is already white: an ecru polyester needs a light tint, it is not a natural colour.'; }
  if (type === 'optic' && G.poly > 0) notes.push('Polyester takes its own (disperse) brightener in the high-temperature bath; cotton takes it in the bleach.');
  if (type === 'optic') notes.push('An optic white looks bluish-bright under daylight and dull under shop light without UV: approve it in a D65 lightbox.');
  if (G.visc > 0 && type !== 'ecru') notes.push('Viscose yellows if the bleach runs hot: a gentle peroxide bleach.');
  return {
    white: { type, label: W.label, hex: W.hex, whiteness_index: W.wi, process: W.process, notes },
    composition_check: { status, message, suggestions: [] },
    render_hex: W.hex,
    costing_shade: W.costing,
    wet_shade: type === 'ivory' ? 'light_medium' : type === 'ecru' ? 'melange' : 'white_melange',
  };
}

// ── DYED ──────────────────────────────────────────────────────────────────
function dyedSpec(a, G, shade) {
  const notes = [];
  let status = 'ok', message;
  const pShare = G.poly / G.hard * 100;
  const route = pShare >= 90 ? 'disperse dyes at 130 °C, then reduction clearing'
    : pShare > 0 && G.cotton > 0 ? 'two baths: disperse for the polyester (130 °C, reduction clear), reactive for the cotton'
    : G.nylon > 0 ? 'acid dyes'
    : 'reactive dyes';
  message = `Piece-dyed: ${route}.`;
  if (pShare > 0 && G.cotton > 0) {
    status = 'note';
    notes.push('Two fibres, two dyes: the main risk is a two-tone (the polyester and the cotton not matching). Approve under D65 and TL84.');
  }
  if (shade === 'black' && pShare >= 50) notes.push('A polyester black needs 6-8% disperse black and a thorough reduction clearing, or it rubs off.');
  if (shade === 'black' && G.cotton >= 50) notes.push('A reactive black on cotton runs at 8-10% dye: soaping and fixing decide the rub and wash fastness.');
  if (G.visc > 0) notes.push('Viscose dyes deeper than cotton in the same bath: in a blend, expect the viscose to read darker.');
  return {
    dyed: { route, notes },
    composition_check: { status, message, suggestions: [] },
    render_hex: a.colorHex || null,
    costing_shade: null,
    wet_shade: null,
  };
}

/**
 * @param {object} a
 *   shade ('black'|'dark_navy'|'light_medium'|'fluorescent'|'white_melange'|'melange'),
 *   fibers{}, melange_type, melange_pct, white_type, neon, colorHex
 */
function analyzeShadeSpec(a = {}) {
  const shade = String(a.shade || '').toLowerCase();
  if (!shade) return null;
  const G = groups(a.fibers);
  let spec, type;
  if (shade === 'melange' || /heather|marl/.test(shade)) { spec = melangeSpec(a, G); type = 'melange'; }
  else if (shade === 'fluorescent') { spec = fluorescentSpec(a, G); type = 'fluorescent'; }
  else if (shade === 'white_melange' || shade === 'white' || shade === 'light' && a.white_type) { spec = whiteSpec(a, G); type = 'white'; }
  else { spec = dyedSpec(a, G, shade); type = 'dyed'; }
  return {
    ok: true,
    shade, type,
    ...spec,
    warnings: spec.warnings || [],
    basis: {
      convention: ['standard melange compositions', 'dye class per fibre', 'hi-vis fibre requirement'],
      modelled: ['melange lightness from the dark-fibre share', 'neon brightness and light fastness per fibre', 'whiteness index bands', 'yarn premiums'],
    },
  };
}

module.exports = { analyzeShadeSpec, MELANGE_TYPES, NEONS, WHITES, _mixLinear: mixLinear, _lStar: lStar };
