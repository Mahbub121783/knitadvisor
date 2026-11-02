/**
 * KnitAdvisor — Wet-processing cost model
 * ========================================
 *
 * Three things a knit fabric price depends on after the grey fabric leaves
 * the knitting machine, each priced the way a Bangladeshi dyehouse prices it:
 *
 *   1. DYEING CHARGE — per kg of GREY fabric, by shade band. A dyehouse does
 *      not quote a recipe, it quotes a band: white, light, medium, dark,
 *      black, special (turquoise / brilliant royal / brilliant red), neon,
 *      melange wash. The fibre decides the route (reactive, disperse, acid,
 *      two-part), and the band decides the price on that route.
 *   2. FINISHING CHARGE — tubular or open width, heat-setting, brushing,
 *      peaching and the other surface finishes, each as its own line.
 *   3. PROCESS LOSS — the grey kilos that never reach the customer. The base
 *      is the factory's own bulk median (light 11 / medium 12.5 / dark 14 %),
 *      split into what the fibre loses in the bath (a cotton loses its wax and
 *      pectin, a polyester almost nothing) and what is lost in handling.
 *
 * ANCHORS AND MODEL. The cotton one-part figures for white (0.80), average
 * colour (1.30), dark (1.55), black (1.75) and fluorescent (2.60), and the
 * two-part step (+0.45), are the factory price list's. Everything between
 * them — light vs medium, extra dark, special colours, the polyester, nylon
 * and acrylic routes, the finishing lines — is modelled around those anchors
 * and carries its own spread, so the result can say how sure it is.
 */
'use strict';

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ── 1. SHADE BANDS — cotton, reactive, one bath, USD per kg grey ──────────
// spread = the ± a buyer would see between dyehouses for the same band.
const BANDS = {
  white_optic:    { label: 'Optic white', what: 'peroxide bleach + optical brightener', usd: 0.80, spread: 0.08, anchor: true, seg: 'light', chem: 'bleach' },
  white_bleached: { label: 'Bleached white / RFD', what: 'peroxide bleach, no brightener (also the ready-for-dye base)', usd: 0.72, spread: 0.10, seg: 'light', chem: 'bleach' },
  ivory:          { label: 'Ivory / off-white', what: 'bleach, then a very light dye tint', usd: 0.95, spread: 0.10, seg: 'light', chem: 'bleach' },
  ecru:           { label: 'Ecru / natural', what: 'scour and soften only', usd: 0.50, spread: 0.15, seg: 'light', chem: 'scour' },
  melange_wash:   { label: 'Melange wash', what: 'scour + softener, no dye: the colour is already in the fibre', usd: 0.55, spread: 0.15, seg: 'light', chem: 'scour' },
  light:          { label: 'Light shade', what: 'up to about 0.5% dye on weight', usd: 1.15, spread: 0.08, seg: 'light' },
  light_medium:   { label: 'Average colour', what: 'light-to-medium, depth not specified', usd: 1.30, spread: 0.12, anchor: true, seg: 'medium' },
  medium:         { label: 'Medium shade', what: 'about 0.5–2% dye on weight', usd: 1.40, spread: 0.08, seg: 'medium' },
  dark:           { label: 'Dark shade', what: 'about 2–4% dye on weight', usd: 1.55, spread: 0.08, anchor: true, seg: 'dark' },
  extra_dark:     { label: 'Extra dark / deep navy', what: 'about 4–6% dye on weight, after-fixing', usd: 1.68, spread: 0.08, seg: 'dark' },
  black:          { label: 'Black', what: 'about 6–8% dye on weight, after-fixing', usd: 1.75, spread: 0.07, anchor: true, seg: 'dark' },
  fluorescent:    { label: 'Fluorescent', what: 'brilliant / fluorescent dyes, low-temperature, more reprocess', usd: 2.60, spread: 0.12, anchor: true, seg: 'medium' },
};
// %OWF → charge, through the bands above (continuous when a depth is given)
const OWF_CURVE = [[0.2, 1.15], [1.0, 1.40], [3.0, 1.55], [5.0, 1.68], [7.0, 1.75], [10.0, 1.85]];

