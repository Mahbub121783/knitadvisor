/**
 * Yarn-level twin — feasibility probe (EXPERIMENTAL, nothing in the Studio uses it).
 *
 * Builds a plain-jersey cell as real yarn (engine/domain/yarn-solver.js), and asks the four questions
 * that decide whether a yarn-level "digital twin" can be trusted. Run: node tools/yarn-twin-probe.js [ell]
 *
 *   1. Is the topology real?  The Studio's 3D view draws loops that LOOK threaded; their Gauss linking
 *      number with the course above is 0 — they are not interlocked. A twisted loop (the legs cross when
 *      seen along the wale) has linking ±1: that is a chain, and is what the solver is started from.
 *   2. Frictionless relaxation: where does the cell go with no external stress?
 *   3. Held at the factory-calibrated size, frictionless: what resists a pull?
 *   4. The same with every crossing locked (infinite friction).
 *
 * What it found (ell = 17 d, plain jersey): see the printed table, and knitadvisor-yarn-twin in memory.
 * Coulomb friction at the crossings (relax(..., { mu })) was also tried: slip through a crossing when the
 * tension difference exceeds mu × the pressure there. From any start it relaxed to the same open state for
 * every mu from 0.1 to 1.2 — the pressures at relaxed crossings are too small for friction to bind. A
 * friction that holds a knit compact needs the tensions the knitting leaves in the cloth, i.e. calibration.
 */
'use strict';
const S = require('../engine/domain/yarn-solver');

function link(A, B) {                                          // Gauss linking number of two closed polylines
  let s = 0;
  for (let i = 0; i < A.length; i++) {
    const a0 = A[i], a1 = A[(i + 1) % A.length], da = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]], ma = [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2, (a0[2] + a1[2]) / 2];
    for (let j = 0; j < B.length; j++) {
      const b0 = B[j], b1 = B[(j + 1) % B.length], db = [b1[0] - b0[0], b1[1] - b0[1], b1[2] - b0[2]], mb = [(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2, (b0[2] + b1[2]) / 2];
      const r = [ma[0] - mb[0], ma[1] - mb[1], ma[2] - mb[2]], d = Math.hypot(r[0], r[1], r[2]);
      s += ((da[1] * db[2] - da[2] * db[1]) * r[0] + (da[2] * db[0] - da[0] * db[2]) * r[1] + (da[0] * db[1] - da[1] * db[0]) * r[2]) / (d * d * d);
    }
  }
  return s / (4 * Math.PI);
}

