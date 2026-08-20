/**
 * scripts/dev/fetch_errors.js
 * Utility to inspect latest error logs in MySQL
 */
require('dotenv').config();
const { query, initDB, pool } = require('../../src/database/connection');

async function fetchErrors() {
  try {
    await initDB();
    const result = await query('SELECT * FROM error_logs ORDER BY id DESC LIMIT 5');
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (err) {
    console.error('Failed to fetch errors:', err.message);
  } finally {
    if (pool && pool.end) await pool.end();
    process.exit(0);
  }
}

fetchErrors();
