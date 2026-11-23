/**
 * KnitAdvisor — Motif from an image: a picture (a logo, a graphic, a scanned pattern) becomes the jacquard motif, with nobody painting a pixel.
 *
 * The browser sends the picture as a small grid of RGB pixels (transparent areas already laid on white). This module:
 *
 *   1  SIZE       the number of needles across is chosen (even for an interlock); the rows follow from the picture's proportions and the
 *                 loop's own proportions (a loop is 1/wpc wide and 1/cpc high), so a circle stays a circle on the cloth.
 *   2  RESAMPLE   every needle-by-row cell is the average of the picture's pixels under it, in linear light.
 *   3  COLOURS    k-means in CIE Lab (seeded, repeatable) picks the yarn colours: 'auto' takes the fewest colours that reproduce the picture
 *                 within a small colour error, up to the number of yarns the machine carries; clusters that are no different to the eye are merged.
 *                 The commonest colour is A (the ground), then B, C…; each colour is also matched to the nearest Pantone TCX.
 *   4  CLEAN      a lone pixel inside another colour is a speck of noise and would need a yarn carried for one loop: it is removed.
 *   5  FLOATS     a colour whose pixels are further apart than the float limit would float behind the cloth: the jacquard builder binds it with
 *                 tuck stitches in the gap, which leave the picture as it is.
 *   6  FEEDS      the motif is built (jacquard-builder.js); if it needs more feeds than the Studio holds it is made smaller until it fits.
 *
 * Nothing here pretends a photograph is a pattern: the colour error is reported, and a picture of many shades is told to be simplified.
 */
'use strict';

const JB = require('./jacquard-builder');
const CT = require('./colour-target-engine');

