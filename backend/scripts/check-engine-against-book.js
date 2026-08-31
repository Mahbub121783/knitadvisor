#!/usr/bin/env node
/**
 * DOES THE ENGINE AGREE WITH THE BOOK?
 * ====================================
 * Compares the fibre constants the calculation engine actually uses against the
 * measurements extracted from Morton & Hearle, and says where they differ.
 *
 *   node scripts/check-engine-against-book.js          report
 *   node scripts/check-engine-against-book.js --strict  exit 1 on any mismatch
 *
 * WHY THIS EXISTS
 * ---------------
 * Storing a book in a database changes nothing on its own. The engine reads
 * FIBER_PROPERTIES in engine/domain/yarn-engine.js — ten fibres, hard-coded,
 * cited to "textile fibre handbooks" with no edition and no page. Whether those
 * ten numbers are right was, until now, unanswerable.
 *
 * This is the join. It reads the constants the engine itself exports and the
 * measurements out of data/fibre-properties.json, and reports three things:
 * values that disagree, values that agree with the WRONG CONDITION, and values
 * the book has nothing to say about.
 *
 * The middle case is the one worth having built this for. A density measured
 * dry and a density measured at 65% r.h. are different numbers for the same
 * fibre, and an engine that stores one of each without recording which cannot
 * be checked by looking at it — only by comparison against a source that keeps
 * the conditions apart.
 *
 * WHICH CONDITION THE ENGINE SHOULD USE
 * -------------------------------------
 * 65% r.h. Fabric weight is measured on conditioned cloth, GSM is quoted on
 * conditioned cloth, and the engine's densities feed a yarn diameter that is
 * compared against conditioned fabric. Dry densities belong in the store as a
 * separate measurement, not in a calculation about cloth as it is sold.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const STRICT = process.argv.includes('--strict');
const PREFERRED_CONDITION = '65% r.h.';

const props = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'fibre-properties.json'), 'utf8'));

// yarn-engine.js exports FIBER_PROPERTIES, so the checker reads the same object
// the engine computes with — not a copy, not a re-parse of the source. If the
// two could drift apart, the check would be worth less than nothing.
const { FIBER_PROPERTIES } = require('../engine/domain/yarn-engine');

const bookValue = (slug, property, condition) => props.properties.find(
  p => p.fibre_slug === slug && p.property === property && p.condition === condition);

const num = row => (row ? (row.value != null ? row.value : (row.value_min + row.value_max) / 2) : null);

/**
 * Regain. Unlike density this is not one number: the book prints a measured
 * absorption regain at 65% r.h. AND a commercial allowance, and they are not
 * the same figure. Cotton is 7-8% measured and 8.5% by allowance; polyester
 * 0.4% measured and 1.5 or 3% by allowance. Yarn is bought and sold at the
 * allowance; fabric weighs what the measurement says. The engine carries one
 * value and it is the measured one, so that is what this compares — but the
 * gap is reported, because a merchandiser quoting weight and a merchandiser
 * quoting yarn cost are using different numbers and should know it.
 */
function compareRegain(engine, byEngineKey) {
  const rows = [];
  for (const [key, row] of Object.entries(engine)) {
    const fibre = byEngineKey.get(key);
    if (!fibre) continue;
    const measured = bookValue(fibre.slug, 'moisture_regain', '65% r.h.');
    const allowance = bookValue(fibre.slug, 'commercial_regain', 'conventional allowance');
    if (!measured && !allowance) continue;

    const lo = measured ? (measured.value != null ? measured.value : measured.value_min) : null;
    const hi = measured ? (measured.value != null ? measured.value : measured.value_max) : null;
    const inBand = lo != null && row.regain >= lo - 0.05 && row.regain <= hi + 0.05;

    rows.push({
      key,
      have: row.regain,
      measured: measured ? (measured.value != null ? String(measured.value) : `${lo}–${hi}`) : null,
      allowance: allowance ? (allowance.value != null ? String(allowance.value) : `${allowance.value_min}–${allowance.value_max}`) : null,
      page: (measured || allowance || {}).page || fibre.page,
      verdict: lo == null ? 'no measured regain in the book'
             : inBand ? 'inside the measured band'
             : `OUTSIDE the measured band`,
    });
  }
  return rows;
}