const SPECIAL_ADD = 0.35;   // turquoise, brilliant royal, brilliant red, bright green: dearer dyes, more salt, longer runs
const TWO_PART_ADD = 0.45;  // price list: two-part minus one-part, the same on every band
const ELASTANE_DYE_ADD = 0.06; // lower temperature, gentler, longer run, elastane-safe auxiliaries

// ── colour → depth band, from the exact colour ────────────────────────────
function hexToLab(hex) {
  const m = String(hex || '').replace('#', '').match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const R = lin(n >> 16), G = lin((n >> 8) & 255), B = lin(n & 255);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const L = 116 * f(Y) - 16, a = 500 * (f(X) - f(Y)), b = 200 * (f(Y) - f(Z));
  const C = Math.hypot(a, b);
  let h = Math.atan2(b, a) * 180 / Math.PI; if (h < 0) h += 360;
  return { L, a, b, C, h };
}

/** Depth band a dyer would put this exact colour in (reactive on cotton). */
function bandFromColour(hex) {
  const lab = hexToLab(hex);
  if (!lab) return null;
  // a saturated colour carries more dye than its lightness alone suggests
  const Le = lab.L - 0.12 * lab.C;
  let band;
  if (lab.L < 24 && lab.C < 12) band = 'black';
  else if (Le > 70) band = 'light';
  else if (Le > 52) band = 'medium';
  else if (Le > 34) band = 'dark';
  else band = 'extra_dark';
  // the shades every dyehouse prices as "special"
  const { L, C, h } = lab;
  let special = null;
  if (h >= 185 && h <= 240 && C > 22 && L > 30) special = 'turquoise / aqua';
  else if (h >= 255 && h <= 305 && C > 45 && L > 22 && L < 62) special = 'brilliant royal blue';
  else if (h >= 15 && h <= 45 && C > 58 && L > 30) special = 'brilliant red';
  else if (h >= 125 && h <= 175 && C > 40 && L > 30) special = 'bright green';
  return { band, special, L: r2(L), C: r2(C), h: Math.round(h) };
}

function owfBand(owf) {
  return owf < 0.5 ? 'light' : owf < 2 ? 'medium' : owf < 4 ? 'dark' : owf < 6 ? 'extra_dark' : 'black';
}
function owfCharge(owf) {
  const c = OWF_CURVE;
  if (owf <= c[0][0]) return c[0][1];
  for (let i = 0; i < c.length - 1; i++) {
    if (owf <= c[i + 1][0]) { const t = (owf - c[i][0]) / (c[i + 1][0] - c[i][0]); return c[i][1] + t * (c[i + 1][1] - c[i][1]); }
  }
  return c[c.length - 1][1];
}

// ── 2. FIBRE → dyeing route ────────────────────────────────────────────────
function shares(fibers) {
  const f = fibers || { cotton: 100 };
  const g = (k) => Number(f[k]) || 0;
  const cell = g('cotton') + g('supima') + g('viscose') + g('modal') + g('tencel') + g('lyocell') + g('bamboo') + g('linen');
  const poly = g('polyester'), nylon = g('nylon') + g('polyamide'), acr = g('acrylic'), el = g('elastane') + g('spandex');
  const total = Object.values(f).reduce((s, v) => s + (Number(v) || 0), 0) || 100;
  const hard = Math.max(1, total - el);
  return { cell, poly, nylon, acr, el, total, hard, visc: g('viscose') + g('modal') + g('bamboo'), lyo: g('tencel') + g('lyocell') };
}

// single-route charges where the fibre is not cotton: factor on the cotton band,
// and the route's own neon / white figures
const ROUTES = {
  reactive: { label: 'Reactive (cellulose), one bath', factor: 1.00, fluo: 2.60, white: null, spread: 0 },
  disperse: { label: 'Disperse, high-temperature 130 °C (polyester)', factor: 0.82, fluo: 1.65, white: 0.70, spread: 0.06 },
  acid:     { label: 'Acid dyes, 98 °C (nylon)', factor: 0.90, fluo: 1.90, white: 0.75, spread: 0.08 },
  cationic: { label: 'Cationic dyes (acrylic)', factor: 0.86, fluo: 1.80, white: 0.72, spread: 0.10 },
  two_part: { label: 'Two-part: disperse for the polyester + reactive for the cotton', factor: 1.00, fluo: 2.90, white: 1.05, spread: 0.04 },
};

