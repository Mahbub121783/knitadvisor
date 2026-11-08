/**
 * KnitAdvisor — synthetic knitted fabric, for testing the scanner.
 *
 * Draws a knitted surface loop by loop at an exactly known wales/cm and
 * courses/cm (V-shaped face loops, arcs on the jersey back, grooves on rib,
 * tuck cells on piqué), then photographs it the way a phone would: on the scan
 * card, in perspective, rotated a little, with uneven light, blur and sensor
 * noise, optionally with a hole or a needle line. Every image carries its own
 * answer, so the measurement can be scored against it.
 *
 * It is a model of a fabric's look, not a photograph: it tests the counting
 * under bad conditions; real cloth must still be checked against a counting
 * glass.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KAScanSynth = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function rng(seed) { var s = seed >>> 0 || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function hash(i, j, k) { var h = (i * 374761393 + j * 668265263 + (k || 0) * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; h ^= h >>> 16; return (h >>> 0) / 4294967296; }

  function segDist(px, py, ax, ay, bx, by) {
    var vx = bx - ax, vy = by - ay, t = ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var dx = px - ax - t * vx, dy = py - ay - t * vy;
    return { d: Math.sqrt(dx * dx + dy * dy), t: t };
  }
  var yarn = function (d, r) { return d >= r ? 0 : Math.sqrt(1 - (d / r) * (d / r)); };

  /**
   * A fabric as a function of position in millimetres.
   * @param o {structure, side, wpc, cpc, angle (deg), skew (deg), jitter, yarn, faults: [{type, x, y, r} | {type:'needle_line', wale}]}
   */
  function fabric(o) {
    var ws = 10 / o.wpc, cs = 10 / o.cpc;                       // mm per wale, per course
    var ca = Math.cos((o.angle || 0) * Math.PI / 180), sa = Math.sin((o.angle || 0) * Math.PI / 180);
    var tk = Math.tan((o.skew || 0) * Math.PI / 180);
    var jit = o.jitter == null ? 0.04 : o.jitter, yr = (o.yarn || 1) * 0.27 * ws;
    var st = o.structure, side = o.side || 'face';
    var groove = st === 'rib';
    var vLook = side === 'face' || st === 'interlock' || st === 'rib';
    var faults = o.faults || [];
    var tuck = function (i, j) { return st === 'pique' && ((((i % 2) + 2) % 2 === 0 && (((j % 4) + 4) % 4) < 2) || (((i % 2) + 2) % 2 === 1 && (((j % 4) + 4) % 4) >= 2)); };
    return function (x, y) {
      for (var f = 0; f < faults.length; f++) { var F = faults[f]; if (F.type === 'hole' && (x - F.x) * (x - F.x) + (y - F.y) * (y - F.y) < F.r * F.r) return 0.04; }
      var xr = x * ca + y * sa, yrr = -x * sa + y * ca;
      var u = xr / ws, v = (yrr + xr * tk) / cs;
      var i0 = Math.floor(u), j0 = Math.floor(v), best = 0, along = 0;
      for (var di = -1; di <= 1; di++) for (var dj = -1; dj <= 2; dj++) {
        var i = i0 + di, j = j0 + dj;
        var jx = (hash(i, j, 1) - 0.5) * jit, jy = (hash(i, j, 2) - 0.5) * jit;
        var thin = 1;
        for (f = 0; f < faults.length; f++) if (faults[f].type === 'needle_line' && faults[f].wale === i) thin = 0.55;
        var lu = (u - i - jx) * ws, lv = (v - j - jy) * cs, r = yr * thin * (0.92 + 0.16 * hash(i, j, 3));
        if (vLook) {
          var spread = groove ? 0.22 : 0.3, top = -0.42, bot = 0.58;
          if (tuck(i, j)) continue;                               // the held loop leaves a hole here
          var tallTop = tuck(i, j - 1) ? top - 1 : top;            // the loop above was tucked: this one is drawn long
          var L = segDist(lu, lv, (0.5 - spread) * ws, tallTop * cs, 0.48 * ws, bot * cs);
          var Rr = segDist(lu, lv, (0.5 + spread) * ws, tallTop * cs, 0.52 * ws, bot * cs);
          var a = yarn(L.d, r), b = yarn(Rr.d, r);
          if (a > best) { best = a; along = L.t; }
          if (b > best) { best = b; along = Rr.t; }
        } else {
          // jersey back: needle-loop heads (∩) and sinker loops (∪)
          var hr = 0.3 * ws;
          var dh = Math.abs(Math.hypot(lu - 0.5 * ws, (lv - 0.35 * cs) * 1.15) - hr);
          if (lv < 0.42 * cs) { var ah = yarn(dh, r); if (ah > best) { best = ah; along = lu / ws; } }
          var ds = Math.abs(Math.hypot(lu - 0, (lv - 0.72 * cs) * 1.15) - hr);
          if (lv > 0.65 * cs) { var as = yarn(ds, r) * 0.9; if (as > best) { best = as; along = lu / ws; } }
          var leg = Math.min(segDist(lu, lv, 0.22 * ws, 0.35 * cs, 0.22 * ws, 0.75 * cs).d, segDist(lu, lv, 0.78 * ws, 0.35 * cs, 0.78 * ws, 0.75 * cs).d);
          var al = yarn(leg, r * 0.8) * 0.55; if (al > best) best = al;
        }
      }
      var twist = 1 - 0.13 * Math.sin(along * 40 + hash(i0, j0, 4) * 6);
      var base = groove ? 0.05 : 0.12;
      var v = base + (0.86 - base) * best * twist;
      // real cloth: wrinkles and their shadows, and hairiness over the loops
      if (o.wrinkle) v *= 1 + o.wrinkle * (0.6 * Math.sin(x * 0.33 + y * 0.11) + 0.4 * Math.sin(y * 0.47 - x * 0.19 + 1.3));
      if (o.fuzz) {
        // hairiness: noise on a grid turned and stretched off the knit axes, so it has no repeat near a loop's
        var u1 = x * 0.799 + y * 0.602, v1 = -x * 0.602 + y * 0.799;
        var fine = hash(Math.floor(u1 * 9.7), Math.floor(v1 * 6.1), 9), coarse = hash(Math.floor(u1 * 1.37 + 0.31 * v1), Math.floor(v1 * 1.91), 11);
        v += o.fuzz * (fine - 0.5) + o.fuzz * 0.8 * (coarse - 0.5);
      }
      return v;
    };
  }

  /**
   * A phone photo of the fabric under the scan card.
   * @param o fabric options + {width, height, pxPerMm, seed, blur, noise, light, tilt, rotate, colour:[r,g,b]}
   * @returns {{rgba: Uint8ClampedArray, w, h, truth}}
   */
  function photo(o, CARD) {
    var R = rng(o.seed || 7), W = o.width || 1600, H = o.height || 1200, P = o.pxPerMm || 22;
    var cx = W / 2 + (R() - 0.5) * W * 0.08, cy = (o.cardY != null ? o.cardY * H : H / 2) + (R() - 0.5) * H * 0.08;
    var rot = ((o.rotate == null ? (R() - 0.5) * 8 : o.rotate)) * Math.PI / 180, tilt = o.tilt == null ? 0.04 : o.tilt;
    var dst = CARD.markers.map(function (m) {
      var x = (m[0] - 35) * P, y = (m[1] - 35) * P;
      var px = cx + x * Math.cos(rot) - y * Math.sin(rot), py = cy + x * Math.sin(rot) + y * Math.cos(rot);
      return [px + (R() - 0.5) * tilt * 60 * P / 2, py + (R() - 0.5) * tilt * 60 * P / 2];
    });
    var KS = o.KAScan;
    var Hinv = KS.homography(dst, CARD.markers);                // photo px → card mm
    var fab = fabric(o);
    var col = o.colour || [200, 205, 210];
    var g = new Float32Array(W * H), tint = new Uint8Array(W * H);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var q = KS.apply(Hinv, x + 0.5, y + 0.5), mx = q[0], my = q[1], v, t = 0;
      if (mx >= -6 && my >= -6 && mx <= CARD.size + 6 && my <= CARD.size + 6) {
        var inMarker = mx >= 0 && my >= 0 && mx <= CARD.size && my <= CARD.size && (mx < CARD.marker || mx > CARD.size - CARD.marker) && (my < CARD.marker || my > CARD.size - CARD.marker);
        if (inMarker) v = 0.06;
        else if (!o.uncut && mx > CARD.window[0] && mx < CARD.window[1] && my > CARD.window[0] && my < CARD.window[1]) { v = fab(mx, my); t = 1; }
        else v = 0.9 + (R() - 0.5) * 0.02;
      } else if (o.uncut) { v = fab(mx, my); t = 1; }                 // the card lies on the fabric, window not cut
      else v = 0.42 + 0.05 * Math.sin(x * 0.01) * Math.cos(y * 0.013);
      g[y * W + x] = v; tint[y * W + x] = t;
    }
    // optics: blur (repeated box), light falloff, noise
    for (var b = 0; b < (o.blur == null ? 1 : o.blur); b++) g = boxBlur(g, W, H);
    var light = o.light == null ? 0.25 : o.light, lx = R() - 0.5, ly = R() - 0.5, noise = o.noise == null ? 0.02 : o.noise;
    var rgba = new Uint8ClampedArray(W * H * 4);
    for (var k = 0; k < W * H; k++) {
      var px2 = (k % W) / W - 0.5, py2 = ((k / W) | 0) / H - 0.5;
      var L = 1 + light * (px2 * lx + py2 * ly) * 2;
      var n = (R() + R() + R() - 1.5) * noise * 1.4;
      var val = Math.max(0, Math.min(1, g[k] * L + n));
      var c = tint[k] ? col : [255, 255, 255];
      rgba[k * 4] = val * c[0]; rgba[k * 4 + 1] = val * c[1]; rgba[k * 4 + 2] = val * c[2]; rgba[k * 4 + 3] = 255;
    }
    return { rgba: rgba, w: W, h: H, truth: { wpc: o.wpc, cpc: o.cpc, structure: o.structure, side: o.side || 'face', markers: dst } };
  }
  function boxBlur(g, W, H) {
    var o = new Float32Array(W * H);
    for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) {
      var i = y * W + x;
      o[i] = (g[i - W - 1] + g[i - W] + g[i - W + 1] + g[i - 1] + g[i] + g[i + 1] + g[i + W - 1] + g[i + W] + g[i + W + 1]) / 9;
    }
    return o;
  }

  return { fabric: fabric, photo: photo, rng: rng };
});
