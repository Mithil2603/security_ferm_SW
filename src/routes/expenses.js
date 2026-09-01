const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validators');
const { saveStatement } = require('../utils/statementSaver');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { logError } = require('../utils/errorLogger');

const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `expense_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.xlsx'];
    if (allowedMimes.includes((file.mimetype || '').toLowerCase()) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPG, PNG, WEBP, and XLSX receipts are allowed.'));
    }
  }
});

router.use(authMiddleware);
router.use(requirePermission('manage_expenses'));

// GET /api/expenses
router.get('/', async (req, res) => {
  try {
    const { category, status, from_date, to_date, page = 1, limit = 50 } = req.query;
    let conditions = [];
    let params = [];
    let pc = 1;

    if (category) { conditions.push(`e.category = $${pc}`); params.push(category); pc++; }
    if (status) { conditions.push(`e.status = $${pc}`); params.push(status); pc++; }
    if (from_date) { conditions.push(`e.expense_date >= $${pc}`); params.push(from_date); pc++; }
    if (to_date) { conditions.push(`e.expense_date <= $${pc}`); params.push(to_date); pc++; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT e.*, u.full_name as created_by_name, a.full_name as approver_name, v.name as vendor_name
       FROM expenses e
       LEFT JOIN users u ON e.created_by = u.id
       LEFT JOIN users a ON e.approver_id = a.id
       LEFT JOIN vendors v ON e.vendor_id = v.id
       ${where}
       ORDER BY e.expense_date DESC, e.created_at DESC
       LIMIT $${pc} OFFSET $${pc + 1}`,
      [...params, parseInt(limit), offset]
    );

    const countResult = await query(`SELECT COUNT(*) AS count FROM expenses e ${where}`, params);
    const sumResult = await query(`SELECT COALESCE(SUM(amount), 0) as total FROM expenses e ${where}`, params);

    const totalCount = parseInt(countResult.rows[0]?.count || 0);
    const limitNum = parseInt(limit) || 20;
    const pageNum = parseInt(page) || 1;
    const totalPages = Math.ceil(totalCount / limitNum) || 1;

    res.json({
      success: true,
      data: result.rows,
      total_amount: parseFloat(sumResult.rows[0]?.total || 0),
      pagination: { total: totalCount, page: pageNum, limit: limitNum, pages: totalPages }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'expenses' });
    logger.error('Get expenses error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch expenses' });
  }
});

// GET /api/expenses/categories
router.get('/categories', async (req, res) => {
  try {
    const result = await query('SELECT * FROM expense_categories WHERE is_active = 1 ORDER BY name ASC');
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'expenses' });
    logger.error('Get expense categories error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch categories' });
  }
});

// POST /api/expenses/categories
router.post('/categories', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Category name is required' });
    const result = await query(
      'INSERT INTO expense_categories (name) VALUES ($1) RETURNING *',
      [name.toLowerCase().replace(/\s+/g, '_')]
    );
    res.status(201).json({ success: true, data: result.rows[0], message: 'Category added' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'expenses' });
    if (error.code === 'ER_DUP_ENTRY' || (error.message && error.message.includes('UNIQUE constraint failed'))) {
      return res.status(400).json({ success: false, message: 'Category already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to add category' });
  }
});

// DELETE /api/expenses/categories/:id
router.delete('/categories/:id', requirePermission('manage_expenses'), async (req, res) => {
  try {
    const result = await query('UPDATE expense_categories SET is_active = 0 WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Category not found' });
    
    const updated = await query('SELECT * FROM expense_categories WHERE id = $1', [req.params.id]);
    res.json({ success: true, data: updated.rows[0], message: 'Category deactivated successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'expenses' });
    res.status(500).json({ success: false, message: 'Failed to delete category' });
  }
});

// GET /api/expenses/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT e.*, u.full_name as created_by_name, a.full_name as approver_name, v.name as vendor_name
       FROM expenses e
       LEFT JOIN users u ON e.created_by = u.id
       LEFT JOIN users a ON e.approver_id = a.id
       LEFT JOIN vendors v ON e.vendor_id = v.id
       WHERE e.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'expenses' });
    res.status(500).json({ success: false, message: 'Failed to fetch expense' });
  }
});

