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

/**
 * Split a migration into individual statements, for the `-- +no-transaction`
 * path where each has to be sent on its own round trip.
 *
 * Deliberately small rather than a real SQL parser: it tracks the three things
 * that can legitimately contain a semicolon — single-quoted strings,
 * dollar-quoted bodies ($$ ... $$ or $tag$ ... $tag$, which is how the PL/pgSQL
 * functions in 001 are written), and comments. That is enough for migrations,
 * and anything more elaborate belongs in a transactional migration, where the
 * whole file goes over as one string and none of this applies.
 */
function splitStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;

  while (i < sql.length) {
    const rest = sql.slice(i);

    const lineComment = rest.match(/^--[^\n]*/);
    if (lineComment) { buf += lineComment[0]; i += lineComment[0].length; continue; }

    const blockComment = rest.match(/^\/\*[\s\S]*?\*\//);
    if (blockComment) { buf += blockComment[0]; i += blockComment[0].length; continue; }

    const dollarOpen = rest.match(/^\$([A-Za-z_]\w*)?\$/);
    if (dollarOpen) {
      const tag = dollarOpen[0];
      const close = sql.indexOf(tag, i + tag.length);
      const end = close === -1 ? sql.length : close + tag.length;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }

    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j++; break; }
        j++;
      }
      buf += sql.slice(i, j);
      i = j;
      continue;
    }

    if (sql[i] === ';') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      i++;
      continue;
    }

    buf += sql[i];
    i++;
  }
  if (buf.trim()) out.push(buf.trim());

  // Drop fragments that are only comments — those are not statements.
  return out.filter(s =>
    s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim().length > 0);
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
      // A few statements cannot run inside a transaction block at all — VACUUM,
      // CREATE INDEX CONCURRENTLY, and ALTER TYPE ... ADD VALUE on older
      // servers. A migration opts out by putting `-- +no-transaction` on a line
      // of its own.
      //
      // The trade is real and worth stating: such a migration is NOT atomic. If
      // it fails halfway, the statements that already ran stay applied while the
      // ledger row is never written, so a re-run replays it from the beginning.
      // Write them to be idempotent (IF EXISTS / IF NOT EXISTS) — 004 is.
      const noTx = /^[ \t]*--[ \t]*\+no-transaction[ \t]*$/m.test(m.sql);
      process.stdout.write(`\nApplying ${m.name}${noTx ? ' [no transaction]' : ''} ... `);
      try {
        if (!noTx) await client.query('BEGIN');
        if (noTx) {
          // Skipping BEGIN is not enough. node-postgres sends a multi-statement
          // string through the simple query protocol, and PostgreSQL wraps such
          // a string in an IMPLICIT transaction — so `VACUUM` still fails with
          // "cannot run inside a transaction block" even with no BEGIN in
          // sight. The statements have to arrive one round trip at a time.
          for (const stmt of splitStatements(m.sql)) {
            await client.query(stmt);
          }
        } else {
          await client.query(m.sql);
        }
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum, duration_ms) VALUES ($1,$2,$3,$4)',
          [m.version, m.name, m.checksum, Date.now() - started]
        );
        if (!noTx) await client.query('COMMIT');
        console.log(`ok (${Date.now() - started}ms)`);
      } catch (err) {
        if (!noTx) await client.query('ROLLBACK').catch(() => {});
        console.log('FAILED');
        throw new Error(
          `${m.name}: ${err.message}` +
          (noTx ? ' — runs outside a transaction, so earlier statements in it may have applied.' : '')
        );
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
