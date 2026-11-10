// KnitAdvisor · Fabric Studio — WARP knit yarn paths, read straight from each
// guide bar's lapping and threading (the same notation the engine reads).
//
// Every threaded guide carries one end. At each course the guide swings in
// front of the needles from gap A to gap B (the OVERLAP): the end wraps the
// needle between them and is drawn into a loop through the loop below it on
// that needle. Behind the needles it shogs to the next course's first gap
// (the UNDERLAP). Gaps are numbered 0, 1, 2 …; needle n stands between gap n
// and gap n + 1. Guide g laps g gaps to the right of the notation.
//
//   loop     legs in front of the old loop's head, feet behind it, head one
//            course up — drawn through the loop below (as in weft knitting)
//   closed   the underlap runs back across the overlap: the end crosses
//            itself at the loop's foot; open: it leaves on the far side
//   underlap a float across the technical back; the front bar's lies
//            outermost (furthest back), each bar behind it a little nearer
//   inlay    a pair with no swing (2-2): no loop, the end lies between the
//            loops and the underlaps of the bars in front of it
//   threading an empty guide (".") carries no end
//
// Units: one needle pitch = 1, course spacing h. +z is the technical face.
// Plain script (no import/export): the page, knit3d and the node tests use it.
(function (root) {
  'use strict';

  function buildWarpGeom(spec) {
    var bars = spec.bars || [];
    var nb = bars.length;
    var N = spec.needles || 16;                  // needles drawn
    var h = spec.h || 0.75;
    var R = 1;
    bars.forEach(function (b) { R = lcm(R, b.pairs.length); });
    var C = spec.courses || Math.max(R, R * Math.ceil(12 / R));
    var paths = [];
    bars.forEach(function (b, bi) {
      var pairs = b.pairs, P = pairs.length;
      var thread = String(b.threading || 'X').toUpperCase().replace(/[^X.]/g, '') || 'X';
      var lo = Infinity, hi = -Infinity;
      pairs.forEach(function (q) { lo = Math.min(lo, q[0], q[1]); hi = Math.max(hi, q[0], q[1]); });
      var zU = -(0.24 + 0.07 * (nb - 1 - bi));    // the front bar's underlaps outermost
      var zLoop = 0.035 * (nb - 1 - bi);          // the front bar's loops in front
      // every guide whose lapping reaches the drawn needles
      for (var g = -hi - 1; g <= N - lo; g++) {
        if (thread[((g % thread.length) + thread.length) % thread.length] !== 'X') continue;
        var pts = [], loops = [];
        var push = function (x, y, z) { pts.push({ x: x, y: y, z: z }); };
        var prevOut = null;
        for (var k = 0; k < C; k++) {
          var q = pairs[k % P], A = q[0] + g, B = q[1] + g, y0 = k * h;
          var next = pairs[(k + 1) % P], A2 = next[0] + g;
          if (A === B) {
            // inlay: no loop — the end lies at the gap, behind the loops
            var xi = A - 0.0, yi = y0 + 0.5 * h, zi = -0.18 - 0.02 * bi;
            if (prevOut) push((prevOut.x + xi) / 2, (prevOut.y + yi) / 2, zi);
            push(xi, yi, zi);
            prevOut = { x: xi, y: yi };
            continue;
          }
          var n = Math.min(A, B), X = n + 0.5;
          var sa = A < B ? -1 : 1, sb = -sa;            // the side the end comes up on, the side it goes down
          var under = A2 - B, over = B - A;
          var closed = (under !== 0 && Math.sign(under) === -Math.sign(over)) || (under === 0 && Math.sign(next[1] - next[0]) === -Math.sign(over));
          var yt = y0 + h + 0.38 * h, z = zLoop;
          var footIn = { x: X + sa * 0.17, y: y0 - 0.02 * h, z: -0.14 + z };
          // underlap from the last foot to this loop, across the back
          if (prevOut) {
            push(prevOut.x + (footIn.x - prevOut.x) * 0.33, prevOut.y + (footIn.y - prevOut.y) * 0.33, zU);
            push(prevOut.x + (footIn.x - prevOut.x) * 0.67, prevOut.y + (footIn.y - prevOut.y) * 0.67, zU);
          }
          var from = pts.length;
          push(footIn.x, footIn.y, footIn.z);
          push(X + sa * 0.32, y0 + 0.14 * h, 0.12 + z);
          push(X + sa * 0.43, y0 + 0.40 * h, 0.17 + z);
          push(X + sa * 0.39, yt - 0.40 * h, 0.10 + z);
          push(X + sa * 0.28, yt - 0.12 * h, -0.04 + z);
          push(X, yt, -0.12 + z);
          push(X + sb * 0.28, yt - 0.12 * h, -0.04 + z);
          push(X + sb * 0.39, yt - 0.40 * h, 0.10 + z);
          push(X + sb * 0.43, y0 + 0.40 * h, 0.17 + z);
          push(X + sb * 0.32, y0 + 0.14 * h, 0.12 + z);
          // the foot: a closed lap crosses back over the loop's base, an open one leaves on its own side
          var out = closed ? { x: X + sa * 0.12, y: y0 - 0.06 * h, z: -0.16 + z } : { x: X + sb * 0.17, y: y0 - 0.02 * h, z: -0.14 + z };
          push(out.x, out.y, out.z);
          loops.push({ course: k, needle: n, x: X, from: from, to: pts.length - 1, closed: closed, top: yt });
          prevOut = out;
        }
        if (pts.length > 1) paths.push({ bar: bi, guide: g, points: pts, loops: loops });
      }
    });
    return { paths: paths, needles: N, courses: C, h: h, repeat: R };
  }

  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  function lcm(a, b) { return (a / gcd(a, b)) * b; }

  var api = { buildWarpGeom: buildWarpGeom };
  // the global too: knit3d imports this file as a module side effect and reads it from there
  root.KAWarpGeom = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
