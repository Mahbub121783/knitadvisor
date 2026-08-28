/**
 * PostgreSQL connection pool.
 *
 * Replaces the mysql2 pool in config/database.js. Same contract as before —
 * query() takes SQL and params and resolves to rows — so callers move over
 * without learning a new API, but the placeholder style is Postgres' $1/$2
 * rather than MySQL's ?.
 *
 * Credentials come from the environment only; there is deliberately no
 * hardcoded fallback (an earlier version of the MySQL config shipped the live
 * password as a default in a public repository).
 */
const { Pool } = require('pg');

const REQUIRED_ENV = ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];

let pool = null;

function readConfig() {
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required PostgreSQL environment variables: ${missing.join(', ')}. ` +
      'Create backend/.env from backend/.env.example.'
    );
  }
  return {
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT, 10) || 5432,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,

    // Passenger runs several workers per app and the host is shared, so the
    // budget here is per-process and modest on purpose: four workers at ten
    // connections each would be forty backends for an app that is idle most
    // of the time.
    max: parseInt(process.env.PGPOOL_MAX, 10) || 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,

    // Bounds a query that hangs on the server side. Without it a lock wait or
    // a runaway plan holds a pool slot until the connection is torn down.
    statement_timeout: parseInt(process.env.PG_STATEMENT_TIMEOUT_MS, 10) || 10_000,
    query_timeout: parseInt(process.env.PG_QUERY_TIMEOUT_MS, 10) || 12_000,

    application_name: 'knitadvisor',
  };
}

function getPool() {
  if (!pool) {
    pool = new Pool(readConfig());

    // An idle client erroring (server restart, admin disconnect) emits on the
    // pool, and an unhandled 'error' event would take the process down.
    pool.on('error', (err) => {
      console.error('[DB] Idle client error:', err.message);
    });

    console.log('[DB] PostgreSQL pool created — host:', process.env.PGHOST, 'db:', process.env.PGDATABASE);
  }
  return pool;
}

/**
 * Run a query and get rows back.
 *
 * @param {string} text   SQL with $1-style placeholders
 * @param {Array}  params
 * @returns {Promise<Array<object>>}
 */
async function query(text, params = []) {
  const p = getPool();
  const started = Date.now();
  try {
    const res = await p.query(text, params);
    const ms = Date.now() - started;
    if (ms > SLOW_QUERY_MS) {
      console.warn(`[DB] Slow query ${ms}ms:`, text.replace(/\s+/g, ' ').slice(0, 120));
    }
    return res.rows;
  } catch (err) {
    // Postgres error codes are stable and worth keeping in the log line; the
    // message alone often does not say which constraint or relation failed.
    console.error(`[DB] Query failed (${err.code || 'no code'}):`, err.message);
    throw err;
  }
}

/** Like query(), but returns the first row or null. */
async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows.length ? rows[0] : null;
}

/**
 * Run several statements in one transaction on a single connection.
 * The callback gets a query(text, params) bound to that connection.
 */
async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(async (text, params = []) => (await client.query(text, params)).rows);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const SLOW_QUERY_MS = parseInt(process.env.PG_SLOW_QUERY_MS, 10) || 300;

async function testConnection() {
  try {
    const row = await queryOne('SELECT now() AS ts, current_database() AS db');
    console.log('[DB] Connection test passed —', row.db, 'at', row.ts.toISOString());
    return true;
  } catch (err) {
    console.error('[DB] Connection test FAILED:', err.message, '| code:', err.code);
    return false;
  }
}

/** Pool counters for the health endpoint. */
function poolStats() {
  if (!pool) return { total: 0, idle: 0, waiting: 0, initialised: false };
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, initialised: true };
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, query, queryOne, transaction, testConnection, poolStats, close };
