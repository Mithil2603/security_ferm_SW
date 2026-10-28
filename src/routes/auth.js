const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../database/connection');
const { authMiddleware, requireRole } = require('../middleware/auth');
const crypto = require('crypto');
const { sendEmail } = require('../utils/email');
const rateLimit = require('express-rate-limit');
const { logError } = require('../utils/errorLogger');

const ERROR_CODES = {
  // Auth errors
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  USER_INACTIVE: 'USER_INACTIVE',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  
  // Validation errors
  MISSING_FIELDS: 'MISSING_FIELDS',
  INVALID_EMAIL_FORMAT: 'INVALID_EMAIL_FORMAT',
  PASSWORD_TOO_SHORT: 'PASSWORD_TOO_SHORT',
  
  // Rate limit
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
  
  // Server errors
  DATABASE_ERROR: 'DATABASE_ERROR',
  JWT_ERROR: 'JWT_ERROR',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  EMAIL_SEND_ERROR: 'EMAIL_SEND_ERROR'
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Limit each IP to 15 login requests per windowMs
  message: { success: false, message: 'Too many login attempts from this IP, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many signup attempts from this IP, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Shared by /login, /signup, /refresh, /switch-company. Mints an access JWT
// scoped to `company` (role/permissions never vary by company — only which
// company's data is active does) plus a rotating refresh token, and sets
// both as httpOnly cookies. When `company` is null (a business with more
// than one company and no default chosen yet), issues a short-lived token
// with no companyId claim — enough to call /switch-company, not enough to
// pass requireCompanyContext on any data route.
async function issueSessionTokens(user, company, req, res) {
  const { getEffectivePermissions } = require('../middleware/auth');
  const effectivePermissions = getEffectivePermissions(user.role, user.permissions);

  const jwtExpiry = company
    ? (process.env.JWT_EXPIRY || process.env.JWT_EXPIRES_IN || process.env.JWT_ACCESS_EXPIRY || '8h')
    : '15m';

  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.full_name,
    permissions: effectivePermissions,
    businessId: user.business_id,
  };
  if (company) {
    payload.companyId = company.id;
    payload.companyName = company.name;
  }

  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: jwtExpiry });

  let refreshToken = null;
  if (company) {
    refreshToken = crypto.randomBytes(40).toString('hex');
    const refreshExpires = new Date();
    refreshExpires.setDate(refreshExpires.getDate() + 7);

    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at, ip_address, company_id) VALUES ($1, $2, $3, $4, $5)',
      [user.id, refreshToken, refreshExpires, req.ip, company.id]
    );

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
  }

  res.cookie('token', token, {
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    maxAge: company ? 8 * 60 * 60 * 1000 : 15 * 60 * 1000
  });

  return { token, refreshToken, effectivePermissions };
}

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        errorCode: ERROR_CODES.MISSING_FIELDS,
        message: 'Email and password are required',
        details: {
          missingFields: [!email && 'email', !password && 'password'].filter(Boolean)
        }
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        errorCode: ERROR_CODES.INVALID_EMAIL_FORMAT,
        message: 'Invalid email format',
        details: { email: email }
      });
    }

    // Find user
    const result = await query('SELECT * FROM users WHERE email = $1 AND is_active = 1', [email.toLowerCase()]);
    
    if (result.rows.length === 0) {
      logger.warn(`⚠️ Failed login attempt: Unknown user or inactive (${email}) from IP ${req.ip}`);
      return res.status(401).json({
        success: false,
        errorCode: ERROR_CODES.INVALID_CREDENTIALS,
        message: 'Invalid email or password',
        details: { attemptedEmail: email }
      });
    }

    const user = result.rows[0];
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      logger.warn(`⚠️ Failed login attempt: Invalid password for ${email} from IP ${req.ip}`);
      return res.status(401).json({
        success: false,
        errorCode: ERROR_CODES.INVALID_CREDENTIALS,
        message: 'Invalid email or password',
        details: { attemptedEmail: email }
      });
    }

    // Update last login
    await query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

    // Figure out which company this session should be scoped to. Every user
    // in a business can access every (active) company that business owns —
    // there's no per-company grant to check.
    const companiesResult = await query(
      'SELECT id, name FROM companies WHERE business_id = $1 AND is_active = 1 ORDER BY id ASC',
      [user.business_id]
    );
    const companies = companiesResult.rows;

    if (companies.length === 0) {
      logger.warn(`⚠️ Login blocked: no active company for business of user ${email}`);
      return res.status(403).json({
        success: false,
        message: 'No active company found for this account. Contact support.'
      });
    }

    let activeCompany = null;
    if (companies.length === 1) {
      activeCompany = companies[0];
    } else if (user.default_company_id) {
      activeCompany = companies.find(c => c.id === user.default_company_id) || null;
    }

    const { token, refreshToken, effectivePermissions } = await issueSessionTokens(user, activeCompany, req, res);

    logger.info(`✅ Successful login: ${email} from IP ${req.ip}`);

    const userPayload = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      phone: user.phone,
      permissions: effectivePermissions
    };

    if (!activeCompany) {
      return res.json({
        success: true,
        requiresCompanySelection: true,
        message: 'Select a company to continue',
        data: { token, companies, user: userPayload }
      });
    }

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        refreshToken,
        user: userPayload,
        company: activeCompany,
        companies
      }
    });
  } catch (error) {
    // Specific error handling
    if (error.name === 'JsonWebTokenError') {
      logError(error, req, { feature: 'auth', severity: 'high' });
      return res.status(500).json({
        success: false,
        errorCode: ERROR_CODES.JWT_ERROR,
        message: 'Token generation failed',
        details: { error: error.message }
      });
    }

    if (error.code === 'ECONNREFUSED' || error.code === '3D000' || error.message?.includes('database')) {
      logError(error, req, { feature: 'auth', severity: 'critical' });
      return res.status(500).json({
        success: false,
        errorCode: ERROR_CODES.DATABASE_ERROR,
        message: 'Database connection error',
        details: { message: 'Could not connect to database' }
      });
    }

    // Generic server error
    logError(error, req, { feature: 'auth', severity: 'high' });
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      errorCode: ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: 'An internal server error occurred',
      details: { timestamp: new Date().toISOString() }
    });
  }
});

