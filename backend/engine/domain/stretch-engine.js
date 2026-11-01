// KnitAdvisor — stretch engine: how far a knit goes under load, what comes
// back, what stays, how the grain line bends and when the cloth opens up.
//
// A knit stretches in two very different ways, one after the other:
//
//   1. LOOP STAGE   the loops change shape. Yarn slides through the crossings
//                   and the legs straighten; the yarn itself is hardly
//                   strained. Easy stretch — and most of it comes back, except
//                   what friction at the crossings holds (that is growth).
//   2. YARN STAGE   once the loops are straight in the pull direction they
//                   jam: the cloth can only go further by stretching the yarn
//                   itself. Steep load. The fibre's own recovery now decides
//                   what stays, and past a few per cent a cotton fibre keeps
//                   half of every extension.
//
// So the load–extension curve is a J: soft, then a wall. Where the wall sits
// is geometry — how much yarn a loop holds (loop length l) against how much
// room it already takes (wale / course spacing), less what the crossings eat
// (yarn diameter d). Everything else follows from the same state:
//
//   recovery   friction set (loop stage) + fibre set at the yarn strain
//              (measured fibre recovery at 1, 5 and 10 % strain)
//   contraction the cloth narrows across the pull (the loops borrow yarn)
//   grain      any spirality already in the cloth is rotated by the
//              stretch; a singles yarn untwists under tension and adds to it
//   open area  the loop cell grows faster than the yarn covers it; the yarn
//              also thins under tension — gaps open
//
// Elastane: compacts the relaxed cloth (more reserve before the wall), adds
// its own tension, and pulls the loops back past the crossing friction.
//
// MEASURED here: loop length, count, yarn strength (engine), fibre break
// extension, tenacity, friction and recovery at 1/5/10 % (fibre table).
// MODELLED: the jam constants per structure, the loop-stage curve shape, the
// friction-set fraction, the contraction and the cover → open-area relation.
// Each output says which. No source attribution leaves this file.

'use strict';

const { FIBER_PROPERTIES } = require('./yarn-engine');

// ── Structures ──────────────────────────────────────────────────────────────
// Kc/Kw: relaxed loop-shape constants (courses / wales per mm × l).
// kap/beta: jam geometry in the pull direction — the straightened reserve is
//   K·(kap − beta·d/l) − 1  (a crossing costs a few yarn diameters of length).
// mult: structure factor on that reserve (tucks, inlays, floats hold loops).
// contr: how much the cloth narrows across the pull at the jam.
// yW/yL: load-bearing yarns per course (width pull) / legs per wale (length).
// torque: share of a singles yarn's twist torque the structure lets show.
const KINDS = {
  jersey:    { label: 'Single jersey', Kc: 5.0, Kw: 4.1, w: 1.00, l: 1.00, contrW: 0.30, contrL: 0.42, yW: 1, yL: 2, torque: 1.0, layers: 1 },
  pique:     { label: 'Piqué / tuck', Kc: 5.6, Kw: 4.3, w: 0.72, l: 0.92, contrW: 0.24, contrL: 0.36, yW: 1.15, yL: 2, torque: 0.6, layers: 1, restOpen: 0.03 },
  rib:       { label: 'Rib', Kc: 5.0, Kw: 4.1, w: 1.00, l: 0.95, contrW: 0.22, contrL: 0.55, yW: 1, yL: 2, torque: 0.06, layers: 2 },
  interlock: { label: 'Interlock', Kc: 5.6, Kw: 4.6, w: 0.60, l: 0.88, dl: 0.6, contrW: 0.24, contrL: 0.34, yW: 2, yL: 4, torque: 0.08, layers: 2 },
  purl:      { label: 'Purl', Kc: 3.6, Kw: 4.1, w: 1.00, l: 2.10, contrW: 0.30, contrL: 0.35, yW: 1, yL: 2, torque: 0.1, layers: 1 },
  fleece:    { label: 'Fleece', Kc: 5.0, Kw: 4.1, w: 0.45, l: 0.72, contrW: 0.20, contrL: 0.30, yW: 1.6, yL: 2, torque: 0.45, layers: 1, back: 0.92, bulk: 1.4 },
  terry:     { label: 'Loopback terry', Kc: 5.0, Kw: 4.1, w: 0.50, l: 0.75, contrW: 0.22, contrL: 0.32, yW: 1.5, yL: 2, torque: 0.55, layers: 1, back: 0.8, bulk: 1.35 },
  plush:     { label: 'Plush terry / velour', Kc: 5.0, Kw: 4.1, w: 0.45, l: 0.70, contrW: 0.20, contrL: 0.30, yW: 1.3, yL: 2, torque: 0.4, layers: 1, back: 0.95, bulk: 1.3 },
  mesh:      { label: 'Pointelle / mesh', Kc: 5.0, Kw: 4.1, w: 1.08, l: 1.04, contrW: 0.30, contrL: 0.42, yW: 0.9, yL: 2, torque: 0.8, layers: 1, restOpen: 0.10 },
  warp:      { label: 'Warp knit', Kc: 5.0, Kw: 4.1, w: 0.62, l: 0.55, contrW: 0.18, contrL: 0.26, yW: 2, yL: 2, torque: 0, layers: 1 },
};
const JAM = { w: { kap: 0.85, beta: 6.0 }, l: { kap: 0.46, beta: 3.0 } };
const EL_SHARE = 0.35;

