const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const Joi = require('joi');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requirePermission('manage_bank_accounts', 'manage_payroll', 'manage_expenses'));

// Validation schemas
const bankAccountSchema = Joi.object({
  account_name: Joi.string().min(2).max(255).required(),
  account_type: Joi.string().valid('bank', 'cash', 'current', 'savings', 'overdraft', 'fixed_deposit', 'cc').required(),
  account_number: Joi.string().allow('', null).max(50).optional(),
  bank_name: Joi.string().allow('', null).max(255).optional(),
  ifsc_code: Joi.string().allow('', null).max(20).optional(),
  branch: Joi.string().allow('', null).max(255).optional(),
  opening_balance: Joi.number().default(0),
  opening_balance_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow('', null).optional()
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bank-accounts — List all accounts
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { active_only } = req.query;
    let where = '';
    if (active_only === 'true') {
      where = 'WHERE ba.is_active = 1';
    }

    const result = await query(`
      SELECT ba.*,
             u.full_name as created_by_name,
             COALESCE(ba.opening_balance, 0) +
               COALESCE((SELECT SUM(v.amount) FROM vouchers v WHERE v.debit_account_id = ba.id AND v.status = 'posted'), 0) -
               COALESCE((SELECT SUM(v.amount) FROM vouchers v WHERE v.credit_account_id = ba.id AND v.status = 'posted'), 0)
               as current_balance
      FROM bank_accounts ba
      LEFT JOIN users u ON ba.created_by = u.id
      ${where}
      ORDER BY ba.account_type ASC, ba.account_name ASC
    `);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, req, { feature: 'bank-accounts' });
    logger.error('Fetch bank accounts error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bank accounts' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bank-accounts/:id — Get single account with balance
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT ba.*,
             COALESCE(ba.opening_balance, 0) +
               COALESCE((SELECT SUM(v.amount) FROM vouchers v WHERE v.debit_account_id = ba.id AND v.status = 'posted'), 0) -
               COALESCE((SELECT SUM(v.amount) FROM vouchers v WHERE v.credit_account_id = ba.id AND v.status = 'posted'), 0)
               as current_balance
      FROM bank_accounts ba
      WHERE ba.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError(error, req, { feature: 'bank-accounts' });
    res.status(500).json({ success: false, message: 'Failed to fetch account' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bank-accounts — Create a new account
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { error, value } = bankAccountSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { account_name, account_number, bank_name, ifsc_code, branch, opening_balance, opening_balance_date } = value;
    let account_type = value.account_type;
    if (!['bank', 'cash'].includes(account_type)) {
      account_type = 'bank'; // map detailed types to 'bank' for DB constraint
    }

    const result = await query(`
      INSERT INTO bank_accounts (account_name, account_type, account_number, bank_name, ifsc_code, branch, opening_balance, opening_balance_date, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [account_name, account_type, account_number || null, bank_name || null, ifsc_code || null, branch || null, opening_balance, opening_balance_date || null, req.user.userId]);

    res.status(201).json({ success: true, data: result.rows[0], message: 'Bank account created successfully' });
  } catch (error) {
    logError(error, req, { feature: 'bank-accounts' });
    logger.error('Create bank account error:', error);
    res.status(500).json({ success: false, message: 'Failed to create bank account' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/bank-accounts/:id — Update account
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error, value } = bankAccountSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { account_name, account_number, bank_name, ifsc_code, branch, opening_balance, opening_balance_date } = value;
    let account_type = value.account_type;
    if (!['bank', 'cash'].includes(account_type)) {
      account_type = 'bank'; // map detailed types to 'bank' for DB constraint
    }

    const result = await query(`
      UPDATE bank_accounts
      SET account_name = $1, account_type = $2, account_number = $3, bank_name = $4,
          ifsc_code = $5, branch = $6, opening_balance = $7, opening_balance_date = $8
      WHERE id = $9
    `, [account_name, account_type, account_number || null, bank_name || null, ifsc_code || null, branch || null, opening_balance, opening_balance_date || null, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const updated = await query('SELECT * FROM bank_accounts WHERE id=$1', [id]);
    res.json({ success: true, data: updated.rows[0], message: 'Account updated successfully' });
  } catch (error) {
    logError(error, req, { feature: 'bank-accounts' });
    res.status(500).json({ success: false, message: 'Failed to update account' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/bank-accounts/:id — Soft delete (deactivate)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if account has posted vouchers
    const voucherCheck = await query(`
      SELECT COUNT(*) as count FROM vouchers
      WHERE (debit_account_id = $1 OR credit_account_id = $1) AND status = 'posted'
    `, [id]);

    const result = await query(`
      UPDATE bank_accounts SET is_active = 0 WHERE id = $1
    `, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const deleted = await query('SELECT * FROM bank_accounts WHERE id=$1', [id]);
    const hasVouchers = voucherCheck.rows[0].count > 0;
    res.json({
      success: true,
      message: hasVouchers
        ? 'Account deactivated (has existing vouchers, cannot be permanently deleted)'
        : 'Account deactivated successfully',
      data: deleted.rows[0]
    });
  } catch (error) {
    logError(error, req, { feature: 'bank-accounts' });
    res.status(500).json({ success: false, message: 'Failed to deactivate account' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bank-accounts/:id/statement — Bank book / Cash book
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/statement', async (req, res) => {
  try {
    const { id } = req.params;
    const { from_date, to_date } = req.query;

    let dateFilter = '';
    const params = [id, id];
    let pc = 3;

    if (from_date) {
      dateFilter += ` AND v.voucher_date >= $${pc}`;
      params.push(from_date);
      pc++;
    }
    if (to_date) {
      dateFilter += ` AND v.voucher_date <= $${pc}`;
      params.push(to_date);
      pc++;
    }

    // Get account info
    const accountResult = await query('SELECT * FROM bank_accounts WHERE id = $1', [id]);
    if (accountResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    // Get all vouchers for this account
    const result = await query(`
      SELECT v.*,
             CASE WHEN v.debit_account_id = $1 THEN v.amount ELSE 0 END as debit_amount,
             CASE WHEN v.credit_account_id = $2 THEN v.amount ELSE 0 END as credit_amount,
             u.full_name as created_by_name
      FROM vouchers v
      LEFT JOIN users u ON v.created_by = u.id
      WHERE (v.debit_account_id = $1 OR v.credit_account_id = $2)
        AND v.status = 'posted'
        ${dateFilter}
      ORDER BY v.voucher_date ASC, v.created_at ASC
    `, params);

    // Calculate running balance
    let runningBalance = accountResult.rows[0].opening_balance || 0;
    const entries = result.rows.map(row => {
      runningBalance += (row.debit_amount || 0) - (row.credit_amount || 0);
      return { ...row, running_balance: runningBalance };
    });

    res.json({
      success: true,
      data: {
        account: accountResult.rows[0],
        entries,
        closing_balance: runningBalance
      }
    });
  } catch (error) {
    logError(error, req, { feature: 'bank-accounts' });
    res.status(500).json({ success: false, message: 'Failed to fetch account statement' });
  }
});

module.exports = router;
