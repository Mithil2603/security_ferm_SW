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

// Stable JSON stringify for canonicalization (sorts keys alphabetically)
function stableStringify(obj) {
  if (typeof obj !== 'object' || obj === null) return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * Fetch trusted UTC time from a public API, fallback to local system time.
 */
async function getTrustedTime() {
  try {
    const res = await fetch('http://worldtimeapi.org/api/timezone/Etc/UTC', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      return new Date(data.utc_datetime);
    }
  } catch (e) {
    // Network error or timeout, fallback to system clock
  }
  return new Date();
}

/**
 * Fetch revoked license IDs blocklist.
 */
async function isRevoked(licenseId) {
  try {
    // Example remote blocklist URL controlled by admin
    const url = 'https://raw.githubusercontent.com/het1621/SecurManage-License-Manager/main/revoked.json';
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const revokedList = await res.json();
      return Array.isArray(revokedList) && revokedList.includes(licenseId);
    }
  } catch (e) {
    // Fails open if network is down
  }
  return false;
}

/**
 * Decode and verify a license key string.
 * 
 * @param {string} licenseKeyString - Base64-encoded license key
 * @param {string} [machineHwid] - This machine's hardware ID
 * @returns {Promise<{ valid: boolean, payload: object|null, error: string|null }>}
 */
async function verifyLicense(licenseKeyString, machineHwid) {
  try {
    const decoded = Buffer.from(licenseKeyString.trim(), 'base64').toString('utf8');
    
    let licenseData;
    try {
      licenseData = JSON.parse(decoded);
    } catch {
      return { valid: false, payload: null, error: 'Invalid license key format' };
    }

    if (!licenseData.payload || !licenseData.signature) {
      return { valid: false, payload: null, error: 'Malformed license key' };
    }

    const { payload, signature } = licenseData;

    if (!payload.company || !payload.issuedAt || !payload.licenseId) {
      return { valid: false, payload: null, error: 'Incomplete license data' };
    }

    // Task 3: Canonicalize payload
    const payloadString = stableStringify(payload);
    
    const verify = crypto.createVerify('SHA256');
    verify.update(payloadString);
    verify.end();

    // Task 4: Pin to PSS padding with explicit salt length to ensure
    // compatibility between Node.js standalone and Electron's bundled OpenSSL
    const isValid = verify.verify({
      key: PUBLIC_KEY,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
    }, signature, 'base64');


    if (!isValid) {
      return { valid: false, payload: null, error: 'Invalid license key — signature verification failed' };
    }

    // Check Revocation (Task 7)
    if (await isRevoked(payload.licenseId)) {
      return { valid: false, payload, error: 'This license has been permanently revoked by the administrator' };
    }

    if (payload.hwid && machineHwid) {
      if (payload.hwid !== machineHwid) {
        return { valid: false, payload, error: 'This license key is registered to a different computer' };
      }
    }

    if (payload.expiresAt) {
      // Task 6: Trusted Time Check
      const now = await getTrustedTime();
      const expiryDate = new Date(payload.expiresAt + 'T23:59:59Z'); // Enforce UTC
      if (expiryDate < now) {
        return { valid: false, payload, error: `License expired on ${payload.expiresAt}` };
      }
    }

    return { valid: true, payload, error: null };

  } catch (err) {
    return { valid: false, payload: null, error: 'Failed to process license key: ' + err.message };
  }
}

/**
 * Check if a license payload has expired using trusted time.
 */
async function isLicenseExpired(payload) {
  if (!payload || !payload.expiresAt) return false;
  const now = await getTrustedTime();
  const expiryDate = new Date(payload.expiresAt + 'T23:59:59Z');
  return expiryDate < now;
}

module.exports = { verifyLicense, isLicenseExpired };
