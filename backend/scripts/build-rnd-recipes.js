/**
 * KnitAdvisor — R&D work orders → recipe book
 * =============================================
 *
 * Reads the mill's R&D work-order workbook (sheet "MAIN DATA": fabric type, yarns,
 * GSM, machine dia × gauge, stitch lengths) and writes the compact records the
 * recipe book (engine/domain/recipe-book.js) searches: what the mill actually knits
 * for a cloth, a composition and a weight.
 *
 * Output: backend/data/rnd-recipes.json — identical work orders are folded into one
 * record carrying how many times it ran (n). No order numbers, buyers or colours by
 * name leave the workbook; the colour is kept only as a class (white / melange /
 * yarn dyed / other).
 *
 *   node backend/scripts/build-rnd-recipes.js ["path/to/R&D Work Order Status.xlsx"]
 */
'use strict';

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const RP = require('../engine/domain/recipe-parse');

const DEFAULT = path.join(__dirname, '..', '..', 'R&D Work Order Status-2026g.xlsx');
const OUT = path.join(__dirname, '..', 'data', 'rnd-recipes.json');

function build(file) {
  const wb = XLSX.readFile(file, { sheets: ['MAIN DATA'], dense: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['MAIN DATA'], { header: 1, defval: '', blankrows: false });
  const seen = new Map();
  const skipped = { no_gsm: 0, no_count: 0, cloth: 0 };
  for (const row of rows.slice(2)) {
    const r = RP.readRow(row);
    if (r.skip) { skipped[r.skip]++; continue; }
    const key = JSON.stringify(r.rec);
    const old = seen.get(key);
    if (old) old.n++; else seen.set(key, { ...r.rec, n: 1 });
  }
  const records = [...seen.values()];
  return { source: 'R&D work orders', built: new Date().toISOString().slice(0, 10), orders: records.reduce((t, r) => t + r.n, 0), records, skipped };
}

if (require.main === module) {
  const out = build(process.argv[2] || DEFAULT);
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`orders ${out.orders}, distinct recipes ${out.records.length}; skipped ${JSON.stringify(out.skipped)}`);
}

module.exports = { build };
