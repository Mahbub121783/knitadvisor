// Check remote DB admin_users table
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });
const { query, testConnection } = require('../backend/config/database');

async function check() {
  console.log('Testing connection...');
  const ok = await testConnection();
  console.log('Connection OK?', ok);
  if (!ok) return;

  try {
    const rows = await query('SELECT id, username, password_hash, created_at FROM admin_users');
    console.log('Admin users in DB:', rows);
  } catch (err) {
    console.error('Error fetching admin users:', err);
  }
  process.exit(0);
}

check();
