/**
 * src/utils/secureLogger.js
 * Custom Express logger middleware that strips sensitive fields from logs.
 * Replaces morgan with a zero-dependency implementation.
 *
 * Sensitive fields: password, password_hash, aadhar_number, pan_number,
 *                   bank_account_number, token, jwt, otp
 */

const logger = require('./logger');

// Fields that must NEVER appear in any log output
const SENSITIVE_FIELDS = new Set([
  'password',
  'password_hash',
  'new_password',
  'confirm_password',
  'current_password',
  'aadhar_number',
  'pan_number',
  'bank_account_number',
  'bank_ifsc_code',
  'token',
  'jwt',
  'otp',
  'reset_token',
  'smtp_pass',
  'secret',
]);

/**
 * Recursively redact sensitive keys from any object.
 * Returns a NEW object — does not mutate the original.
 */
function redactSensitive(obj, depth = 0) {
  if (depth > 5 || !obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => redactSensitive(item, depth + 1));

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactSensitive(value, depth + 1);
    }
  }
  return result;
}

/**
 * Get sanitised request body string (max 300 chars).
 */
function getSafeBody(req) {
  try {
    if (!req.body || Object.keys(req.body).length === 0) return '-';
    const sanitised = redactSensitive(req.body);
    const json = JSON.stringify(sanitised);
    return json.length > 300 ? json.substring(0, 297) + '...' : json;
  } catch {
    return '-';
  }
}

/**
 * Get user info string (id + role, never the JWT itself).
 */
function getUserInfo(req) {
  if (!req.user) return 'anonymous';
  return `uid=${req.user.userId || '?'} role=${req.user.role || '?'}`;
}

/**
 * Returns an Express middleware that logs requests.
 * - Production: compact format (no body logged)
 * - Development: verbose format with sanitised body
 */
function createLogger() {
  const isProduction = process.env.NODE_ENV === 'production';

  return (req, res, next) => {
    const startTime = Date.now();

    // Hook into the response finish event to log after response is sent
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const userInfo = getUserInfo(req);

      if (isProduction) {
        // Compact production format
        const remoteAddr = req.ip || req.connection?.remoteAddress || '-';
        const contentLength = res.getHeader('content-length') || '-';
        logger.info(
          `${remoteAddr} - ${userInfo} "${req.method} ${req.originalUrl} HTTP/${req.httpVersion}" ${res.statusCode} ${contentLength} - ${duration} ms`
        );
      } else {
        // Verbose dev format with sanitised body
        const safeBody = getSafeBody(req);
        logger.info(
          `${req.method} ${req.originalUrl} ${res.statusCode} ${duration} ms | ${userInfo} | body:${safeBody}`
        );
      }
    });

    next();
  };
}

module.exports = { createLogger, redactSensitive };
