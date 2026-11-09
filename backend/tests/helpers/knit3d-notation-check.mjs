// Builds the real view's yarn paths (knit3d) from studio notation, through
// the same mapping the page uses, and measures every stitch: where it lies
// (in front of / behind its bed), how tall it is, and whether a hole opens.
// Prints JSON for tests/studio_notation.test.js.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const map = require('../../../frontend/assets/js/studio-cloth-map.js');
const studio = require('../../engine/domain/fabric-studio');
const T = await import('../../../frontend/assets/js/knit3d/topology-builder.js');

const ids = process.argv.slice(2);
const out = {};
for (const id of ids) {
  const t = studio.listTemplates().find((x) => x.id === id);
  const C = t.grid.C, D = t.grid.D || null;
  const bed = D ? (t.gating === 'interlock' || /interlock|ponte/.test(id) ? 'interlock' : 'rib') : 'single';
  const cs = map.clothSpec({ bed, C, D, feeds: C.map(() => ({ role: 'ground' })) });
  const W = 8, CC = 16;
  const r = T.buildYarnPaths({ construction: cs.construction, sample: cs.sample, sampleBack: cs.sampleBack, pattern: cs.pattern, wales: W, courses: CC });
  const two = cs.construction.type === 'interlock';
  const stats = {};
  const add = (key, v) => { (stats[key] = stats[key] || []).push(v); };
  for (let c = 3; c < CC - 5; c++) {
    for (const bi of two ? [0, 1] : [0]) {
      const p = r.paths[two ? 2 * c + bi : c];
      const s = bi ? -1 : 1, z0 = two ? (bi ? -0.4 : 0.4) : 0;
      const g = bi ? D : C, smp = bi ? cs.sampleBack : cs.sample;
      for (let w = 1; w < W - 1; w++) {
        const pts = p.points.slice(p.starts[w], p.starts[w + 1]);
        if (!pts.length) continue;
        const tok = smp(w, c);
        let held = 0; for (let k = c + 1; k < CC; k++) { if (smp(w, k) !== 'tuck' && smp(w, k) !== 'miss') break; held++; }
        // depth measured towards the bed's own technical face (+z for the cylinder, -z for the dial)
        // a rib's knit wales stand forward of its purl wales by design (topology-builder RIB_DEPTH)
        const zb = cs.construction.type === 'rib' ? (tok === 'purl' ? -0.28 * 0.12 : 0.28) : z0;
        const dz = pts.map((v) => s * (v.z - zb)), ys = pts.map((v) => v.y);
        add((bi ? 'dial ' : '') + tok + (tok === 'knit' || tok === 'purl' ? '/held' + held : ''), { front: Math.max(...dz), back: Math.min(...dz), height: Math.max(...ys) - Math.min(...ys), cell: g[((c % g.length) + g.length) % g.length][((w % g[0].length) + g[0].length) % g[0].length] });
      }
    }
  }
  const summary = {};
  for (const [k, a] of Object.entries(stats)) {
    const m = (f) => Math.round(a.reduce((t, x) => t + x[f], 0) / a.length * 100) / 100;
    summary[k] = { n: a.length, front: m('front'), back: m('back'), height: m('height') };
  }
  out[id] = { construction: cs.construction.type, label: cs.construction.label, photo: cs.photo, stats: summary,
    holes: cs.construction.type === 'mesh' ? T.buildYarnPaths && null : null };
}
console.log(JSON.stringify(out));
