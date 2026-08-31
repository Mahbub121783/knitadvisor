#!/usr/bin/env node
/**
 * IMPORT THE FIBRE MEASUREMENTS
 * =============================
 * Loads data/fibre-properties.json — the density, regain and tensile tables of
 * Morton & Hearle, read off the page by coordinate — into `fibres` and
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
  // A refusal is the extractor working, not failing: Table 7.3 prints figures
  // the book qualifies in words — "up to 12", "1.5 or 3", "low modulus 7 to
  // high modulus 1.2" — and a bare number would misstate every one of them.
  //
  // But an UNDECLARED refusal is a loss nobody sees. So the set is named here.
  // A new one fails the gate, which is the only way anyone finds out that a
  // row stopped parsing.
  const EXPECTED_REFUSALS = [
    'Mercerised cotton', 'Secondary acetate', 'Wool', 'Nylon 6.6, Nylon 6',
    'Polyester', 'Para-aramid', '(Kevlar, Twaron)',
  ];
  const refusedNames = refused.map(r => r.name).sort();
  const unexpected = refusedNames.filter(n => !EXPECTED_REFUSALS.includes(n));
  const recovered = EXPECTED_REFUSALS.filter(n => !refusedNames.includes(n));
  check(unexpected.length === 0, 'nothing was refused that was not expected to be',
        unexpected.join('; '));
  check(recovered.length === 0,
        'the rows the book qualifies in words are still the ones being refused',
        recovered.length ? 'these now parse — check they parse CORRECTLY: ' + recovered.join(', ') : '');
  check(refused.every(r => r.why && r.why.length > 10),
        'every refusal states a reason');
  check(fibres.length >= 63, 'the density, regain and tensile tables were read',
        fibres.length + ' fibres');
  check(properties.length >= 430, 'every column of every table came through',
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
    (p.condition && p.condition.startsWith('65% r.h.') && p.rh_pct !== 65) ||
    (p.condition === 'dry' && p.rh_pct !== 0) ||
    (p.condition === null && p.rh_pct !== null));
  check(badRh.length === 0, 'the stated condition and the typed humidity agree', badRh.length + ' disagree');

  // THE reciprocal check, re-run here on the file rather than trusted from the
  // extractor that wrote it.
  const known = new Set(slips.map(s => s.fibre + '|specific_volume'));
  const broken = [];
  for (const f of fibres) {
    // Only the conditions that actually carry a density. A fibre now also has
    // regain rows, at conditions where no density was ever measured, and an
    // earlier version of this check called those a broken pair.
    const conds = new Set(properties
      .filter(p => p.fibre_slug === f.slug && p.property === 'density')
      .map(p => p.condition));
    for (const cond of conds) {
      const d = properties.find(p => p.fibre_slug === f.slug && p.property === 'density' && p.condition === cond);
      const v = properties.find(p => p.fibre_slug === f.slug && p.property === 'specific_volume' && p.condition === cond);
      if (!d || !v) { broken.push(`${f.slug}/${cond}: a density with no specific volume`); continue; }
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
  // Two rows in the whole book fail an identity the book itself sets up, and
  // both are the book's arithmetic rather than ours. They are named, so a third
  // one appearing is a failure and not a shrug.
  const EXPECTED_SLIPS = ['carbon', 'viscose_tenasco'];
  const slipNames = slips.map(x => x.fibre).sort();
  check(slipNames.join(',') === EXPECTED_SLIPS.slice().sort().join(','),
        'the only rows failing a book identity are the two the book gets wrong',
        slipNames.join(', '));
  check(slips.every(x => x.note && x.note.length > 80),
        'each of them is argued, not merely listed');

  // Physical sanity, matching the table's own CHECK so nothing is rejected at
  // write time that could have been caught here with a readable message.
  const daft = properties.filter(p => {
    const v = p.value != null ? p.value : p.value_min;
    if (p.property === 'density') return !(v >= 0.5 && v <= 8.0);
    if (p.property === 'specific_volume') return !(v >= 0.1 && v <= 2.5);
    // No fibre holds its own weight in water at 65% r.h.; the highest in the
    // book is wool at 14-19%.
    if (p.property.includes('regain')) return !(v >= 0 && v <= 100);
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

  // ── Regain, which has its own two consistency rules ───────────────────
  // Hysteresis is the amount by which DESORPTION exceeds absorption, so it can
  // never be negative; and the commercial allowance is a trading figure that
  // sits inside or above the measured band, never wholly below it.
  const negativeHysteresis = properties.filter(p =>
    p.property === 'regain_hysteresis' && (p.value != null ? p.value : p.value_min) < 0);
  check(negativeHysteresis.length === 0,
        'desorption regain always exceeds absorption regain',
        negativeHysteresis.map(p => p.fibre_slug).join(', '));

  const belowBand = [];
  for (const f of fibres) {
    const a = properties.find(p => p.fibre_slug === f.slug && p.property === 'moisture_regain');
    const c = properties.find(p => p.fibre_slug === f.slug && p.property === 'commercial_regain');
    if (!a || !c) continue;
    const floor = a.value != null ? a.value : a.value_min;
    const allowance = c.value != null ? c.value : c.value_min;
    if (allowance < floor - 0.51) belowBand.push(`${f.slug}: ${allowance} < ${floor}`);
  }
  check(belowBand.length === 0,
        'no commercial allowance falls below the measured regain band', belowBand.join('; '));

  const regains = properties.filter(p => p.property.includes('regain'));
  check(regains.length >= 20, 'the regain table came through', regains.length + ' regain rows');

  // ── Tensile properties, chapter 13 ────────────────────────────────────
  //
  // The tensile tables have an identity of their own, and it is a better check
  // than the reciprocal because it ties FOUR columns together instead of two:
  //
  //     work of rupture = work factor x tenacity x breaking extension
  //
  // Work of rupture is the area under the stress-strain curve and the work
  // factor is that area as a fraction of the rectangle enclosing it, so the
  // relation is a definition, not a correlation. A column read one place off
  // breaks it at once. Table 13.1 prints the work factor and so checks itself;
  // Table 13.2 does not, so the factor is derived and required to be a
  // fraction, an area being unable to exceed the rectangle around it.
  //
  // Re-derived here from the file rather than trusted from the extractor, for
  // the same reason the reciprocal is.
  const TENSILE = ['tenacity', 'breaking_extension', 'work_of_rupture', 'initial_modulus'];
  const val = r => (r.value != null ? r.value : r.value_min);

  const tensileRows = new Map();          // fibre|page -> {property: row}
  for (const pr of properties) {
    if (!/^Table 13\.[12]$/.test(pr.table_ref || '')) continue;
    const key = pr.fibre_slug + '|' + pr.page;
    if (!tensileRows.has(key)) tensileRows.set(key, {});
    tensileRows.get(key)[pr.property] = pr;
  }
  check(tensileRows.size >= 35, 'the tensile tables came through',
        tensileRows.size + ' fibre-grades measured');

  const incomplete = [...tensileRows].filter(([, r]) => TENSILE.some(t => !r[t]));
  check(incomplete.length === 0,
        'every tensile row carries all four of tenacity, extension, work of rupture and modulus',
        incomplete.map(([k]) => k).join(', '));

  const brokenWork = [], brokenModulus = [];
  for (const [key, r] of tensileRows) {
    if (TENSILE.some(t => !r[t])) continue;
    const slug = key.split('|')[0];
    const t = val(r.tenacity), e = val(r.breaking_extension);
    const w = val(r.work_of_rupture), m = val(r.initial_modulus);
    // tenacity N/tex, extension %, work of rupture mN/tex — hence the 10.
    const rect = t * e * 10;
    if (r.work_factor) {
      const want = rect * val(r.work_factor);
      if (Math.abs(w - want) > Math.max(0.5, 0.06 * want) && !EXPECTED_SLIPS.includes(slug)) {
        brokenWork.push(`${key}: ${w} against ${want.toFixed(2)}`);
      }
    } else {
      const f = w / rect;
      if (!(f >= 0.20 && f <= 1.0)) brokenWork.push(`${key}: implied work factor ${f.toFixed(2)}`);
    }
    // The stress-strain curve lies above the chord to its breaking point, so
    // the slope at the origin cannot be shallower than that chord. Glass and
    // the elastomers are nearly linear to break, hence the 10% allowance.
    const chord = t * 100 / e;
    if (m < 0.9 * chord) brokenModulus.push(`${key}: modulus ${m} under chord ${chord.toFixed(2)}`);
  }
  check(brokenWork.length === 0,
        'work of rupture is the area under the curve in every tensile row',
        brokenWork.slice(0, 4).join('; '));
  check(brokenModulus.length === 0,
        'no initial modulus is shallower than the chord to its breaking point',
        brokenModulus.slice(0, 4).join('; '));

  // Table 13.7 gives eight ratios for every fibre it lists. A fibre with fewer
  // means a column was lost, not that the book left a cell empty.
  const RATIOS = ['tenacity_ratio', 'breaking_extension_ratio',
                  'work_of_rupture_ratio', 'initial_modulus_ratio'];
  const ratioRows = new Map();
  for (const pr of properties) {
    if (!RATIOS.includes(pr.property)) continue;
    ratioRows.set(pr.fibre_slug, (ratioRows.get(pr.fibre_slug) || 0) + 1);
  }
  const shortRatios = [...ratioRows].filter(([, n]) => n !== 8);
  check(ratioRows.size >= 12, 'the wet/dry ratio table came through',
        ratioRows.size + ' fibres');
  check(shortRatios.length === 0,
        'every fibre in the ratio table has all eight ratios',
        shortRatios.map(([k, n]) => `${k}: ${n}`).join(', '));

  const daftRatio = properties.filter(p =>
    RATIOS.includes(p.property) && !(val(p) > 0 && val(p) <= 10));
  check(daftRatio.length === 0, 'every ratio is a positive number under ten',
        daftRatio.map(p => `${p.fibre_slug}/${p.property}`).join(', '));

  // A ratio is dimensionless and a percentage is not. Storing "0.50" and "50"
  // under one property name would make every comparison wrong by a factor of
  // 100 with nothing to show for it, so the unit is held to one value per
  // property across the whole file.
  const unitsBy = new Map();
  for (const pr of properties) {
    if (!unitsBy.has(pr.property)) unitsBy.set(pr.property, new Set());
    unitsBy.get(pr.property).add(pr.unit);
  }
  const mixedUnits = [...unitsBy].filter(([, u]) => u.size !== 1);
  check(mixedUnits.length === 0, 'each property is stored in exactly one unit',
        mixedUnits.map(([k, u]) => `${k}: ${[...u].join('/')}`).join('; '));

  // Chapter 13 stores grades — nylon 6.6 runs from 0.37 N/tex as staple to 0.66
  // as high-tenacity filament — and exactly one grade per generic name may
  // claim the engine's key for it. Two claimants and the fibre the engine
  // compares against depends on import order, which is how a fibre acquires a
  // tenacity nobody chose.
  const claims = new Map();
  for (const f of fibres.filter(x => x.engine_key)) {
    claims.set(f.engine_key, (claims.get(f.engine_key) || []).concat(f.slug));
  }
  const contested = [...claims].filter(([, v]) => v.length > 1);
  check(contested.length === 0, 'no engine key is claimed by two fibres',
        contested.map(([k, v]) => `${k}: ${v.join(' and ')}`).join('; '));

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
       -- Targets the expression index from migration 008, not the columns: a
       -- plain UNIQUE treats NULLs as distinct, so rows whose condition the
       -- book never stated would be inserted afresh on every run.
       ON CONFLICT (fibre_slug, property, (coalesce(condition, '')), page) DO UPDATE SET
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
  console.log('Fibre measurements — Morton & Hearle, Tables %s',
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

  // The table must now hold exactly what the file holds. If it holds more, an
  // upsert failed to match and inserted a duplicate instead of updating — which
  // is how 13 extra rows reached production before migration 008. Counting
  // after the write is the only place that shows up.
  const [{ total }] = await query('SELECT count(*)::int AS total FROM fibre_properties');
  if (total !== payload.properties.length) {
    console.error(`
[Import] the table holds ${total} rows but the file has ` +
                  `${payload.properties.length}. An upsert did not match its own key.`);
    process.exitCode = 1;
    return;
  }
  console.log(`
${total} rows, matching the file exactly.`);
})()
  .catch(err => { console.error('\n[Import] ' + err.message); process.exitCode = 1; })
  .finally(() => close());
