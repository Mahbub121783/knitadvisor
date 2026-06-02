/**
 * MySQL Connection Pool
 * Uses mysql2/promise for async/await support
 * Handles special chars in password, auto-retry on lost connection
 */
const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (!pool) {
    const config = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'knitadvisor_db',
      port: parseInt(process.env.DB_PORT) || 3306,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      // Handle connection drops
      connectTimeout: 20000,
    };

    pool = mysql.createPool(config);
    console.log('[DB] MySQL pool created — host:', config.host, 'db:', config.database);
  }
  return pool;
}

async function query(sql, params = []) {
  const p = getPool();
  try {
    const [rows] = await p.execute(sql, params);
    return rows;
  } catch (err) {
    // On lost connection, reset pool and retry once
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
      console.warn('[DB] Connection lost, resetting pool and retrying…');
      pool = null;
      const p2 = getPool();
      const [rows] = await p2.execute(sql, params);
      return rows;
    }
    throw err;
  }
}

async function testConnection() {
  try {
    const p = getPool();
    const conn = await p.getConnection();
    conn.release();
    console.log('[DB] Connection test passed');
    return true;
  } catch (err) {
    console.error('[DB] Connection test FAILED:', err.message, '| code:', err.code);
    return false;
  }
}

module.exports = { getPool, query, testConnection };
