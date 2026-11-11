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
      var m = measure(patch, { maxN: 512 });
      if (m.error) continue;
      if (!best || m.regularity > best.m.regularity) best = { m: m, flat: patch, c: [cx, cy] };
      if (best.m.regularity > 0.6 && best.m.confidence === 'high') break;
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
    for (var dg = -40; dg <= 40; dg += 8) { var t = tryAt(dg); if (dg === 0) scores0 = t; if (t && (!top || t.score > top.score)) top = t; }
    if (top) [top.deg - 4, top.deg + 4].forEach(function (d2) { var t2 = tryAt(d2); if (t2 && t2.score > top.score) top = t2; });
    var zero = scores0;
    if (top && zero && top.deg !== 0 && zero.score >= top.score - 0.05) top = zero;
    var turned = null;
    if (top && Math.abs(top.deg) >= 4) {
      var th = top.deg * Math.PI / 180, room = Math.min(best.c[0], best.c[1], sw - best.c[0], sh - best.c[1]) * 2;
      var N2 = Math.floor(Math.min(N * 1.2, room / (Math.abs(Math.cos(th)) + Math.abs(Math.sin(th)))));
      if (N2 >= 128) {
        var rp2 = rotPatch(small.data, sw, sh, best.c[0], best.c[1], N2, th, Ps), rm = measure(rp2, { maxN: 512 });
        if (!rm.error) { best = { m: rm, flat: rp2, c: best.c }; turned = top.deg; }
      }
    }
    // held sideways (wales across the frame): courses always outnumber or equal wales in a knit, so swap back
    var sideways = best.m.cpc / best.m.wpc < 0.78;
    if (sideways) { var tw = best.m.wpc; best.m.wpc = best.m.cpc; best.m.cpc = tw; best.m.density = best.m.wpc * best.m.cpc; }
    var m2 = best.m, f = features(best.flat, m2), kind = fabricKind(best.flat, m2);
    var cw = Math.min(w, 400), ch = Math.round(cw * h / w);
    var col = colourPlain(smallRgba(rgba, w, h, cw, ch), cw, ch);
    return {
      card: null, scale: { px_per_mm: Math.round(P * 10) / 10, source: scale && scale.source || 'assumed', note: scale && scale.note || null },
      kind: kind, turned_deg: turned, sideways: sideways,
      wpc: m2.wpc, cpc: m2.cpc, density: m2.density, skew_deg: m2.skew_deg, confidence: m2.confidence, spread: m2.spread,
      regularity: m2.regularity, staggered: m2.staggered, lattice: m2.lattice,
      wale_px: 10 * Ps / m2.wpc * small.scale, course_px: 10 * Ps / m2.cpc * small.scale,
      features: f, faults: faults(best.flat, m2), colour: col, _flat: best.flat,
    };
  }
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
    if (pick.error) return { error: pick.error };
    var flat = pick.flat, m = pick.m;
    var f = features(flat, m);
    // colour from a small RGBA copy
    var Hsmall = homography(CARD.markers, card.corners);
    var smallRGBA = smallRgba(rgba, w, h, small.w, small.h);
    var col = colour(smallRGBA, small.w, small.h, Hsmall, pick.region);
    return {
      card: { px_per_mm: Math.round(srcPx * 10) / 10, tilt: Math.round(card.tilt * 100) / 100, fabric_at: pick.name },
      scale: { px_per_mm: Math.round(srcPx * 10) / 10, source: 'card', note: null }, kind: fabricKind(flat, m),
      wpc: m.wpc, cpc: m.cpc, density: m.density, skew_deg: m.skew_deg, confidence: m.confidence, spread: m.spread,
      regularity: m.regularity, staggered: m.staggered, lattice: m.lattice, features: f, faults: faults(flat, m), colour: col,
      _flat: flat,
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
    CARD: CARD, toGray: toGray, downscale: downscale, homography: homography, apply: apply, detectCard: detectCard,
    rectify: rectify, autocorr: autocorr, lattice: lattice, measure: measure, features: features, suggest: suggest,
    faults: faults, colour: colour, srgbToLab: srgbToLab, analysePhoto: analysePhoto, median: median, FAMILY_RATIO: FAMILY_RATIO,
  };
});
