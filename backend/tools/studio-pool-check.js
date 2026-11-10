/**
 * Would pooling across mills help a new machine — and can it hurt?
 *
 * There are no real contributing mills yet, so this is a SIMULATION on the factory records, and says so:
 * the gauge × diameter machines are dealt, at random, into 12 "mills"; each mill is held out in turn as
 * the newcomer, and the other 11 contribute to the pool exactly as engine/domain/machine-pool.js would
 * (last 20 rolls per structure, one mean per mill, median, k ≥ 5, clamped). The newcomer's machines are then
 * replayed roll by roll, predicted with (a) the factory model, (b) what the machine itself has learned,
 * (c) the same with the pool as its starting point.
 *
 * Three worlds, because what the pool does depends on whether mills agree with the model:
 *   agree    the records are the truth the model was fitted on — the pool should change nothing
 *   shared   every mill's cloth falls off the model the same way for a structure (±4 %): the pool should find it
 *   own      each mill has its own bias (±4 %) and nothing is shared: the pool should stay out of the way
 *
 * Run: node tools/studio-pool-check.js
 */
'use strict';
const CV = require('./studio-crossval');
const L = require('../engine/domain/machine-learning');
const MP = require('../engine/domain/machine-pool');

const MILLS = 12, SEEDS = 5;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

function run() {
  const res = CV.run(), G = res.groups;
  const order = new Map(require('../engine/catalog/factory-dataset').FACTORY_RECORDS.map((r, i) => [r, i]));
  const byMachine = {};
  for (const p of res._preds) (byMachine[`${p.r.g}|${p.r.dia}`] = byMachine[`${p.r.g}|${p.r.dia}`] || []).push(p);
  const machines = Object.entries(byMachine).filter(([, l]) => l.length >= 10).map(([k, l]) => ({ k, l: l.sort((a, b) => order.get(a.r) - order.get(b.r)) }));
  const groups = [...new Set(res._preds.map((p) => CV.groupOf(p.r)))];
  const worlds = {};

  for (const world of ['agree', 'shared', 'own']) {
    const buckets = [[0, 0], [1, 2], [3, 5], [6, 9], [10, 1e9]].map(([lo, hi]) => ({ lo, hi, base: { g: [], w: [] }, own: { g: [], w: [] }, pool: { g: [], w: [] } }));
    let pooledCells = 0, cellsAll = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(seed * 7919);
      const mill = new Map(); machines.forEach((m) => mill.set(m.k, Math.floor(r() * MILLS)));
      const sharedBias = Object.fromEntries(groups.map((g) => [g, { g: 0.04 * gauss(r), w: 0.04 * gauss(r) }]));
      const ownBias = Array.from({ length: MILLS }, () => Object.fromEntries(groups.map((g) => [g, { g: 0.04 * gauss(r), w: 0.04 * gauss(r) }])));
      const bias = (m, grp) => (world === 'shared' ? sharedBias[grp] : world === 'own' ? ownBias[mill.get(m.k)][grp] : { g: 0, w: 0 });
      // every record of every machine becomes a roll: measured (the world's) ÷ predicted
      const rollsOf = (m) => m.l.map((p) => { const grp = CV.groupOf(p.r), b = bias(m, grp);
        return { p, group: grp, ne: p.r.ne, gsm_ratio: (p.r.fgsm * Math.exp(b.g)) / p.gsm, width_ratio: p.r.fdia > 0 ? (p.r.fdia * Math.exp(b.w)) / p.width : null, meas_g: p.r.fgsm * Math.exp(b.g), meas_w: p.r.fdia > 0 ? p.r.fdia * Math.exp(b.w) : null }; });
      const all = machines.map((m) => ({ m, mill: mill.get(m.k), rolls: rollsOf(m) }));
      for (let h = 0; h < MILLS; h++) {
        // the pool this mill is told: the other mills' rolls, newest first, per mill and structure
        const rows = [];
        for (const x of all) if (x.mill !== h) for (let i = x.rolls.length - 1; i >= 0; i--) rows.push({ user: x.mill, group: x.rolls[i].group, ne: x.rolls[i].ne, gsm_ratio: x.rolls[i].gsm_ratio, width_ratio: x.rolls[i].width_ratio });
        const table = MP.tableFor(MP.aggregate(rows), h);
        cellsAll += 1; if (table) pooledCells += table.gsm.length + table.width.length;
        for (const x of all.filter((y) => y.mill === h)) {
          const seen = [];
          for (const roll of x.rolls) {
            const cvG = G[roll.group] || G._all, ctx = { group: roll.group, ne: roll.ne, gsmCV: cvG.gsm, widthCV: cvG.width };
            const own = L.learnProfile(seen, ctx), pooled = L.learnProfile(seen, { ...ctx, pool: MP.lookup(table, roll.group, roll.ne) });
            const had = seen.filter((s) => s.group === roll.group).length, b = buckets.find((q) => had >= q.lo && had <= q.hi);
            const gErr = (v) => Math.abs(v - roll.meas_g) / roll.meas_g, wErr = (v) => Math.abs(v - roll.meas_w) / roll.meas_w;
            b.base.g.push(gErr(roll.p.gsm)); b.own.g.push(gErr(roll.p.gsm * own.gsm_factor)); b.pool.g.push(gErr(roll.p.gsm * pooled.gsm_factor));
            if (roll.meas_w > 0) { b.base.w.push(wErr(roll.p.width)); b.own.w.push(wErr(roll.p.width * own.width_factor)); b.pool.w.push(wErr(roll.p.width * pooled.width_factor)); }
            seen.push(roll);
          }
        }
      }
    }
    worlds[world] = { pooled_cells_per_mill: Math.round(pooledCells / cellsAll), rows: buckets.filter((b) => b.base.g.length).map((b) => ({ rolls_before: b.hi >= 1e9 ? `${b.lo}+` : b.lo === b.hi ? `${b.lo}` : `${b.lo}–${b.hi}`, n: b.base.g.length,
      gsm: [med(b.base.g), med(b.own.g), med(b.pool.g)], width: [med(b.base.w), med(b.own.w), med(b.pool.w)] })) };
  }
  return { mills: MILLS, seeds: SEEDS, machines: machines.length, worlds };
}
module.exports = { run };

if (require.main === module) {
  const r = run(), p = (v) => (v == null ? '   —  ' : (v * 100).toFixed(2).padStart(5) + '%');
  console.log(`${r.machines} machines dealt into ${r.mills} mills, ${r.seeds} random deals; each mill held out in turn as the newcomer. Median |error|: factory model → own rolls → own rolls + pool\n`);
  for (const [w, v] of Object.entries(r.worlds)) {
    console.log(`world "${w}"  (the pool offers ${v.pooled_cells_per_mill} cells to a newcomer)`);
    console.log('  rolls before'.padEnd(15), 'n'.padStart(6), '   GSM: model → own → +pool           WIDTH: model → own → +pool');
    for (const x of v.rows) console.log('  ' + x.rolls_before.padEnd(13), String(x.n).padStart(6), '  ', x.gsm.map(p).join(' → '), '     ', x.width.map(p).join(' → '));
    console.log('');
  }
}
