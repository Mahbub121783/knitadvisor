/**
 * The yarn twin: the drawn knit as interlocked YARN, its shape solved from the yarn's mechanics.
 *
 * What it is — and is not. The Studio predicts the finished cloth's dimensions (wales and courses per cm,
 * width, weight) from the factory records and the machine's own rolls. The twin takes THOSE dimensions as
 * the cell, builds the yarn as a real chain of threaded loops (a twisted loop: its legs cross when seen
 * along the wale, which is what makes consecutive loops a chain — the 3D loop view's loops are drawn to look
 * threaded and are not; see tools/yarn-twin-probe.js), and lets the yarn find the shape it takes inside that
 * cell: inextensible, bending-stiff, unable to pass through itself (engine/domain/yarn-solver.js).
 *
 * So the dimensions are the Studio's prediction and are not re-derived here: the twin does not predict
 * them (a frictionless yarn model opens the cloth; the friction that holds a knit compact needs measured
 * stress–strain curves). What the twin adds is the SHAPE — how the loops sit, how the beds interleave in a
 * rib, how thick the cloth is — and it says plainly how well the yarn fitted: the closest two yarns come,
 * and the force left in the solution.
 *
 * Supported: knit-only programmes in which every feed is the same (jersey, every rib: 1×1, 2×2, 3×1, …).
 * Tuck, miss, float and interlock need their own threading and are refused, not approximated.
 */
'use strict';
const solver = require('./yarn-solver');

class TwinError extends Error {}
const ELL_MIN = 8, ELL_MAX = 40;                       // loop length in yarn diameters the model is built for

/** The wales a programme makes: bed, and position across the repeat in needle pitches (a dial needle sits half a pitch on rib gating). */
function walesOf(out) {
  const st = out && out.structure;
  if (!st || !st.beds || !st.beds.C) return { reason: 'This design has no needle programme.' };
  const rowsC = st.beds.C, rowsD = st.beds.D || null;
  const same = (rows) => rows.every((r) => r.join('') === rows[0].join(''));
  if (!same(rowsC) || (rowsD && !same(rowsD))) return { reason: 'The feeds differ (a different programme on each feeder) — the twin models one repeating course.' };
  const cells = [...rowsC[0], ...(rowsD ? rowsD[0] : [])];
  if (cells.some((s) => s !== 'K' && s !== '-')) return { reason: 'It has tuck, miss or transfer stitches — their threading is not modelled yet. Plain knit and rib are.' };
  if (rowsD && st.gating === 'interlock') return { reason: 'Interlock gating is not modelled yet.' };
  if (st.roles && st.roles.some((r) => r !== 'ground')) return { reason: 'It uses loop, binder or plated yarns — only a single ground yarn is modelled.' };
  const cols = rowsC[0].length, wales = [];
  rowsC[0].forEach((s, j) => { if (s === 'K') wales.push({ bed: 'C', pos: j }); });
  if (rowsD) rowsD[0].forEach((s, j) => { if (s === 'K') wales.push({ bed: 'D', pos: j + 0.5 }); });
  if (!wales.length) return { reason: 'No needle knits.' };
  if (wales.length > 8) return { reason: 'More than 8 wales in the repeat.' };
  wales.sort((p, q) => p.pos - q.pos);
  return { cols, wales, double: !!rowsD };
}

/** The twisted loop of one wale, as a polyline of points, scaled so loop + sinker to the next wale is `ell` long. */
function loopPath(x0, z0, side, gapX, ell, { a = 1.6, b = 3.5, k = 1.0, eps = 0.6 } = {}) {
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const build = (sc) => {
    const P = [];
    for (let i = 0; i <= 160; i++) {
      const t = (-Math.PI / 2 - eps) - (i / 160) * (2 * Math.PI - 2 * eps);
      P.push([x0 + sc * a * Math.cos(t), sc * b * Math.sin(t), z0 + side * sc * k * Math.sin(2 * t)]);
    }
    return P;
  };
  const length = (P) => P.slice(1).reduce((t, p, i) => t + dist(p, P[i]), 0);
  // loop length plus the straight sinker from this loop's end to the next wale's start (gapX away in x, at the sinker level)
  const total = (sc) => length(build(sc)) + Math.max(0, gapX - 2 * sc * a * Math.sin(eps));
  let sc = 1;
  for (let i = 0; i < 40; i++) sc *= ell / total(sc);
  return build(sc);
}

/**
 * @param out  a successful fabric-studio analyse() answer
 * @returns    { supported:false, reason } or { supported:true, ...the solved cell }
 */