function kindOf(fabricId = '', category = '') {
  const id = String(fabricId).toLowerCase();
  const cat = String(category).toLowerCase();
  if (cat === 'warp_knit' || /tricot|locknit|sharkskin|powernet|spacer|raschel/.test(id)) return 'warp';
  if (id === 'french_terry') return 'terry';
  if (id === 'terry_fabric' || id === 'velour_plush') return 'plush';
  if (/fleece/.test(id)) return 'fleece';
  if (/purl/.test(id) || cat === 'purl') return 'purl';
  if (/pointelle|mesh|eyelet/.test(id)) return 'mesh';
  if (cat === 'rib' || /(^|_)rib(_|$)|cardigan|milano|drop_needle/.test(id)) {
    if (/milano/.test(id)) return 'interlock';
    return 'rib';
  }
  if (cat === 'interlock') return 'interlock';
  if (/pique|lacoste|tuck|waffle|honeycomb|birds_eye|blister|knop|popcorn|crepe|twill/.test(id)) return 'pique';
  return 'jersey';
}

// Share of purl (back-bed) wales in a rib repeat: rib_2x1 → 1/3. A cardigan
// or unknown rib is taken as 1x1.
function purlShare(id) {
  const m = String(id).match(/rib_(\d)x(\d)/);
  if (!m) return 0.5;
  const a = +m[1], b = +m[2];
  return b / (a + b);
}

// ── Fibre data ──────────────────────────────────────────────────────────────
const ELASTOMERS = ['elastane', 'spandex', 'lycra'];
// Fibres the recovery table never measured: stand in for the nearest that
// was, and say so.
const RECOVERY_PROXY = { modal: 'viscose', tencel: 'viscose', lyocell: 'viscose', linen: 'cotton', hemp: 'cotton', polypropylene: 'polyester', bamboo: 'viscose', acetate: 'viscose', jute: 'cotton' };

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mid = (v) => (Array.isArray(v) ? (v[0] + v[1]) / 2 : v);

