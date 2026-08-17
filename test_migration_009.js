const fs = require('fs');
const mysql = require('mysql2/promise');

function adaptMigrationSQL(sql) {
  let q = sql;
  q = q.replace(/strftime\s*\(\s*'%Y-%m'\s*,\s*([^)]+)\)/gi, "DATE_FORMAT($1, '%Y-%m')");
  q = q.replace(/strftime\s*\(\s*'%Y'\s*,\s*([^)]+)\)/gi, 'YEAR($1)');
  q = q.replace(/strftime\s*\(\s*'%m'\s*,\s*([^)]+)\)/gi, 'MONTH($1)');
  q = q.replace(/strftime\s*\(\s*'%d'\s*,\s*([^)]+)\)/gi, 'DAY($1)');
  q = q.replace(/strftime\s*\(\s*'%H:%M'\s*,\s*([^)]+)\)/gi, "TIME_FORMAT($1, '%H:%i')");
  q = q.replace(/\bdate\s*\(\s*'now'\s*,?\s*'?localtime'?\s*\)/gi, 'CURDATE()');
  q = q.replace(/\bdate\s*\(\s*'now'\s*\)/gi, 'CURDATE()');
  q = q.replace(/\bdatetime\s*\(\s*'now'\s*\)/gi, 'NOW()');
  q = q.replace(/\bAUTOINCREMENT\b/gi, 'AUTO_INCREMENT');
  q = q.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTO_INCREMENT\b/gi, 'INT AUTO_INCREMENT PRIMARY KEY');
  q = q.replace(/\bINTEGER\s+PRIMARY\s+KEY\b/gi, 'INT AUTO_INCREMENT PRIMARY KEY');
  q = q.replace(/\bREAL\b/g, 'DOUBLE');
  q = q.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT IGNORE INTO');
  q = q.replace(/\s+ON\s+CONFLICT\s+DO\s+NOTHING/gi, '');
  q = q.replace(/ON\s+CONFLICT\s*\([^)]+\)\s*DO\s+UPDATE\s+SET/gi, 'ON DUPLICATE KEY UPDATE');
  q = q.replace(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/gi, 'CREATE INDEX');
  q = q.replace(/\s+REFERENCES\s+\w+\s*\(\s*\w+\s*\)/g, '');
  q = q.replace(/PRAGMA\s+[^;]+;?/gi, '');
  return q;
}

async function test() {
  const c = await mysql.createConnection({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: 'security_firm_db'
  });

  const sql = fs.readFileSync('src/database/migrations/009_add_vouchers_and_bank.sql', 'utf8');
  const adapted = adaptMigrationSQL(sql);
  const stmts = adapted.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));
  
  for (let s of stmts) {
    try {
      await c.query(s);
      console.log('OK for:', s.slice(0, 50).replace(/\n/g, ' '));
    } catch (e) {
      console.error('ERR:', e.errno, e.message);
      console.error('SQL:', s.slice(0, 100).replace(/\n/g, ' '));
    }
  }
  await c.end();
}
test().catch(console.error);
