/**
 * scripts/dev/list_tables.js
 * Quick utility to print table names in MySQL
 */
require('dotenv').config();
const { query, initDB, pool } = require('../../src/database/connection');

async function listTables() {
  try {
    await initDB();
    const result = await query('SHOW TABLES');
    console.log(result.rows.map(r => Object.values(r)[0]));
  } catch (err) {
    console.error('Failed to list tables:', err.message);
  } finally {
    if (pool && pool.end) await pool.end();
    process.exit(0);
  }
}

listTables();
