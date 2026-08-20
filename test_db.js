/**
 * test_db.js
 * Quick utility to verify MySQL connection and admin users
 */
require('dotenv').config();
const { query, initDB, pool } = require('./src/database/connection');

async function testConnection() {
  try {
    await initDB();
    const result = await query('SELECT COUNT(*) as count FROM users WHERE role = ?', ['admin']);
    console.log('✅ MySQL Database Connection Successful!');
    console.log('Admin user count:', result.rows[0].count);
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  } finally {
    if (pool && pool.end) await pool.end();
    process.exit(0);
  }
}

testConnection();
