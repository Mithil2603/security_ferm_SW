const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const archiver = require('archiver');
const logger = require('../utils/logger');
const { query, pool } = require('../database/connection');

const DEFAULT_BACKUPS_DIR = path.join(process.cwd(), 'backups');

if (!fs.existsSync(DEFAULT_BACKUPS_DIR)) {
  fs.mkdirSync(DEFAULT_BACKUPS_DIR, { recursive: true });
}

/**
 * Retrieves the current backup settings from system_settings table.
 */
async function getBackupSettings() {
  try {
    const res = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'backup_settings'");
    if (res.rows.length > 0) {
      const parsed = JSON.parse(res.rows[0].setting_value);
      return {
        backup_destination_path: parsed.backup_destination_path || DEFAULT_BACKUPS_DIR,
        auto_backup_enabled: parsed.auto_backup_enabled !== false,
        auto_backup_time: parsed.auto_backup_time || '02:00',
        auto_backup_frequency: parsed.auto_backup_frequency || 'daily',
        allowed_roles: Array.isArray(parsed.allowed_roles) ? parsed.allowed_roles : ['admin']
      };
    }
  } catch (err) {
    logger.warn('Could not read backup_settings from DB, using defaults:', err.message);
  }

  return {
    backup_destination_path: DEFAULT_BACKUPS_DIR,
    auto_backup_enabled: true,
    auto_backup_time: '02:00',
    auto_backup_frequency: 'daily',
    allowed_roles: ['admin']
  };
}

/**
 * Saves updated backup settings to system_settings table.
 */
async function saveBackupSettings(settings) {
  const current = await getBackupSettings();
  const merged = {
    backup_destination_path: settings.backup_destination_path || current.backup_destination_path || DEFAULT_BACKUPS_DIR,
    auto_backup_enabled: settings.auto_backup_enabled !== undefined ? !!settings.auto_backup_enabled : current.auto_backup_enabled,
    auto_backup_time: settings.auto_backup_time || current.auto_backup_time || '02:00',
    auto_backup_frequency: settings.auto_backup_frequency || current.auto_backup_frequency || 'daily',
    allowed_roles: Array.isArray(settings.allowed_roles) ? settings.allowed_roles : current.allowed_roles
  };

  // Ensure destination directory exists
  if (!fs.existsSync(merged.backup_destination_path)) {
    fs.mkdirSync(merged.backup_destination_path, { recursive: true });
  }

  const jsonVal = JSON.stringify(merged);
  await query(
    "INSERT INTO system_settings (setting_key, setting_value, updated_at) VALUES ('backup_settings', $1, CURRENT_TIMESTAMP) " +
    "ON DUPLICATE KEY UPDATE setting_value = $1, updated_at = CURRENT_TIMESTAMP",
    [jsonVal]
  );

  return merged;
}

/**
 * Gets the active backup directory.
 */
async function getActiveBackupDir() {
  const settings = await getBackupSettings();
  const targetDir = settings.backup_destination_path || DEFAULT_BACKUPS_DIR;
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (e) {
      logger.warn(`Could not create custom backup dir ${targetDir}, falling back to default`, e.message);
      return DEFAULT_BACKUPS_DIR;
    }
  }
  return targetDir;
}

/**
 * Creates a MySQL dump backup compressed into a zip.
 * Uses mysqldump if available, or Node MySQL schema+data dump fallback.
 * @returns {Promise<{ filename: string, path: string, sizeBytes: number, createdAt: Date }>}
 */
