/**
 * Reference data access — the bridge between PostgreSQL and a synchronous engine.
 *
 * THE CONSTRAINT THIS EXISTS TO SATISFY
 * -------------------------------------
 * calculate() is synchronous and contains no await. That is not an accident of
 * how it was written; it is the property the whole product rests on. A spec is
 * either derivable from the inputs or it isn't, and making the derivation
 * depend on a network round trip would mean a database hiccup produces a
 * *different answer* rather than a slower one.
 *
 * But reference data — factory records, colour books, yarn prices — belongs in
 * a database. It changes without a deploy, it wants indexes, and 2,201 records
 * are worth querying rather than scanning.
 *
 * Both are satisfied by loading once and freezing:
 *
 *   boot   → load() reads every reference table into plain objects, freezes
 *            them, and hands them to the engine
 *   run    → the engine reads the frozen snapshot synchronously, forever
 *   change → an import writes new rows; the app is restarted (or reload() is
 *            called from the admin panel) to pick them up
 *
 * If the database is unreachable at boot, load() falls back to the JSON and JS
 * files in the repo. Those files are not stale duplicates to be deleted — they
 * are the floor that keeps the calculator answering on a fresh checkout, during
 * an outage, and in tests that should not need a database.
 */
'use strict';

const FALLBACK_SOURCES = {
  fabrics:               () => require('../catalog/fabric-derivatives').FABRIC_DERIVATIVES,
  compositionReference:  () => require('../../data/composition-reference.json'),
  factoryRecords:        () => require('../../data/factory-records.json'),
  riskRecords:           () => require('../../data/risk-assessment.json'),
};

// ---------------------------------------------------------------- state
let snapshot = null;
let origin = 'unloaded';   // 'database' | 'files' | 'unloaded'
let loadedAt = null;
let lastError = null;

// ---------------------------------------------------------------- shaping
//
// The database stores one row per curve point; the engine wants the nested
// shape it has always consumed. Reshaping here rather than in the engine keeps
// every consumer unaware of where the data came from — which is what makes the
// file fallback a genuine substitute rather than a second code path.

function shapeCompositionReference(rows) {
  const out = {};
  for (const r of rows) {
    const bucket = (out[r.fab_bucket] ||= {});
    const block = (bucket[r.composition] ||= { count_map: [] });
    block.count_map.push({
      gsm: Number(r.gsm),
      count_ne: Number(r.count_ne),
      count_display: r.count_display,
      gauge: r.gauge == null ? null : Number(r.gauge),
      sl: Number(r.stitch_len_mm),
      n: r.sample_count,
    });
  }
  for (const bucket of Object.values(out)) {
    for (const block of Object.values(bucket)) {
      block.count_map.sort((a, b) => a.gsm - b.gsm);
    }
  }
  return out;
}

function shapeFabrics(rows) {
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    name_bn: r.name_bn,
    category: r.category,
    data_bucket: r.data_bucket,
    base: r.base_fabric,
    machine_type: r.machine_type,
    gsm_range: (r.gsm_min == null && r.gsm_max == null)
      ? null : { min: Number(r.gsm_min), max: Number(r.gsm_max) },
    gauge_range: (r.gauge_min == null && r.gauge_max == null)
      ? null : { min: Number(r.gauge_min), max: Number(r.gauge_max) },
    typical_gauge: r.typical_gauge == null ? null : Number(r.typical_gauge),
    ll_multiplier: r.ll_multiplier == null ? null : Number(r.ll_multiplier),
    ll_source: r.ll_source,
    count_formula: r.count_formula || {},
    structure: r.structure || {},
    machine_note: r.machine_note,
    typical_machines: r.typical_machines,
    appearance: r.appearance,
    machine_speed: r.machine_speed,
    uses: r.uses,
  }));
}

function shapeCalibration(rows) {
  const out = {};
  for (const r of rows) {
    (out[r.kind] ||= {})[r.key] = r.value;
  }
  return out;
}

function shapeFactoryRecords(rows) {
  return rows.map(r => ({
    fab: r.fab_bucket,
    comp: r.composition,
    ne: Number(r.count_ne),
    spin: r.spin_system,
    g: r.gauge == null ? null : Number(r.gauge),
    dia: r.dia == null ? null : Number(r.dia),
    gsm: Number(r.grey_gsm),
    seg: r.colour_seg,
    sl: Number(r.stitch_len_mm),
    fdia: r.finish_dia == null ? null : Number(r.finish_dia),
    fgsm: r.finish_gsm == null ? null : Number(r.finish_gsm),
  }));
}

// ---------------------------------------------------------------- loading

