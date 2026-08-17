const logger = require('../utils/logger.js');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Convert SQLite migration SQL to MySQL-compatible SQL.
 * This is a more aggressive adapter for migration files which
 * contain more SQLite-specific constructs than runtime queries.
 */
function adaptMigrationSQL(sql) {
  let q = sql;

  // 1. strftime conversions
  q = q.replace(/strftime\s*\(\s*'%Y-%m'\s*,\s*([^)]+)\)/gi, "DATE_FORMAT($1, '%Y-%m')");
  q = q.replace(/strftime\s*\(\s*'%Y'\s*,\s*([^)]+)\)/gi, 'YEAR($1)');
  q = q.replace(/strftime\s*\(\s*'%m'\s*,\s*([^)]+)\)/gi, 'MONTH($1)');
  q = q.replace(/strftime\s*\(\s*'%d'\s*,\s*([^)]+)\)/gi, 'DAY($1)');
  q = q.replace(/strftime\s*\(\s*'%H:%M'\s*,\s*([^)]+)\)/gi, "TIME_FORMAT($1, '%H:%i')");

  // 2. date() functions
  q = q.replace(/\bdate\s*\(\s*'now'\s*,?\s*'?localtime'?\s*\)/gi, 'CURDATE()');
  q = q.replace(/\bdate\s*\(\s*'now'\s*\)/gi, 'CURDATE()');
  q = q.replace(/\bdatetime\s*\(\s*'now'\s*\)/gi, 'NOW()');

  // 3. AUTOINCREMENT → AUTO_INCREMENT
  q = q.replace(/\bAUTOINCREMENT\b/gi, 'AUTO_INCREMENT');

  // 4. INTEGER PRIMARY KEY → INT AUTO_INCREMENT PRIMARY KEY
  q = q.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTO_INCREMENT\b/gi, 'INT AUTO_INCREMENT PRIMARY KEY');
  q = q.replace(/\bINTEGER\s+PRIMARY\s+KEY\b/gi, 'INT AUTO_INCREMENT PRIMARY KEY');

  // 5. REAL → DOUBLE
  q = q.replace(/\bREAL\b/g, 'DOUBLE');

  // 6. BOOLEAN → TINYINT(1) (MySQL 8.4 is fine with BOOLEAN but this is safer)
  // q = q.replace(/\bBOOLEAN\b/gi, 'TINYINT(1)');

  // 7. INSERT OR IGNORE → INSERT IGNORE
  q = q.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT IGNORE INTO');

  // 8. ON CONFLICT DO NOTHING — remove (use INSERT IGNORE instead, handled above via 7+9)
  q = q.replace(/\s+ON\s+CONFLICT\s+DO\s+NOTHING/gi, '');

  // 9. ON CONFLICT(col) DO UPDATE SET → ON DUPLICATE KEY UPDATE
  q = q.replace(/ON\s+CONFLICT\s*\([^)]+\)\s*DO\s+UPDATE\s+SET/gi, 'ON DUPLICATE KEY UPDATE');

  // 10. CREATE INDEX IF NOT EXISTS → CREATE INDEX
  //     MySQL 8.4 does NOT support IF NOT EXISTS for indexes.
  //     Duplicate index errors (errno 1061) are caught and ignored in the runner below.
  q = q.replace(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/gi, 'CREATE INDEX');

  // 11. Inline REFERENCES (SQLite allows, MySQL parses but ignores inline FKs without failing)
  q = q.replace(/\bTEXT\s+PRIMARY\s+KEY\b/gi, 'VARCHAR(255) PRIMARY KEY');

  // 12. CURRENT_DATE for column default
  q = q.replace(/DEFAULT CURRENT_DATE/gi, "DEFAULT (CURDATE())");

  // 13. TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP — already MySQL native

  // 14. VARCHAR(n) for TEXT primary keys — fine in MySQL

  // 15. CHECK constraints with NULL (MySQL 8.0.16+ supports CHECK)
  // Keep as-is, MySQL 8 supports them

  // 16. PRAGMA statements — remove completely
  q = q.replace(/PRAGMA\s+[^;]+;?/gi, '');

  return q;
}

