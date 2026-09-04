const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { logError } = require('../utils/errorLogger');

const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `agency_logo_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });
router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════════
//  SALARY STRUCTURES CRUD
// ═══════════════════════════════════════════════════════════════════

// GET /api/settings/salary-structures
router.get('/salary-structures', async (req, res) => {
  try {
    const result = await query(
      `SELECT ss.*,
              COALESCE((SELECT COUNT(*) FROM employees e WHERE e.salary_structure_id = ss.id AND e.is_active = 1), 0) AS active_guards
       FROM salary_structures ss
       ORDER BY ss.is_active DESC, ss.base_salary ASC`
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'settings' });
    logger.error('Fetch salary structures error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch salary structures' });
  }
});

// POST /api/settings/salary-structures
router.post('/salary-structures', requirePermission('manage_settings', 'manage_payroll'), async (req, res) => {
  try {
    const {
      name, base_salary, dearness_allowance = 0, house_rent_allowance = 0,
      other_allowances = 0, pf_percentage = 0, esi_applicable = false,
      income_tax_applicable = false, effective_from
    } = req.body;

    if (!name || !base_salary) {
      return res.status(400).json({ success: false, message: 'Name and base salary are required' });
    }

    const result = await query(
      `INSERT INTO salary_structures
         (name, base_salary, dearness_allowance, house_rent_allowance, other_allowances,
          pf_percentage, esi_applicable, income_tax_applicable, effective_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [name, base_salary, dearness_allowance, house_rent_allowance, other_allowances,
       pf_percentage, esi_applicable, income_tax_applicable, effective_from || new Date().toISOString().split('T')[0]]
    );

    res.status(201).json({ success: true, data: result.rows[0], message: 'Salary structure created' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'settings' });
    logger.error('Create salary structure error:', error);
    res.status(500).json({ success: false, message: 'Failed to create salary structure' });
  }
});