function loadFromFiles(reason) {
  const fabrics = FALLBACK_SOURCES.fabrics();
  const { FAB_BUCKET_ALIAS } = require('../domain/factory-knowledge');
  const { TIGHTNESS_LIMITS, BOOK_K_CONSTANTS, GSM_COUNT_LOOKUP } = require('../formulas');
  const { GSM_COUNT_REGRESSION_COMPLETE, LL_MULTIPLIERS_COMPLETE } =
    require('../catalog/fabric-derivatives');

  snapshot = Object.freeze({
    fabrics: Object.freeze(fabrics.map(f => ({
      ...f,
      data_bucket: FAB_BUCKET_ALIAS[f.id] || null,
    }))),
    compositionReference: Object.freeze(FALLBACK_SOURCES.compositionReference()),
    factoryRecords:       Object.freeze(FALLBACK_SOURCES.factoryRecords()),
    riskRecords:          Object.freeze(FALLBACK_SOURCES.riskRecords()),
    calibration: Object.freeze({
      tightness_limits:       TIGHTNESS_LIMITS,
      gsm_count_regression:   GSM_COUNT_REGRESSION_COMPLETE,
      loop_length_multiplier: LL_MULTIPLIERS_COMPLETE,
      book_k_constant:        BOOK_K_CONSTANTS,
      gsm_count_lookup:       GSM_COUNT_LOOKUP,
    }),
    // Colour books and prices are large and only used by their own engines,
    // which already require the modules directly. The snapshot carries the
    // counts so /health and the admin panel can report what is loaded.
    colourBookCount: null,
    yarnPriceCount: null,
  });

  origin = 'files';
  loadedAt = new Date();
  lastError = reason || null;
  return snapshot;
}

/**
 * Load the reference snapshot. Call once at boot, before the server listens.
 * Safe to call again — it replaces the snapshot atomically.
 */
async function load({ allowFallback = true } = {}) {
  let db;
  try {
    db = require('../../db/client');
  } catch (err) {
    if (!allowFallback) throw err;
    return loadFromFiles(`db/client unavailable: ${err.message}`);
  }

  try {
    const [fabrics, compRef, calib, factory, risk, colours, prices] = await Promise.all([
      db.query('SELECT * FROM fabrics WHERE is_active ORDER BY sort_order, id'),
      db.query('SELECT * FROM composition_reference ORDER BY fab_bucket, composition, gsm'),
      db.query('SELECT kind, key, value FROM calibration'),
      db.query('SELECT * FROM factory_records ORDER BY id'),
      db.query('SELECT payload FROM risk_records ORDER BY id'),
      db.query('SELECT count(*)::int AS n FROM colour_book'),
      db.query('SELECT count(*)::int AS n FROM yarn_prices'),
    ]);

    // An empty reference table means the migration ran but the import did not.
    // Serving an empty fabric catalogue would turn every request into
    // "Unknown fabric" — far worse than quietly using the files.
    if (!fabrics.length || !compRef.length) {
      if (!allowFallback) throw new Error('reference tables are empty — run scripts/import-reference-data.js --apply');
      return loadFromFiles('reference tables empty — import has not run');
    }

    snapshot = Object.freeze({
      fabrics:              Object.freeze(shapeFabrics(fabrics)),
      compositionReference: Object.freeze(shapeCompositionReference(compRef)),
      factoryRecords:       Object.freeze(shapeFactoryRecords(factory)),
      riskRecords:          Object.freeze(risk.map(r => r.payload)),
      calibration:          Object.freeze(shapeCalibration(calib)),
      colourBookCount:      colours[0].n,
      yarnPriceCount:       prices[0].n,
    });

    origin = 'database';
    loadedAt = new Date();
    lastError = null;
    return snapshot;
  } catch (err) {
    if (!allowFallback) throw err;
    return loadFromFiles(`database read failed: ${err.message}`);
  }
}

/** Re-read from the database. Used by the admin panel after a data import. */
const reload = () => load();

/**
 * The frozen snapshot. Synchronous by design.
 *
 * If load() has not run — a unit test requiring the engine directly, say — this
 * falls back to the files rather than throwing, so the calculation path never
 * depends on boot order.
 */
function get() {
  if (!snapshot) loadFromFiles('get() called before load()');
  return snapshot;
}

const status = () => ({
  origin,
  loaded_at: loadedAt,
  last_error: lastError,
  counts: snapshot ? {
    fabrics: snapshot.fabrics.length,
    factory_records: snapshot.factoryRecords.length,
    risk_records: snapshot.riskRecords.length,
    composition_buckets: Object.keys(snapshot.compositionReference).length,
    colour_book: snapshot.colourBookCount,
    yarn_prices: snapshot.yarnPriceCount,
  } : null,
});

module.exports = { load, reload, get, status };