/**
 * Run all pending database migrations against MySQL.
 * @param {import('mysql2/promise').Pool} pool - The MySQL pool
 * @param {Function} query - The query() helper from connection.js
 */
async function runMigrations(pool, query) {
  // Ensure system_settings table exists
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key VARCHAR(50) PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // Get current schema version
  let currentVersion = 0;
  try {
    const [rows] = await pool.execute(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'schema_version'"
    );
    if (rows.length > 0) {
      currentVersion = parseInt(rows[0].setting_value) || 0;
    }
  } catch (err) {
    logger.info('No schema_version found, starting from 0');
  }

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    logger.info('No migrations directory found — skipping migrations.');
    return;
  }

  const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') || f.endsWith('.js'))
    .sort()
    .map(f => {
      const match = f.match(/^(\d+)_/);
      return {
        filename: f,
        version: match ? parseInt(match[1]) : 0,
        path: path.join(MIGRATIONS_DIR, f)
      };
    });

  const pendingMigrations = migrationFiles.filter(m => m.version > currentVersion);

  if (pendingMigrations.length === 0) {
    logger.info('Database schema is up to date.');
    return;
  }

  logger.info(`\n📦 Running ${pendingMigrations.length} pending migration(s)...`);

  for (const migration of pendingMigrations) {
    logger.info(`   ⬆ Running migration ${migration.filename}...`);
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      if (migration.filename.endsWith('.js')) {
        const run = require(migration.path);
        if (typeof run === 'function') {
          await run(conn, query);
        } else if (run && typeof run.up === 'function') {
          await run.up(conn, query);
        } else {
          throw new Error('JS migration must export a function or { up }');
        }
      } else {
        const rawSql = fs.readFileSync(migration.path, 'utf8');
        const adaptedSql = adaptMigrationSQL(rawSql);

        // Strip full-line and inline SQL comments safely before splitting
        const sqlNoComments = adaptedSql.replace(/--.*$/gm, '');
        const statements = sqlNoComments
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0);

        for (const stmt of statements) {
          try {
            await conn.query(stmt);
          } catch (stmtErr) {
            const ignoredErrors = [
              1060, // Duplicate column name (ALTER TABLE ADD COLUMN already exists)
              1061, // Duplicate key name (CREATE INDEX already exists)
              1050, // Table already exists
              1091, // Can't DROP; check that column/key exists
              1146, // Table doesn't exist (for migrations on tables from old schema)
            ];
            if (ignoredErrors.includes(stmtErr.errno)) {
              logger.warn(`   ⚠ Skipped (already done): ${stmtErr.message.slice(0, 80)}`);
            } else if (stmtErr.message.includes('already exists')) {
              logger.warn(`   ⚠ Already exists: ${stmtErr.message.slice(0, 80)}`);
            } else {
              // Re-throw for real errors
              throw stmtErr;
            }
          }
        }
      }

      // Update schema version
      await conn.execute(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES ('schema_version', ?)
         ON DUPLICATE KEY UPDATE setting_value = ?`,
        [String(migration.version), String(migration.version)]
      );

      await conn.commit();
      logger.info(`   ✅ Migration ${migration.filename} applied successfully.`);
    } catch (err) {
      try { await conn.rollback(); } catch (_) {}
      logger.error(`❌ Migration failed: ${migration.filename} — ${err.message}`);
      conn.release();
      throw new Error(`Migration '${migration.filename}' failed: ${err.message}`);
    }

    conn.release();
  }

  try {
    const [rows] = await pool.execute("SELECT setting_value FROM system_settings WHERE setting_key = 'schema_version'");
    logger.info(`📦 Database schema is now at version ${rows[0]?.setting_value || currentVersion}.\n`);
  } catch (_) {}
}

module.exports = { runMigrations };
