const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const backupService = require('../services/backupService');
const logger = require('../utils/logger');
const { logError, ERROR_SEVERITY, ERROR_CATEGORY } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requirePermission('manage_backups')); // BK-L5: Requires manage_backups permission (not exclusively admin, but restricted by default)

// GET /api/backups
router.get('/', async (req, res) => {
  try {
    const backups = await backupService.getAvailableBackups();
    // BK-M2: Limit to 30 most recent backups
    res.json({ success: true, data: backups.slice(0, 30) });
  } catch (error) {
    logError(error, req, {
      severity: ERROR_SEVERITY.HIGH, category: ERROR_CATEGORY.BACKUP,
      feature: 'backups-fetch',
      extra: { operation: 'fetch_backups' }
    });
    res.status(500).json({ success: false, message: 'Failed to fetch backups' });
  }
});

const backupRateLimits = new Map();

// POST /api/backups/create
router.post('/create', async (req, res) => {
  try {
    // BK-C4: Rate limiting
    const userId = req.user?.userId || req.ip;
    const lastBackup = backupRateLimits.get(userId);
    if (lastBackup && Date.now() - lastBackup < 5 * 60 * 1000) {
      return res.status(429).json({ success: false, message: 'Backup rate limit exceeded. Try again in 5 minutes.' });
    }
    backupRateLimits.set(userId, Date.now());

    const backupPath = await backupService.createBackup();
    
    // BK-H5: Audit log
    logger.info(`Manual backup created by ${userId}`);
    await query(`INSERT INTO audit_logs (user_id, action, table_name, description, ip_address) VALUES ($1, $2, $3, $4, $5)`,
      [userId || null, 'create', 'backups', 'Manual backup created', req.ip]);

    // BK-C3: Return only filename
    res.json({ success: true, message: 'Backup created successfully', data: { filename: path.basename(backupPath) } });
  } catch (error) {
    logError(error, req, {
      severity: ERROR_SEVERITY.CRITICAL, category: ERROR_CATEGORY.BACKUP,
      feature: 'backups-create',
      extra: { operation: 'create_backup' }
    });
    res.status(500).json({ success: false, message: 'Failed to create backup' });
  }
});

// GET /api/backups/download/:filename
router.get('/download/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    // BK-H3: File extension validation
    const ALLOWED_EXTS = ['.zip'];
    if (!ALLOWED_EXTS.includes(path.extname(filename).toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Invalid file type' });
    }

    // BK-C1: Safe path resolution
    const resolved = path.resolve(backupService.BACKUPS_DIR, filename);
    if (!resolved.startsWith(path.resolve(backupService.BACKUPS_DIR) + path.sep)) {
      return res.status(400).json({ success: false, message: 'Invalid filename path' });
    }

    const filePath = resolved;

    // BK-H1: Async file access
    try {
      await fs.promises.access(filePath);
    } catch {
      return res.status(404).json({ success: false, message: 'Backup file not found' });
    }

    // BK-M5: Check size > 0
    const stats = await fs.promises.stat(filePath);
    if (stats.size === 0) {
      return res.status(500).json({ success: false, message: 'Backup file appears corrupted' });
    }

    // BK-H5: Audit log
    const userId = req.user?.userId || req.ip;
    logger.info(`Backup downloaded by ${userId}: ${filename}`);
    await query(`INSERT INTO audit_logs (user_id, action, table_name, description, ip_address) VALUES ($1, $2, $3, $4, $5)`,
      [userId || null, 'export', 'backups', `Downloaded backup: ${filename}`, req.ip]);

    // BK-L3: Sanitise Content-Disposition
    const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    res.download(filePath, safeFilename);
  } catch (error) {
    logError(error, req, {
      severity: ERROR_SEVERITY.HIGH, category: ERROR_CATEGORY.BACKUP,
      feature: 'backups-download',
      extra: { filename: req.params.filename }
    });
    res.status(500).json({ success: false, message: 'Failed to download backup' });
  }
});

// BK-M2: Purge old backups
router.delete('/purge-old', async (req, res) => {
  try {
    if (req.query.confirm !== 'true') return res.status(400).json({ success: false, message: 'Confirm required' });
    
    const files = await fs.promises.readdir(backupService.BACKUPS_DIR);
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    for (const file of files) {
      if (file.startsWith('backup-') && file.endsWith('.zip')) {
        const filePath = path.join(backupService.BACKUPS_DIR, file);
        const stats = await fs.promises.stat(filePath);
        if (now - stats.mtimeMs > thirtyDaysMs) {
          await fs.promises.unlink(filePath);
          deletedCount++;
        }
      }
    }
    
    // Audit log
    const userId = req.user?.userId || req.ip;
    await query(`INSERT INTO audit_logs (user_id, action, table_name, description, ip_address) VALUES ($1, $2, $3, $4, $5)`,
      [userId || null, 'delete', 'backups', `Purged ${deletedCount} old backup(s)`, req.ip]);

    res.json({ success: true, message: `Purged ${deletedCount} old backups.` });
  } catch (error) {
    logError(error, req, { severity: ERROR_SEVERITY.HIGH, category: ERROR_CATEGORY.BACKUP, feature: 'backups-purge' });
    res.status(500).json({ success: false, message: 'Failed to purge old backups' });
  }
});

// BK-L4: Delete individual backup
router.delete('/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    const resolved = path.resolve(backupService.BACKUPS_DIR, filename);
    if (!resolved.startsWith(path.resolve(backupService.BACKUPS_DIR) + path.sep)) {
      return res.status(400).json({ success: false, message: 'Invalid filename' });
    }

    try {
      await fs.promises.access(resolved);
    } catch {
      return res.status(404).json({ success: false, message: 'Backup file not found' });
    }

    await fs.promises.unlink(resolved);
    
    const userId = req.user?.userId || req.ip;
    await query(`INSERT INTO audit_logs (user_id, action, table_name, description, ip_address) VALUES ($1, $2, $3, $4, $5)`,
      [userId || null, 'delete', 'backups', `Deleted backup: ${filename}`, req.ip]);

    res.json({ success: true, message: 'Backup deleted successfully' });
  } catch (error) {
    logError(error, req, { severity: ERROR_SEVERITY.HIGH, category: ERROR_CATEGORY.BACKUP, feature: 'backups-delete', extra: { filename: req.params.filename } });
    res.status(500).json({ success: false, message: 'Failed to delete backup' });
  }
});

module.exports = router;
