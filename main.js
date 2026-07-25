const { app, BrowserWindow, session, shell, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Ensure single instance to prevent port 5000 conflicts
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// Ensure userData directory exists for the database and uploads
const userDataPath = app.getPath('userData');

// Validate and normalize paths to prevent path traversal
function validateAndSafePath(envKey, defaultPath) {
  let userPath = process.env[envKey] || defaultPath;
  let resolved = path.resolve(userPath);
  
  if (!resolved.startsWith(userDataPath)) {
    console.error(`⚠️ Invalid path for ${envKey}. Resetting to default inside userData.`);
    resolved = defaultPath;
  }
  
  if (!fs.existsSync(resolved)) {
    // Determine if path is a file or a folder by extension
    const isFile = !!path.extname(resolved);
    const dirToCreate = isFile ? path.dirname(resolved) : resolved;
    if (!fs.existsSync(dirToCreate)) {
      fs.mkdirSync(dirToCreate, { recursive: true, mode: 0o700 });
    }
  }
  return resolved;
}

process.env.DB_PATH = validateAndSafePath('DB_PATH', path.join(userDataPath, 'database.sqlite'));
process.env.UPLOAD_DIR = validateAndSafePath('UPLOAD_DIR', path.join(userDataPath, 'uploads'));
process.env.LOG_DIR = validateAndSafePath('LOG_DIR', path.join(userDataPath, 'logs'));
process.env.NODE_ENV = 'production';
process.env.PORT = '5000';

// === JWT SECRET MANAGEMENT ===
const secretPath = path.join(userDataPath, 'secret.key');
const backupSecretPath = path.join(userDataPath, 'secret.key.backup');

function ensureJWTSecret() {
  // Try to load main secret
  if (fs.existsSync(secretPath)) {
    const secret = fs.readFileSync(secretPath, 'utf8').trim();
    if (secret.length > 32) {
      return secret;  // ✅ Found valid secret
    }
  }

  // Try to recover from backup
  if (fs.existsSync(backupSecretPath)) {
    const backedUp = fs.readFileSync(backupSecretPath, 'utf8').trim();
    if (backedUp.length > 32) {
      console.warn('⚠️  Restored JWT secret from backup');
      fs.writeFileSync(secretPath, backedUp, { mode: 0o600, encoding: 'utf8' });
      return backedUp;  // ✅ Recovered from backup
    }
  }

  // If database exists but secret is missing/invalid, this is an error
  if (fs.existsSync(process.env.DB_PATH)) {
    dialog.showErrorBox(
      '🔴 Critical: JWT Secret Missing',
      'The JWT secret key and backup are both missing.\n\n' +
      'This is likely due to:\n' +
      '• Accidental file deletion\n' +
      '• Corrupted user data directory\n\n' +
      'To prevent all users from being logged out:\n' +
      '1. Check if a backup file exists\n' +
      '2. Contact support with your backup key\n' +
      '3. Do NOT proceed without the original secret.key'
    );
    app.quit();
    process.exit(1);
  }

  // Database doesn't exist → safe to generate new secret
  console.log('🔑 Generating new JWT secret...');
  const newSecret = crypto.randomBytes(64).toString('hex');

  // Write main secret (owner read/write only)
  fs.writeFileSync(secretPath, newSecret, { mode: 0o600, encoding: 'utf8' });
  // Write backup (owner read/write only)
  fs.writeFileSync(backupSecretPath, newSecret, { mode: 0o600, encoding: 'utf8' });

  console.log('✅ JWT secret generated and backed up');
  return newSecret;
}

process.env.JWT_SECRET = ensureJWTSecret();

// Set remaining env vars that index.js / routes expect
// These are defaults — SMTP settings are also loaded from system_settings DB table at runtime
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || '12';
process.env.INVOICE_DUE_DAYS = process.env.INVOICE_DUE_DAYS || '30';
process.env.FRONTEND_URL = `http://localhost:${process.env.PORT}`; // In Electron, frontend is served by Express

let mainWindow;

// ── Auto-Updater Configuration ──────────────────────────────────────
autoUpdater.autoDownload = true;         // Download updates silently in the background
autoUpdater.autoInstallOnAppQuit = true;  // Install when the user closes the app

// Log auto-updater events for debugging
autoUpdater.logger = console;

function setupAutoUpdater() {
  // Check for updates silently (no error dialog if offline)
  autoUpdater.checkForUpdates().catch((err) => {
    console.log('Auto-update check skipped (possibly offline):', err.message);
  });

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus('checking', 'Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus('available', `Update v${info.version} found. Downloading...`);
  });

  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus('not-available', 'You are on the latest version.');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('downloading', `Downloading update: ${Math.round(progress.percent)}%`, {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus('downloaded', `Update v${info.version} is ready. Restart to install.`, {
      version: info.version
    });
  });

  autoUpdater.on('error', (err) => {
    // Don't show errors to users — just log silently. 
    // Common case: client PC is offline, which is normal.
    console.log('Auto-updater error:', err.message);
  });
}

