/**
 * KnitAdvisor — Colour target engine: a colour given the way a buyer gives it (a Pantone TCX code or name, a Lab reading, an RGB or
 * a hex) turned into what the rest of the Studio needs: the colour on screen, the depth of shade, the dye amount, and a check of a
 * lab dip against it.
 *
 *   1  PARSE      "19-4052", "classic blue", "#0f4c81", "rgb(15 76 129)", "L 31 a 2 b -35" (D50 or D65), or the same as fields.
 *                 Lab is converted through XYZ (the D50 → D65 white by the Bradford matrix) to the screen's sRGB; a colour the screen
 *                 cannot show is said to be out of gamut and shown clipped.
 *   2  DESCRIBE   Lab in both whites, LCh, a hue and chroma in words, and the nearest catalogue colours by CIEDE2000.
 *   3  DEPTH      the luminance gives the K/S of the shade (K/S = (1−R)² / 2R, law) and so the depth class — white, pastel, light,
 *                 medium, dark, black — that the yarn chemistry and look engines work in; the dye on the weight of fibre is read off
 *                 the nominal amounts of the depth ladder, interpolated in K/S (estimate: one dye on one cotton, no strength factor).
 *   4  CHECKS     what a colour of this lightness and chroma asks of the dyehouse (typical conventions, said so).
 *   5  LAB DIP    a trial colour against the target: ΔE00, the difference in words, a pass or fail against the tolerance, and how much
 *                 more or less dye the same dye would need to reach the target's depth (K/S ratio; it cannot move the hue).
 *
 * Basis: law = colour science arithmetic; typical = an industry convention; estimate = a model not calibrated on the mill's own
 * recipes. The catalogue colours are approximate screen values: the physical swatch, or the mill's own Lab file, rules.
 */
'use strict';

const CE = require('./color-engine');
const MEL = require('./melange-engine');
const CH = require('./yarn-chemistry-engine');
const { TCX_COLORS } = require('../catalog/tcx-database');

class ColourError extends Error { constructor(m) { super(m); this.name = 'ColourError'; } }

const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const V = (value, unit, basis, extra) => (value == null || !Number.isFinite(value) ? null : { value, unit, basis, ...(extra || {}) });

// ── colour arithmetic ─────────────────────────────────────────────────────────────────────────────
const W65 = [0.95047, 1, 1.08883], W50 = [0.96422, 1, 0.82521];
const D50_TO_D65 = [[0.9555766, -0.0230393, 0.0631636], [-0.0282895, 1.0099416, 0.0210077], [0.0122982, -0.0204830, 1.3299098]];
const D65_TO_D50 = [[1.0478112, 0.0228866, -0.0501270], [0.0295424, 0.9904844, -0.0170491], [-0.0092345, 0.0150436, 0.7521316]];
const mul = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
const finv = (t) => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27));
const xyzToLab = (xyz, W) => { const fx = f(xyz[0] / W[0]), fy = f(xyz[1] / W[1]), fz = f(xyz[2] / W[2]); return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; };
const labToXyz = (lab, W) => { const fy = (lab[0] + 16) / 116, fx = fy + lab[1] / 500, fz = fy - lab[2] / 200; return [W[0] * finv(fx), W[1] * finv(fy), W[2] * finv(fz)]; };
const RGB2XYZ = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.072175], [0.0193339, 0.119192, 0.9503041]];
const XYZ2RGB = [[3.2404542, -1.5371385, -0.4985314], [-0.969266, 1.8760108, 0.041556], [0.0556434, -0.2040259, 1.0572252]];
const toLin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const toSrgb = (v) => { const c = clamp(v, 0, 1); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); };
const hexOf = (lin) => '#' + lin.map((v) => toSrgb(v).toString(16).padStart(2, '0')).join('');
const rgbOfHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const labOfLin = (lin) => xyzToLab(mul(RGB2XYZ, lin), W65);
const labD65OfHex = (h) => labOfLin(rgbOfHex(h).map(toLin));

