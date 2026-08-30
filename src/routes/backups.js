const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('../middleware/auth');
const backupService = require('../services/backupService');
const { rescheduleBackupJob } = require('../utils/backupJob');
const logger = require('../utils/logger');
const { logError, ERROR_SEVERITY, ERROR_CATEGORY } = require('../utils/enhancedErrorLogger');

router.use(authMiddleware);

// Role authorization middleware for backups
async function requireBackupAccess(req, res, next) {
  try {
    const userRole = req.user?.role;
    if (userRole === 'admin') {
      return next();
    }
    const settings = await backupService.getBackupSettings();
    if (settings.allowed_roles && settings.allowed_roles.includes(userRole)) {
      return next();
    }
    return res.status(403).json({
      success: false,
      message: 'Access denied: Database backup operations require administrator permission.'
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Authorization check failed' });
  }
}

router.use(requireBackupAccess);

// GET /api/backups
router.get('/', async (req, res) => {
  try {
    const [backups, settings] = await Promise.all([
      backupService.getAvailableBackups(),
      backupService.getBackupSettings()
    ]);
    res.json({
      success: true,
      data: {
        backups,
        settings
      }
    });
  } catch (error) {
    logError({
      error, req,
      severity: ERROR_SEVERITY.HIGH, category: ERROR_CATEGORY.BACKUP,
      feature: 'backups-fetch',
      extra: { operation: 'fetch_backups' }
    });
    res.status(500).json({ success: false, message: 'Failed to fetch backups' });
  }
});

// POST /api/backups/settings - Save Backup destination path, time, and permissions
router.post('/settings', async (req, res) => {
  try {
    // Only Admin can modify backup configuration
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only administrators can update backup settings' });
    }

    const {
      backup_destination_path,
      auto_backup_enabled,
      auto_backup_time,
      auto_backup_frequency,
      allowed_roles
    } = req.body;

    const updated = await backupService.saveBackupSettings({
      backup_destination_path,
      auto_backup_enabled,
      auto_backup_time,
      auto_backup_frequency,
      allowed_roles
    });

    // Update the cron scheduler in background
    await rescheduleBackupJob();

    res.json({
      success: true,
      message: 'Backup settings updated successfully',
      data: updated
    });
  } catch (error) {
    logError({
      error, req,
      severity: ERROR_SEVERITY.HIGH, category: ERROR_CATEGORY.BACKUP,
      feature: 'backups-save-settings',
      extra: { body: req.body }
    });
    res.status(500).json({ success: false, message: error.message || 'Failed to save backup settings' });
  }
});

// POST /api/backups/create - Manual on-demand backup
router.post('/create', async (req, res) => {
  try {
    const backupInfo = await backupService.createBackup();
    res.json({
      success: true,
      message: 'Manual database backup created successfully',
      data: backupInfo
    });
  } catch (error) {
    logError({
      error, req,
      severity: ERROR_SEVERITY.CRITICAL, category: ERROR_CATEGORY.BACKUP,
      feature: 'backups-create',
      extra: { operation: 'create_backup' }
    });
    res.status(500).json({ success: false, message: error.message || 'Failed to create backup' });
  }
});

// GET /api/backups/download/:filename
router.get('/download/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    // Security check to prevent path traversal
    if (filename.includes('/') || filename.includes('..') || filename.includes('\\')) {
      return res.status(400).json({ success: false, message: 'Invalid filename' });
    }

    const activeDir = await backupService.getActiveBackupDir();
    const filePath = path.join(activeDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Backup file not found' });
    }

    res.download(filePath, filename);
  } catch (error) {
    logError({
      error, req,
      severity: ERROR_SEVERITY.HIGH, category: ERROR_CATEGORY.BACKUP,
      feature: 'backups-download',
      extra: { filename: req.params.filename }
    });
    res.status(500).json({ success: false, message: 'Failed to download backup' });
  }
});

// DELETE /api/backups/:filename
router.delete('/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only administrators can delete backups' });
    }

    const deleted = await backupService.deleteBackup(filename);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Backup file not found' });
    }

    res.json({ success: true, message: 'Backup file deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete backup' });
  }
});

module.exports = router;
