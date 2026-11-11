/**
 * A second opinion on every weft design: its weight and width worked out from its own stitches (the stitch graph,
 * part 0; the yarn each stitch takes, part 5's rules; the cell the brick laws give, part 6) — not from a table of
 * its family. The Studio's main answer leans on the family's records, which is the better guide when the design
 * IS that family; for a new structure the two can part, and when they do the designer is told by how much, which
 * laws were used and what no law covers yet. Neither is passed off as the truth: the first trial roll settles it.
 *
 * The laws' constants are learned once, at load, from the first floors only — plain jersey (with and without
 * elastane), 1×1 and 2×2 rib and single piqué records — the way tools/floor-skip.js judges them.
 */
'use strict';

const { FACTORY_RECORDS } = require('../catalog/factory-dataset');
const G = require('./stitch-graph');
const GL = require('./geometry-laws');

let templates = null;
const tpl = (id) => { if (!templates) templates = require('./fabric-studio').listTemplates(); return templates.find((t) => t.id === id); };
const isL = (r) => /lycra/.test(String(r.spin || ''));
const AGREE = 0.10;

/** The floors the laws learn from: each record's measured cell, in loop lengths. */
function floorCells() {
  const cells = [], graphs = {};
  const graphOf = (id) => graphs[id] || (graphs[id] = (() => { const t = tpl(id); return G.fromDesign({ grid: t.grid, gating: t.gating, feeds: t.roles.map((role) => ({ role })) }); })());
  for (const r of FACTORY_RECORDS) {
    if (!(r.sl > 0 && r.ne > 0 && r.fgsm > 0 && r.fdia > 0 && r.dia > 0 && r.g > 0)) continue;
    let kind = null, id = null;
    if (r.fab === 'single_jersey') { kind = isL(r) ? 'jersey+L' : 'jersey'; id = 'single_jersey'; }
    else if (r.fab === 'rib' && !isL(r) && r.fdia / r.dia >= 1.6) { kind = 'rib'; id = 'rib_1x1'; }
    else if (r.fab === 'rib' && !isL(r)) { kind = 'rib2x2'; id = 'rib_2x2'; }
    else if (r.fab === 'pique' && !isL(r)) { kind = 'pique'; id = 'lacoste_single'; }
    if (!kind) continue;
    const g = graphOf(id), f = GL.featuresOf(g), p = 25.4 / r.g, tex = 590.5 / r.ne;
    let K = 0, Tk = 0, fl = 0;
    for (const ps of g.passes.filter((x) => !x.yarn.endsWith('p'))) { ps.visits.forEach((v) => { if (v.act === 'K') K++; if (v.act === 'T') Tk++; }); ps.spans.forEach((s) => { if (s.kind === 'float') fl += s.float_needles; }); }
    const Y = K * r.sl + Tk * 0.7 * r.sl + fl * p, w = (r.fdia * 25.4) / (Math.PI * r.dia * r.g);
    const Hrep = (Y * tex) / (g.period.needles * w * r.fgsm);
    cells.push({ kind, w_l: w / r.sl, H_l: Hrep / (f.loops_per_wale * r.sl), tucks_per_knit: f.ground_tucks_per_knit });
  }
  return cells;
}
let K = null;
function constants() { if (!K) K = GL.calibrate(floorCells()); return K; }

/**
 * @param input  the analyse() input (grid, feeds, elastane …)
 * @param out    the analyse() answer
 */
function forDesign(input, out) {
  if (!out || !out.success || out.plush || !out.structure || !out.structure.beds) return null;
  const f = out.fabric || {}, m = out.machine || {}, yf = (out.yarn && out.yarn.feeds) || [];
  if (!(f.sl_mm > 0 && f.gsm > 0 && f.width_open_in > 0 && m.needles > 0 && m.gauge > 0)) return null;
  let g;
  try { g = G.fromDesign({ grid: out.structure.beds, gating: out.structure.gating, feeds: (input.feeds || []).map((x) => ({ role: x.role, course: x.course })), elastane: input.elastane || null }); } catch (_) { return null; }
  const Kc = constants(), c = GL.cell(g, Kc, { elastane: !!input.elastane });
  const p = 25.4 / m.gauge, sl = f.sl_mm;
  // the mass of yarn in one repeat: every pass, at its own feeder's stitch length and count
  let mass = 0;
  for (const ps of g.passes) {
    const fi = ps.course, fd = yf[fi] || yf[0] || {};
    if (ps.yarn.endsWith('p')) continue;                                   // a plated yarn is counted with its feeder below
    const sli = fd.sl_mm > 0 ? fd.sl_mm : sl, tex = fd.tex > 0 ? fd.tex : (out.yarn.ground || {}).tex;
    let len = 0;
    ps.visits.forEach((v) => { if (v.act === 'K') len += sli; else if (v.act === 'T') len += 0.7 * sli; });
    ps.spans.forEach((s) => { if (s.kind === 'float') len += s.float_needles * p; });
    mass += len * tex;
    if (fd.plated && fd.plated.tex > 0) mass += len * fd.plated.tex;
  }
  const w = c.w_l * sl, H = c.H_rep_l * sl;
  if (!(w > 0 && H > 0)) return null;
  const gsm = mass / (g.period.needles * w * H), width = (w * m.needles) / 25.4;
  const dg = gsm / f.gsm - 1, dw = width / f.width_open_in - 1;
  return {
    gsm: Math.round(gsm), width_in: Math.round(width * 10) / 10,
    diff_gsm_pct: Math.round(dg * 1000) / 10, diff_width_pct: Math.round(dw * 1000) / 10,
    agrees: Math.abs(dg) <= AGREE && Math.abs(dw) <= AGREE,
    // with a brick no law covers, the laws' number is incomplete — a difference then says little
    status: c.missing.length ? 'incomplete' : Math.abs(dg) <= AGREE && Math.abs(dw) <= AGREE ? 'agrees' : 'differs',
    laws: c.laws, missing: c.missing,
    basis: 'worked out from the stitches themselves — the yarn each one takes and the cell the brick laws give — with no table of this structure\'s family; the laws\' constants come from plain jersey, 1×1 and 2×2 rib and single piqué',
  };
}

module.exports = { forDesign, constants, AGREE };
