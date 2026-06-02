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

async function initAdminDatabase() {
  try {
    // 1. Create table admin_users if not exists
    await query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);
    console.log('[DB] Table admin_users checked/created');

    // 2. Check if there are any admins in the table
    const rows = await query('SELECT COUNT(*) as count FROM admin_users');
    if (rows[0].count === 0) {
      // Seed default admin: username=knitadvisor, password=knitadvisor2026
      const crypto = require('crypto');
      const defaultUser = 'knitadvisor';
      const defaultPassHash = crypto.createHash('sha256').update('knitadvisor2026').digest('hex');
      
      await query(
        'INSERT INTO admin_users (username, password_hash) VALUES (?, ?)',
        [defaultUser, defaultPassHash]
      );
      console.log('[DB] Default admin user seeded successfully');
    }
  } catch (err) {
    console.error('[DB] Failed to initialize admin database:', err.message);
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

module.exports = { getPool, query, testConnection, initAdminDatabase, resetPool: () => { pool = null; } };

