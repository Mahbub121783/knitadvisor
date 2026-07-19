/**
 * KnitAdvisor — Composition Reference Builder
 * =============================================
 *
 * Regenerates backend/data/composition-reference.json from the real factory
 * dataset (backend/data/factory-records.json, 2,201 records — see
 * build-factory-dataset.js). This REPLACES the hand-authored
 * COMPOSITION_REFERENCE table that used to be hardcoded in
 * factory-knowledge.js, which topped out well below what real production
 * actually reaches (e.g. rib stopped at 300 GSM while real rib data goes to
 * 420) and was keyed by fabric IDs that don't match the real catalog IDs for
 * several categories (pique/fleece/waffle), making those blocks dead code.
 *
 * Output is keyed by the real "fab" bucket (single_jersey, rib, pique,
 * interlock, fleece, terry, waffle, heavy_jersey) — the same 8 buckets
 * factory-match.js already searches — not by the 54 individual
 * FABRIC_DERIVATIVES structure IDs. factory-knowledge.js maps each of the 54
 * IDs to its nearest bucket (see FAB_BUCKET_ALIAS there) so every fabric gets
 * a real, sample-count-backed reference instead of falling through to the
 * unclamped regression fallback.
 *
 * Run manually whenever factory-records.json changes:
 *   node backend/scripts/build-composition-reference.js
 */
'use strict';

const path = require('path');
const fs = require('fs');

const RECORDS_PATH = path.join(__dirname, '..', 'data', 'factory-records.json');
const OUT_PATH = path.join(__dirname, '..', 'data', 'composition-reference.json');

const GSM_BUCKET = 20; // bucket width for aggregation
const MIN_RECORDS_FOR_COMP_KEY = 15; // below this, fold into the cotton default

const COMP_KEY = {
  cotton: '100_cotton',
  cvc: 'cotton_polyester',   // cotton-majority cotton/poly blend (CVC)
  pc: 'poly_cotton',         // polyester-majority cotton/poly blend
  viscose: 'cotton_viscose',
  modal: 'cotton_modal',
};

function mode(values) {
  const counts = new Map();
  values.forEach(v => { if (v != null) counts.set(v, (counts.get(v) || 0) + 1); });
  let best = null, bestCount = 0;
  for (const [v, c] of counts) { if (c > bestCount) { best = v; bestCount = c; } }
  return best;
}
function mean(values) {
  const v = values.filter(x => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function build() {
  const records = require(RECORDS_PATH);

  // Count records per (fab, comp) to decide which composition keys are
  // well-sampled enough to stand alone vs. fold into the cotton default.
  const compCounts = {};
  records.forEach(r => {
    compCounts[r.fab] = compCounts[r.fab] || {};
    compCounts[r.fab][r.comp] = (compCounts[r.fab][r.comp] || 0) + 1;
  });

  const out = {};

  for (const rec of records) {
    const fab = rec.fab;
    const wellSampled = (compCounts[fab][rec.comp] || 0) >= MIN_RECORDS_FOR_COMP_KEY;
    const compKey = wellSampled ? (COMP_KEY[rec.comp] || '100_cotton') : '100_cotton';

    out[fab] = out[fab] || {};
    out[fab][compKey] = out[fab][compKey] || { buckets: {}, dia: [], gauges: [] };
    const block = out[fab][compKey];

    const bucketGsm = Math.round(rec.gsm / GSM_BUCKET) * GSM_BUCKET;
    block.buckets[bucketGsm] = block.buckets[bucketGsm] || { ne: [], g: [], sl: [], n: 0 };
    block.buckets[bucketGsm].ne.push(rec.ne);
    block.buckets[bucketGsm].g.push(rec.g);
    block.buckets[bucketGsm].sl.push(rec.sl);
    block.buckets[bucketGsm].n++;
    if (rec.dia != null) block.dia.push(rec.dia);
    if (rec.g != null) block.gauges.push(rec.g);
  }

  // Collapse into the final shape: { gsm_range, count_map:[...], typical_gauges, typical_dia }
  const final = {};
  for (const [fab, comps] of Object.entries(out)) {
    final[fab] = {};
    for (const [compKey, block] of Object.entries(comps)) {
      const gsmPoints = Object.keys(block.buckets).map(Number).sort((a, b) => a - b);
      const count_map = gsmPoints.map(gsm => {
        const b = block.buckets[gsm];
        const ne = Math.round(mean(b.ne) * 10) / 10;
        const gauge = mode(b.g);
        const sl = Math.round(mean(b.sl) * 1000) / 1000;
        return {
          gsm,
          count_ne: ne,
          count_display: `${ne}/1`,
          gauge: gauge != null ? gauge : undefined,
          sl,
          n: b.n,
        };
      });
      const gsms = count_map.map(m => m.gsm);
      final[fab][compKey] = {
        gsm_range: { min: Math.min(...gsms), max: Math.max(...gsms) },
        count_map,
        typical_gauges: [...new Set(block.gauges)].sort((a, b) => a - b),
        typical_dia: [...new Set(block.dia)].sort((a, b) => a - b).slice(0, 6),
      };
    }
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(final, null, 0));

  // Coverage report
  console.log(`\nComposition reference build — from ${records.length} records`);
  for (const [fab, comps] of Object.entries(final)) {
    for (const [compKey, block] of Object.entries(comps)) {
      const totalN = block.count_map.reduce((s, m) => s + m.n, 0);
      console.log(`  ${fab}.${compKey}: gsm ${block.gsm_range.min}-${block.gsm_range.max}, ${block.count_map.length} points, ${totalN} samples`);
    }
  }
  console.log(`\n  Wrote → ${OUT_PATH}\n`);
}

build();