// POST /api/auth/switch-company
// Switches the active company for the current session. Requires only
// authMiddleware (not requireCompanyContext) since this is exactly how a
// "pick a company" pending token — or any existing session — picks/changes
// which company is active. No re-login, no password re-entry.
router.post('/switch-company', authMiddleware, async (req, res) => {
  try {
    const { companyId } = req.body;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'companyId is required' });
    }

    const userResult = await query('SELECT * FROM users WHERE id = $1 AND is_active = 1', [req.user.userId]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ success: false, errorCode: ERROR_CODES.USER_INACTIVE, message: 'User is no longer active' });
    }
    const user = userResult.rows[0];

    const companyResult = await query(
      'SELECT id, name FROM companies WHERE id = $1 AND business_id = $2 AND is_active = 1',
      [companyId, user.business_id]
    );
    if (companyResult.rows.length === 0) {
      return res.status(403).json({ success: false, message: 'Company not found or not accessible' });
    }
    const company = companyResult.rows[0];

    // Remember this as the company to land in next time.
    await query('UPDATE users SET default_company_id = $1 WHERE id = $2', [company.id, user.id]);

    const { token, refreshToken, effectivePermissions } = await issueSessionTokens(user, company, req, res);

    res.json({
      success: true,
      message: `Switched to ${company.name}`,
      data: {
        token,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          phone: user.phone,
          permissions: effectivePermissions
        },
        company
      }
    });
  } catch (error) {
    logError(error, req, { feature: 'auth' });
    logger.error('Switch company error:', error);
    res.status(500).json({ success: false, message: 'Failed to switch company' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken || req.headers['x-refresh-token'];
  if (refreshToken) {
    try {
      await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    } catch (err) {
      logger.error('Error deleting refresh token on logout:', err);
    }
  }
  res.clearCookie('token', { httpOnly: true, secure: false, sameSite: 'strict' });
  res.clearCookie('refreshToken', { httpOnly: true, secure: false, sameSite: 'strict' });
  res.json({ success: true, message: 'Logged out successfully' });
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken || req.headers['x-refresh-token'];
    
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        errorCode: 'NO_REFRESH_TOKEN',
        message: 'Refresh token is required'
      });
    }

    const result = await query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP',
      [refreshToken]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        errorCode: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired'
      });
    }

    const tokenRow = result.rows[0];
    const userResult = await query(
      'SELECT * FROM users WHERE id = $1 AND is_active = 1',
      [tokenRow.user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        errorCode: ERROR_CODES.USER_INACTIVE,
        message: 'User is no longer active'
      });
    }

    const user = userResult.rows[0];

    // Preserve whichever company this session was scoped to, as long as it's
    // still active and still belongs to the user's business.
    let company = null;
    if (tokenRow.company_id) {
      const companyResult = await query(
        'SELECT id, name FROM companies WHERE id = $1 AND business_id = $2 AND is_active = 1',
        [tokenRow.company_id, user.business_id]
      );
      company = companyResult.rows[0] || null;
    }

    // Invalidate old refresh token (Token Rotation)
    await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);

    const { token, refreshToken: newRefreshToken } = await issueSessionTokens(user, company, req, res);

    res.json({ success: true, token, refreshToken: newRefreshToken, company });
  } catch (err) {
    logError(err, req, { feature: 'auth' });
    logger.error('Refresh error:', err);
    res.status(500).json({
      success: false,
      errorCode: ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: 'Token refresh failed'
    });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, email, full_name, role, phone, last_login, created_at, permissions, business_id FROM users WHERE id = $1',
      [req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const userData = result.rows[0];
    const { getEffectivePermissions } = require('../middleware/auth');
    userData.permissions = getEffectivePermissions(userData.role, userData.permissions);

    const [businessResult, companiesResult] = await Promise.all([
      query('SELECT id, name FROM businesses WHERE id = $1', [userData.business_id]),
      query('SELECT id, name FROM companies WHERE business_id = $1 AND is_active = 1 ORDER BY id ASC', [userData.business_id]),
    ]);
    userData.business = businessResult.rows[0] || null;
    userData.companies = companiesResult.rows;
    userData.company = req.user.companyId
      ? (companiesResult.rows.find(c => c.id === req.user.companyId) || null)
      : null;
    delete userData.business_id;

    res.json({ success: true, data: userData });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'auth' });
    res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
});