async function createBackup(customDir = null) {
  const host     = process.env.DB_HOST     || 'localhost';
  const port     = process.env.DB_PORT     || '3306';
  const user     = process.env.DB_USER     || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME     || 'security_firm_db';

  const backupDir = customDir || await getActiveBackupDir();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpFilename = `dump-${timestamp}.sql`;
  const backupFilename = `backup-${timestamp}.zip`;
  const dumpPath   = path.join(backupDir, dumpFilename);
  const backupPath = path.join(backupDir, backupFilename);

  // Step 1: Generate SQL Dump
  let dumpSuccess = false;
  try {
    await new Promise((resolve, reject) => {
      const mysqldumpPaths = [
        'mysqldump',
        'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqldump.exe',
        'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe',
        'C:\\Program Files\\MySQL\\MySQL Server 8.1\\bin\\mysqldump.exe',
        'C:\\xampp\\mysql\\bin\\mysqldump.exe',
        'C:\\wamp64\\bin\\mysql\\mysql8.0.31\\bin\\mysqldump.exe',
      ];

      const args = [
        `--host=${host}`,
        `--port=${port}`,
        `--user=${user}`,
        password ? `--password=${password}` : '--password=',
        '--single-transaction',
        '--routines',
        '--triggers',
        '--add-drop-table',
        database,
      ];

      function tryNext(paths) {
        if (paths.length === 0) {
          return reject(new Error('mysqldump binary not found in standard paths.'));
        }
        const [current, ...rest] = paths;
        execFile(current, args, { maxBuffer: 100 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            if (rest.length > 0) return tryNext(rest);
            return reject(new Error(`mysqldump failed: ${stderr || err.message}`));
          }
          fs.writeFileSync(dumpPath, stdout, 'utf8');
          resolve();
        });
      }
      tryNext(mysqldumpPaths);
    });
    dumpSuccess = true;
  } catch (dumpErr) {
    logger.warn('mysqldump CLI execution skipped or failed, using pure MySQL query dump fallback:', dumpErr.message);
    // Node-MySQL Pure Dump Fallback
    await generateNodeMysqlDump(database, dumpPath);
    dumpSuccess = true;
  }

  // Step 2: Compress into ZIP
  const finalZipPath = await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(backupPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      try { fs.unlinkSync(dumpPath); } catch (_) {}
      logger.info(`✅ Backup created: ${backupFilename} (${archive.pointer()} bytes) in ${backupDir}`);
      cleanOldBackups(backupDir);
      resolve(backupPath);
    });

    archive.on('error', reject);
    archive.pipe(output);
    archive.file(dumpPath, { name: dumpFilename });
    archive.finalize();
  });

  const stats = fs.statSync(finalZipPath);
  return {
    filename: backupFilename,
    path: finalZipPath,
    sizeBytes: stats.size,
    createdAt: stats.mtime
  };
}

/**
 * Fallback SQL generator when mysqldump binary is not installed on Windows
 */
async function generateNodeMysqlDump(databaseName, outputPath) {
  const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf8' });

  writeStream.write(`-- Security Firm Management SQL Dump\n`);
  writeStream.write(`-- Date: ${new Date().toISOString()}\n\n`);
  writeStream.write(`SET FOREIGN_KEY_CHECKS=0;\n\n`);

  const [tables] = await pool.query(`SHOW TABLES`);
  const tableKey = Object.keys(tables[0] || {})[0];

  for (const row of tables) {
    const tableName = row[tableKey];
    const [createTable] = await pool.query(`SHOW CREATE TABLE \`${tableName}\``);
    const createSql = createTable[0]['Create Table'];

    writeStream.write(`DROP TABLE IF EXISTS \`${tableName}\`;\n`);
    writeStream.write(`${createSql};\n\n`);

    const [rows] = await pool.query(`SELECT * FROM \`${tableName}\``);
    if (rows && rows.length > 0) {
      for (const dataRow of rows) {
        const columns = Object.keys(dataRow).map(c => `\`${c}\``).join(', ');
        const values = Object.values(dataRow).map(val => {
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'number') return val;
          if (typeof val === 'boolean') return val ? 1 : 0;
          if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
          return `'${String(val).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
        }).join(', ');

        writeStream.write(`INSERT INTO \`${tableName}\` (${columns}) VALUES (${values});\n`);
      }
      writeStream.write(`\n`);
    }
  }

  writeStream.write(`SET FOREIGN_KEY_CHECKS=1;\n`);
  await new Promise(resolve => writeStream.end(resolve));
}

/**
 * Cleans up old backups — keeps only the last 30 days.
 */
async function cleanOldBackups(targetDir = null) {
  try {
    const dir = targetDir || await getActiveBackupDir();
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    for (const file of files) {
      if (file.startsWith('backup-') && file.endsWith('.zip')) {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > thirtyDaysMs) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      }
    }

    if (deletedCount > 0) {
      logger.info(`Cleaned up ${deletedCount} old backup(s) from ${dir}.`);
    }
  } catch (error) {
    logger.error('Error cleaning old backups:', error);
  }
}

/**
 * Gets a list of available backups from the configured directory.
 */
async function getAvailableBackups() {
  try {
    const dir = await getActiveBackupDir();
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir);
    return files
      .filter(f => f.startsWith('backup-') && f.endsWith('.zip'))
      .map(f => {
        const stats = fs.statSync(path.join(dir, f));
        return { filename: f, sizeBytes: stats.size, createdAt: stats.mtime, path: path.join(dir, f) };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    logger.error('Error listing backups:', error);
    return [];
  }
}

/**
 * Deletes a specific backup file.
 */
async function deleteBackup(filename) {
  const dir = await getActiveBackupDir();
  const safeFilename = path.basename(filename);
  const filePath = path.join(dir, safeFilename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

module.exports = {
  createBackup,
  cleanOldBackups,
  getAvailableBackups,
  getBackupSettings,
  saveBackupSettings,
  getActiveBackupDir,
  deleteBackup,
  DEFAULT_BACKUPS_DIR
};
