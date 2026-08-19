const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const Joi = require('joi');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requirePermission('manage_vouchers'));

// ─── Voucher Type Prefixes ──────────────────────────────────────────────────
const VOUCHER_PREFIXES = {
  cash_payment: 'CP',
  cash_receipt: 'CR',
  bank_payment: 'BP',
  bank_receipt: 'BR',
  journal: 'JV',
  contra: 'CT',
  debit_note: 'DN',
  credit_note: 'CN',
  // Common aliases
  payment: 'BP',      // alias for bank_payment
  receipt: 'BR',      // alias for bank_receipt
};

const VOUCHER_TYPE_LABELS = {
  cash_payment: 'Cash Payment',
  cash_receipt: 'Cash Receipt',
  bank_payment: 'Bank Payment',
  bank_receipt: 'Bank Receipt',
  journal: 'Journal Entry',
  contra: 'Contra',
  debit_note: 'Debit Note',
  credit_note: 'Credit Note'
};

// ─── Validation ─────────────────────────────────────────────────────────────
const voucherSchema = Joi.object({
  voucher_type: Joi.string().valid(
    'cash_payment', 'cash_receipt', 'bank_payment', 'bank_receipt',
    'journal', 'contra', 'debit_note', 'credit_note',
    'payment', 'receipt'  // common aliases
  ).required(),
  voucher_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  amount: Joi.number().positive().precision(2).required(),
  debit_account_id: Joi.number().integer().positive().allow(null).optional(),
  credit_account_id: Joi.number().integer().positive().allow(null).optional(),
  party_type: Joi.string().valid('client', 'employee', 'vendor', 'other').allow(null, '').optional(),
  party_id: Joi.number().integer().positive().allow(null).optional(),
  party_name: Joi.string().max(255).allow('', null).optional(),
  reference_type: Joi.string().valid('invoice', 'expense', 'payroll', 'none').allow(null, '').optional(),
  reference_id: Joi.number().integer().positive().allow(null).optional(),
  narration: Joi.string().allow('', null).optional(),
  description: Joi.string().allow('', null).optional(),  // alias for narration
  cheque_number: Joi.string().max(50).allow('', null).optional(),
  cheque_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow('', null).optional(),
  transaction_ref: Joi.string().max(100).allow('', null).optional(),
  category: Joi.string().max(100).allow('', null).optional()
});

// ─── Helper: Get Indian Financial Year string ───────────────────────────────
function getFinancialYear(dateStr) {
  const d = new Date(dateStr);
  const month = d.getMonth(); // 0-indexed
  const year = d.getFullYear();
  if (month >= 3) {
    return `${year}-${String(year + 1).slice(2)}`;
  }
  return `${year - 1}-${String(year).slice(2)}`;
}

