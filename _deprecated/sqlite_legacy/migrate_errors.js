const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new Database(dbPath);

console.log('Running Phase 3 Database Migrations...');

try {
  // 4. Create error_logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS error_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      error_type VARCHAR(50) NOT NULL,
      error_message TEXT NOT NULL,
      stack_trace TEXT,
      endpoint VARCHAR(255),
      method VARCHAR(10),
      user_id INTEGER,
      client_ip VARCHAR(50),
      additional_data TEXT,
      is_resolved INTEGER DEFAULT 0,
      resolved_at TIMESTAMP,
      resolved_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (resolved_by) REFERENCES users(id)
    );
  `);
  console.log('Created error_logs table.');
} catch (e) {
  console.error(e);
}

console.log('Migration completed successfully.');
db.close();
