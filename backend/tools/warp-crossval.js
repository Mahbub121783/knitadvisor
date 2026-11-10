/**
 * Warp Studio — honest accuracy on the published nylon tricots, leave-one-out.
 *
 * The finished-state factors (finished wales and courses ÷ the machine's) are medians of the
 * 15 published nylon tricots. Here each tricot is predicted with factors taken from the
 * OTHER 14 only, at its own gauge, lapping and machine quality; its finished GSM and wales/cm
 * are compared with what the patent measured. (The needle-wrap constant was fitted once on
 * all 31 constructions — one number, small leakage, said so in the file.)
 *
 * Writes engine/catalog/warp-accuracy.json. Raschel, powernet, spacer and elastic tricot have
 * no published finished cloth to check against, and the file says so rather than inventing a range.
 *
 * Run: node tools/warp-crossval.js [--dry]
 */
'use strict';
const path = require('path');
const fs = require('fs');
const W = require('../engine/domain/warp-studio');
const L = require('../engine/catalog/warp-literature');
const { stats } = require('./studio-crossval');

const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = (s.length - 1) / 2; return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2; };

function run() {
  // the factors each record carries: finished wales ÷ machine wales (E/2.54), finished courses ÷ machine courses
  const recs = L.NYLON_TRICOT.map((x) => ({ x, kw: x.finished.wpc / (x.gauge / 2.54), kc: x.finished.cpc / x.cpc_machine }));
  const M = W.MACHINES.tricot;
  const gsm = [], wales = [];
  for (const r of recs) {
    const others = recs.filter((o) => o !== r);
    const kw = med(others.map((o) => o.kw)), kc = med(others.map((o) => o.kc));
    const ny = { count: r.x.denier, unit: 'denier', fibre: 'nylon_filament' };
    const a = W.analyse({ machine: { type: 'tricot', gauge: r.x.gauge, cpc: r.x.cpc_machine }, bars: [{ notation: r.x.notations[0], yarn: ny }, { notation: r.x.notations[1], yarn: ny }], target: {} });
    // the model's GSM scales with kw × kc and its wales with kw: re-state it with the leave-one-out factors
    const g = a.fabric.gsm * (kw * kc) / (M.kw * M.kc);
    const wpc = a.fabric.wpc * kw / M.kw;
    gsm.push((g - r.x.finished.gsm) / r.x.finished.gsm);
    wales.push((wpc - r.x.finished.wpc) / r.x.finished.wpc);
  }
  // width follows 1 / wales: a wales error e is a width error of 1/(1+e) − 1
  const width = wales.map((e) => 1 / (1 + e) - 1);
  return {
    generated: new Date().toISOString().slice(0, 10),
    method: 'leave-one-out on 15 published nylon tricots: each predicted with finished-state factors from the other 14 (the needle-wrap constant was fitted once on all 31 published constructions)',
    tricot: { gsm: stats(gsm), width: stats(width) },
    not_checked: 'Raschel, powernet, nets, spacer and elastic tricot: no published or factory finished cloth to check against yet — their weight and width are modelled.',
  };
}
module.exports = { run };

if (require.main === module) {
  const r = run();
  const f = (s) => `n ${s.n} · typical ${(s.mae_med * 100).toFixed(1)}% · ±5% ${s.within_5}% · ±8% ${s.within_8}% · 80% band ${(s.p10 * 100).toFixed(1)}…${(s.p90 * 100).toFixed(1)}%`;
  console.log('tricot GSM  ', f(r.tricot.gsm));
  console.log('tricot width', f(r.tricot.width));
  if (!process.argv.includes('--dry')) { fs.writeFileSync(path.join(__dirname, '../engine/catalog/warp-accuracy.json'), JSON.stringify(r, null, 1) + '\n'); console.log('wrote engine/catalog/warp-accuracy.json'); }
}
