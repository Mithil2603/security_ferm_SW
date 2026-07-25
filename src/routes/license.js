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

/**
 * Read this machine's hardware ID from the persisted file.
 */
function getMachineHwid() {
  try {
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Roaming');
    const userDataDir = path.join(appData, 'secuirty-agency-software');
    const hwidPath = path.join(userDataDir, 'hwid.txt');
    if (fs.existsSync(hwidPath)) {
      return fs.readFileSync(hwidPath, 'utf8').trim();
    }
  } catch {
    // skip
  }
  return null;
}

/**
 * GET /api/license/hardware-id
 * Returns this machine's Hardware ID over HTTP. No auth required.
 */
router.get('/hardware-id', (req, res) => {
  try {
    const crypto = require('crypto');
    const { execSync } = require('child_process');

    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Roaming');
    const userDataDir = path.join(appData, 'secuirty-agency-software');
    const hwidPath = path.join(userDataDir, 'hwid.txt');

    if (fs.existsSync(hwidPath)) {
      const cached = fs.readFileSync(hwidPath, 'utf8').trim();
      return res.json({ success: true, hardwareId: cached });
    }

    let hwid;
    try {
      const raw = execSync('wmic csproduct get uuid', { encoding: 'utf8' });
      const uuid = raw.split('\n').map(l => l.trim()).filter(l => l && l !== 'UUID')[0];
      if (uuid && uuid.length > 8) {
        const hash = crypto.createHash('sha256').update(uuid).digest('hex');
        hwid = `HWID-${hash.substring(0, 4).toUpperCase()}-${hash.substring(4, 8).toUpperCase()}-${hash.substring(8, 12).toUpperCase()}`;
      } else {
        hwid = `HWID-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      }
    } catch {
      hwid = `HWID-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    }

    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    fs.writeFileSync(hwidPath, hwid, { encoding: 'utf8' });

    return res.json({ success: true, hardwareId: hwid });
  } catch (err) {
    return res.json({ success: false, hardwareId: 'HWID-A1B2-C3D4' });
  }
});

/**
 * GET /api/license/status
 * Returns current license status. No auth required.
 */
router.get('/status', async (req, res) => {
  try {
    const result = await query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'license_key'"
    );

    if (!result.rows || result.rows.length === 0 || !result.rows[0].setting_value) {
      return res.json({
        success: true,
        licensed: false,
        message: 'No license key found. Please activate your license.',
      });
    }

    const storedKey = result.rows[0].setting_value;
    const machineHwid = getMachineHwid();
    const verification = verifyLicense(storedKey, machineHwid);

    if (!verification.valid) {
      return res.json({
        success: true,
        licensed: false,
        message: verification.error || 'License is invalid or expired.',
        expired: verification.payload ? isLicenseExpired(verification.payload) : false,
      });
    }

    return res.json({
      success: true,
      licensed: true,
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
    logger.error('License status check failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to check license status' });
  }
});

/**
 * POST /api/license/activate
 * Validates and stores a license key. No auth required.
 */
router.post('/activate', async (req, res) => {
  try {
    const { licenseKey } = req.body;

    if (!licenseKey || typeof licenseKey !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'License key is required',
      });
    }

    const cleanKey = licenseKey.replace(/\s+/g, '');
    const machineHwid = getMachineHwid();
    const verification = verifyLicense(cleanKey, machineHwid);

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
       VALUES ('license_key', $1, datetime('now'))
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = $1, updated_at = datetime('now')`,
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
