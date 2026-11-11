/**
 * Yarn-level mechanics of a periodic knit cell.
 *
 * The cloth is modelled as what it is: yarn. Each yarn is a closed chain of nodes joined by
 * near-inextensible segments of rest length l0, stiff to bending, and kept from passing through
 * itself or its neighbours by a contact distance d (the yarn diameter). The cell is periodic in the
 * course direction (x: the yarn runs on into the next cell — the closing segment carries the shift Lx)
 * and in the wale direction (y: the next repeat's loops are images shifted by Ly). Out of plane (z)
 * the cloth is free.
 *
 * Energy, in units d = 1 and bending stiffness B = 1 (the relaxed GEOMETRY does not depend on B,
 * only on how long the yarn is for its thickness, so a thin and a thick yarn of the same
 * length-to-diameter ratio relax alike):
 *
 *   bending   (B/l0)(1 − t_i·t_{i+1})       at every node  (≈ Bθ²/2l0: a rod, not a rope)
 *   stretch   ½ ks (|e| − l0)²              every segment  (stiff: the yarn does not stretch)
 *   contact   ½ kc (d − r)²   for r < d     non-neighbouring nodes, every periodic image
 *
 * Minimised with FIRE over the node positions AND the cell lengths (Lx, Ly): the relaxed cloth is
 * the state with no external stress. Holding Ly and freeing the rest gives one point of the
 * load–extension curve; the force that holds it is dE/dLy.
 *
 * What the model is DEFINED by is the topology the caller builds (which loops are threaded through
 * which): if it is wrong the loops fall apart under load, which is how a bad topology is caught.
 */
'use strict';

const KS = 2500, KC = 400, MEXCL = 3;

/**
 * @param topo  { yarns: [{ n, x: Float64Array(3n) }], Lx, Ly, d, l0 }
 * @param opt   { fixedLx, fixedLy, maxIter, tol, Fx, Fy, sx, sy }   fixed* hold a cell length; Fx / Fy pull on the cell, sx / sy are
 *              stresses (force per unit length of face) — negative presses it together
 * @returns     { x, Lx, Ly, energy, gLx, gLy, iterations, converged, maxForce, yarns }
 */
