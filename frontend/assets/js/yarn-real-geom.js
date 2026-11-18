// KnitAdvisor · Fabric Studio — the yarn, fibre by fibre.
//
// Builds a short length of yarn as the fibres it is made of. Each fibre is a
// polyline in millimetres. The yarn axis is +y and the yarn starts at y = 0.
// Because the geometry is real fibres and not a picture of a yarn, zooming in
// shows more: the yarn and its twist from a distance, the single fibres closer
// in, and up close each fibre's own section and convolutions.
//
// What sets the look, and where each number comes from:
//   law       fibre count in the section = yarn tex / fibre tex
//             yarn diameter from the fibre area and a packing fraction
//             twist per mm = alpha_e × √Ne / 25.4
//             surface twist angle: tan θ = π · d · twist per mm
//   typical   for each spinning system: twist multiplier, packing, fibre
//             migration, how many hairs and how long, loops vs ends,
//             rotor wrapper fibres, vortex sheath, siro strands
//   measured  hairiness and evenness indices are the yarn engine's own
//             (yarn-engine.js SPINNING_SYSTEMS); a test keeps them equal
//
// A plain script: it sets globalThis.KAYarnGeom in the browser and exports
// the same object in node, so the tests check exactly what the page draws.
(function (root) {
  'use strict';

  // ── random numbers (seeded: one yarn always draws the same) ──────────────
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function expo(r, mean) { return -Math.log(1 - r()) * mean; }
  // smooth value noise on [0, n], about one feature per unit
  function noise1(r, n) {
    var k = [];
    for (var i = 0; i < n + 3; i++) k.push(r() * 2 - 1);
    return function (x) {
      x = Math.max(0, Math.min(n + 0.999, x));
      var i = Math.floor(x), f = x - i;
      f = f * f * (3 - 2 * f);
      return k[i] * (1 - f) + k[i + 1] * f;
    };
  }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  // ── fibres (typical values) ──────────────────────────────────────────────
  // tex: one fibre's linear density (cotton micronaire ~4.2 ≈ 0.17 tex)
  // rho: g/cm³; shape: ribbon (cotton: a flattened, convoluted tube), round
  // conv: convolutions per mm (cotton only); len: mean staple length, mm
  // curl: how quickly a free fibre end bends (1/mm)
  var FIBRE = {
    cotton:         { label: 'cotton', tex: 0.17, rho: 1.52, shape: 'ribbon', aspect: 1.9, conv: 6, len: 28, curl: 7, tone: [0.93, 0.89, 0.81], gloss: 0.12 },
    polyester:      { label: 'polyester staple', tex: 0.133, rho: 1.38, shape: 'round', aspect: 1, conv: 0, len: 38, curl: 3, tone: [0.95, 0.95, 0.93], gloss: 0.3 },
    viscose:        { label: 'viscose', tex: 0.133, rho: 1.51, shape: 'serrated', aspect: 1.25, conv: 0, len: 38, curl: 0.8, tone: [0.95, 0.94, 0.91], gloss: 0.38 },
    modal:          { label: 'modal', tex: 0.1, rho: 1.52, shape: 'round', aspect: 1.1, conv: 0, len: 38, curl: 0.8, tone: [0.95, 0.94, 0.92], gloss: 0.32 },
    poly_filament:  { label: 'polyester filament', tex: null, rho: 1.38, shape: 'round', aspect: 1, conv: 0, len: Infinity, curl: 0, tone: [0.96, 0.96, 0.95], gloss: 0.6 },
    nylon_filament: { label: 'nylon filament', tex: null, rho: 1.14, shape: 'round', aspect: 1, conv: 0, len: Infinity, curl: 0, tone: [0.96, 0.96, 0.94], gloss: 0.55 },
  };
  // the Studio's fibre keys → the fibres in the yarn and their shares
  var BLEND = {
    cotton: [['cotton', 1]],
    polyester_spun: [['polyester', 1]],
    viscose: [['viscose', 1]],
    modal: [['modal', 1]],
    cvc: [['cotton', 0.6], ['polyester', 0.4]],
    polyester_filament: [['poly_filament', 1]],
    nylon_filament: [['nylon_filament', 1]],
  };

  // ── spinning systems ─────────────────────────────────────────────────────
  // hair / u_pct: the yarn engine's hairiness and evenness indices (kept equal
  // by a test). Everything else is typical for knitting yarns:
  //   alpha    twist multiplier (Ne system)
  //   phi      packing fraction of fibres in the yarn section
  //   mig      fibre migration amplitude (0 none … 1 core to surface)
  //   hairLen  mean length of a protruding fibre, mm
  //   loops    share of the protruding fibres that are loops (both ends held)
  //   jitter   how far fibres stray from the ideal helix
  var SYSTEM = {
    carded:       { label: 'Carded ring', hair: 1.00, u_pct: 11.5, alpha: 3.6, phi: 0.55, mig: 0.9, hairLen: 0.55, loops: 0.3, jitter: 0.12, ridge: 0.15, ridgeN: 5, lift: 0.95, bind: 0 },
    combed:       { label: 'Combed ring', hair: 0.80, u_pct: 9.8, alpha: 3.4, phi: 0.58, mig: 0.8, hairLen: 0.45, loops: 0.3, jitter: 0.07, ridge: 0.13, ridgeN: 5, lift: 0.7, bind: 0.6 },
    compact:      { label: 'Compact', hair: 0.55, u_pct: 9.0, alpha: 3.3, phi: 0.63, mig: 0.45, hairLen: 0.3, loops: 0.15, jitter: 0.04, ridge: 0.08, ridgeN: 5, lift: 0.25, bind: 4 },
    siro:         { label: 'Siro', hair: 0.58, u_pct: 9.3, alpha: 3.3, phi: 0.6, mig: 0.6, hairLen: 0.35, loops: 0.2, jitter: 0.06, strands: 2, ridge: 0.06, ridgeN: 4, lift: 0.45, bind: 2 },
    siro_compact: { label: 'Siro-compact', hair: 0.40, u_pct: 8.8, alpha: 3.2, phi: 0.64, mig: 0.4, hairLen: 0.28, loops: 0.15, jitter: 0.04, strands: 2, ridge: 0.05, ridgeN: 4, lift: 0.22, bind: 4.5 },
    open_end:     { label: 'Open-end (rotor)', hair: 0.70, u_pct: 11.0, alpha: 4.4, phi: 0.5, mig: 1.0, hairLen: 0.3, loops: 0.2, jitter: 0.32, wrappers: 3.2, ridge: 0.1, ridgeN: 7, lift: 0.5, bind: 1.5 },
    vortex:       { label: 'Vortex (air-jet)', hair: 0.30, u_pct: 10.5, alpha: 0, phi: 0.56, mig: 0.2, hairLen: 0.25, loops: 0.1, jitter: 0.05, sheath: 0.3, sheathAlpha: 5.5, ridge: 0.04, ridgeN: 6, lift: 0.25, bind: 4 },
  };
  // filament yarns (typical):
  //   dpf      default denier per filament when none is given
  //   phi      packing of the filaments in the compact bundle
  //   nodes    default intermingling nodes per metre; nodeLen, mm
  //   cc       default crimp contraction, % (DTY)
  var FILA = {
    mono: { label: 'Monofilament', dpf: null, phi: 1, nodes: 0, nodeLen: 0, twist: 0 },
    fdy:  { label: 'Multifilament (FDY)', dpf: 1.0, phi: 0.62, nodes: 15, nodeLen: 2.0, twist: 0 },
    dty:  { label: 'Textured (DTY)', dpf: 1.56, phi: 0.62, nodes: 90, nodeLen: 1.2, cc: 35, twist: 0 },
  };
  // the polymers: density g/cm³ and mean refractive index
  var POLYMER = {
    polyester_filament: { name: 'polyester (PET)', rho: 1.38, ri: 1.57 },
    nylon_filament:     { name: 'nylon 6.6', rho: 1.14, ri: 1.565 },
  };
  // the delustrant (titanium dioxide) sets lustre and how much light passes
  var LUSTRE = {
    bright:    { label: 'bright', tio2: 0, tone: [0.97, 0.97, 0.97] },
    semi_dull: { label: 'semi-dull', tio2: 0.3, tone: [0.95, 0.95, 0.94] },
    full_dull: { label: 'full-dull', tio2: 2.0, tone: [0.94, 0.93, 0.91] },
  };
  // hairiness of a carded ring 30s cotton, Uster H (hair length in mm per mm of yarn)
  var H_REF = 6.0, TEX_REF = 590.5 / 30;

  /** The yarn's physical parameters, from what the Studio's yarn row holds. */
  function params(y) {
    y = y || {};
    var fibreKey = BLEND[y.fibre] ? y.fibre : 'cotton';
    var blend = BLEND[fibreKey];
    var filament = /filament/.test(fibreKey);
    var tex = +y.tex > 0 ? +y.tex : TEX_REF;           // one single end
    var ply = clamp(Math.round(+y.ply || 1), 1, 3);
    var sysKey = filament ? (FILA[y.type] ? y.type : 'fdy') : (SYSTEM[y.type] ? y.type : 'combed');
    var S = filament ? FILA[sysKey] : SYSTEM[sysKey];
    // the fibre mix as one mean fibre (for the section and the diameter)
    var fibres = blend.map(function (b) { return { key: b[0], share: b[1], f: FIBRE[b[0]] }; });
    var nFil = !filament ? null : sysKey === 'mono' ? 1 : clamp(Math.round(+y.filaments > 0 ? +y.filaments : (tex * 9) / S.dpf), 2, 600);
    var fibreTex = filament ? tex / nFil : fibres.reduce(function (t, b) { return t + b.share * b.f.tex; }, 0);
    var rho = filament ? POLYMER[fibreKey].rho : fibres.reduce(function (t, b) { return t + b.share * b.f.rho; }, 0);
    var n = filament ? nFil : Math.round(tex / fibreTex);
    var area = tex / (rho * 1000);                      // fibre area in the section, mm²
    var phi = S.phi;
    var d = 2 * Math.sqrt(area / phi / Math.PI);        // yarn diameter, mm
    var ne = 590.5 / tex;
    var alpha = filament ? 0 : S.alpha;
    var tpm = filament ? S.twist : (alpha * Math.sqrt(ne)) / 25.4;     // turns per mm
    var angle = Math.atan(Math.PI * d * tpm) * 180 / Math.PI;
    var H = filament ? 0 : H_REF * S.hair * Math.pow(tex / TEX_REF, 0.4);
    var hairsPerMm = filament ? 0 : H / S.hairLen;
    return {
      fibreKey: fibreKey, filament: filament, system: sysKey, systemLabel: S.label, tex: tex, ply: ply, ne: ne,
      fibres: fibres, fibreTex: fibreTex, rho: rho, n: n, phi: phi, d: d, alpha: alpha, tpm: tpm, tpi: tpm * 25.4,
      angle: angle, H: H, hairsPerMm: hairsPerMm, S: S,
      fibreD: 2 * Math.sqrt(fibreTex / (rho * 1000) / Math.PI),
    };
  }

  // a fibre type for the n-th fibre of a blend (deterministic shares)
  function pickFibre(P, i) {
    if (P.fibres.length === 1) return P.fibres[0];
    var x = ((i * 0.6180339887) % 1);
    var acc = 0;
    for (var k = 0; k < P.fibres.length; k++) { acc += P.fibres[k].share; if (x < acc) return P.fibres[k]; }
    return P.fibres[P.fibres.length - 1];
  }

  /**
   * Build the yarn.
   * @param y    {fibre, type, tex, ply, filaments}
   * @param opt  {length mm (default: about 4.5 twist turns), maxFibres, step mm}
   * @returns {fibres:[{p:Float32Array, rf, aspect, conv, kind, tone:[r,g,b], u}], meta, length}
   */
  function build(y, opt) {
    opt = opt || {};
    if (y && y.fibre === 'elastane') return buildElastane(y, opt);
    var coreSpec = opt.core || null;                    // a core-spun yarn: an elastane core inside the sheath (buildElastane)
    var P = params(y);
    if (P.filament) return buildFilament(P, y || {}, opt);
    var seed = hash(JSON.stringify([P.fibreKey, P.system, Math.round(P.tex * 100), P.ply, P.n, opt.seed || 0]));
    var r = rng(seed);
    var Rc = coreSpec ? coreSpec.r : 0;                 // core radius, mm
    if (Rc) P.d = 2 * Math.sqrt(Rc * Rc + (P.d / 2) * (P.d / 2));   // the sheath is the annulus round the core
    var plyD = P.ply > 1 ? P.d * (1 + 0.62 * (P.ply - 1)) : P.d;
    var pitch = P.tpm > 0.05 ? 1 / P.tpm : 1.5;
    var L = opt.length || clamp(3.2 * pitch, 18 * plyD, 12);
    if (opt.lengthOnly) return { length: L, diameter: plyD, fibres: [], meta: null };
    var step = opt.step || clamp(Math.min(pitch / 32, P.fibreD * 2.2), 0.012, 0.035);
    var maxF = opt.maxFibres || 700;
    var out = [];

    // strands: one for a single yarn; two for siro; ply ends for a plied yarn
    var strands = [];
    var single = function (tex, k, count) { return { tex: tex, k: k, count: count }; };
    if (P.ply > 1) {
      for (var s = 0; s < P.ply; s++) strands.push(single(P.tex, s, P.ply));
    } else if (P.S.strands === 2) {
      strands.push(single(P.tex / 2, 0, 2), single(P.tex / 2, 1, 2));
    } else strands.push(single(P.tex, 0, 1));

    var R = P.d / 2;
    // where each strand's centre is: its distance from the yarn axis, and how it turns
    var strandR = function (st) {
      if (st.count === 1) return { rc: 0, rs: R };
      var rs = R * Math.sqrt(st.tex / P.tex) * (P.ply > 1 ? 1 : 1.02);
      return { rc: rs * (P.ply === 3 ? 1.05 : 0.8), rs: rs };   // strands press into each other
    };
    // a single is Z-twisted (θ falls as y rises: the surface fibres run like "/");
    // a ply twist runs the other way (S), at about 65% of the single's turns;
    // siro strands turn round each other with the yarn's own Z twist
    var plyTpm = P.ply > 1 ? -0.65 * P.tpm : P.S.strands === 2 ? P.tpm : 0;
    var singleTpm = P.ply > 1 ? P.tpm : P.S.strands === 2 ? 0.35 * P.tpm : P.tpm;

    // the yarn's thick and thin places (diameter CV is about half the mass CV)
    var cvD = (P.filament ? 1.5 : P.S.u_pct) / 100 / 2;
    var thick = noise1(r, Math.ceil(L / 1.6) + 2);

    var nPer = Math.round(P.n * strands[0].tex / P.tex);    // fibres in one strand's section
    var cap = Math.max(20, Math.floor(maxF / strands.length));
    var drawn = Math.min(nPer, cap);
    var thin = drawn < nPer ? Math.sqrt(nPer / drawn) : 1;   // fewer, fatter fibres keep the yarn's size when capped
    var vortex = P.system === 'vortex';
    var rotor = P.system === 'open_end';
    var dty = P.filament && P.system === 'dty';

    strands.forEach(function (st, si) {
      var g = strandR(st);
      var gamma0 = (2 * Math.PI * si) / strands.length;
      for (var i = 0; i < drawn; i++) {
        var fb = pickFibre(P, i + si * 7);
        var fx = fb.f;
        var u0 = (i + 0.5) / drawn;                       // area fraction: even packing from core to surface
        var th0 = i * 2.39996323 + r() * 0.3;             // golden angle
        var migL = (3 + r() * 4) * (singleTpm > 0.05 ? 1 / singleTpm : 1.5);
        var migPh = r() * Math.PI * 2;
        var migA = P.S.mig || 0;
        var jit = noise1(r, Math.ceil(L / 0.8) + 2);
        var jitA = (P.S.jitter || 0.02);
        var rad = noise1(r, Math.ceil(L / 0.5) + 2);
        var sheath = vortex && u0 > 1 - P.S.sheath;
        var tw = vortex ? (sheath ? (P.S.sheathAlpha * Math.sqrt(P.ne)) / 25.4 : 0) : singleTpm;
        var crPer = dty ? 0.25 + r() * 0.5 : 0, crA = dty ? R * (0.12 + r() * 0.2) : 0, crPh = r() * 6.283;
        // surface ridges: the outer fibres lie in strands that follow the twist,
        // so the surface carries helical ridges the light picks out
        var ridgeA = (P.S.ridge || 0) * Math.max(0, (u0 - 0.45) / 0.55);
        var ridgeN = P.S.ridgeN || 6;
        var pts = [], dep = [];
        for (var yy = 0; yy <= L + 1e-9; yy += step) {
          var u = u0;
          if (migA > 0) u = clamp(u0 + migA * 0.5 * Math.sin((2 * Math.PI * yy) / migL + migPh) * (rotor ? 1 + 0.6 * rad(yy / 0.5) : 1), 0.0, 1);
          var scale = 1 + cvD * 2 * thick(yy / 1.6);
          var th = th0 - 2 * Math.PI * tw * yy + jitA * jit(yy / 0.8) * (0.5 + u);
          var ridge = ridgeA ? 1 + ridgeA * Math.cos(ridgeN * (th0 + jitA * jit(yy / 0.8))) : 1;
          var rr = (Rc ? Math.sqrt(Rc * Rc + u * (g.rs * g.rs - Rc * Rc)) : g.rs * Math.sqrt(u)) * scale * ridge * (rotor ? 1 + 0.06 * rad(yy / 0.5) : 1);
          var gam = gamma0 - 2 * Math.PI * plyTpm * yy;
          var cx = g.rc * Math.cos(gam), cz = g.rc * Math.sin(gam);
          var x = cx + rr * Math.cos(th + (strands.length > 1 ? gam : 0));
          var z = cz + rr * Math.sin(th + (strands.length > 1 ? gam : 0));
          if (dty) {
            var a = (2 * Math.PI * yy) / crPer + crPh;
            x += crA * Math.cos(a); z += crA * Math.sin(a * 1.3);
          }
          var dS = clamp((rr - Rc) / ((g.rs - Rc) * scale * (1 + (P.S.ridge || 0))), 0, 1);
          // on a ply or siro yarn the fibres where the strands meet are in shadow too
          dep.push(strands.length > 1 ? 0.5 * dS + 0.5 * clamp(Math.hypot(x, z) / ((g.rc + g.rs) * scale), 0, 1) : dS);
          pts.push(x, yy, z);
        }
        out.push({
          p: new Float32Array(pts), depth: new Float32Array(dep), rf: (fx.tex ? Math.sqrt(fx.tex / (fx.rho * 1000) / Math.PI) : P.fibreD / 2) * thin,
          aspect: fx.aspect, conv: fx.conv, kind: 'body', fibre: fb.key, tone: tone(fx, r), u: u0,
        });
      }
    });

    // protruding fibres: free ends and loops, spread along the yarn (Poisson)
    var surfaceAt = function (yy, th) {
      // the yarn surface point at height yy, angle th (on a strand's outer side for ply and siro)
      var scale = 1 + cvD * 2 * thick(yy / 1.6);
      if (strands.length === 1) return { x: R * scale * Math.cos(th), z: R * scale * Math.sin(th), nx: Math.cos(th), nz: Math.sin(th) };
      var gam = -2 * Math.PI * plyTpm * yy;
      var k = Math.floor(r() * strands.length), g = strandR(strands[k]);
      var ga = gam + (2 * Math.PI * k) / strands.length;
      var cx = g.rc * Math.cos(ga), cz = g.rc * Math.sin(ga);
      var a = ga + (th % 1.2) - 0.6;                    // the outward-facing half of the strand
      return { x: cx + g.rs * scale * Math.cos(a), z: cz + g.rs * scale * Math.sin(a), nx: Math.cos(a), nz: Math.sin(a) };
    };
    var nHair = P.filament ? 0 : Math.round(P.hairsPerMm * L * (0.85 + r() * 0.3));
    var maxH = opt.maxHairs || 260;
    var hairScale = nHair > maxH ? nHair / maxH : 1;     // when capped, the drawn hairs carry the same total length
    nHair = Math.min(nHair, maxH);
    for (var h = 0; h < nHair; h++) {
      var fb2 = pickFibre(P, h * 3 + 1).f;
      var y0 = r() * L, th = r() * Math.PI * 2;
      var sp = surfaceAt(y0, th);
      var isLoop = r() < P.S.loops;
      var len = Math.min(expo(r, P.S.hairLen) * Math.sqrt(hairScale), 7);
      if (len < 0.06) continue;
      var pts2 = isLoop ? loopPath(r, sp, y0, len, P, step) : endPath(r, sp, y0, len, P, fb2, step, singleTpm);
      out.push({ p: new Float32Array(pts2), rf: (fb2.tex ? Math.sqrt(fb2.tex / (fb2.rho * 1000) / Math.PI) : P.fibreD / 2), aspect: fb2.aspect, conv: fb2.conv, kind: isLoop ? 'loop' : 'hair', tone: tone(fb2, r), u: 1 });
    }

    // rotor: wrapper fibres caught round the outside (belly bands)
    if (rotor) {
      var nW = Math.round(P.S.wrappers * L);
      for (var w = 0; w < nW; w++) {
        var fb3 = pickFibre(P, w * 5 + 2).f;
        var yw = r() * L, tw0 = r() * Math.PI * 2, turns = 0.6 + r() * 1.8;
        var wp = (0.15 + r() * 0.35) * P.d * 3;           // mm of yarn per wrap turn
        var dir = r() < 0.75 ? -1 : 1;                    // mostly with the twist
        var pts3 = [], steps = Math.max(24, Math.round(turns * 48));
        for (var q = 0; q <= steps; q++) {
          var f = q / steps;
          var yq = yw + f * turns * wp;
          if (yq > L) break;
          var sc = 1 + cvD * 2 * thick(yq / 1.6);
          var lift = 1.07 + 0.1 * Math.sin(f * Math.PI) + (q === 0 || q === steps ? -0.1 : 0);
          var aa = tw0 + dir * 2 * Math.PI * turns * f;
          pts3.push(R * sc * lift * Math.cos(aa), yq, R * sc * lift * Math.sin(aa));
        }
        if (pts3.length >= 9) out.push({ p: new Float32Array(pts3), rf: Math.sqrt(fb3.tex / (fb3.rho * 1000) / Math.PI), aspect: fb3.aspect, conv: fb3.conv, kind: 'wrap', tone: tone(fb3, r), u: 1 });
      }
    }

    return {
      fibres: out, length: L,
      meta: {
        system: P.system, system_label: P.systemLabel, fibre: P.fibreKey, filament: P.filament,
        tex: round(P.tex, 2), ne: round(P.ne, 1), ply: P.ply,
        diameter_mm: round(plyD, 3), single_diameter_mm: round(P.d, 3),
        fibres_in_section: P.n * P.ply, capped: drawn < nPer, fibres_drawn: drawn * strands.length,
        fibre_diameter_um: round(P.fibreD * 1000, 1),
        alpha_e: P.alpha, tpi: round(P.tpi, 1), tpm: round(P.tpm * 1000), twist_angle_deg: round(P.angle, 1),
        ply_tpm: P.ply > 1 ? round(Math.abs(plyTpm) * 1000) : null,
        hairiness_H: round(P.H, 1), hairs_per_mm: round(P.hairsPerMm, 1), mean_hair_mm: P.filament ? 0 : P.S.hairLen,
        packing: round(P.phi, 2),
      },
    };
  }

  // ── elastane ────────────────────────────────────────────────────────────
  // Elastane is a polyurethane-urea rubber, density 1.21 g/cm³, incompressible, so:
  //   law      relaxed diameter d = 2√(tex / ρπ);  drafted d' = d / √draft (volume kept)
  //            core mass per yarn length = tex / draft (what the engine's mass balance uses too)
  //            a cover yarn wrapped on a drafted core, once relaxed, has draft × as many turns
  //            per length: relaxed turns = covered turns × draft
  //            a helix of radius ρ and pitch p lies at tan α = 2πρ / p to the axis
  //   typical  filaments in a coalesced elastane yarn: about one per 10 denier; cover yarn 20 D / 12 F nylon;
  //            covering turns per metre (as covered): single 900, double 900 inner and 800 outer
  var EL_RHO = 1.21;
  var COVER = { nylon_filament: { name: 'nylon 6.6', rho: 1.14, ri: 1.565 }, polyester_filament: { name: 'polyester (PET)', rho: 1.38, ri: 1.57 } };
  var CONSTRUCTION = {
    bare:     'Bare elastane',
    core:     'Core-spun',
    covered:  'Covered (single)',
    dcovered: 'Covered (double)',
  };
  var rodTone = [0.93, 0.94, 0.95];

  function elasticRod(y0, y1, step, dFinal, nFil) {
    var p = [], dp = [];
    for (var yy = y0; yy <= y1 + 1e-9; yy += step) { p.push(0, yy, 0); dp.push(1); }
    return { p: new Float32Array(p), depth: new Float32Array(dp), rf: dFinal / 2, aspect: 1, conv: 0, shape: nFil > 1 ? 'lobed' : 'round', lobes: nFil, lobeAmp: nFil > 1 ? 0.045 : 0, kind: 'core', tone: rodTone, u: 1 };
  }

  /** Cut the sheath along the plane z = 0 over a window (the half towards the viewer is removed), so the core lies exposed. */
  function cutAway(fibres, y0, y1) {
    var out = [];
    fibres.forEach(function (f) {
      if (f.kind === 'core') { out.push(f); return; }
      var n = f.p.length / 3, run = [], rd = [], hasD = !!f.depth;
      var flush = function () { if (run.length >= 9) out.push(Object.assign({}, f, { p: new Float32Array(run), depth: hasD ? new Float32Array(rd) : undefined })); run = []; rd = []; };
      var inCut = function (i) { var yy = f.p[i * 3 + 1]; return yy >= y0 && yy <= y1 && f.p[i * 3 + 2] > 0; };
      for (var i = 0; i < n; i++) {
        var cutNow = inCut(i);
        if (i > 0) {
          var cutPrev = inCut(i - 1);
          if (cutNow !== cutPrev) {                        // crossing z = 0: end (or start) the run exactly on the plane
            var z0 = f.p[i * 3 - 1], z1 = f.p[i * 3 + 2], t = Math.abs(z0) / (Math.abs(z0) + Math.abs(z1) || 1);
            var cx = f.p[i * 3 - 3] + t * (f.p[i * 3] - f.p[i * 3 - 3]), cy = f.p[i * 3 - 2] + t * (f.p[i * 3 + 1] - f.p[i * 3 - 2]);
            if (cutNow) { run.push(cx, cy, 0); if (hasD) rd.push(f.depth[i - 1]); flush(); }
            else { flush(); run.push(cx, cy, 0); if (hasD) rd.push(f.depth[i]); }
          }
        }
        if (!cutNow) { run.push(f.p[i * 3], f.p[i * 3 + 1], f.p[i * 3 + 2]); if (hasD) rd.push(f.depth[i]); }
      }
      flush();
    });
    return out;
  }

  function buildElastane(y, opt) {
    var type = CONSTRUCTION[y.type] ? y.type : 'bare';
    var den = +y.denier > 0 ? +y.denier : 40;
    var draft = clamp(+y.draft > 0 ? +y.draft : 3, 1.5, 6);
    var relaxed = y.state !== 'drafted';
    var texEl = den / 9;
    var dRel = 2 * Math.sqrt(texEl / (EL_RHO * 1000 * Math.PI));
    var dDraft = dRel / Math.sqrt(draft);
    var nFil = Math.max(1, Math.round(den / 10));
    var meta0 = { fibre: 'elastane', filament: false, elastane: type, system: type, system_label: CONSTRUCTION[type], denier: round(den, 0), dtex: round(texEl * 10, 0), tex_el: round(texEl, 2), density: EL_RHO,
      draft: round(draft, 1), state: relaxed ? 'relaxed' : 'drafted', core_diameter_relaxed_um: round(dRel * 1000, 0), core_diameter_drafted_um: round(dDraft * 1000, 0), coalesced_filaments: nFil,
      refractive_index: 1.5, lustre: 'bright', section: 'round', hairiness_H: 0, hairs_per_mm: 0, mean_hair_mm: 0, tpi: 0, tpm: 0, twist_angle_deg: 0, ply_tpm: null, alpha_e: 0, ply: 1 };

    if (type === 'bare') {
      var d = relaxed ? dRel : dDraft;
      var L = opt.length || clamp(d * 70, 4, 9);
      if (opt.lengthOnly) return { length: L, diameter: d, fibres: [], meta: null };
      var tb = relaxed ? texEl : texEl / draft;
      return { length: L, fibres: [elasticRod(0, L, L / 70, d, nFil)], meta: Object.assign(meta0, { diameter_mm: round(d, 3), fibres_in_section: nFil, fibres_drawn: nFil, capped: false, fibre_diameter_um: round(d * 1000, 1), packing: 1, tex: round(tb, 2), ne: round(590.5 / tb, 1) }) };
    }

    if (type === 'core') {
      var sh = y.sheath || {};
      var fell = !sh.fibre || /filament/.test(sh.fibre);
      var sheath = fell ? { fibre: 'cotton', type: 'combed', tex: +sh.tex > 0 ? +sh.tex : 590.5 / 30 } : { fibre: sh.fibre, type: sh.type, tex: +sh.tex };
      var coreMass = texEl / draft;                      // tex of core per yarn length, as spun
      var total = sheath.tex;
      if (total < coreMass * 3) total = coreMass * 3;    // a core-spun yarn is never mostly elastane
      var sp = build({ fibre: sheath.fibre, type: sheath.type, tex: total - coreMass, ply: 1 },
        { core: { r: dDraft / 2 }, length: opt.length, lengthOnly: opt.lengthOnly, seed: opt.seed, maxFibres: opt.maxFibres, maxHairs: opt.maxHairs });
      if (opt.lengthOnly) return sp;
      var fibres = sp.fibres.concat([elasticRod(0, sp.length, Math.max(0.02, sp.length / 120), dDraft, nFil)]);
      if (opt.cutaway) fibres = cutAway(fibres, sp.length * 0.3, sp.length * 0.64);
      var m = sp.meta;
      var sheathSystem = m.system, sheathLabel = m.system_label;
      return {
        length: sp.length, fibres: fibres,
        meta: Object.assign({}, meta0, m, {
          state: 'drafted', sheath_fibre: sheath.fibre, sheath_label: sheathLabel, sheath_system: sheathSystem, sheath_fell_back: fell,
          core_share_pct: round(coreMass / total * 100, 1), core_mass_tex: round(coreMass, 2),
          tex: round(total, 2), ne: round(590.5 / total, 1), system: 'core', system_label: CONSTRUCTION.core,
        }),
      };
    }

    // covered: the core, and one or two layers of a continuous-filament cover yarn wound round it
    var cv = y.cover || {};
    var ckey = COVER[cv.fibre] ? cv.fibre : 'nylon_filament';
    var cover = COVER[ckey];
    var cDen = +cv.denier > 0 ? +cv.denier : 20, cF = Math.max(1, Math.round(+cv.filaments > 0 ? +cv.filaments : 12));
    var fTex = cDen / 9 / cF, dF = 2 * Math.sqrt(fTex / (cover.rho * 1000 * Math.PI)), rF = dF / 2;
    var dbl = type === 'dcovered';
    var ct1 = +cv.tpm > 0 ? +cv.tpm : 900, ct2 = +cv.tpm2 > 0 ? +cv.tpm2 : 800;
    var k = relaxed ? draft : 1;                         // relaxing the core multiplies the turns per length
    var rc = (relaxed ? dRel : dDraft) / 2;
    var layers = [{ hand: 1, pitch: 1000 / (ct1 * k), rho: rc + rF * 0.9 }];
    var nAcross = function (rho) { return Math.max(1, Math.min(cF, Math.floor((0.5 * 2 * Math.PI * rho) / (dF * 1.02)))); };
    var rows1 = Math.ceil(cF / nAcross(layers[0].rho));
    if (dbl) layers.push({ hand: -1, pitch: 1000 / (ct2 * k), rho: layers[0].rho + (rows1 - 1) * dF * 0.9 + 2 * rF * 0.9 });
    var rows2 = dbl ? Math.ceil(cF / nAcross(layers[1].rho)) : 0;
    var outer = dbl ? layers[1].rho + (rows2 - 1) * dF * 0.9 + rF : layers[0].rho + (rows1 - 1) * dF * 0.9 + rF;
    var D = 2 * outer;
    var Lc = opt.length || clamp(layers[0].pitch * 7, D * 22, 11);
    if (opt.lengthOnly) return { length: Lc, diameter: D, fibres: [], meta: null };
    var rr = rng(hash(JSON.stringify(['cov', den, draft, cDen, cF, ct1, ct2, type, relaxed, opt.seed || 0])));
    var out = [elasticRod(0, Lc, Lc / 90, rc * 2, nFil)];
    var stepC = clamp(Math.min(layers[0].pitch, layers[dbl ? 1 : 0].pitch) / 40, 0.01, 0.05);
    var info = [];
    layers.forEach(function (ly, li) {
      var na = nAcross(ly.rho), rows = Math.ceil(cF / na);
      var alpha = Math.atan((2 * Math.PI * ly.rho) / ly.pitch);
      var cosA = Math.cos(alpha), sinA = Math.sin(alpha);
      var th0 = li * 1.7 + rr() * 6.28;
      for (var i = 0; i < cF; i++) {
        var row = Math.floor(i / na), inRow = row < rows - 1 ? na : cF - na * (rows - 1), col = i % na;
        var s = (col - (inRow - 1) / 2) * dF * 1.02, rho = ly.rho + row * dF * 0.9;
        var slack = 0.0015 * (rr() - 0.5);               // each filament runs a hair off the ideal
        var pts = [], dp = [];
        for (var yy = -0.5; yy <= Lc + 0.5 + 1e-9; yy += stepC) {
          var th = th0 + ly.hand * 2 * Math.PI * yy / ly.pitch + (s * cosA) / ly.rho + slack;
          var y2 = yy - ly.hand * s * sinA;
          if (y2 < 0 || y2 > Lc) continue;
          pts.push(rho * Math.cos(th), y2, rho * Math.sin(th));
          dp.push(clamp(0.8 + 0.2 * (li + row * 0.5) / (dbl ? 1.5 : 1), 0.8, 1));
        }
        if (pts.length >= 9) out.push({ p: new Float32Array(pts), depth: new Float32Array(dp), rf: rF, aspect: 1, conv: 0, shape: 'round', kind: 'cover', tone: LUSTRE.bright.tone, u: 1 });
      }
      info.push({ pitch: ly.pitch, angle: alpha * 180 / Math.PI, width: na * dF * 1.02, coverage: clamp((na * dF * 1.02) / (ly.pitch * cosA), 0, 1), hand: ly.hand, rows: rows });
    });
    var coverTex = cDen / 9 * (dbl ? 2 : 1), tc = texEl + coverTex;
    return {
      length: Lc, fibres: out,
      meta: Object.assign(meta0, {
        diameter_mm: round(D, 3), core_diameter_mm: round(rc * 2, 3), fibres_in_section: nFil, fibres_drawn: nFil, capped: false, fibre_diameter_um: round(dRel * 1000, 1), packing: 1,
        tex: round(tc, 2), ne: round(590.5 / tc, 1),
        cover_fibre: ckey, cover_polymer: cover.name, cover_denier: cDen, cover_filaments: cF, cover_filament_um: round(dF * 1000, 1), cover_refractive_index: cover.ri,
        cover_turns_per_m: ct1, cover_turns2_per_m: dbl ? ct2 : null, relaxed_turns_per_m: round(ct1 * k, 0), relaxed_turns2_per_m: dbl ? round(ct2 * k, 0) : null,
        wrap_pitch_mm: round(info[0].pitch, 3), wrap_angle_deg: round(info[0].angle, 0), band_width_um: round(info[0].width * 1000, 0), band_rows: info[0].rows, coverage_pct: round(info[0].coverage * 100, 0),
        wrap2_pitch_mm: dbl ? round(info[1].pitch, 3) : null, wrap2_angle_deg: dbl ? round(info[1].angle, 0) : null,
      }),
    };
  }

  /**
   * A filament yarn: one solid rod (monofilament), a bundle of straight
   * filaments (FDY), or a bundle of crimped ones (DTY).
   *   law      filament diameter from denier per filament and polymer density;
   *            the compact bundle from the filaments' area and their packing;
   *            DTY coil radius from the crimp contraction: a helix of pitch p and
   *            radius a shortens the filament to p / √(p² + (2πa)²) of its length
   *   typical  false twist per metre ≈ 34 600 / √denier, which sets one coil per
   *            false-twist turn; torque reversals every ~1.6 mm; intermingling
   *            nodes per metre and their length; packing
   */
  function buildFilament(P, y, opt) {
    var poly = POLYMER[P.fibreKey], S = P.S;
    var mono = P.system === 'mono', dty = P.system === 'dty';
    var r = rng(hash(JSON.stringify(['fil', P.fibreKey, P.system, Math.round(P.tex * 100), P.n, y.section, y.crimp, y.interlace, y.lustre, opt.seed || 0])));
    var denier = P.tex * 9, dpf = denier / P.n;
    var section = y.section === 'trilobal' ? 'trilobal' : 'round';
    var lus = LUSTRE[y.lustre] ? y.lustre : 'semi_dull';
    var rf = P.fibreD / 2;
    var R0 = mono ? rf : rf * Math.sqrt(P.n / S.phi);
    var cc = dty ? clamp((+y.crimp > 0 ? +y.crimp : S.cc) / 100, 0.03, 0.6) : 0;
    var ftTpm = dty ? 34600 / Math.sqrt(denier) : 0;
    var pitch = dty ? 1000 / ftTpm : 0;
    var coilR = dty ? (pitch * Math.sqrt(1 / ((1 - cc) * (1 - cc)) - 1)) / (2 * Math.PI) : 0;
    var Renv = dty ? R0 * 1.1 + coilR : R0 * (mono ? 1 : 1.04);
    var nodesPerM = mono ? 0 : (y.interlace != null && y.interlace !== '' && +y.interlace >= 0 ? +y.interlace : S.nodes);
    var D = 2 * Renv;
    var L = opt.length || (mono ? clamp(D * 26, 1.2, 10) : clamp(D * 24, 2, 12));
    if (dty && !opt.length) L = Math.max(L, pitch * 8);
    if (opt.lengthOnly) return { length: L, diameter: D, fibres: [], meta: null };

    // intermingling nodes: where the filaments are tangled together
    var nodes = [];
    if (nodesPerM > 0) {
      var sp = 1000 / nodesPerM;
      if (sp >= L) nodes.push(L * 0.62);                 // fewer than one per view: show the one that is there
      else for (var yN = sp * (0.3 + r() * 0.4); yN < L; yN += sp * (0.8 + r() * 0.4)) nodes.push(yN);
    }
    var nodeLen = Math.min(S.nodeLen || 1.5, L * 0.3);
    var nodeAt = function (yy) {
      var m = 0;
      for (var i = 0; i < nodes.length; i++) { var q = Math.abs(yy - nodes[i]) / (nodeLen / 2); if (q < 1) m = Math.max(m, 0.5 + 0.5 * Math.cos(Math.PI * q)); }
      return m;
    };
    var tone = LUSTRE[lus].tone;
    var out = [];
    var step = mono ? L / 60 : dty ? clamp(pitch / 14, 0.006, 0.03) : clamp(L / 120, 0.02, 0.08);
    var drawn = mono ? 1 : Math.min(P.n, opt.maxFibres || 400);
    if (mono) {
      var pm = [], dm = [];
      for (var y0 = 0; y0 <= L + 1e-9; y0 += step) { pm.push(0, y0, 0); dm.push(1); }
      out.push({ p: new Float32Array(pm), depth: new Float32Array(dm), rf: rf, aspect: 1, conv: 0, shape: section, kind: 'mono', tone: tone, u: 1 });
    } else {
      var thin = drawn < P.n ? Math.sqrt(P.n / drawn) : 1;
      for (var i = 0; i < drawn; i++) {
        var u0 = (i + 0.5) / drawn, th0 = i * 2.39996323 + r() * 0.4;
        var wob = noise1(r, Math.ceil(L / 1.2) + 2), wob2 = noise1(r, Math.ceil(L / 1.2) + 2);
        var braid = (r() < 0.5 ? -1 : 1) * (1 + r());   // half-turns a filament takes through a node
        var hand = r() < 0.5 ? 1 : -1, ph = r() * 6.283, lastRev = -1, nextRev = expo(r, 1.6), aI = coilR * (0.6 + 0.8 * r());
        var loopAt = dty && r() < 0.2 ? r() * L : -1;    // now and then a coil pulls out into a loop
        var pts = [], dep = [];
        for (var yy = 0; yy <= L + 1e-9; yy += step) {
          var nd = nodeAt(yy);
          var rr0 = R0 * Math.sqrt(u0) * (1 - 0.35 * nd) * (dty ? 1.1 : 1.04);
          var th = th0 + nd * braid * Math.PI + 0.25 * wob(yy / 1.2) * (dty ? 1 : 0.35);
          var x = rr0 * Math.cos(th), z = rr0 * Math.sin(th);
          if (!dty) x += rf * 0.5 * wob2(yy / 1.2);       // FDY filaments are near-parallel, not perfectly
          if (dty) {
            if (yy > nextRev) { hand = -hand; lastRev = yy; nextRev = yy + expo(r, 1.6); aI = coilR * (0.6 + 0.8 * r()); }
            // at a torque reversal the coil closes up and turns the other way
            var near = Math.min(1, Math.min(Math.abs(yy - nextRev), lastRev < 0 ? 9 : yy - lastRev) / 0.15);
            ph += (hand * 2 * Math.PI * step) / pitch;
            var qd = loopAt >= 0 ? Math.abs(yy - loopAt) / (1.5 * pitch) : 9;
            var big = qd < 1 ? 1 + 1.6 * (0.5 + 0.5 * Math.cos(Math.PI * qd)) : 1;   // a smooth pulled-out coil
            var ac = aI * near * (1 - 0.7 * nd) * big;
            x += ac * Math.cos(ph); z += ac * Math.sin(ph);
          }
          pts.push(x, yy, z);
          dep.push(clamp(Math.hypot(x, z) / Renv, 0, 1));
        }
        out.push({ p: new Float32Array(pts), depth: new Float32Array(dep), rf: rf * thin, aspect: 1, conv: 0, shape: section, kind: 'filament', tone: tone, u: u0 });
      }
    }
    return {
      fibres: out, length: L,
      meta: {
        system: P.system, system_label: S.label, fibre: P.fibreKey, filament: true, polymer: poly.name,
        tex: round(P.tex, 2), denier: round(denier, 0), dtex: round(P.tex * 10, 0), ne: round(P.ne, 1), ply: 1,
        filaments: P.n, dpf: round(dpf, 2), fibres_in_section: P.n, fibres_drawn: drawn, capped: drawn < P.n,
        fibre_diameter_um: round(P.fibreD * 1000, 1), section: section, lustre: lus, lustre_label: LUSTRE[lus].label, tio2_pct: LUSTRE[lus].tio2,
        refractive_index: poly.ri, packing: mono ? 1 : S.phi,
        diameter_mm: round(D, 3), compact_diameter_mm: round(2 * R0, 3), bulk_ratio: round(Renv / R0, 2),
        crimp_contraction_pct: dty ? round(cc * 100, 0) : null, coil_radius_um: dty ? round(coilR * 1000, 0) : null,
        coil_pitch_mm: dty ? round(pitch, 3) : null, false_twist_tpm: dty ? round(ftTpm, -1) : null,
        nodes_per_m: nodesPerM, node_spacing_mm: nodesPerM ? round(1000 / nodesPerM, 1) : null,
        alpha_e: 0, tpi: 0, tpm: 0, twist_angle_deg: 0, ply_tpm: null, hairiness_H: 0, hairs_per_mm: 0, mean_hair_mm: 0,
      },
    };
  }

  function round(v, k) { var m = Math.pow(10, k || 0); return Math.round(v * m) / m; }
  function tone(fx, r) { var k = 0.9 + r() * 0.14; return [fx.tone[0] * k, fx.tone[1] * k, fx.tone[2] * k]; }

  // a free fibre end: leaves the surface along its own helix, bends away, curls
  function endPath(r, sp, y0, len, P, fx, step, tw) {
    var pts = [];
    var ds = Math.max(step, 0.015);
    // start a little inside the yarn so the end grows out of the body
    var x = sp.x * 0.86, y = y0, z = sp.z * 0.86;
    // the helix direction at the surface (Z twist), tilted outward
    var tx = -sp.nz, tz = sp.nx;                         // tangent round the yarn
    var hel = Math.atan(Math.PI * P.d * Math.max(tw, 0.1));
    var sgn = r() < 0.65 ? -1 : 1;                       // most ends trail
    var out = (P.S.lift || 0.7) * (0.45 + r() * 0.9);      // how steeply it leaves (system)
    var dx = sgn * (Math.cos(hel) * 0 + tx * Math.sin(hel)) + sp.nx * out;
    var dy = sgn * Math.cos(hel);
    var dz = sgn * tz * Math.sin(hel) + sp.nz * out;
    var nrm = Math.hypot(dx, dy, dz); dx /= nrm; dy /= nrm; dz /= nrm;
    var curl = fx.curl || 1;
    var n = Math.max(6, Math.round(len / ds));
    // the first part runs inside, along the surface
    for (var k = 0; k < 4; k++) { pts.push(x, y, z); x += dx * ds * 0.6 - sp.nx * 0.0; y += dy * ds * 0.6; z += dz * ds * 0.6; }
    for (var i = 0; i < n; i++) {
      pts.push(x, y, z);
      // bend: a random turn of the direction, stronger for a curly fibre
      var k2 = curl * ds;
      dx += gauss(r) * k2; dy += gauss(r) * k2 * 0.7; dz += gauss(r) * k2;
      // keep going outward while still near the yarn
      var rr = Math.hypot(x, z);
      if (rr < P.d * 0.62) { dx += (x / (rr || 1)) * 0.25; dz += (z / (rr || 1)) * 0.25; }
      // a condensed (compact) or wrapped yarn holds its loose fibres down against the surface
      else if (P.S.bind) { var pull = P.S.bind * ds * 6 * Math.min(1, (rr - P.d * 0.5) / P.d); dx -= (x / rr) * pull; dz -= (z / rr) * pull; }
      nrm = Math.hypot(dx, dy, dz); dx /= nrm; dy /= nrm; dz /= nrm;
      x += dx * ds; y += dy * ds; z += dz * ds;
    }
    pts.push(x, y, z);
    return pts;
  }

  // a loop: both ends held in the yarn, the middle lifted off the surface
  function loopPath(r, sp, y0, len, P, step) {
    var pts = [];
    var span = clamp(len * (0.35 + r() * 0.3), 0.08, 2.2);    // along the yarn
    var hgt = clamp(len * (0.18 + r() * 0.25) * (0.35 + (P.S.lift || 0.7)), P.d * 0.12, 1.2);
    var sgn = r() < 0.5 ? -1 : 1;
    var twistA = (r() - 0.5) * 1.2;
    var n = Math.max(10, Math.round(len / Math.max(step, 0.015)));
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var lift = Math.sin(Math.PI * t);
      var a = Math.atan2(sp.z, sp.x) + twistA * t;
      var rad = Math.hypot(sp.x, sp.z) * (0.9 + 0.1 * lift) + hgt * Math.pow(lift, 0.8);
      pts.push(rad * Math.cos(a), y0 + sgn * span * t + 0.05 * Math.sin(t * 9) * hgt, rad * Math.sin(a));
    }
    return pts;
  }

  var api = { params: params, build: build, EL_RHO: EL_RHO, COVER: COVER, CONSTRUCTION: CONSTRUCTION, FIBRE: FIBRE, SYSTEM: SYSTEM, FILA: FILA, POLYMER: POLYMER, LUSTRE: LUSTRE, BLEND: BLEND };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KAYarnGeom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
