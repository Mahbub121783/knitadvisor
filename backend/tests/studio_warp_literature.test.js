// Warp studio checked on published constructions (engine/catalog/warp-literature.js):
// the runner each bar needs, and the weight formula. The limits are a little
// above today's errors, so a change that makes the model worse fails here.
const assert = require('assert');
const W = require('../engine/domain/warp-studio');
const L = require('../engine/catalog/warp-literature');
console.log('--- Running Warp Literature Tests ---');

const med = (a) => { const b = a.map(Math.abs).sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const runF = [], runB = [], wf = [], runE = [], runS = [];
for (const x of L.NYLON_TRICOT) {
  const ny = { count: x.denier, unit: 'denier', fibre: 'nylon_filament' };
  const r = W.analyse({ machine: { type: 'tricot', gauge: x.gauge, cpc: x.cpc_machine }, bars: [{ notation: x.notations[0], yarn: ny }, { notation: x.notations[1], yarn: ny }], target: {} });
  assert(r.success, x.id);
  runF.push((r.bars[0].runner_mm_per_rack / x.runner_mm[0] - 1) * 100);
  runB.push((r.bars[1].runner_mm_per_rack / x.runner_mm[1] - 1) * 100);
  wf.push(((x.finished.wpc * x.finished.cpc * ((x.runner_mm[0] + x.runner_mm[1]) / 480) * (x.denier / 9) / 100) / x.finished.gsm - 1) * 100);
}
for (const x of L.ELASTIC_LOCKNIT) {
  const r = W.analyse({ machine: { type: 'tricot', gauge: 32, cpc: x.cpc_machine }, bars: [{ notation: x.notations[0], yarn: { count: 50, unit: 'denier', fibre: 'polyester_filament' } }, { notation: x.notations[1], yarn: { count: 40, unit: 'denier', fibre: 'elastane', draft: x.total_draft, beam_draft: x.beam_draft } }], target: {} });
  runE.push((r.bars[0].runner_mm_per_rack / x.runin_mm[0] - 1) * 100);
  runS.push((r.bars[1].fed_mm_per_rack / x.runin_mm[1] - 1) * 100);
}
assert(med(runF) < 6, `nylon tricot front-bar runner: median ${med(runF).toFixed(1)}%`);
assert(med(runB) < 6, `nylon tricot back-bar runner: median ${med(runB).toFixed(1)}%`);
assert(med(wf) < 8, `weight formula on measured runners and counts: median ${med(wf).toFixed(1)}%`);
assert(med(runE) < 6, `elastic locknit front-bar run-in: median ${med(runE).toFixed(1)}%`);
assert(med(runS) < 7, `elastic locknit spandex run-in: median ${med(runS).toFixed(1)}%`);
// the published locknit run-in ratio, front : back ≈ 4 : 3, on a rigid locknit
{
  const ny = { count: 40, unit: 'denier', fibre: 'nylon_filament' };
  const r = W.analyse({ machine: { type: 'tricot', gauge: 28, cpc: 22 }, bars: [{ notation: '2-3/1-0//', yarn: ny }, { notation: '1-0/1-2//', yarn: ny }], target: {} });
  const ratio = r.bars[0].runner_mm_per_rack / r.bars[1].runner_mm_per_rack;
  assert(ratio > 1.2 && ratio < 1.5, `locknit run-in ratio ${ratio.toFixed(2)} (published ≈ 1.33)`);
}
console.log(`Warp literature tests passed (runner medians: nylon ${med(runF).toFixed(1)} / ${med(runB).toFixed(1)}%, elastic ${med(runE).toFixed(1)} / ${med(runS).toFixed(1)}%)`);
