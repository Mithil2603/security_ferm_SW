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

    const { ROLE_PERMISSIONS } = require('../middleware/auth');
    let parsedPermissions = [];
    if (Array.isArray(user.permissions)) {
      parsedPermissions = user.permissions;
    } else if (typeof user.permissions === 'string') {
      try { parsedPermissions = JSON.parse(user.permissions); } catch (_) {}
    }
    const roleDefaults = ROLE_PERMISSIONS[user.role] || [];
    const effectivePermissions = Array.from(new Set([...roleDefaults, ...parsedPermissions]));
    
    // Create JWT token (default 8h)
    const jwtExpiry = process.env.JWT_EXPIRY || process.env.JWT_EXPIRES_IN || process.env.JWT_ACCESS_EXPIRY || '8h';
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, name: user.full_name, permissions: effectivePermissions },
      process.env.JWT_SECRET,
      { expiresIn: jwtExpiry }
    );

    // Create refresh token
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const refreshExpires = new Date();
    refreshExpires.setDate(refreshExpires.getDate() + 7);

    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at, ip_address) VALUES ($1, $2, $3, $4)',
      [user.id, refreshToken, refreshExpires, req.ip]
    );

    // Set cookies
    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000 // 8 hours
    });
    
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    logger.info(`✅ Successful login: ${email} from IP ${req.ip}`);

    res.json({
      success: true,
      message: 'Login successful',
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
        }
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

    const userId = result.rows[0].user_id;
    const userResult = await query(
      'SELECT * FROM users WHERE id = $1 AND is_active = 1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        errorCode: ERROR_CODES.USER_INACTIVE,
        message: 'User is no longer active'
      });
    }

    const user = userResult.rows[0];
    const { ROLE_PERMISSIONS } = require('../middleware/auth');
    let parsedPermissions = [];
    if (Array.isArray(user.permissions)) {
      parsedPermissions = user.permissions;
    } else if (typeof user.permissions === 'string') {
      try { parsedPermissions = JSON.parse(user.permissions); } catch (_) {}
    }
    const roleDefaults = ROLE_PERMISSIONS[user.role] || [];
    const effectivePermissions = Array.from(new Set([...roleDefaults, ...parsedPermissions]));
    
    const jwtExpiry = process.env.JWT_EXPIRY || process.env.JWT_EXPIRES_IN || process.env.JWT_ACCESS_EXPIRY || '8h';
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, name: user.full_name, permissions: effectivePermissions },
      process.env.JWT_SECRET,
      { expiresIn: jwtExpiry }
    );

    // Invalidate old refresh token (Token Rotation)
    await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);

    // Issue new refresh token
    const newRefreshToken = crypto.randomBytes(40).toString('hex');
    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + 7);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at, ip_address) VALUES ($1, $2, $3, $4)',
      [userId, newRefreshToken, newExpiry, req.ip]
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000 // 8 hours
    });

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ success: true, token, refreshToken: newRefreshToken });
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
      'SELECT id, email, full_name, role, phone, last_login, created_at, permissions FROM users WHERE id = $1',
      [req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const userData = result.rows[0];
    const { ROLE_PERMISSIONS } = require('../middleware/auth');
    let parsedPermissions = [];
    if (Array.isArray(userData.permissions)) {
      parsedPermissions = userData.permissions;
    } else if (typeof userData.permissions === 'string') {
      try { parsedPermissions = JSON.parse(userData.permissions); } catch (_) {}
    }
    const roleDefaults = ROLE_PERMISSIONS[userData.role] || [];
    userData.permissions = Array.from(new Set([...roleDefaults, ...parsedPermissions]));
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
      'SELECT id, email, full_name, role, phone, is_active, last_login, created_at, permissions FROM users ORDER BY created_at DESC'
    );
    const { ROLE_PERMISSIONS } = require('../middleware/auth');
    const rows = result.rows.map(u => {
      let parsed = [];
      if (Array.isArray(u.permissions)) parsed = u.permissions;
      else if (typeof u.permissions === 'string') {
        try { parsed = JSON.parse(u.permissions); } catch (_) {}
      }
      const roleDefaults = ROLE_PERMISSIONS[u.role] || [];
      u.permissions = parsed.length > 0 ? parsed : roleDefaults;
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
    let initialPerms = [];
    if (Array.isArray(permissions) && permissions.length > 0) {
      initialPerms = permissions;
    } else {
      initialPerms = roleDefaults;
    }
    const permsJson = JSON.stringify(initialPerms);
    const result = await query(
      'INSERT INTO users (email, password_hash, full_name, role, phone, created_by, permissions) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, full_name, role, permissions',
      [email.toLowerCase(), hash, full_name, role, phone, req.user.userId, permsJson]
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

    const insertResult = await query(`
      INSERT INTO users (email, password_hash, full_name, role, is_active, created_at)
      VALUES ($1, $2, $3, $4, 1, CURRENT_TIMESTAMP)
    `, [
      email.toLowerCase().trim(),
      hash,
      full_name || 'Administrator',
      'admin'
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
