const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query, pool } = require('../database/connection');
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
  amount: Joi.number().positive().min(0.01).precision(2).required(), // H4: explicit min
  description: Joi.string().allow('', null).optional()
});

// C1, H6: Separate endpoint for balances
router.get('/balances', async (req, res) => {
  try {
    const balancesResult = await query(
      `SELECT l.employee_id, 
              SUM(CASE WHEN l.type = 'addition' THEN l.amount ELSE 0 END) as total_additions,
              SUM(CASE WHEN l.type = 'deduction' THEN l.amount ELSE 0 END) as total_deductions
       FROM employee_ledger l
       LEFT JOIN payroll p ON l.payroll_id = p.id
       WHERE (l.payroll_id IS NULL OR p.payment_status != 'paid' OR p.payment_status IS NULL)
       GROUP BY l.employee_id`
    );
    res.json({ success: true, balances: balancesResult.rows });
  } catch (error) {
    logger.error('Fetch ledger balances error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch ledger balances' });
  }
});

// GET /api/ledger - Get ledger entries
router.get('/', async (req, res) => {
  try {
    const { employee_id, status, transaction_date_from, transaction_date_to, sort, limit, offset } = req.query;
    let conditions = [];
    let params = [];
    let pc = 1;

    if (employee_id) {
      conditions.push(`l.employee_id = $${pc++}`);
      params.push(employee_id);
    }
    
    // C2, H1, H8: Case-insensitive status filter and null safety
    const lcStatus = status?.toLowerCase();
    if (lcStatus === 'settled') {
      conditions.push(`l.payroll_id IS NOT NULL AND p.payment_status = 'paid'`);
    } else if (lcStatus === 'unsettled') {
      conditions.push(`(l.payroll_id IS NULL OR p.payment_status != 'paid' OR p.payment_status IS NULL)`);
    }

    // L7: Date filtering
    if (transaction_date_from) {
      conditions.push(`l.transaction_date >= $${pc++}`);
      params.push(transaction_date_from);
    }
    if (transaction_date_to) {
      conditions.push(`l.transaction_date <= $${pc++}`);
      params.push(transaction_date_to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // M2: Dynamic sorting
    let orderBy = 'ORDER BY l.transaction_date DESC, l.created_at DESC';
    if (sort === 'amount') orderBy = 'ORDER BY l.amount DESC';
    else if (sort === 'category') orderBy = 'ORDER BY l.category ASC';
    else if (sort === 'employee') orderBy = 'ORDER BY e.full_name ASC';

    // L4: Pagination
    let limitOffset = '';
    if (limit) {
      limitOffset = `LIMIT $${pc++}`;
      params.push(parseInt(limit));
      if (offset) {
        limitOffset += ` OFFSET $${pc++}`;
        params.push(parseInt(offset));
      }
    }

    // L1: Explicit SELECT columns
    const result = await query(
      `SELECT l.id, l.employee_id, l.transaction_date, l.type, l.category, l.amount, l.description, l.payroll_id,
              e.full_name as employee_name, e.employee_id as emp_id,
              p.payment_status, p.payroll_month
       FROM employee_ledger l
       JOIN employees e ON l.employee_id = e.id
       LEFT JOIN payroll p ON l.payroll_id = p.id
       ${where}
       ${orderBy}
       ${limitOffset}`,
      params
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'ledger' });
    logger.error('Fetch ledger error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch ledger entries' });
  }
});

// POST /api/ledger - Add a new transaction
router.post('/', async (req, res) => {
  let conn;
  try {
    const { error, value } = ledgerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { employee_id, transaction_date, type, category, amount, description } = value;

    // H3: Future date validation
    if (new Date(transaction_date) > new Date()) {
      return res.status(400).json({ success: false, message: 'Transaction date cannot be in the future' });
    }

    // C5: Race condition protection via transaction
    conn = await pool.getConnection();
    await conn.query('START TRANSACTION');

    const [empCheck] = await conn.query('SELECT id FROM employees WHERE id = ? AND is_active = 1 FOR UPDATE', [employee_id]);
    if (empCheck.length === 0) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Employee not found or inactive' });
    }

    const [result] = await conn.query(
      `INSERT INTO employee_ledger (employee_id, transaction_date, type, category, amount, description, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [employee_id, transaction_date, type, category, amount, description, req.user.userId]
    );

    const [newEntry] = await conn.query('SELECT * FROM employee_ledger WHERE id = ?', [result.insertId]);

    await conn.query('COMMIT');
    res.status(201).json({ success: true, data: newEntry[0], message: 'Transaction recorded successfully' });
  } catch (error) {
    if (conn) await conn.query('ROLLBACK');
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'ledger' });
    logger.error('Add ledger error:', error);
    res.status(500).json({ success: false, message: 'Failed to record transaction' });
  } finally {
    if (conn) conn.release();
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
    // M4: Log deletion
    logger.info(`Ledger transaction ${req.params.id} deleted by user ${req.user.userId}`);
    
    res.json({ success: true, message: 'Transaction deleted successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'ledger' });
    logger.error('Delete ledger error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete transaction' });
  }
});

module.exports = router;
