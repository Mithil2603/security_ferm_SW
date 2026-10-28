const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission, requireCompanyContext } = require('../middleware/auth');
const Joi = require('joi');
const { logError } = require('../utils/errorLogger');
const { VOUCHER_PREFIXES, VOUCHER_TYPE_LABELS, getFinancialYear, getNextVoucherNumber } = require('../utils/voucherNumbering');
const { sendReport } = require('../utils/tableExport');
const { deleteVoucher } = require('../utils/voucherDelete');

router.use(authMiddleware);
router.use(requireCompanyContext);
router.use(requirePermission('manage_vouchers', 'view_vouchers', 'create_vouchers', 'edit_vouchers', 'delete_vouchers', 'approve_vouchers', 'manage_payroll', 'manage_expenses'));

// ─── Validation ─────────────────────────────────────────────────────────────
const voucherSchema = Joi.object({
  voucher_type: Joi.string().valid(
    'cash_payment', 'cash_receipt', 'bank_payment', 'bank_receipt',
    'journal', 'contra', 'debit_note', 'credit_note',
    'salary', 'petty_cash',  // Salary Account, Petty Cash Entry
    'payment', 'receipt'  // common aliases
  ).required(),
  voucher_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  amount: Joi.number().positive().precision(2).required(),
  debit_account_id: Joi.number().integer().positive().allow(null).optional(),
  credit_account_id: Joi.number().integer().positive().allow(null).optional(),
  debit_ledger_id: Joi.number().integer().positive().allow(null).optional(),
  credit_ledger_id: Joi.number().integer().positive().allow(null).optional(),
  party_side: Joi.string().valid('debit', 'credit').allow(null, '').optional(),
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

// Display name for each voucher side: bank/cash account, else custom ledger,
// else the party when it sits on that side (party_side).
const SIDE_NAME_SQL = `
             COALESCE(da.account_name, dl.name, CASE WHEN v.party_side = 'debit' THEN v.party_name END) as debit_account_name,
             COALESCE(ca.account_name, cl.name, CASE WHEN v.party_side = 'credit' THEN v.party_name END) as credit_account_name,
             dl.name as debit_ledger_name,
             cl.name as credit_ledger_name`;
const SIDE_JOINS_SQL = `
      LEFT JOIN bank_accounts da ON v.debit_account_id = da.id AND da.company_id = v.company_id
      LEFT JOIN bank_accounts ca ON v.credit_account_id = ca.id AND ca.company_id = v.company_id
      LEFT JOIN ledgers dl ON v.debit_ledger_id = dl.id AND dl.company_id = v.company_id
      LEFT JOIN ledgers cl ON v.credit_ledger_id = cl.id AND cl.company_id = v.company_id`;

// Each side is at most one of: bank/cash account, custom ledger, or the party.
// Checks the referenced rows exist and are active; fills party_name when the
// party is a client/vendor side. Returns an error message or null.
async function validateVoucherSides(value, companyId) {
  const partySide = value.party_side || null;
  for (const side of ['debit', 'credit']) {
    const picked = [value[`${side}_account_id`], value[`${side}_ledger_id`], partySide === side ? 1 : null].filter(Boolean);
    if (picked.length > 1) return `Pick only one ${side} ledger`;
  }
  const hasDebit = value.debit_account_id || value.debit_ledger_id || partySide === 'debit';
  const hasCredit = value.credit_account_id || value.credit_ledger_id || partySide === 'credit';
  if (!hasDebit && !hasCredit) return 'Select a debit or credit ledger';

  if (partySide) {
    if (!['client', 'vendor'].includes(value.party_type) || !value.party_id) {
      return 'A customer or vendor is required when the party is a voucher side';
    }
    const table = value.party_type === 'client' ? 'clients' : 'vendors';
    const p = await query(`SELECT name FROM ${table} WHERE id = $1 AND company_id = $2`, [value.party_id, companyId]);
    if (p.rows.length === 0) return `${value.party_type === 'client' ? 'Customer' : 'Vendor'} not found`;
    if (!value.party_name) value.party_name = p.rows[0].name;
  }

  for (const side of ['debit', 'credit']) {
    const label = side === 'debit' ? 'Debit' : 'Credit';
    const accId = value[`${side}_account_id`];
    if (accId) {
      const a = await query('SELECT id FROM bank_accounts WHERE id = $1 AND is_active = 1 AND company_id = $2', [accId, companyId]);
      if (a.rows.length === 0) return `${label} account not found or inactive`;
    }
    const ledId = value[`${side}_ledger_id`];
    if (ledId) {
      const l = await query('SELECT id FROM ledgers WHERE id = $1 AND is_active = 1 AND company_id = $2', [ledId, companyId]);
      if (l.rows.length === 0) return `${label} ledger not found or inactive`;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/vouchers — List vouchers with filters
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { voucher_type, status, from_date, to_date, party_type, party_id, search, limit = 100, offset = 0 } = req.query;

    let conditions = ['v.company_id = $1'];
    let params = [req.companyId];
    let pc = 2;

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

    const where = `WHERE ${conditions.join(' AND ')}`;

    // Get total count
    const countResult = await query(`SELECT COUNT(*) as total FROM vouchers v ${where}`, params);

    // Get vouchers with joined account names
    const result = await query(`
      SELECT v.*,${SIDE_NAME_SQL},
             cu.full_name as created_by_name,
             au.full_name as approved_by_name
      FROM vouchers v${SIDE_JOINS_SQL}
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
// GET /api/vouchers/export?format=pdf|xlsx — date-wise voucher register for any
// combination of voucher types (types=cash_payment,bank_receipt,...; empty =
// all), with the same status / date / search filters as the list. Rows run in
// date order; a per-type summary follows. Cancelled vouchers are left out
// unless status=cancelled is asked for.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/export', async (req, res) => {
  try {
    const { format = 'xlsx', status, from_date, to_date, search } = req.query;
    const types = String(req.query.types || '')
      .split(',').map((t) => t.trim()).filter((t) => VOUCHER_TYPE_LABELS[t]);

    const conditions = ['v.company_id = $1'];
    const params = [req.companyId];
    let pc = 2;
    if (types.length > 0) {
      conditions.push(`v.voucher_type IN (${types.map(() => `$${pc++}`).join(',')})`);
      params.push(...types);
    }
    if (status) { conditions.push(`v.status = $${pc}`); params.push(status); pc++; }
    else conditions.push(`v.status != 'cancelled'`);
    if (from_date) { conditions.push(`v.voucher_date >= $${pc}`); params.push(from_date); pc++; }
    if (to_date) { conditions.push(`v.voucher_date <= $${pc}`); params.push(to_date); pc++; }
    if (search) {
      conditions.push(`(v.voucher_number LIKE $${pc} OR v.party_name LIKE $${pc} OR v.narration LIKE $${pc})`);
      params.push(`%${search}%`); pc++;
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await query(`
      SELECT v.*,${SIDE_NAME_SQL}
      FROM vouchers v${SIDE_JOINS_SQL}
      ${where}
      ORDER BY v.voucher_date ASC, v.voucher_number ASC, v.id ASC
    `, params);

    const STATUS_LABELS = { draft: 'Draft', pending_approval: 'Pending Approval', posted: 'Posted', cancelled: 'Cancelled' };
    let total = 0;
    const byType = {};
    const rows = result.rows.map((v) => {
      const amount = parseFloat(v.amount) || 0;
      total += amount;
      const label = VOUCHER_TYPE_LABELS[v.voucher_type] || v.voucher_type;
      byType[label] = byType[label] || { type: label, count: 0, amount: 0 };
      byType[label].count += 1;
      byType[label].amount += amount;
      return {
        date: v.voucher_date,
        number: v.voucher_number,
        type: label,
        party: v.party_name || '',
        to_account: v.debit_account_name || '',
        from_account: v.credit_account_name || '',
        narration: v.narration || '',
        ref: v.cheque_number || v.transaction_ref || '',
        status: STATUS_LABELS[v.status] || v.status,
        amount,
      };
    });

    const typeLabel = types.length === 0 || types.length === Object.keys(VOUCHER_TYPE_LABELS).length
      ? 'All voucher types'
      : types.map((t) => VOUCHER_TYPE_LABELS[t]).join(', ');
    const subtitleLines = [
      typeLabel,
      `Period: ${from_date || 'Start'} to ${to_date || 'Today'}${status ? ` · Status: ${STATUS_LABELS[status] || status}` : ''}`,
    ];
    const stamp = `${from_date || 'start'}_to_${to_date || new Date().toISOString().split('T')[0]}`;

    await sendReport(res, format, {
      filename: `Vouchers_${stamp}`,
      sheetName: 'Vouchers',
      title: 'Voucher Register',
      subtitleLines,
      sections: [
        {
          name: `Vouchers (${rows.length})`,
          columns: [
            { key: 'date', label: 'Date', width: 0.9, excelWidth: 12 },
            { key: 'number', label: 'Voucher No.', width: 1.2, excelWidth: 18 },
            { key: 'type', label: 'Type', width: 1.1, excelWidth: 18 },
            { key: 'party', label: 'Party', width: 1.3, excelWidth: 24 },
            { key: 'to_account', label: 'Debit A/C (To)', width: 1.1, excelWidth: 20 },
            { key: 'from_account', label: 'Credit A/C (From)', width: 1.1, excelWidth: 20 },
            { key: 'narration', label: 'Narration', width: 1.6, excelWidth: 36 },
            { key: 'ref', label: 'Cheque / Ref', width: 0.9, excelWidth: 16 },
            { key: 'status', label: 'Status', width: 0.8, excelWidth: 16 },
            { key: 'amount', label: 'Amount', width: 0.9, money: true, excelWidth: 14 },
          ],
          rows: rows.length > 0 ? rows : [{ date: 'No vouchers for this selection' }],
          totalsRow: rows.length > 0 ? { narration: 'TOTAL', amount: total } : undefined,
        },
        {
          name: 'Summary by Type',
          columns: [
            { key: 'type', label: 'Voucher Type', width: 2, excelWidth: 22 },
            { key: 'count', label: 'Count', width: 1, align: 'right' },
            { key: 'amount', label: 'Amount', width: 1.2, money: true, excelWidth: 16 },
          ],
          rows: Object.values(byType),
          totalsRow: rows.length > 0 ? { type: 'TOTAL', count: rows.length, amount: total } : undefined,
        },
      ],
    }, req.companyId);
  } catch (error) {
    logError(error, req, { feature: 'vouchers' });
    logger.error('Voucher export error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to export vouchers' });
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
        AND company_id = $3
      GROUP BY voucher_type
      ORDER BY voucher_type
    `, [fromDate, toDate, req.companyId]);

    // Pending approval count for badge
    const pendingResult = await query(`
      SELECT COUNT(*) as pending_count
      FROM vouchers
      WHERE status = 'pending_approval' AND company_id = $1
    `, [req.companyId]);

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
      WHERE voucher_type = $1 AND financial_year = $2 AND company_id = $3
    `, [type, fy, req.companyId]);

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
        AND v.company_id = $1
      ORDER BY days_overdue DESC
    `, [req.companyId]);

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
      SELECT v.*,${SIDE_NAME_SQL},
             cu.full_name as created_by_name,
             au.full_name as approved_by_name
      FROM vouchers v${SIDE_JOINS_SQL}
      LEFT JOIN users cu ON v.created_by = cu.id
      LEFT JOIN users au ON v.approved_by = au.id
      WHERE v.id = $1 AND v.company_id = $2
    `, [id, req.companyId]);

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
router.post('/', requirePermission('manage_vouchers', 'create_vouchers', 'manage_payroll', 'manage_expenses'), async (req, res) => {
  try {
    const { error, value } = voucherSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const sideError = await validateVoucherSides(value, req.companyId);
    if (sideError) {
      return res.status(400).json({ success: false, message: sideError });
    }

    const {
      voucher_date, amount,
      debit_account_id, credit_account_id,
      debit_ledger_id, credit_ledger_id, party_side,
      party_type, party_id, party_name,
      reference_type, reference_id,
      narration, cheque_number, cheque_date, transaction_ref, category
    } = value;

    // Normalize alias types to canonical types
    const TYPE_ALIASES = { payment: 'bank_payment', receipt: 'bank_receipt' };
    const voucher_type = TYPE_ALIASES[value.voucher_type] || value.voucher_type;

    // Generate voucher number
    const voucher_number = await getNextVoucherNumber(voucher_type, voucher_date, req.companyId);

    // Initial status: pending_approval (approval workflow enabled)
    const initialStatus = 'pending_approval';

    // Calculate due_date if vendor
    let due_date = null;
    if (party_type === 'vendor' && party_id) {
      const vendorRes = await query('SELECT payment_terms_days FROM vendors WHERE id = $1 AND company_id = $2', [party_id, req.companyId]);
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
        status, created_by, category, due_date,
        debit_ledger_id, credit_ledger_id, party_side, company_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      RETURNING *
    `, [
      voucher_number, voucher_type, voucher_date, amount,
      debit_account_id || null, credit_account_id || null,
      party_type || null, party_id || null, party_name || null,
      reference_type || null, reference_id || null,
      narration || null, cheque_number || null, cheque_date || null, transaction_ref || null,
      initialStatus, req.user.userId, category || null, due_date,
      debit_ledger_id || null, credit_ledger_id || null, party_side || null, req.companyId
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
router.put('/:id', requirePermission('manage_vouchers', 'edit_vouchers'), async (req, res) => {
  try {
    const { id } = req.params;

    // Only draft or pending_approval vouchers can be edited
    const existing = await query('SELECT status FROM vouchers WHERE id = $1 AND company_id = $2', [id, req.companyId]);
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

    const sideError = await validateVoucherSides(value, req.companyId);
    if (sideError) {
      return res.status(400).json({ success: false, message: sideError });
    }

    const {
      voucher_date, amount,
      debit_account_id, credit_account_id,
      debit_ledger_id, credit_ledger_id, party_side,
      party_type, party_id, party_name,
      reference_type, reference_id,
      narration, cheque_number, cheque_date, transaction_ref
    } = value;
    const TYPE_ALIASES = { payment: 'bank_payment', receipt: 'bank_receipt' };
    const voucher_type = TYPE_ALIASES[value.voucher_type] || value.voucher_type;

    const result = await query(`
      UPDATE vouchers SET
        voucher_type = $1, voucher_date = $2, amount = $3,
        debit_account_id = $4, credit_account_id = $5,
        party_type = $6, party_id = $7, party_name = $8,
        reference_type = $9, reference_id = $10,
        narration = $11, cheque_number = $12, cheque_date = $13, transaction_ref = $14,
        debit_ledger_id = $15, credit_ledger_id = $16, party_side = $17,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $18 AND company_id = $19
      RETURNING *
    `, [
      voucher_type, voucher_date, amount,
      debit_account_id || null, credit_account_id || null,
      party_type || null, party_id || null, party_name || null,
      reference_type || null, reference_id || null,
      narration || null, cheque_number || null, cheque_date || null, transaction_ref || null,
      debit_ledger_id || null, credit_ledger_id || null, party_side || null,
      id, req.companyId
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
router.post('/:id/approve', requirePermission('manage_vouchers', 'approve_vouchers'), async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await query('SELECT * FROM vouchers WHERE id = $1 AND company_id = $2', [id, req.companyId]);
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
      WHERE id = $2 AND company_id = $3
      RETURNING *
    `, [req.user.userId, id, req.companyId]);

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
router.post('/:id/cancel', requirePermission('manage_vouchers', 'delete_vouchers'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Cancellation reason is required' });
    }

    const existing = await query('SELECT * FROM vouchers WHERE id = $1 AND company_id = $2', [id, req.companyId]);
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
      WHERE id = $3 AND company_id = $4
      RETURNING *
    `, [req.user.userId, reason.trim(), id, req.companyId]);

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
// DELETE /api/vouchers/:id — Permanently delete a voucher. Bank balances are
// derived from posted vouchers, so they adjust automatically. Refused when the
// voucher belongs to a payment (deleting it here would leave the invoice/bill
// marked paid with no money behind it) or has been bank-reconciled.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', requirePermission('manage_vouchers', 'delete_vouchers'), async (req, res) => {
  try {
    const result = await deleteVoucher(req.params.id, req.companyId);
    if (!result.ok) return res.status(result.status || 400).json({ success: false, message: result.message });
    res.json({ success: true, message: result.message });
  } catch (error) {
    logError(error, req, { feature: 'vouchers' });
    res.status(500).json({ success: false, message: 'Failed to delete voucher' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/vouchers/bulk-approve — Approve multiple vouchers
// ─────────────────────────────────────────────────────────────────────────────
router.post('/bulk-approve', requirePermission('manage_vouchers', 'approve_vouchers'), async (req, res) => {
  try {
    const { voucher_ids } = req.body;
    if (!Array.isArray(voucher_ids) || voucher_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No voucher IDs provided' });
    }

    const ids = voucher_ids.map((id) => parseInt(id)).filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid voucher IDs provided' });
    }
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');

    // Which of these are still pending (others may have been approved/cancelled meanwhile).
    // No RETURNING here: the MySQL adapter only emulates it for `WHERE id = ?`,
    // so with IN (...) it came back empty and the message always said 0.
    const pending = await query(
      `SELECT id, voucher_number FROM vouchers WHERE id IN (${placeholders}) AND status = 'pending_approval' AND company_id = $${ids.length + 1}`,
      [...ids, req.companyId]
    );
    if (pending.rows.length > 0) {
      const pendingIds = pending.rows.map((r) => r.id);
      const ph = pendingIds.map((_, i) => `$${i + 1}`).join(', ');
      await query(`
        UPDATE vouchers
        SET status = 'posted',
            approved_by = $${pendingIds.length + 1},
            approval_date = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id IN (${ph}) AND status = 'pending_approval' AND company_id = $${pendingIds.length + 2}
      `, [...pendingIds, req.user.userId, req.companyId]);
    }

    const skipped = ids.length - pending.rows.length;
    res.json({
      success: true,
      message: `${pending.rows.length} voucher(s) approved and posted${skipped > 0 ? ` (${skipped} skipped — no longer pending)` : ''}`,
      data: pending.rows
    });
  } catch (error) {
    logError(error, req, { feature: 'vouchers' });
    res.status(500).json({ success: false, message: 'Failed to bulk approve vouchers' });
  }
});

// Make Voucher Recurring
router.post('/:id/recurring', requirePermission('manage_vouchers', 'create_vouchers'), async (req, res, next) => {
  try {
    const { frequency, next_run_date } = req.body;
    if (!frequency || !next_run_date) {
      return res.status(400).json({ success: false, message: 'Frequency and next run date are required' });
    }

    const checkRes = await query('SELECT id FROM vouchers WHERE id = $1 AND company_id = $2', [req.params.id, req.companyId]);
    const voucher = checkRes.rows[0];
    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Voucher not found' });
    }

    await query(`
      INSERT INTO recurring_vouchers (template_voucher_id, frequency, next_run_date, created_by, company_id)
      VALUES ($1, $2, $3, $4, $5)
    `, [req.params.id, frequency, next_run_date, req.user.userId, req.companyId]);

    res.json({ success: true, message: 'Voucher marked as recurring successfully' });
  } catch (error) {
    logger.error(`Error making voucher recurring: ${error.message}`);
    next(error);
  }
});



module.exports = router;
