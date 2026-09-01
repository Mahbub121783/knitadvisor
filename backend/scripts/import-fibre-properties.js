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
  check(fibres.length >= 73, 'every declared table was read',
        fibres.length + ' fibres');
  check(properties.length >= 975, 'every column of every table came through',
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

  // ── Swelling, chapter 11 ──────────────────────────────────────────────
  const SWELL = ['transverse_swelling_diameter', 'transverse_swelling_area',
                 'axial_swelling', 'volume_swelling'];
  const swell = new Map();
  for (const pr of properties) {
    if (!SWELL.includes(pr.property)) continue;
    if (!swell.has(pr.fibre_slug)) swell.set(pr.fibre_slug, {});
    swell.get(pr.fibre_slug)[pr.property] = pr;
  }
  check(swell.size >= 9, 'the swelling table came through', swell.size + ' fibres');

  // A body cannot swell more in cross-section than it does in volume: the
  // volume change is the area change compounded with the length change, and
  // nothing here gets shorter in water. This is geometry, so it holds for every
  // fibre regardless of shape.
  const impossible = [];
  for (const [slug, r] of swell) {
    const a = r.transverse_swelling_area, v = r.volume_swelling;
    if (!a || !v) continue;
    const aLo = a.value != null ? a.value : a.value_min;
    const vHi = v.value != null ? v.value : v.value_max;
    if (vHi < aLo) impossible.push(`${slug}: volume up to ${vHi}%, area from ${aLo}%`);
  }
  check(impossible.length === 0,
        'no fibre swells more in cross-section than it does in volume',
        impossible.join('; '));

  // Table 11.1 is the only table in the book whose rows WRAP: viscose reports
  // nine volume figures and they do not fit on one line, so three of them sit
  // on the next line with no fibre name against them. If the continuation is
  // not merged the row still exists and still looks reasonable — it just says
  // 109-117 instead of 74-127, and nothing anywhere would say a value was
  // dropped. This anchor is the only thing that would notice.
  const vs = (swell.get('viscose') || {}).volume_swelling;
  check(vs && vs.value_min === 74 && vs.value_max === 127,
        'the wrapped viscose row kept the values printed on its continuation lines',
        vs ? `${vs.value_min}-${vs.value_max}, expected 74-127` : 'no viscose volume swelling at all');

  // Acetate swells more by diameter than by area, which is impossible for a
  // circle and ordinary for a lobed cross-section — section 11.2.3 says exactly
  // that, and this row is the book's own illustration of it. It is asserted
  // rather than tolerated: if it ever stopped being inverted, the reading
  // changed, not the acetate.
  const ac = swell.get('acetate') || {};
  const acD = ac.transverse_swelling_diameter, acA = ac.transverse_swelling_area;
  check(acD && acA && acD.value_max > acA.value_max,
        "acetate's diameter swelling still exceeds its area swelling, as the book prints it",
        acD && acA ? `diameter ${acD.value_max}, area ${acA.value_max}` : 'one of the two is missing');

  // A range cannot show that a figure went missing from the middle of a cell.
  // Viscose's volume swelling is printed partly as separate words and partly as
  // one run-together word, "123,126,"; drop the 126 and the row still reads
  // 74-127 and every other check still passes. Only counting catches it.
  //
  // Sixty-seven is what page 240 prints, counted off the page cell by cell:
  // 6 cotton, 4 mercerised cotton, 3 flax, 3 jute, 20 viscose, 7 acetate,
  // 8 wool, 8 silk, 8 nylon.
  const swellRows = properties.filter(p => p.table_ref === 'Table 11.1');
  const figures = swellRows.reduce((a, p) => a + (p.value_count || 0), 0);
  check(figures === 67, 'every figure the swelling table prints was read',
        figures + ' of 67');
  const vsCount = (swellRows.find(p =>
    p.fibre_slug === 'viscose' && p.property === 'volume_swelling') || {}).value_count;
  check(vsCount === 9, 'viscose volume swelling kept all nine reported figures',
        vsCount + ' of 9');

  // The individual figures are what make the range interpretable, since it is a
  // disagreement between workers and not one worker's uncertainty.
  const bareRange = properties.filter(p =>
    SWELL.includes(p.property) && p.value_min != null &&
    !(p.note && /independently reported values/.test(p.note)));
  check(bareRange.length === 0,
        'every swelling range keeps the separate figures it was built from',
        bareRange.map(p => `${p.fibre_slug}/${p.property}`).join(', '));

  // ── Chapter 14: the weak link, and how much a fibre varies from itself ─
  //
  // THE CHECK THIS FILE HAS NEVER HAD. Everything above tests the extraction
  // against itself — a reciprocal, an identity, a range ordering — and a
  // consistent misreading passes all of them. This one does not: Tables 13.1
  // and 14.1 are different tables, on different pages, in different chapters,
  // measuring the same thing at the same 1 cm test length. Two separate
  // coordinate grids, read independently, have to agree.
  const at = (slug, cond, page) => properties.find(p =>
    p.fibre_slug === slug && p.property === 'tenacity' &&
    p.condition === cond && (page == null || p.page === page));

  const crossTable = [];
  for (const slug of ['cotton', 'nylon']) {
    const ch13 = at(slug, '65% r.h., 20 C');
    const ch14 = at(slug, '1 cm test length', 324);
    if (!ch13 || !ch14) { crossTable.push(`${slug}: only one of the two tables has it`); continue; }
    // Meredith reports 0.32 and 0.31 for cotton — a different specimen of the
    // same variety, printed to two figures. 5% is the width of that, not a
    // tolerance chosen to make the check pass.
    const rel = Math.abs(ch13.value - ch14.value) / ch14.value;
    if (rel > 0.05) {
      crossTable.push(`${slug}: Table 13.1 p.${ch13.page} says ${ch13.value}, Table 14.1 p.${ch14.page} says ${ch14.value}`);
    }
  }
  check(crossTable.length === 0,
        'chapters 13 and 14 agree on the fibres they both measure at 1 cm',
        crossTable.join('; '));

  // A shorter specimen holds fewer weak places, so it cannot test weaker. The
  // ordering is the whole content of the weak-link effect.
  const LENGTHS = ['1 cm test length', '1 mm test length', '0.1 mm test length'];
  const backwards = [];
  for (const slug of new Set(properties.filter(p => LENGTHS.includes(p.condition)).map(p => p.fibre_slug))) {
    for (const page of new Set(properties.filter(p =>
      p.fibre_slug === slug && LENGTHS.includes(p.condition)).map(p => p.page))) {
      const seq = LENGTHS.map(c => at(slug, c, page)).filter(Boolean).map(r => r.value);
      for (let i = 1; i < seq.length; i++) {
        if (seq[i] < seq[i - 1]) backwards.push(`${slug} p.${page}: ${seq[i - 1]} then ${seq[i]}`);
      }
    }
  }
  check(backwards.length === 0,
        'no fibre tests weaker over a shorter specimen than a longer one',
        backwards.join('; '));

  // Table 14.3's third column is Peirce's theory applied to the first two, not
  // a measurement, and it is dropped. 0.688 is the value it prints for two of
  // the four varieties, so its presence anywhere means a calculated figure got
  // filed beside measured ones.
  const calculated = properties.filter(p =>
    p.table_ref === 'Table 14.3' && p.property === 'tenacity' && p.value === 0.688);
  check(calculated.length === 0,
        "the calculated column of Table 14.3 was read for its position and not stored",
        calculated.length + ' calculated values were stored as measurements');

  // Coefficients of variation, and the conclusion the book draws from them in
  // its own words: "the natural vegetable fibres show a large coefficient of
  // variation; the natural protein fibres and rayon are rather more regular,
  // and synthetic fibres such as nylon show only a small variability." If the
  // extraction ever stopped saying that, it stopped reading the table.
  const cv = (slug, prop) => {
    const r = properties.find(p => p.fibre_slug === slug && p.property === prop);
    return r ? (r.value != null ? r.value : r.value_min) : null;
  };
  // Table 14.6's own four coefficients, named rather than matched on a `cv_`
  // prefix: chapter 19 later added a coefficient of variance for flex fatigue
  // life, which is a different table measuring a different thing, and a prefix
  // match silently counted it here.
  const TABLE_14_6 = ['cv_fineness', 'cv_breaking_load', 'cv_tenacity', 'cv_breaking_extension'];
  const cvRows = properties.filter(p => TABLE_14_6.includes(p.property));
  check(cvRows.length === 24, 'the variability table came through', cvRows.length + ' of 24');
  check(cvRows.every(p => { const v = p.value != null ? p.value : p.value_min; return v > 0 && v <= 100; }),
        'every coefficient of variation is a percentage above zero');
  const cotCv = cv('cotton', 'cv_tenacity'), nyCv = cv('nylon', 'cv_tenacity');
  check(cotCv != null && nyCv != null && cotCv > 3 * nyCv,
        "cotton's fibres still vary several times as much as nylon's, as the text says",
        `cotton ${cotCv}%, nylon ${nyCv}%`);

  // ── Chapter 25: friction ──────────────────────────────────────────────
  const FRICTION = ['friction_static', 'friction_kinetic', 'friction_crossed_fibres',
                    'friction_parallel_fibres', 'friction_over_guide'];
  const fric = properties.filter(p => FRICTION.includes(p.property));
  check(fric.length >= 60, 'the friction tables came through', fric.length + ' contacts');
  check(fric.every(p => { const v = p.value != null ? p.value : p.value_max; return v > 0 && v <= 2; }),
        'every coefficient of friction is a positive number under two');

  // Starting a slide is never easier than continuing one, so static cannot come
  // out below kinetic. A row where it does has had its two columns swapped.
  const stickSlip = [];
  for (const st of properties.filter(p => p.property === 'friction_static')) {
    const ki = properties.find(p => p.property === 'friction_kinetic' &&
      p.fibre_slug === st.fibre_slug && p.condition === st.condition && p.page === st.page);
    if (!ki) { stickSlip.push(`${st.fibre_slug} ${st.condition}: static with no kinetic`); continue; }
    if (st.value < ki.value) stickSlip.push(`${st.fibre_slug} ${st.condition}: ${st.value} < ${ki.value}`);
  }
  check(stickSlip.length === 0,
        'static friction is never below kinetic, and every static has its kinetic',
        stickSlip.join('; '));

  // The one that matters most. Wool's friction has a DIRECTION — 0.13 with the
  // scales, 0.61 against them — and that difference is the whole mechanism of
  // felting. If it ever stopped appearing, the two rows had been collapsed into
  // one and the engine would have lost the only reason wool mats.
  const wool = (cond, prop) => {
    const r = properties.find(p => p.fibre_slug === 'wool' && p.property === prop &&
      p.condition === cond);
    return r ? (r.value != null ? r.value : r.value_max) : null;
  };
  const withScales = wool('on wool, with the scales', 'friction_static');
  const against = wool('on wool, against the scales', 'friction_static');
  check(withScales != null && against != null && against > 2 * withScales,
        "wool's friction against its scales is still several times its friction with them",
        `with ${withScales}, against ${against}`);

  // And it is a property of the wool, not of the pair: it survives every
  // counterface the book tried.
  const directional = [];
  for (const face of ['on wool', 'on viscose rayon', 'on nylon']) {
    const w = wool(`${face}, with the scales`, 'friction_static');
    const a = wool(`${face}, against the scales`, 'friction_static');
    if (w == null || a == null) { directional.push(`${face}: one direction missing`); continue; }
    if (a <= w) directional.push(`${face}: against ${a} is not above with ${w}`);
  }
  check(directional.length === 0,
        'the direction is in the wool, not in the counterface — it holds against all three',
        directional.join('; '));

  // Steel and porcelain run higher than a fibre pulley or ceramic for every
  // yarn in Table 25.6(b). Nothing here claims ceramic beats the pulley; it
  // does not, consistently.
  const guideOf = (slug, cond) => {
    const r = properties.find(p => p.property === 'friction_over_guide' &&
      p.fibre_slug === slug && p.condition === cond);
    return r ? r.value : null;
  };
  const guideRows = properties.filter(p => p.property === 'friction_over_guide');
  const prefixes = [...new Set(guideRows.map(p => p.condition.replace(/over .*/, '')))];
  const softer = [];
  for (const slug of new Set(guideRows.map(p => p.fibre_slug))) {
    for (const pre of prefixes) {
      const hard = ['over hard steel', 'over porcelain'].map(g => guideOf(slug, pre + g)).filter(v => v != null);
      const soft = ['over a fibre pulley', 'over ceramic'].map(g => guideOf(slug, pre + g)).filter(v => v != null);
      if (!hard.length || !soft.length) continue;
      if (Math.min(...hard) < Math.max(...soft)) {
        softer.push(`${slug} ${pre}: hard ${Math.min(...hard)}, soft ${Math.max(...soft)}`);
      }
    }
  }
  check(softer.length === 0,
        'steel and porcelain run higher than a fibre pulley or ceramic for every yarn',
        softer.join('; '));

  // A printed range and two workers disagreeing are different statements and
  // arrive as the same pair of numbers. Nylon's 0.14-0.6 is one range; cotton's
  // "0.29, 0.57" is two people. Both must say which they are.
  const kinds = properties.filter(p => p.cell_kind);
  check(kinds.every(p => ['single', 'range', 'list'].includes(p.cell_kind)),
        'every multi-value cell records how the book printed it');
  const nylonCrossed = properties.find(p => p.fibre_slug === 'nylon' && p.property === 'friction_crossed_fibres');
  const cottonCrossed = properties.find(p => p.fibre_slug === 'cotton' && p.property === 'friction_crossed_fibres');
  check(nylonCrossed && nylonCrossed.cell_kind === 'range',
        "nylon's 0.14-0.6 is stored as the range the book prints",
        nylonCrossed ? nylonCrossed.cell_kind : 'missing');
  check(cottonCrossed && cottonCrossed.cell_kind === 'list',
        "cotton's 0.29 and 0.57 are stored as two workers, not as a range",
        cottonCrossed ? cottonCrossed.cell_kind : 'missing');

  // ── Chapter 24: optical ───────────────────────────────────────────────
  const optical = properties.filter(p => /^(refractive_index|birefringence)/.test(p.property));
  check(optical.length >= 42, 'the refractive indices came through', optical.length + ' rows');

  // Birefringence is DEFINED as the difference between the two indices, so
  // every row proves itself. A column read one place out breaks it at once.
  const birOff = [];
  for (const b of properties.filter(p => p.property === 'birefringence')) {
    const at = pr => properties.find(x => x.fibre_slug === b.fibre_slug &&
      x.property === pr && x.page === b.page &&
      (x.condition || '').replace(/,? ?light polarised.*/, '') === (b.condition || ''));
    const par = at('refractive_index_parallel'), per = at('refractive_index_perpendicular');
    if (!par || !per) { birOff.push(`${b.fibre_slug}: an index is missing`); continue; }
    if (Math.abs(b.value - (par.value - per.value)) > 0.0011) {
      birOff.push(`${b.fibre_slug}: ${b.value} is not ${par.value} - ${per.value}`);
    }
  }
  check(birOff.length === 0,
        'every birefringence is the difference between its own two indices',
        birOff.join('; '));

  // Two fibres in the book are negatively birefringent: their chains lie across
  // the fibre, not along it. If these ever come back positive, the sign was
  // dropped and the physics reversed.
  const negative = properties.filter(p => p.property === 'birefringence' && p.value < 0)
                             .map(p => p.fibre_slug).sort();
  check(negative.join(',') === 'acrylic_acrilan,triacetate',
        'triacetate and Acrilan keep their negative birefringence',
        negative.join(', ') || 'none are negative');

  // Polyester is the most orientated fibre in the table by a wide margin, which
  // is the single fact chapter 13 leans on when it links orientation to
  // strength.
  const bir = s2 => { const r = properties.find(p => p.property === 'birefringence' && p.fibre_slug === s2); return r ? r.value : null; };
  check(bir('polyester') > 3 * bir('cotton'),
        'polyester is still far more orientated than cotton',
        `polyester ${bir('polyester')}, cotton ${bir('cotton')}`);

  // ── Chapter 24: lustre ────────────────────────────────────────────────
  // The finding is the SERIES, not any row: lustre rises as the cross-section
  // gets rounder, and mercerised cotton sits at the round end. If this ever
  // stops holding, the two columns have been swapped.
  const lus = properties.filter(p => p.property === 'lustre');
  const ell = properties.filter(p => p.property === 'fibre_ellipticity');
  check(lus.length === 15 && ell.length === 15,
        'all fifteen cottons of Table 24.5 came through',
        `${lus.length} lustres, ${ell.length} ellipticities`);
  const pairs = lus.map(l => ({
    variety: l.condition, lustre: l.value,
    ab: (ell.find(e => e.condition === l.condition) || {}).value,
  })).filter(x => x.ab != null);
  check(pairs.length === 15, 'every lustre has its ellipticity');
  const rounded = pairs.filter(x => /mercerised/.test(x.variety));
  const natural = pairs.filter(x => !/mercerised/.test(x.variety));
  check(Math.max(...rounded.map(x => x.ab)) < Math.min(...natural.map(x => x.ab)),
        'mercerised cotton is rounder than every natural variety measured');
  check(Math.min(...rounded.map(x => x.lustre)) > Math.max(...natural.map(x => x.lustre)),
        'and more lustrous than every one of them');

  // Spearman rank correlation between ellipticity and lustre. It should be
  // strongly NEGATIVE: flatter fibre, duller cloth. Rank rather than value,
  // because the lustre scale is arbitrary and only its order means anything.
  const rank = key => {
    const sorted = [...pairs].sort((a, b2) => a[key] - b2[key]);
    const r = new Map(); sorted.forEach((x, i) => r.set(x.variety, i + 1)); return r;
  };
  const ra = rank('ab'), rl = rank('lustre');
  const n = pairs.length;
  const d2 = pairs.reduce((acc, x) => acc + (ra.get(x.variety) - rl.get(x.variety)) ** 2, 0);
  const rho = 1 - (6 * d2) / (n * (n * n - 1));
  check(rho < -0.85,
        'lustre still runs against ellipticity across the whole series',
        `Spearman rho = ${rho.toFixed(3)}`);

  // ── Chapter 15: elastic recovery ──────────────────────────────────────
  const rec = properties.filter(p => p.property === 'elastic_recovery');
  check(rec.length >= 50, 'Table 15.2 came through at every extension', rec.length + ' rows');
  check(rec.every(p => p.value >= 0 && p.value <= 100), 'every recovery is a percentage');

  // Recovery can only get worse as the fibre is pulled further: stretching past
  // the point where recovery was already incomplete cannot bring more back.
  const rising = [];
  for (const slug of new Set(rec.map(p => p.fibre_slug))) {
    for (const rh of [60, 90]) {
      const series = [1, 5, 10].map(e => rec.find(p => p.fibre_slug === slug &&
        p.rh_pct === rh && p.condition.startsWith(`from ${e}% `))).filter(Boolean);
      for (let i = 1; i < series.length; i++) {
        if (series[i].value > series[i - 1].value + 0.5) {
          rising.push(`${slug} at ${rh}%: ${series[i - 1].value} → ${series[i].value}`);
        }
      }
    }
  }
  check(rising.length === 0,
        'recovery never improves as the fibre is stretched further', rising.join('; '));

  // The two fibres a knitter most needs told apart, and the gap between them.
  const rv = (slug, e) => { const r = rec.find(p => p.fibre_slug === slug &&
    p.rh_pct === 60 && p.condition.startsWith(`from ${e}% `)); return r ? r.value : null; };
  check(rv('nylon', 10) >= 85 && rv('viscose', 10) <= 30,
        'nylon still recovers from a 10% pull and viscose still does not',
        `nylon ${rv('nylon', 10)}, viscose ${rv('viscose', 10)}`);
  check(rv('cotton', 1) - rv('cotton', 5) > 30,
        "cotton's recovery still collapses between a 1% pull and a 5% one",
        `${rv('cotton', 1)} → ${rv('cotton', 5)}`);

  // Table 15.1, checked against the book's own reading of it.
  const ySS = properties.filter(p => p.property === 'yield_stress' &&
    p.condition === 'yield point from the stress-strain curve');
  const yieldOff = ySS.filter(a => {
    const b = properties.find(p => p.property === 'yield_stress' &&
      p.fibre_slug === a.fibre_slug && p.condition === 'yield point from the recovery curve');
    return b && a.value < b.value;
  });
  check(ySS.length >= 7 && yieldOff.length === 0,
        'the stress-strain yield still runs above the recovery yield, as the book says',
        yieldOff.map(x => x.fibre_slug).join(', '));

  // ── Chapter 17: bending, twisting, and the loop ───────────────────────
  const look = (slug, prop, cond) => {
    const r = properties.find(x => x.fibre_slug === slug && x.property === prop &&
      (cond === undefined || x.condition === cond));
    return r ? (r.value != null ? r.value : r.value_min) : null;
  };
  const flex = properties.filter(p => p.property === 'specific_flexural_rigidity');
  const tors = properties.filter(p => p.property === 'specific_torsional_rigidity');
  check(flex.length >= 18 && tors.length >= 12,
        'the bending and torsion tables came through',
        `${flex.length} flexural, ${tors.length} torsional`);

  // A solid resists bending more than twisting, always — the shear modulus is
  // below the tensile one. The two columns are the same units in the same
  // format three apart, which is exactly how they get swapped.
  const swapped = [];
  for (const t of tors) {
    const f = properties.find(x => x.fibre_slug === t.fibre_slug &&
      x.property === 'specific_flexural_rigidity' && x.page === t.page);
    if (!f) { swapped.push(`${t.fibre_slug}: torsion with no flexure on p.${t.page}`); continue; }
    const tv = t.value != null ? t.value : t.value_min;
    const fv = f.value != null ? f.value : f.value_min;
    if (tv > fv) swapped.push(`${t.fibre_slug}: torsion ${tv} above flexure ${fv}`);
  }
  check(swapped.length === 0,
        'torsional rigidity stays below flexural in every row, as it must',
        swapped.join('; '));

  // Cotton is several times stiffer in torsion than nylon, which is why cotton
  // jersey spirals and nylon does not. If this ever inverts, the engine's
  // spirality advice inverts with it.
  const ctors = look('cotton', 'specific_torsional_rigidity');
  const ntors = look('nylon', 'specific_torsional_rigidity');
  check(ctors > 3 * ntors,
        'cotton is still far stiffer in torsion than nylon',
        `cotton ${ctors}, nylon ${ntors}`);

  // Two workers, two flexural rigidities for silk, three times apart. Both are
  // kept: preferring one silently would hide how uncertain the quantity is.
  const silkFlex = flex.filter(p => p.fibre_slug === 'silk').map(p => p.value).sort();
  check(silkFlex.length === 2 && silkFlex[1] > 2.5 * silkFlex[0],
        "both workers' figures for silk's flexural rigidity survive, disagreement intact",
        silkFlex.join(' and '));

  const loops = properties.filter(p => p.property === 'loop_strength_pct');
  check(loops.length >= 9 && loops.every(p => {
    const v = p.value != null ? p.value : p.value_max;
    return v > 0 && v <= 100;
  }), 'no looped yarn is stronger than the same yarn pulled straight');
  // The finding a knitter needs: viscose loses over a third of its strength to
  // the geometry of a stitch alone, before anything else happens to it.
  const viscoseLoop = look('viscose', 'loop_strength_pct');
  const cottonLoop = look('cotton', 'loop_strength_pct');
  check(viscoseLoop < 65 && cottonLoop > 85,
        'viscose still gives up a third of its strength to being looped, and cotton does not',
        `viscose ${viscoseLoop}%, cotton ${cottonLoop}%`);

  // ── Chapter 16: repeated loading ──────────────────────────────────────
  const cyc = properties.filter(p => p.property === 'cyclic_extension_growth_pct');
  // Thirteen, not fourteen: linen's cell was refused because the book imposed
  // 1.5% extension on it rather than 2%, so its figure is not comparable with
  // the rest of the column. The rest of linen's row survived.
  check(cyc.length >= 13, 'Table 16.1 came through', cyc.length + ' rows');
  // Extension accumulates; it does not un-accumulate.
  const shrinking = [];
  for (const slug of new Set(cyc.map(p => p.fibre_slug))) {
    const e10 = at(slug, 'cyclic_extension_growth_pct', 'by cycle 10, at 2% imposed extension');
    const e1k = at(slug, 'cyclic_extension_growth_pct', 'by cycle 1000, at 2% imposed extension');
    if (e10 != null && e1k != null && e1k < e10) shrinking.push(`${slug}: ${e10} → ${e1k}`);
  }
  check(shrinking.length === 0,
        'accumulated extension never falls between cycle 10 and cycle 1000', shrinking.join('; '));
  check(look('cotton', 'cyclic_extension_growth_pct', 'by cycle 10, at 2% imposed extension') >
        5 * look('nylon', 'cyclic_extension_growth_pct', 'by cycle 10, at 2% imposed extension'),
        'cotton still accumulates several times the extension nylon does under the same cycling');

  // Cell-level refusal: linen's footnoted figure is genuinely not comparable —
  // its extension was imposed at 1.5%, not 2% — but the rest of its row is
  // sound and must survive.
  check(look('flax', 'cyclic_stress_mn_tex', 'at cycle 10, 2% imposed extension') != null,
        "linen keeps the sound cells of a row whose footnoted cell was refused");
  check(look('flax', 'cyclic_extension_growth_pct', 'by cycle 10, at 2% imposed extension') == null,
        'and the footnoted cell itself is not stored');

  // ── Chapter 6: heat ───────────────────────────────────────────────────
  // The finding, and the one a sign error would destroy: nylon and polyester
  // CONTRACT on heating. The book sets the minus as a separate word, so read
  // naively they come out positive and the basis of heat setting is reversed.
  const nylonExp = look('nylon', 'linear_expansion_axial');
  const polyExp = look('polyester', 'linear_expansion_axial');
  check(nylonExp < 0 && polyExp < 0,
        'nylon and polyester still contract on heating',
        `nylon ${nylonExp}, polyester ${polyExp}`);
  check(look('cotton', 'linear_expansion_axial') > 0 && look('acrylic', 'linear_expansion_axial') > 0,
        'and cotton and acrylic still expand, so the sign is read and not assumed');

  const cond = properties.filter(p => p.property === 'thermal_conductivity');
  check(cond.length === 3 && cond.every(p => p.value > 25 && p.value < 100),
        'every fibre pad conducts more than still air (25) and less than four times it',
        cond.map(p => `${p.fibre_slug} ${p.value}`).join(', '));
  check(look('wool', 'thermal_conductivity') < look('cotton', 'thermal_conductivity'),
        'wool still conducts less than cotton at equal packing, so it is warmer at equal weight');

  // ── Chapter 18: heat ──────────────────────────────────────────────────
  const melt = properties.filter(p => p.property === 'melting_point');
  check(melt.length === 8, 'every melting point in Table 18.1 came through', melt.length + '');
  // The same generic name, forty-five degrees apart. If these ever collapse to
  // one figure, a stenter setting has been made out of a fibre family.
  check(look('nylon6', 'melting_point') === 215 && look('nylon', 'melting_point') === 260,
        'nylon 6 and nylon 6.6 keep their separate melting points',
        `${look('nylon6', 'melting_point')} and ${look('nylon', 'melting_point')}`);
  // Polypropylene melts below where polyester is set, which is why they cannot
  // share a frame.
  check(look('polypropylene', 'melting_point') < look('polyester', 'melting_point') - 50,
        'polypropylene still melts far below polyester');
  // Cellulosics and proteins decompose rather than melt, so they must NOT have
  // acquired a melting point from anywhere.
  const shouldNotMelt = ['cotton', 'wool', 'silk', 'viscose', 'flax', 'jute'];
  const wrongly = shouldNotMelt.filter(f => look(f, 'melting_point') != null);
  check(wrongly.length === 0,
        'no cellulosic or protein fibre has been given a melting point — they char',
        wrongly.join(', '));

  const heat = properties.filter(p => p.property === 'strength_retained_pct');
  check(heat.length === 30, 'Table 18.3 came through', heat.length + ' rows');
  check(heat.every(p => p.value >= 0 && p.value <= 100),
        'no fibre gains strength from eighty days of heat');
  // Damage accumulates: longer is never kinder, and hotter is never kinder.
  const kinder = [];
  for (const slug of new Set(heat.map(p => p.fibre_slug))) {
    const g = (d, t) => look(slug, 'strength_retained_pct', `after ${d} days at ${t} C`);
    for (const t of [100, 130]) {
      if (g(20, t) != null && g(80, t) != null && g(80, t) > g(20, t)) {
        kinder.push(`${slug} at ${t}C: 20d ${g(20, t)} → 80d ${g(80, t)}`);
      }
    }
    for (const d of [20, 80]) {
      if (g(d, 100) != null && g(d, 130) != null && g(d, 130) > g(d, 100)) {
        kinder.push(`${slug} at ${d}d: 100C ${g(d, 100)} → 130C ${g(d, 130)}`);
      }
    }
  }
  check(kinder.length === 0,
        'longer and hotter are never kinder, in any row', kinder.join('; '));
  // The finding a finisher acts on.
  check(look('cotton', 'strength_retained_pct', 'after 80 days at 130 C') < 20 &&
        look('polyester', 'strength_retained_pct', 'after 80 days at 130 C') > 60,
        'cotton still loses almost everything to prolonged 130 C and polyester does not',
        `cotton ${look('cotton', 'strength_retained_pct', 'after 80 days at 130 C')}%, ` +
        `polyester ${look('polyester', 'strength_retained_pct', 'after 80 days at 130 C')}%`);

  // ── Chapter 22: static ────────────────────────────────────────────────
  const stat = properties.filter(p => p.property === 'rh_for_static_threshold');
  check(stat.length === 15, 'Table 22.1 came through', stat.length + ' rows');
  check(stat.every(p => p.value > 0 && p.value <= 100), 'every threshold is a humidity');

  // The finding, and the reason the problem arrived with the synthetics: a
  // cellulosic is safe below any working floor and a synthetic is not safe
  // above one.
  const cellulosic = ['cotton', 'flax', 'viscose', 'mercerised_cotton'];
  const synthetic = ['acetate', 'nylon', 'acrylic', 'polyester'];
  const cellMax = Math.max(...stat.filter(p => cellulosic.includes(p.fibre_slug)).map(p => p.value));
  const synMin = Math.min(...stat.filter(p => synthetic.includes(p.fibre_slug)).map(p => p.value));
  check(cellMax <= 40 && synMin >= 80,
        'cellulosics still leak charge below any working floor and synthetics still do not',
        `cellulosic worst ${cellMax}%, synthetic best ${synMin}%`);

  // Stripping the spin finish makes it worse, which is the measured proof that
  // the finish and not the polymer is what carries the charge away.
  for (const f of ['acrylic', 'polyester']) {
    const asRec = look(f, 'rh_for_static_threshold', 'as received, spin finish on, r.h. at which resistance reaches 1e10 ohm g/m2');
    const pure = look(f, 'rh_for_static_threshold', 'purified, spin finish removed, r.h. at which resistance reaches 1e10 ohm g/m2');
    check(asRec != null && pure != null && pure > asRec,
          `${f} still gets worse when its spin finish is removed`,
          `as received ${asRec}%, purified ${pure}%`);
  }

  // WHAT THIS TABLE DOES NOT SAY, recorded because the first version of this
  // check asserted it and was wrong.
  //
  // It is tempting to require that a fibre more resistant at 65% r.h. needs a
  // higher humidity to fall to the threshold. It does not hold, and polyester
  // is the counter-example the table itself supplies: 10^8.0 at 65% r.h., which
  // is already a hundred times BELOW the threshold, and yet a threshold
  // humidity of 85%. Read as one curve per fibre that is a contradiction.
  //
  // It is not one curve. The first column of this table is the SLOPE of
  // resistance against moisture, and it runs from 10.5 for mercerised cotton to
  // 17.6 for silk — the fibres cross the threshold from quite different
  // directions at quite different rates, and two points on two different curves
  // cannot be ordered against each other. The book prints that slope column
  // precisely because the relation needs it.
  //
  // So the comparison is made only WITHIN a fibre, where the curve is the same
  // one and the only thing that changed is the surface. Stripping the finish
  // must raise both the resistance and the threshold, and it does in every
  // pair the book prints.
  const withinFibre = [];
  for (const t of stat) {
    const bare = (t.condition || '').replace(/,? ?r\.h\. at which.*$/, '');
    if (!/washed|purified/.test(bare)) continue;
    const plainRh = look(t.fibre_slug, 'rh_for_static_threshold',
                         'r.h. at which resistance reaches 1e10 ohm g/m2');
    if (plainRh == null) continue;
    if (t.value < plainRh) {
      withinFibre.push(`${t.fibre_slug} ${bare}: ${t.value}% against ${plainRh}% untreated`);
    }
  }
  check(withinFibre.length === 0,
        'stripping the finish never makes a fibre EASIER to discharge',
        withinFibre.join('; '));

  // ── Chapter 8: the heat moisture releases ─────────────────────────────
  const sorb = properties.filter(p => p.property === 'heat_of_sorption');
  check(sorb.length === 6, 'Table 8.5 came through', sorb.length + ' rows');
  check(sorb.every(p => p.value > 0), 'absorbing water releases heat, never absorbs it');
  check(look('wool', 'heat_of_sorption') > 30 * look('polyester', 'heat_of_sorption'),
        'wool still releases many times the heat polyester does',
        `wool ${look('wool', 'heat_of_sorption')}, polyester ${look('polyester', 'heat_of_sorption')}`);
  // Reported because it is surprising, and because a rule that quietly ranked
  // wool first would be fitting the data to the marketing.
  check(look('viscose', 'heat_of_sorption') > look('wool', 'heat_of_sorption'),
        'viscose still out-warms wool on this measure, surprising as that is');

  // ── Chapter 10: the water a machine leaves behind ─────────────────────
  const wat = properties.filter(p => p.property === 'water_retained');
  check(wat.length === 14, 'Table 10.1 came through', wat.length + ' rows');
  const spunDry = (slug, cond) => look(slug, 'water_retained',
    (cond ? cond + ', ' : '') + 'after centrifuging at 1000g for 5 min');
  const sucked = (slug, cond) => look(slug, 'water_retained',
    (cond ? cond + ', ' : '') + 'after suction at 30 cm Hg (40 kPa)');
  const worse = [];
  for (const slug of new Set(wat.map(p => p.fibre_slug))) {
    for (const cond of [null, 'loose fibre', '0.11 dtex per filament', '1.1 dtex per filament']) {
      const a = sucked(slug, cond), b = spunDry(slug, cond);
      if (a != null && b != null && b > a) worse.push(`${slug}: spun ${b} > sucked ${a}`);
    }
  }
  check(worse.length === 0,
        'centrifuging never leaves more water than suction', worse.join('; '));
  check(spunDry('viscose') > 2 * spunDry('cotton'),
        'viscose still carries over twice cotton\'s water into the dryer',
        `viscose ${spunDry('viscose')}%, cotton ${spunDry('cotton')}%`);
  // Wool's water is between the fibres, not in them, so spinning it out works
  // where suction does not. That gap is the finding.
  check(sucked('wool', 'loose fibre') > 2 * spunDry('wool', 'loose fibre'),
        "wool's held water still yields to force and not to pressure",
        `suction ${sucked('wool', 'loose fibre')}%, centrifuge ${spunDry('wool', 'loose fibre')}%`);

  // ── Chapter 19: the fold ──────────────────────────────────────────────
  const flexLife = properties.filter(p => p.property === 'flex_fatigue_life');
  check(flexLife.length === 6, 'Table 19.4 came through', flexLife.length + ' rows');
  // The thousands space. Without the join every one of these is under a
  // thousand, and a two-digit fatigue life looks entirely ordinary beside a
  // bending strain of 16.1.
  check(flexLife.every(p => p.value >= 1000),
        'every fatigue life is a five- or six-figure cycle count, so the thousands space was joined',
        flexLife.map(p => p.value).join(', '));
  for (const slug of new Set(flexLife.map(p => p.fibre_slug))) {
    const mean = look(slug, 'flex_fatigue_life', 'mean, 65% r.h., 20 C');
    const med = look(slug, 'flex_fatigue_life', 'median, 65% r.h., 20 C');
    check(mean >= med, `${slug}: the mean fatigue life sits at or above the median, as a skewed distribution requires`,
          `mean ${mean}, median ${med}`);
  }
  check(look('polyester', 'flex_fatigue_life', 'mean, 65% r.h., 20 C') >
        4 * look('nylon6', 'flex_fatigue_life', 'mean, 65% r.h., 20 C'),
        'polyester still survives several times the bends nylon 6 does');

  // ── A column that is not new information, and is therefore a check ────
  //
  // The standard deviation of tenacity is its coefficient of variation times
  // its mean, so it tells a reader nothing the CV column does not — which is
  // why it gets no finding: inventing advice out of a restatement is padding.
  // What it is good for is catching a misread, because a reader that took a
  // value from the wrong row breaks the identity while leaving a
  // plausible-looking number behind.
  //
  // (Specific volume against density and birefringence against its two indices
  // are the same kind of check and are already made further up this gate.)
  const sdMismatch = [];
  for (const sd of properties.filter(x => x.property === 'tenacity_sd')) {
    const cv = properties.find(x => x.fibre_slug === sd.fibre_slug &&
      x.property === 'cv_tenacity');
    const ten = properties.find(x => x.fibre_slug === sd.fibre_slug &&
      x.property === 'tenacity' && x.page === sd.page);
    if (!cv || !ten || cv.value == null || ten.value == null || sd.value == null) continue;
    const implied = 100 * sd.value / ten.value;
    // The CV is printed as a whole number, so five points of slack. The check
    // is for a column swap, not for the last digit.
    if (Math.abs(implied - cv.value) > 5) {
      sdMismatch.push(`${sd.fibre_slug}: sd ${sd.value} on tenacity ${ten.value} implies ` +
        `${implied.toFixed(0)}% but the book prints CV ${cv.value}%`);
    }
  }
  check(sdMismatch.length === 0,
        'the printed tenacity standard deviation still agrees with the printed CV',
        sdMismatch.join('; '));

  // ── Table 17.2: the two moduli must not have been crossed ─────────────
  // E and G sit in adjacent columns in the same units, so a reader that took
  // them in the wrong order produces two plausible numbers. The physics
  // forbids it: no real fibre resists twisting better relative to stretching
  // than an unoriented solid, whose E/G is 2(1+v), about 2.6.
  const crossed = [];
  for (const e of properties.filter(x => x.property === 'tensile_modulus_gpa')) {
    const g = properties.find(x => x.fibre_slug === e.fibre_slug &&
      x.property === 'shear_modulus' && x.page === e.page);
    if (!g) continue;
    const half = r => (r.value != null ? r.value : (r.value_min + r.value_max) / 2);
    if (half(e) / half(g) < 2.6) {
      crossed.push(`${e.fibre_slug}: E/G = ${(half(e) / half(g)).toFixed(2)}`);
    }
  }
  check(crossed.length === 0,
        'every fibre still resists a pull at least as hard as an isotropic solid would relative ' +
        'to a twist, so E and G are not crossed',
        crossed.join('; '));

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