// PUT /api/settings/salary-structures/:id
router.put('/salary-structures/:id', requirePermission('manage_settings', 'manage_payroll'), async (req, res) => {
  try {
    const {
      name, base_salary, dearness_allowance, house_rent_allowance,
      other_allowances, pf_percentage, esi_applicable, income_tax_applicable,
      effective_from, is_active
    } = req.body;

    const result = await query(
      `UPDATE salary_structures SET
         name = COALESCE($1, name),
         base_salary = COALESCE($2, base_salary),
         dearness_allowance = COALESCE($3, dearness_allowance),
         house_rent_allowance = COALESCE($4, house_rent_allowance),
         other_allowances = COALESCE($5, other_allowances),
         pf_percentage = COALESCE($6, pf_percentage),
         esi_applicable = COALESCE($7, esi_applicable),
         income_tax_applicable = COALESCE($8, income_tax_applicable),
         effective_from = COALESCE($9, effective_from),
         is_active = COALESCE($10, is_active)
       WHERE id = $11
       RETURNING *`,
      [name, base_salary, dearness_allowance, house_rent_allowance,
       other_allowances, pf_percentage, esi_applicable, income_tax_applicable,
       effective_from, is_active, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Salary structure not found' });
    }
    res.json({ success: true, data: result.rows[0], message: 'Salary structure updated' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'settings' });
    logger.error('Update salary structure error:', error);
    res.status(500).json({ success: false, message: 'Failed to update salary structure' });
  }
});

// DELETE /api/settings/salary-structures/:id (soft-disable or delete if no active guards)
router.delete('/salary-structures/:id', requirePermission('manage_settings', 'manage_payroll'), async (req, res) => {
  try {
    // Check if any active employees are on this structure
    const check = await query(
      'SELECT COUNT(*) AS cnt FROM employees WHERE salary_structure_id = $1 AND is_active = 1',
      [req.params.id]
    );
    if (parseInt(check.rows[0].cnt) > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete: ${check.rows[0].cnt} active guard(s) are on this salary structure. Reassign them first.`
      });
    }

    await query('UPDATE salary_structures SET is_active = 0 WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Salary structure deactivated' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'settings' });
    logger.error('Delete salary structure error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete salary structure' });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  USER / TEAM MANAGEMENT (extends auth routes)
// ═══════════════════════════════════════════════════════════════════

// GET /api/settings/team
router.get('/team', requirePermission('manage_settings'), async (req, res) => {
  try {
    const result = await query(
      `SELECT id, username, email, full_name, role, is_active, created_at, last_login, permissions
       FROM users ORDER BY role ASC, full_name ASC`
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'settings' });
    logger.error('Fetch team error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch team' });
  }
});

// PUT /api/settings/users/:id or /api/settings/team/:id/permissions
router.put(['/users/:id', '/team/:id/permissions'], requirePermission('manage_settings'), async (req, res) => {
  try {
    const { permissions, role, full_name, phone } = req.body;
    const userId = req.params.id;

    const updates = [];
    const params = [];
    let pCount = 1;

    if (permissions !== undefined) {
      if (!Array.isArray(permissions)) {
        return res.status(400).json({ success: false, message: 'Permissions must be an array' });
      }
      updates.push(`permissions = $${pCount++}`);
      params.push(JSON.stringify(permissions));
    }
    if (role !== undefined) {
      updates.push(`role = $${pCount++}`);
      params.push(role);
    }
    if (full_name !== undefined) {
      updates.push(`full_name = $${pCount++}`);
      params.push(full_name);
    }
    if (phone !== undefined) {
      updates.push(`phone = $${pCount++}`);
      params.push(phone);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    params.push(userId);
    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = $${pCount}`;
    await query(sql, params);

    const checkUser = await query(
      'SELECT id, email, full_name, role, is_active, permissions FROM users WHERE id = $1',
      [userId]
    );

    if (checkUser.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const returnUserData = checkUser.rows[0];
    if (typeof returnUserData.permissions === 'string') {
      try {
        returnUserData.permissions = JSON.parse(returnUserData.permissions);
      } catch (_) {}
    }
    res.json({ success: true, data: returnUserData, message: 'User updated successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'settings' });
    logger.error('Update user error:', error);
    res.status(500).json({ success: false, message: 'Failed to update user' });
  }
});

// PATCH /api/settings/users/:id/toggle
router.patch('/users/:id/toggle', requirePermission('manage_settings'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (userId === req.user.userId) {
      return res.status(400).json({ success: false, message: 'Cannot deactivate your own account' });
    }

    const check = await query('SELECT is_active FROM users WHERE id = $1', [userId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const newStatus = check.rows[0].is_active ? 0 : 1;
    await query('UPDATE users SET is_active = $1 WHERE id = $2', [newStatus, userId]);

    res.json({ success: true, is_active: newStatus, message: `User ${newStatus ? 'activated' : 'deactivated'} successfully` });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'settings' });
    logger.error('Toggle user error:', error);
    res.status(500).json({ success: false, message: 'Failed to toggle user status' });
  }
});

// POST /api/settings/users/:id/reset-password
router.post('/users/:id/reset-password', requirePermission('manage_settings'), async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const hash = await bcrypt.hash(new_password, 12);
    const result = await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'settings' });
    logger.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
});

// PUT /api/settings/team/:id/status
router.put('/team/:id/status', requirePermission('manage_settings'), async (req, res) => {
  try {
    const { is_active } = req.body;
    if (typeof is_active !== 'boolean' && typeof is_active !== 'number') {
      return res.status(400).json({ success: false, message: 'is_active must be a boolean or 0/1' });
    }

    if (parseInt(req.params.id) === req.user.userId && !is_active) {
      return res.status(400).json({ success: false, message: 'Cannot deactivate your own account' });
    }

    const result = await query(
      'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, username, email, full_name, role, is_active',
      [is_active ? 1 : 0, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, data: result.rows[0], message: `User ${is_active ? 'activated' : 'deactivated'}` });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'settings' });
    logger.error('Update user status error:', error);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  SYSTEM / AGENCY SETTINGS (Key-Value store)
// ═══════════════════════════════════════════════════════════════════

// GET /api/settings/system/:key
router.get('/system/:key', async (req, res) => {
  try {
    const result = await query(
      'SELECT setting_value FROM system_settings WHERE setting_key = $1',
      [req.params.key]
    );
    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }
    res.json({ success: true, data: result.rows[0].setting_value });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'settings' });
    logger.error('Fetch system setting error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch setting' });
  }
});

