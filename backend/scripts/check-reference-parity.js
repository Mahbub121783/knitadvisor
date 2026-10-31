/**
 * Reference-data parity: is what the database serves the same as the repo's
 * JSON files?
 *
 * The engine reads one frozen snapshot (engine/reference). It is built from
 * PostgreSQL when the database answers at boot and from backend/data/*.json
 * when it does not — and the two are meant to be interchangeable. This loads
 * both and compares them record by record, so a drift (an admin edit, a
 * half-finished import, an old seed) is a loud difference rather than two
 * different answers depending on which tier was up.
 *
 *   node scripts/check-reference-parity.js           # exit 1 on any difference
 *
 * Needs a database (DATABASE_URL via the usual .env). Without one it says so
 * and exits 2.
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const assert = require('assert');

const DATA = (f) => require(path.join(__dirname, '..', 'data', f));

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

// Multiset comparison: order is not part of the data.
function diffRecords(name, db, files, key = canon) {
  const count = (rows) => rows.reduce((m, r) => m.set(key(r), (m.get(key(r)) || 0) + 1), new Map());
  const a = count(db), b = count(files);
  const onlyDb = [], onlyFiles = [];
  for (const [k, n] of a) if ((b.get(k) || 0) < n) onlyDb.push(k);
  for (const [k, n] of b) if ((a.get(k) || 0) < n) onlyFiles.push(k);
  const ok = !onlyDb.length && !onlyFiles.length;
  console.log(`${ok ? 'OK  ' : 'DIFF'} ${name}: database ${db.length}, files ${files.length}`);
  if (!ok) {
    onlyDb.slice(0, 3).forEach(k => console.log('       only in database:', k.slice(0, 160)));
    onlyFiles.slice(0, 3).forEach(k => console.log('       only in files   :', k.slice(0, 160)));
  }
  return ok;
}

(async () => {
  const reference = require('../engine/reference');
  await reference.load({ allowFallback: false }).catch((err) => {
    console.error('No database to compare against:', err.message);
    process.exit(2);
  });
  const st = reference.status();
  if (st.origin !== 'database') { console.error('Snapshot did not come from the database.'); process.exit(2); }
  const snap = reference.get();

  let ok = true;
  ok = diffRecords('factory_records', snap.factoryRecords, DATA('factory-records.json')) && ok;
  ok = diffRecords('risk_records', snap.riskRecords, DATA('risk-assessment.json')) && ok;

  // composition reference: compare per bucket/composition curve
  const flat = (ref) => Object.entries(ref).flatMap(([bucket, comps]) =>
    Object.entries(comps).flatMap(([comp, block]) => (block.count_map || []).map(p => ({ bucket, comp, ...p }))));
  ok = diffRecords('composition_reference points', flat(snap.compositionReference), flat(DATA('composition-reference.json'))) && ok;

  console.log(ok ? '\nDatabase and files agree.' : '\nDatabase and files DIFFER — the engine answers differently depending on which tier is live.');
  process.exit(ok ? 0 : 1);
})();
