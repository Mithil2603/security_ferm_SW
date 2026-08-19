const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requirePermission('manage_expenses'));

// GET /api/recurring-expenses
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT r.*, v.name as vendor_name, u.full_name as created_by_name
      FROM recurring_expenses r
      LEFT JOIN vendors v ON r.vendor_id = v.id
      LEFT JOIN users u ON r.created_by = u.id
      ORDER BY r.next_run_date ASC
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'recurring_expenses' });
    logger.error('Get recurring expenses error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch recurring expenses' });
  }
});

// POST /api/recurring-expenses
router.post('/', async (req, res) => {
  try {
    // Accept 'description' as alias for 'title'
    const title = req.body.title || req.body.description;
    const { category, amount, vendor_id, payment_method, frequency, next_run_date } = req.body;
    
    if (!title || !category || !amount || !frequency || !next_run_date) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const result = await query(
      `INSERT INTO recurring_expenses (title, category, amount, vendor_id, payment_method, frequency, next_run_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [title, category, amount, vendor_id || null, payment_method || 'bank_transfer', frequency, next_run_date, req.user.userId]
    );
    
    res.status(201).json({ success: true, data: result.rows[0], message: 'Recurring expense created' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'recurring_expenses' });
    logger.error('Create recurring expense error:', error);
    res.status(500).json({ success: false, message: 'Failed to create recurring expense' });
  }
});

// PUT /api/recurring-expenses/:id/toggle
router.put('/:id/toggle', async (req, res) => {
  try {
    const check = await query('SELECT is_active FROM recurring_expenses WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
    
    const newStatus = check.rows[0].is_active ? 0 : 1;
    await query('UPDATE recurring_expenses SET is_active = $1 WHERE id = $2', [newStatus, req.params.id]);
    
    res.json({ success: true, message: `Recurring expense ${newStatus ? 'activated' : 'paused'}` });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'recurring_expenses' });
    res.status(500).json({ success: false, message: 'Failed to toggle status' });
  }
});

// DELETE /api/recurring-expenses/:id
router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM recurring_expenses WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Deleted successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'recurring_expenses' });
    res.status(500).json({ success: false, message: 'Failed to delete recurring expense' });
  }
});

module.exports = router;
