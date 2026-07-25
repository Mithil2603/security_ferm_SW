/**
 * src/utils/licenseKeys.js
 * Verifies RSA-signed license keys using the embedded public key.
 * Also verifies that the hardware ID in the key matches this machine.
 * The private key is NEVER in this software — only the admin has it.
 */

const crypto = require('crypto');

// ── Embedded RSA Public Key ─────────────────────────────────────────
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlCtChvVF3Mk7dPDIf1jv
plA6kvKobSkG2cv19V+xslQtOetLpSUhQsHwbzUFLglWBwCe+kgJxbcGW9UBddvz
zCpP0TNTBIAB92coU0Alsb7YDXzmlxIoNSeVxO2cjfoVUnVREM5u23P9P9ZnnbuA
b8vmfqQ/7t9HMWKrfu7GUBB57F1iHFSCZbfkF9G0eUz0CgYQe6RshngN9Bprp+vC
f5ntnN7cWxd/DQoiwGWcTRDDeuoxTMATtuvCtnu2ZV9z23UK4ob3+KhQIWfhgKcH
r0EOGsMcEfHamL9ks4If425jejhNdkr7QbV61GuhfXBfESjlj3ofIzYjQD73xb9e
zwIDAQAB
-----END PUBLIC KEY-----`;

/**
 * Decode and verify a license key string.
 * 
 * @param {string} licenseKeyString - Base64-encoded license key
 * @param {string} [machineHwid] - This machine's hardware ID (optional, for hardware binding check)
 * @returns {{ valid: boolean, payload: object|null, error: string|null }}
 */
function verifyLicense(licenseKeyString, machineHwid) {
  try {
    // Step 1: Decode base64
    const decoded = Buffer.from(licenseKeyString.trim(), 'base64').toString('utf8');
    
    // Step 2: Parse JSON
    let licenseData;
    try {
      licenseData = JSON.parse(decoded);
    } catch {
      return { valid: false, payload: null, error: 'Invalid license key format' };
    }

    // Step 3: Validate structure
    if (!licenseData.payload || !licenseData.signature) {
      return { valid: false, payload: null, error: 'Malformed license key' };
    }

    const { payload, signature } = licenseData;

    // Step 4: Verify required payload fields
    if (!payload.company || !payload.issuedAt || !payload.licenseId) {
      return { valid: false, payload: null, error: 'Incomplete license data' };
    }

    // Step 5: Verify RSA signature
    const payloadString = JSON.stringify(payload);
    const verify = crypto.createVerify('SHA256');
    verify.update(payloadString);
    verify.end();

    const isValid = verify.verify(PUBLIC_KEY, signature, 'base64');
    if (!isValid) {
      return { valid: false, payload: null, error: 'Invalid license key — signature verification failed' };
    }

    // Step 6: Check hardware ID binding
    if (payload.hwid && machineHwid) {
      if (payload.hwid !== machineHwid) {
        return { valid: false, payload, error: 'This license key is registered to a different computer' };
      }
    }

    // Step 7: Check expiry
    if (payload.expiresAt) {
      const expiryDate = new Date(payload.expiresAt + 'T23:59:59');
      if (expiryDate < new Date()) {
        return { valid: false, payload, error: `License expired on ${payload.expiresAt}` };
      }
    }

    // ✅ Valid license
    return { valid: true, payload, error: null };

  } catch (err) {
    return { valid: false, payload: null, error: 'Failed to process license key: ' + err.message };
  }
}

/**
 * Check if a license payload has expired.
 */
function isLicenseExpired(payload) {
  if (!payload || !payload.expiresAt) return false;
  const expiryDate = new Date(payload.expiresAt + 'T23:59:59');
  return expiryDate < new Date();
}

module.exports = { verifyLicense, isLicenseExpired };
