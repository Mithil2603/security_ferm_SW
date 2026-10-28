const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);

const COMPANY_FIELDS = [
  'name', 'legal_name', 'gstin', 'pan', 'address', 'city', 'state', 'state_code', 'postal_code',
  'phone', 'email', 'bank_account_number', 'bank_ifsc_code', 'bank_name', 'bank_account_holder_name',
  'financial_year_start_month', 'logo_url', 'invoice_email_template'
];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/companies — list every active company in my business. Used by the
// post-login "pick a company" screen and the app-bar switcher. Doesn't
// require an active company context, since it's needed before one exists.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, name, legal_name, gstin, is_active FROM companies WHERE business_id = $1 AND is_active = 1 ORDER BY id ASC',
      [req.user.businessId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, req, { feature: 'companies' });
    res.status(500).json({ success: false, message: 'Failed to fetch companies' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/companies — create another company under my own business. This is
// the "create as many as you want" feature. Every existing user in the
// business immediately has access to it via their existing role — there is
// no separate invite/grant step.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Company name is required' });
    }

    const columns = ['business_id', 'name', 'created_by'];
    const values = [req.user.businessId, name.trim(), req.user.userId];
    for (const field of COMPANY_FIELDS) {
      if (field === 'name') continue;
      if (req.body[field] !== undefined) {
        columns.push(field);
        values.push(req.body[field]);
      }
    }
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

    const result = await query(
      `INSERT INTO companies (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );

    res.status(201).json({ success: true, data: result.rows[0], message: 'Company created successfully' });
  } catch (error) {
    logError(error, req, { feature: 'companies' });
    logger.error('Create company error:', error);
    res.status(500).json({ success: false, message: 'Failed to create company' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/companies/:id — edit a company's profile. Must belong to my business.
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const existing = await query(
      'SELECT id FROM companies WHERE id = $1 AND business_id = $2',
      [req.params.id, req.user.businessId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const setClauses = [];
    const values = [];
    let pc = 1;
    for (const field of COMPANY_FIELDS) {
      if (req.body[field] !== undefined) {
        setClauses.push(`${field} = $${pc}`);
        values.push(req.body[field]);
        pc++;
      }
    }
    if (setClauses.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }
    values.push(req.params.id, req.user.businessId);

    const result = await query(
      `UPDATE companies SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${pc} AND business_id = $${pc + 1} RETURNING *`,
      values
    );

    res.json({ success: true, data: result.rows[0], message: 'Company updated successfully' });
  } catch (error) {
    logError(error, req, { feature: 'companies' });
    logger.error('Update company error:', error);
    res.status(500).json({ success: false, message: 'Failed to update company' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/companies/:id — archive only (never a hard delete). A business
// must always keep at least one active company.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const existing = await query(
      'SELECT id FROM companies WHERE id = $1 AND business_id = $2 AND is_active = 1',
      [req.params.id, req.user.businessId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const activeCount = await query(
      'SELECT COUNT(*) as cnt FROM companies WHERE business_id = $1 AND is_active = 1',
      [req.user.businessId]
    );
    if (Number(activeCount.rows[0].cnt) <= 1) {
      return res.status(400).json({ success: false, message: 'Cannot archive your only active company' });
    }

    await query(
      'UPDATE companies SET is_active = 0, archived_at = CURRENT_TIMESTAMP WHERE id = $1',
      [req.params.id]
    );

    res.json({ success: true, message: 'Company archived successfully' });
  } catch (error) {
    logError(error, req, { feature: 'companies' });
    logger.error('Archive company error:', error);
    res.status(500).json({ success: false, message: 'Failed to archive company' });
  }
});

module.exports = router;
