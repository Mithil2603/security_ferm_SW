const { contextBridge, ipcRenderer } = require('electron');
const Joi = require('joi');

// === IPC MESSAGE VALIDATION SCHEMAS ===
const ipcSchemas = {
  'print-to-pdf': Joi.object({
    landscape: Joi.boolean().optional(),
    printBackground: Joi.boolean().optional(),
    pageSize: Joi.string().valid('A4', 'Letter', 'A3', 'A5').optional(),
    margins: Joi.object({
      top: Joi.number().min(0).max(5).optional(),
      bottom: Joi.number().min(0).max(5).optional(),
      left: Joi.number().min(0).max(5).optional(),
      right: Joi.number().min(0).max(5).optional(),
    }).optional(),
  }).unknown(false).max(5),

  'save-file': Joi.object({
    buffer: Joi.string().base64().required(),
    defaultName: Joi.string()
      .pattern(/^[a-zA-Z0-9\-_.\s]{1,255}$/)  // Safe filename chars only
      .required(),
    filters: Joi.array().max(10).optional(),
  }).unknown(false).max(3),

  'update-status': Joi.object({
    status: Joi.string().max(50).optional(),
    message: Joi.string().max(500).optional(),
    percent: Joi.number().optional(),
    transferred: Joi.number().optional(),
    total: Joi.number().optional(),
    version: Joi.string().optional()
  }).unknown(false),
};

function validateIPC(schema, data) {
  const { error, value } = schema.validate(data || {});
  if (error) {
    console.error(`[IPC Validation] ${error.message}`);
    throw new Error(`Invalid IPC data: ${error.message}`);
  }
  return value;
}

// === EXPOSED IPC API ===
contextBridge.exposeInMainWorld('electronAPI', {
  // Print to PDF with validation
  printToPDF: (options) => {
    const validated = validateIPC(ipcSchemas['print-to-pdf'], options);
    return ipcRenderer.invoke('print-to-pdf', validated);
  },

  // Save file with validation
  saveFile: (options) => {
    const validated = validateIPC(ipcSchemas['save-file'], options);
    return ipcRenderer.invoke('save-file', validated);
  },

  // Check if running in Electron
  isElectron: true,

  // Update status listener
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, data) => {
      try {
        const validated = validateIPC(ipcSchemas['update-status'], data);
        callback(validated);
      } catch (err) {
        console.error('[Update Status Validation]', err.message);
      }
    });
  },

  // Remove update listener
  removeUpdateListener: () => {
    ipcRenderer.removeAllListeners('update-status');
  },

  // Install update
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // Check for updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // Get app version
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Get hardware ID for license activation
  getHardwareId: () => ipcRenderer.invoke('get-hardware-id'),

  // ── MySQL / LAN Setup ───────────────────────────────────────────────
  // Get the server's LAN IP and URL for display on admin dashboard
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),

  // Test a MySQL connection before saving it
  testDbConnection: (config) => ipcRenderer.invoke('test-db-connection', config),

  // Save MySQL credentials to .env
  saveDbConfig: (config) => ipcRenderer.invoke('save-db-config', config),

  // Open Log Directory in Windows Explorer
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),

  // Get Latest Logs
  getLatestLogs: () => ipcRenderer.invoke('get-latest-logs'),

  // Select Backup Destination Folder Dialog
  selectFolder: () => ipcRenderer.invoke('select-folder'),
});
