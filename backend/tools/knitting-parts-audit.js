/**
 * Parts 3–5 audit: every catalogue weft structure through machine → formation → consumption at a usual
 * setting (30s combed cotton, 24 GG × 30", 2.7 mm), set against the Studio's own course lengths.
 *
 * Where the two disagree one of them holds a rule the other does not — the audit prints the size of it:
 *   single-bed floats   the Studio counts 1.1 needle pitch per missed needle; part 5 the straight pitch
 *   double-bed misses   the Studio counts nothing; part 5 counts the run across a needle of the same bed
 *                       the yarn skips between two of its loops (a float behind the other bed)
 * One yarn-length meter reading on such a feed settles which is right.
 *
 * Run: node tools/knitting-parts-audit.js
 */
'use strict';
const G = require('../engine/domain/stitch-graph');
const M = require('../engine/domain/materials');
const P = require('../engine/domain/knitting-parts');
const F = require('../engine/domain/fabric-studio');

function run() {
  const y = M.yarn({ count: 30, unit: 'ne', spinning: 'combed' });
  const rows = [];
  for (const t of F.listTemplates()) {
    const o = F.analyse({ bed: t.bed, gating: t.gating, grid: t.grid, feeds: t.roles.map((r) => ({ role: r })), yarn: { count: 30, unit: 'ne', fibre: 'cotton' }, machine: { gauge: 24, dia: 30, sl_mm: 2.7 }, target: {} });
    const g = G.fromDesign({ grid: t.grid, gating: t.gating, feeds: t.roles.map((r) => ({ role: r })) });
    const m = P.machine({ gauge: 24, dia: 30 }, g);
    const fo = P.formation(g, y, m, { sl_mm: 2.7 });
    const sl = o.success ? o.fabric.sl_mm : 2.7;
    const cs = P.consumption(g, y, m, { sl_mm: sl });
    const comparable = o.success && !o.plush && o.yarn.feeds.length === cs.feeds.length && !o.yarn.feeds.some((f) => Math.abs(f.sl_mm - sl) > 1e-9);
    const ours = cs.feeds.reduce((a, f) => a + f.course_length.value, 0), studio = comparable ? o.yarn.feeds.reduce((a, f) => a + f.course_length_m, 0) : null;
    const floats = g.passes.some((x) => x.spans.some((s) => s.kind === 'float'));
    rows.push({ id: t.id, double: !!t.grid.D, floats, tension_cN: Math.max(...fo.feeds.map((f) => (f.peak_tension ? f.peak_tension.value : 0))), hook_fill: Math.max(...fo.feeds.map((f) => f.hook_fill.value)),
      checks: [...new Set(fo.checks.map((c) => `${c.level}:${c.code}`))], course_length_diff_pct: studio ? Math.round((ours / studio - 1) * 1000) / 10 : null });
  }
  return rows;
}
module.exports = { run };

if (require.main === module) {
  const rows = run();
  const cmp = rows.filter((r) => r.course_length_diff_pct != null);
  console.log(`${rows.length} structures · course length compared on ${cmp.length}: same (±0.5 %) ${cmp.filter((r) => Math.abs(r.course_length_diff_pct) <= 0.5).length}`);
  for (const r of rows) if (r.checks.length || (r.course_length_diff_pct != null && Math.abs(r.course_length_diff_pct) > 0.5))
    console.log(`  ${r.id.padEnd(22)} ${r.double ? 'double' : 'single'}${r.floats ? ' floats' : ''}  course length ${r.course_length_diff_pct > 0 ? '+' : ''}${r.course_length_diff_pct}% vs Studio  tension ≤${r.tension_cN} cN  hook ≤${Math.round(r.hook_fill * 100)}%  ${r.checks.join(' ')}`);
}