function fibreModel(fibers) {
  const parts = [];
  let elastane = 0;
  for (const [name, pct] of Object.entries(fibers || {})) {
    if (!pct) continue;
    if (ELASTOMERS.includes(name)) { elastane += pct; continue; }
    parts.push({ name, pct });
  }
  if (!parts.length) parts.push({ name: 'cotton', pct: 100 });
  const W = parts.reduce((a, x) => a + x.pct, 0);
  const proxies = [];

  // recovery curve, blend-weighted: (strain %, recovery %) points
  const recOf = (name) => {
    let p = FIBER_PROPERTIES[name];
    let rec = p && p.recovery && p.recovery.rh60;
    if (!rec || rec.e1 == null) {
      const px = RECOVERY_PROXY[name] || 'cotton';
      proxies.push({ fibre: name, uses: px });
      rec = FIBER_PROPERTIES[px].recovery.rh60;
    }
    const e10 = rec.e10 != null ? rec.e10 : Math.max(rec.e5 * 0.72, rec.e5 - (rec.e1 - rec.e5) * 0.45);
    return { e1: rec.e1, e5: rec.e5, e10 };
  };
  const rec = { e1: 0, e5: 0, e10: 0 };
  for (const x of parts) {
    const r = recOf(x.name);
    rec.e1 += r.e1 * x.pct / W; rec.e5 += r.e5 * x.pct / W; rec.e10 += r.e10 * x.pct / W;
  }

  // break extension, tenacity, friction
  let ext = 0, extW = 0, extMin = Infinity, ten = 0, tenW = 0, mu = 0, muW = 0;
  for (const x of parts) {
    const p = FIBER_PROPERTIES[x.name] || {};
    const t = p.tensile || (FIBER_PROPERTIES[RECOVERY_PROXY[x.name]] || {}).tensile;
    if (t) {
      ext += t.extension * x.pct; extW += x.pct; extMin = Math.min(extMin, t.extension);
      ten += t.tenacity * x.pct; tenW += x.pct;
    }
    const f = p.friction;
    const m = f ? (f.crossed != null ? mid(f.crossed) : f.parallel != null ? f.parallel * 0.75 : null) : null;
    if (m != null) { mu += m * x.pct; muW += x.pct; }
  }
  const extMean = extW ? ext / extW : 7.1;
  return {
    rec, proxies,
    // a spun yarn breaks before its fibres' mean; a blend no later than
    // shortly after its least extensible fibre gives way
    yarnBreak: clamp(Math.min(extMean * 0.8, (isFinite(extMin) ? extMin : extMean) * 1.25) / 100, 0.03, 0.4),
    tenacity: tenW ? ten / tenW : 0.3,                       // N/tex
    mu: muW ? mu / muW : 0.4,
    elastane,
    synthetic: parts.filter((x) => ['polyester', 'nylon', 'polypropylene', 'acrylic'].includes(x.name)).reduce((a, x) => a + x.pct, 0) / W,
    cellulose: parts.filter((x) => ['cotton', 'viscose', 'modal', 'tencel', 'lyocell', 'bamboo', 'linen', 'hemp'].includes(x.name)).reduce((a, x) => a + x.pct, 0) / W,
    wool: parts.filter((x) => x.name === 'wool').reduce((a, x) => a + x.pct, 0) / W,
  };
}

// Recovery (%) of the blend's fibre after a strain s (fraction), by straight
// lines through the measured points; full recovery at zero strain.
function fibreRecovery(rec, s) {
  const pct = s * 100;
  if (pct <= 0) return 100;
  if (pct <= 1) return 100 + (rec.e1 - 100) * pct;
  if (pct <= 5) return rec.e1 + (rec.e5 - rec.e1) * (pct - 1) / 4;
  if (pct <= 10) return rec.e5 + (rec.e10 - rec.e5) * (pct - 5) / 5;
  return Math.max(rec.e10 * 0.7, rec.e10 - (rec.e5 - rec.e10) * (pct - 10) / 5 * 0.5);
}

// Loop-stage curve: 0 at rest, 1 at the jam, J-shaped (soft then rising).
const KJ = 4.5;
const FJ = Math.exp(KJ) - 1 - KJ;
const loopCurve = (x) => 0.06 * x + 0.94 * (Math.exp(KJ * x) - 1 - KJ * x) / FJ;

/**
 * @param {object} p
 *   fabricId, category, gsm, loopMm, countNe, tex, yarnDiaMm, fibers{},
 *   elastanePct, lycraDenier, feedType, rkm (cN/tex), spiralityPct
 */
