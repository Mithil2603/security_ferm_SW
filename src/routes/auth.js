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
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const result = await query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email.toLowerCase()]);
    if (result.rows.length === 0) {
      logger.warn(`⚠️ Failed login attempt: Unknown user or inactive (${email}) from IP ${req.ip}`);
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      logger.warn(`⚠️ Failed login attempt: Invalid password for ${email} from IP ${req.ip}`);
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Update last login
    await query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

    const parsedPermissions = user.permissions ? JSON.parse(user.permissions) : [];
    
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, name: user.full_name, permissions: parsedPermissions },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = crypto.randomBytes(40).toString('hex');
    const refreshExpires = new Date();
    refreshExpires.setDate(refreshExpires.getDate() + 7); // 7 days

    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at, ip_address) VALUES ($1, $2, $3, $4)',
      [user.id, refreshToken, refreshExpires, req.ip]
    );

    // Set JWT in httpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: false, // Must be false because Electron app uses http://localhost:5000
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000 // 15 mins
    });
    
    // Set Refresh Token in httpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          phone: user.phone,
          permissions: parsedPermissions
        }
      }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'auth' });
    logger.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed, please try again' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
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
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) return res.status(401).json({ success: false, message: 'No refresh token' });

    const result = await query('SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP', [refreshToken]);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    const userId = result.rows[0].user_id;
    const userResult = await query('SELECT * FROM users WHERE id = $1 AND is_active = true', [userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    const user = userResult.rows[0];
    const parsedPermissions = user.permissions ? JSON.parse(user.permissions) : [];
    
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, name: user.full_name, permissions: parsedPermissions },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000
    });

    res.json({ success: true, token });
  } catch (err) {
    logger.error('Refresh error:', err);
    res.status(500).json({ success: false, message: 'Refresh failed' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, email, full_name, role, phone, last_login, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, data: result.rows[0] });
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
    if (error.code === '23505' || (error.message && error.message.includes('UNIQUE'))) {
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
    res.json({ success: true, data: result.rows });
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
    const permsJson = JSON.stringify(permissions || []);
    const result = await query(
      'INSERT INTO users (email, password_hash, full_name, role, phone, created_by, permissions) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, full_name, role, permissions',
      [email.toLowerCase(), hash, full_name, role, phone, req.user.userId, permsJson]
    );

    res.status(201).json({ success: true, data: result.rows[0], message: 'User created successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'auth' });
    if (error.code === '23505' || error.code === 'SQLITE_CONSTRAINT_UNIQUE' || (error.message && error.message.includes('UNIQUE'))) {
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

    const result = await query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email.toLowerCase()]);
    if (result.rows.length === 0) {
      // Don't reveal that the user doesn't exist for security reasons
      return res.json({ success: true, message: 'If an account exists, a password reset email has been sent.' });
    }

    const user = result.rows[0];
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // Store as ISO string for SQLite compat

    await query(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [hashedToken, expiresAt, user.id]
    );

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password/${resetToken}`;
    
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

    await sendEmail({
      to: user.email,
      subject: 'Password Reset Request',
      html: emailHtml,
      text: `You requested a password reset. Please go to: ${resetUrl}`
    });

    res.json({ success: true, message: 'If an account exists, a password reset email has been sent.' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'auth' });
    logger.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Failed to process password reset request' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) {
      return res.status(400).json({ success: false, message: 'Token and new password are required' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    
    const result = await query(
      'SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > CURRENT_TIMESTAMP',
      [hashedToken]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Token is invalid or has expired' });
    }

    const userId = result.rows[0].id;
    const newHash = await bcrypt.hash(new_password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    
    await query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newHash, userId]
    );

    res.json({ success: true, message: 'Password has been reset successfully. You can now login.' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'auth' });
    logger.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
});

module.exports = router;
