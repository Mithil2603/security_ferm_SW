const logger = require('./logger.js');
const crypto = require('crypto');

/**
 * src/utils/startupSecurityCheck.js
 * Environment & Secrets Audit
 * Runs at server startup and validates required configuration.
 */

const PLACEHOLDER_PATTERNS = [
  /your_.*password/i,
  /your_.*key/i,
  /your_.*email/i,
  /change_me/i,
  /secret_key/i,
  /placeholder/i,
];

function isPlaceholder(value) {
  if (!value) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function runStartupSecurityCheck() {
  const warnings = [];
  const errors = [];
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  // ── PORT ──────────────────────────────────────────────────────────────────
  if (!process.env.PORT) {
    process.env.PORT = '3000';
  }

  // ── JWT_SECRET ────────────────────────────────────────────────────────────
  let jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.trim() === '') {
    // Generate a secure 64-character random key for development/electron desktop mode
    const fallbackSecret = crypto.randomBytes(32).toString('hex');
    process.env.JWT_SECRET = fallbackSecret;
    warnings.push('JWT_SECRET was not set in .env — generated a secure runtime secret for this session');
  } else if (isPlaceholder(jwtSecret)) {
    warnings.push('JWT_SECRET looks like a placeholder — consider generating a strong random secret (32+ characters)');
  } else if (jwtSecret.length < 32) {
    warnings.push(`JWT_SECRET is shorter than recommended (${jwtSecret.length} chars) — minimum 32 characters suggested`);
  }

  // ── NODE_ENV ──────────────────────────────────────────────────────────────
  if (!process.env.NODE_ENV) {
    warnings.push('NODE_ENV is not set — defaulting to development mode');
  } else if (nodeEnv !== 'production' && nodeEnv !== 'development' && nodeEnv !== 'test') {
    warnings.push(`NODE_ENV has unexpected value: "${nodeEnv}"`);
  }

  // ── Database Configuration ────────────────────────────────────────────────
  if (!process.env.DB_HOST) {
    process.env.DB_HOST = '127.0.0.1';
  }
  if (!process.env.DB_NAME) {
    process.env.DB_NAME = 'security_firm_db';
  }
  if (!process.env.DB_USER) {
    process.env.DB_USER = 'root';
  }
  if (process.env.DB_PASSWORD === undefined) {
    process.env.DB_PASSWORD = '';
  }

  // ── SMTP credentials ──────────────────────────────────────────────────────
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASSWORD;
  if (smtpUser && isPlaceholder(smtpUser)) {
    warnings.push('SMTP_USER appears to be a placeholder — email sending will fail');
  }
  if (smtpPass && isPlaceholder(smtpPass)) {
    warnings.push('SMTP_PASSWORD appears to be a placeholder — email sending will fail');
  }

  // ── BCRYPT_ROUNDS ─────────────────────────────────────────────────────────
  const rounds = parseInt(process.env.BCRYPT_ROUNDS);
  if (rounds && rounds < 10) {
    warnings.push(`BCRYPT_ROUNDS=${rounds} is low — use 10 or higher`);
  }

  // ── Output ────────────────────────────────────────────────────────────────
  if (errors.length > 0) {
    logger.error('\n🔴 CONFIGURATION ERRORS:');
    errors.forEach((e) => logger.error(`   ✗ ${e}`));
  }

  if (warnings.length > 0) {
    logger.warn('\n🟡 CONFIGURATION NOTICE:');
    warnings.forEach((w) => logger.warn(`   ⚠  ${w}`));
  }

  if (errors.length === 0 && warnings.length === 0) {
    logger.info('✅ Startup checks passed — environment and secrets configured');
  }
}

module.exports = { runStartupSecurityCheck };