// PUT /api/auth/update-profile
router.put('/update-profile', authMiddleware, async (req, res) => {
  try {
    const { email, full_name } = req.body;
    if (!email || !full_name) {
      return res.status(400).json({ success: false, message: 'Email and full name are required' });
    }

    const result = await query(
      'UPDATE users SET email = $1, full_name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [email.toLowerCase(), full_name, req.user.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const updated = await query('SELECT id, email, full_name, role, phone FROM users WHERE id = $1', [req.user.userId]);
    res.json({ success: true, message: 'Profile updated successfully', data: updated.rows[0] });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'auth' });
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062 || error.sqlState === '23000' || error.code === '23505' || error.code === 'SQLITE_CONSTRAINT_UNIQUE' || (error.message && (error.message.includes('Duplicate') || error.message.includes('UNIQUE')))) {
      return res.status(400).json({ success: false, message: 'Email already in use' });
    }
    logger.error('Update profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, message: 'Both passwords are required' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.userId]);
    const user = result.rows[0];

    const isValid = await bcrypt.compare(current_password, user.password_hash);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(new_password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    await query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newHash, req.user.userId]);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'auth' });
    res.status(500).json({ success: false, message: 'Failed to change password' });
  }
});

// GET /api/auth/users (admin only)
router.get('/users', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const result = await query(
      'SELECT id, email, full_name, role, phone, is_active, last_login, created_at, permissions FROM users WHERE business_id = $1 ORDER BY created_at DESC',
      [req.user.businessId]
    );
    const { getEffectivePermissions } = require('../middleware/auth');
    const rows = result.rows.map(u => {
      u.permissions = getEffectivePermissions(u.role, u.permissions);
      return u;
    });
    res.json({ success: true, data: rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'auth' });
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// POST /api/auth/users (admin only)
router.post('/users', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { email, password, full_name, role, phone, permissions } = req.body;
    if (!email || !password || !full_name || !role) {
      return res.status(400).json({ success: false, message: 'Email, password, name, and role are required' });
    }

    const hash = await bcrypt.hash(password, 12);
    const { ROLE_PERMISSIONS } = require('../middleware/auth');
    const roleDefaults = ROLE_PERMISSIONS[role] || [];
    const initialPerms = Array.isArray(permissions) ? permissions : roleDefaults;
    const permsJson = JSON.stringify(initialPerms);
    const result = await query(
      'INSERT INTO users (email, password_hash, full_name, role, phone, created_by, permissions, business_id, default_company_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, email, full_name, role, permissions',
      [email.toLowerCase(), hash, full_name, role, phone, req.user.userId, permsJson, req.user.businessId, req.user.companyId || null]
    );

    let createdUser = result.rows && result.rows[0];
    if (!createdUser) {
      const fetchRes = await query('SELECT id, email, full_name, role, permissions FROM users WHERE email = $1', [email.toLowerCase()]);
      createdUser = fetchRes.rows[0];
    }
    if (createdUser && typeof createdUser.permissions === 'string') {
      try { createdUser.permissions = JSON.parse(createdUser.permissions); } catch (_) {}
    }

    res.status(201).json({ success: true, data: createdUser, message: 'User created successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'auth' });
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062 || error.sqlState === '23000' || error.code === '23505' || error.code === 'SQLITE_CONSTRAINT_UNIQUE' || (error.message && (error.message.includes('Duplicate') || error.message.includes('UNIQUE')))) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to create user' });
  }
});
// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const result = await query('SELECT * FROM users WHERE email = $1 AND is_active = 1', [cleanEmail]);
    if (result.rows.length === 0) {
      // Don't reveal that the user doesn't exist for security reasons
      return res.json({ success: true, message: 'If an account exists, a password reset email has been sent.' });
    }

    const user = result.rows[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/#/reset-password/${resetToken}`;
    
    const emailHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <h2 style="color: #0f766e;">Password Reset Request</h2>
        <p>Hello ${user.full_name},</p>
        <p>We received a request to reset your password. Click the button below to choose a new one:</p>
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #0f766e; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">Reset Password</a>
        <p>If you didn't request this, you can safely ignore this email. The link will expire in 24 hours.</p>
        <p style="margin-top: 40px; font-size: 12px; color: #777;">Security Agency Administration</p>
      </div>
    `;

    // Send email FIRST — only persist token in DB if email succeeds
    await sendEmail({
      to: user.email,
      subject: 'Password Reset Request',
      html: emailHtml,
      text: `You requested a password reset. Please go to: ${resetUrl}`
    });

    // Persist token in DB
    await query(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [hashedToken, expiresAt, user.id]
    );

    res.json({ success: true, message: 'If an account exists, a password reset email has been sent.' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'auth' });
    logger.error('Forgot password error:', error);

    if (error.message?.includes('SMTP is not fully configured')) {
      return res.status(503).json({ 
        success: false, 
        message: 'Email service is not configured. Contact your administrator to set up SMTP in Settings.' 
      });
    }

    res.status(500).json({ success: false, message: 'Failed to process password reset request' });
  }
});

// GET /api/auth/validate-reset-token/:token
router.get('/validate-reset-token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ success: false, message: 'Token is required' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const result = await query(
      'SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > CURRENT_TIMESTAMP',
      [hashedToken]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired' });
    }

    res.json({ success: true, message: 'Token is valid' });
  } catch (error) {
    logger.error('Validate reset token error:', error);
    res.status(500).json({ success: false, message: 'Failed to validate reset token' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) {
      return res.status(400).json({ success: false, message: 'Token and new password are required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    
    const userResult = await query(
      'SELECT id, password_hash FROM users WHERE reset_token = $1 AND reset_token_expires > CURRENT_TIMESTAMP',
      [hashedToken]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Token is invalid or has expired' });
    }

    const user = userResult.rows[0];
    const isSamePassword = await bcrypt.compare(new_password, user.password_hash);
    if (isSamePassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'New password must be different from your current password.' 
      });
    }

    const newHash = await bcrypt.hash(new_password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    
    // Update password and clear reset token
    await query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newHash, user.id]
    );

    // Invalidate all existing sessions/refresh tokens for this user
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [user.id]);

    logger.info(`✅ Password successfully reset for user ID: ${user.id}`);

    res.json({ success: true, message: 'Password has been reset successfully. You can now login.' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'auth' });
    logger.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
});

// POST /api/auth/signup
// Public self-service signup for the SaaS. Creates a brand-new Business +
// its first Admin user + a default Company, fully isolated from every other
// business in the system, and logs the admin straight in.
router.post('/signup', signupLimiter, async (req, res) => {
  try {
    const { business_name, email, password, full_name } = req.body;

    if (!business_name || !email || !password || !full_name) {
      return res.status(400).json({
        success: false,
        errorCode: ERROR_CODES.MISSING_FIELDS,
        message: 'Business name, email, password, and full name are required'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        errorCode: ERROR_CODES.INVALID_EMAIL_FORMAT,
        message: 'Invalid email format'
      });
    }
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        errorCode: ERROR_CODES.PASSWORD_TOO_SHORT,
        message: 'Password must be at least 8 characters'
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existing = await query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists' });
    }

    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const cleanBusinessName = business_name.trim();

    const businessResult = await query('INSERT INTO businesses (name) VALUES ($1)', [cleanBusinessName]);
    const businessId = businessResult.insertId;

    const companyResult = await query('INSERT INTO companies (business_id, name) VALUES ($1, $2)', [businessId, cleanBusinessName]);
    const companyId = companyResult.insertId;

    const userResult = await query(
      `INSERT INTO users (email, password_hash, full_name, role, is_active, business_id, default_company_id)
       VALUES ($1, $2, $3, 'admin', 1, $4, $5)`,
      [cleanEmail, hash, full_name, businessId, companyId]
    );
    const userId = userResult.insertId;

    const user = { id: userId, email: cleanEmail, full_name, role: 'admin', permissions: null, business_id: businessId };
    const company = { id: companyId, name: cleanBusinessName };

    const { token, refreshToken, effectivePermissions } = await issueSessionTokens(user, company, req, res);

    logger.info(`✅ New business signed up: "${cleanBusinessName}" (${cleanEmail})`);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: {
        token,
        refreshToken,
        user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, phone: null, permissions: effectivePermissions },
        company
      }
    });
  } catch (error) {
    logError(error, req, { feature: 'auth' });
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists' });
    }
    logger.error('Signup error:', error);
    res.status(500).json({
      success: false,
      errorCode: ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: 'Failed to create account'
    });
  }
});

// ============================================================
// SETUP ENDPOINTS - For first-time initialization
// ============================================================

// GET /api/auth/setup-status
// Check if initial setup is complete (unauthenticated)
router.get('/setup-status', async (req, res) => {
  try {
    const { pool, initDB } = require('../database/connection');
    if (!pool) {
      await initDB();
    }
    const result = await query('SELECT COUNT(*) as count FROM users WHERE role = $1', ['admin']);
    const adminCount = result.rows[0].count;

    res.json({
      success: true,
      setupComplete: adminCount > 0,
      message: adminCount > 0 ? 'Setup complete' : 'Setup required'
    });
  } catch (err) {
    logger.error('Error checking setup status:', err.message);
    res.status(500).json({
      success: false,
      errorCode: ERROR_CODES.DATABASE_ERROR,
      message: 'Error checking setup status: ' + err.message
    });
  }
});

// POST /api/auth/configure-db
// Receives MySQL credentials from the error screen, updates .env and reconnects live pool
router.post('/configure-db', async (req, res) => {
  try {
    const { host, port, user, password, database } = req.body;
    const { reconnectDB } = require('../database/connection');
    const fs = require('fs');
    const path = require('path');

    // Update .env files across possible locations (process.cwd, project root, userData)
    const envPaths = [
      path.join(process.cwd(), '.env'),
      path.join(__dirname, '..', '..', '.env'),
      process.env.USER_DATA_PATH ? path.join(process.env.USER_DATA_PATH, '.env') : null
    ].filter(Boolean);

    for (const envPath of envPaths) {
      if (fs.existsSync(envPath)) {
        try {
          let envContent = fs.readFileSync(envPath, 'utf8');
          const setEnv = (key, val) => {
            const regex = new RegExp(`^${key}=.*$`, 'm');
            if (regex.test(envContent)) {
              envContent = envContent.replace(regex, `${key}=${val}`);
            } else {
              envContent += `\n${key}=${val}`;
            }
          };
          if (host) setEnv('DB_HOST', host);
          if (port) setEnv('DB_PORT', port);
          if (user) setEnv('DB_USER', user);
          if (password !== undefined) setEnv('DB_PASSWORD', password);
          if (database) setEnv('DB_NAME', database);
          fs.writeFileSync(envPath, envContent, 'utf8');
        } catch (_) {}
      }
    }

    // Live reconnect database connection
    await reconnectDB({
      host: host || process.env.DB_HOST,
      port: port || process.env.DB_PORT,
      user: user || process.env.DB_USER,
      password: password !== undefined ? password : process.env.DB_PASSWORD,
      database: database || process.env.DB_NAME
    });

    res.json({ success: true, message: 'Connected to MySQL successfully!' });
  } catch (err) {
    logger.error('Failed to configure DB:', err.message);
    res.status(400).json({ success: false, message: err.message || 'Failed to connect to MySQL with provided password' });
  }
});

// POST /api/auth/open-log-folder
// Opens the logs directory in Windows Explorer
router.post('/open-log-folder', async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const { exec } = require('child_process');
    const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    if (process.platform === 'win32') {
      exec(`explorer.exe "${logDir}"`);
    }
    res.json({ success: true, path: logDir });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/auth/setup-init
// Initialize first admin account (unauthenticated, one-time use)
router.post('/setup-init', async (req, res) => {
  try {
    const { email, password, full_name, seed_test_data } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        errorCode: ERROR_CODES.MISSING_FIELDS,
        message: 'Email and password are required'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        errorCode: ERROR_CODES.PASSWORD_TOO_SHORT,
        message: 'Password must be at least 8 characters'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        errorCode: ERROR_CODES.INVALID_EMAIL_FORMAT,
        message: 'Invalid email format'
      });
    }

    // Security guard: refuse if admin already exists
    const adminCheck = await query('SELECT COUNT(*) as count FROM users WHERE role = $1', ['admin']);
    if (adminCheck.rows[0].count > 0) {
      return res.status(400).json({
        success: false,
        errorCode: 'ADMIN_EXISTS',
        message: 'Admin account already exists. Setup is complete.'
      });
    }

    // Hash password and create admin
    const hash = bcrypt.hashSync(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);

    // Every user needs a business + a company to land in — create a default
    // one for this first admin, same as /signup does.
    const businessName = full_name ? `${full_name}'s Business` : 'My Business';
    const businessResult = await query('INSERT INTO businesses (name) VALUES ($1)', [businessName]);
    const businessId = businessResult.insertId;
    const companyResult = await query('INSERT INTO companies (business_id, name) VALUES ($1, $2)', [businessId, businessName]);
    const companyId = companyResult.insertId;

    const insertResult = await query(`
      INSERT INTO users (email, password_hash, full_name, role, is_active, created_at, business_id, default_company_id)
      VALUES ($1, $2, $3, $4, 1, CURRENT_TIMESTAMP, $5, $6)
    `, [
      email.toLowerCase().trim(),
      hash,
      full_name || 'Administrator',
      'admin',
      businessId,
      companyId
    ]);

    const newAdminId = insertResult.insertId;

    logger.info(`✅ Admin account created during setup: ${email}`);

    // Seed test data if user opted in
    if (seed_test_data) {
      try {
        await seedTestData(newAdminId);
        logger.info('✅ Test data seeded during setup');
      } catch (seedErr) {
        logger.warn('⚠️ Test data seeding failed (non-critical):', seedErr.message);
      }
    }

    res.json({
      success: true,
      message: 'Admin account created successfully. You can now login.'
    });

  } catch (err) {
    logError(err, req, { feature: 'setup' });
    logger.error('Setup init error:', err);
    res.status(500).json({
      success: false,
      errorCode: ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: 'Failed to create admin account'
    });
  }
});