function dyeRoute(fibers) {
  const s = shares(fibers);
  const ps = s.poly / s.hard, ns = s.nylon / s.hard, as = s.acr / s.hard, cs = s.cell / s.hard;
  if (cs >= 0.85) return { key: 'reactive', ...ROUTES.reactive, s };
  if (ps >= 0.85) return { key: 'disperse', ...ROUTES.disperse, s };
  if (ns >= 0.85) return { key: 'acid', ...ROUTES.acid, s };
  if (as >= 0.85) return { key: 'cationic', ...ROUTES.cationic, s };
  // a blend of a synthetic with a cellulose: two baths
  if ((s.poly >= 10 || s.nylon >= 10) && s.cell >= 30) {
    return { key: 'two_part', ...ROUTES.two_part, label: s.nylon > s.poly
      ? 'Two-part: acid for the nylon + reactive for the cotton' : ROUTES.two_part.label, s };
  }
  // what is left: a cellulose-led blend with a little synthetic (dyed as the cellulose)
  if (cs >= ps && cs >= ns) return { key: 'reactive', ...ROUTES.reactive, label: 'Reactive (the minor synthetic stays light)', s, spread: 0.06 };
  return { key: 'disperse', ...ROUTES.disperse, s, spread: 0.10 };
}

/**
 * Dyeing charge, USD per kg of grey fabric.
 *
 * @param {object} a
 *   shade        six-tier key (black, dark_navy, light_medium, fluorescent, white_melange, melange)
 *   spec         shade-spec.js result (white type, melange carrier) — optional
 *   colorHex     the exact colour — optional; sets the depth band and finds specials
 *   depthOwf     dye % on weight — optional; overrides the colour
 *   dyeBand      the user's own band: light | medium | dark | extra_dark | special
 *   fibers       parsed composition
 *   dyeingMethod reactive | pigment | discharge | disperse | garment_wash
 *   surfaceFinish finish id (enzyme_wash and silicone happen in the dye machine)
 */