/** One jersey loop as yarn: a twisted ring (x = a cos t, y = b sin t, z = k sin 2t) plus its sinker to the next wale. Units: d = 1. */
function jerseyCell(ell, { a = 1.6, b = 3.5, k = 1.0, eps = 0.6, w, h, l0 = 0.5 }) {
  const path = (sc) => {
    const P = [];
    for (let i = 0; i <= 400; i++) { const t = (-Math.PI / 2 - eps) - (i / 400) * (2 * Math.PI - 2 * eps); P.push([sc * a * Math.cos(t), sc * b * Math.sin(t), sc * k * Math.sin(2 * t)]); }
    P.push([P[0][0] + w, P[0][1], P[0][2]]);
    return P;
  };
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const len = (P) => P.slice(1).reduce((t, p, i) => t + dist(p, P[i]), 0);
  let sc = 1; for (let i = 0; i < 40; i++) sc *= ell / len(path(sc));
  const P = path(sc), N = Math.round(ell / l0), step = len(P) / N, nodes = [];
  let acc = 0, idx = 0;
  for (let i = 0; i < N; i++) {
    const target = i * step;
    while (idx < P.length - 2 && acc + dist(P[idx], P[idx + 1]) < target) { acc += dist(P[idx], P[idx + 1]); idx++; }
    const f = (target - acc) / (dist(P[idx], P[idx + 1]) || 1);
    nodes.push([0, 1, 2].map((c) => P[idx][c] + f * (P[idx + 1][c] - P[idx][c])));
  }
  const x = new Float64Array(3 * N); nodes.forEach((p, i) => x.set(p, 3 * i));
  return { yarns: [{ n: N, x }], Lx: w, Ly: h, d: 1, l0: ell / N, nodes };
}
/** The loop the Studio's 3D view draws (frontend/assets/js/knit3d/constants.js LOOP, copied): is it threaded through the course above? */
function vizLoopLinking() {
  const L = { footHalf: 0.16, footY: -0.50, footZ: -0.10, lowLegHalf: 0.26, lowLegY: -0.18, lowLegZ: 0.20, legHalf: 0.36, legY: 0.18, legZ: 0.24, shoulderHalf: 0.32, shoulderY: 0.48, shoulderZ: 0.10, headHalf: 0.22, headSideY: 0.68, headSideZ: -0.08, headY: 0.80, headZ: -0.12 };
  const K = [[-L.footHalf, L.footY, L.footZ], [-L.lowLegHalf, L.lowLegY, L.lowLegZ], [-L.legHalf, L.legY, L.legZ], [-L.shoulderHalf, L.shoulderY, L.shoulderZ], [-L.headHalf, L.headSideY, L.headSideZ], [0, L.headY, L.headZ], [L.headHalf, L.headSideY, L.headSideZ], [L.shoulderHalf, L.shoulderY, L.shoulderZ], [L.legHalf, L.legY, L.legZ], [L.lowLegHalf, L.lowLegY, L.lowLegZ], [L.footHalf, L.footY, L.footZ]];
  const R = [];                                                // Catmull-Rom through the control points
  for (let i = 0; i < K.length - 1; i++) {
    const p0 = K[Math.max(0, i - 1)], p1 = K[i], p2 = K[i + 1], p3 = K[Math.min(K.length - 1, i + 2)];
    for (let q = 0; q < 8; q++) { const t = q / 8; R.push([0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t * t + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t * t * t))); }
  }
  return +link(R, R.map((p) => [p[0], p[1] + 0.92, p[2]])).toFixed(2);
}
const again = (T, st) => ({ ...T, yarns: [{ n: st.n, x: Float64Array.from(st.x) }] });

function run(ell = 17) {
  const Lx0 = ell / 3.81, Ly0 = ell / 5.18;               // the factory's finished jersey: Kw 3.81, Kc 5.18
  const T = jerseyCell(ell, { w: Lx0, h: Ly0 });
  const ring = T.nodes.slice(0, -4), up = (R, dy) => R.map((p) => [p[0], p[1] + dy, p[2]]);
  const out = { ell, linking_studio_3d_loop: vizLoopLinking(), linking_twisted_chain: +link(ring, up(ring, Ly0)).toFixed(2) };
  const free = S.relax(T, { maxIter: 300000, tol: 2e-4 });
  out.frictionless_relaxed = { converged: free.converged, Kw: +(ell / free.Lx).toFixed(2), Kc: +(ell / free.Ly).toFixed(2), note: 'factory finished jersey: Kw 3.81, Kc 5.18' };
  const hold = S.relax(T, { fixedLx: Lx0, fixedLy: Ly0, maxIter: 150000, tol: 3e-4 });
  const joints = S.crossings(T, hold.x, Lx0, Ly0, 1.15);
  const pull = (opt) => [0, 0.1, 0.3, 0.6].map((e) => { const r = S.relax(again(T, hold), { fixedLy: Ly0 * (1 + e), ...opt, maxIter: 150000, tol: 3e-4 }); return { strain_pct: e * 100, force: +r.gLy.toFixed(2) }; });
  out.pull_frictionless = pull({});
  out.pull_locked = pull({ joints });
  return out;
}
module.exports = { run, jerseyCell, link, vizLoopLinking };

if (require.main === module) console.log(JSON.stringify(run(+process.argv[2] || 17), null, 1));
