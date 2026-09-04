const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requirePermission('manage_bank_reconciliation', 'manage_payroll', 'manage_expenses', 'view_balance_sheet'));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bank-reconciliation/:accountId — Get entries for reconciliation
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { from_date, to_date, show_reconciled } = req.query;

    // Verify account exists
    const account = await query('SELECT * FROM bank_accounts WHERE id = $1', [accountId]);
    if (account.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bank account not found' });
    }

    let dateFilter = '';
    const params = [accountId, accountId];
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

    // Get all posted vouchers for this bank account
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

    // Calculate balances
    const openingBalance = account.rows[0].opening_balance || 0;

    // Book balance = opening + all debits - all credits (up to to_date)
    const allVouchers = await query(`
      SELECT
        COALESCE(SUM(CASE WHEN v.debit_account_id = $1 THEN v.amount ELSE 0 END), 0) as total_debits,
        COALESCE(SUM(CASE WHEN v.credit_account_id = $1 THEN v.amount ELSE 0 END), 0) as total_credits
      FROM vouchers v
      WHERE (v.debit_account_id = $1 OR v.credit_account_id = $1)
        AND v.status = 'posted'
        ${to_date ? `AND v.voucher_date <= $${pc}` : ''}
    `, to_date ? [accountId, accountId, to_date] : [accountId, accountId]);

    const bookBalance = openingBalance +
      (allVouchers.rows[0]?.total_debits || 0) -
      (allVouchers.rows[0]?.total_credits || 0);

    // Unreconciled items summary
    const unreconciledDebits = vouchers.rows
      .filter(v => v.entry_type === 'debit' && !v.is_reconciled)
      .reduce((sum, v) => sum + v.amount, 0);
    const unreconciledCredits = vouchers.rows
      .filter(v => v.entry_type === 'credit' && !v.is_reconciled)
      .reduce((sum, v) => sum + v.amount, 0);

    res.json({
      success: true,
      data: {
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
      }
    });
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
    const { accountId } = req.params;
    const { as_on_date } = req.query;
    const asOnDate = as_on_date || new Date().toISOString().split('T')[0];

    const account = await query('SELECT * FROM bank_accounts WHERE id = $1', [accountId]);
    if (account.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    // Book balance
    const bookData = await query(`
      SELECT
        COALESCE(SUM(CASE WHEN v.debit_account_id = $1 THEN v.amount ELSE 0 END), 0) as total_debits,
        COALESCE(SUM(CASE WHEN v.credit_account_id = $1 THEN v.amount ELSE 0 END), 0) as total_credits
      FROM vouchers v
      WHERE (v.debit_account_id = $1 OR v.credit_account_id = $1)
        AND v.status = 'posted'
        AND v.voucher_date <= $2
    `, [accountId, asOnDate]);

    const bookBalance = (account.rows[0].opening_balance || 0) +
      (bookData.rows[0]?.total_debits || 0) -
      (bookData.rows[0]?.total_credits || 0);

    // Deposits not yet cleared (debits in book, not reconciled)
    const depositsNotCleared = await query(`
      SELECT v.id, v.voucher_number, v.voucher_date, v.amount, v.narration, v.cheque_number
      FROM vouchers v
      LEFT JOIN bank_reconciliation br ON br.voucher_id = v.id AND br.bank_account_id = $1
      WHERE v.debit_account_id = $1
        AND v.status = 'posted'
        AND v.voucher_date <= $2
        AND (br.is_reconciled IS NULL OR br.is_reconciled = 0)
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
    `, [accountId, asOnDate]);

    const totalDepositsNotCleared = depositsNotCleared.rows.reduce((s, r) => s + r.amount, 0);
    const totalChequesNotPresented = chequesNotPresented.rows.reduce((s, r) => s + r.amount, 0);

    // Bank Balance = Book Balance - Deposits not cleared + Cheques not presented
    const bankBalance = bookBalance - totalDepositsNotCleared + totalChequesNotPresented;

    res.json({
      success: true,
      data: {
        account: account.rows[0],
        as_on_date: asOnDate,
        book_balance: bookBalance,
        bank_balance: bankBalance,
        deposits_not_cleared: {
          items: depositsNotCleared.rows,
          total: totalDepositsNotCleared
        },
        cheques_not_presented: {
          items: chequesNotPresented.rows,
          total: totalChequesNotPresented
        },
        reconciliation_summary: {
          book_balance: bookBalance,
          add_cheques_not_presented: totalChequesNotPresented,
          less_deposits_not_cleared: totalDepositsNotCleared,
          adjusted_bank_balance: bankBalance
        }
      }
    });
  } catch (error) {
    logError(error, req, { feature: 'bank-reconciliation' });
    res.status(500).json({ success: false, message: 'Failed to generate BRS' });
  }
});

module.exports = router;
