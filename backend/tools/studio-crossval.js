/**
 * Fabric Studio — honest accuracy, by cross-validation on the factory records.
 *
 * The in-sample audit (tools/studio-audit.js) predicts records the constants were
 * fitted on. This tool never does: every constant the Studio derives from the
 * records (Ks, Kw, tightness windows, fibre ratios …) is re-derived WITHOUT the
 * records it then predicts.
 *
 *   k-fold        the records split into 5 folds; each fold is predicted by a
 *                 Studio built from the other 4 — "a cloth like the ones the
 *                 factory makes, that this engine has never seen"
 *   leave-family  every record of one structure family is removed and that family
 *                 is predicted from the rest — "a structure the engine has no
 *                 records for", the honest error of a NEW design
 *
 * Each record is knitted at its own stitch length on its own machine and yarn;
 * the predicted finished GSM and open width are compared with what was measured.
 * Error e = (predicted − measured) / measured. Writes the distribution of e per
 * structure to engine/catalog/studio-accuracy.json, which the Studio reads to put
 * an 80 % range and a hit rate beside every weight and width it gives.
 *
 * What leave-family measures: the family's book value (knit-plan.js) stays — and it is that family's factory median,
 * rounded. So it is the error of a structure predicted from its FAMILY CONSTANT ALONE, which is what a new design
 * in a known family gets in production. With --no-book the book value goes too: a family the Studio has never met
 * (the floor-skip question, tools/floor-skip.js) — that is printed only, never written.
 *
 * Run: node tools/studio-crossval.js        (writes the file)
 *      node tools/studio-crossval.js --dry  (prints only)
 *      node tools/studio-crossval.js --no-book (prints only: families never met)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const B = path.join(__dirname, '..');
const dataset = require(path.join(B, 'engine/catalog/factory-dataset'));
const ALL = dataset.FACTORY_RECORDS.slice();

const FIB = { cotton: 'cotton', cvc: 'cvc', pc: 'polyester_spun', viscose: 'viscose', modal: 'modal' };
const SPIN = { slub: 'carded', combed: 'combed', combed_lycra: 'combed', carded: 'carded', carded_lycra: 'carded', rotor: 'open_end', compact: 'compact' };
/** The Studio structure a record was knitted as. */
function templateOf(r) {
  if (r.fab === 'single_jersey') return 'single_jersey';
  if (r.fab === 'heavy_jersey') return 'heavy_jersey';
  if (r.fab === 'rib') return r.fdia / r.dia < 1.6 ? 'rib_2x2' : 'rib_1x1';
  if (r.fab === 'pique') return 'lacoste_single';
  if (r.fab === 'interlock') return 'interlock';
  if (r.fab === 'fleece') return 'fleece_3_thread';
  if (r.fab === 'waffle') return 'waffle_knit';
  return null;
}
const usable = (r) => templateOf(r) && r.sl > 0 && r.ne > 0 && r.fgsm > 0;
const isLycra = (r) => /lycra/.test(String(r.spin || ''));
const groupOf = (r) => templateOf(r) + (isLycra(r) ? '+L' : '');

/**
 * A Studio built only from `train` (every module that reads the records at load is loaded afresh).
 * `unseen`: a family the Studio must not know. Its "book value" fallback in knit-plan.js is the factory median
 * of that very family, rounded — left in, a "structure with no records" would be predicted from its own records.
 * So it is taken out, and the family falls back the way a truly new one does.
 */
const Module = require('module');
function studioFrom(train, unseen) {
  const R = dataset.FACTORY_RECORDS;
  R.length = 0; train.forEach((r) => R.push(r));
  for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}engine${path.sep}domain${path.sep}`)) delete require.cache[k];
  if (unseen) {
    const kp = path.join(B, 'engine/domain/knit-plan.js');
    const src = fs.readFileSync(kp, 'utf8');
    const strip = (block) => block.replace(new RegExp(`\\b${unseen}: [0-9.]+,?\\s*`), '');
    const code = src.replace(/const BOOK = \{[\s\S]*?\n\};/, (blk) => blk.split('\n').map(strip).join('\n'));
    if (code === src && new RegExp(`\\b${unseen}: [0-9.]+`).test(src.match(/const BOOK = \{[\s\S]*?\n\};/)[0])) throw new Error('could not take the book value out');
    const m = new Module(kp, null); m.filename = kp; m.paths = Module._nodeModulePaths(path.dirname(kp)); m._compile(code, kp); m.loaded = true; require.cache[kp] = m;
  }
  return require(path.join(B, 'engine/domain/fabric-studio'));
}
function restore() {
  const R = dataset.FACTORY_RECORDS;
  R.length = 0; ALL.forEach((r) => R.push(r));
  for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}engine${path.sep}domain${path.sep}`)) delete require.cache[k];
}

