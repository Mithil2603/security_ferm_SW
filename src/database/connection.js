const logger = require('../utils/logger.js');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('./migrationRunner');

// ─────────────────────────────────────────────────────────────────────────────
// MySQL Connection Pool
// ─────────────────────────────────────────────────────────────────────────────
const poolConfig = {
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'security_firm_db',
  waitForConnections: true,
  connectionLimit:    10,          // Support up to 10 simultaneous LAN users
  queueLimit:         0,
  enableKeepAlive:    true,
  keepAliveInitialDelay: 30000,
  timezone:           '+05:30',    // IST — matches your location
  charset:            'utf8mb4',
  multipleStatements: true,        // Needed for schema init
  dateStrings:        true,        // Emulate SQLite's behavior of returning native raw date strings instead of Date objects
};

let pool = null;

async function initPool() {
  try {
    pool = mysql.createPool(poolConfig);

    // Set sql_mode to treat || as string concatenation (SQLite style) instead of Logical OR (MySQL style)
    pool.on('connection', (connection) => {
      connection.query("SET SESSION sql_mode=(SELECT CONCAT(@@sql_mode,',PIPES_AS_CONCAT'))");
    });

    // Test the connection
    const conn = await pool.getConnection();
    logger.info('✅ MySQL connected successfully to ' + poolConfig.host + ':' + poolConfig.port + '/' + poolConfig.database);
    conn.release();
    return true;
  } catch (err) {
    logger.error('❌ MySQL connection failed:', err.message);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SQLite-to-MySQL SQL Adapter
// Converts SQLite-specific syntax used throughout all routes to MySQL syntax.
// This runs at query time so no route files need to be changed.
// ─────────────────────────────────────────────────────────────────────────────
function adaptSqlForMySQL(sql) {
  let q = sql;

  // 1. strftime('%Y-%m', col) → DATE_FORMAT(col, '%Y-%m')
  q = q.replace(/strftime\s*\(\s*'%Y-%m'\s*,\s*([^)]+)\)/gi, "DATE_FORMAT($1, '%Y-%m')");

  // 2. strftime('%Y', col) → YEAR(col)  — must come before generic strftime
  q = q.replace(/strftime\s*\(\s*'%Y'\s*,\s*([^)]+)\)/gi, 'YEAR($1)');

  // 3. strftime('%m', col) → MONTH(col)
  q = q.replace(/strftime\s*\(\s*'%m'\s*,\s*([^)]+)\)/gi, 'MONTH($1)');

  // 4. strftime('%d', col) → DAY(col)
  q = q.replace(/strftime\s*\(\s*'%d'\s*,\s*([^)]+)\)/gi, 'DAY($1)');

  // 5. strftime('%H:%M', col) → TIME_FORMAT(col, '%H:%i')
  q = q.replace(/strftime\s*\(\s*'%H:%M'\s*,\s*([^)]+)\)/gi, "TIME_FORMAT($1, '%H:%i')");

  // 6. CAST(strftime(...) AS INTEGER) is already handled by above — but just in case
  //    CAST(YEAR(col) AS INTEGER) → YEAR(col) [already numeric in MySQL]
  q = q.replace(/CAST\s*\(\s*(YEAR\([^)]+\))\s*AS\s+INTEGER\s*\)/gi, '$1');
  q = q.replace(/CAST\s*\(\s*(MONTH\([^)]+\))\s*AS\s+INTEGER\s*\)/gi, '$1');

  // 7. date('now') or date('now', 'localtime') → CURDATE()
  q = q.replace(/date\s*\(\s*'now'\s*,?\s*'?localtime'?\s*\)/gi, 'CURDATE()');
  q = q.replace(/date\s*\(\s*'now'\s*\)/gi, 'CURDATE()');

  // 8. date(col, 'start of month') → DATE_FORMAT(col, '%Y-%m-01')
  q = q.replace(/date\s*\(\s*([^,)]+)\s*,\s*'start of month'\s*\)/gi, "DATE_FORMAT($1, '%Y-%m-01')");

  // 9. date(col, 'start of month', '+1 month', '-1 day') → LAST_DAY(col)
  q = q.replace(/date\s*\(\s*([^,)]+)\s*,\s*'start of month'\s*,\s*'\+1 month'\s*,\s*'-1 day'\s*\)/gi, 'LAST_DAY($1)');

  // 10. date(col, '+N days') → DATE_ADD(col, INTERVAL N DAY)
  q = q.replace(/date\s*\(\s*([^,)]+)\s*,\s*'\+(\d+)\s*days?'\s*\)/gi, 'DATE_ADD($1, INTERVAL $2 DAY)');
  q = q.replace(/date\s*\(\s*([^,)]+)\s*,\s*'-(\d+)\s*days?'\s*\)/gi, 'DATE_SUB($1, INTERVAL $2 DAY)');

  // 11. date(col, '+1 month') → DATE_ADD(col, INTERVAL 1 MONTH)
  q = q.replace(/date\s*\(\s*([^,)]+)\s*,\s*'\+1 month'\s*\)/gi, 'DATE_ADD($1, INTERVAL 1 MONTH)');

  // 12. date(col) → DATE(col) [just wrapping in DATE() is the same]
  q = q.replace(/\bdate\s*\(\s*(\$\d+)\s*\)/gi, 'DATE($1)');

  // 13. ON CONFLICT DO NOTHING → MySQL doesn't support this; use INSERT IGNORE
  if (/ON CONFLICT\s+DO NOTHING/i.test(q)) {
    q = q.replace(/\s+ON CONFLICT\s+DO NOTHING/gi, '');
    q = q.replace(/^INSERT INTO/i, 'INSERT IGNORE INTO');
  }

  // 14. ON CONFLICT(col) DO UPDATE SET ... → ON DUPLICATE KEY UPDATE ...
  //     (handled per-query if needed — complex replacement)
  q = q.replace(/ON CONFLICT\s*\([^)]+\)\s*DO UPDATE SET/gi, 'ON DUPLICATE KEY UPDATE');

  // 15. AUTOINCREMENT → AUTO_INCREMENT (SQLite vs MySQL spelling)
  q = q.replace(/\bAUTOINCREMENT\b/gi, 'AUTO_INCREMENT');

  // 16. BEGIN TRANSACTION -> START TRANSACTION
  q = q.replace(/^BEGIN TRANSACTION/i, 'START TRANSACTION');

  // 16. INTEGER PRIMARY KEY → INT AUTO_INCREMENT PRIMARY KEY (SQLite magic rowid)
  //     Only for CREATE TABLE context — this is handled in schema_mysql.sql directly

  // 17. CAST(julianday('now') - julianday(v.due_date) AS INTEGER) -> DATEDIFF(CURDATE(), v.due_date)
  q = q.replace(/CAST\(\s*julianday\('now'\)\s*-\s*julianday\(([^)]+)\)\s*AS\s*INTEGER\s*\)/gi, 'DATEDIFF(CURDATE(), $1)');

  // 18. Remove SQLite-only pragma
  q = q.replace(/PRAGMA\s+\w+\s*=\s*\w+;?/gi, '');

  return q;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main query() function — same API as before, works with all existing routes
