#!/usr/bin/env node
/**
 * Import every reference data source into PostgreSQL.
 *
 *   node scripts/import-reference-data.js            # dry run — reports only
 *   node scripts/import-reference-data.js --apply    # write
 *
 * Sources, in the order they are imported (later tables reference earlier ones):
 *
 *   fabrics               ← engine/fabric-derivatives.js  + factory-knowledge's bucket alias
 *   factory_records       ← data/factory-records.json
 *   composition_reference ← data/composition-reference.json
 *   risk_records          ← data/risk-assessment.json
 *   colour_book           ← engine/{tcx,scotdic,bros,archroma}-database.js
 *   yarn_prices           ← engine/costing-engine.js SM_PRICE_MATRIX
 *   calibration           ← engine/formulas.js + engine/fabric-derivatives.js
 *   knitting_faults       ← engine/faults-engine.js
 *
 * The JS/JSON sources stay in the repo after this runs. They are not dead
 * weight: engine/reference/ falls back to them when the database is
 * unreachable, so the calculator still answers during an outage or on a fresh
 * checkout that has not been migrated yet. The database is the source of
 * truth; the files are the floor.
 *
 * Idempotent — every insert is ON CONFLICT DO UPDATE, so re-running after a
 * data refresh updates in place rather than duplicating.
 */
'use strict';

require('dotenv').config();
const crypto = require('crypto');
const { transaction, query, close } = require('../db/client');

const APPLY = process.argv.includes('--apply');

// ---------------------------------------------------------------- sources
const { FABRIC_DERIVATIVES, GSM_COUNT_REGRESSION_COMPLETE, LL_MULTIPLIERS_COMPLETE } =
  require('../engine/catalog/fabric-derivatives');
const { FAB_BUCKET_ALIAS } = require('../engine/domain/factory-knowledge');
const { TIGHTNESS_LIMITS, BOOK_K_CONSTANTS, GSM_COUNT_LOOKUP } = require('../engine/formulas');
const { SM_PRICE_MATRIX } = require('../engine/domain/costing-engine');
const { FAULTS_DATABASE } = require('../engine/domain/faults-engine');
const { TCX_COLORS } = require('../engine/catalog/tcx-database');
const { SCOTDIC_COLORS } = require('../engine/catalog/scotdic-database');
const { BROS_COLORS } = require('../engine/catalog/bros-database');
const { ARCHROMA_COLORS } = require('../engine/catalog/archroma-database');

const factoryRecords = require('../data/factory-records.json');
const compositionRef = require('../data/composition-reference.json');
const riskRecords    = require('../data/risk-assessment.json');

// `lacoste_double` is the one weft-knit fabric with no entry in
// FAB_BUCKET_ALIAS, so it silently lost its factory reference and fell through
// to the generic tightness limits. Every other lacoste and pique variant maps
// to 'pique'; this is the missing row, not a new decision.
const BUCKET_PATCH = { lacoste_double: 'pique' };

const stats = [];
function record(table, rows, source) {
  stats.push({ table, rows, source });
}

function checksum(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

const num = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)))
  ? null : Number(v);

// Four rows in the source R&D export carry a finished GSM that is several
// readings concatenated without a separator — 143148, 152156, 264256 and
// 245250256 (245 / 250 / 256 run together). A spreadsheet cell held more than
// one measurement and the extractor read it as one number.
//
// These are imported as NULL rather than repaired: splitting "264256" into 264
// and 256 is a guess, and a guessed measurement is worse than a missing one in
// a table whose whole job is to be the ground truth. The rows are otherwise
// intact — count, stitch length and grey GSM are all valid — so they still
// contribute to the count/SL curves. Only the dye-gain figure is lost, and only
// for these four.
const outOfRange = { count: 0, rows: [] };
function ranged(v, min, max, ctx) {
  const n = num(v);
  if (n === null) return null;
  if (n < min || n > max) {
    outOfRange.count++;
    if (outOfRange.rows.length < 10) outOfRange.rows.push(`${ctx}=${n}`);
    return null;
  }
  return n;
}

// ---------------------------------------------------------------- importers

