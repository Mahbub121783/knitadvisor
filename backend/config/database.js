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
      host: process.env.DB_HOST || '38.46.220.25',
      user: process.env.DB_USER || 'tecnedub_knitadvisor',
      password: process.env.DB_PASS || 'M@hbubu5',
      database: process.env.DB_NAME || 'tecnedub_knitadvisor',
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

async function initVizDatabase() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS viz_configs (
        id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        fabric_id         VARCHAR(64) NOT NULL UNIQUE,
        fabric_category   VARCHAR(32) NOT NULL,
        machine_type      VARCHAR(32) NOT NULL,
        sheen_model       ENUM('matte','gradient','high_sheen') NOT NULL DEFAULT 'matte',
        loop_head_ratio   DECIMAL(4,3) NOT NULL DEFAULT 0.300,
        loop_height_ratio DECIMAL(4,3) NOT NULL DEFAULT 0.950,
        foot_splay_ratio  DECIMAL(4,3) NOT NULL DEFAULT 0.200,
        layer_count       TINYINT UNSIGNED NOT NULL DEFAULT 2,
        bar_colors        JSON,
        animate_default   TINYINT(1) NOT NULL DEFAULT 0,
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[DB] Table viz_configs checked/created');

    await query(`
      CREATE TABLE IF NOT EXISTS viz_render_cache (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        cache_key  VARCHAR(64) NOT NULL UNIQUE,
        fabric_id  VARCHAR(64) NOT NULL,
        path_json  LONGTEXT NOT NULL,
        render_ms  SMALLINT UNSIGNED,
        hit_count  INT UNSIGNED NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        last_hit   TIMESTAMP NULL,
        KEY idx_fabric  (fabric_id),
        KEY idx_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[DB] Table viz_render_cache checked/created');

    const seeds = [
      ['single_jersey','single_jersey','single_bed_circular','matte',0.300,0.950,0.200,1,null,0],
      ['rib_1x1','rib','double_bed_circular','matte',0.300,0.950,0.200,2,null,0],
      ['interlock','interlock','double_bed_circular_interlock','matte',0.280,0.980,0.190,2,null,0],
      ['tricot_plain','warp_knit','warp_knit_tricot','high_sheen',0.300,0.950,0.200,2,
        JSON.stringify(['#2563EB','#DC2626','#16A34A','#D97706']),1],
      ['locknit','warp_knit','warp_knit_tricot','high_sheen',0.300,0.950,0.200,2,
        JSON.stringify(['#7C3AED','#DB2777','#0891B2','#65A30D']),1],
    ];
    for (const s of seeds) {
      await query(
        `INSERT IGNORE INTO viz_configs
          (fabric_id, fabric_category, machine_type, sheen_model,
           loop_head_ratio, loop_height_ratio, foot_splay_ratio, layer_count, bar_colors, animate_default)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        s
      );
    }
    console.log('[DB] viz_configs seeded (5 fabric types)');
  } catch (err) {
    console.error('[DB] Failed to initialize viz database:', err.message);
  }
}

module.exports = { getPool, query, testConnection, initAdminDatabase, initVizDatabase, resetPool: () => { pool = null; } };