/**
 * Tensile properties, and the wet ratios.
 *
 * Unlike density and regain these are not approximations the engine arrived at
 * from somewhere else and has to be reconciled with — they were copied out of
 * the extraction, so this comparison should be exact. That is the point of
 * running it: an exact comparison that stops being exact means somebody edited
 * one of the two and not the other, which is the only way a hard-coded constant
 * ever goes wrong.
 *
 * The one thing it cannot check is the choice of GRADE. Table 13.2 gives nylon
 * 6.6 three times over, and nothing here can say the engine picked the right
 * one; it can only say the engine's figures are the ones printed against the
 * grade whose slug it claims. That judgement is written down in yarn-engine.js
 * and has to be read, not tested.
 */
function compareTensile(engine, byEngineKey) {
  const FIELDS = [
    ['tenacity', 'tenacity'],
    ['extension', 'breaking_extension'],
    ['modulus', 'initial_modulus'],
  ];
  const RATIOS = [
    ['wet', 'wet / 65% r.h.'],
    ['hot_wet', 'wet 95 C / wet 20 C'],
  ];
  const RATIO_FIELDS = [['ten', 'tenacity_ratio'], ['ext', 'breaking_extension_ratio'],
                        ['mod', 'initial_modulus_ratio']];

  const rows = [];
  for (const [key, row] of Object.entries(engine)) {
    const t = row.tensile;
    if (!t) { rows.push({ key, verdict: 'the engine carries no tensile data' }); continue; }
    const fibre = byEngineKey.get(key);
    if (!fibre) { rows.push({ key, t, verdict: 'no fibre in the book claims this engine key' }); continue; }

    const wrong = [];
    for (const [field, property] of FIELDS) {
      const book = props.properties.find(x => x.fibre_slug === fibre.slug &&
        x.property === property && x.page === t.page);
      if (!book) { wrong.push(`${property} is not on p.${t.page}`); continue; }
      const v = book.value != null ? book.value : book.value_min;
      // Both sides are printed to at most four significant figures, so an exact
      // comparison is the right one; a tolerance here would hide a typo.
      if (Math.abs(v - t[field]) > 1e-6) wrong.push(`${property}: engine ${t[field]}, book ${v}`);
    }
    for (const [group, condition] of RATIOS) {
      if (!t[group]) continue;
      for (const [field, property] of RATIO_FIELDS) {
        const book = props.properties.find(x => x.fibre_slug === fibre.slug &&
          x.property === property && x.condition === condition);
        if (!book) { wrong.push(`${property} (${condition}) is not in the book for ${fibre.slug}`); continue; }
        const v = book.value != null ? book.value : book.value_min;
        if (Math.abs(v - t[group][field]) > 1e-6) {
          wrong.push(`${group}.${field}: engine ${t[group][field]}, book ${v}`);
        }
      }
    }
    rows.push({ key, t, wrong,
                verdict: wrong.length ? 'DISAGREES: ' + wrong.join('; ')
                                      : `matches ${t.table} p.${t.page} (${t.grade})` });
  }
  return rows;
}

/**
 * Swelling. Same principle as the tensile comparison — these were copied out of
 * the extraction, so any drift means one side was edited and not the other —
 * but the values are ranges rather than points, and the range endpoints have to
 * match exactly for the same reason: the low and high figures are two different
 * laboratories' results, not a tolerance.
 */
