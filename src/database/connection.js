const logger = require('../utils/logger.js');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { runMigrations } = require('./migrationRunner');

// Determine database path
// In Electron, main.js will set process.env.DB_PATH.
// In dev, it defaults to project root.
const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'database.sqlite');
const isDev = process.env.NODE_ENV !== 'production';

let db;

function initDB() {
  const dbExists = fs.existsSync(dbPath);
  db = new Database(dbPath, { verbose: isDev ? logger.info : null });
  
  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  
  // Enable Write-Ahead Logging (WAL) for concurrency
  db.pragma('journal_mode = WAL');

  if (!dbExists) {
    logger.info('database.sqlite not found. Initializing new database...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      db.exec(schemaSql);
      logger.info('Database initialized with schema.sql');
      
      // Note: First admin account is created via the Setup Wizard (frontend/src/pages/Setup.jsx)
      // The POST /api/auth/setup-init endpoint handles admin creation on first launch.
    } else {
      logger.error('schema.sql not found at', schemaPath);
    }
  } else {
    logger.info('✅ Database connected successfully (SQLite)');
  }

  // Run pending migrations (safe on both new and existing databases)
  try {
    runMigrations(db);
  } catch (err) {
    logger.error('⚠ Migration runner error (non-fatal):', err.message);
  }
}

// Initialize on require
initDB();

// Mock Pool object to satisfy Express startup
const pool = {
  on: (event, handler) => {},
  connect: (cb) => cb(null, {}, () => {}),
  query: async (text, params) => query(text, params)
};

// Adapter function
const query = async (text, params = []) => {
  const start = Date.now();
  try {
    // 1. Convert PostgreSQL parameter syntax ($1, $2) to SQLite syntax (?)
    //    Properly handle repeated $N references by expanding the params array.
    //    In PostgreSQL, $1 always means the 1st param regardless of position.
    //    In SQLite, each ? consumes the next param in order.
    const expandedParams = [];
    let sqliteText = text.replace(/\$(\d+)/g, (match, num) => {
      const pgIndex = parseInt(num) - 1; // PostgreSQL is 1-indexed
      if (pgIndex >= 0 && pgIndex < params.length) {
        expandedParams.push(params[pgIndex]);
      }
      return '?';
    });
    
    // 2. Remove RETURNING clauses (SQLite doesn't support them identically for all queries)
    // Basic regex to strip RETURNING * or RETURNING id, etc.
    const returningRegex = /\s+RETURNING\s+.+/i;
    const match = sqliteText.match(returningRegex);
    let returningRemoved = false;
    if (match) {
      sqliteText = sqliteText.replace(returningRegex, '');
      returningRemoved = true;
    }

    // Determine query type
    const isSelect = sqliteText.trim().toUpperCase().startsWith('SELECT');
    
    // Map params: SQLite doesn't support booleans natively
    const mappedParams = expandedParams.map(p => {
      if (typeof p === 'boolean') return p ? 1 : 0;
      if (p instanceof Date) return p.toISOString();
      return p;
    });
    
    let res;
    if (isSelect) {
      const stmt = db.prepare(sqliteText);
      const rows = stmt.all(...mappedParams);
      res = { rows, rowCount: rows.length };
    } else {
      const stmt = db.prepare(sqliteText);
      const info = stmt.run(...mappedParams);
      
      // Simulate pg response format
      res = { rows: [], rowCount: info.changes };
      
      // If there was a returning clause on an insert, we try to simulate returning the row
      if (returningRemoved && info.lastInsertRowid) {
        // Try to fetch the full row if we can determine the table
        const insertMatch = sqliteText.match(/INSERT\s+INTO\s+([a-zA-Z0-9_]+)/i);
        if (insertMatch && insertMatch[1]) {
          const tableName = insertMatch[1];
          try {
            const fetchStmt = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`);
            const row = fetchStmt.get(info.lastInsertRowid);
            res.rows = row ? [row] : [{ id: info.lastInsertRowid }];
          } catch (err) {
            // Fallback if table name extraction failed or table doesn't have an 'id' column
            res.rows = [{ id: info.lastInsertRowid }];
          }
        } else {
          // Return a mock object with id
          res.rows = [{ id: info.lastInsertRowid }];
        }
      }
    }

    const duration = Date.now() - start;
    if (isDev && duration > 1000) {
      logger.warn('Slow query detected:', { text, duration, rows: res.rowCount });
    }
    
    return res;
  } catch (error) {
    logger.error('Database query error:', error.message, '| Query:', text);
    throw error;
  }
};

module.exports = { pool, query, db };
