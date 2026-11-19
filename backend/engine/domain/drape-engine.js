/**
 * KnitAdvisor — Drape engine: how the cloth hangs, from the numbers a tester reads.
 *
 * The Fabric hand engine gives the cloth's weight, its bending rigidity along and across the wales, its shear rigidity and its stretch under load.
 * This engine hangs that cloth under gravity and measures what a drape tester measures:
 *
 *   CUSICK TEST   a 30 cm round sample laid on an 18 cm disc, the rest hanging over the edge in folds. The drape coefficient DC = (shadow − disc) ÷
 *                 (sample − disc): 0 % hangs limp against the disc, 100 % stands stiff and flat. The number of nodes is the number of folds round the rim.
 *   SKIRT         a circular skirt hung from a waist ring (a garment-scale drape): the hem's fold count, the hem sweep, the length it hangs and
 *                 how far the hem flares out.
 *
 * The cloth is a lattice of particles (position-based dynamics, XPBD) whose stiffnesses ARE the tester numbers:
 *   stretch   a spring between neighbours of stiffness EA = the load ÷ the stretch it gives (the cloth's own load–extension, along each direction)
 *   shear     the two diagonals of every cell, stiffness G (the shear rigidity, converted to N/m)
 *   bending   the second difference of three neighbours, compliance h² ÷ B (the bending rigidity of that direction, converted to N·m)
 *   weight    the areal mass, g/m²
 * so a heavier cloth sags, a stiffer one stands, and a cloth stiffer along the wales than across hangs in lobes lined with the wales. Seeded:
 * the same cloth always hangs the same way.
 *
 * Basis: law = the mechanics (the lattice energy is the tester's); estimate = the hand numbers it is built from (themselves estimates), the lattice
 * resolution (folds finer than about 1.5 cm are not seen) and no self-collision (folds may pass through each other, which lowers the drape
 * coefficient of a very limp cloth a little). A Cusick reading of the mill's own cloth replaces it. No outside source is named.
 */
'use strict';

class DrapeError extends Error { constructor(m) { super(m); this.name = 'DrapeError'; } }

const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const V = (value, unit, basis, extra) => (value == null || !Number.isFinite(value) ? null : { value, unit, basis, ...(extra || {}) });
const G9 = 9.80665;
// tester units to SI
const GF_CM_TO_N_M = 0.0980665;            // gf/cm → N/m
const B_TO_SI = 9.80665e-5;                // gf·cm²/cm → N·m (per metre of width)
const G_TO_SI = 56.2;                      // gf/(cm·deg) → N/(m·rad)
// a drape load is a few thousandths of a newton a node: a cloth stiffer than this in tension is inextensible to it. Capping the stiffness (a few percent of strain
// at the cloth's own weight is none) keeps the solver fast without changing the shape
const EA_CAP = 30;
const CG_MAX = 60, CG_TOL = 1e-5;          // a drape needs the settled shape, not each step to the last digit

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * simulate(p) — p: { gsm, B_course, B_wale (gf·cm²/cm), G (gf/(cm·deg)), EMT_course, EMT_wale (% at load_gf_cm), load_gf_cm, miu,
 *                    test: 'cusick' | 'skirt', res_cm, seed }
 */