function sendUpdateStatus(status, message, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, message, ...data });
  }
}

// ── IPC: Frontend can request to install the downloaded update ───────
ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true); // isSilent=false, isForceRunAfter=true
});

// ── IPC: Frontend can manually trigger an update check ──────────────
ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, version: result?.updateInfo?.version };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: Get current app version ────────────────────────────────────
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// ── IPC: Get Hardware ID (machine-unique identifier for licensing) ───
let cachedHardwareId = null;
ipcMain.handle('get-hardware-id', async () => {
  if (cachedHardwareId) return cachedHardwareId;
  try {
    const { execSync } = require('child_process');
    const raw = execSync('wmic csproduct get uuid', { encoding: 'utf8' });
    const uuid = raw.split('\n').map(l => l.trim()).filter(l => l && l !== 'UUID')[0];
    if (uuid && uuid.length > 8) {
      // Create a shorter, friendlier hardware ID from the UUID
      const hash = crypto.createHash('sha256').update(uuid).digest('hex');
      cachedHardwareId = `HWID-${hash.substring(0, 4).toUpperCase()}-${hash.substring(4, 8).toUpperCase()}-${hash.substring(8, 12).toUpperCase()}`;
    } else {
      cachedHardwareId = `HWID-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    }
  } catch (err) {
    console.error('Failed to get hardware ID:', err.message);
    cachedHardwareId = `HWID-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  }
  // Persist the hardware ID so it stays consistent
  const hwidPath = path.join(userDataPath, 'hwid.txt');
  if (fs.existsSync(hwidPath)) {
    cachedHardwareId = fs.readFileSync(hwidPath, 'utf8').trim();
  } else {
    fs.writeFileSync(hwidPath, cachedHardwareId, { encoding: 'utf8' });
  }
  return cachedHardwareId;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'build', 'icon.png'),
  });

  // Start the internal Express server
  try {
    require('./src/index.js');
    console.log('Express server loaded successfully inside Electron.');
  } catch (err) {
    const errLogPath = path.join(userDataPath, 'electron-error.log');
    fs.writeFileSync(errLogPath, 'Failed to load Express server:\n' + err.stack);
    dialog.showErrorBox('🔴 Express Server Error', `Failed to start local API server:\n${err.message}\n\nCheck electron-error.log in AppData.`);
    console.error('Failed to load Express server:', err);
  }

  // ── Handle file downloads (PDF, Excel, etc.) ──────────────────────
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const fileName = item.getFilename();
    console.log(`Download started: ${fileName}`);

    item.once('done', (event, state) => {
      if (state === 'completed') {
        console.log(`Download completed: ${fileName}`);
      } else {
        console.log(`Download failed: ${state}`);
      }
    });
  });

  // ── Handle window.open() calls (download links, external URLs) ────
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('localhost') && (url.includes('/api/') || url.includes('export'))) {
      mainWindow.webContents.downloadURL(url);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load the frontend immediately from the local filesystem
  mainWindow.loadFile(path.join(__dirname, 'frontend-dist', 'index.html'));

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

// ── IPC: Print current page to PDF using Chromium's native renderer ──
ipcMain.handle('print-to-pdf', async (event, options = {}) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('Window not found');

    const pdfBuffer = await win.webContents.printToPDF({
      landscape: options.landscape !== false,
      printBackground: true,
      pageSize: 'A4',
      margins: {
        marginType: 'custom',
        top: 0.4,
        bottom: 0.4,
        left: 0.4,
        right: 0.4
      },
      ...options
    });

    return { success: true, buffer: pdfBuffer.toString('base64') };
  } catch (err) {
    console.error('printToPDF error:', err);
    return { success: false, error: err.message };
  }
});

// ── IPC: Save a base64 buffer to disk with Save As dialog ───────────
ipcMain.handle('save-file', async (event, { buffer, defaultName, filters }) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(app.getPath('downloads'), defaultName || 'document.pdf'),
      filters: filters || [{ name: 'PDF Files', extensions: ['pdf'] }]
    });

    if (result.canceled) return { success: false, canceled: true };

    const fileBuffer = Buffer.from(buffer, 'base64');
    fs.writeFileSync(result.filePath, fileBuffer);
    return { success: true, filePath: result.filePath };
  } catch (err) {
    console.error('saveFile error:', err);
    return { success: false, error: err.message };
  }
});

app.whenReady().then(() => {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  createWindow();

  // Start checking for updates after the window is ready (with a short delay)
  setTimeout(() => {
    setupAutoUpdater();
  }, 3000); // Wait 3 seconds after launch so the app loads first

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