function dyeingCharge(a = {}) {
  const shade = String(a.shade || 'light_medium').toLowerCase();
  const spec = a.spec || null;
  const route = dyeRoute(a.fibers);
  const lines = [];
  let bandKey, special = null, colourRead = null, how;

  if (shade === 'white_melange' || shade === 'white' || shade === 'light') {
    const t = spec && spec.white ? spec.white.type : 'optic';
    bandKey = { optic: 'white_optic', bleached: 'white_bleached', ivory: 'ivory', ecru: 'ecru' }[t] || 'white_optic';
    how = 'the white chosen';
  } else if (shade === 'melange') {
    const carrier = spec && spec.melange ? spec.melange.carrier : null;
    // a cross-dyed heather IS dyed (the cotton takes the colour, the polyester stays white)
    bandKey = carrier === 'cross_dye' ? 'light_medium' : 'melange_wash';
    how = carrier === 'cross_dye' ? 'cross-dyed heather: the cotton is dyed' : 'fibre-blend melange: washed, not dyed';
  } else if (shade === 'fluorescent') {
    bandKey = 'fluorescent'; how = 'fluorescent';
  } else {
    const band = String(a.dyeBand || '').toLowerCase();
    if (a.colorHex) colourRead = bandFromColour(a.colorHex);
    if (a.depthOwf != null && Number.isFinite(+a.depthOwf)) {
      bandKey = owfBand(+a.depthOwf); how = `${+a.depthOwf}% dye on weight`;
    } else if (['light', 'medium', 'dark', 'extra_dark'].includes(band)) {
      bandKey = band; how = 'depth band chosen';
    } else if (colourRead) {
      bandKey = colourRead.band; how = `read from the exact colour (L* ${colourRead.L}, chroma ${colourRead.C})`;
    } else {
      bandKey = shade === 'black' ? 'black' : (shade === 'dark_navy' || shade === 'dark') ? 'dark' : 'light_medium';
      how = band === 'special' ? 'special colour chosen' : 'shade tier';
    }
    // the tier sets a floor: a "black" order is never charged as a medium
    if (shade === 'black' && !['black', 'extra_dark'].includes(bandKey)) bandKey = 'extra_dark';
    if (band === 'special') special = (colourRead && colourRead.special) || 'special colour';
    else if (colourRead && colourRead.special) special = colourRead.special;
  }

  const B = BANDS[bandKey];
  let base = B.usd;
  if (a.depthOwf != null && Number.isFinite(+a.depthOwf) && !['white_melange', 'melange', 'fluorescent'].includes(shade)) base = owfCharge(+a.depthOwf);
  let spread = B.spread;

  // the route
  let routeUsd;
  const isWhite = bandKey.startsWith('white');
  const noDye = bandKey === 'melange_wash' || bandKey === 'ecru';
  const twoBaths = route.key === 'two_part' && !isWhite && !noDye && bandKey !== 'fluorescent';
  if (bandKey === 'fluorescent') routeUsd = route.fluo;
  else if (isWhite && route.white != null) routeUsd = route.white;
  else if (noDye) routeUsd = base * (route.key === 'reactive' || route.key === 'two_part' ? 1 : 0.85);
  else if (twoBaths) routeUsd = base + TWO_PART_ADD;
  else routeUsd = base * route.factor;
  lines.push({ item: `${B.label} — ${twoBaths ? 'reactive bath for the cellulose' : route.label}`, usd: r3(twoBaths ? base : routeUsd) });
  if (twoBaths) lines.push({ item: route.s.nylon > route.s.poly ? 'Second bath for the nylon (acid)' : 'Second bath for the polyester (disperse, 130 °C)', usd: TWO_PART_ADD });
  spread = Math.sqrt(spread * spread + (route.spread || 0) ** 2);
  let usd = routeUsd;

  if (special && !['black', 'fluorescent'].includes(bandKey) && !isWhite && !noDye) {
    usd += SPECIAL_ADD; lines.push({ item: `Special colour (${special}) — dearer dyes, more salt, longer run`, usd: SPECIAL_ADD });
    spread = Math.max(spread, 0.10);
  }
  if (route.s.el > 0 && !noDye) {
    usd += ELASTANE_DYE_ADD; lines.push({ item: 'Elastane in the cloth — gentler, longer run', usd: ELASTANE_DYE_ADD });
  }
  if (route.s.lyo / route.s.hard > 0.3) {
    usd += 0.15; lines.push({ item: 'Lyocell — enzyme defibrillation, rope-mark care', usd: 0.15 });
  }

  // in-machine finishes
  const sf = String(a.surfaceFinish || '');
  if (sf === 'enzyme_wash') { usd += 0.12; lines.push({ item: 'Enzyme / bio-polish in the dye bath', usd: 0.12 }); }
  if (sf === 'silicone') { usd += 0.05; lines.push({ item: 'Silicone softener', usd: 0.05 }); }

  // printing routes replace or add to the dyeing
  const dm = String(a.dyeingMethod || '');
  let note = null;
  if (dm === 'pigment') {
    const rfd = BANDS.white_bleached.usd;
    lines.length = 0;
    lines.push({ item: 'Ready-for-print base (bleached, no brightener)', usd: rfd }, { item: 'Pigment print (all-over), cured', usd: 1.00 });
    usd = rfd + 1.00 + (route.s.el > 0 ? ELASTANE_DYE_ADD : 0); spread = 0.18; bandKey = 'white_bleached';
    note = 'Pigment-printed: the ground is a ready-for-print white, the colour is the print.';
  } else if (dm === 'discharge') {
    usd += 1.30; lines.push({ item: 'Discharge print on the dyed ground', usd: 1.30 }); spread = Math.max(spread, 0.18);
  } else if (dm === 'garment_wash') {
    lines.length = 0;
    lines.push({ item: 'Fabric sold ready-for-dye (bleached); the colour goes on in garment form', usd: BANDS.white_bleached.usd });
    usd = BANDS.white_bleached.usd; spread = 0.10; bandKey = 'white_bleached';
    note = 'Garment-dyed or washed: the fabric is priced as RFD; garment dyeing is a garment cost.';
  }

  return {
    per_kg: r3(usd),
    band: bandKey,
    band_label: special && !isWhite && !noDye && !['black', 'fluorescent'].includes(bandKey) ? `Special colour (${B.label.toLowerCase()} depth)` : B.label,
    band_what: B.what,
    how,
    special,
    colour: colourRead,
    route: route.key, route_label: route.label,
    lines,
    spread_pct: r2(spread * 100),
    range: { low: r2(usd * (1 - spread)), high: r2(usd * (1 + spread)) },
    basis: B.anchor && !special && route.key === 'reactive' ? 'price list' : 'modelled on the price list',
    segment: B.seg,
    chem: B.chem || 'dye',
    note,
  };
}