// ─────────────────────────────────────────────────────────────────────────────
const query = async (text, params = []) => {
  if (!pool) {
    throw new Error('MySQL pool not initialized. Call initPool() first.');
  }
  const start = Date.now();
  try {
    // 1. Convert PostgreSQL $1,$2 style params → MySQL ? style
    const expandedParams = [];
    let mysqlText = text.replace(/\$(\d+)/g, (match, num) => {
      const pgIndex = parseInt(num) - 1;
      if (pgIndex >= 0 && pgIndex < params.length) {
        expandedParams.push(params[pgIndex]);
      }
      return '?';
    });

    // 2. Adapt SQLite-specific SQL to MySQL syntax
    mysqlText = adaptSqlForMySQL(mysqlText);

    // 3. Handle RETURNING clause — MySQL doesn't support it
    //    We strip it and do a SELECT LAST_INSERT_ID() after INSERT
    const returningRegex = /\s+RETURNING\s+.+/i;
    const hasReturning = returningRegex.test(mysqlText);
    if (hasReturning) {
      mysqlText = mysqlText.replace(returningRegex, '');
    }

    // 4. Map params: convert booleans, Dates
    const mappedParams = expandedParams.map(p => {
      if (typeof p === 'boolean') return p ? 1 : 0;
      if (p instanceof Date) return p.toISOString().slice(0, 19).replace('T', ' ');
      if (p === undefined) return null;
      if (typeof p === 'number') return String(p);
      return p;
    });

    // 5. Execute
    let executeRows, fields;
    if (/^(START TRANSACTION|COMMIT|ROLLBACK)/i.test(mysqlText)) {
      // Transaction commands fail with pool.execute (prepared statements) in MySQL
      [executeRows, fields] = await pool.query(mysqlText);
    } else {
      [executeRows, fields] = await pool.execute(mysqlText, mappedParams);
    }
    const rows = executeRows;

    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn('Slow query detected:', { duration, query: mysqlText.slice(0, 100) });
    }

    // 6. Handle INSERT/UPDATE/DELETE result
    if (rows && !Array.isArray(rows)) {
      // It's a ResultSetHeader (INSERT/UPDATE/DELETE)
      const header = rows;
      const result = { rows: [], rowCount: header.affectedRows };
      if (hasReturning && header.insertId) {
        // Simulate RETURNING by fetching the inserted row
        const tableMatch = mysqlText.match(/INSERT\s+(?:IGNORE\s+)?INTO\s+(`?\w+`?)/i);
        if (tableMatch && tableMatch[1]) {
          const tableName = tableMatch[1].replace(/`/g, '');
          try {
            const [fetchRows] = await pool.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [header.insertId]);
            result.rows = fetchRows.length > 0 ? fetchRows : [{ id: header.insertId }];
          } catch (_) {
            result.rows = [{ id: header.insertId }];
          }
        } else {
          result.rows = [{ id: header.insertId }];
        }
      }
      return result;
    }

    // SELECT result
    return { rows: Array.isArray(rows) ? rows : [], rowCount: Array.isArray(rows) ? rows.length : 0 };

  } catch (error) {
    logger.error('Database query error:', error.message, '\nQuery:', text.slice(0, 200));
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Initialize DB: create schema if needed, run migrations
// ─────────────────────────────────────────────────────────────────────────────
async function initDB() {
  await initPool();

  // Check if tables exist; if not, run schema
  try {
    const [rows] = await pool.execute(
      "SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = ? AND table_name = 'users'",
      [poolConfig.database]
    );
    const tablesExist = rows[0].cnt > 0;

    if (!tablesExist) {
      logger.info('🆕 MySQL database is empty. Initializing schema...');
      const schemaPath = path.join(__dirname, 'schema_mysql.sql');
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        // Use a dedicated connection with multipleStatements to execute the whole schema at once
        const schemaConn = await require('mysql2/promise').createConnection({
          ...poolConfig,
          multipleStatements: true,
        });
        try {
          await schemaConn.query(schemaSql);
          logger.info('✅ MySQL schema initialized successfully.');
        } catch (schemaErr) {
          logger.error('❌ Schema init error:', schemaErr.message.slice(0, 200));
          // Log the statement that failed for debugging
          logger.error('   Failing near:', schemaErr.sqlMessage || schemaErr.message);
          throw schemaErr;
        } finally {
          await schemaConn.end();
        }
      } else {
        logger.error('❌ schema_mysql.sql not found at', schemaPath);
      }
    } else {
      logger.info('✅ MySQL database schema already exists.');
    }

    // Run pending migrations
    await runMigrations(pool, query);
  } catch (err) {
    logger.error('DB init error:', err.message);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock `db` object for any legacy code that used better-sqlite3 db directly
// ─────────────────────────────────────────────────────────────────────────────
const db = {
  prepare: () => { throw new Error('Direct db.prepare() not supported in MySQL mode. Use query() instead.'); },
  exec:    () => { throw new Error('Direct db.exec() not supported in MySQL mode. Use query() instead.'); },
  _pool:   () => pool,  // Escape hatch for migration tools
};

// ─────────────────────────────────────────────────────────────────────────────
// Exports — same surface as before
// ─────────────────────────────────────────────────────────────────────────────
module.exports = { pool: { query: async (t, p) => query(t, p) }, query, db, initDB, adaptSqlForMySQL };
