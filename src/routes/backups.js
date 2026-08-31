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
    const [backups, settings, activeDir] = await Promise.all([
      backupService.getAvailableBackups(),
      backupService.getBackupSettings(),
      backupService.getActiveBackupDir()
    ]);
    const populatedSettings = {
      ...settings,
      backup_destination_path: settings.backup_destination_path || activeDir
    };
    res.json({
      success: true,
      data: {
        backups,
        settings: populatedSettings,
        active_path: activeDir
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

// GET /api/backups/browse-dirs - Browse server filesystem directories
router.get('/browse-dirs', async (req, res) => {
  try {
    const requestedPath = req.query.path || process.cwd();
    const targetPath = path.resolve(requestedPath);
    
    // Available drives on Windows
    const availableDrives = ['C:\\', 'D:\\', 'E:\\', 'F:\\', 'G:\\'].filter(d => {
      try { return fs.existsSync(d); } catch (_) { return false; }
    });

    let subdirs = [];
    if (fs.existsSync(targetPath)) {
      try {
        const entries = fs.readdirSync(targetPath, { withFileTypes: true });
        subdirs = entries
          .filter(e => e.isDirectory() && !e.name.startsWith('.'))
          .map(e => ({
            name: e.name,
            path: path.join(targetPath, e.name)
          }))
          .slice(0, 60);
      } catch (readErr) {
        logger.warn('Could not read directory subdirs:', readErr.message);
      }
    }

    const defaultBackupsDir = path.join(process.cwd(), 'backups');

    res.json({
      success: true,
      currentPath: targetPath,
      parentPath: path.dirname(targetPath) !== targetPath ? path.dirname(targetPath) : null,
      drives: availableDrives,
      subdirs,
      defaultPath: defaultBackupsDir
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/backups/system-folder-picker - Open native OS Folder Dialog
router.post('/system-folder-picker', async (req, res) => {
  try {
    const { openNativeSystemFolderPicker } = require('../utils/folderPicker');
    const selectedFolder = await openNativeSystemFolderPicker();
    if (selectedFolder) {
      res.json({ success: true, folderPath: selectedFolder, canceled: false });
    } else {
      res.json({ success: true, folderPath: null, canceled: true });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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