// POST /api/expenses
router.post('/', upload.single('receipt_file'), validate(schemas.createExpense), async (req, res) => {
  try {
    const { expense_date, description, amount, payment_method, vendor_id, receipt_number, notes } = req.body;
    let { category } = req.body;
    
    // Normalize category
    if (category) category = category.trim().toLowerCase().replace(/\s+/g, '_');
    
    let receipt_url = req.file ? `/uploads/${req.file.filename}` : null;

    if (!expense_date || !category || !description || !amount || !payment_method) {
      return res.status(400).json({ success: false, message: 'Date, category, description, amount, and payment method are required' });
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be a positive number' });
    }

    const parsedVendorId = vendor_id && !isNaN(parseInt(vendor_id)) && parseInt(vendor_id) > 0 ? parseInt(vendor_id) : null;
    const parsedReceiptNo = receipt_number ? String(receipt_number).trim() : null;
    const parsedNotes = notes ? String(notes).trim() : null;

    const result = await query(
      `INSERT INTO expenses (expense_date, category, description, amount, payment_method, vendor_id, receipt_number, notes, receipt_url, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [expense_date, category, description, parsedAmount, payment_method, parsedVendorId, parsedReceiptNo, parsedNotes, receipt_url, req.user.userId]
    );

    res.status(201).json({ success: true, data: result.rows[0], message: 'Expense recorded successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'expenses' });
    logger.error('Create expense error:', error);
    res.status(500).json({ success: false, message: 'Failed to create expense: ' + (error.message || '') });
  }
});

// PUT /api/expenses/:id
router.put('/:id', upload.single('receipt_file'), async (req, res) => {
  try {
    const { expense_date, description, amount, payment_method, vendor_id, receipt_number, notes } = req.body;
    let { category } = req.body;
    
    // Normalize category
    if (category) category = category.trim().toLowerCase().replace(/\s+/g, '_');

    let receipt_url = req.file ? `/uploads/${req.file.filename}` : null;
    
    const parsedVendorId = vendor_id && !isNaN(parseInt(vendor_id)) && parseInt(vendor_id) > 0 ? parseInt(vendor_id) : null;
    const parsedAmount = parseFloat(amount);
    const parsedReceiptNo = receipt_number ? String(receipt_number).trim() : null;
    const parsedNotes = notes ? String(notes).trim() : null;

    let updateQuery, params;
    if (receipt_url) {
      updateQuery = `UPDATE expenses SET expense_date=$1, category=$2, description=$3, amount=$4, payment_method=$5,
        vendor_id=$6, receipt_number=$7, notes=$8, receipt_url=$9 WHERE id=$10 AND status='pending'`;
      params = [expense_date, category, description, parsedAmount, payment_method, parsedVendorId, parsedReceiptNo, parsedNotes, receipt_url, req.params.id];
    } else {
      updateQuery = `UPDATE expenses SET expense_date=$1, category=$2, description=$3, amount=$4, payment_method=$5,
        vendor_id=$6, receipt_number=$7, notes=$8 WHERE id=$9 AND status='pending'`;
      params = [expense_date, category, description, parsedAmount, payment_method, parsedVendorId, parsedReceiptNo, parsedNotes, req.params.id];
    }

    const result = await query(updateQuery, params);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Expense not found or cannot be edited (only pending expenses can be edited)' });
    }
    const updated = await query('SELECT * FROM expenses WHERE id = $1', [req.params.id]);
    res.json({ success: true, data: updated.rows[0], message: 'Expense updated successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'expenses' });
    res.status(500).json({ success: false, message: 'Failed to update expense' });
  }
});

// PUT /api/expenses/:id/approve
router.put('/:id/approve', async (req, res) => {
  try {
    const { approval_notes } = req.body;
    const result = await query(
      `UPDATE expenses SET status='approved', approver_id=$1, approval_date=CURRENT_TIMESTAMP, approval_notes=$2
       WHERE id=$3 AND status='pending'`,
      [req.user.userId, approval_notes, req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Expense not found or already processed' });
    }
    const updated = await query(
      `SELECT e.*, v.name as vendor_name FROM expenses e LEFT JOIN vendors v ON e.vendor_id = v.id WHERE e.id = $1`,
      [req.params.id]
    );
    const exp = updated.rows[0];

    // Auto-save Vendor statement on approval
    saveStatement({
      domain: 'vendor',
      statement_number: `VS-${(exp.vendor_name || 'Unknown').replace(/\s+/g, '_')}-${exp.expense_date}`,
      title: `Vendor Expense Approved: ${exp.vendor_name || 'Unknown'} - ${exp.description}`,
      reference_id: exp.id,
      reference_type: 'expense_approved',
      statement_data: exp,
      total_amount: parseFloat(exp.amount),
      party_name: exp.vendor_name || 'Unknown',
      party_id: exp.vendor_id,
      generated_by: req.user.userId
    });

    res.json({ success: true, data: exp, message: 'Expense approved' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'expenses' });
    res.status(500).json({ success: false, message: 'Failed to approve expense' });
  }
});

// PUT /api/expenses/:id/reject
router.put('/:id/reject', async (req, res) => {
  try {
    const { approval_notes } = req.body;
    const result = await query(
      `UPDATE expenses SET status='rejected', approver_id=$1, approval_date=CURRENT_TIMESTAMP, approval_notes=$2
       WHERE id=$3 AND status='pending'`,
      [req.user.userId, approval_notes, req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Expense not found or already processed' });
    }
    const updated = await query('SELECT * FROM expenses WHERE id = $1', [req.params.id]);
    res.json({ success: true, data: updated.rows[0], message: 'Expense rejected' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'expenses' });
    res.status(500).json({ success: false, message: 'Failed to reject expense' });
  }
});

// DELETE /api/expenses/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await query(
      "DELETE FROM expenses WHERE id = $1 AND status = 'pending'",
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Expense not found or cannot be deleted' });
    }
    res.json({ success: true, message: 'Expense deleted successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'expenses' });
    res.status(500).json({ success: false, message: 'Failed to delete expense' });
  }
});

// POST /api/expenses/:id/pay
router.post('/:id/pay', async (req, res) => {
  try {
    const { amount, payment_method, payment_date, reference_number, notes } = req.body;
    const paymentAmount = parseFloat(amount);

    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid payment amount' });
    }

    // 1. Get the expense to check current balance
    const expRes = await query('SELECT * FROM expenses WHERE id = $1', [req.params.id]);
    if (expRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }
    const expense = expRes.rows[0];

    // Allowed to pay if status is pending, approved, or partially_paid?
    // Wait, the status is restricted to pending, approved, rejected, paid. 
    // We can just check if it's already fully paid.
    if (expense.status === 'paid') {
      return res.status(400).json({ success: false, message: 'Expense is already fully paid' });
    }

    const currentPaid = parseFloat(expense.amount_paid) || 0;
    const newPaid = currentPaid + paymentAmount;
    
    // Check if fully paid (or overpaid, but we just cap status)
    let newStatus = expense.status; // Keep it whatever it is (e.g. pending or approved)
    if (newPaid >= parseFloat(expense.amount)) {
      newStatus = 'paid';
    }

    // Begin Transaction manually since we don't have a transaction helper, but await queries sequentially is okay for now
    
    // 2. Insert into vendor_payments
    await query(
      `INSERT INTO vendor_payments (vendor_id, expense_id, payment_date, amount, payment_method, reference_number, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [expense.vendor_id, expense.id, payment_date || new Date().toISOString().split('T')[0], paymentAmount, payment_method || 'bank_transfer', reference_number, notes, req.user.userId]
    );

    // 3. Update expense
    const result = await query(
      `UPDATE expenses SET amount_paid = $1, status = $2 WHERE id = $3`,
      [newPaid, newStatus, expense.id]
    );
    const updated = await query('SELECT * FROM expenses WHERE id = $1', [expense.id]);
    const finalExpense = updated.rows[0];

    // Get vendor name for statement
    const vendorRes = await query('SELECT name FROM vendors WHERE id = $1', [expense.vendor_id]);
    const vendorName = vendorRes.rows.length > 0 ? vendorRes.rows[0].name : (expense.vendor_name || 'Unknown');
    const payDate = payment_date || new Date().toISOString().split('T')[0];

    // Auto-save Vendor Payment statement
    saveStatement({
      domain: 'vendor',
      statement_number: `VP-${vendorName.replace(/\s+/g, '_')}-${payDate}`,
      title: `Vendor Payment: ${vendorName} - ₹${paymentAmount.toLocaleString()}`,
      reference_id: expense.id,
      reference_type: 'vendor_payment',
      statement_data: {
        expense_id: expense.id, vendor_name: vendorName, description: expense.description,
        category: expense.category, expense_amount: parseFloat(expense.amount),
        payment_amount: paymentAmount, total_paid: newPaid, payment_method: payment_method || 'bank_transfer',
        reference_number, payment_date: payDate, status: newStatus
      },
      total_amount: paymentAmount,
      party_name: vendorName,
      party_id: expense.vendor_id,
      generated_by: req.user.userId
    });

    res.json({ success: true, data: finalExpense, message: 'Payment recorded successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'expenses' });
    logger.error('Pay expense error:', error);
    res.status(500).json({ success: false, message: 'Failed to record payment' });
  }
});

module.exports = router;
