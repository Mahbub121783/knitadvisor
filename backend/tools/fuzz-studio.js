/**
 * Fabric Studio fuzz: thousands of random designs through every engine and every export, looking for what must never happen —
 * a throw, a NaN or Infinity in a number, an engine failing silently, a verdict that contradicts itself, a different answer for the same input,
 * a design that does not survive its own export (DNA round trip, cam-sheet round trip, programme bitmap).
 *
 *   node tools/fuzz-studio.js [count] [seed]
 * The same seed gives the same designs. Used by tests/studio_fuzz.test.js with a small count; run it long (e.g. 5000) after an engine change.
 */
'use strict';
const S = require('../engine/domain/fabric-studio');
const DNA = require('../engine/domain/fabric-dna');
const CS = require('../engine/domain/cam-sheet');
const MX = require('../engine/domain/machine-export');
const DS = require('../engine/domain/dev-sheet');

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const FIB = ['cotton', 'cvc', 'polyester_spun', 'viscose', 'modal', 'wool', 'acrylic', 'linen', 'silk', 'polyester_filament', 'nylon_filament', 'polypropylene'];

function randomDesign(R) {
  const pick = (a) => a[Math.floor(R() * a.length)];
  const wgt = (pairs) => { let t = pairs.reduce((s, p) => s + p[1], 0), x = R() * t; for (const [v, w] of pairs) { if ((x -= w) < 0) return v; } return pairs[0][0]; };
  const bed = wgt([['single', 5], ['rib', 3], ['interlock', 2]]);
  const F = 1 + Math.floor(R() * 10), W = (bed === 'interlock' ? 2 : 1) * (1 + Math.floor(R() * 5));
  const sym = (dbl) => wgt(dbl ? [['K', 6], ['T', 1.5], ['M', 2], ['-', 0.3], ['R', 0.3]] : [['K', 6], ['T', 1.5], ['M', 2], ['E', 0.2], ['-', 0.2]]);
  const C = Array.from({ length: F }, () => Array.from({ length: W }, () => sym(false)).join(''));
  let D = null;
  if (bed !== 'single') D = Array.from({ length: F }, () => Array.from({ length: W }, () => sym(true)).join(''));
  // most designs are repaired into ones that CAN knit (every feed knits somewhere, every needle knits somewhere, no facing needles rise together on an interlock):
  // the engines' deeper paths only run on those
  if (R() < 0.75) {
    const g = C.map((r) => r.split('')), h = D ? D.map((r) => r.split('')) : null;
    for (let w = 0; w < W; w++) if (!g.some((r) => r[w] === 'K')) g[Math.floor(R() * F)][w] = 'K';
    for (let f = 0; f < F; f++) if (!g[f].includes('K')) g[f][Math.floor(R() * W)] = 'K';
    if (h) {
      for (let w = 0; w < W; w++) if (!h.some((r) => r[w] === 'K')) h[Math.floor(R() * F)][w] = 'K';
      if (bed === 'interlock') for (let f = 0; f < F; f++) for (let w = 0; w < W; w++) if (/[KT]/.test(g[f][w]) && /[KT]/.test(h[f][w])) h[f][w] = 'M';
      if (bed === 'interlock') for (let w = 0; w < W; w++) if (!h.some((r) => r[w] === 'K')) { const f = g.findIndex((r) => !/[KT]/.test(r[w])); if (f >= 0) h[f][w] = 'K'; }
    }
    C.splice(0, F, ...g.map((r) => r.join(''))); if (D && h) D.splice(0, F, ...h.map((r) => r.join('')));
  }
  const filament = (f) => /filament/.test(f);
  const fibre = pick(FIB), ne = filament(fibre) ? pick([50, 75, 100, 150]) : pick([16, 20, 24, 26, 30, 32, 40]);
  const feeds = Array.from({ length: F }, () => ({ role: wgt([['ground', 8], ['face', 1], ['binder', 1], ['loop', 1]]), ...(R() < 0.25 ? { colour: pick(['A', 'B', 'C', 'D']) } : {}) }));
  const d = {
    bed: bed === 'single' ? 'single' : 'double', gating: bed === 'interlock' ? 'interlock' : bed === 'rib' ? 'rib' : undefined, grid: { C, D }, feeds,
    yarn: { fibre, count: ne, unit: filament(fibre) ? 'denier' : 'ne' }, target: { gsm: Math.round(90 + R() * 330) }, machine: R() < 0.4 ? { gauge: pick([14, 18, 20, 24, 28, 32]), dia: pick([26, 30, 34]) } : {},
    elastane: R() < 0.2 && fibre !== 'polypropylene' ? { denier: pick([20, 40, 70]), draft: 2.6, every: pick(['all', 'alternate']) } : null,
    core_engines: true,
  };
  if (R() < 0.3) {
    d.stripes = { sequence: pick(['A2 B2', 'A1 B1 C1', 'A3 B1', 'A4 B2 C2', 'A1 B1 A1 B1', 'A12mm B4mm', 'A8mm B3.5mm C2mm B3.5mm', 'A1cm B4mm', 'A6 B2 A6 B2 C1', 'A10 B4 C2 B4', 'A0.5mm B30mm']) };
    if (R() < 0.3) d.stripes.panel_cm = pick([40, 55.5, 70, 85]);
    if (R() < 0.15) d.stripes.measured = { repeat_mm: pick([5, 12, 22.5, 40]) };
    if (R() < 0.15) d.stripes.height_state = pick(['dry', 'wet', 'finished', 'full']);
    if (R() < 0.2) d.machine = { ...d.machine, feeders: pick([12, 24, 30, 36, 48, 72]) };
  }
  if (R() < 0.15) d.finish = { brush: pick(['face', 'back', 'both']) };
  if (R() < 0.2) d.colourway = { colours: { A: '#0b1f4a', B: '#efe6d2', C: '#b3202a', D: '#e8c32a' }, order: { kg: 300 } };
  return d;
}