function compareSwelling(engine, byEngineKey) {
  const FIELDS = [['area', 'transverse_swelling_area'],
                  ['axial', 'axial_swelling'],
                  ['volume', 'volume_swelling']];
  const rows = [];
  for (const [key, row] of Object.entries(engine)) {
    if (!row.swelling) continue;
    const fibre = byEngineKey.get(key);
    if (!fibre) { rows.push({ key, verdict: 'no fibre in the book claims this engine key' }); continue; }
    const wrong = [];
    for (const [field, property] of FIELDS) {
      const book = props.properties.find(x => x.fibre_slug === fibre.slug &&
        x.property === property && x.page === row.swelling.page);
      const have = row.swelling[field];
      if (!book && !have) continue;
      if (!book) { wrong.push(`${property}: the engine has ${JSON.stringify(have)}, the book nothing`); continue; }
      if (!have) { wrong.push(`${property}: the book has a value the engine dropped`); continue; }
      const lo = book.value != null ? book.value : book.value_min;
      const hi = book.value != null ? book.value : book.value_max;
      if (Math.abs(lo - have[0]) > 1e-6 || Math.abs(hi - have[1]) > 1e-6) {
        wrong.push(`${property}: engine ${have[0]}-${have[1]}, book ${lo}-${hi}`);
      }
    }
    rows.push({ key, row, wrong,
                verdict: wrong.length ? 'DISAGREES: ' + wrong.join('; ')
                                      : `matches ${row.swelling.table} p.${row.swelling.page}` });
  }
  return rows;
}

/**
 * Variability and the weak link. Copied from the extraction like the tensile
 * block, so an exact comparison is the right one: a tolerance here would hide a
 * typo rather than absorb a real difference.
 */
function compareVariability(engine, byEngineKey) {
  const CV = [['fineness', 'cv_fineness'], ['breaking_load', 'cv_breaking_load'],
              ['tenacity', 'cv_tenacity'], ['extension', 'cv_breaking_extension']];
  const WL = [['cm1', '1 cm test length'], ['mm1', '1 mm test length'],
              ['mm01', '0.1 mm test length']];
  const rows = [];
  for (const [key, row] of Object.entries(engine)) {
    if (!row.variability && !row.weak_link) continue;
    const fibre = byEngineKey.get(key);
    if (!fibre) { rows.push({ key, verdict: 'no fibre in the book claims this engine key' }); continue; }
    const wrong = [];
    if (row.variability) {
      for (const [field, property] of CV) {
        const book = props.properties.find(x => x.fibre_slug === fibre.slug &&
          x.property === property && x.page === row.variability.page);
        if (!book) { wrong.push(`${property} is not on p.${row.variability.page}`); continue; }
        if (Math.abs(book.value - row.variability[field]) > 1e-9) {
          wrong.push(`${property}: engine ${row.variability[field]}, book ${book.value}`);
        }
      }
    }
    if (row.weak_link) {
      for (const [field, condition] of WL) {
        const book = props.properties.find(x => x.fibre_slug === fibre.slug &&
          x.property === 'tenacity' && x.condition === condition &&
          x.page === row.weak_link.page);
        if (!book) { wrong.push(`tenacity at ${condition} is not on p.${row.weak_link.page}`); continue; }
        if (Math.abs(book.value - row.weak_link[field]) > 1e-9) {
          wrong.push(`${condition}: engine ${row.weak_link[field]}, book ${book.value}`);
        }
      }
    }
    rows.push({ key, row, wrong,
                verdict: wrong.length ? 'DISAGREES: ' + wrong.join('; ') : 'matches chapter 14' });
  }
  return rows;
}

