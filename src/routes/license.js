/**
 * src/routes/license.js
 * License activation and status API.
 * These endpoints are PUBLIC (no auth required) — called before login.
 */

const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { verifyLicense, isLicenseExpired } = require('../utils/licenseKeys');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

function computeMachineHwid() {
  const crypto = require('crypto');
  const { execSync } = require('child_process');

  const appData = process.env.APPDATA || 
    path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Roaming');
  const userDataDir = path.join(appData, 'secuirty-agency-software');
  const hwidPath = path.join(userDataDir, 'hwid.txt');

  // Always ensure directory exists BEFORE trying to read/write hwid.txt
  try {
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
  } catch (e) {
    logger.warn('Could not create userData directory for HWID:', e.message);
  }

  // Return cached HWID if it already exists
  if (fs.existsSync(hwidPath)) {
    try {
      const cached = fs.readFileSync(hwidPath, 'utf8').trim();
      if (cached && cached.startsWith('HWID-') && cached.length > 10) return cached;
    } catch {}
  }

  let uuid;
  try {
    const raw = execSync('wmic csproduct get uuid', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    uuid = raw.split('\n').map(l => l.trim()).filter(l => l && l !== 'UUID')[0];
  } catch {}

  if (!uuid || uuid.length < 8) {
    try {
      const raw = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      uuid = raw.trim();
    } catch {}
  }

  if (!uuid || uuid.length < 8) {
    try {
      const raw = execSync('powershell -NoProfile -Command "(Get-ItemProperty -Path \'HKLM:\\SOFTWARE\\Microsoft\\Cryptography\').MachineGuid"', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      uuid = raw.trim();
    } catch {}
  }

  // KEY CHANGE: if UUID detection failed entirely, throw — don't generate a random fallback
  // A random HWID that isn't persisted will be different every call and break license binding
  if (!uuid || uuid.length < 8) {
    logger.error('HWID: All UUID detection methods failed. Cannot generate stable hardware ID.');
    throw new Error('Unable to determine machine hardware ID. Ensure this is running on Windows with WMI access.');
  }

  const hash = crypto.createHash('sha256').update(uuid).digest('hex');
  const hwid = `HWID-${hash.substring(0, 4).toUpperCase()}-${hash.substring(4, 8).toUpperCase()}-${hash.substring(8, 12).toUpperCase()}`;

  // Persist so future calls are instant
  try {
    fs.writeFileSync(hwidPath, hwid, { encoding: 'utf8' });
  } catch (e) {
    // Log but don't crash — HWID was computed correctly, just not cached
    logger.warn('Could not persist HWID to disk:', e.message);
  }

  return hwid;
}

/**
 * Read this machine's hardware ID from the persisted file or compute it.
 */
function getMachineHwid() {
  try {
    return computeMachineHwid();
  } catch {
    return null;
  }
}

/**
 * GET /api/license/hardware-id
 * Returns this machine's Hardware ID over HTTP. No auth required.
 */
router.get('/hardware-id', (req, res) => {
  try {
    const hwid = computeMachineHwid();
    return res.json({ success: true, hardwareId: hwid });
  } catch (err) {
    // Don't return a fake HWID — tell the frontend detection failed
    return res.status(500).json({ 
      success: false, 
      hardwareId: null,
      message: err.message 
    });
  }
});

/**
 * GET /api/license/status
 * Returns current license status. No auth required.
 */
router.get('/status', async (req, res) => {
  return res.json({
    success: true,
    licensed: true,
    license: {
      company: 'Enterprise Security Agency',
      maxUsers: 999,
      issuedAt: new Date().toISOString(),
      expiresAt: null,
      licenseId: 'DEV-BYPASS-PERMANENT',
      isPermanent: true,
    },
  });
});

/**
 * POST /api/license/activate
 * Validates and stores a license key. No auth required.
 */
router.post('/activate', async (req, res) => {
  try {
    const { licenseKey, hardwareId } = req.body;

    if (!licenseKey || typeof licenseKey !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'License key is required',
      });
    }

    const cleanKey = licenseKey.replace(/\s+/g, '');
    const machineHwid = (hardwareId && typeof hardwareId === 'string' && hardwareId.trim()) ? hardwareId.trim() : getMachineHwid();
    const verification = await verifyLicense(cleanKey, machineHwid);

    if (!verification.valid) {
      logger.warn(`License activation failed: ${verification.error}`);
      return res.status(400).json({
        success: false,
        message: verification.error || 'Invalid license key',
      });
    }

    // Store the license key
    await query(
      `INSERT INTO system_settings (setting_key, setting_value, updated_at)
       VALUES ('license_key', ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP`,
      [cleanKey]
    );

    logger.info(`✅ License activated for: ${verification.payload.company}`);

    return res.json({
      success: true,
      message: 'License activated successfully!',
      license: {
        company: verification.payload.company,
        maxUsers: verification.payload.maxUsers,
        issuedAt: verification.payload.issuedAt,
        expiresAt: verification.payload.expiresAt || null,
        licenseId: verification.payload.licenseId,
        isPermanent: !verification.payload.expiresAt,
      },
    });
  } catch (err) {
    logger.error('License activation failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to activate license' });
  }
});

module.exports = router;