function twin(out, opt = {}) {
  const W = walesOf(out);
  if (!W.wales) return { supported: false, reason: W.reason };
  const f = out.fabric || {}, m = out.machine || {}, d = out.yarn && out.yarn.ground && out.yarn.ground.d_mm;
  if (!(d > 0) || !(f.width_open_in > 0) || !(f.cpc > 0) || !(m.needles > 0) || !(f.sl_mm > 0)) return { supported: false, reason: 'The yarn, width, courses or machine are not set.' };
  const mm = 1 / d;                                      // yarn diameters per mm
  const ell = f.sl_mm * mm;
  if (ell < ELL_MIN || ell > ELL_MAX) return { supported: false, reason: `A loop of ${Math.round(ell)} yarn diameters is outside what the model is built for (${ELL_MIN}–${ELL_MAX}).` };
  const Lx = W.cols * ((f.width_open_in * 25.4) / m.needles) * mm, Ly = (10 / f.cpc) * mm;
  const nw = W.wales.length;
  const Zb = W.double ? 1.8 : 0;

  // one polyline for the whole course: wale after wale, left to right, each a twisted loop
  const path = [];
  W.wales.forEach((w, i) => {
    const x0 = (w.pos / W.cols) * Lx, next = W.wales[(i + 1) % nw], gap = ((next.pos / W.cols) * Lx - x0 + (i === nw - 1 ? Lx : 0));
    const side = w.bed === 'D' ? -1 : 1, z0 = w.bed === 'D' ? -Zb : Zb;
    loopPath(x0, z0, side, gap, ell, { a: Math.min(2.1, 0.46 * Math.min(gap, W.double ? 2 * gap : gap)) }).forEach((p) => path.push(p));
  });
  const closed = [...path, [path[0][0] + Lx, path[0][1], path[0][2]]];
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const total = closed.slice(1).reduce((t, p, i) => t + dist(p, closed[i]), 0);
  const N = Math.max(12, Math.round((ell * nw) / 0.5)), step = total / N, nodes = [];
  let acc = 0, idx = 0;
  for (let i = 0; i < N; i++) {
    const target = i * step;
    while (idx < closed.length - 2 && acc + dist(closed[idx], closed[idx + 1]) < target) { acc += dist(closed[idx], closed[idx + 1]); idx++; }
    const fr = (target - acc) / (dist(closed[idx], closed[idx + 1]) || 1);
    nodes.push([0, 1, 2].map((c) => closed[idx][c] + fr * (closed[idx + 1][c] - closed[idx][c])));
  }
  const x = new Float64Array(3 * N); nodes.forEach((p, i) => x.set(p, 3 * i));
  const topo = { yarns: [{ n: N, x }], Lx, Ly, d: 1, l0: (ell * nw) / N };
  const r = solver.relax(topo, { fixedLx: Lx, fixedLy: Ly, maxIter: opt.maxIter || 120000, timeMs: opt.timeMs || 2500, tol: 5e-4 });

  // how well the yarn fitted: the closest two non-neighbouring yarns come (in diameters), over every periodic image
  let gap = 1e9;
  for (let i = 0; i < N; i++) for (let j = i; j < N; j++) for (let sx = -1; sx <= 1; sx++) for (let sy = -1; sy <= 1; sy++) {
    if (i === j && (sx < 0 || (sx === 0 && sy <= 0))) continue;
    if (sy === 0 && Math.abs(((j + sx * N) - i)) <= solver.MEXCL + 2) continue;
    const dd = Math.hypot(r.x[3 * j] + sx * Lx - r.x[3 * i], r.x[3 * j + 1] + sy * Ly - r.x[3 * i + 1], r.x[3 * j + 2] - r.x[3 * i + 2]);
    if (dd < gap) gap = dd;
  }
  let zmin = 1e9, zmax = -1e9;
  for (let i = 0; i < N; i++) { zmin = Math.min(zmin, r.x[3 * i + 2]); zmax = Math.max(zmax, r.x[3 * i + 2]); }
  const q = (v) => Math.round(v * 1000) / 1000;
  return {
    supported: true,
    d_mm: d, cell: { Lx: q(r.Lx), Ly: q(r.Ly), cols: W.cols }, wales: W.wales.map((w) => ({ bed: w.bed, x: q((w.pos / W.cols) * Lx) })),
    nodes: Array.from({ length: N }, (_, i) => [q(r.x[3 * i]), q(r.x[3 * i + 1]), q(r.x[3 * i + 2])]),
    thickness_mm: q((zmax - zmin + 1) * d), loop_length_d: q(ell),
    fit: { closest_yarns_d: q(gap), converged: r.converged, residual_force: +r.maxForce.toExponential(2), iterations: r.iterations, nodes: N },
    basis: 'The cell (wales and courses per cm, width) is the Studio\'s own prediction; the yarn is threaded as a chain of twisted loops and relaxed inside it as an inextensible, bending-stiff rod that cannot pass through itself. The dimensions are not re-derived here: only the shape the yarn takes.',
  };
}

module.exports = { twin, walesOf, loopPath, TwinError };
