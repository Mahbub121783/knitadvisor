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
    if (!/lycra/.test(String(r.spin || ''))) compCounts[r.fab].__plain = (compCounts[r.fab].__plain || 0) + 1;
  });

  const out = {};

  for (const rec of records) {
    const fab = rec.fab;
    // Lycra rows are a different cloth at the same weight (finer count, much
    // denser): mixing them into the plain table pulled the 200 GSM single
    // jersey recipe from 20s to 24.4s. Elastane is applied by the composition
    // modifiers on top of the plain table, so the plain table stays plain.
    if (/lycra/.test(String(rec.spin || '')) && (compCounts[fab].__plain || 0) >= 20) continue;
    const wellSampled = (compCounts[fab][rec.comp] || 0) >= MIN_RECORDS_FOR_COMP_KEY;
    const compKey = wellSampled ? (COMP_KEY[rec.comp] || '100_cotton') : '100_cotton';

    out[fab] = out[fab] || {};
    out[fab][compKey] = out[fab][compKey] || { buckets: {}, dia: [], gauges: [] };
    const block = out[fab][compKey];

    const bucketGsm = Math.round(rec.gsm / GSM_BUCKET) * GSM_BUCKET;
    block.buckets[bucketGsm] = block.buckets[bucketGsm] || { ne: [], g: [], sl: [], rows: [], n: 0 };
    block.buckets[bucketGsm].rows.push(rec);
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
        // ONE recipe the factory actually ran: the most common count in the
        // bucket, with the median stitch length and the usual gauge of the
        // rows knitted in THAT count. Averaging count and SL separately
        // across rows made pairs that never coexisted (180 GSM → 26.4s at
        // 2.84 mm, which finishes near 155 GSM).
        const ne = mode(b.ne);
        const same = b.rows.filter(r => r.ne === ne);
        const gauge = mode(same.map(r => r.g));
        const slSorted = same.map(r => r.sl).filter(x => x != null).sort((x, y) => x - y);
        const sl = Math.round(slSorted[slSorted.length >> 1] * 1000) / 1000;
        return {
          gsm,
          count_ne: ne,
          count_display: `${ne}/1`,
          gauge: gauge != null ? gauge : undefined,
          sl,
          n: b.n,
        };
      });
      // A point whose own count and SL cannot weigh its GSM (by the family's
      // loop constant Ks = 10·GSM·ℓ/tex, fitted on the same rows) is a
      // handful of odd rows, not a recipe: drop it and let the neighbours
      // interpolate. 260/280 GSM single jersey were 30s at 3.5 mm and 22s at
      // 4.0 mm — recipes that finish near 110-130 GSM.
      const ksRows = records.filter(r => r.fab === fab && !/lycra/.test(String(r.spin || '')) && r.sl > 0 && r.ne > 0 && r.fgsm > 0)
        .map(r => 10 * r.fgsm * (r.sl / 10) / (590.5 / r.ne)).sort((x, y) => x - y);
      const ks = ksRows.length ? ksRows[ksRows.length >> 1] : null;
      // (single-yarn families only: a fleece or terry carries its loop yarn's
      // weight, which the face count does not see)
      if (ks && ['single_jersey', 'rib', 'pique', 'interlock', 'waffle'].includes(fab)) {
        for (let i = count_map.length - 1; i >= 0; i--) {
          const m = count_map[i];
          const pred = ks * (590.5 / m.count_ne) / (10 * (m.sl / 10));
          if (Math.abs(pred / m.gsm - 1) > 0.15 && count_map.length > 2) {
            console.log(`  dropped ${fab}.${compKey} ${m.gsm} GSM: ${m.count_ne}s at ${m.sl} mm finishes near ${Math.round(pred)} GSM (n=${m.n})`);
            count_map.splice(i, 1);
          }
        }
      }
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
