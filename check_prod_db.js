/**
 * check_prod_db.js
 * Utility to inspect production users and database connectivity
 */
require('dotenv').config();
const { query, initDB, pool } = require('./src/database/connection');

async function checkUsers() {
  try {
    await initDB();
    const result = await query('SELECT id, full_name, email, role, is_active, last_login, created_at FROM users');
    console.log('USERS:', JSON.stringify(result.rows, null, 2));
  } catch (err) {
    console.error('Failed to check database:', err.message);
  } finally {
    if (pool && pool.end) await pool.end();
    process.exit(0);
  }
}

checkUsers();
