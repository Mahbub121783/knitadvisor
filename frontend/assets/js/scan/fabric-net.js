/**
 * KnitAdvisor — the fabric recogniser, run on the phone in plain JavaScript (no WebAssembly, no runtime library).
 *
 * A small convolutional network (MobileNetV3-small layout, batch-norm folded in) trained on rendered cloth with
 * exact labels — the product's own 3D knit view, a woven renderer — and on openly licensed real photos. It gives
 * four answers for a square crop of cloth: knitted or woven, the knit structure, the weave, and face or back.
 * It is one piece of evidence beside the measured ones; it does not count anything.
 *
 * Load:   FabricNet.load(jsonUrl, binUrl) → Promise<net>        (browser / worker)
 *         FabricNet.fromBuffers(metaObject, Float32Array) → net (Node tests)
 * Run:    net.classify(rgba, w, h, [x0, y0, side]) → {family:{knit:p, woven:p}, knit:{…}, weave:{…}, side:{…}}
 */
(function (root) {
  'use strict';

  function hs(x) { return x * Math.min(Math.max(x + 3, 0), 6) / 6; }
  function hsig(x) { return Math.min(Math.max(x + 3, 0), 6) / 6; }

  // conv over a CHW tensor; groups = cin for depthwise
  function conv(t, op, W) {
    var C = t.c, H = t.h, Wd = t.w, k = op.k, s = op.s, p = op.p, g = op.g, co = op.cout;
    var Ho = Math.floor((H + 2 * p - k) / s) + 1, Wo = Math.floor((Wd + 2 * p - k) / s) + 1, HW = Ho * Wo;
    var out = new Float32Array(co * HW), w = W.subarray(op.w[0], op.w[0] + op.w[1]), b = W.subarray(op.b[0], op.b[0] + op.b[1]), x = t.d;
    var o, ci, i, j, a;
    if (k === 1 && s === 1 && g === 1) {
      // pointwise: out[o] = sum_ci w[o,ci] * x[ci]
      for (o = 0; o < co; o++) {
        var ob = o * HW, wo = o * C;
        for (i = 0; i < HW; i++) out[ob + i] = b[o];
        for (ci = 0; ci < C; ci++) {
          var wv = w[wo + ci]; if (wv === 0) continue;
          var xb = ci * HW;
          for (i = 0; i < HW; i++) out[ob + i] += wv * x[xb + i];
        }
      }
    } else if (g === C && co === C) {
      // depthwise
      for (o = 0; o < co; o++) {
        var wb = o * k * k, xc = o * H * Wd, obd = o * HW;
        for (i = 0; i < Ho; i++) for (j = 0; j < Wo; j++) {
          var sum = b[o], y0 = i * s - p, x0 = j * s - p;
          for (var ky = 0; ky < k; ky++) {
            var yy = y0 + ky; if (yy < 0 || yy >= H) continue;
            var row = xc + yy * Wd, wr = wb + ky * k;
            for (var kx = 0; kx < k; kx++) { var xx = x0 + kx; if (xx < 0 || xx >= Wd) continue; sum += w[wr + kx] * x[row + xx]; }
          }
          out[obd + i * Wo + j] = sum;
        }
      }
    } else if (g === 1) {
      // dense k x k (the stem)
      for (o = 0; o < co; o++) {
        var obs = o * HW;
        for (i = 0; i < Ho; i++) for (j = 0; j < Wo; j++) {
          var acc = b[o], yb = i * s - p, xb2 = j * s - p;
          for (ci = 0; ci < C; ci++) {
            var wc = (o * C + ci) * k * k, xcc = ci * H * Wd;
            for (var ky2 = 0; ky2 < k; ky2++) {
              var y2 = yb + ky2; if (y2 < 0 || y2 >= H) continue;
              for (var kx2 = 0; kx2 < k; kx2++) { var x2 = xb2 + kx2; if (x2 < 0 || x2 >= Wd) continue; acc += w[wc + ky2 * k + kx2] * x[xcc + y2 * Wd + x2]; }
            }
          }
          out[obs + i * Wo + j] = acc;
        }
      }
    } else throw new Error('grouped convolution not supported');
    if (op.act === 'hs') for (a = 0; a < out.length; a++) out[a] = hs(out[a]);
    else if (op.act === 'relu') for (a = 0; a < out.length; a++) if (out[a] < 0) out[a] = 0;
    return { c: co, h: Ho, w: Wo, d: out };
  }
  function se(t, op, W) {
    var C = t.c, HW = t.h * t.w, m = new Float32Array(C), c, i;
    for (c = 0; c < C; c++) { var s = 0, b = c * HW; for (i = 0; i < HW; i++) s += t.d[b + i]; m[c] = s / HW; }
    var w1 = W.subarray(op.w1[0], op.w1[0] + op.w1[1]), b1 = W.subarray(op.b1[0], op.b1[0] + op.b1[1]), w2 = W.subarray(op.w2[0], op.w2[0] + op.w2[1]), b2 = W.subarray(op.b2[0], op.b2[0] + op.b2[1]);
    var h = new Float32Array(op.sq);
    for (var q = 0; q < op.sq; q++) { var a = b1[q]; for (c = 0; c < C; c++) a += w1[q * C + c] * m[c]; h[q] = a > 0 ? a : 0; }
    var out = new Float32Array(t.d.length);
    for (c = 0; c < C; c++) { var z = b2[c]; for (q = 0; q < op.sq; q++) z += w2[c * op.sq + q] * h[q]; var g = hsig(z), bb = c * HW; for (i = 0; i < HW; i++) out[bb + i] = t.d[bb + i] * g; }
    return { c: C, h: t.h, w: t.w, d: out };
  }
  function linear(v, op, W, act) {
    var w = W.subarray(op.w[0], op.w[0] + op.w[1]), b = W.subarray(op.b[0], op.b[0] + op.b[1]), out = new Float32Array(op.cout);
    for (var o = 0; o < op.cout; o++) { var a = b[o], wo = o * op.cin; for (var i = 0; i < op.cin; i++) a += w[wo + i] * v[i]; out[o] = act === 'hs' ? hs(a) : a; }
    return out;
  }
  function softmax(v) { var m = -Infinity, i, s = 0, o = new Float32Array(v.length); for (i = 0; i < v.length; i++) m = Math.max(m, v[i]); for (i = 0; i < v.length; i++) { o[i] = Math.exp(v[i] - m); s += o[i]; } for (i = 0; i < v.length; i++) o[i] /= s; return o; }

  function make(meta, W) {
    function forward(x) {                    // x: Float32Array 3*S*S, normalised, CHW
      var t = { c: 3, h: meta.size, w: meta.size, d: x };
      for (var n = 0; n < meta.ops.length; n++) {
        var op = meta.ops[n];
        if (op.op === 'conv') t = conv(t, op, W);
        else if (op.op === 'ir') {
          var inp = t;
          for (var m = 0; m < op.ops.length; m++) t = op.ops[m].op === 'se' ? se(t, op.ops[m], W) : conv(t, op.ops[m], W);
          if (op.res) { var d = new Float32Array(t.d.length); for (var q = 0; q < d.length; q++) d[q] = t.d[q] + inp.d[q]; t = { c: t.c, h: t.h, w: t.w, d: d }; }
        } else if (op.op === 'gap') {
          var HW = t.h * t.w, v = new Float32Array(t.c);
          for (var c = 0; c < t.c; c++) { var s = 0, b = c * HW; for (var i = 0; i < HW; i++) s += t.d[b + i]; v[c] = s / HW; }
          t = { vec: v };
        } else if (op.op === 'linear') t = { vec: linear(t.vec, op, W, op.act) };
      }
      return meta.heads.map(function (h) { return linear(t.vec, h, W, null); });
    }
    // a square crop of an RGBA photo, area-averaged down to the network's input
    function input(rgba, w, h, crop) {
      var S = meta.size, x0 = crop[0], y0 = crop[1], side = crop[2], f = side / S, out = new Float32Array(3 * S * S);
      for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
        var ya = Math.floor(y0 + y * f), yb = Math.max(ya + 1, Math.floor(y0 + (y + 1) * f)), xa = Math.floor(x0 + x * f), xb = Math.max(xa + 1, Math.floor(x0 + (x + 1) * f));
        var st = Math.max(1, Math.floor((yb - ya) / 3)), r = 0, g = 0, bl = 0, n = 0;
        for (var yy = ya; yy < yb; yy += st) for (var xx = xa; xx < xb; xx += st) {
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          var o = (yy * w + xx) * 4; r += rgba[o]; g += rgba[o + 1]; bl += rgba[o + 2]; n++;
        }
        n = n || 1;
        var k = y * S + x;
        out[k] = (r / n / 255 - meta.mean[0]) / meta.std[0]; out[S * S + k] = (g / n / 255 - meta.mean[1]) / meta.std[1]; out[2 * S * S + k] = (bl / n / 255 - meta.mean[2]) / meta.std[2];
      }
      return out;
    }
    function named(p, names) { var o = {}; names.forEach(function (n, i) { o[n] = Math.round(p[i] * 1000) / 1000; }); return o; }
    return {
      meta: meta,
      forward: forward, input: input,
      /** Average over the given square crops (each [x0, y0, side]); default: the centre square. */
      classify: function (rgba, w, h, crops) {
        if (!crops || !crops.length) { var s0 = Math.min(w, h); crops = [[(w - s0) / 2, (h - s0) / 2, s0]]; }
        var acc = null;
        crops.forEach(function (c) {
          var outs = forward(input(rgba, w, h, c)).map(softmax);
          if (!acc) acc = outs.map(function (o) { return new Float32Array(o.length); });
          outs.forEach(function (o, k) { for (var i = 0; i < o.length; i++) acc[k][i] += o[i] / crops.length; });
        });
        var L = meta.labels;
        return { family: named(acc[0], L.family), knit: named(acc[1], L.knit), weave: named(acc[2], L.weave), side: named(acc[3], L.side), model: meta.name, crops: crops.length };
      },
    };
  }

  // weights travel as IEEE half floats (half the download); widened to float32 once, here
  function halfToFloat(u16) {
    var out = new Float32Array(u16.length);
    for (var i = 0; i < u16.length; i++) {
      var h = u16[i], s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
      out[i] = e === 0 ? s * f * 5.960464477539063e-8 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * Math.pow(2, e - 15);
    }
    return out;
  }
  function weights(meta, buf) { return meta.dtype === 'f16' ? halfToFloat(new Uint16Array(buf)) : new Float32Array(buf); }
  var cache = {};
  function load(jsonUrl, binUrl) {
    if (cache[jsonUrl]) return cache[jsonUrl];
    cache[jsonUrl] = Promise.all([fetch(jsonUrl).then(function (r) { if (!r.ok) throw new Error('model ' + r.status); return r.json(); }),
      fetch(binUrl).then(function (r) { if (!r.ok) throw new Error('weights ' + r.status); return r.arrayBuffer(); })])
      .then(function (a) { return make(a[0], weights(a[0], a[1])); });
    cache[jsonUrl].catch(function () { delete cache[jsonUrl]; });
    return cache[jsonUrl];
  }
  root.FabricNet = { load: load, fromBuffers: make, weights: weights };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FabricNet;
})(typeof self !== 'undefined' ? self : this);