function simulate(p) {
  const gsm = +p.gsm, Bc = +p.B_course, Bw = +p.B_wale, G = +p.G;
  if (!(gsm > 0 && Bc > 0 && Bw > 0 && G > 0)) throw new DrapeError('Give the weight, the bending rigidity along and across the wales and the shear rigidity of the cloth.');
  const test = p.test === 'skirt' ? 'skirt' : 'cusick';
  const load = clamp(+p.load_gf_cm > 0 ? +p.load_gf_cm : 200, 20, 500);
  const emtC = clamp(+p.EMT_course > 0 ? +p.EMT_course : 20, 0.5, 200), emtW = clamp(+p.EMT_wale > 0 ? +p.EMT_wale : 12, 0.5, 200);
  const EAc = Math.min(EA_CAP, (load * GF_CM_TO_N_M) / (emtC / 100)), EAw = Math.min(EA_CAP, (load * GF_CM_TO_N_M) / (emtW / 100));      // N/m: load per width ÷ strain
  const Rs = test === 'skirt' ? 0.55 : 0.15;                         // outer radius of the sample, m
  const Rd = test === 'skirt' ? 0.105 : 0.09;                        // the clamped discs (Cusick) or the waist ring (skirt), m
  const h = clamp((+p.res_cm > 0 ? +p.res_cm : test === 'skirt' ? 2.5 : 1.0) / 100, 0.004, 0.03);
  // the lattice: every point of the square grid inside the sample (and outside the waist hole of a skirt)
  const n = Math.floor(Rs / h), idx = new Map(), P = [];
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const x = i * h, y = j * h, r = Math.hypot(x, y);
    if (r > Rs + 1e-9) continue;
    if (test === 'skirt' && r < Rd - 1e-9) continue;
    idx.set(i + ',' + j, P.length); P.push({ x, y, i, j, r });
  }
  const N = P.length, mass = (gsm / 1000) * h * h;                   // kg per particle
  const rnd = mulberry(Math.round(gsm * 100 + Bc * 1e4 + Bw * 1e3 + G * 77));
  const X = new Float64Array(N * 3), Vv = new Float64Array(N * 3), fixed = new Uint8Array(N);
  P.forEach((q, k) => {
    X[3 * k] = q.x; X[3 * k + 1] = q.y; X[3 * k + 2] = 0.0006 * (rnd() - 0.5);
    if (test === 'skirt' && q.r <= Rd + h * 0.7) fixed[k] = 1;       // the waist: held at the ring
    if (test === 'cusick' && q.r <= Rd + h * 0.4) { fixed[k] = 1; X[3 * k + 2] = 0; }   // the sample is clamped flat between the two discs of the tester
  });
  // springs: stretch along the courses (x) and the wales (y) from the load-extension, the two diagonals from the shear rigidity; bending: the second difference
  const sA = [], sB = [], sK = [], bA = [], bB = [], bC = [], bK = [];
  const at = (i, j) => { const k = idx.get(i + ',' + j); return k == null ? -1 : k; };
  const Gs = Math.min(EA_CAP, G * G_TO_SI);
  P.forEach((q, k) => {
    const { i, j } = q;
    let e = at(i + 1, j); if (e >= 0) { sA.push(k); sB.push(e); sK.push(EAc); }
    e = at(i, j + 1); if (e >= 0) { sA.push(k); sB.push(e); sK.push(EAw); }
    e = at(i + 1, j + 1); if (e >= 0) { sA.push(k); sB.push(e); sK.push(Gs); }
    e = at(i + 1, j - 1); if (e >= 0) { sA.push(k); sB.push(e); sK.push(Gs); }
    const x0 = at(i - 1, j), x1 = at(i + 1, j); if (x0 >= 0 && x1 >= 0) { bA.push(x0); bB.push(k); bC.push(x1); bK.push((Bc * B_TO_SI) / (h * h)); }
    const y0 = at(i, j - 1), y1 = at(i, j + 1); if (y0 >= 0 && y1 >= 0) { bA.push(y0); bB.push(k); bC.push(y1); bK.push((Bw * B_TO_SI) / (h * h)); }
  });
  const nS = sA.length, nB = bA.length;
  const restL = new Float64Array(nS); for (let s2 = 0; s2 < nS; s2++) { const a = P[sA[s2]], b = P[sB[s2]]; restL[s2] = h * Math.hypot(a.i - b.i, a.j - b.j); }
  const nn = new Float64Array(nS * 3), f = new Float64Array(N * 3), rhs = new Float64Array(N * 3), sol = new Float64Array(N * 3);
  const rr = new Float64Array(N * 3), pv = new Float64Array(N * 3), Ap = new Float64Array(N * 3), z = new Float64Array(N * 3), diag = new Float64Array(N * 3);
  const dt = +p.dt > 0 ? +p.dt : 1 / 40, c = 4;                      // implicit Euler, a little air and internal damping
  const floorZ = test === 'skirt' ? -0.95 : -0.30;
  const steps = +p.steps > 0 ? Math.round(+p.steps) : test === 'skirt' ? 110 : 90;
  const dd = dt * dt;
  // out = A p, A = M(1 + c dt) + dt^2 K  (a fixed particle's row is the identity)
  const matvec = (pp, out) => {
    out.fill(0);
    for (let s2 = 0; s2 < nS; s2++) {
      const a = sA[s2], b = sB[s2], k = sK[s2], nx = nn[3 * s2], ny = nn[3 * s2 + 1], nz = nn[3 * s2 + 2];
      const dp = k * ((pp[3 * a] - pp[3 * b]) * nx + (pp[3 * a + 1] - pp[3 * b + 1]) * ny + (pp[3 * a + 2] - pp[3 * b + 2]) * nz);
      out[3 * a] += dp * nx; out[3 * a + 1] += dp * ny; out[3 * a + 2] += dp * nz; out[3 * b] -= dp * nx; out[3 * b + 1] -= dp * ny; out[3 * b + 2] -= dp * nz;
    }
    for (let q = 0; q < nB; q++) {
      const a = bA[q], b = bB[q], cc = bC[q], k = bK[q];
      for (let d = 0; d < 3; d++) { const t = k * (pp[3 * a + d] - 2 * pp[3 * b + d] + pp[3 * cc + d]); out[3 * a + d] += t; out[3 * b + d] -= 2 * t; out[3 * cc + d] += t; }
    }
    const mm = mass * (1 + c * dt);
    for (let k = 0; k < N; k++) for (let d = 0; d < 3; d++) { const j2 = 3 * k + d; out[j2] = fixed[k] ? pp[j2] : out[j2] * dd + mm * pp[j2]; }
  };
  let vmax = 0, stepsRun = 0, cgIts = 0;
  for (let st = 0; st < steps; st++) {
    f.fill(0);
    for (let k = 0; k < N; k++) f[3 * k + 2] -= mass * G9;
    for (let s2 = 0; s2 < nS; s2++) {
      const a = sA[s2], b = sB[s2];
      const dx = X[3 * a] - X[3 * b], dy = X[3 * a + 1] - X[3 * b + 1], dz = X[3 * a + 2] - X[3 * b + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-12, fm = -sK[s2] * (d - restL[s2]);
      nn[3 * s2] = dx / d; nn[3 * s2 + 1] = dy / d; nn[3 * s2 + 2] = dz / d;
      f[3 * a] += fm * dx / d; f[3 * a + 1] += fm * dy / d; f[3 * a + 2] += fm * dz / d; f[3 * b] -= fm * dx / d; f[3 * b + 1] -= fm * dy / d; f[3 * b + 2] -= fm * dz / d;
    }
    for (let q = 0; q < nB; q++) {
      const a = bA[q], b = bB[q], cc = bC[q], k = bK[q];
      for (let d = 0; d < 3; d++) { const t = k * (X[3 * a + d] - 2 * X[3 * b + d] + X[3 * cc + d]); f[3 * a + d] -= t; f[3 * b + d] += 2 * t; f[3 * cc + d] -= t; }
    }
    for (let k = 0; k < N; k++) for (let d = 0; d < 3; d++) { const j2 = 3 * k + d; rhs[j2] = fixed[k] ? 0 : mass * Vv[j2] + dt * f[j2]; sol[j2] = fixed[k] ? 0 : Vv[j2]; }
    // Jacobi-preconditioned conjugate gradients on A v = rhs
    diag.fill(0);
    for (let s2 = 0; s2 < nS; s2++) { const a = sA[s2], b = sB[s2], k = sK[s2]; for (let d = 0; d < 3; d++) { const t = k * nn[3 * s2 + d] * nn[3 * s2 + d] * dd; diag[3 * a + d] += t; diag[3 * b + d] += t; } }
    for (let q = 0; q < nB; q++) { const k = bK[q] * dd; for (let d = 0; d < 3; d++) { diag[3 * bA[q] + d] += k; diag[3 * bB[q] + d] += 4 * k; diag[3 * bC[q] + d] += k; } }
    const mm = mass * (1 + c * dt);
    for (let k = 0; k < N; k++) for (let d = 0; d < 3; d++) { const j2 = 3 * k + d; diag[j2] = fixed[k] ? 1 : diag[j2] + mm; }
    matvec(sol, Ap);
    let rz = 0, r0 = 0;
    for (let j2 = 0; j2 < 3 * N; j2++) { rr[j2] = rhs[j2] - Ap[j2]; z[j2] = rr[j2] / diag[j2]; pv[j2] = z[j2]; rz += rr[j2] * z[j2]; r0 += rr[j2] * rr[j2]; }
    for (let it = 0; it < CG_MAX && r0 > 0; it++) {
      matvec(pv, Ap);
      let pAp = 0; for (let j2 = 0; j2 < 3 * N; j2++) pAp += pv[j2] * Ap[j2];
      if (pAp <= 0) break;
      const al = rz / pAp; let rn = 0, rz2 = 0;
      for (let j2 = 0; j2 < 3 * N; j2++) { sol[j2] += al * pv[j2]; rr[j2] -= al * Ap[j2]; z[j2] = rr[j2] / diag[j2]; rz2 += rr[j2] * z[j2]; rn += rr[j2] * rr[j2]; }
      cgIts++;
      if (rn < CG_TOL * r0) break;
      const be = rz2 / rz; rz = rz2;
      for (let j2 = 0; j2 < 3 * N; j2++) pv[j2] = z[j2] + be * pv[j2];
    }
    vmax = 0;
    for (let k = 0; k < N; k++) {
      if (fixed[k]) continue;
      for (let d = 0; d < 3; d++) { Vv[3 * k + d] = sol[3 * k + d]; X[3 * k + d] += dt * Vv[3 * k + d]; }
      // collisions: the cloth hangs down the side of the discs, not through them; the floor
      if (test === 'cusick') {
        const x = X[3 * k], y = X[3 * k + 1], r = Math.hypot(x, y);
        if (r < Rd + 1e-4 && X[3 * k + 2] < 0) {
          const f2 = (Rd + 1e-4) / (r || 1e-9); X[3 * k] = x * f2; X[3 * k + 1] = y * f2;
          const vr = (Vv[3 * k] * x + Vv[3 * k + 1] * y) / (r || 1e-9);
          if (vr < 0) { Vv[3 * k] -= vr * x / (r || 1e-9); Vv[3 * k + 1] -= vr * y / (r || 1e-9); }
        }
      }
      if (X[3 * k + 2] < floorZ) { X[3 * k + 2] = floorZ; if (Vv[3 * k + 2] < 0) Vv[3 * k + 2] = 0; }
      vmax = Math.max(vmax, Math.abs(Vv[3 * k]), Math.abs(Vv[3 * k + 1]), Math.abs(Vv[3 * k + 2]));
    }
    stepsRun = st + 1;
    if (st > 25 && vmax < 1e-3) break;
  }
  return { P, X, N, h, Rs, Rd, test, stepsRun, cgIts, vmax, EAc, EAw, mass, fixed, idx };
}

