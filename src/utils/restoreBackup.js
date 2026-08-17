/**
 * restoreBackup.js
 *
 * MySQL backup restore utility.
 * Restores a mysqldump .sql file from a backup zip into the MySQL database.
 *
 * Usage:
 *   node src/utils/restoreBackup.js backup-2026-08-15T12-00-00-000Z.zip
 *
 * Requirements: mysql CLI must be in PATH (installed with MySQL).
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');

const backupFileName = process.argv[2];
if (!backupFileName) {
  console.error('❌ Please provide the backup filename.');
  console.error('Usage: node src/utils/restoreBackup.js backup-2026-08-15T12-00-00-000Z.zip');
  process.exit(1);
}

const backupDir  = path.join(process.cwd(), 'backups');
const backupPath = path.join(backupDir, backupFileName);

if (!fs.existsSync(backupPath)) {
  console.error(`❌ Backup file not found: ${backupPath}`);
  process.exit(1);
}

const host     = process.env.DB_HOST     || 'localhost';
const port     = process.env.DB_PORT     || '3306';
const user     = process.env.DB_USER     || 'root';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME     || 'security_firm_db';

try {
  console.log(`📦 Extracting backup: ${backupFileName}`);

  // Extract the .sql file from the zip
  const zip = new AdmZip(backupPath);
  const sqlEntry = zip.getEntries().find(e => e.entryName.endsWith('.sql'));
  if (!sqlEntry) throw new Error('No .sql file found inside the zip backup!');

  const tempSqlPath = path.join(backupDir, '_restore_temp.sql');
  zip.extractEntryTo(sqlEntry, backupDir, false, true);
  const extractedPath = path.join(backupDir, sqlEntry.entryName);

  console.log(`🔄 Restoring to MySQL database: ${database}`);

  // Find mysql CLI
  const mysqlPaths = [
    'mysql',
    'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe',
    'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe',
    'C:\\xampp\\mysql\\bin\\mysql.exe',
  ];

  let restored = false;
  for (const mysqlBin of mysqlPaths) {
    try {
      const args = [
        `--host=${host}`,
        `--port=${port}`,
        `--user=${user}`,
        password ? `--password=${password}` : '--password=',
        database,
      ];
      execFileSync(mysqlBin, args, {
        input: fs.readFileSync(extractedPath, 'utf8'),
        stdio: ['pipe', 'inherit', 'inherit'],
        maxBuffer: 100 * 1024 * 1024
      });
      restored = true;
      break;
    } catch (e) {
      continue;
    }
  }

  // Cleanup temp extracted file
  try { if (fs.existsSync(extractedPath)) fs.unlinkSync(extractedPath); } catch (_) {}

  if (!restored) {
    throw new Error('mysql CLI not found. Make sure MySQL is installed and in PATH.');
  }

  console.log(`✅ Successfully restored database from ${backupFileName}!`);
} catch (error) {
  console.error('❌ Failed to restore backup:', error.message);
  process.exit(1);
}
