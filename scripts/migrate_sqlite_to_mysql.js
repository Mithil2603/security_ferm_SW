#!/usr/bin/env node
/**
 * migrate_sqlite_to_mysql.js
 * 
 * One-time migration tool: copies all data from database.sqlite → MySQL.
 * 
 * Usage:
 *   1. Make sure MySQL is running and .env has the correct credentials
 *   2. Run: node scripts/migrate_sqlite_to_mysql.js
 *   3. The script will print a row-count report at the end
 * 
 * Safe to run multiple times — uses INSERT IGNORE to skip duplicates.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

// ── SQLite source ────────────────────────────────────────────────────────────
const Database = require('better-sqlite3');
const dbPath = process.env.SQLITE_SOURCE_PATH
  || path.join(process.env.APPDATA || process.env.HOME, 'secuirty-agency-software', 'database.sqlite');

if (!fs.existsSync(dbPath)) {
  console.error('❌ SQLite database not found at:', dbPath);
  console.error('   Set SQLITE_SOURCE_PATH env var if the file is in a different location.');
  process.exit(1);
}

// ── MySQL target ─────────────────────────────────────────────────────────────
const mysql = require('mysql2/promise');

// Column type conversions from SQLite to MySQL
function convertValue(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  return val;
}

async function migrate() {
  console.log('🚀 Starting SQLite → MySQL migration...\n');

  // Open SQLite
  const sqlite = new Database(dbPath, { readonly: true });
  console.log('📂 SQLite source:', dbPath);

  // Open MySQL pool
  const pool = await mysql.createPool({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306'),
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'security_firm_db',
    multipleStatements: true,
    waitForConnections: true,
  });

  // Test MySQL connection
  const conn = await pool.getConnection();
  console.log('✅ MySQL connected to', process.env.DB_HOST + ':' + (process.env.DB_PORT || '3306'));
  
  // Disable Foreign Key checks for bulk import
  await conn.query('SET FOREIGN_KEY_CHECKS = 0;');
  conn.release();

  // Get ALL tables from SQLite
  const sqliteTables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence'").all().map(r => r.name);
  
  const report = [];

  for (const table of sqliteTables) {
    // Get all rows from SQLite
    const rows = sqlite.prepare(`SELECT * FROM \`${table}\``).all();

    if (rows.length === 0) {
      console.log(`⬜ '${table}' — empty (0 rows)`);
      report.push({ table, skipped: false, rows: 0, inserted: 0 });
      continue;
    }

    // Get column names from first row
    const columns = Object.keys(rows[0]);
    const placeholders = columns.map(() => '?').join(', ');
    const colList = columns.map(c => `\`${c}\``).join(', ');
    const insertSql = `INSERT IGNORE INTO \`${table}\` (${colList}) VALUES (${placeholders})`;

    let inserted = 0;
    let errors = 0;

    const mysqlConn = await pool.getConnection();
    await mysqlConn.beginTransaction();

    try {
      for (const row of rows) {
        const values = columns.map(c => convertValue(row[c]));
        try {
          const [result] = await mysqlConn.execute(insertSql, values);
          if (result.affectedRows > 0) inserted++;
        } catch (rowErr) {
          // Log but continue
          errors++;
          if (errors <= 3) {
            console.warn(`   ⚠ Row error in '${table}': ${rowErr.message.slice(0, 80)}`);
          }
        }
      }
      await mysqlConn.commit();
      console.log(`✅ '${table}' — ${rows.length} rows read, ${inserted} inserted, ${errors} skipped`);
      report.push({ table, rows: rows.length, inserted, errors });
    } catch (err) {
      await mysqlConn.rollback();
      console.error(`❌ Failed to migrate '${table}':`, err.message);
      report.push({ table, rows: rows.length, inserted: 0, error: err.message });
    } finally {
      mysqlConn.release();
    }
  }

  // Re-enable Foreign Key checks
  const conn2 = await pool.getConnection();
  await conn2.query('SET FOREIGN_KEY_CHECKS = 1;');
  conn2.release();

  sqlite.close();
  await pool.end();

  // Print summary
  console.log('\n' + '═'.repeat(60));
  console.log('MIGRATION REPORT');
  console.log('═'.repeat(60));
  let totalRows = 0, totalInserted = 0;
  for (const r of report) {
    if (r.skipped) continue;
    totalRows += r.rows;
    totalInserted += r.inserted || 0;
    const status = r.error ? '❌' : (r.rows === r.inserted ? '✅' : '⚠️ ');
    console.log(`${status} ${r.table.padEnd(25)} ${String(r.rows).padStart(5)} rows → ${String(r.inserted || 0).padStart(5)} inserted`);
  }
  console.log('─'.repeat(60));
  console.log(`   ${'TOTAL'.padEnd(25)} ${String(totalRows).padStart(5)} rows → ${String(totalInserted).padStart(5)} inserted`);
  console.log('═'.repeat(60));

  if (totalInserted > 0) {
    console.log('\n🎉 Migration complete! Your MySQL database is ready.');
    console.log('   You can now start the app and it will use MySQL.');
  } else {
    console.log('\n⚠️  No rows were inserted. Check errors above.');
  }
}

migrate().catch(err => {
  console.error('\n❌ Fatal migration error:', err.message);
  process.exit(1);
});