// the outline of a set of points seen from above: the farthest point in each of 180 directions, an empty direction taking its neighbours', lightly smoothed
function outline(xs, ys, bins) {
  const rmax = new Array(bins).fill(0);
  for (let k = 0; k < xs.length; k++) {
    const r = Math.hypot(xs[k], ys[k]);
    const b = Math.min(bins - 1, Math.floor(((Math.atan2(ys[k], xs[k]) + Math.PI) / (2 * Math.PI)) * bins));
    if (r > rmax[b]) rmax[b] = r;
  }
  for (let pass = 0; pass < 3; pass++) for (let b = 0; b < bins; b++) if (!rmax[b]) rmax[b] = Math.max(rmax[(b + bins - 1) % bins], rmax[(b + 1) % bins]);
  return rmax.map((_, b) => (rmax[(b + bins - 2) % bins] + 2 * rmax[(b + bins - 1) % bins] + 3 * rmax[b] + 2 * rmax[(b + 1) % bins] + rmax[(b + 2) % bins]) / 9);
}
const polarArea = (sm, bins) => 0.5 * sm.reduce((t, r) => t + r * r, 0) * ((2 * Math.PI) / bins);

/** the shadow, the folds: from the settled particles */
function measure(sim) {
  const { P, X, N, Rs, Rd, test } = sim;
  const bins = 180;
  const cxs = [], cys = [];
  for (let k = 0; k < N; k++) { cxs.push(X[3 * k]); cys.push(X[3 * k + 1]); }
  const sm = outline(cxs, cys, bins);
  // the shadow, the whole sample and the clamped disc are all measured the same way, so the lattice's own edge error cancels out of the drape coefficient
  const shadow = polarArea(sm, bins);
  const fxs = [], fys = [], axs = [], ays = [];
  for (let k = 0; k < N; k++) { axs.push(P[k].x); ays.push(P[k].y); if (sim.fixed[k] && test === 'cusick') { fxs.push(P[k].x); fys.push(P[k].y); } }
  const flat = polarArea(outline(axs, ays, bins), bins), disc = test === 'cusick' && fxs.length ? polarArea(outline(fxs, fys, bins), bins) : Math.PI * Rd * Rd;
  const dc = test === 'cusick' ? clamp((shadow - disc) / (flat - disc), 0, 1) : null;
  // nodes: the peaks of the shadow's outline (smoothed over 18 degrees), each standing out of its surroundings by a fifth of the outline's spread
  const wide = sm.map((_, b) => { let t = 0; for (let d = -4; d <= 4; d++) t += sm[(b + d + bins) % bins]; return t / 9; });
  const span = Math.max(...wide) - Math.min(...wide), mean = wide.reduce((t, r) => t + r, 0) / bins;
  let nodes = 0;
  if (span > 0.004) {
    const peaks = [];
    for (let b = 0; b < bins; b++) {
      let top = true;
      for (let d = 1; d <= 5; d++) if (wide[(b + d) % bins] > wide[b] || wide[(b - d + bins) % bins] >= wide[b]) { top = false; break; }
      if (!top) continue;
      // the lowest point between this peak and the next higher one on either side is how far it stands out
      let lo = wide[b];
      for (let d = 1; d < bins / 2; d++) { lo = Math.min(lo, wide[(b + d) % bins]); if (wide[(b + d) % bins] > wide[b]) break; }
      let lo2 = wide[b];
      for (let d = 1; d < bins / 2; d++) { lo2 = Math.min(lo2, wide[(b - d + bins) % bins]); if (wide[(b - d + bins) % bins] > wide[b]) break; }
      if (wide[b] - Math.max(lo, lo2) >= 0.2 * span) peaks.push(b);
    }
    nodes = peaks.length;
  }
  // the lowest point and the hem
  let zmin = 0, hemZ = 0, hemN = 0, rHem = 0;
  for (let k = 0; k < N; k++) {
    zmin = Math.min(zmin, X[3 * k + 2]);
    if (P[k].r > Rs - sim.h * 1.6) { hemZ += X[3 * k + 2]; hemN++; rHem += Math.hypot(X[3 * k], X[3 * k + 1]); }
  }
  return { rmax: sm, shadow, flat, disc, dc, nodes, mean_r: mean, drop: -zmin, hem_drop: hemN ? -hemZ / hemN : 0, hem_radius: hemN ? rHem / hemN : 0 };
}

