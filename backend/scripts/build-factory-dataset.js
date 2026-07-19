/**
 * KnitAdvisor — Factory Dataset Builder
 * ======================================
 *
 * One-time (re-runnable) ETL: parses the real factory ERP R&D Master File
 * ("New ERP R&D Master File-2022.xlsx", 2711 greige→finish rows) into the
 * clean record shape `factory-match.js` searches, and writes it to
 * backend/data/factory-records.json.
 *
 * This REPLACES the 117 hand-curated records that used to be hardcoded in
 * factory-dataset.js — those were a small illustrative sample; this script
 * loads the real, full dataset so the "Factory R&D Data Match" card searches
 * thousands of real rows instead of ~100 examples, and the on-screen record
 * count is no longer a hardcoded string.
 *
 * Run manually whenever the source spreadsheet changes:
 *   node backend/scripts/build-factory-dataset.js
 *
 * Output schema (one entry per usable row) — matches the schema the matching
 * engine (factory-match.js) already expects:
 *   { fab, comp, ne, spin, g, dia, gsm, seg, sl, fdia, fgsm }
 */
'use strict';

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { parseComposition } = require('../engine/composition-engine');

const XLSX_PATH = path.join(__dirname, '..', '..', 'New ERP R&D Master File-2022.xlsx');
const OUT_PATH = path.join(__dirname, '..', 'data', 'factory-records.json');

// ============================================================
// FIELD PARSERS
// ============================================================

// "Fabrication" free text (e.g. "Single Jersey+1 X 1 Rib 280", "Franch Terry+2x2Ly=380+Tape")
// → one of the 8 structure buckets the matching engine understands. Composite
// fabrics list collar/cuff/tape/rib-trim as "+"-suffixes; the PRIMARY body
// structure is what the wearer/buyer actually specs the fabric as, so we
// classify on the substring before the first "+".
function mapFabrication(raw) {
  if (!raw) return null;
  const primary = String(raw).split('+')[0].trim().toLowerCase();
  if (!primary) return null;
  if (/interlock/.test(primary)) return 'interlock';
  if (/pique|lacoste|\bpk\b/.test(primary)) return 'pique';
  if (/fleece/.test(primary)) return 'fleece';
  if (/terry/.test(primary)) return 'terry';
  if (/waffle/.test(primary)) return 'waffle';
  if (/heavy\s*jersey/.test(primary)) return 'heavy_jersey';
  if (/rib/.test(primary)) return 'rib';
  if (/s\/j|single\s*jersey|\bjersey\b|slub\s*s\/?j/.test(primary)) return 'single_jersey';
  return null;
}

// "Composition" free text → dominant fibre-class bucket. Reuses the SAME
// parser the live "Composition" form field uses (parseComposition), so real
// records and user-typed compositions are classified identically.
function mapComposition(raw) {
  const lower = String(raw || '').toLowerCase();
  if (/modal/.test(lower)) return 'modal';
  const parsed = parseComposition(raw);
  const f = (parsed && parsed.fibers) || {};
  const cotton = f.cotton || 0;
  const poly = f.polyester || 0;
  const viscose = f.viscose || 0; // parseComposition folds modal into 'viscose'; modal already handled above
  if (viscose >= 15) return 'viscose';
  if (poly > 0 && poly >= cotton) return 'pc';
  if (poly > 0) return 'cvc';
  return 'cotton';
}

// "Yarn Count" free text (e.g. "18/1 Combed", "20/1 Carded+10/1 Carded",
// "30/1 D/Y+40D Lycra") → { ne, spin }. Ground/face yarn = first segment
// before "+", matching the schema's documented convention.
function parseYarnCount(raw) {
  if (!raw) return null;
  const s = String(raw);
  const first = s.split('+')[0].trim();
  const m = first.match(/(\d+(?:\.\d+)?)\s*\/\s*1\b/);
  if (!m) return null;
  const ne = parseFloat(m[1]);
  if (!ne || ne <= 0 || ne > 120) return null;

  const lower = s.toLowerCase();
  let spin = 'combed';
  if (/rotor|open.?end|\bo\/e\b/.test(lower)) spin = 'rotor';
  else if (/slub/.test(lower)) spin = 'slub';
  else if (/carded/.test(lower)) spin = 'carded';
  else if (/compact/.test(lower)) spin = 'compact';
  else if (/comb/.test(lower)) spin = 'combed';

  const hasLycra = /lycra|spandex|elastane|\d+\s*d\b/.test(lower);
  if (hasLycra && (spin === 'combed' || spin === 'carded')) spin += '_lycra';

  return { ne, spin };
}