class MotifImageError extends Error { constructor(m) { super(m); this.name = 'MotifImageError'; } }

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const r1 = (x) => Math.round(x * 10) / 10;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ── colour arithmetic (sRGB, D65) ────────────────────────────────────────────
const toLin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const toSrgb = (v) => { const c = clamp(v, 0, 1); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); };
const F = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
function linToLab(r, g, b) {
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b, Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const fx = F(X), fy = F(Y), fz = F(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const hexOfLin = (l) => '#' + l.map((v) => toSrgb(v).toString(16).padStart(2, '0')).join('');
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// a small seeded generator: the same picture gives the same colours
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

function kmeans(labs, k, seed) {
  const n = labs.length, rnd = rng(seed);
  const C = [labs[Math.floor(rnd() * n)].slice()];
  while (C.length < k) {
    const d2 = labs.map((p) => Math.min(...C.map((c) => { const d = dE(p, c); return d * d; })));
    const tot = d2.reduce((a, b) => a + b, 0);
    if (!(tot > 0)) break;
    let t = rnd() * tot, i = 0;
    while (i < n - 1 && (t -= d2[i]) > 0) i++;
    C.push(labs[i].slice());
  }
  const lab = new Int16Array(n);
  for (let it = 0; it < 30; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < C.length; c++) { const d = dE(labs[i], C[c]); if (d < bd) { bd = d; best = c; } }
      if (lab[i] !== best) { lab[i] = best; moved++; }
    }
    const sum = C.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) { const s = sum[lab[i]]; s[0] += labs[i][0]; s[1] += labs[i][1]; s[2] += labs[i][2]; s[3]++; }
    sum.forEach((s, c) => { if (s[3]) C[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    if (!moved) break;
  }
  let err = 0; for (let i = 0; i < n; i++) err += dE(labs[i], C[lab[i]]);
  return { centres: C, lab, mean: err / n };
}

// ── the picture's colours, then the picture on the needle grid ──────────────
// The palette comes from the picture's own pixels (so the blended pixels along an edge, which are few, do not become a colour of their own);
// every needle-by-row cell then takes the palette colour that covers most of its area.
function buildPalette(rgb, w, h, maxK, wanted) {
  const n = w * h, labs = new Array(n), lins = new Array(n);
  for (let i = 0; i < n; i++) { const l = [toLin(rgb[i * 3]), toLin(rgb[i * 3 + 1]), toLin(rgb[i * 3 + 2])]; lins[i] = l; labs[i] = linToLab(l[0], l[1], l[2]); }
  const stride = Math.max(1, Math.floor(n / 5000)), sample = []; for (let i = 0; i < n; i += stride) sample.push(labs[i]);
  const run = (k) => { let best = null; [7, 19, 31].forEach((sd) => { const r = kmeans(sample, k, sd * 7919 + k); if (!best || r.mean < best.mean) best = r; }); return best; };
  const distinct = new Set(sample.map((l) => l.map((v) => Math.round(v / 2)).join(','))).size;
  let chosen = null;
  if (wanted > 0) chosen = run(Math.min(wanted, Math.max(2, distinct)));
  else {
    let prev = null;
    for (let k = 2; k <= Math.min(maxK, Math.max(2, distinct)); k++) {
      const r = run(k);
      if (r.mean <= 5) { chosen = r; break; }
      if (prev && (prev.mean - r.mean) / Math.max(prev.mean, 1e-6) < 0.2) { chosen = prev; break; }
      prev = r; chosen = r;
    }
    if (!chosen) chosen = run(2);
  }
  return finish(chosen.centres, labs, lins, w, h, 6);
}
// merge centres no different to the eye, rank by share (A is the commonest) and take each yarn's colour as the average light of its pixels
function finish(centres, labs, lins, w, h, keep) {
  const C = centres.map((c) => c.slice());
  for (let again = true; again;) {
    again = false;
    outer: for (let i = 0; i < C.length; i++) for (let j = i + 1; j < C.length; j++) if (dE(C[i], C[j]) < 9) { C.splice(j, 1); again = true; break outer; }
  }
  const n = w * h, of = new Int16Array(n), cnt = C.map(() => 0);
  for (let i = 0; i < n; i++) { let best = 0, bd = Infinity; for (let c = 0; c < C.length; c++) { const d = dE(labs[i], C[c]); if (d < bd) { bd = d; best = c; } } of[i] = best; cnt[best]++; }
  const order = C.map((_, i) => i).sort((a, b) => cnt[b] - cnt[a]).slice(0, keep), rank = {}; order.forEach((g, r) => { rank[g] = r; });
  // the rarest colours beyond the number kept fall to their nearest kept colour
  const map = new Int16Array(C.length);
  for (let c = 0; c < C.length; c++) { if (rank[c] != null) map[c] = rank[c]; else { let best = 0, bd = Infinity; order.forEach((g, r) => { const d = dE(C[c], C[g]); if (d < bd) { bd = d; best = r; } }); map[c] = best; } }
  const pix = new Int16Array(n), acc = order.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < n; i++) { const k = map[of[i]]; pix[i] = k; const a = acc[k]; a[0] += lins[i][0]; a[1] += lins[i][1]; a[2] += lins[i][2]; a[3]++; }
  const centresLin = acc.map((a) => [a[0] / Math.max(1, a[3]), a[1] / Math.max(1, a[3]), a[2] / Math.max(1, a[3])]), centresLab = centresLin.map((c) => linToLab(c[0], c[1], c[2]));
  // the colour error is measured on the picture's own pixels against the yarn colours
  let err = 0;
  for (let i = 0; i < n; i++) { let bd = Infinity; for (let c = 0; c < centresLab.length; c++) { const d = dE(labs[i], centresLab[c]); if (d < bd) bd = d; } err += bd; }
  return { centresLin, centresLab, pix, meanErr: err / n, labs, lins, w, h };
}
function reduceTo(pal, k) {
  if (pal.centresLab.length <= k) return pal;
  return finish(pal.centresLab.slice(0, k), pal.labs, pal.lins, pal.w, pal.h, k);      // already ranked by share
}
function cellsOf(pal, w, h, W, H) {
  const K = pal.centresLab.length, g = new Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = (y * h) / H, y1 = ((y + 1) * h) / H;
    for (let x = 0; x < W; x++) {
      const x0 = (x * w) / W, x1 = ((x + 1) * w) / W, votes = new Array(K).fill(0);
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0); if (wy <= 0) continue;
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) { const wx = Math.min(xx + 1, x1) - Math.max(xx, x0); if (wx > 0) votes[pal.pix[Math.min(yy, h - 1) * w + Math.min(xx, w - 1)]] += wx * wy; }
      }
      let best = 0; for (let k = 1; k < K; k++) if (votes[k] > votes[best] + 1e-9) best = k;
      g[y * W + x] = best;
    }
  }
  return g;
}

