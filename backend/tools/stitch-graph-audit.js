/**
 * Part 0 audit: every catalogue structure, weft and warp, through the stitch graph.
 *
 * For each one: does it build, does the notation come back unchanged (graph → grid / lapping), is it a
 * steady repeating cloth, and does the graph's verdict agree with the parts that already judge it —
 * the Fabric Studio's "knits as drawn" (weft) and the warp studio's "holds together" (warp)? Where two
 * parts disagree, one of them is wrong: that is what this audit is for.
 *
 * Run: node tools/stitch-graph-audit.js [--all]
 */
'use strict';
const G = require('../engine/domain/stitch-graph');
const F = require('../engine/domain/fabric-studio');
const Wp = require('../engine/domain/warp-studio');

function run() {
  const rows = [];
  for (const t of F.listTemplates()) {
    const rowsOf = (g) => g.map((r) => (Array.isArray(r) ? r.join('') : r));
    const design = { grid: { C: t.grid.C, D: t.grid.D }, gating: t.gating, feeds: t.roles.map((role) => ({ role, plated: !!t.plated })), pile: t.id === 'velour_plush' || t.id === 'terry_fabric' ? 'sinker' : null };
    let g, err = null;
    try { g = G.fromDesign(design); } catch (e) { err = e.message; }
    let studio = null;
    try {
      const o = F.analyse({ bed: t.bed, gating: t.gating, grid: t.grid, feeds: t.roles.map((r) => ({ role: r })), yarn: { count: 30, unit: 'ne', fibre: 'cotton' }, machine: { gauge: 24, dia: 30, sl_mm: 2.7 }, target: {} });
      studio = o.success ? !!o.ok_to_knit : null;
    } catch (_) { studio = null; }
    const back = g ? G.toGrid(g) : null;
    const roundTrip = !!back && back.C.join('|') === rowsOf(t.grid.C).join('|') && (!t.grid.D || (back.D && back.D.join('|') === rowsOf(t.grid.D).join('|')));
    rows.push({ kind: 'weft', id: t.id, built: !err, error: err, round_trip: roundTrip, steady: g ? g.steady : null, graph_knittable: g ? g.stats.knittable : null, studio_knittable: studio,
      stats: g ? g.stats : null, checks: g ? g.checks.filter((c) => c.level !== 'info').map((c) => `${c.level}:${c.code}`) : [] });
  }
  for (const t of Wp.TEMPLATES) {
    const spec = { machine: { type: t.machine, notation_step: t.notation_step }, bars: t.bars.map((b) => ({ notation: b.notation, threading: b.threading })) };
    let g, err = null;
    try { g = G.fromWarp(spec); } catch (e) { err = e.message; }
    const norm = (n) => Wp.parseNotation(n, 1, { step: t.notation_step === 2 ? 2 : 1 }).map((q) => q.join('-')).join('/') + '//';
    const back = g ? G.toLapping(g) : [];
    const roundTrip = !!g && back.every((b, i) => b.notation === norm(t.bars[i].notation));
    // the warp studio's own verdict
    let warpHolds = null;
    try { const a = Wp.analyse({ machine: { type: t.machine, gauge: t.gauge, notation_step: t.notation_step }, bars: t.bars, target: { gsm: t.gsm } }); warpHolds = a.success ? !(a.checks || []).some((c) => c.level === 'error' && /strips|apart|pieces/i.test(c.text)) : null; } catch (_) { warpHolds = null; }
    rows.push({ kind: 'warp', id: t.id, built: !err, error: err, round_trip: roundTrip, steady: g ? g.steady : null, graph_knittable: g ? g.stats.knittable : null, studio_knittable: warpHolds,
      stats: g ? g.stats : null, checks: g ? g.checks.filter((c) => c.level !== 'info').map((c) => `${c.level}:${c.code}`) : [] });
  }
  return rows;
}
module.exports = { run };

if (require.main === module) {
  const rows = run();
  const all = process.argv.includes('--all');
  for (const k of ['weft', 'warp']) {
    const R = rows.filter((r) => r.kind === k);
    const ok = (f) => R.filter(f).length;
    console.log(`${k.toUpperCase()}: ${R.length} structures · built ${ok((r) => r.built)} · notation round-trips ${ok((r) => r.round_trip)} · steady ${ok((r) => r.steady)} · verdict agrees with the existing part ${ok((r) => r.studio_knittable == null || r.graph_knittable === r.studio_knittable)}`);
    for (const r of R) {
      const disagree = r.studio_knittable != null && r.graph_knittable !== r.studio_knittable;
      if (all || !r.built || !r.round_trip || !r.steady || disagree || r.checks.length)
        console.log(`  ${r.id.padEnd(24)} ${r.built ? '' : 'BUILD FAILED: ' + r.error} ${r.round_trip ? '' : 'ROUND-TRIP FAILED '}${disagree ? `DISAGREES (graph ${r.graph_knittable}, existing ${r.studio_knittable}) ` : ''}${r.checks.join(' ')}${r.stats ? `  [loops ${r.stats.loops}, tuck ${r.stats.tuck}, held≤${r.stats.held_max}, float≤${r.stats.float_max}${r.stats.underlap_max != null ? ', underlap≤' + r.stats.underlap_max : ''}]` : ''}`);
    }
  }
}