// PUT /api/settings/system/:key
router.put('/system/:key', requirePermission('manage_settings'), async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined) {
      return res.status(400).json({ success: false, message: 'Value is required' });
    }

    await query(
      `INSERT INTO system_settings (setting_key, setting_value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE setting_value = $2, updated_at = CURRENT_TIMESTAMP`,
      [req.params.key, typeof value === 'object' ? JSON.stringify(value) : String(value)]
    );

    const fetched = await query(
      'SELECT setting_value FROM system_settings WHERE setting_key = $1',
      [req.params.key]
    );

    res.json({ success: true, data: fetched.rows[0]?.setting_value, message: 'Setting updated successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'settings' });
    logger.error('Update system setting error:', error);
    res.status(500).json({ success: false, message: 'Failed to update setting' });
  }
});

// POST /api/settings/system/agency_logo
router.post('/system/agency_logo', requirePermission('manage_settings'), upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const logoUrl = `/uploads/${req.file.filename}`;
    
    // Fetch current agency settings
    const currentSettingsRes = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'`);
    let agencySettings = {};
    if (currentSettingsRes.rows.length > 0) {
      try {
        agencySettings = JSON.parse(currentSettingsRes.rows[0].setting_value);
      } catch(e) {}
    }
    
    agencySettings.agency_logo_url = logoUrl;
    
    await query(
      `INSERT INTO system_settings (setting_key, setting_value, updated_at)
       VALUES ('agency_settings', $1, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE setting_value = $1, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(agencySettings)]
    );
    
    res.json({ success: true, message: 'Logo uploaded successfully', logo_url: logoUrl, data: { logo_url: logoUrl } });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'settings' });
    logger.error('Logo upload error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload logo' });
  }
});

// DELETE /api/settings/system/agency_logo
router.delete('/system/agency_logo', requirePermission('manage_settings'), async (req, res) => {
  try {
    const currentSettingsRes = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'`);
    if (currentSettingsRes.rows.length > 0) {
      let agencySettings = {};
      try {
        agencySettings = JSON.parse(currentSettingsRes.rows[0].setting_value);
      } catch(e) {}
      
      agencySettings.agency_logo_url = '';
      await query(
        `UPDATE system_settings SET setting_value = $1, updated_at = CURRENT_TIMESTAMP WHERE setting_key = 'agency_settings'`,
        [JSON.stringify(agencySettings)]
      );
    }
    res.json({ success: true, message: 'Logo removed successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'settings' });
    logger.error('Logo remove error:', error);
    res.status(500).json({ success: false, message: 'Failed to remove logo' });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  EXPENSE CATEGORIES
// ═══════════════════════════════════════════════════════════════════

// GET /api/settings/expense-categories
router.get('/expense-categories', async (req, res) => {
  try {
    const result = await query('SELECT * FROM expense_categories ORDER BY is_active DESC, name ASC');
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'settings' });
    logger.error('Fetch expense categories error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch expense categories' });
  }
});

// POST /api/settings/expense-categories
router.post('/expense-categories', requirePermission('manage_settings', 'manage_expenses'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Category name is required' });

    const result = await query(
      `INSERT INTO expense_categories (name) VALUES ($1) RETURNING *`,
      [name]
    );
    res.status(201).json({ success: true, data: result.rows[0], message: 'Expense category created' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'settings' });
    if (error.code === 'ER_DUP_ENTRY' || (error.message && error.message.includes('UNIQUE constraint failed'))) {
      return res.status(409).json({ success: false, message: 'Category already exists' });
    }
    logger.error('Create expense category error:', error);
    res.status(500).json({ success: false, message: 'Failed to create expense category' });
  }
});

// PUT /api/settings/expense-categories/:id
router.put('/expense-categories/:id', requirePermission('manage_settings', 'manage_expenses'), async (req, res) => {
  try {
    const { name, is_active } = req.body;
    const result = await query(
      `UPDATE expense_categories SET name = COALESCE($1, name), is_active = COALESCE($2, is_active) WHERE id = $3`,
      [name, is_active, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Category not found' });
    
    const updated = await query('SELECT * FROM expense_categories WHERE id = $1', [req.params.id]);
    res.json({ success: true, data: updated.rows[0], message: 'Category updated' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'settings' });
    if (error.code === 'ER_DUP_ENTRY' || (error.message && error.message.includes('UNIQUE constraint failed'))) {
      return res.status(409).json({ success: false, message: 'Category already exists' });
    }
    logger.error('Update expense category error:', error);
    res.status(500).json({ success: false, message: 'Failed to update category' });
  }
});

module.exports = router;
