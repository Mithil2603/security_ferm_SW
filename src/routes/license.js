/**
 * src/routes/license.js
 * License activation and status API.
 * These endpoints are PUBLIC (no auth required) — they're called before login.
 */

const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { verifyLicense, isLicenseExpired } = require('../utils/licenseKeys');
const logger = require('../utils/logger');

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
    const verification = verifyLicense(storedKey);

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

    // Clean up the key (remove whitespace/newlines from copy-paste)
    const cleanKey = licenseKey.replace(/\s+/g, '');

    // Verify the license key cryptographically
    const verification = verifyLicense(cleanKey);

    if (!verification.valid) {
      logger.warn(`License activation failed: ${verification.error}`);
      return res.status(400).json({
        success: false,
        message: verification.error || 'Invalid license key',
      });
    }

    // Store the license key in system_settings
    // Use UPSERT pattern (INSERT ... ON CONFLICT UPDATE)
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