// Helper: Seed test data (clients)
async function seedTestData(adminId = 1) {
  const clientsData = [
    { name: 'Royal Residency', rate: 45000 },
    { name: 'Green Heights', rate: 50000 },
    { name: 'Sunrise Tower', rate: 55000 },
    { name: 'Shanti Complex', rate: 48000 },
    { name: 'Metro Apartments', rate: 52000 },
    { name: 'Golden Villa', rate: 60000 },
    { name: 'Silver Park', rate: 42000 },
    { name: 'Diamond Enclave', rate: 65000 },
    { name: 'Pearl Heights', rate: 58000 },
    { name: 'Crystal Point', rate: 51000 },
    { name: 'Heritage Square', rate: 46000 },
    { name: 'Prestige Gardens', rate: 54000 },
    { name: 'Elite Tower', rate: 62000 },
    { name: 'Prime Avenue', rate: 49000 },
    { name: 'Supreme Horizon', rate: 57000 },
    { name: 'Grand Skyline', rate: 64000 },
    { name: 'Saffron Palace', rate: 43000 },
    { name: 'Lotus Garden', rate: 53000 },
    { name: 'Maple Enclave', rate: 47000 },
    { name: 'Cedar Point', rate: 61000 }
  ];

  const today = new Date().toISOString().split('T')[0];

  for (const client of clientsData) {
    try {
      await query(`
        INSERT INTO clients (name, address, city, state, postal_code, email, phone, contact_person,
          contract_start_date, monthly_rate, billing_cycle, is_active, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12)
      `, [
        client.name,
        '123, Ahmedabad',
        'Ahmedabad',
        'Gujarat',
        '380001',
        `${client.name.toLowerCase().replace(/\s+/g, '.')}@test.com`,
        '9999999999',
        'Test Contact',
        today,
        client.rate,
        1,
        adminId
      ]);
    } catch (err) {
      // Skip if insert fails (e.g., duplicate)
    }
  }
}

module.exports = router;
