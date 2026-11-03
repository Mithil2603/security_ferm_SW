const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission, requireCompanyContext } = require('../middleware/auth');
const Joi = require('joi');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requireCompanyContext);
router.use(requirePermission('manage_bank_accounts', 'manage_payroll', 'manage_expenses', 'manage_invoices'));

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
    let where = 'WHERE ba.company_id = $1';
    if (active_only === 'true') {
      where += ' AND ba.is_active = 1';
    }

    const result = await query(`
      SELECT ba.*,
             u.full_name as created_by_name,
             COALESCE(ba.opening_balance, 0) +
               COALESCE((SELECT SUM(v.amount) FROM vouchers v WHERE v.debit_account_id = ba.id AND v.status = 'posted' AND v.company_id = ba.company_id), 0) -
               COALESCE((SELECT SUM(v.amount) FROM vouchers v WHERE v.credit_account_id = ba.id AND v.status = 'posted' AND v.company_id = ba.company_id), 0)
               as current_balance
      FROM bank_accounts ba
      LEFT JOIN users u ON ba.created_by = u.id
      ${where}
      ORDER BY ba.account_type ASC, ba.account_name ASC
    `, [req.companyId]);

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
               COALESCE((SELECT SUM(v.amount) FROM vouchers v WHERE v.debit_account_id = ba.id AND v.status = 'posted' AND v.company_id = ba.company_id), 0) -
               COALESCE((SELECT SUM(v.amount) FROM vouchers v WHERE v.credit_account_id = ba.id AND v.status = 'posted' AND v.company_id = ba.company_id), 0)
               as current_balance
      FROM bank_accounts ba
      WHERE ba.id = $1 AND ba.company_id = $2
    `, [id, req.companyId]);

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

    // First bank-type account for this company becomes the default
    // automatically, so invoices always have a sensible one to fall back to.
    let isDefault = 0;
    if (account_type === 'bank') {
      const existingDefault = await query(
        `SELECT id FROM bank_accounts WHERE company_id = $1 AND account_type = 'bank' AND is_default = 1`,
        [req.companyId]
      );
      if (existingDefault.rows.length === 0) isDefault = 1;
    }

    const result = await query(`
      INSERT INTO bank_accounts (account_name, account_type, account_number, bank_name, ifsc_code, branch, opening_balance, opening_balance_date, created_by, company_id, is_default)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [account_name, account_type, account_number || null, bank_name || null, ifsc_code || null, branch || null, opening_balance, opening_balance_date || null, req.user.userId, req.companyId, isDefault]);

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
      WHERE id = $9 AND company_id = $10
    `, [account_name, account_type, account_number || null, bank_name || null, ifsc_code || null, branch || null, opening_balance, opening_balance_date || null, id, req.companyId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const updated = await query('SELECT * FROM bank_accounts WHERE id=$1 AND company_id=$2', [id, req.companyId]);
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
      WHERE (debit_account_id = $1 OR credit_account_id = $1) AND status = 'posted' AND company_id = $2
    `, [id, req.companyId]);

    const result = await query(`
      UPDATE bank_accounts SET is_active = 0 WHERE id = $1 AND company_id = $2
    `, [id, req.companyId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const deleted = await query('SELECT * FROM bank_accounts WHERE id=$1 AND company_id=$2', [id, req.companyId]);
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
    const params = [id, id, req.companyId];
    let pc = 4;

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
    const accountResult = await query('SELECT * FROM bank_accounts WHERE id = $1 AND company_id = $2', [id, req.companyId]);
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
        AND v.company_id = $3
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bank-accounts/:id/statement/export — Bank Report / Cash Report.
// Same Tally-style letterhead+table as Trial Balance. format=pdf|xlsx
// downloads a file; anything else (default) returns the JSON the report
// pages render on screen, with a correct opening balance as of from_date
// (unlike /statement above, which always starts from the account's original
// opening_balance even when a from_date narrows the range).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/statement/export', async (req, res) => {
  try {
    const { id } = req.params;
    const { from_date, to_date, format } = req.query;

    const accountResult = await query('SELECT * FROM bank_accounts WHERE id = $1 AND company_id = $2', [id, req.companyId]);
    if (accountResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }
    const account = accountResult.rows[0];

    let openingBalance = parseFloat(account.opening_balance) || 0;
    if (from_date) {
      const before = await query(`
        SELECT
          COALESCE(SUM(CASE WHEN debit_account_id = $1 THEN amount ELSE 0 END), 0) AS debit,
          COALESCE(SUM(CASE WHEN credit_account_id = $1 THEN amount ELSE 0 END), 0) AS credit
        FROM vouchers
        WHERE (debit_account_id = $1 OR credit_account_id = $1)
          AND status = 'posted' AND company_id = $2 AND voucher_date < $3
      `, [id, req.companyId, from_date]);
      openingBalance += (parseFloat(before.rows[0].debit) || 0) - (parseFloat(before.rows[0].credit) || 0);
    }

    const params = [id, req.companyId];
    let dateFilter = '';
    if (from_date) { params.push(from_date); dateFilter += ` AND v.voucher_date >= $${params.length}`; }
    if (to_date) { params.push(to_date); dateFilter += ` AND v.voucher_date <= $${params.length}`; }

    const result = await query(`
      SELECT v.id, v.voucher_number, v.voucher_type, v.voucher_date, v.narration, v.cheque_number, v.transaction_ref,
             v.party_name,
             CASE WHEN v.debit_account_id = $1 THEN v.amount ELSE 0 END AS debit_amount,
             CASE WHEN v.credit_account_id = $1 THEN v.amount ELSE 0 END AS credit_amount
        FROM vouchers v
       WHERE (v.debit_account_id = $1 OR v.credit_account_id = $1)
         AND v.status = 'posted' AND v.company_id = $2${dateFilter}
       ORDER BY v.voucher_date ASC, v.created_at ASC
    `, params);

    let running = Math.round(openingBalance * 100) / 100;
    const entries = result.rows.map((r) => {
      running = Math.round((running + (parseFloat(r.debit_amount) || 0) - (parseFloat(r.credit_amount) || 0)) * 100) / 100;
      return { ...r, debit_amount: parseFloat(r.debit_amount) || 0, credit_amount: parseFloat(r.credit_amount) || 0, running_balance: running };
    });
    const totalDebit = Math.round(entries.reduce((s, e) => s + e.debit_amount, 0) * 100) / 100;
    const totalCredit = Math.round(entries.reduce((s, e) => s + e.credit_amount, 0) * 100) / 100;

    if (!format || format === 'json') {
      return res.json({ success: true, data: { account, opening_balance: openingBalance, entries, total_debit: totalDebit, total_credit: totalCredit, closing_balance: running } });
    }

    const { getCompanyProfile } = require('../utils/companyProfile');
    const { generateTallyStylePDF } = require('../utils/tallyReportPdf');
    const { sendExcel } = require('../utils/tableExport');
    const companyProfile = await getCompanyProfile(req.companyId);
    const reportTitle = account.account_type === 'cash' ? 'Cash Report' : 'Bank Report';
    const formatDateLong = (d) => { try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }).replace(/ /g, '-'); } catch { return d; } };
    const displayName = account.bank_name || account.account_name;
    const subtitle = `${displayName}${from_date ? ` — ${formatDateLong(from_date)} to ${formatDateLong(to_date || new Date())}` : ''}`;

    const columns = [
      { key: 'date', label: 'Date', width: 1.1, align: 'left' },
      { key: 'particulars', label: 'Particulars', width: 2.4, align: 'left' },
      { key: 'vch_type', label: 'Vch Type', width: 1.1, align: 'left' },
      { key: 'vch_no', label: 'Vch No.', width: 1.9, align: 'left' },
      { key: 'debit', label: 'Debit', width: 1.3, align: 'right', money: true },
      { key: 'credit', label: 'Credit', width: 1.3, align: 'right', money: true },
      { key: 'balance', label: 'Balance', width: 1.4, align: 'right', money: true },
    ];
    const rows = [
      { type: 'group', indent: 0, values: { particulars: 'Opening Balance', balance: openingBalance } },
      ...entries.map((e) => ({
        type: 'detail',
        indent: 0,
        values: {
          date: formatDateLong(e.voucher_date),
          particulars: e.party_name || e.narration || '-',
          vch_type: String(e.voucher_type || '').replace(/_/g, ' '),
          vch_no: e.voucher_number,
          debit: e.debit_amount || '',
          credit: e.credit_amount || '',
          balance: e.running_balance,
        },
      })),
      { type: 'total', indent: 0, values: { particulars: 'Closing Balance', debit: totalDebit, credit: totalCredit, balance: running } },
    ];

    if (format === 'xlsx' || format === 'excel') {
      return sendExcel(res, {
        filename: `${reportTitle.replace(/\s+/g, '-')}-${account.account_name}`,
        title: reportTitle,
        subtitleLines: [subtitle],
        sections: [{ columns: columns.map((c) => ({ ...c, excelWidth: c.key === 'particulars' ? 32 : 14 })), rows: rows.filter((r) => r.type === 'detail').map((r) => r.values), totalsRow: rows[rows.length - 1].values }],
      });
    }

    const chunks = [];
    generateTallyStylePDF(
      { companyProfile, title: reportTitle, subtitle, columns, rows },
      (c) => chunks.push(c),
      () => {
        const buf = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', buf.length);
        res.setHeader('Content-Disposition', `attachment; filename="${reportTitle.replace(/\s+/g, '-')}-${account.account_name}.pdf"`);
        res.end(buf);
      }
    );
  } catch (error) {
    logError(error, req, { feature: 'bank-accounts' });
    logger.error('Statement export error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to generate report' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/bank-accounts/:id/default — mark this account as the one invoice
// generation falls back to when nobody explicitly picks a bank. Only one
// account per company can be the default; setting a new one clears the rest.
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/default', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await query('SELECT id FROM bank_accounts WHERE id = $1 AND company_id = $2', [id, req.companyId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    await query('UPDATE bank_accounts SET is_default = 0 WHERE company_id = $1', [req.companyId]);
    await query('UPDATE bank_accounts SET is_default = 1 WHERE id = $1 AND company_id = $2', [id, req.companyId]);

    const updated = await query('SELECT * FROM bank_accounts WHERE id = $1 AND company_id = $2', [id, req.companyId]);
    res.json({ success: true, data: updated.rows[0], message: 'Set as default bank account' });
  } catch (error) {
    logError(error, req, { feature: 'bank-accounts' });
    res.status(500).json({ success: false, message: 'Failed to set default account' });
  }
});

module.exports = router;