async function importFabrics(q) {
  const rows = FABRIC_DERIVATIVES.map((f, i) => ({
    id: f.id,
    name: f.name,
    name_bn: f.name_bn || null,
    category: f.category,
    data_bucket: FAB_BUCKET_ALIAS[f.id] || BUCKET_PATCH[f.id] || null,
    machine_type: f.machine_type || null,
    base_fabric: f.base || null,
    gsm_min: f.gsm_range ? num(f.gsm_range.min) : null,
    gsm_max: f.gsm_range ? num(f.gsm_range.max) : null,
    gauge_min: f.gauge_range ? num(f.gauge_range.min) : null,
    gauge_max: f.gauge_range ? num(f.gauge_range.max) : null,
    typical_gauge: num(f.typical_gauge),
    ll_multiplier: num(f.ll_multiplier),
    ll_source: f.ll_source || null,
    count_formula: f.count_formula || {},
    structure: f.structure || {},
    machine_note: f.machine_note || null,
    typical_machines: f.typical_machines || null,
    appearance: f.appearance || null,
    machine_speed: f.machine_speed || null,
    uses: f.uses || null,
    sort_order: i,
  }));

  const missing = rows.filter(r => !r.data_bucket && r.category !== 'warp_knit');
  if (missing.length) {
    throw new Error(
      `${missing.length} weft-knit fabric(s) have no data bucket and would lose their ` +
      `factory reference: ${missing.map(m => m.id).join(', ')}. ` +
      `Add them to FAB_BUCKET_ALIAS or BUCKET_PATCH before importing.`
    );
  }

  if (APPLY) {
    for (const r of rows) {
      await q(
        `INSERT INTO fabrics (id, name, name_bn, category, data_bucket, machine_type,
           base_fabric, gsm_min, gsm_max, gauge_min, gauge_max, typical_gauge,
           ll_multiplier, ll_source, count_formula, structure, machine_note,
           typical_machines, appearance, machine_speed, uses, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, name_bn=EXCLUDED.name_bn, category=EXCLUDED.category,
           data_bucket=EXCLUDED.data_bucket, machine_type=EXCLUDED.machine_type,
           base_fabric=EXCLUDED.base_fabric, gsm_min=EXCLUDED.gsm_min, gsm_max=EXCLUDED.gsm_max,
           gauge_min=EXCLUDED.gauge_min, gauge_max=EXCLUDED.gauge_max,
           typical_gauge=EXCLUDED.typical_gauge, ll_multiplier=EXCLUDED.ll_multiplier,
           ll_source=EXCLUDED.ll_source, count_formula=EXCLUDED.count_formula,
           structure=EXCLUDED.structure, machine_note=EXCLUDED.machine_note,
           typical_machines=EXCLUDED.typical_machines, appearance=EXCLUDED.appearance,
           machine_speed=EXCLUDED.machine_speed, uses=EXCLUDED.uses,
           sort_order=EXCLUDED.sort_order, is_active=true`,
        [r.id, r.name, r.name_bn, r.category, r.data_bucket, r.machine_type, r.base_fabric,
         r.gsm_min, r.gsm_max, r.gauge_min, r.gauge_max, r.typical_gauge, r.ll_multiplier,
         r.ll_source, JSON.stringify(r.count_formula), JSON.stringify(r.structure),
         r.machine_note, r.typical_machines, r.appearance, r.machine_speed, r.uses, r.sort_order]
      );
    }
  }
  record('fabrics', rows.length, 'engine/fabric-derivatives.js');
  return rows;
}