// "MC DiaXGauge" (e.g. "26x24") → { dia, g }. Column name is literally
// Dia × Gauge — verified against sample rows (dia 26-42", gauge 18-28GG are
// both plausible ranges in that order; the reverse would put implausible
// 40+GG gauges on some rows).
function parseDiaGauge(raw) {
  if (!raw) return { dia: null, g: null };
  const s = String(raw).toLowerCase().replace(/\s+/g, '');
  const m = s.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/);
  if (!m) return { dia: null, g: null };
  return { dia: parseFloat(m[1]), g: parseFloat(m[2]) };
}

// "Color Segment" (e.g. "Yarn Dyed - Medium", "Solid - Dark") → light|medium|dark.
function parseSegment(raw) {
  if (!raw) return 'medium';
  const parts = String(raw).split('-');
  const tail = parts[parts.length - 1].trim().toLowerCase();
  if (tail === 'light' || tail === 'medium' || tail === 'dark') return tail;
  return 'medium';
}

// "Stitch Length" — usually numeric mm; sometimes a composite "ground+rib"
// string like "3.26+1.45" (multi-yarn body). Body/ground SL = first value,
// matching the schema's documented `sl` semantics.
function parseSL(raw) {
  if (raw === '' || raw == null) return null;
  if (typeof raw === 'number') return raw > 0 && raw < 10 ? raw : null;
  const first = String(raw).split('+')[0].trim();
  const v = parseFloat(first);
  return v > 0 && v < 10 ? v : null;
}

// "F/DIA" — e.g. 57" as a string, or already numeric.
function parseFdia(raw) {
  if (raw === '' || raw == null) return null;
  if (typeof raw === 'number') return raw > 0 ? raw : null;
  const v = parseFloat(String(raw).replace(/["'A-Za-z]/g, '').trim());
  return v > 0 ? v : null;
}

function parseNum(raw) {
  const v = parseFloat(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// ============================================================
// MAIN
// ============================================================
function build() {
  const wb = XLSX.readFile(XLSX_PATH);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const dropped = { fab: 0, gsm: 0, ne: 0, sl: 0, fgsm: 0 };
  const unmappedFab = {};
  const out = [];

  for (const row of rows) {
    const fab = mapFabrication(row['Fabrication']);
    if (!fab) {
      const key = String(row['Fabrication'] || '(blank)').trim();
      unmappedFab[key] = (unmappedFab[key] || 0) + 1;
      dropped.fab++;
      continue;
    }
    const gsm = parseNum(row['GSM']);
    if (!gsm) { dropped.gsm++; continue; }

    const yc = parseYarnCount(row['Yarn Count']);
    if (!yc) { dropped.ne++; continue; }

    const sl = parseSL(row['Stitch Length']);
    if (sl == null) { dropped.sl++; continue; }

    const fgsm = parseNum(row['F/GSM']);
    if (!fgsm) { dropped.fgsm++; continue; }

    const { dia, g } = parseDiaGauge(row['MC DiaXGauge']);
    const fdia = parseFdia(row['F/DIA']);
    const comp = mapComposition(row['Composition']);
    const seg = parseSegment(row['Color Segment']);

    out.push({ fab, comp, ne: yc.ne, spin: yc.spin, g, dia, gsm, seg, sl, fdia, fgsm });
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 0));

  // ── Coverage report ──────────────────────────────────────────────────
  const totalDropped = Object.values(dropped).reduce((a, b) => a + b, 0);
  console.log(`\nFactory dataset build — ${XLSX_PATH}`);
  console.log(`  Rows read:        ${rows.length}`);
  console.log(`  Rows kept:        ${out.length}`);
  console.log(`  Rows dropped:     ${totalDropped}`);
  console.log(`    - unmapped fabrication: ${dropped.fab}`);
  console.log(`    - missing/invalid GSM:  ${dropped.gsm}`);
  console.log(`    - unparseable yarn count: ${dropped.ne}`);
  console.log(`    - missing/invalid stitch length: ${dropped.sl}`);
  console.log(`    - missing/invalid F/GSM: ${dropped.fgsm}`);

  const byFab = {};
  out.forEach(r => { byFab[r.fab] = (byFab[r.fab] || 0) + 1; });
  console.log(`\n  Kept records by fabric family:`);
  Object.entries(byFab).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`    ${k}: ${v}`));

  const topUnmapped = Object.entries(unmappedFab).sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (topUnmapped.length) {
    console.log(`\n  Top unmapped "Fabrication" strings (for manual keyword-list review):`);
    topUnmapped.forEach(([k, v]) => console.log(`    ${v.toString().padStart(4)}  ${k}`));
  }

  console.log(`\n  Wrote ${out.length} records → ${OUT_PATH}\n`);
}

build();