const walk = (o, path, fn) => { if (o === null || o === undefined) return; if (typeof o === 'number') return fn(o, path); if (typeof o !== 'object') return; if (Array.isArray(o)) { o.forEach((v, i) => walk(v, path + '[' + i + ']', fn)); return; } for (const k of Object.keys(o)) if (k !== '_design') walk(o[k], path + '.' + k, fn); };
const raw = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? '__NONFINITE__' : v));

function fuzz(count, seed, opt = {}) {
  const R = rng(seed), bad = {}, add = (k, id, txt) => { (bad[k] = bad[k] || []).push(`#${id} ${txt}`); };
  const stat = { designs: 0, refused: 0, knits: 0, wontKnit: 0, exportsChecked: 0 };
  for (let i = 0; i < count; i++) {
    const d = randomDesign(R); stat.designs++;
    let r;
    try { r = S.analyse(d); } catch (e) { if (e && e.name === 'StudioError') { stat.refused++; continue; } add('THROW', i, `${e.name}: ${String(e.message).slice(0, 110)} :: ${JSON.stringify(d.grid).slice(0, 80)}`); continue; }
    if (!r.success) { stat.refused++; if (!r.error) add('REFUSED_WITHOUT_REASON', i, ''); continue; }
    // numbers: never NaN / Infinity (they serialise to null and hide)
    // (a design that does not knit has no physical state: its dependent numbers may be undefined, and the verdict already says so)
    const s = raw(r); if (r.ok_to_knit && s.includes('__NONFINITE__')) { let at = ''; walk(r, '', (v, p) => { if (!Number.isFinite(v) && !at) at = p; }); add('NONFINITE_NUMBER', i, at); }
    if (r.engine_faults && r.engine_faults.length) add('ENGINE_FAULT', i, JSON.stringify(r.engine_faults).slice(0, 140));
    // the verdict says what the checks say
    const errs = r.checks.filter((c) => c.level === 'error').length;
    if ((errs > 0) === r.ok_to_knit) add('VERDICT_CONTRADICTS_CHECKS', i, `errors ${errs}, ok_to_knit ${r.ok_to_knit}`);
    r.ok_to_knit ? stat.knits++ : stat.wontKnit++;
    // the programme as analysed is what was drawn (repeat reduced): no symbol invented
    const syms = new Set(); [r.structure.beds.C, r.structure.beds.D].filter(Boolean).forEach((g) => g.forEach((row) => row.forEach((x) => syms.add(x))));
    const drawn = new Set((d.grid.C.join('') + (d.grid.D ? d.grid.D.join('') : '')).split(''));
    for (const x of syms) if (!drawn.has(x) && x !== '-') add('SYMBOL_INVENTED', i, x);
    // the engineering stripe: whatever stripe is asked, its answer is whole, finite and agrees with the machine plan
    if (r.stripe_engineering) {
      const se = r.stripe_engineering;
      if (se.success !== true) add('STRIPE_NOT_SUCCESS', i, '');
      else {
        if (r.machine_setup.stripes && se.machine.method !== r.machine_setup.stripes.method) add('STRIPE_METHOD_DISAGREES', i, `${se.machine.method} vs ${r.machine_setup.stripes.method}`);
        for (const h of se.heights) if (Math.abs(h.runs.reduce((t, x) => t + x.mm, 0) - h.repeat_mm) > 0.2 + 0.01 * h.runs.length) add('STRIPE_HEIGHTS_DO_NOT_ADD', i, `${h.state} ${h.repeat_mm}`);
        if (se.fit && se.fit.runs.some((x) => !(x.feeds >= 1))) add('STRIPE_FIT_EMPTY_RUN', i, '');
        if (se.fit && Math.abs(se.fit.repeat_mm - se.fit.repeat_asked_mm) > 1.5 * 10 / (se.heights[0].cpc) + 0.02) add('STRIPE_FIT_REPEAT_DRIFT', i, `${se.fit.repeat_mm} vs ${se.fit.repeat_asked_mm}`);
      }
    }
    // the same input, the same answer
    if (i % 5 === 0) { const r2 = S.analyse(d); if (raw({ ...r, engine_faults: 0 }) !== raw({ ...r2, engine_faults: 0 })) add('NOT_DETERMINISTIC', i, ''); }
    // a design that knits survives its exports
    if (r.ok_to_knit && i % 3 === 0) {
      try {
        stat.exportsChecked++;
        MX.csv(r, 'fuzz');
        const P = MX.programme(r, 'C', 'repeat'); MX.png(P, 1); MX.bmp(P, 1);
        if (r.structure.beds.D) { const PD = MX.programme(r, 'D', 'repeat'); MX.png(PD, 1); }
        if (r.colourway && r.colourway.motif) { MX.png(MX.motifProgramme(r, 'face'), 1); MX.colourCsv(r, 'fuzz'); }
        const dna = DNA.toDNA(d, r); if (!dna || !dna.unitCell) add('DNA_EMPTY', i, '');
        else { const back = DNA.fromDNA(dna); if (!back || !back.input || !back.input.grid || !back.input.grid.C) add('DNA_ROUNDTRIP_EMPTY', i, ''); }
        // the cam sheet of the analysed programme reads back to the same programme
        if (r.setup && r.setup.tracks && r.setup.tracks.C && !r.structure.beds.D) {
          const sheet = CS.sheetOf(r.structure.beds.C);
          if (sheet && sheet.needles && sheet.tracks) {
            const back = CS.build({ tracks: sheet.tracks, needles: sheet.needles.join(' '), legend: 'letters' });
            const a = r.structure.beds.C.map((row) => row.join('').replace(/[ER]/g, 'M')), b = back.C.map((row) => row.join(''));
            if (a.length === b.length && a.some((row, k) => row !== b[k] && !/[-]/.test(row))) add('CAMSHEET_ROUNDTRIP', i, `${a.join('/')} vs ${b.join('/')}`);
          }
        }
        if (r.stripe_engineering) MX.stripeCsv(r, 'fuzz');
        if (i % 9 === 0) DS.build({ design: d, composition: '100% CO', gsm: d.target.gsm, shade: 'medium' }, S.analyse);
      } catch (e) {
        if (!/StudioError|SheetError|DnaError|ExportError/.test(e.name || e.constructor.name)) add('EXPORT_THROW', i, `${e.name}: ${String(e.message).slice(0, 110)}`);
      }
    }
  }
  return { stat, bad };
}

module.exports = { fuzz, randomDesign };
if (require.main === module) {
  const n = +process.argv[2] || 1000, seed = +process.argv[3] || 20261125;
  const t0 = Date.now(), { stat, bad } = fuzz(n, seed);
  console.log(JSON.stringify(stat), ((Date.now() - t0) / 1000).toFixed(1) + 's');
  Object.keys(bad).forEach((k) => console.log(`\n## ${k} (${bad[k].length})\n  ` + bad[k].slice(0, 6).join('\n  ')));
  if (!Object.keys(bad).length) console.log('clean');
  process.exitCode = Object.keys(bad).length ? 1 : 0;
}
