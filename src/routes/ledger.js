const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const Joi = require('joi');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requirePermission('manage_payroll'));

// Validation schema
const ledgerSchema = Joi.object({
  employee_id: Joi.number().integer().positive().required(),
  transaction_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  type: Joi.string().valid('addition', 'deduction').required(),
  category: Joi.string().min(1).max(100).required(),
  amount: Joi.number().positive().precision(2).required(),
  description: Joi.string().allow('', null).optional()
});

// GET /api/ledger - Get ledger entries (optional filters: employee_id, status(settled/unsettled))
router.get('/', async (req, res) => {
  try {
    const { employee_id, status } = req.query;
    let conditions = [];
    let params = [];
    let pc = 1;

    if (employee_id) {
      conditions.push(`l.employee_id = $${pc}`);
      params.push(employee_id);
      pc++;
    }
    
    if (status === 'settled') {
      conditions.push(`l.payroll_id IS NOT NULL AND p.payment_status = 'paid'`);
    } else if (status === 'unsettled') {
      conditions.push(`(l.payroll_id IS NULL OR p.payment_status = 'pending')`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT l.*, e.full_name as employee_name, e.employee_id as emp_id,
              p.payment_status, p.payroll_month
       FROM employee_ledger l
       JOIN employees e ON l.employee_id = e.id
       LEFT JOIN payroll p ON l.payroll_id = p.id
       ${where}
       ORDER BY l.transaction_date DESC, l.created_at DESC`,
      params
    );

    // Group by employee to calculate unsettled balances if looking generally
    const balancesResult = await query(
      `SELECT l.employee_id, 
              SUM(CASE WHEN l.type = 'addition' THEN l.amount ELSE 0 END) as total_additions,
              SUM(CASE WHEN l.type = 'deduction' THEN l.amount ELSE 0 END) as total_deductions
       FROM employee_ledger l
       LEFT JOIN payroll p ON l.payroll_id = p.id
       WHERE (l.payroll_id IS NULL OR p.payment_status = 'pending')
       GROUP BY l.employee_id`
    );

    res.json({
      success: true,
      data: result.rows,
      balances: balancesResult.rows
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'ledger' });
    logger.error('Fetch ledger error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch ledger entries' });
  }
});

// POST /api/ledger - Add a new transaction
router.post('/', async (req, res) => {
  try {
    const { error, value } = ledgerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { employee_id, transaction_date, type, category, amount, description } = value;

    // Verify employee exists
    const empCheck = await query('SELECT id FROM employees WHERE id = $1 AND is_active = 1', [employee_id]);
    if (empCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found or inactive' });
    }

    const result = await query(
      `INSERT INTO employee_ledger (employee_id, transaction_date, type, category, amount, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [employee_id, transaction_date, type, category, amount, description, req.user.userId]
    );

    res.status(201).json({ success: true, data: result.rows[0], message: 'Transaction recorded successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'ledger' });
    logger.error('Add ledger error:', error);
    res.status(500).json({ success: false, message: 'Failed to record transaction' });
  }
});

// DELETE /api/ledger/:id - Delete an unsettled transaction
router.delete('/:id', async (req, res) => {
  try {
    const check = await query('SELECT payroll_id FROM employee_ledger WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    if (check.rows[0].payroll_id !== null) {
      return res.status(400).json({ success: false, message: 'Cannot delete a settled transaction' });
    }

    await query('DELETE FROM employee_ledger WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Transaction deleted successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'ledger' });
    logger.error('Delete ledger error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete transaction' });
  }
});

module.exports = router;
