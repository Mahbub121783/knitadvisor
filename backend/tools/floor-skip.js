/**
 * Part 6's yardstick — the floor-skip test. Teach only some families (floors 1, 2 …), take away everything about the
 * rest (their records AND their book values, which are their own factory medians), and ask for the rest.
 *
 * Two engines are asked the same question:
 *   studio      the Fabric Studio as it is: family constants, with the untaught ones gone
 *   laws        Part 6's brick laws on the stitch graph (engine/domain/geometry-laws.js): four numbers learned from
 *               the floors given (jersey cell, elastane, rib collapse), nothing at all about the untaught families
 *
 * Fairness: the fleece records give only the face yarn count — the binder and loop yarns' counts are not recorded,
 * so every engine weighs them as face yarn. A fleece error here is part yarn, part geometry.
 *
 * Run: node tools/floor-skip.js            (≈ 1 min)
 */
'use strict';
const CV = require('./studio-crossval');
const { FACTORY_RECORDS } = require('../engine/catalog/factory-dataset');
const F = require('../engine/domain/fabric-studio');
const G = require('../engine/domain/stitch-graph');
const GL = require('../engine/domain/geometry-laws');

const ALL = FACTORY_RECORDS.slice();
const isL = (r) => /lycra/.test(String(r.spin || ''));
const usable = (r) => CV.templateOf(r) && r.sl > 0 && r.ne > 0 && r.fgsm > 0;
const med = (a) => { const s = a.map(Math.abs).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const w5 = (a) => (a.length ? Math.round((a.filter((v) => Math.abs(v) <= 0.05).length / a.length) * 100) : null);
const summary = (by) => Object.fromEntries(Object.entries(by).map(([k, b]) => [k, { n: b.g.length, gsm_err_med: med(b.g), gsm_within_5: w5(b.g), width_err_med: med(b.w), width_within_5: w5(b.w) }]));

/** The Studio as it is, taught `taught`, every other family's records and book value taken away. */
function studioScenario(taught) {
  const fams = [...new Set(ALL.filter(usable).map((r) => r.fab))].filter((f) => !taught.includes(f));
  const by = {};
  for (const fam of fams) {
    const S = CV.studioFrom(ALL.filter((r) => taught.includes(r.fab)), fam);
    for (const r of ALL.filter((x) => usable(x) && x.fab === fam)) {
      const k = r.fab + (isL(r) ? '+L' : ''), b = (by[k] = by[k] || { g: [], w: [] });
      const p = CV.predict(S, r); if (!p) continue;
      b.g.push((p.gsm - r.fgsm) / r.fgsm); if (r.fdia > 0) b.w.push((p.width - r.fdia) / r.fdia);
    }
  }
  CV.restore();
  return summary(by);
}

// each record as the laws see it: its graph, the yarn per repeat (part 5's rules, every yarn of a plated loop), its measured cell
const T = F.listTemplates(), gcache = {};
const graphOf = (id) => gcache[id] || (gcache[id] = (() => { const t = T.find((x) => x.id === id); return G.fromDesign({ grid: t.grid, gating: t.gating, feeds: t.roles.map((role) => ({ role })) }); })());
function recordCell(r) {
  const id = CV.templateOf(r), g = graphOf(id), f = GL.featuresOf(g);
  const p = 25.4 / r.g, sl = r.sl, tex = (590.5 / r.ne) * (id === 'heavy_jersey' ? 2 : 1);
  let K = 0, Tk = 0, fl = 0;
  for (const ps of g.passes.filter((x) => !x.yarn.endsWith('p'))) { ps.visits.forEach((v) => { if (v.act === 'K') K++; if (v.act === 'T') Tk++; }); ps.spans.forEach((s) => { if (s.kind === 'float') fl += s.float_needles; }); }
  const Y = K * sl + Tk * 0.7 * sl + fl * p;                               // mm of yarn per repeat
  const w = (r.fdia * 25.4) / (Math.PI * r.dia * r.g);                     // mm per needle slot, measured
  const Hrep = (Y * tex) / (g.period.needles * w * r.fgsm);                // mm per repeat, from the measured GSM
  return { id, g, f, sl, tex, Y, w, Hrep, needles: Math.PI * r.dia * r.g };
}
function lawsScenario(taught) {
  const cells = [];
  for (const r of ALL.filter((x) => usable(x) && x.fdia > 0 && x.dia > 0 && x.g > 0 && taught.includes(x.fab))) {
    const c = recordCell(r);
    const kind = r.fab === 'single_jersey' ? (isL(r) ? 'jersey+L' : 'jersey') : r.fab === 'rib' && c.id === 'rib_1x1' && !isL(r) ? 'rib' : null;
    if (kind) cells.push({ kind, w_l: c.w / c.sl, H_l: c.Hrep / (c.f.loops_per_wale * c.sl) });
  }
  const K = GL.calibrate(cells);
  const by = {};
  for (const r of ALL.filter((x) => usable(x) && x.fdia > 0 && x.dia > 0 && x.g > 0 && !taught.includes(x.fab))) {
    const c = recordCell(r), pr = GL.cell(c.g, K, { elastane: isL(r) });
    const w = pr.w_l * c.sl, Hrep = pr.H_rep_l * c.sl;
    const gsm = (c.Y * c.tex) / (c.g.period.needles * w * Hrep), width = (w * c.needles) / 25.4;
    const k = r.fab + (isL(r) ? '+L' : ''), b = (by[k] = by[k] || { g: [], w: [] });
    b.g.push((gsm - r.fgsm) / r.fgsm); b.w.push((width - r.fdia) / r.fdia);
  }
  return { constants: K, families: summary(by) };
}

function run() {
  const out = {};
  for (const [name, taught] of [['jersey_only', ['single_jersey']], ['jersey_and_rib', ['single_jersey', 'rib']]]) out[name] = { studio: studioScenario(taught), laws: lawsScenario(taught) };
  return out;
}
module.exports = { run, studioScenario, lawsScenario };

if (require.main === module) {
  const r = run();
  const p = (v) => (v == null ? '   —  ' : (v * 100).toFixed(1).padStart(5) + '%');
  for (const [name, s] of Object.entries(r)) {
    console.log(`\n${name.replace(/_/g, ' ').toUpperCase()} — the rest never shown (records and book values gone)`);
    console.log(`  laws learned: jersey cell ${s.laws.constants.w0.toFixed(3)} × ${s.laws.constants.h0.toFixed(3)} ℓ, rib collapse ${s.laws.constants.phi_rib == null ? '—' : s.laws.constants.phi_rib.toFixed(3)}, elastane ${s.laws.constants.elastane ? s.laws.constants.elastane.w.toFixed(3) + ' × ' + s.laws.constants.elastane.h.toFixed(3) : '—'}`);
    console.log('  family             n     STUDIO  GSM   width        LAWS  GSM   width');
    const fams = [...new Set([...Object.keys(s.studio), ...Object.keys(s.laws.families)])].sort();
    for (const k of fams) {
      const a = s.studio[k] || {}, b = s.laws.families[k] || {};
      console.log('  ' + k.padEnd(16), String(a.n || b.n || '').padStart(5), '      ', p(a.gsm_err_med), p(a.width_err_med), '       ', p(b.gsm_err_med), p(b.width_err_med));
    }
  }
}
