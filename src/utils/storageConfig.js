const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require('./logger');

// Default fallback directory in project root or from environment
const DEFAULT_UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));

let activeUploadDir = DEFAULT_UPLOAD_DIR;
let isInitialized = false;

/**
 * Returns the default project upload directory
 */
function getDefaultUploadDir() {
  return DEFAULT_UPLOAD_DIR;
}

/**
 * Returns the currently active uploads root directory
 */
function getActiveUploadDir() {
  return activeUploadDir;
}

/**
 * Check whether the active upload directory is the default project folder
 */
function isUsingDefaultDir() {
  return path.resolve(activeUploadDir).toLowerCase() === path.resolve(DEFAULT_UPLOAD_DIR).toLowerCase();
}

/**
 * Ensures standard subfolders exist within a target directory
 */
function ensureSubdirectories(baseDir) {
  const subdirs = ['docs', 'vendor_docs', 'temp'];
  for (const sub of subdirs) {
    const full = path.join(baseDir, sub);
    if (!fs.existsSync(full)) {
      try {
        fs.mkdirSync(full, { recursive: true });
      } catch (err) {
        logger.warn(`Failed to create subdirectory ${full}:`, err.message);
      }
    }
  }
}

/**
 * Resolves an upload directory (root or subfolder) and ensures it exists
 * @param {string} [subfolder] Optional subfolder e.g. 'docs', 'vendor_docs', 'temp'
 * @returns {string} Absolute path to the directory
 */
function getUploadDir(subfolder = '') {
  const target = subfolder ? path.join(activeUploadDir, subfolder) : activeUploadDir;
  if (!fs.existsSync(target)) {
    try {
      fs.mkdirSync(target, { recursive: true });
    } catch (err) {
      logger.error(`Failed to ensure upload directory ${target}:`, err.message);
    }
  }
  return target;
}

/**
 * Copy directory contents recursively without overwriting existing files
 */
function copyDirRecursive(sourceDir, destDir) {
  let count = 0;
  if (!fs.existsSync(sourceDir)) return count;
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(sourceDir, entry.name);
    const dstPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      count += copyDirRecursive(srcPath, dstPath);
    } else if (entry.isFile()) {
      if (!fs.existsSync(dstPath)) {
        try {
          fs.copyFileSync(srcPath, dstPath);
          count++;
        } catch (copyErr) {
          logger.warn(`Failed to copy file ${srcPath} -> ${dstPath}:`, copyErr.message);
        }
      }
    }
  }
  return count;
}

/**
 * Load configured document storage path from system_settings
 */
async function initStorageConfig() {
  try {
    const { query } = require('../database/connection');
    const result = await query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'document_storage_path'"
    );

    if (result && result.rows && result.rows.length > 0) {
      const savedPath = (result.rows[0].setting_value || '').trim();
      if (savedPath) {
        const resolved = path.resolve(savedPath);
        if (!fs.existsSync(resolved)) {
          fs.mkdirSync(resolved, { recursive: true });
        }
        activeUploadDir = resolved;
        logger.info(`📁 Document storage initialized to custom path: ${activeUploadDir}`);
      } else {
        activeUploadDir = DEFAULT_UPLOAD_DIR;
      }
    } else {
      activeUploadDir = DEFAULT_UPLOAD_DIR;
    }
  } catch (err) {
    logger.warn('StorageConfig: database not ready or query failed, using default uploadDir:', err.message);
    activeUploadDir = DEFAULT_UPLOAD_DIR;
  }

  // Ensure default & active directories and subdirectories exist
  try {
    if (!fs.existsSync(activeUploadDir)) {
      fs.mkdirSync(activeUploadDir, { recursive: true });
    }
    ensureSubdirectories(activeUploadDir);

    if (!fs.existsSync(DEFAULT_UPLOAD_DIR)) {
      fs.mkdirSync(DEFAULT_UPLOAD_DIR, { recursive: true });
    }
    ensureSubdirectories(DEFAULT_UPLOAD_DIR);
  } catch (fsErr) {
    logger.error('StorageConfig: error creating directories:', fsErr.message);
  }

  isInitialized = true;
  return activeUploadDir;
}

/**
 * Set and persist a new upload directory
 * @param {string} newPath Destination path
 * @param {boolean} shouldMigrate Whether to copy files from previous directory
 */
