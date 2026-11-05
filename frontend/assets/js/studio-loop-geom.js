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
    var zc = !D ? 0 : bed === 'interlock' ? 0.42 : 0.34;
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
    var transferAt = function (b, j, c) {
      for (var k = c + 1; k <= c + 3 * F; k++) { var a = act(b, j, k); if (a === 'K') return -1; if (a === 'E') return k; }
      return -1;
    };
    // the receiving needle clears the transferred loop at its next knit, at
    // or after the transfer feed
    var knitFrom = function (b, j, k) { for (var q = k; q <= k + 3 * F; q++) if (act(b, j, q) === 'K') return q; return k; };
    // sinker-loop plush: the pile yarn of these feeds stands over the high
    // sinker on the technical back, height H wales
    var pileH = spec.pileH || 0;
    var PILE = { full: function () { return true; }, alternate: function (w) { return w % 2 === 0; }, checker: function (w, c) { return (w + c) % 2 === 0; }, diagonal: function (w, c) { return (w + c) % 3 === 0; } };
    var pileOn = PILE[spec.pileArrangement] || PILE.full;

    var courses = [];
    for (var c = 0; c < nC; c++) {
      var feed = c % F;
      var pos = [];
      beds.forEach(function (b, bi) { for (var j = 0; j < nW; j++) pos.push({ b: b, bi: bi, j: j, x: j + b.xoff }); });
      pos.sort(function (p, q) { return p.x - q.x || p.bi - q.bi; });

      var pts = [], side = [], stitches = [];
      var push = function (x, yy, z, s) { pts.push({ x: x, y: yy, z: z }); side.push(s); };
      var prev = null;
      for (var i = 0; i < pos.length; i++) {
        var p = pos[i], b = p.b, s = b.s, z0 = b.z0, X = p.x, y0 = y(c);
        var a = act(b, p.j, c);
        if (prev) {
          // between two needles of one bed the yarn dips into a sinker loop;
          // between the beds it crosses over from one to the other
          var mx = (prev.x + X) / 2;
          if (prev.b === b && prev.a !== '-' && a !== '-') push(mx, y0 - 0.14 * h, z0 - s * 0.16, s);
          else if (prev.b !== b) push(mx, y0 + 0.04 * h, (prev.b.z0 + z0) / 2, 0);
        }
        var rec = { course: c, feed: feed, bed: b.key, needle: (p.j % W) + 1, wale: p.j, x: X, act: a, y0: y0, from: pts.length };
        if (a === 'K') {
          var n = nextKnit(b, p.j, c), t = tucksOn(b, p.j, c);
          var tk = transferAt(b, p.j, c), sh = 0;
          if (tk > -1) { n = knitFrom(b, p.j + 1, tk); sh = 0.5; rec.transferred = tk - c; }
          var yt = y(n) + 0.38 * h;
          // the feet go behind everything on the needle: the old loop and any tucks
          var fz = z0 - s * (0.14 + 0.16 * Math.min(2, t));
          // keyhole: narrow feet (they pass inside the old head), legs
          // widest at mid-height where they meet the next wale, round head
          push(X - 0.15, y0 - 0.02 * h, fz, s);
          push(X - 0.29, y0 + 0.14 * h, z0 + s * 0.12, s);
          push(X - 0.38, y0 + 0.40 * h, z0 + s * 0.17, s);
          if (n > c + 1) push(X - 0.37, yt - 0.64 * h, z0 + s * 0.15, s);
          // a transferred loop leans its head onto the needle that took it
          push(X - 0.33 + sh * 0.6, yt - 0.40 * h, z0 + s * 0.10, s);
          push(X - 0.23 + sh, yt - 0.12 * h, z0 - s * 0.04, s);
          push(X + sh, yt, z0 - s * 0.12, s);
          push(X + 0.23 + sh, yt - 0.12 * h, z0 - s * 0.04, s);
          push(X + 0.33 + sh * 0.6, yt - 0.40 * h, z0 + s * 0.10, s);
          if (n > c + 1) push(X + 0.37, yt - 0.64 * h, z0 + s * 0.15, s);
          push(X + 0.38, y0 + 0.40 * h, z0 + s * 0.17, s);
          push(X + 0.29, y0 + 0.14 * h, z0 + s * 0.12, s);
          push(X + 0.15, y0 - 0.02 * h, fz, s);
          rec.held = n - c - 1; rec.top = yt; rec.tucks = t;
        } else if (a === 'T') {
          var nt = nextKnit(b, p.j, c), ct = y(nt) + 0.30 * h;
          push(X - 0.34, y0 + 0.02 * h, z0 - s * 0.20, s);
          push(X - 0.32, (y0 + ct) / 2, z0 - s * 0.24, s);
          push(X - 0.20, ct - 0.10 * h, z0 - s * 0.26, s);
          push(X, ct, z0 - s * 0.26, s);
          push(X + 0.20, ct - 0.10 * h, z0 - s * 0.26, s);
          push(X + 0.32, (y0 + ct) / 2, z0 - s * 0.24, s);
          push(X + 0.34, y0 + 0.02 * h, z0 - s * 0.20, s);
          rec.held = nt - c - 1; rec.top = ct;
        } else if (a === 'M') {
          push(X - 0.30, y0 + 0.06 * h, z0 - s * 0.27, s);
          push(X + 0.30, y0 + 0.06 * h, z0 - s * 0.27, s);
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
      courses.push(course);
    }
    return { courses: courses, wales: nW, rows: nC, h: h, step: step, bed: bed, F: F, W: W, zc: zc };
  }

  var api = { buildLoopPaths: buildLoopPaths };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KALoopGeom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