async function importFactoryRecords(q) {
  if (APPLY) {
    await q('TRUNCATE factory_records RESTART IDENTITY');
    // One multi-row INSERT per chunk rather than 2,201 round trips.
    const CHUNK = 250;
    for (let i = 0; i < factoryRecords.length; i += CHUNK) {
      const slice = factoryRecords.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      slice.forEach((r, j) => {
        const b = j * 11;
        values.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11})`);
        params.push(r.fab, r.comp, num(r.ne), r.spin || null, num(r.g), num(r.dia),
                    num(r.gsm), r.seg || null, num(r.sl),
                    ranged(r.fdia, 5, 200, 'finish_dia'),
                    ranged(r.fgsm, 30, 1200, 'finish_gsm'));
      });
      await q(
        `INSERT INTO factory_records
           (fab_bucket, composition, count_ne, spin_system, gauge, dia,
            grey_gsm, colour_seg, stitch_len_mm, finish_dia, finish_gsm)
         VALUES ${values.join(',')}`,
        params
      );
    }
    await q(
      `UPDATE factory_records SET source_file = 'factory ERP R&D master file'`
    );
  }
  record('factory_records', factoryRecords.length, 'data/factory-records.json');
}

async function importCompositionReference(q) {
  const rows = [];
  for (const bucket of Object.keys(compositionRef)) {
    for (const comp of Object.keys(compositionRef[bucket])) {
      const block = compositionRef[bucket][comp];
      for (const p of block.count_map || []) {
        rows.push([bucket, comp, num(p.gsm), num(p.count_ne),
                   p.count_display || null, num(p.gauge), num(p.sl), p.n || 1]);
      }
    }
  }
  if (APPLY) {
    await q('TRUNCATE composition_reference RESTART IDENTITY');
    for (const r of rows) {
      await q(
        `INSERT INTO composition_reference
           (fab_bucket, composition, gsm, count_ne, count_display, gauge, stitch_len_mm, sample_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (fab_bucket, composition, gsm) DO UPDATE SET
           count_ne=EXCLUDED.count_ne, count_display=EXCLUDED.count_display,
           gauge=EXCLUDED.gauge, stitch_len_mm=EXCLUDED.stitch_len_mm,
           sample_count=EXCLUDED.sample_count`,
        r
      );
    }
  }
  record('composition_reference', rows.length, 'data/composition-reference.json');
}

async function importRiskRecords(q) {
  const list = Array.isArray(riskRecords) ? riskRecords : (riskRecords.records || []);
  if (APPLY) {
    await q('TRUNCATE risk_records RESTART IDENTITY');
    for (const r of list) {
      await q(
        `INSERT INTO risk_records (job_name, fab_bucket, composition, gsm, payload)
         VALUES ($1,$2,$3,$4,$5)`,
        [r.name || r.job_name || 'unnamed',
         r.construction || r.fab || r.fab_bucket || 'single_jersey',
         r.comp || r.composition || 'cotton',
         num(r.gsm),
         JSON.stringify(r)]
      );
    }
  }
  record('risk_records', list.length, 'data/risk-assessment.json');
}

async function importColourBooks(q) {
  const books = [
    ['tcx',      TCX_COLORS],
    ['scotdic',  SCOTDIC_COLORS],
    ['bros',     BROS_COLORS],
    ['archroma', ARCHROMA_COLORS],
  ];
  let total = 0;
  if (APPLY) await q('TRUNCATE colour_book RESTART IDENTITY');

  for (const [book, colours] of books) {
    // Codes repeat inside the TCX book (the same code appears under several
    // page groups); the unique key is (book, code), so dedupe before insert
    // rather than letting ON CONFLICT quietly drop rows we never counted.
    const seen = new Set();
    const rows = [];
    for (const c of colours) {
      if (!c || !c.c || !c.h || seen.has(c.c)) continue;
      seen.add(c.c);
      rows.push([book, c.c, c.n || c.c, c.h.toUpperCase()]);
    }
    if (APPLY) {
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const values = [];
        const params = [];
        slice.forEach((r, j) => {
          const b = j * 4;
          values.push(`($${b+1},$${b+2},$${b+3},$${b+4})`);
          params.push(...r);
        });
        await q(
          `INSERT INTO colour_book (book, code, name, hex) VALUES ${values.join(',')}
           ON CONFLICT (book, code) DO UPDATE SET name=EXCLUDED.name, hex=EXCLUDED.hex`,
          params
        );
      }
    }
    total += rows.length;
    record(`colour_book:${book}`, rows.length, `engine/${book}-database.js`);
  }
  return total;
}

async function importYarnPrices(q) {
  const rows = [];
  for (const yarnType of Object.keys(SM_PRICE_MATRIX)) {
    const byCount = SM_PRICE_MATRIX[yarnType];
    if (!byCount || typeof byCount !== 'object') continue;
    for (const countKey of Object.keys(byCount)) {
      const price = num(byCount[countKey]);
      const count = num(countKey);
      if (price === null || count === null || price <= 0) continue;
      rows.push([yarnType, count, price, 'Factory-Approved Reference Price List']);
    }
  }
  if (APPLY) {
    await q('TRUNCATE yarn_prices RESTART IDENTITY');
    for (const r of rows) {
      await q(
        `INSERT INTO yarn_prices (yarn_type, count_ne, price_usd_kg, price_list)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (yarn_type, count_ne, effective_from)
         DO UPDATE SET price_usd_kg = EXCLUDED.price_usd_kg`,
        r
      );
    }
  }
  record('yarn_prices', rows.length, 'engine/costing-engine.js SM_PRICE_MATRIX');
}

async function importCalibration(q) {
  const rows = [];
  const push = (kind, key, value, source, note) =>
    rows.push([kind, key, JSON.stringify(value), source || null, note || null]);

  for (const [family, limits] of Object.entries(TIGHTNESS_LIMITS)) {
    push('tightness_limits', family, limits,
      'Percentiles of TF observed in factory_records',
      'min/max = 2nd/98th percentile, ideal = 25th/75th');
  }
  for (const [fabric, reg] of Object.entries(GSM_COUNT_REGRESSION_COMPLETE)) {
    push('gsm_count_regression', fabric, reg, reg.source || null);
  }
  for (const [fabric, ll] of Object.entries(LL_MULTIPLIERS_COMPLETE)) {
    push('loop_length_multiplier', fabric, ll, ll.source || null);
  }
  for (const [fabric, k] of Object.entries(BOOK_K_CONSTANTS)) {
    push('book_k_constant', fabric, { k },
      'Understanding Textile for Merchandiser p.512');
  }
  for (const [table, points] of Object.entries(GSM_COUNT_LOOKUP)) {
    push('gsm_count_lookup', table, points, '448733518GSMtoCountConversion.pdf');
  }

  if (APPLY) {
    await q('TRUNCATE calibration RESTART IDENTITY');
    for (const r of rows) {
      await q(
        `INSERT INTO calibration (kind, key, value, source, note)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (kind, key) DO UPDATE SET
           value=EXCLUDED.value, source=EXCLUDED.source, note=EXCLUDED.note`,
        r
      );
    }
  }
  record('calibration', rows.length, 'engine/formulas.js + fabric-derivatives.js');
}

async function importFaults(q) {
  const list = Array.isArray(FAULTS_DATABASE)
    ? FAULTS_DATABASE
    : Object.entries(FAULTS_DATABASE || {}).map(([k, v]) => ({ slug: k, ...v }));

  const rows = list.map((f, i) => {
    const slug = f.slug || f.id ||
      String(f.name || `fault_${i}`).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return [slug, f.name || slug, f.category || null, JSON.stringify(f)];
  });

  if (APPLY) {
    await q('TRUNCATE knitting_faults RESTART IDENTITY');
    for (const r of rows) {
      await q(
        `INSERT INTO knitting_faults (slug, name, category, payload)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (slug) DO UPDATE SET
           name=EXCLUDED.name, category=EXCLUDED.category, payload=EXCLUDED.payload`,
        r
      );
    }
  }
  record('knitting_faults', rows.length, 'engine/faults-engine.js');
}

async function stampVersions(q) {
  if (!APPLY) return;
  const tables = [
    ['fabrics', FABRIC_DERIVATIVES, 'engine/fabric-derivatives.js'],
    ['factory_records', factoryRecords, 'data/factory-records.json'],
    ['composition_reference', compositionRef, 'data/composition-reference.json'],
    ['risk_records', riskRecords, 'data/risk-assessment.json'],
    ['colour_book', [TCX_COLORS.length, SCOTDIC_COLORS.length, BROS_COLORS.length, ARCHROMA_COLORS.length], 'colour book modules'],
    ['yarn_prices', SM_PRICE_MATRIX, 'engine/costing-engine.js'],
    ['calibration', { TIGHTNESS_LIMITS, BOOK_K_CONSTANTS }, 'engine/formulas.js'],
    ['knitting_faults', FAULTS_DATABASE, 'engine/faults-engine.js'],
  ];
  for (const [name, payload, source] of tables) {
    const rows = await q(`SELECT count(*)::int AS n FROM ${name}`);
    await q(
      `INSERT INTO reference_versions (table_name, row_count, checksum, source, imported_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (table_name) DO UPDATE SET
         row_count=EXCLUDED.row_count, checksum=EXCLUDED.checksum,
         source=EXCLUDED.source, imported_at=now()`,
      [name, rows[0].n, checksum(payload), source]
    );
  }
}

// ---------------------------------------------------------------- main
async function main() {
  console.log(APPLY
    ? '[import] APPLY — writing reference data to PostgreSQL\n'
    : '[import] DRY RUN — nothing written. Re-run with --apply to write.\n');

  await transaction(async (q) => {
    await importFabrics(q);
    await importFactoryRecords(q);
    await importCompositionReference(q);
    await importRiskRecords(q);
    await importColourBooks(q);
    await importYarnPrices(q);
    await importCalibration(q);
    await importFaults(q);
    await stampVersions(q);
    if (!APPLY) throw new Error('__DRY_RUN__');
  }).catch(err => {
    if (err.message !== '__DRY_RUN__') throw err;
  });

  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('TABLE', 26) + pad('ROWS', 9) + 'SOURCE');
  console.log('-'.repeat(80));
  let total = 0;
  for (const s of stats) {
    console.log(pad(s.table, 26) + pad(s.rows.toLocaleString(), 9) + s.source);
    total += s.rows;
  }
  console.log('-'.repeat(80));
  console.log(pad('TOTAL', 26) + pad(total.toLocaleString(), 9));

  if (outOfRange.count) {
    console.log(`\n[import] ${outOfRange.count} out-of-range value(s) imported as NULL ` +
                `(corrupt in the source export): ${outOfRange.rows.join(', ')}`);
  }

  if (APPLY) {
    const rows = await query(
      `SELECT table_name, row_count, imported_at FROM reference_versions ORDER BY table_name`
    );
    console.log('\n[import] reference_versions stamped:');
    rows.forEach(r => console.log(`  ${pad(r.table_name, 24)} ${String(r.row_count).padStart(6)} rows`));
  }
}

main()
  .then(() => close())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('\n[import] FAILED:', err.message);
    await close().catch(() => {});
    process.exit(1);
  });
