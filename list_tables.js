/**
 * list_tables.js
 * Lists all MySQL tables and their current row counts
 */
require('dotenv').config();
const { query, initDB, pool } = require('./src/database/connection');

async function listTables() {
  try {
    await initDB();
    const tablesResult = await query('SHOW TABLES');
    const tableNames = tablesResult.rows.map(row => Object.values(row)[0]);

    console.log('='.repeat(60));
    console.log(`| ${'TABLE NAME'.padEnd(35)} | ${'ROW COUNT'.padStart(18)} |`);
    console.log('-'.repeat(60));

    let totalRows = 0;
    for (const table of tableNames) {
      const countRes = await query(`SELECT COUNT(*) as count FROM \`${table}\``);
      const count = countRes.rows[0].count;
      totalRows += Number(count);
      console.log(`| ${table.padEnd(35)} | ${String(count).padStart(18)} |`);
    }

    console.log('='.repeat(60));
    console.log(`| ${'TOTAL TABLES: ' + tableNames.length.toString().padEnd(21)} | ${String(totalRows).padStart(18)} |`);
    console.log('='.repeat(60));
  } catch (err) {
    console.error('❌ Failed to list tables:', err.message);
    process.exit(1);
  } finally {
    if (pool && pool.end) await pool.end();
    process.exit(0);
  }
}

listTables();
