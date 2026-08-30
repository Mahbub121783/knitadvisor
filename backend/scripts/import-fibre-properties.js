#!/usr/bin/env node
/**
 * IMPORT THE FIBRE MEASUREMENTS
 * =============================
 * Loads data/fibre-properties.json — the density tables of Morton & Hearle
 * chapter 5, read off the page by coordinate — into `fibres` and
 * `fibre_properties`.
 *
 *   node scripts/import-fibre-properties.js            check only
 *   node scripts/import-fibre-properties.js --write    apply
 *
 * THE GATE
 * --------
 * The extraction has one property that makes it checkable end to end: every row
 * of these tables prints a density AND a specific volume, and the two are
 * reciprocals by definition. A column read one place off, or a row with an
 * empty cell read as if it were full, breaks that immediately.
 *
 * So the reciprocal is re-tested here, on the JSON, independently of the
 * extractor that produced it — a check that only runs inside the thing it is
 * checking is not much of a check.
 *
 * One row fails it and is imported anyway, with the failure recorded on the
 * row: the book gives carbon as 1.8-2.0 g/cm3 with specific volume 0.56-0.55,
 * and 1/2.0 is 0.50. Every other range in chapter 5 is self-consistent, so that
 * is the book's arithmetic and not ours. Correcting it silently would be
 * inventing a measurement.
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { query, close } = require('../db/client');
const { FIBER_PROPERTIES } = require('../engine/domain/yarn-engine');

const FILE = path.join(__dirname, '..', 'data', 'fibre-properties.json');
const WRITE = process.argv.includes('--write');

const CLASSES = ['cellulose', 'protein', 'polyamide', 'polyester', 'polyolefin',
                 'vinyl', 'elastomer', 'carbon', 'inorganic', 'high_performance', 'other'];
const ORIGINS = ['natural', 'regenerated', 'synthetic', 'inorganic'];

const failures = [];
let passed = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (ok) passed++; else failures.push(label + (detail ? ': ' + detail : ''));
  return ok;
};

const point = r => (r.value != null ? r.value : null);

function verify(payload) {
  const { fibres, properties, refused, book_discrepancies: slips } = payload;
  console.log('\nGATE\n');

  check(payload.source.key === 'morton_hearle_2008', 'the source key is the expected one');
  check(refused.length === 0, 'the extractor refused nothing',
        refused.map(r => `${r.name}: ${r.why}`).join('; '));
  check(fibres.length >= 40, 'all three density tables were read', fibres.length + ' fibres');
  check(properties.length >= 100, 'both properties came through for each condition',
        properties.length + ' measurements');

  // Classification has to satisfy the same constraints the table does, so a bad
  // value is caught here rather than as a constraint violation mid-import.
  const badClass = fibres.filter(f => !CLASSES.includes(f.generic_class));
  const badOrigin = fibres.filter(f => !ORIGINS.includes(f.origin));
  check(badClass.length === 0, 'every fibre has a class the table accepts',
        badClass.map(f => f.slug).join(', '));
  check(badOrigin.length === 0, 'every fibre has an origin the table accepts',
        badOrigin.map(f => f.slug).join(', '));

  const orphan = properties.filter(p => !fibres.some(f => f.slug === p.fibre_slug));
  check(orphan.length === 0, 'every measurement belongs to a fibre in the list', orphan.length + ' orphans');

  // Conditions must be typed consistently, or "density at 65% r.h." stops being
  // a question the database can answer.
  const badRh = properties.filter(p =>
    (p.condition === '65% r.h.' && p.rh_pct !== 65) ||
    (p.condition === 'dry' && p.rh_pct !== 0) ||
    (p.condition === null && p.rh_pct !== null));
  check(badRh.length === 0, 'the stated condition and the typed humidity agree', badRh.length + ' disagree');

  // THE reciprocal check, re-run here on the file rather than trusted from the
  // extractor that wrote it.
  const known = new Set(slips.map(s => s.fibre + '|specific_volume'));
  const broken = [];
  for (const f of fibres) {
    const conds = new Set(properties.filter(p => p.fibre_slug === f.slug).map(p => p.condition));
    for (const cond of conds) {
      const d = properties.find(p => p.fibre_slug === f.slug && p.property === 'density' && p.condition === cond);
      const v = properties.find(p => p.fibre_slug === f.slug && p.property === 'specific_volume' && p.condition === cond);
      if (!d || !v) { broken.push(`${f.slug}/${cond}: only one of the pair`); continue; }
      // Specific volume is the reciprocal of density, so across a range the
      // LOW density pairs with the HIGH specific volume. Comparing min to min
      // would fail every correctly-read range in Tables 5.2 and 5.3.
      const pairs = [[point(d), point(v)], [d.value_min, v.value_max], [d.value_max, v.value_min]];
      for (const [dd, vv] of pairs) {
        if (dd == null || vv == null) continue;
        if (Math.abs(vv - 1 / dd) > 0.011 && !known.has(f.slug + '|specific_volume')) {
          broken.push(`${f.slug}/${cond}: ${vv} is not 1/${dd}`);
        }
      }
    }
  }
  check(broken.length === 0, 'specific volume is the reciprocal of density in every row',
        broken.slice(0, 4).join('; '));
  check(slips.length === 1 && slips[0].fibre === 'carbon',
        'exactly one row fails it, and it is the one the book itself gets wrong',
        slips.map(s => s.fibre).join(', '));

  // Physical sanity, matching the table's own CHECK so nothing is rejected at
  // write time that could have been caught here with a readable message.
  const daft = properties.filter(p => {
    const v = p.value != null ? p.value : p.value_min;
    if (p.property === 'density') return !(v >= 0.5 && v <= 8.0);
    if (p.property === 'specific_volume') return !(v >= 0.1 && v <= 2.5);
    return false;
  });
  check(daft.length === 0, 'every value is physically possible', daft.map(p => p.fibre_slug).join(', '));

  // The database enforces value_min <= value_max, and the first import hit it:
  // specific-volume ranges are printed descending because they are reciprocals
  // of ascending densities. Checking it here means the next such case is a
  // readable message rather than a constraint violation halfway through a write.
  const unordered = properties.filter(p =>
    p.value_min != null && p.value_max != null && p.value_min > p.value_max);
  check(unordered.length === 0, 'every range runs low to high',
        unordered.map(p => `${p.fibre_slug}/${p.property} ${p.value_min}-${p.value_max}`).join('; '));

  const badPage = properties.filter(p => !(p.page >= 1 && p.page <= 746));
  check(badPage.length === 0, 'every citation points inside the book', badPage.length + ' do not');

  // And the point of the whole exercise: the engine has to agree with what is
  // about to be stored, for every fibre the book actually covers.
  const mismatched = [];
  for (const f of fibres.filter(x => x.engine_key)) {
    const want = properties.find(p =>
      p.fibre_slug === f.slug && p.property === 'density' && p.condition === '65% r.h.');
    const have = FIBER_PROPERTIES[f.engine_key];
    if (!want || !have) continue;
    if (Math.abs(have.density - want.value) > 0.005) {
      mismatched.push(`${f.engine_key}: engine ${have.density}, book ${want.value}`);
    }
  }
  check(mismatched.length === 0,
        'the engine constants match the conditioned densities being imported',
        mismatched.join('; '));

  return failures.length === 0;
}

async function write(payload) {
  let f = 0, p = 0;
  for (const fib of payload.fibres) {
    await query(
      `INSERT INTO fibres (slug, name, generic_class, origin, polymer, engine_key, page, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name, generic_class = EXCLUDED.generic_class,
         origin = EXCLUDED.origin, polymer = EXCLUDED.polymer,
         engine_key = EXCLUDED.engine_key, page = EXCLUDED.page, note = EXCLUDED.note`,
      [fib.slug, fib.name, fib.generic_class, fib.origin, fib.polymer,
       fib.engine_key, fib.page, `Printed in the book as "${fib.printed_name}".`]);
    f++;
  }
  for (const pr of payload.properties) {
    await query(
      `INSERT INTO fibre_properties
         (fibre_slug, property, value, value_min, value_max, unit, condition,
          temperature_c, rh_pct, method, source_key, page, table_ref, book_refs, quality, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (fibre_slug, property, condition, page) DO UPDATE SET
         value = EXCLUDED.value, value_min = EXCLUDED.value_min,
         value_max = EXCLUDED.value_max, unit = EXCLUDED.unit,
         rh_pct = EXCLUDED.rh_pct, table_ref = EXCLUDED.table_ref,
         book_refs = EXCLUDED.book_refs, quality = EXCLUDED.quality, note = EXCLUDED.note`,
      [pr.fibre_slug, pr.property, pr.value, pr.value_min, pr.value_max, pr.unit,
       pr.condition, pr.temperature_c, pr.rh_pct, pr.method, pr.source_key,
       pr.page, pr.table_ref, pr.book_refs, pr.quality, pr.note]);
    p++;
  }
  return { f, p };
}

(async () => {
  const payload = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  console.log('Fibre measurements — Morton & Hearle chapter 5, Tables %s',
              payload.source.tables.join(', '));

  const ok = verify(payload);
  console.log('\n' + '─'.repeat(60));
  if (!ok) {
    console.log(`GATE FAILED — ${passed} passed, ${failures.length} failed\n`);
    failures.forEach(x => console.log('  ✗ ' + x));
    console.log('\nNothing will be imported.');
    process.exitCode = 1;
    return;
  }
  console.log(`GATE PASSED — all ${passed} checks.`);
  if (!WRITE) { console.log('\nDry run. Re-run with --write to import.'); return; }

  const { f, p } = await write(payload);
  console.log(`\nImported ${f} fibres and ${p} measurements.`);

  const rows = await query(
    `SELECT property, condition, count(*)::int AS n
       FROM fibre_properties GROUP BY property, condition ORDER BY property, condition`);
  rows.forEach(r => console.log(`  ${r.property.padEnd(16)} ${(r.condition || 'unstated').padEnd(10)} ${r.n}`));
})()
  .catch(err => { console.error('\n[Import] ' + err.message); process.exitCode = 1; })
  .finally(() => close());
