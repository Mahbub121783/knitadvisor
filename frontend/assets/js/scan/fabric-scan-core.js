/**
 * KnitAdvisor — Fabric scan core (runs in the phone's browser and in Node tests).
 *
 * No AI. A knitted fabric is a lattice of loops; a photo of it repeats. This
 * file finds that repeat and measures it:
 *
 *   1. the scan card: four black squares at known places (mm) are found in the
 *      photo, and a homography maps millimetres on the card to pixels — the
 *      card's window is then resampled flat at a known pixels-per-mm
 *   2. the loop lattice: the 2-D autocorrelation (via FFT) of the flattened
 *      window peaks at every translation that maps the cloth onto itself; the
 *      two shortest strong peaks are the lattice. Wale spacing and course
 *      spacing come from that lattice, measured in five places, median taken
 *   3. hints about the structure (course/wale ratio, grooves, a larger repeat,
 *      V-legs or arcs), faults (where the photo breaks its own repeat), and the
 *      colour against the card's white
 *
 * Every function is pure: arrays in, numbers out.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KAScan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── the scan card (millimetres, origin top-left of the printed frame) ──
  var CARD = {
    size: 70, marker: 10,
    markers: [[5, 5], [65, 5], [65, 65], [5, 65]],      // centres: TL, TR, BR, BL
    window: [15, 55],                                     // the cut-out
    sample: [17, 53],                                     // what is analysed (2 mm inside the cut)
    white: [[35, 12.5], [12.5, 35], [57.5, 35], [35, 57.5]], // plain paper between frame and window
    // analysed areas [x0, x1, y0, y1] mm: the cut-out window, or fabric lying just
    // beside the card on any side (the card's 5 mm white border is skipped)
    regions: {
      window: [17, 53, 17, 53],
      above: [17, 52, -44, -9], below: [17, 52, 79, 114], left: [-44, -9, 17, 52], right: [79, 114, 17, 52],
    },
  };

  // ── images ─────────────────────────────────────────────────────────
  function toGray(rgba, w, h) {
    var g = new Float32Array(w * h);
    for (var i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) / 255;
    return g;
  }
  function downscale(g, w, h, maxSide) {
    var s = Math.max(w, h) / maxSide;
    if (s <= 1) return { data: g, w: w, h: h, scale: 1 };
    var W = Math.max(1, Math.round(w / s)), H = Math.max(1, Math.round(h / s));
    var out = new Float32Array(W * H);
    for (var y = 0; y < H; y++) {
      var y0 = Math.floor(y * s), y1 = Math.min(h, Math.floor((y + 1) * s));
      for (var x = 0; x < W; x++) {
        var x0 = Math.floor(x * s), x1 = Math.min(w, Math.floor((x + 1) * s)), t = 0, n = 0;
        for (var yy = y0; yy < y1; yy++) for (var xx = x0; xx < x1; xx++) { t += g[yy * w + xx]; n++; }
        out[y * W + x] = n ? t / n : 0;
      }
    }
    return { data: out, w: W, h: H, scale: w / W };
  }
  function bilinear(g, w, h, x, y) {
    if (x < 0 || y < 0 || x > w - 1.001 || y > h - 1.001) return NaN;
    var x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
    return g[i] * (1 - fx) * (1 - fy) + g[i + 1] * fx * (1 - fy) + g[i + w] * (1 - fx) * fy + g[i + w + 1] * fx * fy;
  }

  // ── homography (4 point pairs) ───────────────────────────────────────
  function solve(A, b) { // Gaussian elimination, n×n
    var n = b.length, M = A.map(function (r, i) { return r.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      var t = M[c]; M[c] = M[p]; M[p] = t;
      if (Math.abs(M[c][c]) < 1e-12) return null;
      for (r = 0; r < n; r++) {
        if (r === c) continue;
        var f = M[r][c] / M[c][c];
        for (var k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map(function (r, i) { return r[n] / r[i]; });
  }
  /** H maps src (x, y) → dst (u, v). */
  function homography(src, dst) {
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    var hh = solve(A, b);
    return hh ? [hh[0], hh[1], hh[2], hh[3], hh[4], hh[5], hh[6], hh[7], 1] : null;
  }
  function apply(H, x, y) {
    var d = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
  }

  // ── finding the card ─────────────────────────────────────────────────
  /**
   * The four corner squares in a small grey image (longest side ≈ 1200).
   * @returns {{corners: number[][], pxPerMm: number}|{error: string}}
   */
  function detectCard(g, w, h) {
    var tries = [[24, 0.12], [12, 0.1], [40, 0.08], [16, 0.06]], first = null;
    for (var t = 0; t < tries.length; t++) {
      var r = detectCardOnce(g, w, h, tries[t][0], tries[t][1]);
      if (!r.error) return r;
      if (!first) first = r;
    }
    return first;
  }
  function detectCardOnce(g, w, h, div, margin) {
    // adaptive threshold: darker than the neighbourhood by a margin
    var R = Math.max(8, Math.round(Math.max(w, h) / div));
    var I = new Float64Array((w + 1) * (h + 1));
    for (var y = 0; y < h; y++) {
      var row = 0;
      for (var x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
    }
    var mask = new Uint8Array(w * h);
    for (y = 0; y < h; y++) {
      var ya = Math.max(0, y - R), yb = Math.min(h, y + R + 1);
      for (x = 0; x < w; x++) {
        var xa = Math.max(0, x - R), xb = Math.min(w, x + R + 1);
        var s = I[yb * (w + 1) + xb] - I[ya * (w + 1) + xb] - I[yb * (w + 1) + xa] + I[ya * (w + 1) + xa];
        var m = s / ((yb - ya) * (xb - xa));
        mask[y * w + x] = g[y * w + x] < m - margin && g[y * w + x] < 0.5 ? 1 : 0;
      }
    }
    // connected components
    var label = new Int32Array(w * h), comps = [], stack = [];
    for (var i0 = 0; i0 < w * h; i0++) {
      if (!mask[i0] || label[i0]) continue;
      var id = comps.length + 1, c = { n: 0, sx: 0, sy: 0, minx: w, maxx: 0, miny: h, maxy: 0, e: [[1e9, 0, 0], [-1e9, 0, 0], [-1e9, 0, 0], [1e9, 0, 0]] };
      label[i0] = id; stack.push(i0);
      while (stack.length) {
        var p = stack.pop(), px = p % w, py = (p / w) | 0;
        c.n++; c.sx += px; c.sy += py;
        if (px < c.minx) c.minx = px; if (px > c.maxx) c.maxx = px; if (py < c.miny) c.miny = py; if (py > c.maxy) c.maxy = py;
        var a = px + py, d = px - py;
        if (a < c.e[0][0]) c.e[0] = [a, px, py];
        if (d > c.e[1][0]) c.e[1] = [d, px, py];
        if (a > c.e[2][0]) c.e[2] = [a, px, py];
        if (d < c.e[3][0]) c.e[3] = [d, px, py];
        if (px > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = id; stack.push(p - 1); }
        if (px < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = id; stack.push(p + 1); }
        if (py > 0 && mask[p - w] && !label[p - w]) { label[p - w] = id; stack.push(p - w); }
        if (py < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = id; stack.push(p + w); }
      }
      comps.push(c);
    }
    var area = w * h;
    var squares = comps.filter(function (c) {
      if (c.n < area * 0.0003 || c.n > area * 0.04) return false;
      var bw = c.maxx - c.minx + 1, bh = c.maxy - c.miny + 1;
      if (bw / bh > 2.2 || bh / bw > 2.2) return false;
      var q = c.e.map(function (e) { return [e[1], e[2]]; });
      var qa = Math.abs(polyArea(q));
      var fill = c.n / (bw * bh);
      return (qa > 0 && c.n / qa > 0.7 && c.n / qa < 1.45) || fill > 0.82;
    }).map(function (c) { return { x: c.sx / c.n, y: c.sy / c.n, n: c.n }; });
    squares.sort(function (a, b) { return b.n - a.n; });
    squares = squares.slice(0, 14);
    if (squares.length < 4) return { error: 'The four black squares of the scan card were not found. Hold the card flat, fully in the photo, in even light.' };
    // the four that make the most card-like quadrilateral
    var best = null;
    for (var a1 = 0; a1 < squares.length; a1++) for (var b1 = a1 + 1; b1 < squares.length; b1++)
      for (var c1 = b1 + 1; c1 < squares.length; c1++) for (var d1 = c1 + 1; d1 < squares.length; d1++) {
        var set = [squares[a1], squares[b1], squares[c1], squares[d1]];
        var ns = set.map(function (s) { return s.n; });
        if (Math.max.apply(null, ns) / Math.min.apply(null, ns) > 3) continue;
        var ord = order(set);
        if (!convex(ord)) continue;
        var qa2 = Math.abs(polyArea(ord.map(function (s) { return [s.x, s.y]; })));
        var mean = ns.reduce(function (t, v) { return t + v; }, 0) / 4;
        var ratio = qa2 / mean;                 // 3600 / 100 = 36 on a flat card
        if (ratio < 14 || ratio > 90) continue;
        var sides = [0, 1, 2, 3].map(function (k) { var p1 = ord[k], p2 = ord[(k + 1) % 4]; return Math.hypot(p2.x - p1.x, p2.y - p1.y); });
        var skew = Math.max.apply(null, sides) / Math.min.apply(null, sides);
        var score = Math.abs(Math.log(ratio / 36)) + Math.log(skew) * 0.8;
        if (!best || score < best.score) best = { score: score, ord: ord, sides: sides };
      }
    if (!best) return { error: 'The scan card is not clear enough — make the whole card fill most of the photo, square to the camera.' };
    var corners = best.ord.map(function (s) { return [s.x, s.y]; });
    var pxPerMm = best.sides.reduce(function (t, v) { return t + v; }, 0) / 4 / 60;
    // a printed card has white paper between its squares: dark marks on a print or a cloth do not
    var Hc = homography(CARD.markers, corners), paper = [], ink = [];
    CARD.white.forEach(function (p) { var q = apply(Hc, p[0], p[1]); var v = bilinear(g, w, h, q[0], q[1]); if (v === v) paper.push(v); });
    CARD.markers.forEach(function (p) { var q = apply(Hc, p[0], p[1]); var v = bilinear(g, w, h, q[0], q[1]); if (v === v) ink.push(v); });
    var pm = paper.length ? paper.reduce(function (t, v) { return t + v; }, 0) / paper.length : 0, im = ink.length ? ink.reduce(function (t, v) { return t + v; }, 0) / ink.length : 1;
    var tiltC = Math.max.apply(null, best.sides) / Math.min.apply(null, best.sides);
    if (paper.length < 3 || pm < 0.55 || im > 0.4 || pm - im < 0.33 || tiltC > 2) return { error: 'The scan card was not seen: four black squares on white paper. Dark marks on the fabric are not the card.', code: 'no_card' };
    return { corners: corners, pxPerMm: pxPerMm, tilt: Math.max.apply(null, best.sides) / Math.min.apply(null, best.sides), paper: pm };
  }
  function polyArea(q) { var s = 0; for (var i = 0; i < q.length; i++) { var a = q[i], b = q[(i + 1) % q.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
  // TL, TR, BR, BL as the phone holds the picture
  function order(set) {
    var cx = 0, cy = 0;
    set.forEach(function (s) { cx += s.x / 4; cy += s.y / 4; });
    var o = set.slice().sort(function (a, b) { return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx); });
    var k = 0, best = Infinity;
    o.forEach(function (s, i) { if (s.x + s.y < best) { best = s.x + s.y; k = i; } });
    return o.slice(k).concat(o.slice(0, k));
  }
  function convex(o) {
    var sign = 0;
    for (var i = 0; i < 4; i++) {
      var a = o[i], b = o[(i + 1) % 4], c = o[(i + 2) % 4];
      var cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (cr === 0) return false;
      if (sign && Math.sign(cr) !== sign) return false;
      sign = Math.sign(cr);
    }
    return true;
  }

  /**
   * The card's window resampled flat.
   * @param corners  the four marker centres in the FULL image's pixels (TL, TR, BR, BL)
   * @returns {{data: Float32Array, w, h, pxPerMm, H}}
   */
  function rectify(g, w, h, corners, srcPxPerMm, opts) {
    opts = opts || {};
    var H = homography(CARD.markers, corners);        // mm → image px
    var P = Math.min(opts.maxPxPerMm || 26, srcPxPerMm * 0.9);
    var reg = opts.region || CARD.regions.window;
    var ow = Math.round((reg[1] - reg[0]) * P), oh = Math.round((reg[3] - reg[2]) * P);
    var out = new Float32Array(ow * oh), bad = 0;
    for (var y = 0; y < oh; y++) for (var x = 0; x < ow; x++) {
      var q = apply(H, reg[0] + (x + 0.5) / P, reg[2] + (y + 0.5) / P);
      var v = bilinear(g, w, h, q[0], q[1]);
      if (v !== v) { v = 0.5; bad++; }
      out[y * ow + x] = v;
    }
    return { data: out, w: ow, h: oh, pxPerMm: P, H: H, region: reg, outside: bad / out.length };
  }

  // ── FFT ──────────────────────────────────────────────────────────────
  function fft(re, im, inv) {
    var n = re.length, i, j, k;
    for (i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = 2 * Math.PI / len * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < len / 2; k++) {
          var ur = re[i + k], ui = im[i + k];
          var vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          var vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          var nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
    if (inv) for (i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  function fft2(re, im, N, inv) {
    var rr = new Float64Array(N), ri = new Float64Array(N), x, y;
    for (y = 0; y < N; y++) {
      for (x = 0; x < N; x++) { rr[x] = re[y * N + x]; ri[x] = im[y * N + x]; }
      fft(rr, ri, inv);
      for (x = 0; x < N; x++) { re[y * N + x] = rr[x]; im[y * N + x] = ri[x]; }
    }
    for (x = 0; x < N; x++) {
      for (y = 0; y < N; y++) { rr[y] = re[y * N + x]; ri[y] = im[y * N + x]; }
      fft(rr, ri, inv);
      for (y = 0; y < N; y++) { re[y * N + x] = rr[y]; im[y * N + x] = ri[y]; }
    }
  }
  var hannCache = {};
  function hannAC(N) { // the window's own autocorrelation, to undo its taper on the peaks
    if (hannCache[N]) return hannCache[N];
    var w1 = new Float64Array(N);
    for (var i = 0; i < N; i++) w1[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / N);
    var re = new Float64Array(N * N), im = new Float64Array(N * N);
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) re[y * N + x] = w1[x] * w1[y];
    fft2(re, im, N, false);
    for (var k = 0; k < N * N; k++) { re[k] = re[k] * re[k] + im[k] * im[k]; im[k] = 0; }
    fft2(re, im, N, true);
    var z = re[0];
    for (k = 0; k < N * N; k++) re[k] /= z;
    hannCache[N] = { w1: w1, ac: re };
    return hannCache[N];
  }
  /** Normalised autocorrelation of an N×N patch; R(0) = 1, window taper removed. */
  function autocorr(g, w, x0, y0, N) {
    var H = hannAC(N), re = new Float64Array(N * N), im = new Float64Array(N * N), mean = 0, x, y;
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) mean += g[(y0 + y) * w + x0 + x];
    mean /= N * N;
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) re[y * N + x] = (g[(y0 + y) * w + x0 + x] - mean) * H.w1[x] * H.w1[y];
    fft2(re, im, N, false);
    for (var k = 0; k < N * N; k++) { re[k] = re[k] * re[k] + im[k] * im[k]; im[k] = 0; }
    fft2(re, im, N, true);
    var z = re[0] || 1, R = new Float32Array(N * N);
    for (k = 0; k < N * N; k++) R[k] = H.ac[k] > 0.15 ? re[k] / z / H.ac[k] : 0;
    return R;
  }
  function at(R, N, dx, dy) { return R[(((dy % N) + N) % N) * N + (((dx % N) + N) % N)]; }
  function atF(R, N, dx, dy) { // bilinear in the autocorrelation
    var x0 = Math.floor(dx), y0 = Math.floor(dy), fx = dx - x0, fy = dy - y0;
    return at(R, N, x0, y0) * (1 - fx) * (1 - fy) + at(R, N, x0 + 1, y0) * fx * (1 - fy) + at(R, N, x0, y0 + 1) * (1 - fx) * fy + at(R, N, x0 + 1, y0 + 1) * fx * fy;
  }

  function peaks(R, N, rmin, rmax) {
    var out = [];
    for (var dy = 0; dy <= rmax; dy++) for (var dx = -rmax; dx <= rmax; dx++) {
      if (dy === 0 && dx <= 0) continue;
      var r = Math.hypot(dx, dy);
      if (r < rmin || r > rmax) continue;
      var v = at(R, N, dx, dy);
      if (v < 0.08) continue;
      var isMax = true;
      for (var ky = -1; ky <= 1 && isMax; ky++) for (var kx = -1; kx <= 1; kx++) {
        if ((kx || ky) && at(R, N, dx + kx, dy + ky) > v) { isMax = false; break; }
      }
      if (!isMax) continue;
      var vxm = at(R, N, dx - 1, dy), vxp = at(R, N, dx + 1, dy), vym = at(R, N, dx, dy - 1), vyp = at(R, N, dx, dy + 1);
      var ddx = vxm - 2 * v + vxp, ddy = vym - 2 * v + vyp;
      var sx = ddx < 0 ? 0.5 * (vxm - vxp) / ddx : 0, sy = ddy < 0 ? 0.5 * (vym - vyp) / ddy : 0;
      out.push({ x: dx + Math.max(-0.5, Math.min(0.5, sx)), y: dy + Math.max(-0.5, Math.min(0.5, sy)), v: v });
    }
    return out;
  }

  /**
   * The loop lattice of one patch.
   * @returns {{W: number[], C: number[], rW, rC, staggered: boolean, peaks}|null}
   *   W the translation across the wales (≈ horizontal), C along them (≈ vertical)
   */
  function lattice(R, N, rmin) {
    var ps = peaks(R, N, rmin, Math.floor(N / 3));
    if (ps.length < 2) return null;
    var vmax = Math.max.apply(null, ps.map(function (p) { return p.v; }));
    var len = function (p) { return Math.hypot(p.x, p.y); };
    ps.sort(function (a, b) { return len(a) - len(b); });
    // a peak at 2a stronger than a: a was half a repeat (the two legs of a V), not a repeat
    var lift = function (p) {
      for (var k = 0; k < 2; k++) {
        var v2 = atF(R, N, 2 * p.x, 2 * p.y);
        if (v2 > p.v + 0.06 && p.v < 0.6 * v2) p = { x: 2 * p.x, y: 2 * p.y, v: v2 }; else break;
      }
      return p;
    };
    var a = null, b = null;
    for (var i = 0; i < ps.length && !a; i++) if (ps[i].v >= 0.45 * vmax) a = lift(ps[i]);
    if (!a) return null;
    for (i = 0; i < ps.length && !b; i++) {
      var p = ps[i];
      if (p.v < 0.3 * vmax) continue;
      var sin = Math.abs(a.x * p.y - a.y * p.x) / (len(a) * len(p));
      if (sin > 0.45) b = lift(p);
    }
    if (!b) return null;
    // Gauss reduction to the shortest basis
    for (var it = 0; it < 8; it++) {
      if (len(b) < len(a)) { var t = a; a = b; b = t; }
      var mu = Math.round((a.x * b.x + a.y * b.y) / (a.x * a.x + a.y * a.y));
      if (!mu) break;
      b = { x: b.x - mu * a.x, y: b.y - mu * a.y, v: atF(R, N, b.x - mu * a.x, b.y - mu * a.y) };
    }
    // the lattice vectors nearest the horizontal and the vertical
    var cand = [];
    for (var m = -3; m <= 3; m++) for (var n = -3; n <= 3; n++) {
      if (!m && !n) continue;
      var vx = m * a.x + n * b.x, vy = m * a.y + n * b.y;
      if (vy < 0 || (vy === 0 && vx < 0)) { vx = -vx; vy = -vy; }
      cand.push({ x: vx, y: vy, l: Math.hypot(vx, vy) });
    }
    var pick = function (horizontal) {
      var best = null;
      cand.forEach(function (c) {
        var ang = Math.atan2(Math.abs(horizontal ? c.y : c.x), Math.abs(horizontal ? c.x : c.y));
        if (ang > 0.45) return;
        if (!best || c.l < best.l - 1e-6) best = c;
      });
      return best;
    };
    var Wv = pick(true), Cv = pick(false);
    if (!Wv || !Cv) return null;
    if (Wv.x < 0) { Wv = { x: -Wv.x, y: -Wv.y, l: Wv.l }; }
    // A tuck or miss pattern repeats over several loops; the loops themselves
    // still show as a true peak at a fraction of the repeat. Step down to it
    // when that fraction is a real local peak (not the slope of the centre).
    var isPeakAt = function (x, y) {
      var v = atF(R, N, x, y), l = Math.hypot(x, y), ux = x / l, uy = y / l, d = Math.max(1, l * 0.18);
      return v >= 0.33 && v > atF(R, N, x - ux * d, y - uy * d) + 0.04 && v > atF(R, N, x + ux * d, y + uy * d) + 0.04 && l >= rmin;
    };
    var refine = function (V, ks) {
      for (var q = 0; q < ks.length; q++) { var k = ks[q]; if (isPeakAt(V.x / k, V.y / k)) return { x: V.x / k, y: V.y / k, l: V.l / k, k: k }; }
      return V;
    };
    Wv = refine(Wv, [3, 2]); Cv = refine(Cv, [4, 3, 2]);
    // a staggered (centred) lattice has a point halfway between W and C
    var hx = (Wv.x + Cv.x) / 2, hy = (Wv.y + Cv.y) / 2;
    var staggered = !Wv.k && !Cv.k && cand.some(function (c) { return Math.hypot(c.x - hx, c.y - hy) < 0.15 * Math.min(Wv.l, Cv.l) || Math.hypot(c.x + hx, c.y + hy) < 0.15 * Math.min(Wv.l, Cv.l); });
    return { W: [Wv.x, Wv.y], C: [Cv.x, Cv.y], rW: atF(R, N, Wv.x, Wv.y), rC: atF(R, N, Cv.x, Cv.y), staggered: staggered, a: a, b: b, vmax: vmax };
  }

  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

  /**
   * Keeps only detail finer than ~1.3 mm (the loops) and evens out contrast:
   * uneven light, the shadow of a wrinkle and a dark-to-light gradient across
   * the swatch would otherwise outweigh the loop repeat in the autocorrelation.
   */
  function boxMean(src, w, h, r) {
    var I = new Float64Array((w + 1) * (h + 1)), out = new Float32Array(w * h), x, y;
    for (y = 0; y < h; y++) { var row = 0; for (x = 0; x < w; x++) { row += src[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
    for (y = 0; y < h; y++) {
      var ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
      for (x = 0; x < w; x++) {
        var xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
        out[y * w + x] = (I[yb * (w + 1) + xb] - I[ya * (w + 1) + xb] - I[yb * (w + 1) + xa] + I[ya * (w + 1) + xa]) / ((yb - ya) * (xb - xa));
      }
    }
    return out;
  }
  function detail(img, rPx) {
    var w = img.w, h = img.h, r = Math.max(2, Math.round(rPx || 1.3 * img.pxPerMm));
    var lo = boxMean(img.data, w, h, r), hp = new Float32Array(w * h), sq = new Float32Array(w * h), i;
    for (i = 0; i < hp.length; i++) { hp[i] = img.data[i] - lo[i]; sq[i] = hp[i] * hp[i]; }
    var v = boxMean(sq, w, h, r * 2);
    for (i = 0; i < hp.length; i++) hp[i] = hp[i] / (Math.sqrt(v[i]) + 0.01);
    return { data: hp, w: w, h: h, pxPerMm: img.pxPerMm };
  }

  /**
   * Wales and courses per cm of a flattened image at a known scale.
   * @param img {data, w, h, pxPerMm}
   */
  function measure(img, opts) {
    opts = opts || {};
    if (!opts.raw && !opts.pass2) {
      // two passes: find the loop size, then filter out everything broader than
      // a loop (hairiness, unevenness) — a broad texture tilts the
      // autocorrelation and pulls each loop peak towards the centre
      var first = measure(img, { maxN: opts.maxN, pass2: true });
      if (first.error) return first;
      var sp = Math.min(10 * img.pxPerMm / first.wpc, 10 * img.pxPerMm / first.cpc);
      var second = measure(img, { maxN: opts.maxN, pass2: true, rPx: Math.max(2, 0.8 * sp) });
      return second.error ? first : second;
    }
    var raw = img;
    img = opts.raw ? img : detail(img, opts.rPx);
    var side = Math.min(img.w, img.h), N = opts.maxN || 512;
    while (N > 64 && N > side * 0.62) N >>= 1;
    if (N < 64) return { error: 'The image is too small to measure.' };
    var span = side - N, spots = [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]], rows = [];
    var rmin = Math.max(3, img.pxPerMm * 0.12);      // nothing knits finer than ~0.12 mm a loop
    spots.forEach(function (s) {
      var x0 = Math.round((img.w - side) / 2 + s[0] * span), y0 = Math.round((img.h - side) / 2 + s[1] * span);
      var R = autocorr(img.data, img.w, x0, y0, N);
      var L = lattice(R, N, rmin);
      if (!L) return;
      var cross = Math.abs(L.W[0] * L.C[1] - L.W[1] * L.C[0]);
      var lc = Math.hypot(L.C[0], L.C[1]), lw = Math.hypot(L.W[0], L.W[1]);
      var waleSp = cross / lc, courseSp = cross / lw;      // perpendicular spacings, px
      if (L.staggered) { waleSp /= 2; }
      var skew = Math.atan2(L.W[1], L.W[0]) - (Math.atan2(L.C[1], L.C[0]) - Math.PI / 2);
      rows.push({ wpc: 10 * img.pxPerMm / waleSp, cpc: 10 * img.pxPerMm / courseSp, skew: skew * 180 / Math.PI, r: (L.rW + L.rC) / 2, L: L, N: N, R: R });
    });
    if (rows.length < 2) return { error: 'No regular loop pattern was found. Check the fabric is in focus and fills the window.', code: 'no_loops' };
    var wpcs = rows.map(function (r) { return r.wpc; }), cpcs = rows.map(function (r) { return r.cpc; });
    var wpc = median(wpcs), cpc = median(cpcs);
    var spread = Math.max(median(wpcs.map(function (v) { return Math.abs(v - wpc) / wpc; })), median(cpcs.map(function (v) { return Math.abs(v - cpc) / cpc; })));
    var r = median(rows.map(function (x) { return x.r; }));
    var best = rows[0];
    var conf = spread < 0.02 && r > 0.45 ? 'high' : spread < 0.05 && r > 0.25 ? 'medium' : 'low';
    return {
      wpc: wpc, cpc: cpc, density: wpc * cpc, skew_deg: median(rows.map(function (x) { return x.skew; })),
      spread: spread, regularity: r, confidence: conf, staggered: best.L.staggered, used: rows.length,
      lattice: { W: best.L.W, C: best.L.C }, _R: best.R, _N: best.N, _raw: raw,
    };
  }

  // ── structure hints ──────────────────────────────────────────────────
  function profileContrast(img, W, C) {
    // fold the image across the wales into one wale period: grooves show as a deep minimum
    var bins = 24, sum = new Float64Array(bins), cnt = new Float64Array(bins);
    var lw = Math.hypot(W[0], W[1]), cx = C[0] / Math.hypot(C[0], C[1]), cy = C[1] / Math.hypot(C[0], C[1]);
    var nx = cy, ny = -cx;                                   // across the wales
    var period = Math.abs(W[0] * nx + W[1] * ny) || lw;
    for (var y = 0; y < img.h; y += 2) for (var x = 0; x < img.w; x += 2) {
      var t = (x * nx + y * ny) / period;
      var k = Math.floor((t - Math.floor(t)) * bins) % bins;
      sum[k] += img.data[y * img.w + x]; cnt[k]++;
    }
    var p = []; for (var i = 0; i < bins; i++) p.push(cnt[i] ? sum[i] / cnt[i] : 0);
    var mx = Math.max.apply(null, p), mn = Math.min.apply(null, p), mean = p.reduce(function (t, v) { return t + v; }, 0) / bins;
    return mean ? (mx - mn) / mean : 0;
  }
  function orientationShare(img) {
    // how much edge energy runs diagonally (V legs) versus across (arcs, sinker loops)
    var diag = 0, hor = 0, tot = 0, w = img.w, g = img.data;
    for (var y = 1; y < img.h - 1; y += 2) for (var x = 1; x < w - 1; x += 2) {
      var gx = g[y * w + x + 1] - g[y * w + x - 1], gy = g[(y + 1) * w + x] - g[(y - 1) * w + x];
      var e = gx * gx + gy * gy; if (e < 1e-4) continue;
      var a = Math.abs(Math.atan2(gy, gx)) * 180 / Math.PI; if (a > 90) a = 180 - a;   // 0 = vertical edge, 90 = horizontal edge
      if (a > 20 && a < 70) diag += e; else if (a >= 70) hor += e;
      tot += e;
    }
    return { diagonal: tot ? diag / tot : 0, across: tot ? hor / tot : 0 };
  }
  function repeatLift(m) {
    // a larger repeat (tuck cells): the autocorrelation at 2 wales or 2–4 courses beats the single step
    var R = m._R, N = m._N, W = m.lattice.W, C = m.lattice.C;
    var r1w = atF(R, N, W[0], W[1]), r1c = atF(R, N, C[0], C[1]);
    var r2w = atF(R, N, 2 * W[0], 2 * W[1]), r2c = atF(R, N, 2 * C[0], 2 * C[1]), r4c = atF(R, N, 4 * C[0], 4 * C[1]);
    return Math.max(r2w - r1w, Math.max(r2c, r4c) - r1c);
  }
  /** Features of one side, measured. */
  function features(img, m) {
    return {
      ratio: m.cpc / m.wpc, groove: profileContrast(img, m.lattice.W, m.lattice.C), repeat: repeatLift(m),
      regularity: m.regularity, orient: orientationShare(img),
    };
  }
  // course/wale ratio centres: the factory's own Ks ÷ Kw² per family (beds counted)
  var FAMILY_RATIO = { single_jersey: 1.36, rib: 1.65, interlock: 1.0, pique: 2.5 };
  var gauss = function (v, c, s) { var z = Math.log(v / c) / s; return Math.exp(-0.5 * z * z); };
  /**
   * The likely structures, most likely first. Hints, not a verdict: the person
   * confirms. face/back are features() of each side (back optional).
   */
  function suggest(face, back) {
    var S = {
      single_jersey: gauss(face.ratio, FAMILY_RATIO.single_jersey, 0.16) * (face.groove < 0.55 ? 1 : 0.5) * (face.repeat < 0.08 ? 1 : 0.25),
      rib: gauss(face.ratio, FAMILY_RATIO.rib, 0.2) * (face.groove > 0.45 ? 1.2 : 0.35) * (face.repeat < 0.12 ? 1 : 0.6),
      interlock: gauss(face.ratio, FAMILY_RATIO.interlock, 0.16) * (face.groove < 0.6 ? 1 : 0.6) * (face.repeat < 0.1 ? 1 : 0.3),
      pique: face.repeat > 0.15 ? 2.5 : face.repeat > 0.06 ? 0.8 : 0.08,
      fleece_or_terry: 0.08,
    };
    var why = {};
    if (back) {
      if (back.regularity < 0.2) { S.fleece_or_terry *= 6; why.fleece_or_terry = 'the back has no regular loop pattern (loop or brushed yarn)'; }
      if (back.orient.diagonal > back.orient.across + 0.05) { S.interlock *= 1.6; S.rib *= 1.4; S.single_jersey *= 0.45; why.interlock = 'the back shows loops like the face'; }
      else { S.single_jersey *= 1.4; S.pique *= 1.2; S.interlock *= 0.5; why.single_jersey = 'the back shows arcs, as a single-bed fabric does'; }
    }
    why.single_jersey = why.single_jersey || 'courses ÷ wales ' + face.ratio.toFixed(2) + ' (jersey ≈ 1.36)';
    why.rib = 'grooves between wales ' + (face.groove > 0.45 ? 'clear' : 'faint') + ', ratio ' + face.ratio.toFixed(2) + ' (rib ≈ 1.65)';
    why.interlock = why.interlock || 'ratio ' + face.ratio.toFixed(2) + ' (interlock ≈ 1.0)';
    why.pique = face.repeat > 0.05 ? 'a larger repeat over the loops (tuck cells)' : 'no larger repeat seen';
    why.fleece_or_terry = why.fleece_or_terry || 'photograph the back to check for loop yarn';
    var tot = 0; Object.keys(S).forEach(function (k) { tot += S[k]; });
    return Object.keys(S).map(function (k) { return { structure: k, p: tot ? S[k] / tot : 0, why: why[k] }; })
      .sort(function (a, b) { return b.p - a.p; });
  }

  // ── faults: where the photo breaks its own repeat ────────────────────
  function faults(img, m) {
    var W = m.lattice.W, C = m.lattice.C, w = img.w, h = img.h, g = img.data;
    var res = new Float32Array(w * h), mx = Math.ceil(Math.hypot(W[0], W[1]) + Math.hypot(C[0], C[1])) + 2;
    var sum = 0, sum2 = 0, n = 0;
    for (var y = mx; y < h - mx; y++) for (var x = mx; x < w - mx; x++) {
      var v = g[y * w + x];
      var nb = [bilinear(g, w, h, x + W[0], y + W[1]), bilinear(g, w, h, x - W[0], y - W[1]), bilinear(g, w, h, x + C[0], y + C[1]), bilinear(g, w, h, x - C[0], y - C[1])].sort(function (a, b) { return a - b; });
      var r = Math.abs(v - (nb[1] + nb[2]) / 2);
      res[y * w + x] = r; sum += r; sum2 += r * r; n++;
    }
    if (!n) return [];
    // average over one loop cell, then look for cells far off the norm
    var cell = Math.max(3, Math.round(Math.min(Math.hypot(W[0], W[1]), Math.hypot(C[0], C[1]))));
    var gw = Math.floor(w / cell), gh = Math.floor(h / cell), grid = new Float32Array(gw * gh);
    for (var gy = 0; gy < gh; gy++) for (var gx = 0; gx < gw; gx++) {
      var t = 0, k = 0;
      for (y = gy * cell; y < (gy + 1) * cell; y++) for (x = gx * cell; x < (gx + 1) * cell; x++) { if (res[y * w + x]) { t += res[y * w + x]; k++; } }
      grid[gy * gw + gx] = k ? t / k : 0;
    }
    var vals = Array.prototype.slice.call(grid).filter(function (v) { return v > 0; });
    if (!vals.length) return [];
    var med = median(vals), mad = median(vals.map(function (v) { return Math.abs(v - med); })) || 1e-4;
    var out = [], flagged = new Uint8Array(gw * gh);
    for (var i = 0; i < grid.length; i++) if (grid[i] > med + 14 * mad && grid[i] > med * 3) flagged[i] = 1;
    // a column of flagged cells is a needle line, a row is a barré, a cluster is a hole or a slub
    // hits along a column (or row), and how far along it they reach
    var colHits = new Array(gw).fill(0), rowHits = new Array(gh).fill(0), colSpan = [], rowSpan = [];
    for (gy = 0; gy < gh; gy++) for (gx = 0; gx < gw; gx++) if (flagged[gy * gw + gx]) {
      colHits[gx]++; rowHits[gy]++;
      colSpan[gx] = colSpan[gx] ? [Math.min(colSpan[gx][0], gy), Math.max(colSpan[gx][1], gy)] : [gy, gy];
      rowSpan[gy] = rowSpan[gy] ? [Math.min(rowSpan[gy][0], gx), Math.max(rowSpan[gy][1], gx)] : [gx, gx];
    }
    var line = function (hits, span, n) { return hits >= Math.max(4, n * 0.12) && span && span[1] - span[0] >= n * 0.5; };
    colHits.forEach(function (c, gx2) { if (line(c, colSpan[gx2], gh)) { out.push({ type: 'needle_line', x_mm: (gx2 + 0.5) * cell / img.pxPerMm, y_mm: null }); for (var yy = 0; yy < gh; yy++) flagged[yy * gw + gx2] = 0; } });
    rowHits.forEach(function (c, gy2) { if (line(c, rowSpan[gy2], gw)) { out.push({ type: 'barre', x_mm: null, y_mm: (gy2 + 0.5) * cell / img.pxPerMm }); for (var xx = 0; xx < gw; xx++) flagged[gy2 * gw + xx] = 0; } });
    var seen = new Uint8Array(gw * gh);
    for (i = 0; i < flagged.length; i++) {
      if (!flagged[i] || seen[i]) continue;
      var st = [i], cells = 0, sx = 0, sy = 0; seen[i] = 1;
      while (st.length) {
        var p = st.pop(), px = p % gw, py = (p / gw) | 0; cells++; sx += px; sy += py;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var qx = px + d[0], qy = py + d[1], q = qy * gw + qx;
          if (qx >= 0 && qy >= 0 && qx < gw && qy < gh && flagged[q] && !seen[q]) { seen[q] = 1; st.push(q); }
        });
      }
      if (cells >= 1) out.push({ type: 'hole_or_slub', x_mm: (sx / cells + 0.5) * cell / img.pxPerMm, y_mm: (sy / cells + 0.5) * cell / img.pxPerMm, cells: cells });
    }
    return out.slice(0, 12);
  }

  // ── colour against the card's white ─────────────────────────────────
  function srgbToLab(r, g, b) {
    var lin = function (c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    var R = lin(r), G = lin(g), B = lin(b);
    var X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    var f = function (t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; };
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  }
  /** rgba of the (small) image, its size, and the mm → small-image homography. */
  function colour(rgba, w, h, H, reg) {
    reg = reg || CARD.regions.window;
    var px = function (mx, my) { var q = apply(H, mx, my), x = Math.round(q[0]), y = Math.round(q[1]); if (x < 0 || y < 0 || x >= w || y >= h) return null; var i = (y * w + x) * 4; return [rgba[i], rgba[i + 1], rgba[i + 2]]; };
    var white = [0, 0, 0], nW = 0;
    CARD.white.forEach(function (p) {
      for (var d = -1; d <= 1; d++) { var c = px(p[0] + d, p[1] + d * 0.3); if (c) { white[0] += c[0]; white[1] += c[1]; white[2] += c[2]; nW++; } }
    });
    var fab = [0, 0, 0], nF = 0;
    for (var y = reg[2]; y <= reg[3]; y += 0.7) for (var x = reg[0]; x <= reg[1]; x += 0.7) {
      var c = px(x, y); if (c) { fab[0] += c[0]; fab[1] += c[1]; fab[2] += c[2]; nF++; }
    }
    if (!nF) return null;
    fab = fab.map(function (v) { return v / nF; });
    var ref = nW ? white.map(function (v) { return v / nW; }) : [240, 240, 240];
    var bal = fab.map(function (v, i) { return Math.max(0, Math.min(255, v * 242 / Math.max(40, ref[i]))); });
    var hex = '#' + bal.map(function (v) { var s = Math.round(v).toString(16); return s.length < 2 ? '0' + s : s; }).join('');
    return { rgb: bal.map(Math.round), hex: hex, lab: srgbToLab(bal[0], bal[1], bal[2]).map(function (v) { return Math.round(v * 10) / 10; }), white_seen: ref.map(Math.round) };
  }

  /**
   * Is this a knitted loop lattice, a woven thread grid, or a print with no textile repeat?
   * Knit: loops are V-shaped, so edge energy runs diagonally. Woven: threads cross at right angles, edges
   * are vertical/horizontal. Print/plain: no repeat at all (regularity low).
   */
  // edge energy against the lattice: along its two axes (woven threads) or slanted 15-75 degrees (knit V legs)
  function orientationRel(img, m) {
    var W = m.lattice.W, th = Math.atan2(W[1], W[0]), slant = 0, axial = 0, tot = 0, sp = 0, sn = 0, w = img.w, g = img.data;
    for (var y = 1; y < img.h - 1; y += 2) for (var x = 1; x < w - 1; x += 2) {
      var gx = g[y * w + x + 1] - g[y * w + x - 1], gy = g[(y + 1) * w + x] - g[(y - 1) * w + x];
      var e = gx * gx + gy * gy; if (e < 1e-4) continue;
      var a = Math.atan2(gy, gx) - th; a = ((a % Math.PI) + Math.PI) % Math.PI;
      var d = Math.min(a, Math.PI - a) * 180 / Math.PI;               // 0 = along the course axis, 90 = across it
      if (d > 15 && d < 75) slant += e; else axial += e;
      if (d > 30 && d < 60) { if (a < Math.PI / 2) sp += e; else sn += e; }
      tot += e;
    }
    return { slant: tot ? slant / tot : 0, axial: tot ? axial / tot : 0, diag: tot ? (sp + sn) / tot : 0, balance: Math.max(sp, sn) ? Math.min(sp, sn) / Math.max(sp, sn) : 1 };
  }
  function fabricKind(img, m) {
    if (!m || m.error) return { kind: 'unknown', why: 'no repeat found' };
    var r = m.regularity;
    if (r < 0.22) return { kind: 'none', why: 'no regular repeat: a print, a plain surface, or out of focus', scores: { r: r } };
    var o = orientationRel(detail(img), m);
    if (o.slant < 0.42) return { kind: 'woven', why: 'threads cross at right angles, no V-shaped loops', scores: o };
    if (o.diag > 0.3 && o.balance < 0.4) return { kind: 'woven', why: 'lines run one way on the diagonal (a twill), not the two-way V of knitted loops', scores: o };
    return { kind: 'knit', why: 'V-shaped loops in a lattice', scores: o };
  }

  // ══ WOVEN: the spectrum names the threads, the weave and its direction ═════════════════════════
  //
  // A woven cloth is two sets of threads at right angles. In its power spectrum the threads are the two
  // strongest peaks at right angles to each other (ends across, picks down): their distance from the
  // centre is ends and picks per mm, their direction is the thread axes. Everything the weave adds sits
  // at FRACTIONS of those two: a plain weave puts power at (½, ½), a 3/1 twill at (¼, ±¼) and its
  // multiples — the sign is the twill direction — a 5-end satin at (⅕, ⅖)… Each weave is a lattice in
  // thread units, so each is tested by the power it predicts, and the weave whose points carry the most
  // power, per point, is the one the cloth is woven in. Nothing is guessed: the spectrum is measured, the
  // candidate weaves are arithmetic.

  // the candidate weaves: their repeat lattice in thread units (x = ends, y = picks, y downwards)
  var WEAVE_LIB = (function () {
    var L = [{ id: 'plain', cls: 'plain', A: [[1, 1], [1, -1]], repeat: 2 }];
    [3, 4, 5].forEach(function (R) {
      L.push({ id: 'twill' + R + 'R', cls: 'twill', A: [[1, -1], [R, 0]], repeat: R, hand: 'RH' });
      L.push({ id: 'twill' + R + 'L', cls: 'twill', A: [[1, 1], [R, 0]], repeat: R, hand: 'LH' });
    });
    // a satin moves m picks per end and repeats every R picks: basis (1, m), (0, R)
    L.push({ id: 'satin5a', cls: 'satin', A: [[1, 2], [0, 5]], repeat: 5 }, { id: 'satin5b', cls: 'satin', A: [[1, 3], [0, 5]], repeat: 5 });
    L.push({ id: 'satin8a', cls: 'satin', A: [[1, 3], [0, 8]], repeat: 8 }, { id: 'satin8b', cls: 'satin', A: [[1, 5], [0, 8]], repeat: 8 });
    L.push({ id: 'basket22', cls: 'basket', A: [[2, 2], [2, -2]], repeat: 4 });
    L.push({ id: 'oxford', cls: 'half_basket_warp', A: [[2, 1], [2, -1]], repeat: 4 });
    L.push({ id: 'weftrib', cls: 'half_basket_weft', A: [[1, 2], [1, -2]], repeat: 4 });
    // the reciprocal points of each lattice, first order and a little beyond, fractions only
    L.forEach(function (w) {
      var a = w.A, d = a[0][0] * a[1][1] - a[0][1] * a[1][0];
      var b1 = [a[1][1] / d, -a[1][0] / d], b2 = [-a[0][1] / d, a[0][0] / d];   // rows of inv(A)^T
      var pts = [];
      for (var k = -10; k <= 10; k++) for (var l = -10; l <= 10; l++) {
        var u = k * b1[0] + l * b2[0], v = k * b1[1] + l * b2[1];
        if (Math.abs(u) > 1.05 || Math.abs(v) > 1.05 || (v < 0) || (v === 0 && u <= 0)) continue;   // one half-plane
        if (Math.abs(u - Math.round(u)) < 1e-6 && Math.abs(v - Math.round(v)) < 1e-6) continue;   // thread points
        if (!pts.some(function (p) { return Math.abs(p[0] - u) < 1e-6 && Math.abs(p[1] - v) < 1e-6; })) pts.push([u, v]);
      }
      w.pts = pts; w.det = Math.abs(d);
    });
    return L;
  })();

  // least squares: the thread frequencies that put every strong peak exactly on the weave's lattice
  function refineFrame(c, strong) {
    var fe = c.fe, fp = c.fp, A = c.H.A, d = fe[0] * fp[1] - fe[1] * fp[0];
    var S = [0, 0, 0], bx = [0, 0], by = [0, 0];
    var a00 = A[0][0], a01 = A[0][1], a10 = A[1][0], a11 = A[1][1], dA = a00 * a11 - a01 * a10;
    strong.forEach(function (p) {
      var u = (p.x * fp[1] - p.y * fp[0]) / d, v = (fe[0] * p.y - fe[1] * p.x) / d;
      // snap to the lattice: t = A·(u,v) must be whole
      var t1 = Math.round(a00 * u + a01 * v), t2 = Math.round(a10 * u + a11 * v);
      if (Math.abs(a00 * u + a01 * v - t1) > 0.13 || Math.abs(a10 * u + a11 * v - t2) > 0.13) return;
      var us = (a11 * t1 - a01 * t2) / dA, vs = (-a10 * t1 + a00 * t2) / dA, w = Math.sqrt(p.v);
      S[0] += w * us * us; S[1] += w * us * vs; S[2] += w * vs * vs;
      bx[0] += w * us * p.x; bx[1] += w * vs * p.x; by[0] += w * us * p.y; by[1] += w * vs * p.y;
    });
    var D = S[0] * S[2] - S[1] * S[1];
    if (Math.abs(D) < 1e-9) return { fe: fe, fp: fp };
    var sol = function (b) { return [(S[2] * b[0] - S[1] * b[1]) / D, (S[0] * b[1] - S[1] * b[0]) / D]; };
    var X = sol(bx), Y = sol(by);                     // f = u·fe + v·fp, solved for fe = (X0, Y0), fp = (X1, Y1)
    var nfe = [X[0], Y[0]], nfp = [X[1], Y[1]];
    if (Math.hypot(nfe[0] - fe[0], nfe[1] - fe[1]) > 2 || Math.hypot(nfp[0] - fp[0], nfp[1] - fp[1]) > 2) return { fe: fe, fp: fp };
    return { fe: nfe, fp: nfp };
  }

  /** The cloth folded into one repeat of its weave: which set is on top at each crossing (1 = the end). */
  function foldMatrix(src, sw, x0, y0, N, fe, fp, H, colourOK) {
    var le = Math.hypot(fe[0], fe[1]), lp = Math.hypot(fp[0], fp[1]);
    var se = N / le, sp = N / lp, ex = [fe[0] / le, fe[1] / le], ey = [-ex[1], ex[0]];
    // the rectangular repeat: the smallest Rx x Ry box of whole threads the lattice repeats in
    var A = H.A, Rx = 1, Ry = 1, dA = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    var inLat = function (m, n) { var p = (m * A[1][1] - n * A[1][0]) / dA, q = (-m * A[0][1] + n * A[0][0]) / dA; return Math.abs(p - Math.round(p)) < 1e-6 && Math.abs(q - Math.round(q)) < 1e-6; };
    while (!inLat(Rx, 0) && Rx < 12) Rx++;
    while (!inLat(0, Ry) && Ry < 12) Ry++;
    if (Rx * Ry > 64) return null;
    // fold the middle of the cloth into one repeat, at 8 x 8 sub-positions per crossing
    var S = 8, GW = Rx * S, GH = Ry * S, T = new Float64Array(GW * GH), Tn = new Float64Array(GW * GH);
    var cx0 = x0 + N / 2, cy0 = y0 + N / 2, half = Math.min(N / 2, Math.max(40, 8 * Math.max(se, sp)));
    for (var y = Math.round(cy0 - half); y < cy0 + half; y++) for (var x = Math.round(cx0 - half); x < cx0 + half; x++) {
      var dx = x - cx0, dy = y - cy0, u = (dx * ex[0] + dy * ex[1]) / se, v = (dx * ey[0] + dy * ey[1]) / sp;
      var gx = Math.floor(u * S), gy = Math.floor(v * S);
      var k = (((gy % GH) + GH) % GH) * GW + (((gx % GW) + GW) % GW);
      T[k] += src[y * sw + x]; Tn[k]++;
    }
    for (var q = 0; q < T.length; q++) T[q] = Tn[q] ? T[q] / Tn[q] : 0;
    // the crossings' boundaries are not known in advance: try every sub-position as the corner and keep the
    // placement where the crossings read most clearly. A yarn on top runs either down the crossing (the end:
    // it varies across, not down) or across it (the pick: it varies down, not across).
    var read = function (a, b) {
      var sc = [];
      for (var j = 0; j < Ry; j++) for (var i = 0; i < Rx; i++) {
        var pu = new Float64Array(S), pv = new Float64Array(S);
        for (var sv = 0; sv < S; sv++) for (var su = 0; su < S; su++) {
          var X = (i * S + su + a) % GW, Y = (j * S + sv + b) % GH, val = T[Y * GW + X];
          pu[su] += val; pv[sv] += val;
        }
        var rng = function (p) { var mx = -Infinity, mn = Infinity; for (var t = 1; t < S - 1; t++) { mx = Math.max(mx, p[t]); mn = Math.min(mn, p[t]); } return mx - mn; };
        var ru = rng(pu), rv = rng(pv);
        sc.push((ru - rv) / (ru + rv + 1e-9));
      }
      return sc;
    };
    // the borders sit on the gaps between threads: the darkest sub-position across the ends, and down the picks
    var colM = new Float64Array(S), rowM = new Float64Array(S);
    for (var Y = 0; Y < GH; Y++) for (var X = 0; X < GW; X++) { colM[X % S] += T[Y * GW + X]; rowM[Y % S] += T[Y * GW + X]; }
    var amin = function (arr) { var bi = 0; for (var t = 1; t < S; t++) if (arr[t] < arr[bi]) bi = t; return bi; };
    var a0 = amin(colM), b0 = amin(rowM), best = null;
    // within one sub-position of that, the clearest reading
    for (var da = -1; da <= 1; da++) for (var db = -1; db <= 1; db++) {
      var a = (a0 + da + S) % S, b = (b0 + db + S) % S;
      var sc = read(a, b), st = sc.reduce(function (t, z) { return t + Math.abs(z); }, 0) / sc.length;
      if (!best || st > best.st) best = { sc: sc, st: st, a: a, b: b };
    }
    var score = best.sc;
    var bright = [];
    for (var j3 = 0; j3 < Ry; j3++) for (var i3 = 0; i3 < Rx; i3++) {
      var sb = 0, nb = 0;
      for (var sv3 = 2; sv3 < S - 2; sv3++) for (var su3 = 2; su3 < S - 2; su3++) { sb += T[((j3 * S + sv3 + best.b) % GH) * GW + ((i3 * S + su3 + best.a) % GW)]; nb++; }
      bright.push(sb / nb);
    }
    var colourSplit = (function () {
      var srt = bright.slice().sort(function (p1, p2) { return p1 - p2; }), n = srt.length, mean = 0, tot = 0, bestS = null;
      if (n < 3) return null;
      srt.forEach(function (v) { mean += v; }); mean /= n;
      srt.forEach(function (v) { tot += (v - mean) * (v - mean); });
      if (tot <= 0) return null;
      for (var c = 1; c < n; c++) {
        var m1 = 0, m2 = 0; for (var q = 0; q < c; q++) m1 += srt[q]; for (q = c; q < n; q++) m2 += srt[q]; m1 /= c; m2 /= (n - c);
        var between = c * (m1 - mean) * (m1 - mean) + (n - c) * (m2 - mean) * (m2 - mean);
        if (!bestS || between > bestS.between) bestS = { between: between, cut: (srt[c - 1] + srt[c]) / 2, gap: m2 - m1 };
      }
      bestS.eta = bestS.between / tot;
      return bestS;
    })();
    var tmB = 0; for (var qb = 0; qb < T.length; qb++) tmB += T[qb]; tmB /= T.length;
    var byColour = !!(colourOK && colourSplit && colourSplit.eta >= 0.8 && colourSplit.gap >= 0.12 * Math.max(0.05, tmB));
    if (byColour) {
      // the dark group or the light group is the end: whichever carries the more vertical texture
      var sDark = 0, nDark = 0, sLight = 0, nLight = 0;
      bright.forEach(function (v, q) { if (v < colourSplit.cut) { sDark += score[q]; nDark++; } else { sLight += score[q]; nLight++; } });
      var darkIsEnd = (nDark ? sDark / nDark : 0) >= (nLight ? sLight / nLight : 0);
      score = bright.map(function (v) { return (v < colourSplit.cut) === darkIsEnd ? 0.5 : -0.5; });
    }
    // which crossings show the end: by sign when both signs are clearly there, else at the widest gap
    var hasPos = score.some(function (z) { return z > 0.15; }), hasNeg = score.some(function (z) { return z < -0.15; }), cut = 0;
    if (!(hasPos && hasNeg)) {
      var sorted = score.slice().sort(function (p1, p2) { return p1 - p2; }), gap = -1;
      for (var g2 = 1; g2 < sorted.length; g2++) { var gp = sorted[g2] - sorted[g2 - 1]; if (gp > gap) { gap = gp; cut = (sorted[g2] + sorted[g2 - 1]) / 2; } }
    }
    var on = score.map(function (z) { return z > cut ? 1 : 0; }), cells = [];
    for (var j = 0; j < Ry; j++) cells.push(on.slice(j * Rx, j * Rx + Rx));
    // Polarity, from the physics of a float: where an end floats over two picks in a row, its bright crown
    // runs straight across the border between them; where a pick floats over two ends, the same across the
    // vertical border. Elsewhere a border is a dark gap. The reading, or its complement, must agree.
    var Tz = function (X, Y) { var s3 = 0; for (var o = -1; o <= 1; o++) s3 += T[(((Y % GH) + GH) % GH) * GW + ((((X + o) % GW) + GW) % GW)]; return (s3 / 3 - tm) / tsd; };
    var TzV = function (X, Y) { var s3 = 0; for (var o = -1; o <= 1; o++) s3 += T[((((Y + o) % GH) + GH) % GH) * GW + (((X % GW) + GW) % GW)]; return (s3 / 3 - tm) / tsd; };
    var agreeFor = function (M2) {
      var t = 0;
      for (var jj = 0; jj < Ry; jj++) for (var ii = 0; ii < Rx; ii++) {
        var below = M2[(jj + 1) % Ry][ii], right = M2[jj][(ii + 1) % Rx];
        var zv = Tz(ii * S + best.a + (S >> 1), (jj + 1) * S + best.b);           // the border below this crossing, mid-end
        var zh = TzV((ii + 1) * S + best.a, jj * S + best.b + (S >> 1));          // the border to its right, mid-pick
        t += (M2[jj][ii] && below ? zv : -zv) + (!M2[jj][ii] && !right ? zh : -zh);
      }
      return t;
    };
    var tm = 0, tq = 0; for (q = 0; q < T.length; q++) { tm += T[q]; tq += T[q] * T[q]; }
    tm /= T.length; var tsd = Math.sqrt(Math.max(1e-12, tq / T.length - tm * tm));
    var comp = cells.map(function (r) { return r.map(function (z) { return 1 - z; }); });
    var flipped = !byColour && agreeFor(comp) > agreeFor(cells) + 0.5;
    if (flipped) { cells = comp; on = on.map(function (z) { return 1 - z; }); }
    var share = on.reduce(function (t, z) { return t + z; }, 0) / on.length;
    var wm = weaveMatch(cells, H); wm.flipped = flipped;
    return { cells: cells, ideal: wm.ideal, up: wm.up, warp_share: wm.ideal ? wm.share : share, match: wm.match, repeat: [Rx, Ry], strength: byColour ? Math.max(best.st, 0.5) : best.st, read_by: byColour ? 'colour' : 'texture', _scores: score };
  }
  // The read crossings against every clean weave this lattice can make — each class marks a few generator
  // crossings as "end on top", copied along the lattice — at every phase and face. The best agreement is the
  // match, and the clean pattern it agrees with is the weave diagram shown.
  function weaveMatch(cells, H) {
    var Ry = cells.length, Rx = cells[0].length, A = H.A, d = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    var inLat = function (m, n) { var p = (m * A[1][1] - n * A[1][0]) / d, q = (-m * A[0][1] + n * A[0][0]) / d; return Math.abs(p - Math.round(p)) < 1e-6 && Math.abs(q - Math.round(q)) < 1e-6; };
    var gens = [];
    if (H.cls === 'plain' || H.cls === 'satin') gens.push([[0, 0]]);
    else if (H.cls === 'twill') for (var k = 1; k < H.repeat; k++) { var g = []; for (var t = 0; t < k; t++) g.push([t, 0]); gens.push(g); }
    else if (H.cls === 'basket') gens.push([[0, 0], [1, 0], [0, 1], [1, 1]]);
    else if (H.cls === 'half_basket_warp') gens.push([[0, 0], [1, 0]]);
    else if (H.cls === 'half_basket_weft') gens.push([[0, 0], [0, 1]]);
    else return { match: 0.5, ideal: null };
    var best = null;
    gens.forEach(function (gen) {
      for (var inv = 0; inv < 2; inv++) for (var sy = 0; sy < Ry; sy++) for (var sx = 0; sx < Rx; sx++) {
        var agree = 0, ups = 0, ideal = [];
        for (var j = 0; j < Ry; j++) {
          var row = [];
          for (var i = 0; i < Rx; i++) {
            var up = gen.some(function (c) { return inLat(i - c[0] - sx, j - c[1] - sy); }) ? 1 : 0;
            if (inv) up = 1 - up;
            row.push(up); ups += up; if (up === cells[j][i]) agree++;
          }
          ideal.push(row);
        }
        var m = agree / (Rx * Ry);
        if (!best || m > best.match) best = { match: m, ideal: ideal, up: ups, share: ups / (Rx * Ry) };
      }
    });
    return best;
  }
  function turnMatrix(cells) {                     // the frame was turned a quarter: turn the diagram with it, and swap the sets
    var Ry = cells.length, Rx = cells[0].length, out = [];
    for (var i = 0; i < Rx; i++) { var row = []; for (var j = Ry - 1; j >= 0; j--) row.push(1 - cells[j][i]); out.push(row); }
    return out;
  }

  function powerSpectrum(src, sw, x0, y0, N) {
    var H = hannAC(N), re = new Float64Array(N * N), im = new Float64Array(N * N), mean = 0, x, y;
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) mean += src[(y0 + y) * sw + x0 + x];
    mean /= N * N;
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) re[y * N + x] = (src[(y0 + y) * sw + x0 + x] - mean) * H.w1[x] * H.w1[y];
    fft2(re, im, N, false);
    var Pw = new Float32Array(N * N);
    for (var k = 0; k < N * N; k++) Pw[k] = re[k] * re[k] + im[k] * im[k];
    return Pw;
  }

  /**
   * Read a woven cloth. src: grayscale (sw × sh) at P px/mm; (cx, cy) the centre of the area to read.
   */
  function analyseWoven(src, sw, sh, P, cx, cy, opts) {
    opts = opts || {};
    cx = cx == null ? sw / 2 : cx; cy = cy == null ? sh / 2 : cy;
    var room = Math.floor(Math.min(cx, cy, sw - cx, sh - cy) * 2), N = 512;
    while (N > 64 && N > room) N >>= 1;
    if (N < 128) return { ok: false, why: 'the area is too small to read threads' };
    var x0 = Math.round(cx - N / 2), y0 = Math.round(cy - N / 2);
    // everything below looks at this square and a margin for the filters: cut it out first
    var rHp = Math.round(Math.max(3, 1.2 * P)), M0 = 2 * rHp + 4;
    var cx0c = Math.max(0, x0 - M0), cy0c = Math.max(0, y0 - M0), cx1c = Math.min(sw, x0 + N + M0), cy1c = Math.min(sh, y0 + N + M0);
    var cw = cx1c - cx0c, chh = cy1c - cy0c, crop = new Float32Array(cw * chh);
    for (var yc = 0; yc < chh; yc++) for (var xc = 0; xc < cw; xc++) crop[yc * cw + xc] = src[(cy0c + yc) * sw + cx0c + xc];
    src = crop; sw = cw; sh = chh; x0 -= cx0c; y0 -= cy0c;
    var hp = detail({ data: src, w: sw, h: sh, pxPerMm: P }, rHp);
    var Pw = powerSpectrum(hp.data, sw, x0, y0, N);
    var pw = function (fx, fy) { fx = Math.round(fx); fy = Math.round(fy); return Pw[(((fy % N) + N) % N) * N + (((fx % N) + N) % N)]; };
    var pwMax3 = function (fx, fy) { var m = 0; for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) m = Math.max(m, pw(fx + dx, fy + dy)); return m; };
    // peaks: local maxima between a 3 mm period and a 0.07 mm period (no thread is finer than that)
    var rMin = Math.max(3, N / (3 * P)), rMax = Math.min(N / 2 - 2, N / (0.07 * P)), list = [], band = [];
    for (var fy = 0; fy <= rMax; fy++) for (var fx = -rMax; fx <= rMax; fx++) {
      if (fy === 0 && fx <= 0) continue;
      var r = Math.hypot(fx, fy); if (r < rMin || r > rMax) continue;
      var v = pw(fx, fy); band.push(v);
      var isMax = true;
      for (var ky = -1; ky <= 1 && isMax; ky++) for (var kx = -1; kx <= 1; kx++) if ((kx || ky) && pw(fx + kx, fy + ky) > v) { isMax = false; break; }
      if (isMax) list.push({ x: fx, y: fy, v: v, r: r });
    }
    if (list.length < 2) return { ok: false, why: 'no periodic structure in the spectrum' };
    band.sort(function (a, b) { return a - b; });
    var noise = band[Math.floor(band.length * 0.5)] || 1e-12;
    list.sort(function (a, b) { return b.v - a.v; });
    var vmax = list[0].v;
    var strong = list.filter(function (p) { return p.v >= 0.02 * vmax && p.v > 8 * noise; }).slice(0, 24);
    if (strong.length < 2) return { ok: false, why: 'no clear repeat' };
    var Lp = function (x, y) { return Math.log(1 + pwMax3(x, y) / noise); };

    // candidate thread frequencies: the strong peaks and small sums of the strongest. A thread peak can be
    // weak (an indigo warp barely shows its own gaps) and still be a point of the weave's lattice.
    var C = [];
    var addC = function (x, y) {
      if (y < 0 || (y === 0 && x < 0)) { x = -x; y = -y; }
      var rr = Math.hypot(x, y); if (rr < rMin * 1.4 || rr > rMax) return;
      for (var q = 0; q < C.length; q++) if (Math.hypot(C[q][0] - x, C[q][1] - y) < 1.2) return;
      C.push([x, y]);
    };
    strong.forEach(function (p) { addC(p.x, p.y); });
    var base = strong.slice(0, 7);
    for (var i = 0; i < base.length; i++) for (var k0 = 2; k0 <= 5; k0++) addC(k0 * base[i].x, k0 * base[i].y);
    for (i = 0; i < base.length; i++) for (var j = i + 1; j < base.length; j++) for (var k1 = -3; k1 <= 3; k1++) for (var k2 = -3; k2 <= 3; k2++) {
      if (!k1 || !k2) continue;
      addC(k1 * base[i].x + k2 * base[j].x, k1 * base[i].y + k2 * base[j].y);
    }
    var tot = strong.reduce(function (t, p) { return t + p.v; }, 0);
    var THREADS = { id: 'threads', cls: 'threads', A: [[1, 0], [0, 1]], repeat: 1, pts: [], det: 1 };
    var lib = WEAVE_LIB.concat([THREADS]);
    var best = null, all = [];
    for (i = 0; i < C.length; i++) for (j = 0; j < C.length; j++) {
      if (i === j) continue;
      var fe = C[i].slice(), fp = C[j].slice();
      var le = Math.hypot(fe[0], fe[1]), lp = Math.hypot(fp[0], fp[1]);
      var skewCos = Math.abs(fe[0] * fp[0] + fe[1] * fp[1]) / (le * lp);
      if (skewCos > 0.16) continue;                                                            // threads cross at right angles (perspective allowed for)
      if (le / lp < 0.33 || le / lp > 3 || N / le < 2.2 || N / lp < 2.2) continue;
      if (fe[0] < 0) fe = [-fe[0], -fe[1]];
      if (fe[0] * fp[1] - fe[1] * fp[0] < 0) fp = [-fp[0], -fp[1]];                       // (ends, picks) a proper frame
      if (Math.abs(fe[1]) > Math.abs(fe[0])) continue;                                         // ê the more horizontal one
      var det = fe[0] * fp[1] - fe[1] * fp[0];
      var coords = strong.map(function (p) { return [(p.x * fp[1] - p.y * fp[0]) / det, (fe[0] * p.y - fe[1] * p.x) / det, p.v]; });
      var te = Lp(fe[0], fe[1]) + Lp(fp[0], fp[1]);
      for (var h = 0; h < lib.length; h++) {
        var H = lib[h], A = H.A, un = 0;
        coords.forEach(function (c) {
          var t1 = c[0] * A[0][0] + c[1] * A[0][1], t2 = c[0] * A[1][0] + c[1] * A[1][1];
          if (Math.abs(t1 - Math.round(t1)) > 0.13 || Math.abs(t2 - Math.round(t2)) > 0.13) un += c[2];
        });
        un /= tot;
        if (un > 0.3) continue;
        var s = 0, n = 0;
        H.pts.forEach(function (q) {
          var bx = q[0] * fe[0] + q[1] * fp[0], by = q[0] * fe[1] + q[1] * fp[1];
          if (Math.hypot(bx, by) < rMin) return;
          s += Math.log(1 + pwMax3(bx, by) / noise); n++;
        });
        var ptsScore = n ? s / n : Math.log(1 + 3);
        var total = ptsScore + 0.45 * te - 4 * un - 0.04 * H.det - 25 * Math.max(0, skewCos - 0.035);
        var cand = { fe: fe, fp: fp, H: H, total: total, pts: ptsScore, un: un, te: te };
        all.push(cand);
        if (!best || total > best.total) best = cand;
      }
    }
    if (!best) return { ok: false, why: 'no two thread directions at right angles' };
    all.sort(function (a2, b2) { return b2.total - a2.total; });
    var tried = [], pick = null;
    for (var ci = 0; ci < all.length && tried.length < 6; ci++) {
      var c0 = all[ci];
      if (tried.some(function (t) { return t.H === c0.H && Math.hypot(t.fe[0] - c0.fe[0], t.fe[1] - c0.fe[1]) < 1.5 && Math.hypot(t.fp[0] - c0.fp[0], t.fp[1] - c0.fp[1]) < 1.5; })) continue;
      var fr = refineFrame(c0, strong), mat = null;
      // a photo is never quite flat: try the frame a little finer, coarser and turned, keep the sharpest fold
      for (var ks = -1; ks <= 1; ks++) for (var kp = -1; kp <= 1; kp++) for (var kr = -1; kr <= 1; kr++) {
        var a1 = 1 + 0.012 * ks, a2 = 1 + 0.012 * kp, rr = kr * 0.6 * Math.PI / 180, cr = Math.cos(rr), sr = Math.sin(rr);
        var fe2 = [a1 * (fr.fe[0] * cr - fr.fe[1] * sr), a1 * (fr.fe[0] * sr + fr.fe[1] * cr)], fp2 = [a2 * (fr.fp[0] * cr - fr.fp[1] * sr), a2 * (fr.fp[0] * sr + fr.fp[1] * cr)];
        var m2 = foldMatrix(src, sw, x0, y0, N, fe2, fp2, c0.H, !!opts.yarnColours);
        if (m2 && (!mat || m2.match + 0.5 * m2.strength > mat.match + 0.5 * mat.strength)) { mat = m2; mat._fe = fe2; mat._fp = fp2; }
      }
      if (mat && mat.match >= 0.75) fr = { fe: mat._fe, fp: mat._fp };
      c0.frame = fr; c0.matrix = mat;
      c0.final = c0.total + (mat ? 0.5 * (mat.match - 0.8) : -0.3);
      tried.push(c0);
      if (!pick || c0.final > pick.final) pick = c0;
    }
    best = pick || best;
    // the runner-up weave in the same frame, for the confidence
    var fe0 = best.fe, fp0 = best.fp, second = null;
    lib.forEach(function (H) {
      if (H === best.H) return;
      var s = 0, n = 0;
      H.pts.forEach(function (q) { var bx = q[0] * fe0[0] + q[1] * fp0[0], by = q[0] * fe0[1] + q[1] * fp0[1]; if (Math.hypot(bx, by) < rMin) return; s += Math.log(1 + pwMax3(bx, by) / noise); n++; });
      var sc = n ? s / n : Math.log(4);
      if (!second || sc > second.score) second = { id: H.id, score: sc };
    });
    // sub-bin thread frequencies (only where the thread peak itself is visible)
    var refine = function (f) {
      var x = Math.round(f[0]), y = Math.round(f[1]), c = pw(x, y), l = pw(x - 1, y), r2 = pw(x + 1, y), u = pw(x, y - 1), d = pw(x, y + 1);
      if (c < 6 * noise || c < l || c < r2 || c < u || c < d) return f;
      var ox = (l - r2) / (2 * (l - 2 * c + r2) || 1), oy = (u - d) / (2 * (u - 2 * c + d) || 1);
      return [x + Math.max(-0.5, Math.min(0.5, ox)), y + Math.max(-0.5, Math.min(0.5, oy))];
    };
    var fe = best.frame ? best.frame.fe : refine(best.fe), fp = best.frame ? best.frame.fp : refine(best.fp);
    var le = Math.hypot(fe[0], fe[1]), lp = Math.hypot(fp[0], fp[1]);
    var ex = [fe[0] / le, fe[1] / le], ey = [-ex[1], ex[0]];
    var se = N / le, sp = N / lp, axesDeg = Math.atan2(ex[1], ex[0]) * 180 / Math.PI;
    var Hb = best.H, A = Hb.A.map(function (row) { return row.slice(); });
    // the warp is the denser set: if the picks are denser, turn the frame a quarter (keeps the handedness)
    var swapped = false;
    if (sp < se * 0.96) {
      swapped = true;
      var t3 = se; se = sp; sp = t3; var t4 = ex; ex = ey; ey = [-t4[0], -t4[1]];
      A = A.map(function (row) { return [-row[1], row[0]]; });            // the repeat turned with the frame
    }
    // which set floats on the face: the shape of the central autocorrelation lobe in thread units —
    // warp floats are long in the pick direction, weft floats long in the end direction
    var R = autocorr(hp.data, sw, x0, y0, N), Iu = 0, Iv = 0, seen = {}, stack = [[0, 0]];
    var lim = 2.6 * Math.max(se, sp);
    while (stack.length) {
      var q2 = stack.pop(), key = q2[0] + ',' + q2[1];
      if (seen[key]) continue; seen[key] = 1;
      var rv = at(R, N, q2[0], q2[1]);
      if (rv < 0.45 || Math.abs(q2[0]) > lim || Math.abs(q2[1]) > lim) continue;
      var uu = (q2[0] * ex[0] + q2[1] * ex[1]) / se, vv = (q2[0] * ey[0] + q2[1] * ey[1]) / sp;
      Iu += rv * uu * uu; Iv += rv * vv * vv;
      stack.push([q2[0] + 1, q2[1]], [q2[0] - 1, q2[1]], [q2[0], q2[1] + 1], [q2[0], q2[1] - 1]);
    }
    var elong = (Iv + 1e-9) / (Iu + 1e-9);                                    // > 1: floats long down the warp
    var face = elong > 1.45 ? 'warp' : elong < 0.69 ? 'weft' : 'balanced';
    // the crossings themselves decide the face where they could be read
    var M = best.matrix;
    var faceRead = !!(M && M.match >= 0.9 && M.strength >= 0.3);
    if (faceRead) {
      var warpShare = swapped ? 1 - M.warp_share : M.warp_share;
      face = warpShare > 0.6 ? 'warp' : warpShare < 0.4 ? 'weft' : 'balanced';
    }
    // cover: fold the raw picture along each set into one thread period; the share brighter than mid
    var fold = function (dir, spc) {
      var bins = 16, s = new Float64Array(bins), c = new Float64Array(bins);
      for (var y2 = y0; y2 < y0 + N; y2 += 2) for (var x2 = x0; x2 < x0 + N; x2 += 2) {
        var tt = (x2 * dir[0] + y2 * dir[1]) / spc, kb = Math.floor((tt - Math.floor(tt)) * bins) % bins;
        s[kb] += src[y2 * sw + x2]; c[kb]++;
      }
      var prof = []; for (var q = 0; q < bins; q++) prof.push(c[q] ? s[q] / c[q] : 0);
      var mx = Math.max.apply(null, prof), mn = Math.min.apply(null, prof);
      if (mx - mn < 1e-6) return null;
      var mid = (mx + mn) / 2;
      return Math.max(0.45, Math.min(1, prof.filter(function (q) { return q >= mid; }).length / bins / 0.87));
    };
    var resolved = Hb.cls !== 'threads';
    var hand = null;
    if (Hb.cls === 'twill') { var mv = A[0][0] === 1 ? A[0][1] : A[1][0] === 1 ? A[1][1] : null; hand = mv == null ? Hb.hand : mv < 0 ? 'RH' : 'LH'; }
    var upCount = faceRead ? Math.round((swapped ? 1 - M.warp_share : M.warp_share) * Hb.repeat) : null;
    var wv = { id: Hb.id, cls: Hb.cls, repeat: Hb.repeat, score: Math.round(best.pts * 100) / 100,
      runner_up: second ? { id: second.id, score: Math.round(second.score * 100) / 100 } : null, face: face };
    if (wv.cls === 'plain') wv.name = 'Plain weave 1/1';
    else if (wv.cls === 'twill') {
      var Rr = wv.repeat, up = upCount != null && upCount > 0 && upCount < Rr ? upCount : face === 'warp' ? Rr - 1 : face === 'weft' ? 1 : Math.round(Rr / 2);
      if (upCount == null && Rr === 3 && face === 'balanced') up = 2;
      wv.notation = up + '/' + (Rr - up); wv.hand = hand;
      wv.direction = hand === 'RH' ? 'right-hand (Z, rising to the right)' : 'left-hand (S, rising to the left)';
      wv.angle_deg = Math.round(Math.atan2(sp, se) * 1800 / Math.PI) / 10;
      wv.name = wv.notation + ' twill, ' + hand;
    } else if (wv.cls === 'satin') wv.name = face === 'weft' ? wv.repeat + '-end sateen (weft-faced)' : wv.repeat + '-end satin (warp-faced)';
    else if (wv.cls === 'basket') wv.name = 'Basket / matt 2/2';
    else if (wv.cls === 'half_basket_warp') wv.name = swapped ? 'Rib weave (picks in pairs)' : 'Oxford / half-basket (ends in pairs)';
    else if (wv.cls === 'half_basket_weft') wv.name = swapped ? 'Oxford / half-basket (ends in pairs)' : 'Rib weave (picks in pairs)';
    else wv.name = 'Weave not resolved — threads counted';
    var margin = second ? best.pts - second.score : best.pts;
    var conf = !resolved ? 'low' : best.un < 0.1 && margin > 0.3 && (!M || M.match >= 0.85) ? 'high' : best.un < 0.2 && (margin > 0.1 || (M && M.match >= 0.9)) ? 'medium' : 'low';
    return {
      ok: true, weave: wv, ends_per_cm: 10 * P / se, picks_per_cm: 10 * P / sp, epi: 25.4 * P / se, ppi: 25.4 * P / sp,
      end_spacing_mm: se / P, pick_spacing_mm: sp / P, axes_deg: Math.round(axesDeg * 10) / 10, swapped: swapped,
      repeat_threads: A, unexplained: Math.round(best.un * 1000) / 1000, float_elongation: Math.round(elong * 100) / 100,
      matrix_strength: M ? Math.round(M.strength * 1000) / 1000 : null, matrix: M && M.ideal ? (swapped ? turnMatrix(M.ideal) : M.ideal) : null, matrix_read: M ? (swapped ? turnMatrix(M.cells) : M.cells) : null, matrix_match: M ? M.match : null,
      cover: { warp: fold(ex, se), weft: fold(ey, sp) }, thread_evidence: Math.round(best.te * 10) / 10, read_by: M ? M.read_by : null,
      confidence: conf,
    };
  }

  /** Two-tone yarn colours (k-means, 2 groups in Lab) — denim is an indigo warp over a white weft. */
  function twoTone(rgba, w, h) {
    var pts = [];
    for (var y = Math.round(h * 0.2); y < h * 0.8; y += 2) for (var x = Math.round(w * 0.2); x < w * 0.8; x += 2) {
      var i = (y * w + x) * 4; pts.push(srgbToLab(rgba[i], rgba[i + 1], rgba[i + 2]));
    }
    return twoToneLab(pts);
  }
  function twoToneRegion(rgba, w, h, Hm, reg) {
    var pts = [];
    for (var my = reg[2]; my <= reg[3]; my += (reg[3] - reg[2]) / 40) for (var mx = reg[0]; mx <= reg[1]; mx += (reg[1] - reg[0]) / 40) {
      var q = apply(Hm, mx, my), x = Math.round(q[0]), y = Math.round(q[1]);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      var i = (y * w + x) * 4; pts.push(srgbToLab(rgba[i], rgba[i + 1], rgba[i + 2]));
    }
    return twoToneLab(pts);
  }
  function twoToneLab(pts) {
    if (pts.length < 50) return null;
    var Ls = pts.map(function (p) { return p[0]; }).sort(function (a, b) { return a - b; });
    var c = [pts[Math.floor(pts.length * 0.2)].slice(), pts[Math.floor(pts.length * 0.8)].slice()];
    c[0][0] = Ls[Math.floor(Ls.length * 0.2)]; c[1][0] = Ls[Math.floor(Ls.length * 0.85)];
    var lab = null;
    for (var it = 0; it < 12; it++) {
      var s = [[0, 0, 0, 0], [0, 0, 0, 0]];
      pts.forEach(function (p) {
        var d0 = Math.hypot(p[0] - c[0][0], p[1] - c[0][1], p[2] - c[0][2]), d1 = Math.hypot(p[0] - c[1][0], p[1] - c[1][1], p[2] - c[1][2]);
        var k = d0 <= d1 ? 0 : 1; s[k][0] += p[0]; s[k][1] += p[1]; s[k][2] += p[2]; s[k][3]++;
      });
      for (var k = 0; k < 2; k++) if (s[k][3]) c[k] = [s[k][0] / s[k][3], s[k][1] / s[k][3], s[k][2] / s[k][3]];
      lab = s;
    }
    var n0 = lab[0][3], n1 = lab[1][3], tot = n0 + n1;
    var dark = c[0][0] <= c[1][0] ? 0 : 1, light = 1 - dark;
    var dE = Math.hypot(c[0][0] - c[1][0], c[0][1] - c[1][1], c[0][2] - c[1][2]);
    var chroma = function (q) { return Math.hypot(q[1], q[2]); };
    var hue = function (q) { var a = Math.atan2(q[2], q[1]) * 180 / Math.PI; return a < 0 ? a + 360 : a; };
    return {
      delta_e: Math.round(dE * 10) / 10, two_tone: dE > 14 && Math.min(n0, n1) / tot > 0.1,
      dark: { lab: c[dark].map(function (v) { return Math.round(v * 10) / 10; }), share: Math.round((dark ? n1 : n0) / tot * 100) / 100, chroma: Math.round(chroma(c[dark])), hue: Math.round(hue(c[dark])) },
      light: { lab: c[light].map(function (v) { return Math.round(v * 10) / 10; }), share: Math.round((light ? n1 : n0) / tot * 100) / 100, chroma: Math.round(chroma(c[light])), hue: Math.round(hue(c[light])) },
    };
  }

  // Knitted loops have legs: in every wale the yarn climbs one way on the left of the loop and the other way on
  // the right, the same in every course. The legs are the longest edges in the picture, so the strongest
  // gradient runs across them, along the course; the tilt of the texture against that direction swaps sign
  // from one leg to the next and holds still down the wale — in the spectrum of the tilt map, power on the one
  // line through the centre along the course. Woven threads run straight along both axes and their tilt map has
  // no such line. Run at the photo's own scale and, where the texture is coarse enough not to alias, at half.
  function legTest(g, w, h, cx, cy, axis, periodPx) {
    var out = null;
    [1, 2].forEach(function (k) {
      if (k > 1 && !(periodPx >= 8 * k / 2)) return;          // halving a fine texture would alias it into false legs
      var N = 256;
      while (N > 64 && (N * k > Math.min(w, h) - 4 || cx - N * k / 2 < 1 || cy - N * k / 2 < 1 || cx + N * k / 2 > w - 2 || cy + N * k / 2 > h - 2)) N >>= 1;
      if (N < 128) return;
      var x0 = Math.round(cx - N * k / 2), y0 = Math.round(cy - N * k / 2), img = new Float64Array(N * N);
      for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
        var sm = 0; for (var dy = 0; dy < k; dy++) for (var dx = 0; dx < k; dx++) sm += g[(y0 + y * k + dy) * w + x0 + x * k + dx];
        img[y * N + x] = sm / (k * k);
      }
      var gx = new Float64Array(N * N), gy = new Float64Array(N * N), c2 = 0, s2 = 0;
      for (y = 1; y < N - 1; y++) for (x = 1; x < N - 1; x++) {
        var I = function (yy, xx) { return img[yy * N + xx]; };
        var a1 = (I(y - 1, x + 1) + 2 * I(y, x + 1) + I(y + 1, x + 1) - I(y - 1, x - 1) - 2 * I(y, x - 1) - I(y + 1, x - 1)) / 8;
        var b1 = (I(y + 1, x - 1) + 2 * I(y + 1, x) + I(y + 1, x + 1) - I(y - 1, x - 1) - 2 * I(y - 1, x) - I(y - 1, x + 1)) / 8;
        gx[y * N + x] = a1; gy[y * N + x] = b1; c2 += a1 * a1 - b1 * b1; s2 += 2 * a1 * b1;
      }
      var al = Math.atan2(s2, c2) / 2, ca = Math.cos(al), sa = Math.sin(al);
      var re = new Float64Array(N * N), im = new Float64Array(N * N), Et = 0, H = hannAC(N).w1;
      for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
        var q = y * N + x, gu = gx[q] * ca + gy[q] * sa, gv = -gx[q] * sa + gy[q] * ca, hw = H[x] * H[y];
        re[q] = 2 * gu * gv * hw; Et += (gu * gu + gv * gv) * hw;
      }
      if (Et <= 0) return;
      fft2(re, im, N, false);
      var lines = [0, 0], peaks = [0, 0], all = 0;
      for (var fy = -N / 2 + 1; fy < N / 2; fy++) for (var fx = -N / 2 + 1; fx < N / 2; fx++) {
        if (Math.hypot(fx, fy) < 3) continue;
        var kk = ((fy + N) % N) * N + ((fx + N) % N), v = re[kk] * re[kk] + im[kk] * im[kk];
        all += v;
        var along = fx * ca + fy * sa, across = -fx * sa + fy * ca;
        if (Math.abs(across) <= 1.5 + 0.06 * Math.abs(along)) { lines[0] += v; if (v > peaks[0]) peaks[0] = v; }
        if (Math.abs(along) <= 1.5 + 0.06 * Math.abs(across)) { lines[1] += v; if (v > peaks[1]) peaks[1] = v; }
      }
      for (var d = 0; d < 1; d++) {
        var line = all > 0 ? lines[d] / all : 0, amp = Math.sqrt(peaks[d]) / Et;
        var score = amp * Math.min(1, line / 0.05);
        if (!out || score > out.score) out = { line: Math.round(line * 1000) / 1000, amp: Math.round(amp * 1000) / 1000, score: Math.round(score * 1000) / 1000, scale: k };
      }
    });
    if (!out) return null;
    out.legs = out.line >= 0.045 && out.amp >= 0.05 && out.score > 0.055;
    out.none = out.amp < 0.03;
    return out;
  }
  // the two thread sets are different colours (an indigo warp over a white weft, a yarn-dyed chambray) — not
  // just light and shade on one colour
  function yarnColours(t) {
    if (!t || !t.two_tone) return false;
    var d = t.dark, l = t.light, dh = Math.abs(d.hue - l.hue); if (dh > 180) dh = 360 - dh;
    // shade on one colour changes its lightness and chroma together, not its hue; a white set beside a dyed one
    // is near-neutral against clearly coloured
    return (Math.min(d.chroma, l.chroma) > 10 && dh > 40) || (Math.min(d.chroma, l.chroma) < 8 && Math.max(d.chroma, l.chroma) > 18);
  }
  var KNIT_NAMES = { single_jersey: 'Single jersey', rib: 'Rib', interlock: 'Interlock', pique: 'Pique', fleece: 'Fleece', terry: 'Terry', lacoste: 'Lacoste', french_terry: 'French terry', fleece_or_terry: 'Fleece / terry' };

  /**
   * What the cloth IS, in three levels — family (knit / woven), category (jersey, rib, denim, poplin …)
   * and structure (single jersey, 3/1 twill RH …) — with a probability for each candidate and the evidence,
   * item by item, that decided the family. Every item is a measurement with a physical reason behind it.
   */
  function identify(r) {
    var kind = r.kind || {}, wv = r.woven && r.woven.ok ? r.woven : null, col = r.two_tone || null, leg = r.legs || null, kr = r.knit_read || null;
    var ev = [], z = 0;
    var add = function (wgt, why) { z += wgt; ev.push({ says: wgt > 0 ? 'woven' : 'knit', weight: Math.round(Math.abs(wgt) * 100) / 100, why: why }); };
    add(-0.3, 'starting point: knitted, the cloth this scanner is mostly used on');
    if (leg && leg.legs) add(-2.2 * Math.min(1, (leg.score - 0.05) / 0.05), 'loop legs: the texture leans one way, then the other, across every wale');
    else if (leg && leg.score < 0.035 && (wv || (kr && kr.ok))) add(0.8 * Math.min(1, (0.035 - leg.score) / 0.025), 'no loop legs: the texture runs straight along two axes');
    if (!wv) add(-0.8, 'no two thread sets at right angles were found');
    else add(wv.confidence === 'high' ? 1.0 : wv.confidence === 'medium' ? 0.6 : 0.2, 'two thread sets at right angles, read as ' + wv.weave.name + ' (' + wv.confidence + ' confidence)');
    if (kind.kind === 'woven') add(0.7, kind.why || 'the texture runs along two axes, not in V-shaped loops');
    else if (kind.kind === 'knit') add(-0.15, kind.why || 'V-shaped texture, as loops make');
    if (kr && kr.ok) {
      if (kr.regularity >= 0.7 && kr.ratio >= 1.1 && kr.ratio <= 1.8) add(kr.regularity >= 0.8 ? -1.4 : -0.5, 'a clean loop lattice with a knitted loop shape (courses / wales = ' + kr.ratio.toFixed(2) + ')');
      else if (kr.regularity >= 0.8 && kr.ratio >= 0.95 && kr.ratio < 1.1) add(-0.6, 'a very regular loop lattice, loops about as tall as wide (courses / wales = ' + kr.ratio.toFixed(2) + ') — as in interlock');
      else if (kr.ratio < 0.98) add(0.4, 'read as loops they would be wider than tall (courses / wales = ' + kr.ratio.toFixed(2) + ') — not how a knitted loop sits');
    } else if (kr && !kr.ok) add(0.5, 'no loop lattice could be read');
    var blue = col && col.dark && col.dark.hue >= 220 && col.dark.hue <= 300 && col.dark.chroma > 12 && col.dark.lab[0] < 62;
    var denimLike = !!(blue && col.two_tone && col.light.lab[0] > col.dark.lab[0] + 18 && yarnColours(col));
    if (wv && denimLike && wv.weave.cls === 'twill') add(2.0, 'an indigo thread set over a light one, in a twill — dyed warp, white weft');
    else if (wv && yarnColours(col)) add(0.4, 'the two thread sets are different colours');
    var pW = 1 / (1 + Math.exp(-z));
    var cands = [];
    (r.knit_suggest || []).forEach(function (s) { cands.push({ family: 'knit', category: KNIT_NAMES[s.structure] || s.structure, structure: s.structure, p: (1 - pW) * s.p, why: s.why }); });
    if (!cands.length) cands.push({ family: 'knit', category: 'Single jersey', structure: 'single_jersey', p: 1 - pW, why: 'the most common knitted cloth' });
    if (wv) {
      var w = wv.weave, cat = 'Woven';
      if (w.cls === 'twill') cat = denimLike ? 'Denim' : w.notation === '2/2' ? ((w.angle_deg || 45) > 60 ? 'Gabardine' : 'Serge') : (w.angle_deg || 45) > 62 ? 'Gabardine / steep twill' : 'Drill / twill';
      else if (w.cls === 'plain' || w.cls === 'threads') cat = denimLike || (yarnColours(col) && blue) ? 'Chambray' : wv.ends_per_cm > 34 ? 'Poplin / shirting' : wv.ends_per_cm < 16 ? 'Canvas / sheeting' : 'Plain sheeting';
      else if (w.cls === 'satin') cat = w.face === 'weft' ? 'Sateen' : 'Satin';
      else if (w.cls === 'basket') cat = 'Matt / hopsack';
      else if (w.cls === 'half_basket_warp') cat = /Oxford/.test(w.name) ? 'Oxford' : 'Rib weave';
      else if (w.cls === 'half_basket_weft') cat = /Oxford/.test(w.name) ? 'Oxford' : 'Rib weave';
      if (w.cls === 'threads') cat = 'Woven (weave not resolved)';
      var share = w.cls === 'threads' ? 0.6 : wv.confidence === 'high' ? 0.85 : wv.confidence === 'medium' ? 0.7 : 0.55;
      cands.push({ family: 'woven', category: cat, structure: w.name, p: pW * share, why: (denimLike ? 'indigo warp over a light weft; ' : '') + w.name + ', the weave whose lattice carries the most power in the spectrum' });
      var ru = w.runner_up && WEAVE_LIB.filter(function (h) { return h.id === w.runner_up.id; })[0];
      var ruName = ru ? (ru.cls === 'twill' ? 'twill (repeat ' + ru.repeat + ')' : ru.cls === 'satin' ? ru.repeat + '-end satin' : ru.cls === 'plain' ? 'plain weave' : ru.cls === 'basket' ? 'basket / matt' : 'rib / oxford') : 'another weave';
      cands.push({ family: 'woven', category: 'Other weave', structure: ruName, p: pW * (1 - share), why: 'the next best weave for the same threads' });
    } else cands.push({ family: 'woven', category: 'Woven', structure: 'not read', p: pW, why: 'no thread lattice was read' });
    cands.forEach(function (c) { c.p = Math.round(c.p * 1000) / 1000; });
    cands.sort(function (a, b) { return b.p - a.p; });
    var family = pW >= 0.5 ? 'woven' : 'knit';
    var best = cands.filter(function (c) { return c.family === family; })[0] || cands[0];
    return { family: family, p_woven: Math.round(pW * 1000) / 1000, p_knit: Math.round((1 - pW) * 1000) / 1000, best: best, candidates: cands.slice(0, 6), evidence: ev, legs: leg, denim_like: denimLike };
  }

  /**
   * A photo with NO scan card: the fabric fills the frame. The repeat is found on the clearest patch; the
   * scale (px per mm) comes from the caller (focus distance, a known object, or a guess), so wales/cm
   * carries that scale's uncertainty. The lattice itself is measured in pixels and kept.
   * @param scale {pxPerMm, source: 'card'|'focus'|'reference'|'assumed', note}
   */
  function analyseFree(rgba, w, h, scale) {
    var gray = toGray(rgba, w, h);
    var P = scale && scale.pxPerMm > 0 ? scale.pxPerMm : 8;
    // work at <= 12 px/mm: loops are 0.5 to 1.5 mm, more pixels only add noise and time
    var k = Math.min(1, 12 / P);
    var small = k < 1 ? downscale(gray, w, h, Math.round(Math.max(w, h) * k)) : { data: gray, w: w, h: h, scale: 1 };
    var sw = small.w, sh = small.h, Ps = P / small.scale;
    var side = Math.min(sw, sh), N = Math.round(side * 0.56), best = null;
    var spots = [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]];
    for (var i = 0; i < spots.length; i++) {
      var cx = (sw - N) * spots[i][0] + N / 2, cy = (sh - N) * spots[i][1] + N / 2;
      var patch = rotPatch(small.data, sw, sh, cx, cy, N, 0, Ps);
      var m = measure(patch, { maxN: 256 });
      if (m.error) continue;
      if (!best || m.regularity > best.m.regularity) best = { m: m, flat: patch, c: [cx, cy] };
      if (best.m.regularity > 0.55 && best.m.confidence === 'high') break;
    }
    // the woven reading, the colours and the loop-leg test, at full resolution on the same spot (threads are finer
    // than loops). A clear woven needs nothing more from the knit reader.
    var cw = Math.min(w, 400), ch = Math.round(cw * h / w), srgb = smallRgba(rgba, w, h, cw, ch);
    var tone = null; try { tone = twoTone(srgb, cw, ch); } catch (_) { tone = null; }
    var spot = best ? [best.c[0] * small.scale, best.c[1] * small.scale] : [w / 2, h / 2];
    var wov = null; try { wov = analyseWoven(gray, w, h, P, spot[0], spot[1], { yarnColours: yarnColours(tone) }); } catch (_) { wov = null; }
    var legAxis = wov && wov.ok ? wov.axes_deg * Math.PI / 180 : best ? Math.atan2(best.m.lattice.W[1], best.m.lattice.W[0]) : null;
    var finest = Math.min(wov && wov.ok ? Math.min(wov.end_spacing_mm, wov.pick_spacing_mm) * P : Infinity, best ? Math.min(10 * Ps / best.m.wpc, 10 * Ps / best.m.cpc) * small.scale : Infinity);
    var legs = null; try { legs = legTest(gray, w, h, spot[0], spot[1], legAxis, isFinite(finest) ? finest : null); } catch (_) { legs = null; }
    // held sideways the knit reader swaps wales and courses back; the loop shape is read the same way
    var knitRead0 = best ? { ok: true, regularity: best.m.regularity, ratio: best.m.cpc / best.m.wpc < 0.78 ? best.m.wpc / best.m.cpc : best.m.cpc / best.m.wpc } : { ok: false };
    var kind0 = best ? fabricKind(best.flat, best.m) : { kind: 'none', scores: {} };
    // (the texture-orientation verdict is left out here: on a patch not yet turned square to the cloth it reads a
    // turned knit's legs as a one-way diagonal)
    var id0 = identify({ kind: { kind: 'none', scores: {} }, woven: wov, two_tone: tone, legs: legs, knit_read: knitRead0, knit_suggest: [] });
    if (wov && wov.ok && (!best || id0.p_woven >= 0.85)) {
      // clearly woven: the knit reader's slow angle search is skipped. Its first look (one patch, not turned)
      // is kept, so the person can still say "it is knitted" and get a loop count — a rougher one.
      var b0 = best ? best.m : null, sw0 = b0 && b0.cpc / b0.wpc < 0.78, f0 = null;
      if (b0) { try { f0 = features(best.flat, b0); } catch (_) { f0 = null; } }
      var id0s = identify({ kind: kind0, woven: wov, two_tone: tone, legs: legs, knit_read: knitRead0, knit_suggest: f0 ? (function () { try { return suggest(f0); } catch (_) { return []; } })() : [] });
      return {
        card: null, scale: { px_per_mm: Math.round(P * 10) / 10, source: scale && scale.source || 'assumed', note: scale && scale.note || null },
        kind: { kind: 'woven', why: 'read as woven', scores: kind0.scores || {} }, turned_deg: null, sideways: !!sw0,
        wpc: b0 ? (sw0 ? b0.cpc : b0.wpc) : wov.ends_per_cm, cpc: b0 ? (sw0 ? b0.wpc : b0.cpc) : wov.picks_per_cm, density: b0 ? b0.wpc * b0.cpc : wov.ends_per_cm * wov.picks_per_cm,
        skew_deg: b0 ? b0.skew_deg : 0, confidence: b0 ? b0.confidence : wov.confidence, spread: b0 ? b0.spread : 0,
        regularity: b0 ? b0.regularity : 0, staggered: b0 ? b0.staggered : false, lattice: b0 ? b0.lattice : null,
        wale_px: b0 ? 10 * Ps / b0.wpc * small.scale : null, course_px: b0 ? 10 * Ps / b0.cpc * small.scale : null,
        features: f0, faults: [], colour: colourPlain(srgb, cw, ch), _flat: best ? best.flat : null,
        woven: stripFlat(wov), two_tone: tone, legs: legs, family: 'woven', identity: id0s,
      };
    }
    if (!best) return { error: 'No regular loop pattern was found. Fill the frame with the fabric, 8 to 12 cm away, in focus.', code: 'no_loops' };
    // The phone is rarely square to the wales. Turn the patch through a fan of angles and keep the one where the
    // loop lattice stands straightest (courses across, wales down) and repeats most clearly; then measure there.
    var alignErr = function (mm) { var W = mm.lattice.W, C = mm.lattice.C; return Math.abs(Math.atan2(W[1], W[0])) * 180 / Math.PI + Math.abs(Math.abs(Math.atan2(C[1], C[0])) * 180 / Math.PI - 90); };
    var Ns = Math.min(320, Math.floor(Math.min(sw, sh) * 0.5));
    var tryAt = function (deg) {
      var rp = rotPatch(small.data, sw, sh, best.c[0], best.c[1], Ns, deg * Math.PI / 180, Ps), mm = measure(rp, { maxN: 256, pass2: true });
      return mm.error ? null : { deg: deg, score: mm.regularity - 0.012 * alignErr(mm) - 0.0015 * Math.abs(deg) };
    };
    var top = null;
    var scores0 = null;
    var square = alignErr(best.m) < 7 && best.m.regularity > 0.4;
    if (!square) {
      for (var dg = -40; dg <= 40; dg += 10) { var t = tryAt(dg); if (dg === 0) scores0 = t; if (t && (!top || t.score > top.score)) top = t; }
      if (top) [top.deg - 5, top.deg + 5].forEach(function (d2) { var t2 = tryAt(d2); if (t2 && t2.score > top.score) top = t2; });
      if (top) [top.deg - 2.5, top.deg + 2.5].forEach(function (d2) { var t2 = tryAt(d2); if (t2 && t2.score > top.score) top = t2; });
      var zero = scores0;
      if (top && zero && top.deg !== 0 && zero.score >= top.score - 0.05) top = zero;
    }
    var turned = null;
    if (top && Math.abs(top.deg) >= 4) {
      var th = top.deg * Math.PI / 180, room = Math.min(best.c[0], best.c[1], sw - best.c[0], sh - best.c[1]) * 2;
      var N2 = Math.floor(Math.min(N * 1.2, room / (Math.abs(Math.cos(th)) + Math.abs(Math.sin(th)))));
      if (N2 >= 128) {
        var rp2 = rotPatch(small.data, sw, sh, best.c[0], best.c[1], N2, th, Ps), rm = measure(rp2, { maxN: 512 });
        if (!rm.error) { best = { m: rm, flat: rp2, c: best.c }; turned = top.deg; }
      }
    }
    if (turned == null) { var fm = measure(best.flat, { maxN: 512 }); if (!fm.error) best = { m: fm, flat: best.flat, c: best.c }; }
    // held sideways (wales across the frame): courses always outnumber or equal wales in a knit, so swap back
    var sideways = best.m.cpc / best.m.wpc < 0.78;
    if (sideways) { var tw = best.m.wpc; best.m.wpc = best.m.cpc; best.m.cpc = tw; best.m.density = best.m.wpc * best.m.cpc; }
    var m2 = best.m, f = features(best.flat, m2), kind = fabricKind(best.flat, m2);
    var col = colourPlain(srgb, cw, ch);
    var knitSug = []; try { knitSug = suggest(f); } catch (_) {}
    var knitRead = { ok: true, regularity: m2.regularity, ratio: m2.cpc / m2.wpc };
    var idF = identify({ kind: kind, woven: wov, two_tone: tone, legs: legs, knit_read: knitRead, knit_suggest: knitSug });
    return {
      card: null, scale: { px_per_mm: Math.round(P * 10) / 10, source: scale && scale.source || 'assumed', note: scale && scale.note || null },
      kind: kind, turned_deg: turned, sideways: sideways,
      wpc: m2.wpc, cpc: m2.cpc, density: m2.density, skew_deg: m2.skew_deg, confidence: m2.confidence, spread: m2.spread,
      regularity: m2.regularity, staggered: m2.staggered, lattice: m2.lattice,
      wale_px: 10 * Ps / m2.wpc * small.scale, course_px: 10 * Ps / m2.cpc * small.scale,
      features: f, faults: faults(best.flat, m2), colour: col, _flat: best.flat,
      woven: wov && wov.ok ? stripFlat(wov) : wov, two_tone: tone, legs: legs, family: idF.family, identity: idF,
    };
  }
  function stripFlat(o) { var c = {}; for (var k in o) if (k !== '_flat') c[k] = o[k]; return c; }
  /** A square patch of `side` px around (cx, cy), the sampling grid turned by theta (radians). */
  function rotPatch(src, sw, sh, cx, cy, side, theta, pxPerMm) {
    var out = new Float32Array(side * side), c = Math.cos(theta), sn = Math.sin(theta), h = side / 2, bad = 0;
    for (var y = 0; y < side; y++) for (var x = 0; x < side; x++) {
      var dx = x - h + 0.5, dy = y - h + 0.5;
      var v = bilinear(src, sw, sh, cx + c * dx - sn * dy, cy + sn * dx + c * dy);
      if (v !== v) { v = 0.5; bad++; }
      out[y * side + x] = v;
    }
    return { data: out, w: side, h: side, pxPerMm: pxPerMm, outside: bad / out.length };
  }
  /** The fabric's own colour with no white reference: the mean of the middle, as the camera saw it. */
  function colourPlain(rgba, w, h) {
    var fab = [0, 0, 0], n = 0;
    for (var y = Math.round(h * 0.3); y < h * 0.7; y += 2) for (var x = Math.round(w * 0.3); x < w * 0.7; x += 2) { var i = (y * w + x) * 4; fab[0] += rgba[i]; fab[1] += rgba[i + 1]; fab[2] += rgba[i + 2]; n++; }
    if (!n) return null;
    fab = fab.map(function (v) { return v / n; });
    var hex = '#' + fab.map(function (v) { var t = Math.round(v).toString(16); return t.length < 2 ? '0' + t : t; }).join('');
    return { rgb: fab.map(Math.round), hex: hex, lab: srgbToLab(fab[0], fab[1], fab[2]).map(function (v) { return Math.round(v * 10) / 10; }), white_seen: null, reference: 'camera, no white card' };
  }

  /**
   * One photo, start to finish.
   * @param rgba  full image pixels (Uint8ClampedArray), w, h
   * @returns {object} measurement, or {error}
   */
  function analysePhoto(rgba, w, h) {
    var gray = toGray(rgba, w, h);
    var small = downscale(gray, w, h, 1200);
    var card = detectCard(small.data, small.w, small.h);
    if (card.error) return { error: card.error, code: 'no_card' };
    var full = card.corners.map(function (c) { return [c[0] * small.scale, c[1] * small.scale]; });
    var srcPx = card.pxPerMm * small.scale;
    if (srcPx < 9) return { error: 'The card is too small in the photo (' + srcPx.toFixed(1) + ' px per mm). Move the phone closer, or use a clip-on macro lens.' };
    var pick = findFabric(gray, w, h, full, srcPx);
    var Hsmall = homography(CARD.markers, card.corners);
    var smallRGBA = smallRgba(rgba, w, h, small.w, small.h);
    var wov = null, tone = null;
    if (pick.error) {
      // the knit reader found no loops: it may be a woven (threads, not loops) — read the window as one
      var flatW = rectify(gray, w, h, full, srcPx, { region: CARD.regions.window });
      try { tone = twoToneRegion(smallRGBA, small.w, small.h, Hsmall, CARD.regions.window); } catch (_) {}
      try { wov = flatW.outside < 0.02 && !isPaper(flatW.data) ? analyseWoven(flatW.data, flatW.w, flatW.h, flatW.pxPerMm, null, null, { yarnColours: yarnColours(tone) }) : null; } catch (_) { wov = null; }
      if (!wov || !wov.ok) return { error: pick.error };
      var legsW = null; try { legsW = legTest(flatW.data, flatW.w, flatW.h, flatW.w / 2, flatW.h / 2, wov.axes_deg * Math.PI / 180, Math.min(wov.end_spacing_mm, wov.pick_spacing_mm) * flatW.pxPerMm); } catch (_) {}
      var kindW = { kind: 'woven', why: 'threads at right angles, no loops', scores: { slant: 0.3, balance: 0.5 } };
      return {
        card: { px_per_mm: Math.round(srcPx * 10) / 10, tilt: Math.round(card.tilt * 100) / 100, fabric_at: 'window' },
        scale: { px_per_mm: Math.round(srcPx * 10) / 10, source: 'card', note: null }, kind: kindW,
        wpc: wov.ends_per_cm, cpc: wov.picks_per_cm, density: wov.ends_per_cm * wov.picks_per_cm, skew_deg: 0, confidence: wov.confidence, spread: 0,
        regularity: 0.5, staggered: false, lattice: null, features: null, faults: [], colour: colour(smallRGBA, small.w, small.h, Hsmall, CARD.regions.window),
        _flat: wov._flat, woven: stripFlat(wov), two_tone: tone, legs: legsW, family: 'woven',
        identity: identify({ kind: kindW, woven: wov, two_tone: tone, legs: legsW, knit_read: { ok: false }, knit_suggest: [] }),
      };
    }
    var flat = pick.flat, m = pick.m;
    var f = features(flat, m);
    var col = colour(smallRGBA, small.w, small.h, Hsmall, pick.region);
    try { tone = twoToneRegion(smallRGBA, small.w, small.h, Hsmall, pick.region); } catch (_) { tone = null; }
    try { wov = analyseWoven(flat.data, flat.w, flat.h, flat.pxPerMm, null, null, { yarnColours: yarnColours(tone) }); } catch (_) { wov = null; }
    var finC = Math.min(10 * flat.pxPerMm / m.wpc, 10 * flat.pxPerMm / m.cpc, wov && wov.ok ? Math.min(wov.end_spacing_mm, wov.pick_spacing_mm) * flat.pxPerMm : Infinity);
    var legsC = null; try { legsC = legTest(flat.data, flat.w, flat.h, flat.w / 2, flat.h / 2, wov && wov.ok ? wov.axes_deg * Math.PI / 180 : Math.atan2(m.lattice.W[1], m.lattice.W[0]), finC); } catch (_) {}
    var kindC = fabricKind(flat, m), sugC = []; try { sugC = suggest(f); } catch (_) {}
    var idC = identify({ kind: kindC, woven: wov, two_tone: tone, legs: legsC, knit_read: { ok: true, regularity: m.regularity, ratio: m.cpc / m.wpc }, knit_suggest: sugC });
    return {
      card: { px_per_mm: Math.round(srcPx * 10) / 10, tilt: Math.round(card.tilt * 100) / 100, fabric_at: pick.name },
      scale: { px_per_mm: Math.round(srcPx * 10) / 10, source: 'card', note: null }, kind: kindC,
      wpc: m.wpc, cpc: m.cpc, density: m.density, skew_deg: m.skew_deg, confidence: m.confidence, spread: m.spread,
      regularity: m.regularity, staggered: m.staggered, lattice: m.lattice, features: f, faults: faults(flat, m), colour: col,
      _flat: flat, woven: wov && wov.ok ? stripFlat(wov) : wov, two_tone: tone, legs: legsC, family: idC.family, identity: idC,
    };
  }
  // plain paper: bright and flat. Dark cloth is flat in absolute terms too, so contrast is judged against brightness.
  function isPaper(a) { var m = 0, q = 0, n = a.length; for (var i = 0; i < n; i += 3) { m += a[i]; q += a[i] * a[i]; } n = Math.ceil(n / 3); m /= n; var sd = Math.sqrt(Math.max(0, q / n - m * m)); return sd < 0.006 || (m > 0.55 && sd / m < 0.035); }
  /**
   * Where the fabric is: in the cut window, or lying beside the card. Each
   * candidate area in the photo is flattened; plain paper (no texture) is
   * skipped; the one with the clearest loop repeat is measured.
   */
  function findFabric(gray, w, h, corners, srcPx, opts) {
    opts = opts || {};
    var order = ['window', 'above', 'below', 'left', 'right'], best = null, lastErr = null, sawOutside = false;
    for (var i = 0; i < order.length; i++) {
      var reg = CARD.regions[order[i]];
      var flat = rectify(gray, w, h, corners, srcPx, { region: reg, maxPxPerMm: opts.maxPxPerMm });
      if (flat.outside > 0.02) { if (order[i] === 'window') sawOutside = true; continue; }
      if (isPaper(flat.data)) continue;                                        // plain paper: the window was not cut
      var m = measure(flat, { maxN: opts.maxN });
      if (m.error) { lastErr = m; continue; }
      if (!best || m.regularity > best.m.regularity) best = { name: order[i], region: reg, flat: flat, m: m };
      if (best.m.regularity > 0.4 && best.m.confidence !== 'low') break;      // clear enough: stop looking
    }
    if (best) return best;
    if (sawOutside && !lastErr) return { error: 'Part of the window is outside the photo. Keep the whole card in the frame.' };
    return { error: lastErr ? lastErr.error : 'No fabric found in the card window or beside the card. Cut out the window, or lay the card right next to the fabric.', code: lastErr ? lastErr.code : 'no_fabric' };
  }
  function smallRgba(rgba, w, h, W, H) {
    var out = new Uint8ClampedArray(W * H * 4), sx = w / W, sy = h / H;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var i = ((Math.floor((y + 0.5) * sy)) * w + Math.floor((x + 0.5) * sx)) * 4, o = (y * W + x) * 4;
      out[o] = rgba[i]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i + 2]; out[o + 3] = 255;
    }
    return out;
  }

  /**
   * Where to draw the check grid: lines along the wales (spaced one wale apart)
   * and across them (one course apart), placed in the darkest gap so each cell
   * should hold one loop. Returns unit directions, spacings and offsets in px.
   */
  function grid(img, m) {
    var W = m.lattice.W, C = m.lattice.C;
    var lc = Math.hypot(C[0], C[1]), cx = C[0] / lc, cy = C[1] / lc;   // along the wales
    var nx = cy, ny = -cx;                                             // across the wales
    if (nx < 0) { nx = -nx; ny = -ny; }
    var lw = Math.hypot(W[0], W[1]), wx = W[0] / lw, wy = W[1] / lw;   // along the courses
    var qx = -wy, qy = wx;                                             // across the courses
    if (qy < 0) { qx = -qx; qy = -qy; }
    var wSp = 10 * img.pxPerMm / m.wpc, cSp = 10 * img.pxPerMm / m.cpc;
    var fold = function (ux, uy, sp) {
      var bins = 20, s = new Float64Array(bins), n = new Float64Array(bins);
      for (var y = 0; y < img.h; y += 2) for (var x = 0; x < img.w; x += 2) {
        var t = (x * ux + y * uy) / sp, k = Math.floor((t - Math.floor(t)) * bins) % bins;
        s[k] += img.data[y * img.w + x]; n[k]++;
      }
      var best = 0; for (var i = 1; i < bins; i++) if (s[i] / n[i] < s[best] / n[best]) best = i;
      return (best + 0.5) / bins * sp;
    };
    return { wale: { dir: [cx, cy], normal: [nx, ny], spacing: wSp, offset: fold(nx, ny, wSp) },
      course: { dir: [wx, wy], normal: [qx, qy], spacing: cSp, offset: fold(qx, qy, cSp) } };
  }

  return {
    grid: grid, findFabric: findFabric, detail: detail, analyseFree: analyseFree, fabricKind: fabricKind, colourPlain: colourPlain,
    analyseWoven: analyseWoven, WEAVE_LIB: WEAVE_LIB, twoTone: twoTone, identify: identify, legTest: legTest, yarnColours: yarnColours,
    _foldMatrix: foldMatrix,
    CARD: CARD, toGray: toGray, downscale: downscale, homography: homography, apply: apply, detectCard: detectCard,
    rectify: rectify, autocorr: autocorr, lattice: lattice, measure: measure, features: features, suggest: suggest,
    faults: faults, colour: colour, srgbToLab: srgbToLab, analysePhoto: analysePhoto, median: median, FAMILY_RATIO: FAMILY_RATIO,
  };
});
