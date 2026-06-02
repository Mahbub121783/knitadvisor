/**
 * Emergency Migration: Create missing admin_sessions table
 * Run immediately: node backend/scripts/create-admin-sessions.js
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const { query: dbQuery } = require('../config/database');

async function run() {
  console.log('Creating admin_sessions table...\n');

  try {
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        token_hash  VARCHAR(64) NOT NULL UNIQUE,
        ip_address  VARCHAR(45) DEFAULT NULL,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at  TIMESTAMP DEFAULT NULL,
        is_active   TINYINT DEFAULT 1,
        INDEX idx_token_hash (token_hash),
        INDEX idx_expires_at (expires_at)
      ) ENGINE=InnoDB
    `);

    console.log('✓ admin_sessions table created successfully');
    console.log('\nYou can now log in to the admin panel.');
    process.exit(0);
  } catch (e) {
    console.error('✗ Failed to create table:', e.message);
    process.exit(1);
  }
}

run();
