'use strict';
/**
 * Spectral colour: a reflectance curve (400–700 nm, 31 bands at 10 nm) in, a colour out, and the one check an RGB
 * colour can never make — metamerism (two fabrics that match under daylight and part under a shop light).
 *
 * Used by the melange engine so that a colour matcher can type what a spectrophotometer prints, and the blend is
 * mixed wavelength by wavelength (Kubelka–Munk per band) instead of per RGB channel.
 *
 * Tables: CIE 1931 2° observer, CIE standard illuminant D65, and illuminant A from its defining formula
 * (Planckian radiator at 2848 K, c2 = 1.4350e-2 m·K). Each illuminant is normalised to ITS OWN tabulated white, so a
 * perfect reflector is exactly white whatever the sampling error of the 10 nm tables.
 */

const WL = Array.from({ length: 31 }, (_, i) => 400 + 10 * i);
const XB = [0.01431, 0.04351, 0.13438, 0.28390, 0.34828, 0.33620, 0.29080, 0.19536, 0.09564, 0.03201, 0.00490, 0.00930, 0.06327, 0.16550, 0.29040, 0.43345, 0.59450, 0.76210, 0.91630, 1.02630, 1.06220, 1.00260, 0.85445, 0.64240, 0.44790, 0.28350, 0.16490, 0.08740, 0.04677, 0.02270, 0.01136];
const YB = [0.000396, 0.00121, 0.004, 0.0116, 0.023, 0.038, 0.06, 0.09098, 0.13902, 0.20802, 0.323, 0.503, 0.71, 0.862, 0.954, 0.99495, 0.995, 0.952, 0.87, 0.757, 0.631, 0.503, 0.381, 0.265, 0.175, 0.107, 0.061, 0.032, 0.017, 0.00821, 0.004102];
const ZB = [0.06785, 0.2074, 0.6456, 1.3856, 1.74706, 1.77211, 1.6692, 1.28764, 0.81295, 0.46518, 0.272, 0.1582, 0.07825, 0.04216, 0.0203, 0.00875, 0.0039, 0.0021, 0.00165, 0.0011, 0.0008, 0.00034, 0.00019, 0.00005, 0.00002, 0, 0, 0, 0, 0, 0];
const D65 = [82.7549, 91.486, 93.4318, 86.6823, 104.865, 117.008, 117.812, 114.861, 115.923, 108.811, 109.354, 107.802, 104.79, 107.689, 104.405, 104.046, 100.0, 96.3342, 95.788, 88.6856, 90.0062, 89.5991, 87.6987, 83.2886, 83.6992, 80.0268, 80.2146, 82.2778, 78.2842, 69.7213, 71.6091];
const A = WL.map((l) => 100 * Math.pow(560 / l, 5) * (Math.exp(1.435e7 / (2848 * 560)) - 1) / (Math.exp(1.435e7 / (2848 * l)) - 1));

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sum = (a, f) => a.reduce((t, v, i) => t + f(v, i), 0);

// per illuminant: the weights of each band and the tabulated white
function observer(S) {
  const k = sum(S, (s, i) => s * YB[i]);
  return { wx: S.map((s, i) => (s * XB[i]) / k), wy: S.map((s, i) => (s * YB[i]) / k), wz: S.map((s, i) => (s * ZB[i]) / k), white: [sum(S, (s, i) => s * XB[i]) / k, 1, sum(S, (s, i) => s * ZB[i]) / k] };
}
const OBS = { D65: observer(D65), A: observer(A) };

class SpectrumError extends Error {}

/** A reflectance curve as 31 numbers 0–1 at 400, 410 … 700 nm. Takes 31 values, 61 (5 nm) or 41 (380–780 nm), as an array or a
 *  comma / space separated text; percent is recognised (anything above 1.5). */