// ── 3. FINISHING ───────────────────────────────────────────────────────────
const FINISH = {
  tubular:   { usd: 0.14, label: 'Tubular finishing — de-water, dry, tube compacting' },
  open:      { usd: 0.22, label: 'Open-width finishing — slit, stenter, open compacting' },
  heat_set:  { usd: 0.12, label: 'Heat-setting (stenter pass) — elastane / polyester' },
  brush:     { usd: 0.18, label: 'Brushing / raising (per side)' },
  shear:     { usd: 0.09, label: 'Shearing' },
  velour:    { usd: 0.25, label: 'Pile cutting / velour shearing' },
  peach:     { usd: 0.16, label: 'Peach / emery finish' },
  vintage:   { usd: 0.30, label: 'Vintage wash' },
  mercerize: { usd: 0.40, label: 'Knit mercerising' },
  singe:     { usd: 0.08, label: 'Fabric singeing' },
  resin:     { usd: 0.10, label: 'Resin / stiff finish' },
};
const OPEN_WIDTH_FABRICS = /fleece|terry|velour|plush|ponte|pique_double|interlock_pique|lacoste|jacquard|spacer|scuba|mesh/;

function finishingCharge(a = {}) {
  const s = shares(a.fibers);
  const fid = String(a.fabricId || '');
  const route = String(a.finishingRoute || '');
  const lines = [];
  if (route === 'greige') {
    return { per_kg: 0, lines: [{ item: 'Greige — sold unfinished', usd: 0 }], width: 'greige', spread_pct: 0, range: { low: 0, high: 0 } };
  }
  const polyLed = (s.poly + s.nylon) / s.hard >= 0.5;
  const open = s.el > 0 || OPEN_WIDTH_FABRICS.test(fid) || route === 'heat_set' || polyLed;
  lines.push({ item: open ? FINISH.open.label : FINISH.tubular.label, usd: open ? FINISH.open.usd : FINISH.tubular.usd });
  if (s.el > 0 || route === 'heat_set' || polyLed) lines.push({ item: FINISH.heat_set.label, usd: FINISH.heat_set.usd });
  const sides = Number.isFinite(+a.brushSides) && +a.brushSides > 0 ? Math.min(2, +a.brushSides) : 1;
  if (a.brushed) lines.push({ item: sides > 1 ? `${FINISH.brush.label} × 2` : FINISH.brush.label, usd: FINISH.brush.usd * sides });
  if (a.velourCut) lines.push({ item: FINISH.velour.label, usd: FINISH.velour.usd });
  else if (a.sheared) lines.push({ item: FINISH.shear.label, usd: FINISH.shear.usd });
  const sf = String(a.surfaceFinish || '');
  const SF = { peach_finish: 'peach', brushed: 'brush', vintage_wash: 'vintage', mercerized: 'mercerize', singed: 'singe', resin: 'resin' };
  if (SF[sf] && !(sf === 'brushed' && a.brushed)) lines.push({ item: FINISH[SF[sf]].label, usd: FINISH[SF[sf]].usd });
  const gsm = +a.gsm || 0;
  if (gsm > 300) lines.push({ item: 'Heavy fabric (>300 g/m²) — slower stenter and compactor', usd: 0.08 });
  else if (gsm > 250) lines.push({ item: 'Heavy fabric (>250 g/m²) — slower stenter and compactor', usd: 0.04 });
  const usd = lines.reduce((t, l) => t + l.usd, 0);
  const spread = 0.20;
  return {
    per_kg: r3(usd), lines: lines.map((l) => ({ ...l, usd: r3(l.usd) })), width: open ? 'open' : 'tubular',
    spread_pct: spread * 100, range: { low: r2(usd * (1 - spread)), high: r2(usd * (1 + spread)) },
  };
}