function analyse(input) {
  const p = input && typeof input === 'object' ? input : {};
  const sim = simulate(p);
  const m = measure(sim);
  const warnings = [];
  const say = (level, text) => warnings.push({ level, text });
  const test = sim.test;
  // the Cusick coefficient is the mean of two lattices (1.0 and 1.5 cm): where the folds fall differs a little with the lattice, and the spread is the honest range
  let dcs = null;
  if (test === 'cusick') {
    const alt = measure(simulate({ ...p, res_cm: +p.res_cm > 0 ? +p.res_cm * 1.5 : 1.5 }));
    dcs = [m.dc * 100, alt.dc * 100];
  }
  const dcPct = dcs ? (dcs[0] + dcs[1]) / 2 : null;
  const word = dcPct == null ? null : dcPct < 30 ? 'very limp: it clings and hangs in deep, close folds' : dcPct < 50 ? 'soft, fluid drape: deep rounded folds' : dcPct < 70 ? 'moderate drape: shaped folds' : dcPct < 85 ? 'crisp: wide shallow folds' : 'stiff: it holds its shape and hardly drapes';
  // the mesh the page draws: the whole lattice, in cm to 2 places
  const mesh = { h_cm: r2(sim.h * 100), x: [], y: [], z: [], i: [], j: [] };
  sim.P.forEach((q, k) => { mesh.x.push(r2(sim.X[3 * k] * 100)); mesh.y.push(r2(sim.X[3 * k + 1] * 100)); mesh.z.push(r2(sim.X[3 * k + 2] * 100)); mesh.i.push(q.i); mesh.j.push(q.j); });
  const out = {
    success: true, test,
    sample: { diameter_cm: r1(sim.Rs * 200), support_cm: r1(sim.Rd * 200), particles: sim.N, lattice_cm: r2(sim.h * 100), steps: sim.stepsRun },
    inputs: { gsm: +p.gsm, bending_course: +p.B_course, bending_wale: +p.B_wale, shear: +p.G, stiffness_course_n_m: r1(Math.min(sim.EAc, 1e6)), stiffness_wale_n_m: r1(Math.min(sim.EAw, 1e6)), bending_length_cm: r2(Math.cbrt((Math.sqrt(+p.B_course * +p.B_wale)) / (+p.gsm / 1e4 / 10))) },
    folds: { nodes: m.nodes, outline_mm: { min: r1(Math.min(...m.rmax) * 1000), max: r1(Math.max(...m.rmax) * 1000) } },
    outline: m.rmax.filter((_, b) => b % 3 === 0).map((r) => r3(r * 100)),
    mesh,
    word, warnings,
    basis: { law: ['the lattice energy is the tester\'s: stretch = load ÷ extension, shear = G, bending = B, weight', 'the drape coefficient and the shadow area'], estimated: ['the hand numbers it is built from', 'the lattice resolution (two lattices, their spread is the range)', 'no self-collision', 'the stretch stiffness is capped at 30 N/m (a drape load is a few thousandths of a newton a node)'], replaced_by: 'a Cusick drape reading of the mill\'s own cloth' },
  };
  if (test === 'cusick') {
    const lo = Math.min(...dcs), hi = Math.max(...dcs);
    out.drape_coefficient = V(r1(dcPct), '%', 'estimate', { range: [r1(lo), r1(hi)] });
    out.shadow = { area_cm2: r1(m.shadow * 1e4), sample_cm2: r1(m.flat * 1e4), disc_cm2: r1(m.disc * 1e4) };
    if (hi - lo > 10) say('note', `The two lattices differ by ${r1(hi - lo)} points: the fold pattern is sensitive; read the drape coefficient as ${r1(lo)}-${r1(hi)} %.`);
    if (dcPct > 85) say('note', 'A drape coefficient above 85 %: the cloth is stiff for its weight; a garment of it will stand away from the body.');
    if (dcPct < 25) say('note', 'Below 25 %: very limp; the cloth clings to the body and shows every line under it.');
  } else {
    out.skirt = { waist_cm: r1(sim.Rd * 200 * Math.PI), length_cm: r1((sim.Rs - sim.Rd) * 100), hem_radius_cm: r1(m.hem_radius * 100), hem_flat_radius_cm: r1(sim.Rs * 100), hem_drop_cm: r1(m.hem_drop * 100), hem_sweep_ratio: r2(m.hem_radius / sim.Rs) };
    out.word = out.skirt.hem_sweep_ratio < 0.3 ? 'a limp skirt: it hangs close to the body in many folds' : out.skirt.hem_sweep_ratio < 0.5 ? 'a skirt with some swing' : 'a stiff, flared skirt that stands away from the body';
  }
  return out;
}

/** the drape inputs from a Fabric hand answer (fabric-hand-engine.js): the tester's own numbers */
function fromHand(hand, test) {
  if (!hand || hand.success === false || !hand.geometry) throw new DrapeError('The hand numbers of this cloth could not be worked out.');
  return { test: test === 'skirt' ? 'skirt' : 'cusick', gsm: hand.geometry.gsm, B_course: hand.bending.course.value, B_wale: hand.bending.wale.value, G: hand.shear.G.value, EMT_course: hand.tensile.width.EMT.value, EMT_wale: hand.tensile.length.EMT.value, load_gf_cm: hand.identity.load_gf_cm, miu: hand.surface.MIU.value };
}

function catalogue() { return { tests: [{ id: 'cusick', label: 'Cusick drape test: 30 cm sample on an 18 cm disc' }, { id: 'skirt', label: 'Circular skirt: 55 cm long from a 66 cm waist' }] }; }

module.exports = { analyse, simulate, measure, fromHand, catalogue, DrapeError };
