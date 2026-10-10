const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { logError } = require('../utils/errorLogger');
const { sendReport } = require('../utils/tableExport');
const { deleteVoucher } = require('../utils/voucherDelete');
const { VOUCHER_TYPE_LABELS } = require('../utils/voucherNumbering');

router.use(authMiddleware);
router.use(requirePermission('manage_bank_reconciliation', 'manage_payroll', 'manage_expenses', 'view_balance_sheet'));

const today = () => new Date().toISOString().split('T')[0];
const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const safeName = (str) => String(str || 'Account').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

// Posted vouchers touching the account (optionally only unreconciled), plus the
// book balance up to to_date. Used by the screen and the Excel/PDF export.
async function loadEntries(accountId, { from_date, to_date, show_reconciled } = {}) {
  const account = await query('SELECT * FROM bank_accounts WHERE id = $1', [accountId]);
  if (account.rows.length === 0) return null;

  let dateFilter = '';
  const params = [accountId, accountId];
  let pc = 3;
  if (from_date) { dateFilter += ` AND v.voucher_date >= $${pc}`; params.push(from_date); pc++; }
  if (to_date) { dateFilter += ` AND v.voucher_date <= $${pc}`; params.push(to_date); pc++; }

  const vouchers = await query(`
    SELECT v.id, v.voucher_number, v.voucher_type, v.voucher_date, v.amount,
           v.party_name, v.narration, v.cheque_number, v.cheque_date, v.transaction_ref,
           CASE WHEN v.debit_account_id = $1 THEN 'debit' ELSE 'credit' END as entry_type,
           CASE WHEN v.debit_account_id = $1 THEN v.amount ELSE 0 END as debit_amount,
           CASE WHEN v.credit_account_id = $2 THEN v.amount ELSE 0 END as credit_amount,
           br.id as recon_id,
           br.is_reconciled,
           br.reconciliation_date,
           br.bank_statement_date,
           br.bank_statement_ref,
           br.bank_amount
    FROM vouchers v
    LEFT JOIN bank_reconciliation br ON br.voucher_id = v.id AND br.bank_account_id = $1
    WHERE (v.debit_account_id = $1 OR v.credit_account_id = $2)
      AND v.status = 'posted'
      ${dateFilter}
      ${show_reconciled !== 'true' ? 'AND (br.is_reconciled IS NULL OR br.is_reconciled = 0)' : ''}
    ORDER BY v.voucher_date ASC, v.created_at ASC
  `, params);

  // Book balance = opening + all debits - all credits (up to to_date).
  // (Its own parameter list — reusing pc from above pointed at a missing param
  // whenever both dates were set.)
  const allVouchers = await query(`
    SELECT
      COALESCE(SUM(CASE WHEN v.debit_account_id = $1 THEN v.amount ELSE 0 END), 0) as total_debits,
      COALESCE(SUM(CASE WHEN v.credit_account_id = $1 THEN v.amount ELSE 0 END), 0) as total_credits
    FROM vouchers v
    WHERE (v.debit_account_id = $1 OR v.credit_account_id = $1)
      AND v.status = 'posted'
      ${to_date ? 'AND v.voucher_date <= $2' : ''}
  `, to_date ? [accountId, to_date] : [accountId]);

  const openingBalance = parseFloat(account.rows[0].opening_balance) || 0;
  const bookBalance = openingBalance +
    (parseFloat(allVouchers.rows[0]?.total_debits) || 0) -
    (parseFloat(allVouchers.rows[0]?.total_credits) || 0);

  const amt = (v) => parseFloat(v.amount) || 0;
  const unreconciledDebits = vouchers.rows
    .filter(v => v.entry_type === 'debit' && !v.is_reconciled)
    .reduce((sum, v) => sum + amt(v), 0);
  const unreconciledCredits = vouchers.rows
    .filter(v => v.entry_type === 'credit' && !v.is_reconciled)
    .reduce((sum, v) => sum + amt(v), 0);

  return {
    account: account.rows[0],
    entries: vouchers.rows,
    summary: {
      book_balance: bookBalance,
      unreconciled_debits: unreconciledDebits,
      unreconciled_credits: unreconciledCredits,
      total_entries: vouchers.rows.length,
      reconciled_count: vouchers.rows.filter(v => v.is_reconciled).length,
      unreconciled_count: vouchers.rows.filter(v => !v.is_reconciled).length
    }
  };
}

