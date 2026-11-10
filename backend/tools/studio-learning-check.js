/**
 * Does learning from a machine's rolls make the next prediction better — and after how many?
 *
 * Replayed on the factory records: each gauge × diameter is taken as one machine
 * and its records, in the order they were made, as its trial rolls. Every record
 * is first predicted out-of-fold (the Studio never saw it — tools/studio-crossval.js);
 * then predicted again with the profile learned from the machine's EARLIER records
 * only (engine/domain/machine-learning.js). The two errors are compared, grouped by
 * how many rolls the machine had logged before.
 *
 * Run: node tools/studio-learning-check.js
 */
'use strict';
const CV = require('./studio-crossval');
const L = require('../engine/domain/machine-learning');

function run() {
  const res = CV.run();
  const G = res.groups;
  const byMachine = {};
  for (const p of res._preds) (byMachine[`${p.r.g}|${p.r.dia}`] = byMachine[`${p.r.g}|${p.r.dia}`] || []).push(p);
  // keep each machine's records in the order of the file (the order they were knitted)
  const order = new Map(require('../engine/catalog/factory-dataset').FACTORY_RECORDS.map((r, i) => [r, i]));
  const buckets = [[0, 0], [1, 2], [3, 5], [6, 9], [10, 1e9]];
  const out = buckets.map(([lo, hi]) => ({ lo, hi, base_gsm: [], learned_gsm: [], base_w: [], learned_w: [], inside80: 0, n: 0 }));
  let machines = 0;
  for (const list of Object.values(byMachine)) {
    if (list.length < 10) continue;
    machines++;
    list.sort((a, b) => order.get(a.r) - order.get(b.r));
    const rolls = [];
    for (const p of list) {
      const fam = CV.groupOf(p.r), cvG = (G[fam] || G._all);
      const prof = L.learnProfile(rolls, { group: fam, ne: p.r.ne, gsmCV: cvG.gsm, widthCV: cvG.width });
      const had = rolls.filter((x) => x.group === fam).length;   // rolls of THIS structure the machine had logged
      const b = out.find((x) => had >= x.lo && had <= x.hi);
      const gL = p.gsm * prof.gsm_factor, wL = p.width * prof.width_factor;
      b.base_gsm.push(Math.abs(p.gsm - p.r.fgsm) / p.r.fgsm); b.learned_gsm.push(Math.abs(gL - p.r.fgsm) / p.r.fgsm);
      if (p.r.fdia > 0) { b.base_w.push(Math.abs(p.width - p.r.fdia) / p.r.fdia); b.learned_w.push(Math.abs(wL - p.r.fdia) / p.r.fdia); }
      const [lo, hi] = L.band(gL, prof.gsm_sd); b.n++; if (p.r.fgsm >= lo && p.r.fgsm <= hi) b.inside80++;
      rolls.push({ group: fam, ne: p.r.ne, gsm_ratio: p.r.fgsm / p.gsm, width_ratio: p.r.fdia > 0 ? p.r.fdia / p.width : null });
    }
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  const within = (a, x) => (a.length ? Math.round((a.filter((v) => v <= x).length / a.length) * 100) : null);
  return {
    machines,
    rows: out.filter((b) => b.n).map((b) => ({
      rolls_before: b.hi >= 1e9 ? `${b.lo}+` : b.lo === b.hi ? `${b.lo}` : `${b.lo}–${b.hi}`, n: b.n,
      gsm_base_med: med(b.base_gsm), gsm_learned_med: med(b.learned_gsm), gsm_base_w5: within(b.base_gsm, 0.05), gsm_learned_w5: within(b.learned_gsm, 0.05),
      width_base_med: med(b.base_w), width_learned_med: med(b.learned_w), width_base_w5: within(b.base_w, 0.05), width_learned_w5: within(b.learned_w, 0.05),
      band80_coverage: Math.round((b.inside80 / b.n) * 100),
    })),
  };
}
module.exports = { run };

if (require.main === module) {
  const r = run();
  const p = (v) => (v == null ? '—' : (v * 100).toFixed(1) + '%');
  console.log(`${r.machines} machines (gauge × diameter with 10+ records), records replayed in order as rolls\n`);
  console.log('rolls before'.padEnd(13), 'n'.padStart(5), '  GSM |err| base → learned   ±5% base → learned    WIDTH |err| base → learned   ±5%      80% band holds');
  for (const x of r.rows) console.log(x.rolls_before.padEnd(13), String(x.n).padStart(5), `   ${p(x.gsm_base_med).padStart(6)} → ${p(x.gsm_learned_med).padStart(6)}      ${String(x.gsm_base_w5).padStart(3)}% → ${String(x.gsm_learned_w5).padStart(3)}%`, `       ${p(x.width_base_med).padStart(6)} → ${p(x.width_learned_med).padStart(6)}   ${x.width_base_w5}% → ${x.width_learned_w5}%`, `     ${x.band80_coverage}%`);
}
