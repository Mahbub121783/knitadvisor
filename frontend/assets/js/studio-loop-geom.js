// KnitAdvisor · Fabric Studio — yarn path of every loop, read straight from the
// needle programme the user draws.
//
// One yarn per course (a course is one feeder's pass), travelling across every
// needle of both beds in the order the yarn meets them. What it does at each
// needle is the programme cell:
//
//   K  a needle loop. Its feet come from BEHIND the loop already on the needle
//      and its legs cross IN FRONT of that loop's head: the new loop is drawn
//      through the old one, back to front. Its head reaches up to the course
//      where this needle next knits, so a loop held through tucks or misses is
//      drawn as long as it really is.
//   T  a tuck: an open arch, no crossing at its base, lying behind the held
//      loop with its crown beside that loop's head. The next knit loop on the
//      needle is drawn through both.
//   M  a miss: the yarn floats straight past, behind the held loop.
//   -  no needle in that slot: the yarn passes straight across.
//   E / R  a transfer to the next needle / to the needle opposite on the
//      other bed: the needle is left empty, the loop's head leans onto the
//      needle that took it.
//
// Units: one wale (needle pitch on a bed) = 1. Course spacing h = wales per cm
// ÷ courses per cm of the finished fabric, so the loops have the fabric's own
// shape. +z looks at the technical face of the cylinder; dial loops are built
// facing -z (from the face they show as reverse loops, as they do on a rib).
//
// Plain script (no import/export) so the page and the node tests both use it.
(function (root) {
  'use strict';

  function buildLoopPaths(spec) {
    var C = spec.C, D = spec.D || null;
    var F = C.length, W = C[0].length;
    var h = Math.max(0.5, Math.min(1.4, spec.h || 0.75));
    var bed = D ? (spec.bed === 'interlock' ? 'interlock' : 'rib') : 'single';
    var wide = spec.wales || Math.min(D ? 14 : 20, Math.max(W, W * Math.max(2, Math.ceil((D ? 8 : 10) / W))));
    var nW = Math.max(W, Math.floor(wide / W) * W);
    var tall = spec.courses || Math.min(24, Math.max(F, F * Math.max(2, Math.ceil(10 / F))));
    var nC = Math.max(F, Math.floor(tall / F) * F);
    // depth of the crossings: a yarn passes in front of or behind another by a yarn's width, so the drawn depths grow with the
    // yarn's radius (the base depths below were laid out for a radius of 0.12 wale)
    var rMaxIn = Array.isArray(spec.radius) ? Math.max.apply(null, spec.radius.concat([0.12])) : (+spec.radius || 0.12);
    var kz = Math.max(1, rMaxIn / 0.12);
    var zc = (!D ? 0 : bed === 'interlock' ? 0.42 : 0.34) * kz;
    var beds = [{ key: 'C', g: C, s: 1, z0: zc, xoff: 0 }];
    if (D) beds.push({ key: 'D', g: D, s: -1, z0: -zc, xoff: bed === 'rib' ? 0.5 : 0 });

    var act = function (b, j, c) { return b.g[((c % F) + F) % F][((j % W) + W) % W]; };
    // the course in which this needle next knits: the loop on it is held until then
    var nextKnit = function (b, j, c) {
      for (var k = c + 1; k <= c + 3 * F; k++) if (act(b, j, k) === 'K') return k;
      return c + 1;
    };
    // tucks lying on the needle since it last knitted, before course c
    var tucksOn = function (b, j, c) {
      var n = 0;
      for (var k = c - 1; k >= c - 3 * F; k--) { var a = act(b, j, k); if (a === 'K') break; if (a === 'T') n++; }
      return n;
    };
    // h is the spacing of the courses you count on the face. A feeder is not
    // always one of them: on interlock each needle knits on every other feed,
    // on a piqué on three feeds in four. Each feed advances by the share of
    // a face course it makes, so a loop that knits at the usual rate has the
    // usual height.
    var knitRate = (function () {
      var n = 0, k = 0;
      for (var j = 0; j < W; j++) {
        var kj = 0;
        for (var f = 0; f < F; f++) if (C[f][j] === 'K') kj++;
        if (kj) { n++; k += kj; }
      }
      return n ? k / n / F : 1;
    })();
    var step = h * knitRate;
    var y = function (c) { return c * step; };
    // a transfer (E): the loop on this needle is handed to the next needle at
    // that feed. Returns the feed of the transfer, or -1 if the loop is
    // knitted off here as usual.
    var transferAt = function (b, j, c, sym) {
      for (var k = c + 1; k <= c + 3 * F; k++) { var a = act(b, j, k); if (a === 'K') return -1; if (a === (sym || 'E')) return k; }
      return -1;
    };
    // the receiving needle clears the transferred loop at its next knit, at
    // or after the transfer feed
    var knitFrom = function (b, j, k) { for (var q = k; q <= k + 3 * F; q++) if (act(b, j, q) === 'K') return q; return k; };
    // sinker-loop plush: the pile yarn of these feeds stands over the high
    // sinker on the technical back, height H wales
    var tdir = spec.transferDir === 'left' ? -1 : 1;   // a transfer hands the loop to the right (or left) neighbour
    var pileH = spec.pileH || 0;
    var PILE = { full: function () { return true; }, alternate: function (w) { return w % 2 === 0; }, checker: function (w, c) { return (w + c) % 2 === 0; }, diagonal: function (w, c) { return (w + c) % 3 === 0; } };
    var pileOn = PILE[spec.pileArrangement] || PILE.full;

    var courses = [], lead = [], nLead = Math.max(0, Math.min(2, spec.lead | 0));
    // nLead courses below the swatch: the loops the first course is drawn through (the view cuts them off cleanly)
    for (var c = -nLead; c < nC; c++) {
      var feed = ((c % F) + F) % F;
      var pos = [];
      beds.forEach(function (b, bi) { for (var j = 0; j < nW; j++) pos.push({ b: b, bi: bi, j: j, x: j + b.xoff }); });
      var bedIndex = function (b) { return beds.indexOf(b); };
      pos.sort(function (p, q) { return p.x - q.x || p.bi - q.bi; });

      var pts = [], side = [], stitches = [];
      var push = function (x, yy, z, s) { pts.push({ x: x, y: yy, z: z }); side.push(s); };
      var prev = null;
      for (var i = 0; i < pos.length; i++) {
        var p = pos[i], b = p.b, bi = bedIndex(b), s = b.s, z0 = b.z0, X = p.x, y0 = y(c);
        var a = act(b, p.j, c);
        if (prev) {
          // between two needles of one bed the yarn dips into a sinker loop;
          // between the beds it crosses over from one to the other
          var mx = (prev.x + X) / 2;
          if (prev.b === b && prev.a !== '-' && a !== '-') push(mx, y0 - 0.14 * h, z0 - s * 0.16 * kz, s);
          else if (prev.b !== b) push(mx, y0 + 0.04 * h, (prev.b.z0 + z0) / 2, 0);
        }
        var rec = { course: c, feed: feed, bed: b.key, needle: (p.j % W) + 1, wale: p.j, x: X, act: a, y0: y0, from: pts.length };
        if (a === 'K') {
          var n = nextKnit(b, p.j, c), t = tucksOn(b, p.j, c);
          var tk = transferAt(b, p.j, c), sh = 0;
          if (tk > -1) { n = knitFrom(b, p.j + tdir, tk); sh = 0.5 * tdir; rec.transferred = tk - c; }
          // R: the loop is handed to the needle opposite on the other bed — its head leans across to it
          var rk = beds.length > 1 ? transferAt(b, p.j, c, 'R') : -1, hz = 0;
          if (rk > -1 && tk < 0) { var ob = beds[1 - bi]; n = knitFrom(ob, p.j, rk); hz = (ob.z0 - z0) * 0.8; rec.transferred = rk - c; rec.toBed = ob.key; }
          var yt = y(n) + 0.38 * h;
          // the feet go behind everything on the needle: the old loop and any tucks
          var fz = z0 - s * (0.14 + 0.16 * Math.min(2, t)) * kz;
          // narrow feet (they pass inside the old loop's head), legs leaning out, and a head wider than the legs so the next
          // loop's feet pass through it; depths scale with the yarn so the crossings clear each other
          push(X - 0.15, y0 - 0.02 * h, fz, s);
          push(X - 0.24, y0 + 0.14 * h, z0 + s * 0.12 * kz, s);
          push(X - 0.30, y0 + 0.40 * h, z0 + s * 0.17 * kz, s);
          if (n > c + 1) push(X - 0.32, yt - 0.64 * h, z0 + s * 0.15 * kz, s);
          // a transferred loop leans its head onto the needle that took it
          push(X - 0.37 + sh * 0.6, yt - 0.40 * h, z0 + s * 0.10 * kz, s);
          push(X - 0.30 + sh, yt - 0.12 * h, z0 + hz - s * 0.04 * kz, s);
          push(X + sh, yt, z0 + hz - s * 0.12 * kz, s);
          push(X + 0.30 + sh, yt - 0.12 * h, z0 + hz - s * 0.04 * kz, s);
          push(X + 0.37 + sh * 0.6, yt - 0.40 * h, z0 + s * 0.10 * kz, s);
          if (n > c + 1) push(X + 0.32, yt - 0.64 * h, z0 + s * 0.15 * kz, s);
          push(X + 0.30, y0 + 0.40 * h, z0 + s * 0.17 * kz, s);
          push(X + 0.24, y0 + 0.14 * h, z0 + s * 0.12 * kz, s);
          push(X + 0.15, y0 - 0.02 * h, fz, s);
          rec.held = n - c - 1; rec.top = yt; rec.tucks = t;
        } else if (a === 'T') {
          var nt = nextKnit(b, p.j, c), ct = y(nt) + 0.30 * h;
          push(X - 0.34, y0 + 0.02 * h, z0 - s * 0.20 * kz, s);
          push(X - 0.32, (y0 + ct) / 2, z0 - s * 0.24 * kz, s);
          push(X - 0.20, ct - 0.10 * h, z0 - s * 0.26 * kz, s);
          push(X, ct, z0 - s * 0.26 * kz, s);
          push(X + 0.20, ct - 0.10 * h, z0 - s * 0.26 * kz, s);
          push(X + 0.32, (y0 + ct) / 2, z0 - s * 0.24 * kz, s);
          push(X + 0.34, y0 + 0.02 * h, z0 - s * 0.20 * kz, s);
          rec.held = nt - c - 1; rec.top = ct;
        } else if (a === 'M') {
          push(X - 0.30, y0 + 0.06 * h, z0 - s * 0.27 * kz, s);
          push(X + 0.30, y0 + 0.06 * h, z0 - s * 0.27 * kz, s);
          rec.top = y0 + 0.06 * h;
        } else {
          // no needle, or an emptied needle after a transfer: the eyelet
          push(X, y0 + 0.02 * h, z0, s);
          rec.top = y0;
        }
        rec.to = pts.length - 1;
        stitches.push(rec);
        prev = { b: b, x: X, a: a };
      }
      var course = { course: c, feed: feed, points: pts, side: side, stitches: stitches };
      if (pileH > 0 && spec.pileFeeds && spec.pileFeeds[feed]) {
        // the pile yarn follows the ground loop one yarn behind it and, between
        // two needles, climbs over the high sinker into a standing loop
        var pile = [], ps = [];
        stitches.forEach(function (st, si) {
          for (var q = st.from; q <= st.to; q++) { var pt = pts[q]; pile.push({ x: pt.x, y: pt.y, z: pt.z - 0.11 }); ps.push(1); }
          var nx = stitches[si + 1];
          if (!nx) return;
          var mx2 = (st.x + nx.x) / 2, yb = y(c) - 0.12 * h;
          if (pileOn(st.wale, c)) {
            [[-0.2, 0, 0.25], [-0.26, 0.2, 0.8], [0, 0.32, 1], [0.26, 0.2, 0.8], [0.2, 0, 0.25]].forEach(function (k) {
              pile.push({ x: mx2 + k[0], y: yb - k[1] * h, z: -0.2 - k[2] * pileH }); ps.push(1);
            });
          } else { pile.push({ x: mx2, y: yb, z: -0.26 }); ps.push(1); }
        });
        course.pile = pile;
      }
      if (c < 0) lead.push(course); else courses.push(course);
    }
    var geo = { courses: courses, lead: lead, wales: nW, rows: nC, h: h, step: step, bed: bed, F: F, W: W, zc: zc };
    if (spec.relax) relax(geo, { radius: spec.radius || 0.13, iterations: spec.relaxIterations });
    return geo;
  }


  // ── contact relaxation: the yarns as solid round yarns that cannot pass through each other ─────────────────────────────
  // The control points above give each stitch its topology (what goes over and under what). Drawn as tubes of the yarn's own
  // diameter they would overlap where two yarns cross or two legs sit side by side. This pass makes each course a dense
  // chain of points and moves them until no two yarns are closer than the sum of their radii: crossings separate in depth,
  // neighbouring legs share the wale between them, the way the yarns settle in a relaxed cloth. Each point is held to its
  // drawn place in the plane of the cloth (the loop keeps its shape) and is free in depth; a chain smoothing keeps the yarn
  // bending gently. Plain geometry, no tuning per structure.

  // centripetal Catmull–Rom through the control points, sampled about every ds along the yarn
  function densify(P, side, ds) {
    var out = [], os = [];
    if (P.length < 2) return { pts: P.slice(), side: side.slice() };
    var get = function (i) { return P[Math.max(0, Math.min(P.length - 1, i))]; };
    var d = function (a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) + (a.z - b.z) * (a.z - b.z)); };
    for (var i = 0; i < P.length - 1; i++) {
      var p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      var t0 = 0, t1 = t0 + Math.pow(Math.max(1e-6, d(p0, p1)), 0.5), t2 = t1 + Math.pow(Math.max(1e-6, d(p1, p2)), 0.5), t3 = t2 + Math.pow(Math.max(1e-6, d(p2, p3)), 0.5);
      var n = Math.max(1, Math.ceil(d(p1, p2) / ds));
      for (var k = 0; k < n; k++) {
        var t = t1 + (t2 - t1) * (k / n), q = {};
        ['x', 'y', 'z'].forEach(function (c) {
          var A1 = (t1 - t) / (t1 - t0) * p0[c] + (t - t0) / (t1 - t0) * p1[c];
          var A2 = (t2 - t) / (t2 - t1) * p1[c] + (t - t1) / (t2 - t1) * p2[c];
          var A3 = (t3 - t) / (t3 - t2) * p2[c] + (t - t2) / (t3 - t2) * p3[c];
          var B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2;
          var B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3;
          q[c] = (t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2;
        });
        out.push(q); os.push(side[i]);
      }
    }
    out.push({ x: P[P.length - 1].x, y: P[P.length - 1].y, z: P[P.length - 1].z }); os.push(side[side.length - 1]);
    return { pts: out, side: os };
  }

  /**
   * relax(geo, { radius: number | per-feed array, iterations, gap }) — in place. Returns the smallest clearance found
   * afterwards, as a share of the two radii (1 = just touching).
   */
  function relax(geo, opt) {
    opt = opt || {};
    var all = (geo.lead || []).concat(geo.courses);
    var rOf = function (co) { var r = opt.radius; return Array.isArray(r) ? (r[co.feed] || 0.13) : (r || 0.13); };
    var rMax = all.reduce(function (m, co) { return Math.max(m, rOf(co)); }, 0.05);
    var ds = Math.max(0.03, rMax * 0.6), gap = opt.gap == null ? 1.0 : opt.gap;
    all.forEach(function (co) { var dz = densify(co.points, co.side, ds); co.points = dz.pts; co.side = dz.side; });
    // flat arrays: every point of every course
    var N = all.reduce(function (t, co) { return t + co.points.length; }, 0);
    var X = new Float64Array(N), Y = new Float64Array(N), Z = new Float64Array(N), AX = new Float64Array(N), AY = new Float64Array(N);
    var CH = new Int32Array(N), IX = new Int32Array(N), RR = new Float64Array(N), SK = new Int32Array(N), FIRST = new Uint8Array(N), LAST = new Uint8Array(N);
    var o = 0;
    all.forEach(function (co, ci) {
      var r = rOf(co), sk = Math.ceil((2.6 * r) / ds) + 1;
      co.points.forEach(function (p, i) { X[o] = AX[o] = p.x; Y[o] = AY[o] = p.y; Z[o] = p.z; CH[o] = ci; IX[o] = i; RR[o] = r; SK[o] = sk; FIRST[o] = i === 0 ? 1 : 0; LAST[o] = i === co.points.length - 1 ? 1 : 0; o++; });
    });
    var cell = 2 * rMax * gap + 1e-6, inv = 1 / cell;
    var HS = 1; while (HS < N * 2) HS <<= 1;
    var head = new Int32Array(HS), next = new Int32Array(N), worst = Infinity;
    var hash = function (gx, gy, gz) { return ((gx * 73856093) ^ (gy * 19349663) ^ (gz * 83492791)) & (HS - 1); };
    var tx = new Float64Array(N), ty = new Float64Array(N), tz = new Float64Array(N);
    var pass = function (anchor, smooth, measure) {
      head.fill(-1);
      for (var p = 0; p < N; p++) { var hh = hash(Math.floor(X[p] * inv), Math.floor(Y[p] * inv), Math.floor(Z[p] * inv)); next[p] = head[hh]; head[hh] = p; }
      for (var a = 0; a < N; a++) {
        var gx = Math.floor(X[a] * inv), gy = Math.floor(Y[a] * inv), gz = Math.floor(Z[a] * inv);
        for (var u = -1; u <= 1; u++) for (var v = -1; v <= 1; v++) for (var w = -1; w <= 1; w++) {
          for (var b = head[hash(gx + u, gy + v, gz + w)]; b !== -1; b = next[b]) {
            if (b <= a) continue;
            if (CH[a] === CH[b] && IX[b] - IX[a] <= SK[a]) continue;
            var dx = X[a] - X[b], dy = Y[a] - Y[b], dz = Z[a] - Z[b], d2 = dx * dx + dy * dy + dz * dz, m = RR[a] + RR[b], min = m * gap;
            if (measure) { if (d2 < 4 * m * m) { var q = Math.sqrt(d2) / m; if (q < worst) worst = q; } continue; }
            if (d2 >= min * min) continue;
            var dd = Math.sqrt(d2), ux, uy, uz;
            if (dd < 1e-6) { ux = 0; uy = 0; uz = 1; dd = 1e-6; } else { ux = dx / dd; uy = dy / dd; uz = dz / dd; }
            // a crossing separates mostly in depth; side-by-side yarns spread in the plane
            var corr = (min - dd) / 2;
            X[a] += ux * corr; Y[a] += uy * corr * 0.6; Z[a] += uz * corr;
            X[b] -= ux * corr; Y[b] -= uy * corr * 0.6; Z[b] -= uz * corr;
          }
        }
      }
      if (measure) return;
      if (smooth) {
        tx.set(X); ty.set(Y); tz.set(Z);
        for (var k = 0; k < N; k++) {
          if (FIRST[k] || LAST[k]) continue;
          X[k] += smooth * ((tx[k - 1] + tx[k + 1]) / 2 - tx[k]); Y[k] += smooth * ((ty[k - 1] + ty[k + 1]) / 2 - ty[k]); Z[k] += smooth * ((tz[k - 1] + tz[k + 1]) / 2 - tz[k]);
        }
      }
      if (anchor) for (var k2 = 0; k2 < N; k2++) { X[k2] += anchor * (AX[k2] - X[k2]); Y[k2] += anchor * (AY[k2] - Y[k2]); }
    };
    var iters = opt.iterations || 48;
    for (var it = 0; it < iters; it++) pass(0.06, 0.18);
    for (var it2 = 0; it2 < 14; it2++) pass(0, 0.04);
    for (var it3 = 0; it3 < 6; it3++) pass(0, 0);
    pass(0, 0, true);
    o = 0;
    all.forEach(function (co) { co.points.forEach(function (p) { p.x = X[o]; p.y = Y[o]; p.z = Z[o]; o++; }); });
    geo.clearance = worst === Infinity ? null : Math.round(worst * 1000) / 1000;
    geo.relaxed = true;
    return geo.clearance;
  }

  var api = { buildLoopPaths: buildLoopPaths, relax: relax };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KALoopGeom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
