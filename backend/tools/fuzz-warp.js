/**
 * Warp Studio fuzz: thousands of random lappings, yarns and machines through every warp engine and every export, looking for what must never happen —
 * a throw, a NaN or Infinity in a number, a verdict that contradicts its checks, a different answer for the same input, an engine failing silently.
 *
 *   node tools/fuzz-warp.js [count] [seed]
 */
'use strict';
const W = require('../engine/domain/warp-studio');

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const FIBRES = ['nylon_filament', 'polyester_filament', 'elastane', 'polypropylene', 'cotton', 'polyester_spun', 'viscose', 'polyester_mono', 'nylon_mono'];

function randomDesign(R) {
  const pick = (a) => a[Math.floor(R() * a.length)];
  const type = pick(['tricot', 'tricot', 'raschel', 'raschel', 'double_raschel']);
  const dnb = type === 'double_raschel';
  const nBars = dnb ? 3 + Math.floor(R() * 4) : 1 + Math.floor(R() * 5);
  const needles = 1 + Math.floor(R() * 5);
  const step = R() < 0.15 ? 2 : 1;
  const bars = [];
  for (let b = 0; b < nBars; b++) {
    const courses = (dnb ? 2 : 1) * (1 + Math.floor(R() * 4));
    const pairs = [];
    let at = Math.floor(R() * 3);
    for (let c = 0; c < courses; c++) {
      const kind = R();
      let a = at, z;
      if (kind < 0.12) z = a;                                    // no swing (inlay or rest)
      else if (kind < 0.55) z = Math.max(0, a + (R() < 0.5 ? 1 : -1));
      else z = Math.max(0, a + pick([-2, 2, 1, -1]));
      pairs.push([a, z]);
      at = Math.max(0, z + pick([-3, -2, -1, 0, 1, 2, 3, 4]));
    }
    const fibre = pick(FIBRES);
    const mono = /mono/.test(fibre);
    const yarn = mono ? { count: pick([0.1, 0.15, 0.2, 0.3]), unit: 'mm', fibre } : fibre === 'cotton' || fibre === 'polyester_spun' || fibre === 'viscose' ? { count: pick([20, 30, 40]), unit: 'ne', fibre } : { count: pick([20, 30, 40, 70, 150, 300]), unit: 'denier', fibre, ...(R() < 0.3 ? { filaments: pick([1, 13, 24, 48]) } : {}), ...(fibre === 'elastane' ? { draft: pick([1.5, 2, 2.6, 3.4]) } : {}) };
    const bar = { notation: pairs.map((q) => (step === 2 ? q.map((x) => x * 2) : q).join('-')).join('/') + '//', yarn };
    if (R() < 0.3) bar.threading = pick(['X.', '.X', 'X..', 'XX.', 'X.X.']);
    bars.push(bar);
  }
  const d = {
    machine: { type, gauge: pick([12, 18, 22, 24, 28, 32, 36, 40]), ...(dnb ? { gap: undefined, gap_mm: pick([2, 5, 10, 20]) } : {}), ...(step === 2 ? { notation_step: 2 } : {}), ...(R() < 0.3 ? { speed_cpm: pick([400, 900, 1500, 2400, 3200]), efficiency: pick([70, 85, 92]) } : {}) },
    bars, target: R() < 0.7 ? { gsm: Math.round(15 + R() * 500) } : {},
    core_engines: true,
  };
  if (!d.target.gsm) d.machine.cpc = pick([8, 12, 18, 24, 30, 40]);
  if (R() < 0.15) d.target.width_in = pick([40, 60, 90, 130]);
  if (R() < 0.2) d.beams = { flange_in: pick([21, 30]), barrel_in: pick([7, 8]) };
  return d;
}

const walk = (o, path, fn) => { if (o === null || o === undefined) return; if (typeof o === 'number') return fn(o, path); if (typeof o !== 'object') return; if (Array.isArray(o)) { o.forEach((v, i) => walk(v, path + '[' + i + ']', fn)); return; } for (const k of Object.keys(o)) walk(o[k], path + '.' + k, fn); };
const raw = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? '__NONFINITE__' : v));