async function setUploadDir(newPath, shouldMigrate = false) {
  if (!newPath || typeof newPath !== 'string' || !newPath.trim()) {
    throw new Error('Storage path is required and cannot be empty.');
  }

  const targetDir = path.resolve(newPath.trim());

  // Prevent selecting system root or unsafe paths
  const root = path.parse(targetDir).root;
  if (targetDir.toLowerCase() === root.toLowerCase() && targetDir.length <= 3) {
    throw new Error(`Cannot use drive root "${targetDir}" directly. Please specify a folder (e.g. ${path.join(root, 'SecurityFirm_Documents')}).`);
  }

  // Verify write permission by creating directory and testing file write
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const testFilePath = path.join(targetDir, `.write_test_${Date.now()}`);
  try {
    fs.writeFileSync(testFilePath, 'permission_test');
    fs.unlinkSync(testFilePath);
  } catch (permErr) {
    throw new Error(`Selected destination path is not writable: ${permErr.message}`);
  }

  // Ensure subdirectories exist
  ensureSubdirectories(targetDir);

  const previousDir = activeUploadDir;
  let migratedCount = 0;

  // Migrate files if requested and source differs from target
  if (shouldMigrate && path.resolve(previousDir).toLowerCase() !== path.resolve(targetDir).toLowerCase()) {
    migratedCount = copyDirRecursive(previousDir, targetDir);
    // Also copy from default directory if previous was something else
    if (path.resolve(previousDir).toLowerCase() !== path.resolve(DEFAULT_UPLOAD_DIR).toLowerCase()) {
      migratedCount += copyDirRecursive(DEFAULT_UPLOAD_DIR, targetDir);
    }
    logger.info(`📦 Migrated ${migratedCount} files to new storage location: ${targetDir}`);
  }

  // Persist to system_settings
  const { query } = require('../database/connection');
  await query(
    `INSERT INTO system_settings (setting_key, setting_value, updated_at)
     VALUES ('document_storage_path', $1, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE setting_value = $1, updated_at = CURRENT_TIMESTAMP`,
    [targetDir]
  );

  activeUploadDir = targetDir;
  logger.info(`✅ Active document storage updated to: ${activeUploadDir}`);

  return {
    success: true,
    activeDir: activeUploadDir,
    previousDir,
    migratedCount,
    isDefault: isUsingDefaultDir()
  };
}

/**
 * Reset storage location back to default project ./uploads directory
 */
async function resetToDefault(shouldMigrate = false) {
  const previousDir = activeUploadDir;
  let migratedCount = 0;

  if (shouldMigrate && path.resolve(previousDir).toLowerCase() !== path.resolve(DEFAULT_UPLOAD_DIR).toLowerCase()) {
    migratedCount = copyDirRecursive(previousDir, DEFAULT_UPLOAD_DIR);
    logger.info(`📦 Migrated ${migratedCount} files back to default storage directory`);
  }

  // Clear in system_settings
  const { query } = require('../database/connection');
  await query(
    `INSERT INTO system_settings (setting_key, setting_value, updated_at)
     VALUES ('document_storage_path', '', CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE setting_value = '', updated_at = CURRENT_TIMESTAMP`
  );

  activeUploadDir = DEFAULT_UPLOAD_DIR;
  ensureSubdirectories(activeUploadDir);

  return {
    success: true,
    activeDir: DEFAULT_UPLOAD_DIR,
    previousDir,
    migratedCount,
    isDefault: true
  };
}

/**
 * Detect available drives on the system
 */
function getAvailableDrives() {
  if (process.platform === 'win32') {
    const letters = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const available = [];
    for (const l of letters) {
      const drivePath = `${l}:\\`;
      try {
        if (fs.existsSync(drivePath)) {
          available.push({
            letter: l,
            path: drivePath,
            suggestedPath: `${l}:\\SecurityFirm_Documents`,
            isD: l === 'D'
          });
        }
      } catch (_) {}
    }
    return available;
  }
  return [{ letter: '/', path: '/', suggestedPath: '/var/securityfirm/documents', isD: false }];
}

/**
 * Calculate directory statistics (file count, total bytes)
 */
function getStorageStats(dir = null) {
  const target = dir || activeUploadDir;
  let filesCount = 0;
  let totalBytes = 0;

  function scan(current) {
    if (!fs.existsSync(current)) return;
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          scan(full);
        } else if (entry.isFile()) {
          filesCount++;
          try {
            totalBytes += fs.statSync(full).size;
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  scan(target);

  const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const parsed = path.parse(target);

  return {
    path: target,
    exists: fs.existsSync(target),
    filesCount,
    totalBytes,
    totalFormatted: formatSize(totalBytes),
    isDefault: path.resolve(target).toLowerCase() === path.resolve(DEFAULT_UPLOAD_DIR).toLowerCase(),
    drive: parsed.root
  };
}

module.exports = {
  getDefaultUploadDir,
  getActiveUploadDir,
  isUsingDefaultDir,
  getUploadDir,
  initStorageConfig,
  setUploadDir,
  resetToDefault,
  getAvailableDrives,
  getStorageStats,
  ensureSubdirectories
};