// ── parsing ──────────────────────────────────────────────────────────────────────────────────────
const num = '(-?\\d+(?:\\.\\d+)?)';
function parseText(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) throw new ColourError('Give a colour: a Pantone TCX code or name, a hex, an RGB, or a Lab reading such as "L 45 a 10 b -20".');
  let m;
  if ((m = t.match(/^#?([0-9a-f]{6})$/i))) return { kind: 'hex', hex: '#' + m[1].toLowerCase() };
  if ((m = t.match(/^#?([0-9a-f]{3})$/i)) && /[a-f#]/i.test(t)) return { kind: 'hex', hex: '#' + m[1].split('').map((c) => c + c).join('').toLowerCase() };
  if ((m = t.match(new RegExp('^rgb\\s*\\(?\\s*' + num + '[\\s,;]+' + num + '[\\s,;]+' + num + '\\s*\\)?$', 'i')))) return { kind: 'rgb', rgb: [+m[1], +m[2], +m[3]] };
  if ((m = t.match(new RegExp('^(?:cie)?lab\\s*\\(?\\s*' + num + '[\\s,;]+' + num + '[\\s,;]+' + num + '\\s*\\)?$', 'i')))) return { kind: 'lab', lab: [+m[1], +m[2], +m[3]] };
  if ((m = t.match(new RegExp('^L\\*?\\s*[:=]?\\s*' + num + '[\\s,;]*a\\*?\\s*[:=]?\\s*' + num + '[\\s,;]*b\\*?\\s*[:=]?\\s*' + num + '$', 'i')))) return { kind: 'lab', lab: [+m[1], +m[2], +m[3]] };
  if ((m = t.match(/(\d{2})-(\d{4})/))) return { kind: 'tcx', code: m[1] + '-' + m[2] };
  return { kind: 'name', name: t };
}

function resolve(raw, illuminant) {
  let p;
  if (raw && typeof raw === 'object') {
    if (typeof raw.text === 'string') p = parseText(raw.text);
    else if (raw.pantone || raw.tcx || raw.code) p = { kind: 'tcx', code: String(raw.pantone || raw.tcx || raw.code) };
    else if (Array.isArray(raw.lab) && raw.lab.length >= 3) p = { kind: 'lab', lab: raw.lab.slice(0, 3).map(Number) };
    else if (Array.isArray(raw.rgb) && raw.rgb.length >= 3) p = { kind: 'rgb', rgb: raw.rgb.slice(0, 3).map(Number) };
    else if (typeof raw.hex === 'string') p = parseText(raw.hex);
    else if (typeof raw.name === 'string') p = { kind: 'name', name: raw.name };
    else throw new ColourError('Give a colour: a Pantone TCX code or name, a hex, an RGB, or a Lab reading.');
    illuminant = raw.illuminant || illuminant;
  } else p = parseText(raw);
  const ill = illuminant === 'D65' ? 'D65' : 'D50';
  let lin, source, exact = null;
  if (p.kind === 'hex') { lin = rgbOfHex(p.hex).map(toLin); source = 'a hex colour'; }
  else if (p.kind === 'rgb') {
    if (p.rgb.some((v) => !(v >= 0 && v <= 255))) throw new ColourError('RGB values run from 0 to 255.');
    lin = p.rgb.map(toLin); source = 'an RGB colour';
  } else if (p.kind === 'lab') {
    const [L, a, b] = p.lab;
    if (!(L >= 0 && L <= 100) || !(Math.abs(a) <= 160 && Math.abs(b) <= 160)) throw new ColourError('A Lab reading has L between 0 and 100 and a, b within ±160.');
    const xyz65 = ill === 'D65' ? labToXyz(p.lab, W65) : mul(D50_TO_D65, labToXyz(p.lab, W50));
    lin = mul(XYZ2RGB, xyz65); source = `a Lab reading (${ill})`;
  } else {
    let e = null;
    if (p.kind === 'tcx') {
      const hit = CE.lookupTCX(p.code);
      if (!hit) throw new ColourError(`"${p.code}" is not in the catalogue: check the code, or give the colour as a Lab reading or a hex.`);
      e = { code: hit.code, name: hit.name, hex: hit.hex.toLowerCase() };
    } else {
      const hits = CE.searchByName(p.name, 1);
      if (!hits.length) throw new ColourError(`No catalogue colour is called "${p.name}": give a TCX code, a hex, or a Lab reading.`);
      e = { code: hits[0].code, name: hits[0].name, hex: hits[0].hex.toLowerCase() };
    }
    lin = rgbOfHex(e.hex).map(toLin); source = 'a catalogue colour'; exact = e;
  }
  const inGamut = lin.every((v) => v >= -0.002 && v <= 1.002);
  const hex = hexOf(lin);
  return { lin, hex, inGamut, source, exact, ill };
}

// ── the nearest catalogue colours (CIEDE2000) ──────────────────────────────────────────────────────
let TCX_LAB = null;
function nearest(lab, n) {
  if (!TCX_LAB) { const seen = new Set(); TCX_LAB = []; TCX_COLORS.forEach((e) => { if (seen.has(e.c) || !/^#[0-9a-f]{6}$/i.test(e.h)) return; seen.add(e.c); TCX_LAB.push({ code: e.c, name: e.n, hex: e.h.toLowerCase(), lab: labD65OfHex(e.h) }); }); }
  return TCX_LAB.map((e) => ({ e, d: Math.abs(e.lab[0] - lab[0]) < 12 ? MEL.dE00(lab, e.lab) : 99 })).sort((a, b) => a.d - b.d).slice(0, n).map((x) => ({ code: x.e.code, name: x.e.name, hex: x.e.hex, delta_e00: r2(x.d) }));
}

// ── depth ──────────────────────────────────────────────────────────────────────────────────────────
const DEPTH_Y = { white: 0.85, pastel: 0.6, light: 0.4, medium: 0.2, dark: 0.08, black: 0.04 };
const IDS = CH.DEPTHS;
const ks = (Y) => { const R = clamp(Y, 0.004, 0.98); return (1 - R) * (1 - R) / (2 * R); };
const ANCHOR_KS = IDS.map((id) => ks(DEPTH_Y[id]));
function depthOf(Y) {
  const k = ks(Y);
  let best = 0, bd = Infinity;
  ANCHOR_KS.forEach((a, i) => { const d = Math.abs(Math.log(a + 1e-3) - Math.log(k + 1e-3)); if (d < bd) { bd = d; best = i; } });
  return { id: IDS[best], index: best, ks: k };
}
/** The dye on the weight of fibre at a given K/S, per dye class, by interpolation along the depth ladder. */
function owfAt(k) {
  const out = {};
  Object.keys(CH.OWF).forEach((cls) => {
    const row = CH.OWF[cls];
    if (k <= ANCHOR_KS[1]) { out[cls] = r2(row[1] * Math.max(0, k) / ANCHOR_KS[1]); return; }
    let i = 1; while (i < ANCHOR_KS.length - 2 && k > ANCHOR_KS[i + 1]) i++;
    const a = ANCHOR_KS[i], b = ANCHOR_KS[i + 1], t = clamp((Math.log(k) - Math.log(a)) / (Math.log(b) - Math.log(a)), 0, 1.3);
    out[cls] = r2(row[i] + (row[i + 1] - row[i]) * t);
  });
  return out;
}

const HUES = [[20, 'red'], [50, 'orange'], [75, 'yellow'], [110, 'yellow-green'], [160, 'green'], [200, 'teal'], [235, 'cyan-blue'], [300, 'blue'], [330, 'violet'], [352, 'magenta'], [361, 'red']];
const hueWord = (h) => HUES.find((x) => h < x[0])[1];
const chromaWord = (C) => (C < 6 ? 'neutral' : C < 22 ? 'muted' : C < 45 ? 'moderate' : C < 70 ? 'vivid' : 'very vivid');
const lightWord = (L) => (L < 20 ? 'very dark' : L < 38 ? 'dark' : L < 58 ? 'medium' : L < 78 ? 'light' : 'very light');

function describe(rs) {
  const lab = labOfLin(rs.lin), C = Math.hypot(lab[1], lab[2]), h = (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360;
  const Y = mul(RGB2XYZ, rs.lin)[1];
  const lab50 = xyzToLab(mul(D65_TO_D50, mul(RGB2XYZ, rs.lin)), W50);
  return { lab, lab50, C, h, Y };
}

function analyse(input) {
  const spec = input && typeof input === 'object' ? input : { text: input };
  const rs = resolve(spec.target || spec, spec.illuminant);
  const d = describe(rs), dep = depthOf(d.Y);
  const word = C0(d.C) ? 'grey' : hueWord(d.h);
  function C0(C) { return C < 6; }
  const checks = [];
  const say = (level, text) => checks.push({ level, text });
  if (!rs.inGamut) say('warn', 'This colour lies outside what an sRGB screen can show: the swatch is clipped to the nearest colour it can. The dyes are not limited by the screen — judge it against the physical swatch.');
  if (d.C > 90) say('warn', 'A chroma this high (fluorescent range) is not reached by ordinary dyes on cotton: it needs fluorescent dyes, and the light fastness is poor.');
  else if (d.C > 65 && d.Y < 0.3) say('note', `A vivid dark colour (chroma ${r1(d.C)}): the dyes that reach it are few; check the light and wash fastness at this depth.`);
  if (d.lab[0] > 93 && d.C < 5) say('note', 'This is a white: it is bleached and brightened (optical brightener), not dyed. Whiteness and tint are the measures, not a dye amount.');
  else if (d.lab[0] < 18) say('warn', 'A deep black or navy: 6–8 % dye on the weight of fibre on cotton, a salt-heavy bath and a hard wash-off. Wet rubbing is the risk (grade 2–3 is common); a polyester takes a disperse dye at 130 °C.');
  if (d.lab[0] > 80 && d.C < 25 && d.lab[0] <= 93) say('note', 'A pastel: a tenth of a per cent of dye is a visible shift, so weigh the dye and the liquor exactly, and hold the lot tolerance tight (ΔE00 under 0.8).');
  if (d.C < 6 && d.lab[0] > 18 && d.lab[0] < 80) say('note', 'A neutral grey is easily pushed warm or cool by a small dye imbalance: it is a three-dye recipe and the most sensitive to the water and the lot.');
  const owf = owfAt(dep.ks);
  const out = {
    success: true,
    colour: { hex: rs.hex, lab: d.lab.map(r1), lab_d50: d.lab50.map(r1), rgb: rgbOfHex(rs.hex), lch: { L: r1(d.lab[0]), C: r1(d.C), h: r1(d.h) }, luminance_Y: r3(d.Y), in_gamut: rs.inGamut, source: rs.source,
      words: `${lightWord(d.lab[0])}, ${chromaWord(d.C)} ${word}`, catalogue: rs.exact ? { ...rs.exact, note: 'the catalogue holds an approximate screen value: the physical swatch rules' } : null },
    nearest: nearest(d.lab, 4),
    depth: { id: dep.id, label: CH.DEPTH_LABEL ? CH.DEPTH_LABEL[dep.id] : dep.id, ks: V(r3(dep.ks), 'K/S', 'law'), chemistry_shade: dep.id, look_shade: dep.id,
      dye_owf: Object.fromEntries(Object.entries(owf).map(([k, v]) => [k, V(v, '% on the weight of fibre', 'estimate')])),
      nominal_owf: Object.fromEntries(Object.keys(CH.OWF).map((k) => [k, V(CH.OWF[k][dep.index], '% on the weight of fibre', 'typical')])),
      note: 'K/S = (1−R)² ÷ 2R from the luminance. The dye amount is read off the depth ladder of the chemistry engine, interpolated in K/S, for one dye on one fibre; the dye\'s own strength and the fibre\'s fineness move it, and a trial dyeing replaces it.' },
    checks, derivations: [],
  };
  out.derivations.push(
    { id: 'lab', quantity: 'Lab (D65)', formula: 'sRGB → XYZ → L*a*b*', working: `${rs.hex} → ${d.lab.map(r1).join(', ')}`, result: d.lab.map(r1).join(' '), unit: '', basis: 'law' },
    { id: 'ks', quantity: 'K/S of the shade', formula: 'K/S = (1 − R)² ÷ 2R, R = Y', working: `(1 − ${r3(d.Y)})² ÷ ${r3(2 * d.Y)}`, result: r3(dep.ks), unit: 'K/S', basis: 'law' },
    { id: 'owf', quantity: 'Dye on the weight of fibre (reactive)', formula: 'interpolated in K/S along the depth ladder', working: `between the ${IDS[Math.max(1, dep.index)]} and neighbouring rungs`, result: owf.reactive, unit: '% owf', basis: 'estimate' });
  // a lab dip against it
  const trialRaw = spec.trial;
  if (trialRaw && (typeof trialRaw !== 'string' || trialRaw.trim()) && !(typeof trialRaw === 'object' && !Object.keys(trialRaw).length)) {
    const tr = resolve(trialRaw, (trialRaw && trialRaw.illuminant) || spec.illuminant), td = describe(tr);
    const dE = MEL.dE00(d.lab, td.lab), tol = +spec.tolerance > 0 ? +spec.tolerance : 1.0;
    const dL = td.lab[0] - d.lab[0], da = td.lab[1] - d.lab[1], db = td.lab[2] - d.lab[2], dC = td.C - d.C;
    const dH = Math.sqrt(Math.max(0, da * da + db * db - dC * dC)) * Math.sign(((td.h - d.h + 540) % 360) - 180);
    const w = [];
    if (Math.abs(dL) > 0.4) w.push(dL > 0 ? 'lighter' : 'darker');
    if (Math.abs(dC) > 0.6) w.push(dC > 0 ? 'brighter (more chroma)' : 'duller (less chroma)');
    if (Math.abs(da) > 0.6) w.push(da > 0 ? 'redder' : 'greener');
    if (Math.abs(db) > 0.6) w.push(db > 0 ? 'yellower' : 'bluer');
    const kT = ks(td.Y), corr = (dep.ks / kT - 1) * 100;
    out.trial = {
      hex: tr.hex, lab: td.lab.map(r1), delta_e00: V(r2(dE), 'ΔE00', 'law'), tolerance: V(tol, 'ΔE00', 'typical'), pass: dE <= tol,
      dL: r2(dL), da: r2(da), db: r2(db), dC: r2(dC), dH: r2(dH), says: w.length ? 'The lab dip is ' + w.join(', ') + ' against the target.' : 'The lab dip is on the target.',
      dye_correction_pct: V(r1(corr), '% of the dye in the bath (same dye, depth only)', 'estimate'),
      advice: dE <= tol ? 'Within tolerance: pass.' : Math.abs(corr) > 4 ? `Out of tolerance. The depth is ${corr > 0 ? 'short' : 'over'}: ${corr > 0 ? 'add' : 'take off'} about ${r1(Math.abs(corr))} % of the dye, then re-dip. The hue is not moved by this — if it is off, the dye ratio is.` : 'Out of tolerance with the depth about right: the HUE is off — adjust the ratio of the dyes, not the amount.',
    };
    out.derivations.push({ id: 'de', quantity: 'ΔE00 of the lab dip', formula: 'CIEDE2000(target, trial)', working: `${d.lab.map(r1).join(',')} against ${td.lab.map(r1).join(',')}`, result: r2(dE), unit: 'ΔE00', basis: 'law' });
  } else out.trial = null;
  return out;
}

/** The Studio join: what the colour target sets in the cards that work in colour. */
function applyToInput(input) {
  const spec = input && input.colour && typeof input.colour === 'object' && !Array.isArray(input.colour) ? input.colour : null;
  if (!spec || spec.enabled === false) return { input, result: null };
  let res;
  try { res = analyse(spec); } catch (e) { if (e instanceof ColourError) return { input, result: { success: false, error: e.message } }; throw e; }
  const next = { ...input };
  const hex = res.colour.hex, shade = res.depth.chemistry_shade;
  next.look = { ...(input.look || {}), colour: hex, shade };
  if (input.chemistry && input.chemistry.enabled) next.chemistry = { ...input.chemistry, shade };
  if (input.melange && typeof input.melange === 'object') {
    next.melange = { ...input.melange };
    ['ground', 'binder', 'loop', 'plate'].forEach((r) => { const m = next.melange[r]; if (m && typeof m === 'object' && m.enabled !== false && !(m.target && m.target.colour) && !m.target_spectrum) next.melange[r] = { ...m, target: { ...(m.target || {}), colour: hex } }; });
  }
  res.applied = { look: true, chemistry: !!(input.chemistry && input.chemistry.enabled), melange: !!input.melange };
  return { input: next, result: res };
}

function catalogue() {
  return {
    formats: [
      { id: 'tcx', label: 'Pantone TCX code or name', example: '19-4052  ·  classic blue' }, { id: 'hex', label: 'Hex', example: '#0f4c81' }, { id: 'rgb', label: 'RGB', example: 'rgb(15 76 129)' },
      { id: 'lab', label: 'Lab (D50 or D65)', example: 'L 31 a 2 b -35' },
    ],
    illuminants: [{ id: 'D50', label: 'D50 (print and swatch books)' }, { id: 'D65', label: 'D65 (daylight, screens)' }],
    depths: IDS.map((id) => ({ id, label: CH.DEPTH_LABEL ? CH.DEPTH_LABEL[id] : id })),
  };
}

module.exports = { analyse, applyToInput, catalogue, parseText, ColourError };