function main() {
  const engine = FIBER_PROPERTIES;
  const byEngineKey = new Map(props.fibres.filter(f => f.engine_key).map(f => [f.engine_key, f]));

  const wrongCondition = [];
  const noDensity = [];
  const disagree = [];
  const unsourced = [];
  const agree = [];

  for (const [key, row] of Object.entries(engine)) {
    const fibre = byEngineKey.get(key);
    if (!fibre) { unsourced.push(key); continue; }

    const conditioned = num(bookValue(fibre.slug, 'density', PREFERRED_CONDITION));
    const dry = num(bookValue(fibre.slug, 'density', 'dry'));
    const have = row.density;

    const near = (a, b) => a != null && b != null && Math.abs(a - b) < 0.005;

    // Cite the page the MEASUREMENT is printed on, not the fibre's. A fibre row
    // carries whichever table defined it last, so acrylic's density from Table
    // 5.1 was being reported against p.188 — the page of the regain table.
    const row65 = bookValue(fibre.slug, 'density', PREFERRED_CONDITION);
    const rowDry = bookValue(fibre.slug, 'density', 'dry');
    const page = (row65 || rowDry || {}).page || fibre.page;

    if (conditioned == null && dry == null) {
      // The book measures this fibre — chapter 13 gives elastane a full set of
      // tensile properties — but chapter 5 never weighed it. That is a gap in
      // the source, not a disagreement with it, and calling it "DISAGREES by ?"
      // pointed the reader at the engine when the missing figure is the book's.
      noDensity.push({ key, have, conditioned, dry, page });
    } else if (near(have, conditioned)) {
      agree.push({ key, have, conditioned, dry, page });
    } else if (near(have, dry)) {
      wrongCondition.push({ key, have, conditioned, dry, page });
    } else {
      disagree.push({ key, have, conditioned, dry, page,
                      delta: conditioned != null ? have - conditioned : null });
    }
  }

  const w = s => String(s == null || s === '' ? '—' : s);
  console.log('FIBRE DENSITY — engine constants against Morton & Hearle Table 5.1\n');
  console.log('  %s %s %s %s  %s', 'fibre'.padEnd(12), 'engine'.padEnd(7),
              'dry'.padEnd(7), '65% r.h.'.padEnd(9), 'verdict');
  const line = (r, verdict) => console.log('  %s %s %s %s  %s',
    r.key.padEnd(12), w(r.have).padEnd(7), w(r.dry).padEnd(7), w(r.conditioned).padEnd(9), verdict);

  agree.forEach(r => line(r, `agrees, p.${r.page}`));
  noDensity.forEach(r => line(r,
    'the book measures this fibre but never weighed it — density is unsourced'));
  wrongCondition.forEach(r => line(r, `WRONG CONDITION — this is the dry figure, p.${r.page}`));
  disagree.forEach(r => line(r,
    `DISAGREES by ${r.delta != null ? (r.delta > 0 ? '+' : '') + r.delta.toFixed(2) : '?'}, p.${r.page}`));
  unsourced.forEach(k => console.log('  %s %s %s %s  %s',
    k.padEnd(12), w(engine[k].density).padEnd(7), '—'.padEnd(7), '—'.padEnd(9),
    'the book has no row for this fibre — value is unsourced'));

  const missing = props.fibres.filter(f => !f.engine_key).length;

  console.log('\n%d agree · %d use the wrong condition · %d disagree · %d unsourced · ' +
              '%d measured but never weighed',
              agree.length, wrongCondition.length, disagree.length, unsourced.length,
              noDensity.length);
  console.log('%d fibres in the book that the engine has never carried a value for.', missing);

  // ── Regain ────────────────────────────────────────────────────────────
  const regain = compareRegain(engine, byEngineKey);
  if (regain.length) {
    console.log('\n\nMOISTURE REGAIN — engine against Morton & Hearle Table 7.3\n');
    console.log('  %s %s %s %s  %s', 'fibre'.padEnd(12), 'engine'.padEnd(7),
                'measured'.padEnd(10), 'allowance'.padEnd(10), 'verdict');
    for (const r of regain) {
      console.log('  %s %s %s %s  %s', r.key.padEnd(12), w(r.have).padEnd(7),
                  w(r.measured).padEnd(10), w(r.allowance).padEnd(10),
                  `${r.verdict}, p.${r.page}`);
    }
    const off = regain.filter(r => r.verdict.startsWith('OUTSIDE'));
    const withAllowance = regain.filter(r => r.allowance);
    console.log('\n%d of %d regains sit inside the measured band.',
                regain.length - off.length, regain.length);
    if (withAllowance.length) {
      console.log('%d of them also have a commercial allowance, which is the figure yarn',
                  withAllowance.length);
      console.log('is traded at and which the engine does not carry at all.');
    }
    if (STRICT && off.length) process.exitCode = 1;
  }

  // ── Tensile ───────────────────────────────────────────────────────────
  const tensile = compareTensile(engine, byEngineKey);
  console.log('\n\nTENSILE PROPERTIES — engine against Tables 13.1, 13.2 and 13.7\n');
  console.log('  %s %s %s %s  %s', 'fibre'.padEnd(14), 'N/tex'.padEnd(8),
              'ext %'.padEnd(7), 'mod'.padEnd(7), 'verdict');
  for (const r of tensile) {
    console.log('  %s %s %s %s  %s', r.key.padEnd(14),
                w(r.t && r.t.tenacity).padEnd(8), w(r.t && r.t.extension).padEnd(7),
                w(r.t && r.t.modulus).padEnd(7), r.verdict);
  }
  const tensileOff = tensile.filter(r => r.wrong && r.wrong.length);
  const tensileNone = tensile.filter(r => !r.t);
  console.log('\n%d fibres carry measured mechanics; %d of them disagree with the book; ' +
              '%d have none.',
              tensile.length - tensileNone.length, tensileOff.length, tensileNone.length);
  if (tensileNone.length) {
    console.log('Without them a blend containing that fibre reports its wet behaviour for');
    console.log('only the part of the blend the book covers, which is the honest answer but');
    console.log('a less useful one than a citation would be.');
  }
  if (STRICT && tensileOff.length) process.exitCode = 1;

  // ── Swelling ──────────────────────────────────────────────────────────
  const swelling = compareSwelling(engine, byEngineKey);
  console.log('\n\nSWELLING IN WATER — engine against Table 11.1\n');
  console.log('  %s %s %s  %s', 'fibre'.padEnd(14), 'area %'.padEnd(11),
              'volume %'.padEnd(11), 'verdict');
  for (const r of swelling) {
    const sw = r.row && r.row.swelling;
    const fmt = v => (v ? `${v[0]}-${v[1]}` : '—');
    console.log('  %s %s %s  %s', r.key.padEnd(14),
                fmt(sw && sw.area).padEnd(11), fmt(sw && sw.volume).padEnd(11), r.verdict);
  }
  const swellOff = swelling.filter(r => r.wrong && r.wrong.length);
  const noSwell = Object.keys(engine).length - swelling.length;
  console.log('\n%d fibres carry swelling; %d disagree; %d have none, because Table 11.1',
              swelling.length, swellOff.length, noSwell);
  console.log('predates most synthetics and the book measures no substitute for them.');
  if (STRICT && swellOff.length) process.exitCode = 1;

  // ── Variability and the weak link ─────────────────────────
  const varia = compareVariability(engine, byEngineKey);
  console.log('\n\nVARIABILITY AND THE WEAK LINK — engine against chapter 14\n');
  console.log('  %s %s %s  %s', 'fibre'.padEnd(14), 'tenacity CV'.padEnd(12),
              '1cm to 0.1mm'.padEnd(14), 'verdict');
  for (const r of varia) {
    const v = r.row && r.row.variability, wl = r.row && r.row.weak_link;
    console.log('  %s %s %s  %s', r.key.padEnd(14),
                (v ? v.tenacity + '%' : '—').padEnd(12),
                (wl ? `${wl.cm1} to ${wl.mm01}` : '—').padEnd(14), r.verdict);
  }
  const variaOff = varia.filter(r => r.wrong && r.wrong.length);
  console.log('\n%d fibres carry variability or weak-link figures; %d disagree.',
              varia.length, variaOff.length);
  if (STRICT && variaOff.length) process.exitCode = 1;

  if (wrongCondition.length || disagree.length) {
    console.log('\nThe engine feeds these densities to blendPhysical() and from there to');
    console.log('yarnDiameterMm(), which scales the Ashenhurst diameter by sqrt(1.52/density).');
    console.log('A density that is wrong, or right for the wrong humidity, moves that diameter.');
  }
  if (STRICT && (wrongCondition.length || disagree.length)) {
    process.exitCode = 1;
  }
}

main();
