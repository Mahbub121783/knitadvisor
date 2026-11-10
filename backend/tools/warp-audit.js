// Warp studio against published constructions (engine/catalog/warp-literature.js):
// runner per bar, and finished GSM / width from the whole model.
// Run: node tools/warp-audit.js
const W = require('../engine/domain/warp-studio');
const L = require('../engine/catalog/warp-literature');
const st = (a) => { const b = a.map(Math.abs).sort((x, y) => x - y); return `median |err| ${b[Math.floor(b.length / 2)].toFixed(1)}%  p90 ${b[Math.floor(b.length * 0.9)].toFixed(1)}%  bias ${(a.reduce((t, v) => t + v, 0) / a.length).toFixed(1)}%  (n ${a.length})`; };
const e = { runF: [], runB: [], gsm: [], gsmCounts: [], width: [], runE: [], runS: [] };
for (const x of L.NYLON_TRICOT) {
  const ny = { count: x.denier, unit: 'denier', fibre: 'nylon_filament' };
  const r = W.analyse({ machine: { type: 'tricot', gauge: x.gauge, cpc: x.cpc_machine }, bars: [{ notation: x.notations[0], yarn: ny }, { notation: x.notations[1], yarn: ny }], target: {} });
  e.runF.push((r.bars[0].runner_mm_per_rack / x.runner_mm[0] - 1) * 100);
  e.runB.push((r.bars[1].runner_mm_per_rack / x.runner_mm[1] - 1) * 100);
  e.gsm.push((r.fabric.gsm / x.finished.gsm - 1) * 100);
  e.width.push((r.fabric.wpc / x.finished.wpc - 1) * 100);
  // the weight formula alone: measured runners and measured finished counts
  const g = x.finished.wpc * x.finished.cpc * ((x.runner_mm[0] + x.runner_mm[1]) / 480) * (x.denier / 9) / 100;
  e.gsmCounts.push((g / x.finished.gsm - 1) * 100);
}
for (const x of L.ELASTIC_LOCKNIT) {
  const r = W.analyse({ machine: { type: 'tricot', gauge: 32, cpc: x.cpc_machine }, bars: [{ notation: x.notations[0], yarn: { count: 50, unit: 'denier', fibre: 'polyester_filament' } }, { notation: x.notations[1], yarn: { count: 40, unit: 'denier', fibre: 'elastane', draft: x.total_draft / x.beam_draft } }], target: {} });
  e.runE.push((r.bars[0].runner_mm_per_rack / x.runin_mm[0] - 1) * 100);
  e.runS.push((r.bars[1].fed_mm_per_rack / x.runin_mm[1] - 1) * 100);
}
console.log('Nylon tricot (US 4,015,451 / 4,020,654):');
console.log('  front-bar runner     ', st(e.runF));
console.log('  back-bar runner      ', st(e.runB));
console.log('  GSM formula only     ', st(e.gsmCounts), ' (measured runners and counts)');
console.log('  finished GSM, model  ', st(e.gsm));
console.log('  finished wales, model', st(e.width));
console.log('Elastic locknit (US 9,347,157):');
console.log('  front-bar run-in     ', st(e.runE));
console.log('  spandex run-in (fed) ', st(e.runS));