// ── clean-up ─────────────────────────────────────────────────────────────────
function despeckle(g, W, H) {
  let flips = 0;
  for (let pass = 0; pass < 2; pass++) {
    const next = g.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const me = g[y * W + x], nb = [];
      if (x > 0) nb.push(g[y * W + x - 1]); if (x < W - 1) nb.push(g[y * W + x + 1]); if (y > 0) nb.push(g[(y - 1) * W + x]); if (y < H - 1) nb.push(g[(y + 1) * W + x]);
      if (nb.length < 3 || nb.includes(me)) continue;
      const cnt = {}; nb.forEach((c) => { cnt[c] = (cnt[c] || 0) + 1; });
      const top = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
      if (cnt[top] >= 3) { next[y * W + x] = +top; flips++; }
    }
    g = next;
  }
  return { g, flips };
}

/**
 * spec: { width, height, rgb (base64 of width*height*3 bytes), needles, bed, back, colours, max_colours, pixel_aspect, max_float, wpc, cpc, limit_floats }
 */
function fromImage(spec) {
  if (!spec || typeof spec !== 'object') throw new MotifImageError('Give the picture.');
  const w = Math.round(+spec.width), h = Math.round(+spec.height);
  if (!(w >= 4 && h >= 4 && w <= 256 && h <= 256)) throw new MotifImageError('The picture grid must be 4 to 256 pixels on each side.');
  const buf = Buffer.from(String(spec.rgb || ''), 'base64');
  if (buf.length !== w * h * 3) throw new MotifImageError(`The picture has ${buf.length} bytes; ${w} × ${h} RGB needs ${w * h * 3}.`);
  const bed = spec.bed === 'interlock' ? 'interlock' : spec.bed === 'rib' || spec.bed === 'double' ? 'rib' : 'single';
  const back = ['same', 'negative', 'plain'].includes(spec.back) ? spec.back : 'same';
  const maxK = clamp(Math.round(+spec.max_colours) || 4, 2, 6);
  const wanted = spec.colours && spec.colours !== 'auto' ? clamp(Math.round(+spec.colours), 2, 6) : 0;
  const wpc = +spec.wpc > 0 ? +spec.wpc : null, cpc = +spec.cpc > 0 ? +spec.cpc : null;
  const aspect = +spec.pixel_aspect > 0 ? +spec.pixel_aspect : wpc && cpc ? cpc / wpc : bed === 'single' ? 0.86 : 1.0;
  const maxFloat = clamp(Math.round(+spec.max_float) || 4, 2, 12);
  let W = clamp(Math.round(+spec.needles) || 24, 6, 48);
  if (bed === 'interlock' && W % 2) W += W < 48 ? 1 : -1;
  const notes = [], checks = [];
  const startW = W;


  const pal0 = buildPalette(buf, w, h, maxK, wanted);
  if (pal0.centresLab.length < 2) throw new MotifImageError('The picture is one colour: there is no motif in it. Use a picture with at least two clearly different colours.');
  const tryBuild = (pal, Wn) => {
    const H = clamp(Math.round(Wn * (h / w) * aspect), 4, JB.MAX_FEEDS);
    let g = cellsOf(pal, w, h, Wn, H);
    const sp = despeckle(g, Wn, H); g = sp.g;
    const used = new Set(g); if (used.size < 2) return { fail: 'one colour' };
    const rows = [];
    for (let y = 0; y < H; y++) rows.push(g.slice(y * Wn, y * Wn + Wn).map((k) => LETTERS[k]).join(''));
    const bk = bed !== 'single' && back === 'negative' && used.size !== 2 ? 'same' : back;
    try { return { rows, H, W: Wn, sp, pal, built: JB.build({ motif: rows, bed, back: bk, max_float: maxFloat, ground_colour: 'A', tie_floats: spec.tie_floats !== false }), back: bk }; }
    catch (e) {
      if (e instanceof JB.JacquardError && /needs \d+ feeds/.test(e.message)) return { fail: 'feeds' };
      if (e instanceof JB.JacquardError && /at least two colours/.test(e.message)) return { fail: 'one colour' };
      throw e;
    }
  };
  // fit the 48 feeds: fewer colours first (a blend colour along an edge is the first to go), then a smaller motif
  let candidate = null, best = null;
  for (let Wn = W; Wn >= 8 && !candidate; Wn = bed === 'interlock' ? (Math.floor(Wn * 0.87) >> 1) << 1 : Math.floor(Wn * 0.87)) {
    for (let k = pal0.centresLab.length; k >= 2; k--) {
      const pal = k === pal0.centresLab.length ? pal0 : reduceTo(pal0, k);
      const t = tryBuild(pal, Wn);
      if (t.fail) continue;
      if (!best || t.pal.meanErr < best.pal.meanErr) best = t;
      if (t.pal.meanErr <= 12 || k === 2) { candidate = t; break; }
    }
  }
  const result = candidate || best;
  if (!result) throw new MotifImageError('The picture could not be made small enough to knit in the Studio\'s 48 feeds: use fewer colours or a simpler picture.');
  const { rows, sp, built } = result, q = result.pal;
  W = result.W;
  if (W < startW) notes.push(`The motif was made smaller, ${startW} to ${W} needles across, because at ${startW} it needed more than the ${JB.MAX_FEEDS} feeds the Studio holds (every colour in a row is a feed${bed === 'interlock' ? ', two for an interlock' : ''}).`);
  if (result.back !== back) notes.push('The exchanged-colour back needs exactly two colours; the back was made the same as the face.');

  const used = [...new Set(rows.join('').split(''))].sort();
  const share = {}; rows.join('').split('').forEach((c) => { share[c] = (share[c] || 0) + 1; });
  const palette = used.map((l) => {
    const k = LETTERS.indexOf(l), lin = q.centresLin[k], hex = hexOfLin(lin);
    let pan = null; try { const r = CT.analyse({ target: hex }); pan = r.nearest && r.nearest[0] ? r.nearest[0] : null; } catch (e) { pan = null; }
    return { letter: l, hex, share_pct: r1((share[l] / (rows.length * W)) * 100), pantone: pan ? { code: pan.code, name: pan.name, hex: pan.hex, delta_e00: pan.delta_e00 } : null };
  });
  const err = q.meanErr;
  if (pal0.centresLab.length > q.centresLab.length) notes.push(`${pal0.centresLab.length - q.centresLab.length} colour(s) dropped to fit the Studio's ${JB.MAX_FEEDS} feeds (the commonest colours are kept).`);
  const quality = err <= 6 ? 'good' : err <= 14 ? 'fair' : 'poor';
  if (quality === 'poor') checks.push({ level: 'warn', text: `The picture has many shades: the ${palette.length} yarn colours differ from it by ${r1(err)} ΔE on average. A jacquard is flat colour — simplify the picture (fewer shades, no gradients or photographs) or allow more colours.` });
  else if (quality === 'fair') checks.push({ level: 'note', text: `The ${palette.length} yarn colours differ from the picture by ${r1(err)} ΔE on average: soft edges and shades become flat colour.` });
  else checks.push({ level: 'ok', text: `The ${palette.length} yarn colours reproduce the picture closely (${r1(err)} ΔE on average).` });
  if (sp.flips) notes.push(`${sp.flips} lone pixel${sp.flips === 1 ? '' : 's'} removed: a yarn colour carried for one loop is noise, not a pattern.`);
  const tieNote = built.notes.find((n) => /tuck stitch/.test(n)); if (tieNote) notes.push(tieNote);
  built.checks.forEach((c) => { if (c.level !== 'ok') checks.push(c); });
  const size = wpc && cpc ? { width_cm: r1(W / wpc), height_cm: r1(rows.length / cpc), basis: `${W} needles at ${wpc} wales per cm, ${rows.length} rows at ${cpc} courses per cm (the cloth as the Studio finishes it)` } : null;
  return {
    motif: rows, width: W, height: rows.length, bed, back: result.back,
    palette, colour_error: { mean_delta_e: r1(err), quality },
    size, pixel_aspect: Math.round(aspect * 100) / 100, notes, checks,
    programme: { feeds: built.feeds_total, colours_per_row: built.colours_per_row, longest_float: built.longest_float },
  };
}

module.exports = { fromImage, MotifImageError, buildPalette, cellsOf, despeckle };