// ─── Helper: Generate next voucher number ───────────────────────────────────
async function getNextVoucherNumber(voucherType, voucherDate) {
  const fy = getFinancialYear(voucherDate);
  const prefix = VOUCHER_PREFIXES[voucherType];

  // Upsert the counter
  await query(`
    INSERT INTO voucher_counters (voucher_type, financial_year, last_number)
    VALUES ($1, $2, 0)
    ON CONFLICT DO NOTHING
  `, [voucherType, fy]);

  // Increment
  await query(`
    UPDATE voucher_counters
    SET last_number = last_number + 1
    WHERE voucher_type = $1 AND financial_year = $2
  `, [voucherType, fy]);

  // Return
  const result = await query(`
    SELECT last_number
    FROM voucher_counters
    WHERE voucher_type = $1 AND financial_year = $2
  `, [voucherType, fy]);

  const num = result.rows[0].last_number;
  return `${prefix}/${fy}/${String(num).padStart(4, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/vouchers — List vouchers with filters
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { voucher_type, status, from_date, to_date, party_type, party_id, search, limit = 100, offset = 0 } = req.query;

    let conditions = [];
    let params = [];
    let pc = 1;

    if (voucher_type) {
      conditions.push(`v.voucher_type = $${pc}`);
      params.push(voucher_type);
      pc++;
    }
    if (status) {
      conditions.push(`v.status = $${pc}`);
      params.push(status);
      pc++;
    }
    if (from_date) {
      conditions.push(`v.voucher_date >= $${pc}`);
      params.push(from_date);
      pc++;
    }
    if (to_date) {
      conditions.push(`v.voucher_date <= $${pc}`);
      params.push(to_date);
      pc++;
    }
    if (party_type) {
      conditions.push(`v.party_type = $${pc}`);
      params.push(party_type);
      pc++;
    }
    if (party_id) {
      conditions.push(`v.party_id = $${pc}`);
      params.push(party_id);
      pc++;
    }
    if (search) {
      conditions.push(`(v.voucher_number LIKE $${pc} OR v.party_name LIKE $${pc} OR v.narration LIKE $${pc})`);
      params.push(`%${search}%`);
      pc++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await query(`SELECT COUNT(*) as total FROM vouchers v ${where}`, params);

    // Get vouchers with joined account names
    const result = await query(`
      SELECT v.*,
             da.account_name as debit_account_name,
             ca.account_name as credit_account_name,
             cu.full_name as created_by_name,
             au.full_name as approved_by_name
      FROM vouchers v
      LEFT JOIN bank_accounts da ON v.debit_account_id = da.id
      LEFT JOIN bank_accounts ca ON v.credit_account_id = ca.id
      LEFT JOIN users cu ON v.created_by = cu.id
      LEFT JOIN users au ON v.approved_by = au.id
      ${where}
      ORDER BY v.voucher_date DESC, v.created_at DESC
      LIMIT $${pc} OFFSET $${pc + 1}
    `, [...params, limit, offset]);

    res.json({
      success: true,
      data: result.rows,
      total: countResult.rows[0].total,
      type_labels: VOUCHER_TYPE_LABELS
    });
  } catch (error) {
    logError(error, req, { feature: 'vouchers' });
    logger.error('Fetch vouchers error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch vouchers' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/vouchers/summary — Dashboard summary
// ─────────────────────────────────────────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const now = new Date();
    const fyStart = now.getMonth() >= 3 ? `${now.getFullYear()}-04-01` : `${now.getFullYear() - 1}-04-01`;
    const fromDate = from_date || fyStart;
    const toDate = to_date || now.toISOString().split('T')[0];

    const result = await query(`
      SELECT voucher_type,
             COUNT(*) as count,
             SUM(amount) as total_amount,
             SUM(CASE WHEN status = 'posted' THEN amount ELSE 0 END) as posted_amount,
             SUM(CASE WHEN status = 'pending_approval' THEN amount ELSE 0 END) as pending_amount,
             SUM(CASE WHEN status = 'draft' THEN amount ELSE 0 END) as draft_amount
      FROM vouchers
      WHERE voucher_date >= $1 AND voucher_date <= $2
        AND status != 'cancelled'
      GROUP BY voucher_type
      ORDER BY voucher_type
    `, [fromDate, toDate]);

    // Pending approval count for badge
    const pendingResult = await query(`
      SELECT COUNT(*) as pending_count
      FROM vouchers
      WHERE status = 'pending_approval'
    `);

    res.json({
      success: true,
      data: {
        by_type: result.rows,
        pending_approval_count: pendingResult.rows[0].pending_count,
        period: { from: fromDate, to: toDate }
      },
      type_labels: VOUCHER_TYPE_LABELS
    });
  } catch (error) {
    logError(error, req, { feature: 'vouchers' });
    res.status(500).json({ success: false, message: 'Failed to fetch voucher summary' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/vouchers/next-number/:type — Preview next voucher number
// ─────────────────────────────────────────────────────────────────────────────
router.get('/next-number/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { date } = req.query;

    if (!VOUCHER_PREFIXES[type]) {
      return res.status(400).json({ success: false, message: 'Invalid voucher type' });
    }

    const voucherDate = date || new Date().toISOString().split('T')[0];
    const fy = getFinancialYear(voucherDate);
    const prefix = VOUCHER_PREFIXES[type];

    // Get current counter without incrementing
    const result = await query(`
      SELECT last_number FROM voucher_counters
      WHERE voucher_type = $1 AND financial_year = $2
    `, [type, fy]);

    const nextNum = (result.rows.length > 0 ? result.rows[0].last_number : 0) + 1;
    const nextNumber = `${prefix}/${fy}/${String(nextNum).padStart(4, '0')}`;

    res.json({ success: true, data: { next_number: nextNumber, financial_year: fy } });
  } catch (error) {
    logError(error, req, { feature: 'vouchers' });
    res.status(500).json({ success: false, message: 'Failed to get next voucher number' });
  }
});
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/vouchers/aging — Get aging report for vendors
// ─────────────────────────────────────────────────────────────────────────────
router.get('/aging', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT 
        v.id, v.voucher_number, v.voucher_date, v.amount, v.due_date,
        v.party_id, v.party_name,
        CAST(julianday('now') - julianday(v.due_date) AS INTEGER) as days_overdue
      FROM vouchers v
      WHERE v.party_type = 'vendor' 
        AND v.status = 'posted'
        AND v.due_date IS NOT NULL
        AND v.due_date < date('now')
      ORDER BY days_overdue DESC
    `);
    
    // Group by aging buckets
    const aging = {
      '1_to_30': [],
      '31_to_60': [],
      '61_to_90': [],
      'over_90': []
    };
    
    result.rows.forEach(row => {
      if (row.days_overdue <= 30) aging['1_to_30'].push(row);
      else if (row.days_overdue <= 60) aging['31_to_60'].push(row);
      else if (row.days_overdue <= 90) aging['61_to_90'].push(row);
      else aging['over_90'].push(row);
    });

    res.json({ success: true, data: aging });
  } catch (error) {
    logger.error('Error fetching aging report:', error);
    next(error);
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/vouchers/:id — Get single voucher
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT v.*,
             da.account_name as debit_account_name,
             ca.account_name as credit_account_name,
             cu.full_name as created_by_name,
             au.full_name as approved_by_name
      FROM vouchers v
      LEFT JOIN bank_accounts da ON v.debit_account_id = da.id
      LEFT JOIN bank_accounts ca ON v.credit_account_id = ca.id
      LEFT JOIN users cu ON v.created_by = cu.id
      LEFT JOIN users au ON v.approved_by = au.id
      WHERE v.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Voucher not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError(error, req, { feature: 'vouchers' });
    res.status(500).json({ success: false, message: 'Failed to fetch voucher' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/vouchers — Create a new voucher
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { error, value } = voucherSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const {
      voucher_date, amount,
      debit_account_id, credit_account_id,
      party_type, party_id, party_name,
      reference_type, reference_id,
      narration, cheque_number, cheque_date, transaction_ref, category
    } = value;

    // Normalize alias types to canonical types
    const TYPE_ALIASES = { payment: 'bank_payment', receipt: 'bank_receipt' };
    const voucher_type = TYPE_ALIASES[value.voucher_type] || value.voucher_type;

    // Validate accounts exist
    if (debit_account_id) {
      const da = await query('SELECT id FROM bank_accounts WHERE id = $1 AND is_active = 1', [debit_account_id]);
      if (da.rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Debit account not found or inactive' });
      }
    }
    if (credit_account_id) {
      const ca = await query('SELECT id FROM bank_accounts WHERE id = $1 AND is_active = 1', [credit_account_id]);
      if (ca.rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Credit account not found or inactive' });
      }
    }

    // Generate voucher number
    const voucher_number = await getNextVoucherNumber(voucher_type, voucher_date);

    // Initial status: pending_approval (approval workflow enabled)
    const initialStatus = 'pending_approval';

    // Calculate due_date if vendor
    let due_date = null;
    if (party_type === 'vendor' && party_id) {
      const vendorRes = await query('SELECT payment_terms_days FROM vendors WHERE id = $1', [party_id]);
      if (vendorRes.rows.length > 0 && vendorRes.rows[0].payment_terms_days > 0) {
        const d = new Date(voucher_date);
        d.setDate(d.getDate() + vendorRes.rows[0].payment_terms_days);
        due_date = d.toISOString().split('T')[0];
      }
    }

    const result = await query(`
      INSERT INTO vouchers (
        voucher_number, voucher_type, voucher_date, amount,
        debit_account_id, credit_account_id,
        party_type, party_id, party_name,
        reference_type, reference_id,
        narration, cheque_number, cheque_date, transaction_ref,
        status, created_by, category, due_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *
    `, [
      voucher_number, voucher_type, voucher_date, amount,
      debit_account_id || null, credit_account_id || null,
      party_type || null, party_id || null, party_name || null,
      reference_type || null, reference_id || null,
      narration || null, cheque_number || null, cheque_date || null, transaction_ref || null,
      initialStatus, req.user.userId, category || null, due_date
    ]);

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: `${VOUCHER_TYPE_LABELS[voucher_type]} ${voucher_number} created — pending approval`
    });
  } catch (error) {
    logError(error, req, { feature: 'vouchers' });
    logger.error('Create voucher error:', error);
    res.status(500).json({ success: false, message: 'Failed to create voucher: ' + error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/vouchers/:id — Edit a draft/pending voucher
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Only draft or pending_approval vouchers can be edited
    const existing = await query('SELECT status FROM vouchers WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Voucher not found' });
    }
    if (!['draft', 'pending_approval'].includes(existing.rows[0].status)) {
      return res.status(400).json({ success: false, message: 'Only draft or pending approval vouchers can be edited' });
    }

    const { error, value } = voucherSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const {
      voucher_type, voucher_date, amount,
      debit_account_id, credit_account_id,
      party_type, party_id, party_name,
      reference_type, reference_id,
      narration, cheque_number, cheque_date, transaction_ref
    } = value;

    const result = await query(`
      UPDATE vouchers SET
        voucher_type = $1, voucher_date = $2, amount = $3,
        debit_account_id = $4, credit_account_id = $5,
        party_type = $6, party_id = $7, party_name = $8,
        reference_type = $9, reference_id = $10,
        narration = $11, cheque_number = $12, cheque_date = $13, transaction_ref = $14,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $15
      RETURNING *
    `, [
      voucher_type, voucher_date, amount,
      debit_account_id || null, credit_account_id || null,
      party_type || null, party_id || null, party_name || null,
      reference_type || null, reference_id || null,
      narration || null, cheque_number || null, cheque_date || null, transaction_ref || null,
      id
    ]);

    res.json({ success: true, data: result.rows[0], message: 'Voucher updated successfully' });
  } catch (error) {
    logError(error, req, { feature: 'vouchers' });
    res.status(500).json({ success: false, message: 'Failed to update voucher' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/vouchers/:id/approve — Approve and post a voucher
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await query('SELECT * FROM vouchers WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Voucher not found' });
    }
    if (existing.rows[0].status !== 'pending_approval') {
      return res.status(400).json({ success: false, message: 'Only pending approval vouchers can be approved' });
    }

    const result = await query(`
      UPDATE vouchers
      SET status = 'posted',
          approved_by = $1,
          approval_date = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [req.user.userId, id]);

    res.json({
      success: true,
      data: result.rows[0],
      message: `Voucher ${existing.rows[0].voucher_number} approved and posted`
    });
  } catch (error) {
    logError(error, req, { feature: 'vouchers' });
    res.status(500).json({ success: false, message: 'Failed to approve voucher' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/vouchers/:id/cancel — Cancel a voucher
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Cancellation reason is required' });
    }

    const existing = await query('SELECT * FROM vouchers WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Voucher not found' });
    }
    if (existing.rows[0].status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Voucher is already cancelled' });
    }

    const result = await query(`
      UPDATE vouchers
      SET status = 'cancelled',
          cancelled_by = $1,
          cancellation_date = CURRENT_TIMESTAMP,
          cancellation_reason = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `, [req.user.userId, reason.trim(), id]);

    res.json({
      success: true,
      data: result.rows[0],
      message: `Voucher ${existing.rows[0].voucher_number} cancelled`
    });
  } catch (error) {
    logError(error, req, { feature: 'vouchers' });
    res.status(500).json({ success: false, message: 'Failed to cancel voucher' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/vouchers/bulk-approve — Approve multiple vouchers
// ─────────────────────────────────────────────────────────────────────────────
router.post('/bulk-approve', async (req, res) => {
  try {
    const { voucher_ids } = req.body;
    if (!Array.isArray(voucher_ids) || voucher_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No voucher IDs provided' });
    }

    const placeholders = voucher_ids.map((_, i) => `$${i + 1}`).join(', ');
    const result = await query(`
      UPDATE vouchers
      SET status = 'posted',
          approved_by = $${voucher_ids.length + 1},
          approval_date = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${placeholders}) AND status = 'pending_approval'
      RETURNING id, voucher_number
    `, [...voucher_ids, req.user.userId]);

    res.json({
      success: true,
      message: `${result.rows.length} voucher(s) approved and posted`,
      data: result.rows
    });
  } catch (error) {
    logError(error, req, { feature: 'vouchers' });
    res.status(500).json({ success: false, message: 'Failed to bulk approve vouchers' });
  }
});

// Make Voucher Recurring
router.post('/:id/recurring', async (req, res, next) => {
  try {
    const { frequency, next_run_date } = req.body;
    if (!frequency || !next_run_date) {
      return res.status(400).json({ success: false, message: 'Frequency and next run date are required' });
    }

    const checkRes = await query('SELECT id FROM vouchers WHERE id = $1', [req.params.id]);
    const voucher = checkRes.rows[0];
    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Voucher not found' });
    }

    await query(`
      INSERT INTO recurring_vouchers (template_voucher_id, frequency, next_run_date, created_by)
      VALUES ($1, $2, $3, $4)
    `, [req.params.id, frequency, next_run_date, req.user.userId]);
    
    res.json({ success: true, message: 'Voucher marked as recurring successfully' });
  } catch (error) {
    logger.error(`Error making voucher recurring: ${error.message}`);
    next(error);
  }
});



module.exports = router;