function relax(topo, opt = {}) {
  const { yarns, d = 1, l0 } = topo;
  let Lx = opt.fixedLx != null ? opt.fixedLx : topo.Lx, Ly = opt.fixedLy != null ? opt.fixedLy : topo.Ly;
  const n = yarns.reduce((t, y) => t + y.n, 0);
  const x = new Float64Array(3 * n);
  const next = new Int32Array(n), prev = new Int32Array(n), wrapNext = new Int8Array(n), yid = new Int32Array(n), arc = new Int32Array(n), ylen = new Int32Array(n);
  let o = 0;
  yarns.forEach((y, k) => {
    x.set(y.x, 3 * o);
    for (let i = 0; i < y.n; i++) {
      const a = o + i;
      next[a] = o + ((i + 1) % y.n); prev[a] = o + ((i + y.n - 1) % y.n);
      wrapNext[a] = i === y.n - 1 ? 1 : 0;           // the closing segment carries the cell shift in x
      yid[a] = k; arc[a] = i; ylen[a] = y.n;
    }
    o += y.n;
  });
  const tol = opt.tol || 3e-4, maxIter = opt.maxIter || 30000, Fy = opt.Fy || 0, Fx = opt.Fx || 0, sx = opt.sx || 0, sy = opt.sy || 0, deadline = opt.timeMs ? Date.now() + opt.timeMs : Infinity;
  const freeLx = opt.fixedLx == null, freeLy = opt.fixedLy == null;

  // neighbour list: node pairs (i, j, image) within d + skin, rebuilt when anything has moved by skin/2
  const skin = 0.7;
  let pairs = new Int32Array(0), npairs = 0, ref = new Float64Array(3 * n), refL = [Lx, Ly];
  function build() {
    const rc2 = (d + skin) * (d + skin), out = [];
    for (let i = 0; i < n; i++) for (let j = i; j < n; j++) for (let sx = -1; sx <= 1; sx++) for (let sy = -1; sy <= 1; sy++) {
      if (i === j && (sx < 0 || (sx === 0 && sy <= 0))) continue;       // each self-image once
      const dx = x[3 * j] + sx * Lx - x[3 * i], dy = x[3 * j + 1] + sy * Ly - x[3 * i + 1], dz = x[3 * j + 2] - x[3 * i + 2];
      if (dx * dx + dy * dy + dz * dz > rc2) continue;
      if (yid[i] === yid[j] && sy === 0 && Math.abs((arc[j] + sx * ylen[i]) - arc[i]) <= MEXCL) continue;   // arc neighbours do not "touch"
      out.push(i, j, sx, sy);
    }
    pairs = Int32Array.from(out); npairs = out.length / 4; ref.set(x); refL = [Lx, Ly];
  }
  const stale = () => {
    if (Math.abs(Lx - refL[0]) + Math.abs(Ly - refL[1]) > skin / 2) return true;
    let m = 0; for (let k = 0; k < 3 * n; k++) { const dd = x[k] - ref[k]; if (dd * dd > m) m = dd * dd; }
    return m > (skin / 4) * (skin / 4);
  };

  const joints = opt.joints ? Int32Array.from(opt.joints.flatMap((q) => [q[0], q[1], q[2], q[3], 0])) : new Int32Array(0), jr0 = opt.joints ? opt.joints.map((q) => q[4]) : [];
  const l0s = new Float64Array(n).fill(l0), Tseg = new Float64Array(n), Nnode = new Float64Array(n);
  const g = new Float64Array(3 * n);
  let gLx = 0, gLy = 0, energy = 0;
  const kb = 1 / l0;
  function gradient() {
    g.fill(0); gLx = 0; gLy = 0; energy = 0; Nnode.fill(0);
    for (let a = 0; a < n; a++) {                                       // stretch: e = x_b + s Lx − x_a
      const b = next[a], s = wrapNext[a];
      const ex = x[3 * b] + s * Lx - x[3 * a], ey = x[3 * b + 1] - x[3 * a + 1], ez = x[3 * b + 2] - x[3 * a + 2];
      const len = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1e-12, dl = len - l0s[a];
      Tseg[a] = KS * dl;
      energy += 0.5 * KS * dl * dl;
      const k = KS * dl / len, Gx = k * ex, Gy = k * ey, Gz = k * ez;     // dE/de
      g[3 * a] -= Gx; g[3 * a + 1] -= Gy; g[3 * a + 2] -= Gz;
      g[3 * b] += Gx; g[3 * b + 1] += Gy; g[3 * b + 2] += Gz;
      if (s) gLx += Gx;
    }
    for (let a = 0; a < n; a++) {                                       // bending at a: e1 = x_a + s_p Lx − x_p, e2 = x_q + s_a Lx − x_a
      const p = prev[a], q = next[a], sp = wrapNext[p], sa = wrapNext[a];
      const e1x = x[3 * a] + sp * Lx - x[3 * p], e1y = x[3 * a + 1] - x[3 * p + 1], e1z = x[3 * a + 2] - x[3 * p + 2];
      const e2x = x[3 * q] + sa * Lx - x[3 * a], e2y = x[3 * q + 1] - x[3 * a + 1], e2z = x[3 * q + 2] - x[3 * a + 2];
      const l1 = Math.sqrt(e1x * e1x + e1y * e1y + e1z * e1z) || 1e-12, l2 = Math.sqrt(e2x * e2x + e2y * e2y + e2z * e2z) || 1e-12;
      const c = (e1x * e2x + e1y * e2y + e1z * e2z) / (l1 * l2);
      energy += kb * (1 - c);
      const il = 1 / (l1 * l2), c1 = c / (l1 * l1), c2 = c / (l2 * l2);
      const G1x = -kb * (e2x * il - c1 * e1x), G1y = -kb * (e2y * il - c1 * e1y), G1z = -kb * (e2z * il - c1 * e1z);   // dE/de1
      const G2x = -kb * (e1x * il - c2 * e2x), G2y = -kb * (e1y * il - c2 * e2y), G2z = -kb * (e1z * il - c2 * e2z);   // dE/de2
      g[3 * a] += G1x - G2x; g[3 * a + 1] += G1y - G2y; g[3 * a + 2] += G1z - G2z;
      g[3 * p] -= G1x; g[3 * p + 1] -= G1y; g[3 * p + 2] -= G1z;
      g[3 * q] += G2x; g[3 * q + 1] += G2y; g[3 * q + 2] += G2z;
      if (sp) gLx += G1x; if (sa) gLx += G2x;
    }
    for (let k = 0; k < npairs; k++) {                                  // contact
      const i = pairs[4 * k], j = pairs[4 * k + 1], sx = pairs[4 * k + 2], sy = pairs[4 * k + 3];
      const rx = x[3 * j] + sx * Lx - x[3 * i], ry = x[3 * j + 1] + sy * Ly - x[3 * i + 1], rz = x[3 * j + 2] - x[3 * i + 2];
      const r2 = rx * rx + ry * ry + rz * rz;
      if (r2 >= d * d) continue;
      const r = Math.sqrt(r2) || 1e-9, ov = d - r;
      energy += 0.5 * KC * ov * ov;
      const k2 = -KC * ov / r, Gx = k2 * rx, Gy = k2 * ry, Gz = k2 * rz;   // dE/dr
      Nnode[i] += KC * ov; Nnode[j] += KC * ov;                              // the pressure each yarn feels at its crossing
      g[3 * j] += Gx; g[3 * j + 1] += Gy; g[3 * j + 2] += Gz;
      g[3 * i] -= Gx; g[3 * i + 1] -= Gy; g[3 * i + 2] -= Gz;
      if (sx) gLx += sx * Gx; if (sy) gLy += sy * Gy;
    }
    for (let k = 0; k < joints.length; k += 5) {                         // friction-locked crossings: a bearing joint holds the two yarns at r0
      const i = joints[k], j = joints[k + 1], sx = joints[k + 2], sy = joints[k + 3], r0 = jr0[k / 5];
      const rx = x[3 * j] + sx * Lx - x[3 * i], ry = x[3 * j + 1] + sy * Ly - x[3 * i + 1], rz = x[3 * j + 2] - x[3 * i + 2];
      const r = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1e-9, dl = r - r0;
      energy += 0.5 * KC * dl * dl;
      const k2 = KC * dl / r, Gx = k2 * rx, Gy = k2 * ry, Gz = k2 * rz;
      g[3 * j] += Gx; g[3 * j + 1] += Gy; g[3 * j + 2] += Gz;
      g[3 * i] -= Gx; g[3 * i + 1] -= Gy; g[3 * i + 2] -= Gz;
      if (sx) gLx += sx * Gx; if (sy) gLy += sy * Gy;
    }
    gLy -= Fy; gLx -= Fx;                                               // external forces pulling on the cell lengths
    gLx -= sx * Ly; gLy -= sy * Lx;                                     // a stress: force per unit length of the face it acts on (negative presses)
  }

  // FIRE over [nodes, Lx, Ly]
  const vel = new Float64Array(3 * n); let vLx = 0, vLy = 0;
  const MASS_L = 30, DTMAX = 0.03, MAXSTEP = 0.08;
  let dt = 0.01, alpha = 0.1, since = 0, converged = false, it = 0, fmax = 0;
  build();
  const mu = opt.mu || 0, rounds = mu > 0 ? (opt.slipRounds || 120) : 1;
  let slipTotal = 0, calm = 0, round = 0;
  for (round = 0; round < rounds; round++) {
  it = 0; dt = 0.01; alpha = 0.1; since = 0; vel.fill(0); vLx = vLy = 0; converged = false;
  for (; it < (mu > 0 ? (opt.chunk || 4000) : maxIter); it++) {
    if (stale()) build();
    if ((it & 255) === 0 && Date.now() > deadline) break;
    gradient();
    if (opt.probe) return { g: Float64Array.from(g), gLx, gLy, energy };
    // convergence on the largest force
    fmax = 0; for (let k = 0; k < 3 * n; k++) { const a = Math.abs(g[k]); if (a > fmax) fmax = a; }
    if (freeLx) fmax = Math.max(fmax, Math.abs(gLx) / 4); if (freeLy) fmax = Math.max(fmax, Math.abs(gLy) / 4);
    if (fmax < tol) { converged = true; break; }
    // power and velocity mixing
    let P = 0, fn = 0, vn = 0;
    for (let k = 0; k < 3 * n; k++) { P -= g[k] * vel[k]; fn += g[k] * g[k]; vn += vel[k] * vel[k]; }
    if (freeLx) { P -= gLx * vLx; fn += gLx * gLx; vn += vLx * vLx; } if (freeLy) { P -= gLy * vLy; fn += gLy * gLy; vn += vLy * vLy; }
    fn = Math.sqrt(fn); vn = Math.sqrt(vn);
    if (P > 0) {
      const w = fn > 0 ? alpha * vn / fn : 0;
      for (let k = 0; k < 3 * n; k++) vel[k] = (1 - alpha) * vel[k] - w * g[k];
      if (freeLx) vLx = (1 - alpha) * vLx - w * gLx; if (freeLy) vLy = (1 - alpha) * vLy - w * gLy;
      if (++since > 5) { dt = Math.min(dt * 1.1, DTMAX); alpha *= 0.99; }
    } else { vel.fill(0); vLx = vLy = 0; dt *= 0.5; alpha = 0.1; since = 0; }
    for (let k = 0; k < 3 * n; k++) vel[k] -= dt * g[k];
    if (freeLx) vLx -= dt * gLx / MASS_L; if (freeLy) vLy -= dt * gLy / MASS_L;
    for (let k = 0; k < 3 * n; k++) { let s = dt * vel[k]; if (s > MAXSTEP) s = MAXSTEP; else if (s < -MAXSTEP) s = -MAXSTEP; x[k] += s; }
    if (freeLx) Lx += Math.max(-MAXSTEP, Math.min(MAXSTEP, dt * vLx)); if (freeLy) Ly += Math.max(-MAXSTEP, Math.min(MAXSTEP, dt * vLy));
  }
  if (!(mu > 0)) break;
  // friction: yarn slides through a crossing when the tension on its two sides differs by more than mu × the pressure there
  let q2 = 0;
  for (let a = 0; a < n; a++) {
    const pa = prev[a], dT = Tseg[a] - Tseg[pa], thr = mu * Nnode[a];
    if (Math.abs(dT) > thr) {
      const q = Math.min(0.25 * (Math.abs(dT) - thr) / KS, 0.2 * l0);
      if (dT > 0) { l0s[a] += q; l0s[pa] -= q; } else { l0s[a] -= q; l0s[pa] += q; }
      q2 = Math.max(q2, q);
    }
  }
  slipTotal += q2;
  if (q2 < 2e-4 * l0) { if (++calm >= 3 && converged) break; } else calm = 0;
  }
  return { x, Lx, Ly, energy, gLx, gLy, iterations: it, converged, maxForce: fmax, n, yarns: yarns.map((y) => y.n), slipRounds: round, l0s: Float64Array.from(l0s) };
}

/** Pairs of nodes touching (centre distance < cut) that are not arc neighbours: the crossings that friction locks. */
function crossings(topo, x, Lx, Ly, cut = 1.2) {
  const yid = [], arc = [], len = [];
  topo.yarns.forEach((y, k) => { for (let i = 0; i < y.n; i++) { yid.push(k); arc.push(i); len.push(y.n); } });
  const n = yid.length, out = [];
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) for (let sx = -1; sx <= 1; sx++) for (let sy = -1; sy <= 1; sy++) {
    if (i === j && (sx < 0 || (sx === 0 && sy <= 0))) continue;
    const dx = x[3 * j] + sx * Lx - x[3 * i], dy = x[3 * j + 1] + sy * Ly - x[3 * i + 1], dz = x[3 * j + 2] - x[3 * i + 2], r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r > cut) continue;
    if (yid[i] === yid[j] && sy === 0 && Math.abs((arc[j] + sx * len[i]) - arc[i]) <= MEXCL + 2) continue;
    out.push([i, j, sx, sy, r]);
  }
  return out;
}
module.exports = { relax, crossings, KS, KC, MEXCL };
