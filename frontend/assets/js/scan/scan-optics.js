/**
 * KnitAdvisor — the camera's optics: how many photo pixels one millimetre of cloth covers, from the lens itself.
 *
 * A phone lens is a thin lens of focal length f. Focused on cloth at distance u, it images it at
 * v = u·f / (u − f), so one millimetre of cloth becomes  m = f / (u − f)  millimetres on the sensor, and
 *
 *      px per mm  =  f_px / (u − f)          f_px = the focal length counted in pixels of the photo
 *
 * The lens reports where it is focused as a power in dioptres, D = 1 / u (u in metres); the browser passes it on
 * as the focus distance. f_px is the one number a phone does not tell a web page. It comes, best first, from:
 *   1. this phone's own calibration — every photo with a scan card or a bank/NID card in it measures the true
 *      px/mm at a known focus, and the samples fit  px/mm = A·D + B  (linear in dioptres: exact for the thin lens
 *      when f ≪ u, and it also absorbs a focus readout that is offset or scaled, as uncalibrated phones' are);
 *   2. the photo's EXIF: the 35 mm-equivalent focal length gives the field of view (36 mm across the long side);
 *   3. a typical main camera: 66° across the long side, f ≈ 4.4 mm.
 * Without any focus reading the distance itself is assumed (10 cm) and the scale says so.
 */
(function (root) {
  'use strict';
  var FOV_DEG = 66, LENS_F_MM = 4.4, KEEP = 14;

  /** Thin-lens scale. o: {W: long side px, u_mm, f_px?, f35?, fov_deg?, f_mm?} */
  function thinLens(o) {
    var fpx = o.f_px || (o.f35 ? o.W * o.f35 / 36 : o.W / (2 * Math.tan((o.fov_deg || FOV_DEG) * Math.PI / 360)));
    var f = o.f_mm > 0 && o.f_mm < 20 ? o.f_mm : LENS_F_MM;
    return fpx / Math.max(5, o.u_mm - f);
  }

  // ── this phone's calibration (kept on the phone) ─────────────────────
  function key(label) { return 'ka_lens_cal:' + String(label || 'camera').slice(0, 80); }
  function loadCal(label) {
    try { var s = JSON.parse(localStorage.getItem(key(label)) || '[]'); return Array.isArray(s) ? s : []; } catch (_) { return []; }
  }
  /** One measured point: dioptres the lens reported, and the true px/mm a card showed, in a photo W px long. */
  function addSample(label, D, pxmm, W) {
    if (!(D > 1 && D < 60 && pxmm > 0.5 && W > 100)) return null;
    var s = loadCal(label);
    s.push({ D: Math.round(D * 1000) / 1000, k: Math.round(pxmm / (W / 1000) * 10000) / 10000, t: Date.now() });
    while (s.length > KEEP) s.shift();
    try { localStorage.setItem(key(label), JSON.stringify(s)); } catch (_) {}
    return fit(s);
  }
  /** px/mm per 1000 px  =  A·D + B, least squares; one point (or points too close in D): through the origin. */
  function fit(s) {
    if (!s || !s.length) return null;
    var n = s.length, mD = 0, mk = 0;
    s.forEach(function (p) { mD += p.D; mk += p.k; }); mD /= n; mk /= n;
    var Dmin = Math.min.apply(null, s.map(function (p) { return p.D; })), Dmax = Math.max.apply(null, s.map(function (p) { return p.D; }));
    var A, B = 0;
    if (n >= 2 && (Dmax - Dmin) / mD > 0.15) {
      var sxy = 0, sxx = 0; s.forEach(function (p) { sxy += (p.D - mD) * (p.k - mk); sxx += (p.D - mD) * (p.D - mD); });
      A = sxy / sxx; B = mk - A * mD;
      if (!(A > 0)) { A = mk / mD; B = 0; }
    } else A = s.reduce(function (t, p) { return t + p.k / p.D; }, 0) / n;
    var res = s.map(function (p) { return Math.abs((A * p.D + B) / p.k - 1); }).sort(function (a, b) { return a - b; });
    return { A: A, B: B, n: n, spread: res[Math.floor(res.length / 2)] || 0, through_origin: B === 0 };
  }
  function calibrated(label, D, W) {
    var c = fit(loadCal(label));
    if (!c || !(D > 1)) return null;
    return { pxPerMm: (c.A * D + c.B) * W / 1000, n: c.n, spread: c.spread };
  }
  function clearCal(label) { try { localStorage.removeItem(key(label)); } catch (_) {} }

  // ── EXIF: the lens data a photo carries ──────────────────────────────
  /** {focal_mm, f35, subject_m, make, model} from a JPEG's EXIF, or null. */
  function exif(buf) {
    try {
      var d = new DataView(buf), n = d.byteLength;
      if (n < 4 || d.getUint16(0) !== 0xFFD8) return null;
      var p = 2;
      while (p + 4 < n) {
        var mk = d.getUint16(p), len = d.getUint16(p + 2);
        if ((mk & 0xFF00) !== 0xFF00) return null;
        if (mk === 0xFFE1 && d.getUint32(p + 4) === 0x45786966) return tiff(d, p + 10);
        if (mk === 0xFFDA) return null;
        p += 2 + len;
      }
    } catch (_) {}
    return null;
  }
  function tiff(d, t) {
    var le = d.getUint16(t) === 0x4949, u16 = function (o) { return d.getUint16(t + o, le); }, u32 = function (o) { return d.getUint32(t + o, le); };
    var out = {};
    var ascii = function (cnt, off) { var s = ''; for (var i = 0; i < cnt - 1 && i < 64; i++) { var c = d.getUint8(t + off + i); if (!c) break; s += String.fromCharCode(c); } return s; };
    var rational = function (off) { var a = u32(off), b = u32(off + 4); return b ? a / b : null; };
    var ifd = function (off, wanted) {
      var cnt = u16(off);
      for (var i = 0; i < cnt; i++) {
        var e = off + 2 + i * 12, tag = u16(e), type = u16(e + 2), c = u32(e + 4), vo = e + 8;
        if (wanted[tag]) wanted[tag](type, c, vo);
      }
    };
    var exifOff = null;
    ifd(u32(4), {
      0x010F: function (ty, c, vo) { out.make = ascii(c, c > 4 ? u32(vo) : vo); },
      0x0110: function (ty, c, vo) { out.model = ascii(c, c > 4 ? u32(vo) : vo); },
      0x8769: function (ty, c, vo) { exifOff = u32(vo); },
    });
    if (exifOff) ifd(exifOff, {
      0x920A: function (ty, c, vo) { out.focal_mm = rational(u32(vo)); },
      0xA405: function (ty, c, vo) { out.f35 = u16(vo) || null; },
      0x9206: function (ty, c, vo) { var v = rational(u32(vo)); if (v > 0 && v < 1e6) out.subject_m = v; },
    });
    return out;
  }

  root.KAScanOptics = { FOV_DEG: FOV_DEG, LENS_F_MM: LENS_F_MM, thinLens: thinLens, addSample: addSample, fit: fit, loadCal: loadCal, calibrated: calibrated, clearCal: clearCal, exif: exif };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.KAScanOptics;
})(typeof self !== 'undefined' ? self : this);