// ── 4. PROCESS LOSS ────────────────────────────────────────────────────────
// The factory bulk medians (production-data.js) are cotton. A cotton loses
// ~5.5% of its weight in the bath (wax, pectin, protein, fines); the rest of
// the median is handling — selvedge and pin-mark trimming, sampling, re-dye
// cuts. A synthetic loses its spin finish and little else.
const SEG_BASE = { light: 11.0, medium: 12.5, dark: 14.0 };
const COTTON_CHEM = { bleach: 6.5, dye: 5.5, scour: 3.5 };
const FIBRE_CHEM = { visc: 3.0, poly: 1.0, nylon: 1.0, acr: 1.0, el: 1.5 };
const PROCESS_ADD = { aop: 4.5, garment_wash: 2.5, brush: 1.5, peach: 1.0, singe: 0.5 };
const PROCESS_LABEL = { aop: 'All-over print', garment_wash: 'Garment wash', brush: 'Brushing — fibre fly', peach: 'Peaching — dust', singe: 'Singeing' };

function processLoss(a = {}) {
  const seg = SEG_BASE[a.segment] != null ? a.segment : 'medium';
  const s = shares(a.fibers);
  const cot = Math.max(0, s.cell - s.visc - s.lyo);
  const cottonChem = COTTON_CHEM[a.chem] != null ? COTTON_CHEM[a.chem] : COTTON_CHEM.dye;
  const handling = SEG_BASE[seg] - COTTON_CHEM.dye;
  const T = s.total || 100;
  const chem = (cot * cottonChem + (s.visc + s.lyo) * FIBRE_CHEM.visc + s.poly * FIBRE_CHEM.poly
    + s.nylon * FIBRE_CHEM.nylon + s.acr * FIBRE_CHEM.acr + s.el * FIBRE_CHEM.el) / T;
  const parts = [
    { item: `Handling — trimming, sampling, re-dye cuts (${seg} shades)`, pct: r2(handling) },
    { item: 'Lost by the fibre in the bath', pct: r2(chem) },
  ];
  let add = 0;
  if (a.twoPart) { add += 1.0; parts.push({ item: 'Two baths — extra handling', pct: 1.0 }); }
  if (s.el > 0) { add += 0.5; parts.push({ item: 'Open width with elastane — wider edge trim', pct: 0.5 }); }
  for (const p of (a.processes || [])) {
    if (PROCESS_ADD[p] != null) { add += PROCESS_ADD[p]; parts.push({ item: PROCESS_LABEL[p], pct: PROCESS_ADD[p] }); }
  }
  const total = clamp(handling + chem + add, 4, 25);
  // the bath half is lost before finishing, the rest after
  const dyePct = clamp(chem + 0.4 * handling + (a.twoPart ? 1.0 : 0), 0, total);
  return {
    loss_pct: r2(total),
    dye_stage_pct: r2(dyePct),
    finish_stage_pct: r2(100 * (1 - (1 - total / 100) / (1 - dyePct / 100))),
    segment: seg, parts,
    spread_pp: 1.5,
  };
}

module.exports = { dyeingCharge, finishingCharge, processLoss, bandFromColour, dyeRoute, BANDS, ROUTES, hexToLab };
