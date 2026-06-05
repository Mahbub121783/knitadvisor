const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });
const { query } = require('../backend/config/database');

async function inspect() {
  try {
    const tables = await query('SHOW TABLES');
    console.log('Tables in database:', tables);
    for (const t of tables) {
      const tableName = Object.values(t)[0];
      const desc = await query(`DESCRIBE \`${tableName}\``);
      console.log(`\nTable: ${tableName}`);
      console.table(desc);
    }
  } catch (err) {
    console.error('Error during DB inspection:', err);
  }
  process.exit(0);
}

inspect();
