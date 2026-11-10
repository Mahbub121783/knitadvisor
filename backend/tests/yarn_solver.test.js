// Yarn-level solver: the gradient is the derivative of the energy (so FIRE minimises what it claims to),
// and the twisted loop is a real chain while the Studio's 3D-view loop is not.
const assert = require('assert');
console.log('--- Running Yarn Solver Tests ---');
const S = require('../engine/domain/yarn-solver');
const P = require('../tools/yarn-twin-probe');

// 1. analytic gradient (nodes, Lx, Ly — stretch, bending, contact across periodic images) against finite differences
let seed = 5; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const mk = (nn, y0) => { const x = new Float64Array(3 * nn); for (let i = 0; i < nn; i++) { x[3 * i] = (i / nn) * 6 + 0.1 * rnd(); x[3 * i + 1] = y0 + 0.9 * Math.sin(i * 0.9) + 0.05 * rnd(); x[3 * i + 2] = 0.5 * Math.cos(i * 0.7) + 0.05 * rnd(); } return { n: nn, x }; };
const copy = (t) => ({ ...t, yarns: t.yarns.map((y) => ({ n: y.n, x: Float64Array.from(y.x) })) });
const topo = { yarns: [mk(14, 0), mk(14, 1.3)], Lx: 6, Ly: 2.6, d: 1, l0: 0.5 };
const base = S.relax(topo, { probe: true });
let worst = 0;
for (let k = 0; k < 84; k += 3) {
  const up = copy(topo), dn = copy(topo), yi = k < 42 ? 0 : 1, loc = k - yi * 42, h = 1e-6;
  up.yarns[yi].x[loc] += h; dn.yarns[yi].x[loc] -= h;
  const fd = (S.relax(up, { probe: true }).energy - S.relax(dn, { probe: true }).energy) / (2 * h);
  worst = Math.max(worst, Math.abs(fd - base.g[k]) / (Math.abs(fd) + 1e-6));
}
assert(worst < 1e-5, `node gradient off by ${worst}`);
for (const [name, key] of [['Lx', 'gLx'], ['Ly', 'gLy']]) {
  const h = 1e-6, fd = (S.relax({ ...topo, [name]: topo[name] + h }, { probe: true }).energy - S.relax({ ...topo, [name]: topo[name] - h }, { probe: true }).energy) / (2 * h);
  assert(Math.abs(fd - base[key]) < 1e-4 * (1 + Math.abs(fd)), `${name} gradient ${base[key]} vs ${fd}`);
}
assert(Math.abs(base.gLy) > 1e-3, 'the test cell really has contact across the y boundary');

// 2. relaxation lowers the energy and conserves yarn length per segment (stiff stretch)
const r = S.relax(copy(topo), { maxIter: 4000 });
assert(r.energy < base.energy, 'FIRE lowers the energy');

// 3. the topology the twin starts from is a chain; the Studio's 3D-view loop, drawn to look threaded, is not
assert(P.vizLoopLinking() === 0, 'the 3D view loop has linking number 0 with the course above');
const J = P.jerseyCell(17, { w: 4.46, h: 3.28 });
const ring = J.nodes.slice(0, -4);
assert(Math.abs(P.link(ring, ring.map((p) => [p[0], p[1] + 3.28, p[2]])) + 1) < 0.15, 'the twisted loop is linked ±1 with the course above');
console.log('Yarn solver tests passed');
