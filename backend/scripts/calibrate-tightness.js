#!/usr/bin/env node
/**
 * Re-derive the tightness-factor bands from the real production records.
 *
 *   node scripts/calibrate-tightness.js           # report the fit of the current bands
 *   node scripts/calibrate-tightness.js --propose # print the block to paste into formulas/yarn.js
 *
 * TIGHTNESS_LIMITS decides whether a construction is reported as knittable,
 * warned, or refused. It is the most consequential table in the system that is
 * neither a formula nor a measurement, and it drifted once already: the ideal
 * band was documented as the 25th–75th percentile, which flags half of all real
 * production by construction, and on interlock that meant 76% of genuinely
 * produced fabric came back warned as "too loose".
 *
 * A constant that is claimed to be derived from data should be derivable from
 * data on demand. Run this after factory_records grows and paste the proposal.
 *
 * METHOD
 *   TF          = sqrt(Tex) / SL_cm, with Tex = 590.5 / Ne, from each record's
 *                 own ne and sl — the same pairing the engine uses at runtime
 *   min / max   = the observed extremes with 1 unit of margin. NOT a
 *                 percentile: this tier decides whether something is reported
 *                 UNKNITTABLE, and a statistical tail is not a physical limit.
 *                 Set to p2/p98 it declared 4% of genuinely shipped fabric
 *                 impossible. Real production defines what is possible.
 *   ideal band  = p10 / p90, rounded outward to 0.5 — "is this normal?", which
 *                 most real work should answer yes to.
 *
 * Records whose stitch length is shorter than their own needle pitch
 * (25.4 / gauge) are excluded from the extremes. A loop cannot be shorter than
 * the pitch it spans, so those are measurement errors rather than tight
 * fabric — two rows, both 18 GG at ~1.05 mm against a 1.41 mm pitch, and they
 * alone pushed rib's ceiling from 30 to 41. Physics, not outlier trimming:
 * every other extreme value is kept.
 *
 * Rounding is outward, never to-nearest: these distributions are concentrated
 * enough that rounding a bound to the nearest 0.5 cuts through a dense cluster
 * and re-creates the same false-warning problem at a smaller scale.
 */
'use strict';

const records = require('../data/factory-records.json');
const { TIGHTNESS_LIMITS } = require('../engine/formulas');

const PROPOSE = process.argv.includes('--propose');

const floorTo = (x, step) => Math.floor(x / step) * step;
const ceilTo  = (x, step) => Math.ceil(x / step) * step;

const byFamily = {};
let impossible = 0;
for (const r of records) {
  if (!r.ne || !r.sl) continue;
  // A loop cannot be shorter than the needle pitch it spans.
  if (r.g && r.sl < 25.4 / r.g) { impossible++; continue; }
  const tf = Math.sqrt(590.5 / r.ne) / (r.sl / 10);
  (byFamily[r.fab] ||= []).push(tf);
}

const proposal = {};
const rows = [];

for (const family of Object.keys(byFamily).sort()) {
  const v = byFamily[family].sort((a, b) => a - b);
  const P = p => v[Math.round((v.length - 1) * p)];

  const derived = {
    min:       floorTo(v[0] - 1, 1),
    max:       ceilTo(v[v.length - 1] + 1, 1),
    ideal_min: floorTo(P(0.10), 0.5),
    ideal_max: ceilTo(P(0.90), 0.5),
  };
  proposal[family] = derived;

  const current = TIGHTNESS_LIMITS[family];
  const fit = (L) => L ? {
    ideal: v.filter(x => x >= L.ideal_min && x <= L.ideal_max).length / v.length * 100,
    hard:  v.filter(x => x >= L.min && x <= L.max).length / v.length * 100,
  } : null;

  rows.push({ family, n: v.length, median: P(0.5), current, derived,
              curFit: fit(current), newFit: fit(derived) });
}

const pad = (s, n) => String(s).padEnd(n);
const band = L => L ? `${L.min} / ${L.ideal_min}-${L.ideal_max} / ${L.max}` : '(none)';

console.log('\nTightness-factor band calibration — %d records\n', records.length);
console.log(pad('family', 15) + pad('n', 6) + pad('median', 8) +
            pad('current band', 26) + pad('fit', 16) + pad('derived band', 26) + 'fit');
console.log('-'.repeat(112));

let driftCount = 0;
for (const r of rows) {
  const drifted = !r.current ||
    r.current.ideal_min !== r.derived.ideal_min || r.current.ideal_max !== r.derived.ideal_max ||
    r.current.min !== r.derived.min || r.current.max !== r.derived.max;
  if (drifted) driftCount++;
  console.log(
    pad(r.family + (drifted ? ' *' : ''), 15) +
    pad(r.n, 6) + pad(r.median.toFixed(1), 8) +
    pad(band(r.current), 26) +
    pad(r.curFit ? `${r.curFit.ideal.toFixed(0)}% / ${r.curFit.hard.toFixed(0)}%` : '-', 16) +
    pad(band(r.derived), 26) +
    `${r.newFit.ideal.toFixed(0)}% / ${r.newFit.hard.toFixed(0)}%`
  );
}
console.log('-'.repeat(112));
console.log('fit = share of real production inside the ideal band / inside the hard band');
console.log(driftCount
  ? `\n${driftCount} family band(s) differ from what the data now supports (marked *).`
  : '\nEvery band matches what the data supports.');

if (PROPOSE) {
  console.log('\n// paste into backend/engine/formulas/yarn.js\nconst TIGHTNESS_LIMITS = {');
  const width = Math.max(...Object.keys(proposal).map(k => k.length)) + 3;
  for (const [family, L] of Object.entries(proposal)) {
    console.log(`  ${pad(`'${family}':`, width)}{ min: ${L.min}, max: ${L.max}, ` +
                `ideal_min: ${L.ideal_min}, ideal_max: ${L.ideal_max} },`);
  }
  const d = TIGHTNESS_LIMITS.default;
  console.log(`  ${pad("'default':", width)}{ min: ${d.min}, max: ${d.max}, ` +
              `ideal_min: ${d.ideal_min}, ideal_max: ${d.ideal_max} }`);
  console.log('};');
}
