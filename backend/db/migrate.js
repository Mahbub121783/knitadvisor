/**
 * Migration runner.
 *
 * Applies every db/migrations/NNN_*.sql that has not run yet, in filename
 * order, each inside its own transaction. Applied migrations are recorded with
 * a checksum, so editing a file that already ran is caught rather than silently
 * ignored — the previous setup had no migrations at all: schema changes were
 * CREATE TABLE IF NOT EXISTS calls scattered through application startup, which
 * meant no history, no ordering, and no way to tell what a given database had.
 *
 *   node db/migrate.js            apply pending migrations
 *   node db/migrate.js --status   list applied/pending and exit
 *   node db/migrate.js --verify   fail if anything is pending (for CI/deploy)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getPool, query, close } = require('./client');

const DIR = path.join(__dirname, 'migrations');

const LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     varchar(20)  PRIMARY KEY,
    name        varchar(200) NOT NULL,
    checksum    char(64)     NOT NULL,
    applied_at  timestamptz  NOT NULL DEFAULT now(),
    duration_ms integer      NOT NULL
  )
`;

function discover() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .sort()
    .map(file => {
      const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
      return {
        version: file.match(/^(\d+)_/)[1],
        name: file,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    });
}

async function applied() {
  await query(LEDGER);
  const rows = await query('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version');
  return new Map(rows.map(r => [r.version, r]));
}

async function status() {
  const files = discover();
  const done = await applied();
  const pending = [];

  for (const m of files) {
    const rec = done.get(m.version);
    if (!rec) {
      pending.push(m);
      console.log(`  ${m.version}  PENDING   ${m.name}`);
    } else if (rec.checksum !== m.checksum) {
      // A migration that already ran must never be edited: databases that
      // applied the old text will not pick the change up, so environments
      // silently diverge. Add a new migration instead.
      console.error(`  ${m.version}  MODIFIED  ${m.name}  <-- applied ${rec.applied_at.toISOString()}, file has changed since`);
      pending.push({ ...m, modified: true });
    } else {
      console.log(`  ${m.version}  applied   ${m.name}`);
    }
  }

  for (const [version, rec] of done) {
    if (!files.find(f => f.version === version)) {
      console.warn(`  ${version}  ORPHAN    ${rec.name}  <-- recorded as applied but the file is gone`);
    }
  }
  return pending;
}

async function migrate() {
  const pending = await status();
  const modified = pending.filter(m => m.modified);

  if (modified.length) {
    throw new Error(
      `Refusing to run: ${modified.map(m => m.name).join(', ')} already applied but changed on disk. ` +
      'Revert the edit and add a new migration.'
    );
  }
  if (!pending.length) {
    console.log('\nNothing to apply — schema is up to date.');
    return 0;
  }

  const client = await getPool().connect();
  try {
    for (const m of pending) {
      const started = Date.now();
      process.stdout.write(`\nApplying ${m.name} ... `);
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum, duration_ms) VALUES ($1,$2,$3,$4)',
          [m.version, m.name, m.checksum, Date.now() - started]
        );
        await client.query('COMMIT');
        console.log(`ok (${Date.now() - started}ms)`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log('FAILED');
        throw new Error(`${m.name}: ${err.message}`);
      }
    }
  } finally {
    client.release();
  }
  console.log(`\n${pending.length} migration(s) applied.`);
  return pending.length;
}

async function main() {
  const mode = process.argv.includes('--status') ? 'status'
             : process.argv.includes('--verify') ? 'verify'
             : 'migrate';

  console.log(`Migrations (${mode}) — ${process.env.PGDATABASE} @ ${process.env.PGHOST}\n`);

  if (mode === 'status') { await status(); return; }

  if (mode === 'verify') {
    const pending = await status();
    if (pending.length) {
      console.error(`\n${pending.length} migration(s) not applied.`);
      process.exitCode = 1;
    } else {
      console.log('\nSchema is up to date.');
    }
    return;
  }

  await migrate();
}

main()
  .catch(err => { console.error('\n[Migrate] ' + err.message); process.exitCode = 1; })
  .finally(() => close());