// Bank Reconciliation Statement as on a date.
async function loadStatement(accountId, as_on_date) {
  const asOnDate = as_on_date || today();
  const account = await query('SELECT * FROM bank_accounts WHERE id = $1', [accountId]);
  if (account.rows.length === 0) return null;

  const bookData = await query(`
    SELECT
      COALESCE(SUM(CASE WHEN v.debit_account_id = $1 THEN v.amount ELSE 0 END), 0) as total_debits,
      COALESCE(SUM(CASE WHEN v.credit_account_id = $1 THEN v.amount ELSE 0 END), 0) as total_credits
    FROM vouchers v
    WHERE (v.debit_account_id = $1 OR v.credit_account_id = $1)
      AND v.status = 'posted'
      AND v.voucher_date <= $2
  `, [accountId, asOnDate]);

  const bookBalance = (parseFloat(account.rows[0].opening_balance) || 0) +
    (parseFloat(bookData.rows[0]?.total_debits) || 0) -
    (parseFloat(bookData.rows[0]?.total_credits) || 0);

  // Deposits not yet cleared (debits in book, not reconciled)
  const depositsNotCleared = await query(`
    SELECT v.id, v.voucher_number, v.voucher_date, v.amount, v.narration, v.cheque_number
    FROM vouchers v
    LEFT JOIN bank_reconciliation br ON br.voucher_id = v.id AND br.bank_account_id = $1
    WHERE v.debit_account_id = $1
      AND v.status = 'posted'
      AND v.voucher_date <= $2
      AND (br.is_reconciled IS NULL OR br.is_reconciled = 0)
    ORDER BY v.voucher_date ASC
  `, [accountId, asOnDate]);

  // Cheques not yet presented (credits in book, not reconciled)
  const chequesNotPresented = await query(`
    SELECT v.id, v.voucher_number, v.voucher_date, v.amount, v.narration, v.cheque_number
    FROM vouchers v
    LEFT JOIN bank_reconciliation br ON br.voucher_id = v.id AND br.bank_account_id = $1
    WHERE v.credit_account_id = $1
      AND v.status = 'posted'
      AND v.voucher_date <= $2
      AND (br.is_reconciled IS NULL OR br.is_reconciled = 0)
    ORDER BY v.voucher_date ASC
  `, [accountId, asOnDate]);

  const totalDepositsNotCleared = depositsNotCleared.rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const totalChequesNotPresented = chequesNotPresented.rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  // Bank Balance = Book Balance - Deposits not cleared + Cheques not presented
  const bankBalance = bookBalance - totalDepositsNotCleared + totalChequesNotPresented;

  return {
    account: account.rows[0],
    as_on_date: asOnDate,
    book_balance: bookBalance,
    bank_balance: bankBalance,
    deposits_not_cleared: { items: depositsNotCleared.rows, total: totalDepositsNotCleared },
    cheques_not_presented: { items: chequesNotPresented.rows, total: totalChequesNotPresented },
    reconciliation_summary: {
      book_balance: bookBalance,
      add_cheques_not_presented: totalChequesNotPresented,
      less_deposits_not_cleared: totalDepositsNotCleared,
      adjusted_bank_balance: bankBalance
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bank-reconciliation/:accountId — Get entries for reconciliation
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:accountId', async (req, res) => {
  try {
    const data = await loadEntries(req.params.accountId, req.query);
    if (!data) return res.status(404).json({ success: false, message: 'Bank account not found' });
    res.json({ success: true, data });
  } catch (error) {
    logError(error, req, { feature: 'bank-reconciliation' });
    logger.error('Bank reconciliation fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch reconciliation data' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bank-reconciliation/reconcile — Mark entries as reconciled
// ─────────────────────────────────────────────────────────────────────────────
router.post('/reconcile', async (req, res) => {
  try {
    const { entries } = req.body;

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, message: 'No entries provided' });
    }

    let reconciled = 0;
    for (const entry of entries) {
      const { voucher_id, bank_account_id, bank_statement_date, bank_statement_ref, bank_amount } = entry;

      if (!voucher_id || !bank_account_id) continue;

      // Upsert reconciliation record
      const existing = await query(
        'SELECT id FROM bank_reconciliation WHERE voucher_id = $1 AND bank_account_id = $2',
        [voucher_id, bank_account_id]
      );

      if (existing.rows.length > 0) {
        await query(`
          UPDATE bank_reconciliation
          SET is_reconciled = 1,
              reconciliation_date = CURRENT_TIMESTAMP,
              bank_statement_date = $1,
              bank_statement_ref = $2,
              bank_amount = $3,
              reconciled_by = $4,
              reconciled_at = CURRENT_TIMESTAMP
          WHERE voucher_id = $5 AND bank_account_id = $6
        `, [bank_statement_date || null, bank_statement_ref || null, bank_amount || null, req.user.userId, voucher_id, bank_account_id]);
      } else {
        await query(`
          INSERT INTO bank_reconciliation (bank_account_id, voucher_id, reconciliation_date, bank_statement_date, bank_statement_ref, bank_amount, is_reconciled, reconciled_at, reconciled_by)
          VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, 1, CURRENT_TIMESTAMP, $6)
        `, [bank_account_id, voucher_id, bank_statement_date || null, bank_statement_ref || null, bank_amount || null, req.user.userId]);
      }
      reconciled++;
    }

    res.json({
      success: true,
      message: `${reconciled} entries reconciled successfully`
    });
  } catch (error) {
    logError(error, req, { feature: 'bank-reconciliation' });
    logger.error('Reconciliation error:', error);
    res.status(500).json({ success: false, message: 'Failed to reconcile entries' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bank-reconciliation/unreconcile — Undo reconciliation
// ─────────────────────────────────────────────────────────────────────────────
router.post('/unreconcile', async (req, res) => {
  try {
    const { voucher_ids, bank_account_id } = req.body;

    if (!Array.isArray(voucher_ids) || voucher_ids.length === 0 || !bank_account_id) {
      return res.status(400).json({ success: false, message: 'Invalid request' });
    }

    const placeholders = voucher_ids.map((_, i) => `$${i + 1}`).join(', ');
    await query(`
      UPDATE bank_reconciliation
      SET is_reconciled = 0, reconciled_at = NULL, reconciled_by = NULL
      WHERE voucher_id IN (${placeholders}) AND bank_account_id = $${voucher_ids.length + 1}
    `, [...voucher_ids, bank_account_id]);

    res.json({ success: true, message: `${voucher_ids.length} entries unreconciled` });
  } catch (error) {
    logError(error, req, { feature: 'bank-reconciliation' });
    res.status(500).json({ success: false, message: 'Failed to unreconcile entries' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bank-reconciliation/statement/:accountId — BRS Summary
// ─────────────────────────────────────────────────────────────────────────────
router.get('/statement/:accountId', async (req, res) => {
  try {
    const data = await loadStatement(req.params.accountId, req.query.as_on_date);
    if (!data) return res.status(404).json({ success: false, message: 'Account not found' });
    res.json({ success: true, data });
  } catch (error) {
    logError(error, req, { feature: 'bank-reconciliation' });
    res.status(500).json({ success: false, message: 'Failed to generate BRS' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/bank-reconciliation/entry/:voucherId — delete an entry (voucher)
// from the reconciliation list. Same rules as the Vouchers screen: refused for
// payment-created vouchers and for reconciled entries (Undo first).
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/entry/:voucherId', requirePermission('manage_vouchers', 'delete_vouchers', 'manage_bank_reconciliation'), async (req, res) => {
  try {
    const result = await deleteVoucher(req.params.voucherId);
    if (!result.ok) return res.status(result.status || 400).json({ success: false, message: result.message });
    res.json({ success: true, message: result.message });
  } catch (error) {
    logError(error, req, { feature: 'bank-reconciliation' });
    res.status(500).json({ success: false, message: 'Failed to delete entry' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bank-reconciliation/export/entries/:accountId?format=pdf|xlsx
//   — the reconciliation list exactly as filtered on screen (dates, show reconciled)
// GET /api/bank-reconciliation/export/statement/:accountId?format=pdf|xlsx&as_on_date=
//   — the Bank Reconciliation Statement (BRS)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/export/entries/:accountId', async (req, res) => {
  try {
    const data = await loadEntries(req.params.accountId, req.query);
    if (!data) return res.status(404).json({ success: false, message: 'Bank account not found' });
    const { account, entries, summary } = data;
    const { from_date, to_date, show_reconciled, format = 'xlsx' } = req.query;

    let totalDebit = 0, totalCredit = 0;
    const rows = entries.map((e) => {
      totalDebit += parseFloat(e.debit_amount) || 0;
      totalCredit += parseFloat(e.credit_amount) || 0;
      return {
        date: e.voucher_date,
        number: e.voucher_number,
        type: VOUCHER_TYPE_LABELS[e.voucher_type] || e.voucher_type,
        party: e.party_name || '',
        narration: e.narration || '',
        ref: e.cheque_number || e.transaction_ref || '',
        debit: parseFloat(e.debit_amount) || null,
        credit: parseFloat(e.credit_amount) || null,
        status: e.is_reconciled ? `Reconciled${e.bank_statement_date ? ` (${e.bank_statement_date})` : ''}` : 'Pending',
      };
    });

    await sendReport(res, format, {
      filename: `Bank_Reconciliation_${safeName(account.account_name)}_${from_date || 'start'}_to_${to_date || today()}`,
      sheetName: 'Reconciliation',
      title: `Bank Reconciliation — ${account.account_name}`,
      subtitleLines: [
        `Period: ${from_date || 'Start'} to ${to_date || 'Today'} · ${show_reconciled === 'true' ? 'All entries' : 'Unreconciled entries only'}`,
        `Book balance: Rs. ${money(summary.book_balance)} · Reconciled: ${summary.reconciled_count} · Pending: ${summary.unreconciled_count}`,
      ],
      sections: [{
        name: `Entries (${rows.length})`,
        columns: [
          { key: 'date', label: 'Date', width: 0.9, excelWidth: 12 },
          { key: 'number', label: 'Voucher No.', width: 1.2, excelWidth: 18 },
          { key: 'type', label: 'Type', width: 1, excelWidth: 16 },
          { key: 'party', label: 'Party', width: 1.2, excelWidth: 22 },
          { key: 'narration', label: 'Narration', width: 1.6, excelWidth: 34 },
          { key: 'ref', label: 'Cheque / Ref', width: 0.9, excelWidth: 16 },
          { key: 'debit', label: 'Debit (In)', width: 0.9, money: true, excelWidth: 14 },
          { key: 'credit', label: 'Credit (Out)', width: 0.9, money: true, excelWidth: 14 },
          { key: 'status', label: 'Status', width: 1, excelWidth: 22 },
        ],
        rows: rows.length > 0 ? rows : [{ date: 'No entries for this selection' }],
        totalsRow: rows.length > 0 ? { ref: 'TOTAL', debit: totalDebit, credit: totalCredit } : undefined,
      }],
    });
  } catch (error) {
    logError(error, req, { feature: 'bank-reconciliation' });
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to export reconciliation' });
  }
});

router.get('/export/statement/:accountId', async (req, res) => {
  try {
    const data = await loadStatement(req.params.accountId, req.query.as_on_date);
    if (!data) return res.status(404).json({ success: false, message: 'Account not found' });
    const { format = 'xlsx' } = req.query;
    const { account, as_on_date, book_balance, bank_balance, deposits_not_cleared, cheques_not_presented } = data;

    const itemColumns = [
      { key: 'number', label: 'Voucher No.', width: 1.2, excelWidth: 18 },
      { key: 'date', label: 'Date', width: 0.9, excelWidth: 12 },
      { key: 'ref', label: 'Cheque / Ref', width: 1, excelWidth: 16 },
      { key: 'narration', label: 'Narration', width: 2, excelWidth: 36 },
      { key: 'amount', label: 'Amount', width: 1, money: true, excelWidth: 14 },
    ];
    const toItemRows = (items) => (items.length > 0
      ? items.map((i) => ({ number: i.voucher_number, date: i.voucher_date, ref: i.cheque_number || '', narration: i.narration || '', amount: parseFloat(i.amount) || 0 }))
      : [{ number: 'None' }]);

    await sendReport(res, format, {
      filename: `BRS_${safeName(account.account_name)}_${as_on_date}`,
      sheetName: 'BRS',
      title: 'Bank Reconciliation Statement',
      subtitleLines: [
        `${account.account_name}${account.bank_name ? ` — ${account.bank_name}` : ''}${account.account_number ? ` (A/c ${account.account_number})` : ''}`,
        `As on ${as_on_date}`,
      ],
      sections: [
        {
          name: 'Reconciliation Summary',
          columns: [
            { key: 'particulars', label: 'Particulars', width: 3, excelWidth: 48 },
            { key: 'amount', label: 'Amount', width: 1, money: true, excelWidth: 16 },
          ],
          rows: [
            { particulars: 'Balance as per Cash Book', amount: book_balance },
            { particulars: 'Add: Cheques issued but not yet presented', amount: cheques_not_presented.total },
            { particulars: 'Less: Deposits not yet cleared', amount: deposits_not_cleared.total },
          ],
          totalsRow: { particulars: 'Balance as per Bank Statement', amount: bank_balance },
        },
        {
          name: `Cheques Issued but Not Yet Presented (${cheques_not_presented.items.length})`,
          columns: itemColumns,
          rows: toItemRows(cheques_not_presented.items),
          totalsRow: cheques_not_presented.items.length > 0 ? { narration: 'TOTAL', amount: cheques_not_presented.total } : undefined,
        },
        {
          name: `Deposits Not Yet Cleared (${deposits_not_cleared.items.length})`,
          columns: itemColumns,
          rows: toItemRows(deposits_not_cleared.items),
          totalsRow: deposits_not_cleared.items.length > 0 ? { narration: 'TOTAL', amount: deposits_not_cleared.total } : undefined,
        },
      ],
    });
  } catch (error) {
    logError(error, req, { feature: 'bank-reconciliation' });
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to export BRS' });
  }
});

module.exports = router;