/** Predicted finished GSM and open width for one record, or null if the Studio refuses it. */
function predict(S, r) {
  const T = S.listTemplates();
  const t = T.find((x) => x.id === templateOf(r));
  if (!t) return null;
  const rows = (g) => g.map((x) => (x.join ? x.join('') : x));
  let o;
  try {
    o = S.analyse({
      bed: t.grid.D ? 'double' : 'single', gating: t.gating || 'rib', grid: { C: rows(t.grid.C), D: t.grid.D ? rows(t.grid.D) : null },
      feeds: t.roles.map((role) => ({ role })), yarn: { count: r.ne, unit: 'ne', ply: t.id === 'heavy_jersey' ? 2 : 1, fibre: FIB[r.comp] || 'cotton', type: SPIN[r.spin] || 'combed' },
      elastane: isLycra(r) ? { denier: 40, draft: 2.6, every: 'all' } : null,
      machine: { gauge: r.g, dia: r.dia, sl_mm: r.sl }, target: {},
    });
  } catch (_) { return null; }
  if (!o || !o.success) return null;
  return { gsm: o.fabric.gsm, width: o.fabric.width_open_in, level: o.structure.confidence && o.structure.confidence.level };
}

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const r4 = (v) => (v == null ? null : Math.round(v * 10000) / 10000);
/** The distribution of signed relative errors, and how often a prediction lands within ±3/5/8 %. */
function stats(errs) {
  if (!errs.length) return null;
  const abs = errs.map(Math.abs);
  const within = (x) => Math.round((abs.filter((v) => v <= x).length / abs.length) * 1000) / 10;
  return { n: errs.length, bias: r4(errs.reduce((t, v) => t + v, 0) / errs.length), p10: r4(q(errs, 0.1)), p50: r4(q(errs, 0.5)), p90: r4(q(errs, 0.9)), mae_med: r4(q(abs, 0.5)), within_3: within(0.03), within_5: within(0.05), within_8: within(0.08) };
}

function run({ folds = 5, records = ALL, noBook = false } = {}) {
  const use = records.filter(usable);
  const out = { kfold: {}, family: {}, refused: 0, preds: [] };
  const add = (bucket, key, field, e) => { const b = (bucket[key] = bucket[key] || { gsm: [], width: [] }); b[field].push(e); };

  // 1. k-fold: a record is predicted by a Studio that never saw it
  use.forEach((r, i) => { r.__fold = i % folds; });
  for (let f = 0; f < folds; f++) {
    const S = studioFrom(ALL.filter((r) => r.__fold !== f));     // records outside the usable set stay in training, as they do in production
    for (const r of use.filter((x) => x.__fold === f)) {
      const p = predict(S, r); if (!p) { out.refused++; continue; }
      out.preds.push({ r, gsm: p.gsm, width: p.width });
      add(out.kfold, groupOf(r), 'gsm', (p.gsm - r.fgsm) / r.fgsm);
      add(out.kfold, '_all', 'gsm', (p.gsm - r.fgsm) / r.fgsm);
      if (r.fdia > 0) { add(out.kfold, groupOf(r), 'width', (p.width - r.fdia) / r.fdia); add(out.kfold, '_all', 'width', (p.width - r.fdia) / r.fdia); }
    }
  }
  // 2. leave one family out: a structure the engine has no records for
  for (const fam of [...new Set(use.map((r) => r.fab))]) {
    const S = studioFrom(ALL.filter((r) => r.fab !== fam), noBook ? fam : null);
    for (const r of use.filter((x) => x.fab === fam)) {
      const p = predict(S, r); if (!p) { out.refused++; continue; }
      add(out.family, fam, 'gsm', (p.gsm - r.fgsm) / r.fgsm);
      if (r.fdia > 0) add(out.family, fam, 'width', (p.width - r.fdia) / r.fdia);
    }
  }
  restore();
  use.forEach((r) => { delete r.__fold; });

  const summ = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { gsm: stats(v.gsm), width: stats(v.width) }]));
  // a new design: each family counts once, so 1,100 jerseys do not drown out 26 waffles
  const unseen = { gsm: [], width: [] };
  for (const v of Object.values(out.family)) {
    for (const field of ['gsm', 'width']) {
      const a = v[field]; if (!a.length) continue;
      const step = Math.max(1, Math.floor(a.length / 60));
      for (let i = 0; i < a.length; i += step) unseen[field].push(a[i]);
    }
  }
  return {
    generated: new Date().toISOString().slice(0, 10),
    method: `${folds}-fold cross-validation and leave-one-family-out on the factory records; every constant re-derived without the records predicted`,
    records: use.length, refused: out.refused, interval: 0.8,
    groups: summ(out.kfold), unseen: { pooled: { gsm: stats(unseen.gsm), width: stats(unseen.width) }, by_family: summ(out.family) },
    // every record's out-of-fold prediction (not written to the file): the learning check replays them as rolls
    _preds: out.preds,
  };
}

module.exports = { run, stats, templateOf, groupOf, studioFrom, predict, restore };

if (require.main === module) {
  const t0 = Date.now();
  const noBook = process.argv.includes('--no-book');
  const res = run({ noBook });
  const f = (s) => (s ? `${String(s.n).padStart(5)} ${(s.mae_med * 100).toFixed(1).padStart(5)}% ${String(s.within_5).padStart(5)}% ${(s.p10 * 100).toFixed(1).padStart(6)}…${(s.p90 * 100).toFixed(1).padStart(5)}%` : '   —');
  console.log(`${res.records} records, ${res.refused} refused, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log('GROUP (k-fold)'.padEnd(20), 'GSM:  n  |e|med  ±5%   80% band'.padEnd(36), 'WIDTH: n  |e|med  ±5%   80% band');
  for (const [k, v] of Object.entries(res.groups).sort()) console.log(k.padEnd(20), f(v.gsm).padEnd(36), f(v.width));
  console.log('\nNEW STRUCTURE (family left out)');
  for (const [k, v] of Object.entries(res.unseen.by_family).sort()) console.log(k.padEnd(20), f(v.gsm).padEnd(36), f(v.width));
  console.log('pooled'.padEnd(20), f(res.unseen.pooled.gsm).padEnd(36), f(res.unseen.pooled.width));
  if (!process.argv.includes('--dry') && !noBook) {
    const { _preds, ...save } = res;
    fs.writeFileSync(path.join(B, 'engine/catalog/studio-accuracy.json'), JSON.stringify(save, null, 1) + '\n');
    console.log('\nwrote engine/catalog/studio-accuracy.json');
  }
}
