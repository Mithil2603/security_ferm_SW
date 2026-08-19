const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);

// All users can read vendors (for dropdowns)
router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT * FROM vendors WHERE is_active = 1 ORDER BY name ASC');
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'vendors' });
    logger.error('Get vendors error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch vendors' });
  }
});

// Require manage_expenses for modifying vendors
router.use(requirePermission('manage_expenses'));

router.post('/', async (req, res) => {
  try {
    const { name, contact_info, payment_terms_days } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name is required' });

    const result = await query(
      'INSERT INTO vendors (name, contact_info, payment_terms_days) VALUES ($1, $2, $3) RETURNING *',
      [name, contact_info, payment_terms_days || 0]
    );
    res.status(201).json({ success: true, data: result.rows[0], message: 'Vendor created successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'vendors' });
    logger.error('Create vendor error:', error);
    res.status(500).json({ success: false, message: 'Failed to create vendor' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, contact_info, is_active, payment_terms_days } = req.body;
    const result = await query(
      'UPDATE vendors SET name=$1, contact_info=$2, is_active=$3, payment_terms_days=$4, updated_at=CURRENT_TIMESTAMP WHERE id=$5',
      [name, contact_info, is_active !== undefined ? is_active : 1, payment_terms_days || 0, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Vendor not found' });
    
    const updated = await query('SELECT * FROM vendors WHERE id=$1', [req.params.id]);
    res.json({ success: true, data: updated.rows[0], message: 'Vendor updated successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'vendors' });
    logger.error('Update vendor error:', error);
    res.status(500).json({ success: false, message: 'Failed to update vendor' });
  }
});
// GET /api/vendors/:id/statement
router.get('/:id/statement', async (req, res) => {
  try {
    const vendorId = req.params.id;

    // Fetch vendor details
    const vendorRes = await query('SELECT * FROM vendors WHERE id = $1', [vendorId]);
    if (vendorRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    const vendor = vendorRes.rows[0];

    // Fetch expenses linked to this vendor
    const expensesRes = await query(`
      SELECT * FROM expenses 
      WHERE vendor_id = $1 
      ORDER BY expense_date DESC, created_at DESC
    `, [vendorId]);

    const expenses = expensesRes.rows;

    // Calculate totals
    // Total Billed = sum of all expenses (perhaps only non-rejected ones?)
    // Let's include pending, approved, paid
    let totalBilled = 0;
    let totalPaid = 0;

    expenses.forEach(exp => {
      if (exp.status !== 'rejected') {
        totalBilled += parseFloat(exp.amount) || 0;
        totalPaid += parseFloat(exp.amount_paid) || 0;
      }
    });

    // Also fetch payment history if we want
    const paymentsRes = await query(`
      SELECT vp.*, e.description as expense_description, e.expense_date
      FROM vendor_payments vp
      LEFT JOIN expenses e ON vp.expense_id = e.id
      WHERE vp.vendor_id = $1
      ORDER BY vp.payment_date DESC, vp.created_at DESC
    `, [vendorId]);

    res.json({
      success: true,
      data: {
        vendor,
        total_billed: totalBilled,
        total_paid: totalPaid,
        balance_due: totalBilled - totalPaid,
        expenses,
        payments: paymentsRes.rows
      }
    });

  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'vendors' });
    logger.error('Get vendor statement error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch vendor statement' });
  }
});

module.exports = router;
