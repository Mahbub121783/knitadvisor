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

function main() {
  const engine = FIBER_PROPERTIES;
  const byEngineKey = new Map(props.fibres.filter(f => f.engine_key).map(f => [f.engine_key, f]));

  const wrongCondition = [];
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

    if (near(have, conditioned)) {
      agree.push({ key, have, conditioned, dry, page: fibre.page });
    } else if (near(have, dry)) {
      wrongCondition.push({ key, have, conditioned, dry, page: fibre.page });
    } else {
      disagree.push({ key, have, conditioned, dry, page: fibre.page,
                      delta: conditioned != null ? have - conditioned : null });
    }
  }

  const w = s => String(s == null ? '—' : s);
  console.log('FIBRE DENSITY — engine constants against Morton & Hearle Table 5.1\n');
  console.log('  %s %s %s %s  %s', 'fibre'.padEnd(12), 'engine'.padEnd(7),
              'dry'.padEnd(7), '65% r.h.'.padEnd(9), 'verdict');
  const line = (r, verdict) => console.log('  %s %s %s %s  %s',
    r.key.padEnd(12), w(r.have).padEnd(7), w(r.dry).padEnd(7), w(r.conditioned).padEnd(9), verdict);

  agree.forEach(r => line(r, `agrees, p.${r.page}`));
  wrongCondition.forEach(r => line(r, `WRONG CONDITION — this is the dry figure, p.${r.page}`));
  disagree.forEach(r => line(r,
    `DISAGREES by ${r.delta != null ? (r.delta > 0 ? '+' : '') + r.delta.toFixed(2) : '?'}, p.${r.page}`));
  unsourced.forEach(k => console.log('  %s %s %s %s  %s',
    k.padEnd(12), w(engine[k].density).padEnd(7), '—'.padEnd(7), '—'.padEnd(9),
    'the book has no row for this fibre — value is unsourced'));

  const missing = props.fibres.filter(f => !f.engine_key).length;

  console.log('\n%d agree · %d use the wrong condition · %d disagree · %d unsourced',
              agree.length, wrongCondition.length, disagree.length, unsourced.length);
  console.log('%d fibres in the book that the engine has never carried a value for.', missing);

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
