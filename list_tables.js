const mysql = require('mysql2/promise');
const Database = require('better-sqlite3');
const path = require('path');

const sqlitePath = path.join(process.env.APPDATA || process.env.HOME, 'secuirty-agency-software', 'database.sqlite');
let sqliteDb;
try {
  sqliteDb = new Database(sqlitePath, { readonly: true });
} catch (e) {
  console.error("Could not open SQLite database:", e.message);
}

async function run() {
  const c = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'security_firm_db'
  });

  const [tablesResult] = await c.query('SHOW TABLES');
  const mysqlTables = tablesResult.map(row => Object.values(row)[0]);

  let sqliteTotal = 0;
  let mysqlTotal = 0;

  console.log('='.repeat(80));
  console.log(`| ${'TABLE NAME'.padEnd(30)} | ${'SQLITE ROWS'.padEnd(15)} | ${'MYSQL ROWS'.padEnd(15)} | ${'STATUS'.padEnd(8)} |`);
  console.log('-'.repeat(80));

  for (const table of mysqlTables) {
    let sqliteCount = '-';
    let mysqlCount = 0;

    // Get MySQL count
    const [rows] = await c.query(`SELECT COUNT(*) as count FROM \`${table}\``);
    mysqlCount = rows[0].count;
    mysqlTotal += mysqlCount;

    // Get SQLite count
    if (sqliteDb) {
      const exists = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (exists) {
        const row = sqliteDb.prepare(`SELECT COUNT(*) as count FROM \`${table}\``).get();
        sqliteCount = row.count;
        sqliteTotal += sqliteCount;
      }
    }

    const matchStatus = (sqliteCount === '-' && mysqlCount === 0) ? 'EMPTY' :
                        (sqliteCount === '-' && mysqlCount > 0) ? 'NEW DATA' :
                        (sqliteCount === mysqlCount) ? 'MATCH' : 'DIFF';

    console.log(`| ${table.padEnd(30)} | ${String(sqliteCount).padStart(15)} | ${String(mysqlCount).padStart(15)} | ${matchStatus.padEnd(8)} |`);
  }

  console.log('='.repeat(80));
  console.log(`| ${'TOTALS'.padEnd(30)} | ${String(sqliteTotal).padStart(15)} | ${String(mysqlTotal).padStart(15)} |          |`);
  console.log('='.repeat(80));
  
  if (sqliteDb) {
    // Check if there are any tables in SQLite that are NOT in MySQL
    const sqliteTables = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    const missing = sqliteTables.filter(t => !mysqlTables.includes(t) && t !== 'sqlite_sequence');
    if (missing.length > 0) {
      console.log("\nWARNING: The following tables exist in SQLite but NOT in MySQL:");
      missing.forEach(t => console.log(`  - ${t}`));
    }
  }

  await c.end();
  if (sqliteDb) sqliteDb.close();
}

run().catch(e => {
  console.error("Fatal Error:", e);
  process.exit(1);
});
