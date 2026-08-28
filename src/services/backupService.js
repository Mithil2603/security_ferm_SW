const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const archiver = require('archiver');
const logger = require('../utils/logger');

const BACKUPS_DIR = path.join(process.cwd(), 'backups');

if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

/**
 * Creates a MySQL dump backup compressed into a zip.
 * Uses mysqldump which is included with MySQL installation.
 * @returns {Promise<string>} The path to the created backup zip file.
 */
async function createBackup() {
  const host     = process.env.DB_HOST     || 'localhost';
  const port     = process.env.DB_PORT     || '3306';
  const user     = process.env.DB_USER     || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME     || 'security_firm_db';

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpFilename = `dump-${timestamp}.sql`;
  const backupFilename = `backup-${timestamp}.zip`;
  const dumpPath   = path.join(BACKUPS_DIR, dumpFilename);
  const backupPath = path.join(BACKUPS_DIR, backupFilename);

  // Step 1: Run mysqldump to create a SQL dump file
  await new Promise((resolve, reject) => {
    // Find mysqldump — check common MySQL installation paths on Windows
    const mysqldumpPaths = [
      'mysqldump',
      'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqldump.exe',
      'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe',
      'C:\\xampp\\mysql\\bin\\mysqldump.exe',
    ];

    const args = [
      `--host=${host}`,
      `--port=${port}`,
      `--user=${user}`,
      '--single-transaction',     // Non-locking backup for InnoDB
      '--routines',
      '--triggers',
      '--add-drop-table',
      database,
    ];

    // Try each path until one works
    let tried = 0;
    function tryNext(paths) {
      if (paths.length === 0) {
        return reject(new Error('mysqldump not found. Make sure MySQL is installed and in PATH.'));
      }
      const [current, ...rest] = paths;
      const child = execFile(current, args, { maxBuffer: 50 * 1024 * 1024, env: { ...process.env, MYSQL_PWD: password } }, async (err, stdout, stderr) => {
        if (err) {
          if (rest.length > 0) return tryNext(rest);
          return reject(new Error(`mysqldump failed: ${stderr || err.message}`));
        }
        // Write dump to file asynchronously
        try {
          await fs.promises.writeFile(dumpPath, stdout, 'utf8');
          resolve();
        } catch (writeErr) {
          reject(writeErr);
        }
      });
    }
    tryNext(mysqldumpPaths);
  });

  // Step 2: Compress the dump into a zip
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(backupPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      // Remove the raw SQL dump — we have the zip now
      try { fs.unlinkSync(dumpPath); } catch (_) {}
      logger.info(`✅ Backup created: ${backupFilename} (${archive.pointer()} bytes)`);
      cleanOldBackups();
      resolve(backupPath);
    });

    archive.on('error', reject);
    archive.pipe(output);
    archive.file(dumpPath, { name: dumpFilename });
    archive.finalize();
  });

  return backupPath;
}

/**
 * Cleans up old backups — keeps only the last 30 days.
 */
function cleanOldBackups() {
  try {
    const files = fs.readdirSync(BACKUPS_DIR);
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    for (const file of files) {
      if (file.startsWith('backup-') && file.endsWith('.zip')) {
        const filePath = path.join(BACKUPS_DIR, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > thirtyDaysMs) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      }
    }

    if (deletedCount > 0) {
      logger.info(`Cleaned up ${deletedCount} old backup(s).`);
    }
  } catch (error) {
    logger.error('Error cleaning old backups:', error);
  }
}

/**
 * Gets a list of available backups.
 */
async function getAvailableBackups() {
  try {
    const files = await fs.promises.readdir(BACKUPS_DIR);
    const backups = [];
    
    for (const f of files) {
      if (f.startsWith('backup-') && f.endsWith('.zip')) {
        const stats = await fs.promises.stat(path.join(BACKUPS_DIR, f));
        backups.push({ filename: f, sizeBytes: stats.size, createdAt: stats.mtime });
      }
    }
    
    return backups.sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    logger.error('Error listing backups:', error);
    return [];
  }
}

module.exports = { createBackup, cleanOldBackups, getAvailableBackups, BACKUPS_DIR };