/** the default per-design checks: the engines beyond the loop answer whole, agree with the loop, and a design that is not locked survives its exports */
function eachDesign(d, r, i, add) {
  if (!r.chemistry || !r.states || !r.drive || !r.gates || !r.open_area) { add('MISSING_PART', i, ['chemistry', 'states', 'drive', 'gates', 'open_area'].filter((k) => !r[k]).join(',')); return false; }
  if (r.chemistry.success === false) add('CHEMISTRY_FAILED', i, r.chemistry.error);
  // the states follow one density: gsm × area is the same mass
  const fin = r.states.states.find((x) => x.state === 'finished');
  if (fin.gsm !== r.fabric.gsm || fin.width_in !== r.fabric.width_in) add('STATE_FINISHED_DISAGREES', i, `${fin.gsm}/${r.fabric.gsm} ${fin.width_in}/${r.fabric.width_in}`);
  const g = r.states.states.find((x) => x.state === 'greige');
  if (g.width_in > fin.width_in + 0.2) add('GREIGE_WIDER_THAN_FINISHED', i, `${g.width_in} vs ${fin.width_in}`);
  if (!(r.open_area.open_area_pct >= 0 && r.open_area.open_area_pct <= 100)) add('OPEN_AREA_RANGE', i, String(r.open_area.open_area_pct));
  const links = r.drive.bars.reduce((t, b) => t + b.chain_links, 0);
  if (links !== r.drive.chain_links_total) add('CHAIN_LINKS_DISAGREE', i, `${links} vs ${r.drive.chain_links_total}`);
  if ((r.gates.verdict === 'fatal') !== (r.gates.counts.fatal > 0)) add('GATE_VERDICT', i, '');
  if (r.ok_to_knit && !r.gates.export_locked && i % 4 === 0) {
    const X = require('../engine/domain/warp-export');
    try { X.lappingCsv(r, 'fuzz'); if (i % 8 === 0) { const doc = X.sheet(r, { name: 'fuzz' }); doc.on('data', () => {}); doc.end(); } } catch (e) { add('EXPORT_THROW', i, `${e.name}: ${String(e.message).slice(0, 100)}`); }
    return true;
  }
  return false;
}

function fuzz(count, seed, hooks = {}) {
  const R = rng(seed), bad = {}, add = (k, id, txt) => { (bad[k] = bad[k] || []).push(`#${id} ${txt}`); };
  const stat = { designs: 0, refused: 0, knits: 0, wontKnit: 0, exportsChecked: 0 };
  const analyse = hooks.analyse || W.analyse, each = hooks.each || eachDesign;
  for (let i = 0; i < count; i++) {
    const d = randomDesign(R); stat.designs++;
    let r;
    try { r = analyse(d); } catch (e) { add('THROW', i, `${e.name}: ${String(e.message).slice(0, 110)} :: ${JSON.stringify(d.bars.map((b) => b.notation)).slice(0, 100)}`); continue; }
    if (!r.success) { stat.refused++; if (!r.error) add('REFUSED_WITHOUT_REASON', i, ''); continue; }
    const s = raw(r);
    if (s.includes('__NONFINITE__')) { let at = ''; walk(r, '', (v, p) => { if (!Number.isFinite(v) && !at) at = p; }); add('NONFINITE_NUMBER', i, at); }
    if (r.engine_faults && r.engine_faults.length) add('ENGINE_FAULT', i, JSON.stringify(r.engine_faults).slice(0, 140));
    const errs = r.checks.filter((c) => c.level === 'error').length;
    if ((errs > 0) === r.ok_to_knit) add('VERDICT_CONTRADICTS_CHECKS', i, `errors ${errs}, ok_to_knit ${r.ok_to_knit}`);
    r.ok_to_knit ? stat.knits++ : stat.wontKnit++;
    if (i % 5 === 0) { const r2 = analyse(d); if (raw({ ...r, engine_faults: 0 }) !== raw({ ...r2, engine_faults: 0 })) add('NOT_DETERMINISTIC', i, ''); }
    if (r.ok_to_knit || true) { const t = each(d, r, i, add, stat); if (t) stat.exportsChecked++; }
  }
  return { stat, bad };
}

module.exports = { fuzz, randomDesign };
if (require.main === module) {
  const n = +process.argv[2] || 1000, seed = +process.argv[3] || 20261124;
  const t0 = Date.now(), { stat, bad } = fuzz(n, seed);
  console.log(JSON.stringify(stat), ((Date.now() - t0) / 1000).toFixed(1) + 's');
  Object.keys(bad).forEach((k) => console.log(`\n## ${k} (${bad[k].length})\n  ` + bad[k].slice(0, 6).join('\n  ')));
  if (!Object.keys(bad).length) console.log('clean');
  process.exitCode = Object.keys(bad).length ? 1 : 0;
}