function analyzeStretch(p = {}) {
  const kind = kindOf(p.fabricId, p.category);
  const K = KINDS[kind];
  const l = Number(p.loopMm) > 0.5 ? Number(p.loopMm) : 2.8;
  const ne = Number(p.countNe) > 0 ? Number(p.countNe) : 30;
  const tex = Number(p.tex) > 0 ? Number(p.tex) : 590.5 / ne;
  const d = Number(p.yarnDiaMm) > 0 ? Number(p.yarnDiaMm) : 25.4 / (28 * Math.sqrt(ne));
  const fm = fibreModel(p.fibers);
  const el = Number.isFinite(p.elastanePct) && p.elastanePct > 0 ? p.elastanePct : fm.elastane;

  // ── relaxed cloth ────────────────────────────────────────────────────────
  // Elastane pulls the relaxed cloth tighter both ways: 5 % compacts it by
  // about an eighth each way (≈ +30 % finished GSM against the same cotton
  // jersey without it, a published like-for-like comparison).
  const cEl = el > 0 ? Math.min(0.30, 0.026 * el) : 0;
  const q0 = (l / K.Kw) * (1 - cEl);              // wale spacing, mm
  const p0 = (l / K.Kc) * (1 - cEl);              // course spacing, mm
  const wpc = 10 / q0, cpc = 10 / p0;

  // ── the wall: jam strain per direction ───────────────────────────────────
  const dl = (d / l) * (K.dl || 1);
  const reserve = (dir) => {
    const j = JAM[dir], Kd = dir === 'w' ? K.Kw : K.Kc;
    const base = Math.max(0.08, Kd * (j.kap - j.beta * dl) - 1);
    let e = base * (dir === 'w' ? K.w : K.l);
    if (kind === 'rib' && dir === 'w') {
      // the purl wales hide behind the face ones at rest and come out first
      const f = purlShare(p.fabricId);
      e = (1 + base) * (1 + 0.6 * 4 * f * (1 - f)) - 1;
    }
    return Math.max(0.08, (1 + e) / (1 - cEl) - 1);
  };

  // ── yarn ─────────────────────────────────────────────────────────────────
  const rkm = Number(p.rkm) > 0 ? Number(p.rkm) : fm.tenacity * 100 * 0.55;
  const Fyb = rkm * tex / 100;                    // yarn breaking load, N
  const eyb = fm.yarnBreak;                       // yarn breaking strain
  const ETA = 0.6;                                // knit strength efficiency
  const tau = clamp(0.18 * Math.sqrt(fm.mu / 0.4), 0.10, 0.30);

  // ── elastane ─────────────────────────────────────────────────────────────
  let elastane = null;
  if (el > 0) {
    const den = Number(p.lycraDenier) > 0 ? Number(p.lycraDenier) : el <= 3 ? 20 : el <= 8 ? 40 : 70;
    const feed = /half/i.test(p.feedType || '') ? 0.5 : 1;
    const denY = 5314.9 / ne;
    // length of relaxed elastane per needle, from its mass share
    const lEl = l * (denY / den) * (el / (100 - el)) / feed;
    const pre = clamp((l / lEl) * (1 - cEl) - 1, 0.2, 3.0);
    const kEl = 0.0071 * (den / 9);               // N per unit strain, one end
    elastane = { pct: el, denier: den, feed, pre_strain: pre, kEnd: kEl, lEl };
  }

  // grain: spirality already in the cloth (after wash, from the quality model)
  const sp = Number.isFinite(p.spiralityPct) ? Math.max(0, p.spiralityPct) : 0;
  const tan0 = (sp / 100) * (K.torque > 0.3 ? 1 : 0.5);
  // friction set per unit loop strain (quick release)
  const lossAvg = ((100 - fm.rec.e1) + (100 - fm.rec.e5)) / 2;
  const bendF = clamp(Math.pow(lossAvg / 28.5, 0.9), 0.3, 2);   // cotton = 1
  const elRet = el > 0 ? Math.max(0.12, Math.exp(-el / 3)) : 1;
  const phi0 = 0.18 * (fm.mu / 0.4) * bendF * elRet;
  // how much of a held strain the cloth recovers over an hour, by fibre
  const delayed = clamp(0.35 * fm.cellulose + 0.5 * fm.synthetic + 0.55 * fm.wool + 0.35 * (1 - fm.cellulose - fm.synthetic - fm.wool), 0.25, 0.6);
  // yarn set that a wash relaxes out (water lets cellulose fibres recover)
  const washKeep = clamp(0.4 * fm.cellulose + 0.85 * fm.synthetic + 0.2 * fm.wool + 0.6 * (1 - fm.cellulose - fm.synthetic - fm.wool), 0.15, 0.9);
  const creep = 1 + 0.35 * fm.cellulose + 0.2 * (1 - fm.cellulose);

  const dirs = {};
  for (const dir of ['w', 'l']) {
    const ej = reserve(dir);
    const nY = (dir === 'w' ? cpc * K.yW : wpc * K.yL) * 100;       // yarns per metre
    const Tbreak = nY * Fyb * ETA;
    const Tj = tau * Tbreak;
    const nEl = elastane ? (dir === 'w' ? cpc : wpc * 2) * 100 * elastane.feed : 0;
    // The plated elastane follows the loops as they reshape, so only part of
    // the cloth's stretch reaches it (EL_SHARE, modelled); what does is
    // multiplied by the pre-strain it already carries.
    const kEl = elastane ? nEl * elastane.kEnd * (1 + elastane.pre_strain) * EL_SHARE : 0;
    const eBreak = (1 + ej) * (1 + eyb) - 1;
    const contr = dir === 'w' ? K.contrW : K.contrL;

    const state = (e) => {
      const x = Math.min(1, e / ej);
      const y2 = e > ej ? (1 + e) / (1 + ej) - 1 : 0;              // yarn strain past the wall
      const ys = 0.012 * x * x + y2;                                // total yarn strain
      let T = e <= ej ? Tj * loopCurve(x) : Tj + nY * (Fyb / eyb) * ETA * y2;
      T += kEl * e;
      const perp = -contr * Math.pow(x, 0.85);                      // across the pull
      // grain: the existing lean is rotated by the stretch; a singles yarn
      // untwists under tension once the loops jam
      const ex = dir === 'w' ? e : perp, ey = dir === 'w' ? perp : e;
      const torque = K.torque * 0.06 * Math.min(1, y2 / eyb) * (sp > 0 ? 1 : 0.5);
      const tanT = tan0 * (1 + ex) / (1 + ey) + torque;
      // open area: cell grows, yarn thins under tension
      const tFrac = T / (Tbreak + kEl);
      const dEff = d * ((K.bulk || 1.25) - 0.3 * clamp(tFrac, 0, 1));
      const cell = q0 * (1 + ex) * p0 * (1 + ey);
      let cover = (l * dEff * 0.78 * (kind === 'rib' ? 1.35 : 1)) / cell;
      let open = 1 / (1 + Math.pow(cover / 0.6, 4));
      if (K.layers === 2 && kind !== 'rib') open *= open;
      if (K.back) open *= 1 - K.back / Math.pow(1 + Math.max(0, ex), 0.6);
      if (K.restOpen) open = Math.min(1, open + K.restOpen * (1 + 0.6 * Math.max(0, ex) + 0.6 * Math.max(0, ey)));
      return { x, y2, ys, T, perp, tanT, open, tFrac };
    };

    // what stays after release from a strain e
    const growth = (e) => {
      const s = state(e);
      const eI = Math.min(e, ej);
      const fric = eI * phi0 * (0.6 + 0.4 * s.x) * (kind === 'rib' && dir === 'w' ? 0.7 : 1);
      const yarnSet = s.ys * (1 - fibreRecovery(fm.rec, s.ys) / 100);
      const quick = fric + yarnSet;
      const held = fric * 1.35 + yarnSet * creep;                  // held 2 h
      return {
        quick,
        held60: held,
        held1h: fric * 1.35 * (1 - delayed) + yarnSet * creep * 0.8,
        quick1h: fric * (1 - delayed) + yarnSet * 0.8,
        washed: fric * 0.08 + yarnSet * creep * washKeep,
      };
    };

    const stageOf = (s) => {
      if (s.y2 > 0) return s.y2 >= 0.9 * eyb ? 'break' : s.y2 >= 0.4 * eyb ? 'damage' : 'jammed';
      return s.x < 0.5 ? 'loops' : 'tightening';
    };

    const N = 48;
    const curve = [];
    for (let i = 0; i <= N; i++) {
      const e = eBreak * i / N;
      const s = state(e), g = growth(e);
      curve.push({
        e: r1(e * 100), t: r1(s.T), f5: r2(s.T * 0.05), stage: stageOf(s),
        open: r1(s.open * 100), skew: r2(Math.atan(s.tanT) * 180 / Math.PI), perp: r1(s.perp * 100),
        ys: r2(s.ys * 100),
        g: r2(g.quick * 100), g1hq: r2(g.quick1h * 100), g60: r2(g.held60 * 100), g1h: r2(g.held1h * 100), gw: r2(g.washed * 100),
        rec: i ? r1((1 - g.quick / e) * 100) : 100,
      });
    }

    // strain at a load (N/m), by bisection on the monotonic curve
    const strainAt = (T) => {
      let a = 0, b = eBreak;
      if (state(b).T < T) return null;
      for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if (state(m).T < T) a = m; else b = m; }
      return (a + b) / 2;
    };
    const firstWhere = (pred) => {
      for (let i = 1; i <= 400; i++) { const e = eBreak * i / 400; if (pred(state(e), e)) return e; }
      return null;
    };
    const s0 = state(0);
    const gapeAt = firstWhere((s) => s.open - s0.open >= 0.08);
    const skewLimitAt = tan0 > 0 || K.torque > 0.3 ? firstWhere((s) => Math.atan(s.tanT) * 180 / Math.PI > 2.86) : null;

    // ASTM D2594: a 125 mm wide strip sewn into a loop (two plies), pulled to
    // 2.27 kgf (loose-fitting garments) or 4.54 kgf (form-fitting).
    const loopLoad = (kgf) => kgf * 9.81 / (2 * 0.125);
    const std = {};
    for (const [key, kgf] of [['loose', 2.27], ['form', 4.54]]) {
      const e = strainAt(loopLoad(kgf));
      std[key] = { load_kgf: kgf, stretch_pct: e != null ? r1(e * 100) : null };
    }
    // growth test: held stretched 2 h at the stretch the garment load reaches
    const eHold = strainAt(loopLoad(4.54));
    if (eHold != null) {
      const g = growth(eHold);
      std.growth = { held_at_pct: r1(eHold * 100), after_60s_pct: r1(g.held60 * 100), after_1h_pct: r1(g.held1h * 100), after_wash_pct: r1(g.washed * 100) };
    }

    dirs[dir === 'w' ? 'width' : 'length'] = {
      jam_pct: r1(ej * 100),
      break_pct: r1(eBreak * 100),
      gape_onset_pct: gapeAt != null ? r1(gapeAt * 100) : null,
      skew_limit_pct: skewLimitAt != null ? r1(skewLimitAt * 100) : null,
      contraction_at_jam_pct: r1(-contr * 100),
      tension_at_jam_n_per_5cm: r2(Tj * 0.05),
      tension_at_break_n_per_5cm: r2((Tbreak + Tj + kEl * eBreak) * 0.05),
      standard: std,
      curve,
    };
  }

  const rest = { open_pct: dirs.width.curve[0].open, skew_deg: dirs.width.curve[0].skew };

  // ── what to watch ────────────────────────────────────────────────────────
  const risks = [];
  const W = dirs.width, L = dirs.length;
  const body = 0.3;                                      // a knee / elbow pulls ~30 %
  if (!elastane) {
    const gw = W.curve.find((c) => c.e >= body * 100) || W.curve[W.curve.length - 1];
    if (gw.g >= 4) risks.push({ level: gw.g >= 7 ? 'high' : 'medium', key: 'bagging', text: `A ${Math.round(body * 100)} % pull (knee, elbow) leaves about ${gw.g}% growth that does not come back until the next wash — bagging. Elastane (3–5 %) or a synthetic share cuts it.` });
  }
  if (W.gape_onset_pct != null && W.gape_onset_pct < 60) risks.push({ level: W.gape_onset_pct < 35 ? 'high' : 'medium', key: 'gaping', text: `Opens up and shows through from about ${W.gape_onset_pct}% stretch across the width — watch it on fitted garments and in dark or light shades worn over skin.` });
  if (elastane) risks.push({ level: 'medium', key: 'grin_through', text: `Past the jam (${W.jam_pct}% across) the elastane shows between the loops — grin-through, worst in dark shades and with a bright elastane.` });
  if (W.skew_limit_pct != null && W.skew_limit_pct < W.jam_pct) risks.push({ level: 'medium', key: 'grain', text: `Under load the wales lean past the usual 5 % skew limit from about ${W.skew_limit_pct}% stretch — the grain line bends before the cloth jams.` });

  // ── PO specification, ready to fill ──────────────────────────────────────
  const po = {
    standard: el >= 8 ? 'ASTM D4964 — high-power elastic knit (loop on a CRE tester)'
      : kind === 'warp' ? 'ASTM D2594 (or BS EN ISO 20932-1, Method B loop)' : 'ASTM D2594 — knitted, low-power stretch',
    cycles: '4 conditioning cycles, stretch read on the 5th',
    condition: 'Dry as received, and again after 3 home launderings',
    targets: {
      width_stretch_pct_min: W.standard.form.stretch_pct != null ? Math.floor(W.standard.form.stretch_pct * 0.85) : null,
      length_stretch_pct_min: L.standard.form.stretch_pct != null ? Math.floor(L.standard.form.stretch_pct * 0.85) : null,
      width_growth_pct_max: W.standard.growth ? Math.ceil(W.standard.growth.after_1h_pct + 1.5) : null,
      length_growth_pct_max: L.standard.growth ? Math.ceil(L.standard.growth.after_1h_pct + 1.5) : null,
    },
    note: 'Stretch and recovery are two separate figures, each per direction. A stretch % from a woven test (ASTM D3107) is never comparable.',
  };

  return {
    ok: true,
    kind, kind_label: K.label,
    geometry: {
      loop_mm: r2(l), yarn_diameter_mm: r3(d), wale_spacing_mm: r3(q0), course_spacing_mm: r3(p0),
      wpc: r1(wpc), cpc: r1(cpc), elastane_compaction_pct: r1(cEl * 100),
    },
    yarn: { breaking_load_n: r2(Fyb), breaking_strain_pct: r1(eyb * 100), friction: r2(fm.mu) },
    fibre_recovery: {
      points: [{ strain_pct: 0, recovery_pct: 100 }, { strain_pct: 1, recovery_pct: r1(fm.rec.e1) }, { strain_pct: 5, recovery_pct: r1(fm.rec.e5) }, { strain_pct: 10, recovery_pct: r1(fm.rec.e10) }],
      proxies: fm.proxies,
    },
    elastane: elastane ? { pct: el, denier: elastane.denier, feed: elastane.feed, pre_strain_pct: r1(elastane.pre_strain * 100) } : null,
    rest,
    directions: W && L ? { width: W, length: L } : dirs,
    risks,
    po_spec: po,
    basis: {
      measured: ['loop length, yarn count and yarn strength (this calculation)', 'fibre break extension, tenacity and friction', 'fibre recovery after 1, 5 and 10 % strain'],
      modelled: ['where the loops jam (structure constants)', 'the loop-stage curve shape', 'friction set and delayed recovery', 'contraction across the pull', 'open area from cover', 'grain lean under load', elastane ? 'elastane pre-strain and its pull-back' : null].filter(Boolean),
    },
  };
}

module.exports = { analyzeStretch, kindOf, fibreRecovery, _KINDS: KINDS };