function parse(raw) {
  let a = raw;
  if (typeof a === 'string') a = a.replace(/[[\]()"']/g, ' ').split(/[\s,;]+/).filter(Boolean).map(Number);   // a pasted array or a list in brackets is fine
  if (!Array.isArray(a)) throw new SpectrumError('A spectrum is a list of reflectance values, 400–700 nm.');
  a = a.map(Number);
  if (a.some((v) => !Number.isFinite(v))) throw new SpectrumError('The spectrum has a value that is not a number.');
  if (a.length === 41) a = a.slice(2, 33);                       // 380–780 nm at 10 nm → 400–700
  else if (a.length === 61) a = a.filter((_, i) => i % 2 === 0);  // 400–700 nm at 5 nm
  if (a.length !== 31) throw new SpectrumError(`A spectrum needs 31 values (400–700 nm at 10 nm); ${a.length} were given. 41 (380–780 nm) and 61 (400–700 nm at 5 nm) are also read.`);
  const mx = Math.max(...a);
  if (a.some((v) => v < 0)) throw new SpectrumError('A reflectance cannot be negative.');
  const f = mx > 1.5 ? 0.01 : 1;
  return a.map((v) => clamp(v * f, 0, 1));
}

function xyz(spec, ill) {
  const o = OBS[ill || 'D65'];
  const W = o.white;
  return [sum(spec, (r, i) => r * o.wx[i]) / W[0], sum(spec, (r, i) => r * o.wy[i]), sum(spec, (r, i) => r * o.wz[i]) / W[2]];   // relative to the white: a perfect reflector is (1,1,1)
}
/** linear sRGB (D65 white) of a spectrum under daylight D65 */
function toLin(spec) {
  const [x, y, z] = xyz(spec, 'D65');
  const X = x * 0.95047, Yv = y, Z = z * 1.08883;
  return [3.2404542 * X - 1.5371385 * Yv - 0.4985314 * Z, -0.969266 * X + 1.8760108 * Yv + 0.041556 * Z, 0.0556434 * X - 0.2040259 * Yv + 1.0572252 * Z].map((v) => clamp(v, 0, 1));
}
function lab(spec, ill) {
  const [x, y, z] = xyz(spec, ill);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** Single-constant Kubelka–Munk, band by band, on surface-area weights, with the melange engine's floor and screening.
 *  parts: [{spec, w, lin}] — returns the blended spectrum. */
function mixKM(parts, P) {
  const omega = P && P.omega != null ? P.omega : 0.35, fl = P && P.floor != null ? P.floor : 0.05;
  const lum = (lin) => 0.2126729 * lin[0] + 0.7151522 * lin[1] + 0.072175 * lin[2];
  const ws = parts.map((p) => p.w * Math.pow(omega, clamp(1 - lum(p.lin), 0, 1)));
  const tot = sum(ws, (w) => w);
  return WL.map((_, k) => {
    let ks = 0;
    parts.forEach((p, i) => { const R = clamp(fl + (1 - fl) * clamp(p.spec[k], 0.002, 1), 0.004, 0.999); ks += (ws[i] / tot) * ((1 - R) * (1 - R)) / (2 * R); });
    const Rm = 1 + ks - Math.sqrt(ks * ks + 2 * ks);
    return clamp((Rm - fl) / (1 - fl), 0, 1);
  });
}

/** Spectral mean of domains the eye mixes at a distance (linear in the spectrum, so linear in light). */
function mixLinear(parts) {
  return WL.map((_, k) => sum(parts, (p) => p.w * p.spec[k]));
}

/** Two samples that match under daylight can part under a tungsten shop light. Needs both spectra; the colour differences are
 *  CIEDE2000 (passed in, so this module stays free of the colour-difference code). */
function metamerism(specA, specB, dE00) {
  const d65 = dE00(lab(specA, 'D65'), lab(specB, 'D65'));
  const a = dE00(lab(specA, 'A'), lab(specB, 'A'));
  const shift = Math.abs(a - d65);
  const grade = shift <= 0.5 ? 'none' : shift <= 1.5 ? 'slight' : shift <= 3 ? 'noticeable' : 'strong';
  return { dE_daylight: d65, dE_tungsten: a, shift, grade };
}

module.exports = { WL, parse, toLin, lab, xyz, mixKM, mixLinear, metamerism, SpectrumError, _tables: { XB, YB, ZB, D65, A, OBS } };
