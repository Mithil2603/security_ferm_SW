const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query, pool } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requirePermission('manage_bank_reconciliation'));

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

    // M1: Use named params array and rebuild query safely
    const params = [accountId];
    let dateFilter = '';
    
    if (from_date) {
      params.push(from_date);
      dateFilter += ` AND DATE(v.voucher_date) >= DATE($${params.length})`;
    }
    if (to_date) {
      params.push(to_date);
      dateFilter += ` AND DATE(v.voucher_date) <= DATE($${params.length})`; // H8: Timezone cast
    }

    // Get all posted vouchers for this bank account
    // L5: DB compatibility: CASE WHEN works on SQLite, MySQL, PostgreSQL.
    // C1: Fix CASE WHEN debit_account_id / credit_account_id parameters.
    // H1: Simplify join logic to prevent duplicates.
    const vouchers = await query(`
      SELECT v.id, v.voucher_number as voucher_no, v.voucher_type, v.voucher_date, v.amount,
             v.party_name, v.narration, v.cheque_number, v.cheque_date, v.transaction_ref,
             CASE WHEN v.debit_account_id = $1 THEN 'debit' ELSE 'credit' END as entry_type,
             CASE WHEN v.debit_account_id = $1 THEN v.amount ELSE 0 END as debit_amount,
             CASE WHEN v.credit_account_id = $1 THEN v.amount ELSE 0 END as credit_amount,
             br.id as recon_id,
             br.is_reconciled,
             br.reconciliation_date,
             br.bank_statement_date,
             br.bank_statement_ref,
             br.bank_amount
      FROM vouchers v
      LEFT JOIN bank_reconciliation br ON br.voucher_id = v.id AND br.bank_account_id = $1
      WHERE (v.debit_account_id = $1 OR v.credit_account_id = $1)
        AND v.status = 'posted'
        ${dateFilter}
        ${show_reconciled !== 'true' ? 'AND (br.is_reconciled IS NULL OR br.is_reconciled = 0)' : ''}
      ORDER BY v.voucher_date ASC, v.created_at ASC
    `, params);

    // Calculate balances
    // M5: Check if opening balance is valid for as_on_date. For now we assume opening_balance is always start of FY/company.
    const openingBalance = account.rows[0].opening_balance || 0;

    // Book balance = opening + all debits - all credits (up to to_date)
    // H2: Use consistent to_date filtering
    const bookParams = [accountId];
    let bookFilter = '';
    if (to_date) {
      bookParams.push(to_date);
      bookFilter = `AND DATE(v.voucher_date) <= DATE($${bookParams.length})`;
    }
    
    const allVouchers = await query(`
      SELECT
        COALESCE(SUM(CASE WHEN v.debit_account_id = $1 THEN v.amount ELSE 0 END), 0) as total_debits,
        COALESCE(SUM(CASE WHEN v.credit_account_id = $1 THEN v.amount ELSE 0 END), 0) as total_credits
      FROM vouchers v
      WHERE (v.debit_account_id = $1 OR v.credit_account_id = $1)
        AND v.status = 'posted'
        ${bookFilter}
    `, bookParams);

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
    
    // C2: Transaction wrapping for batch reconciliation
    const conn = await pool.getConnection();
    try {
      await conn.query('START TRANSACTION');

      for (const entry of entries) {
        const { voucher_id, bank_account_id, bank_statement_date, bank_statement_ref, bank_amount } = entry;
        if (!voucher_id || !bank_account_id) continue;

        // C5: Validate voucher date
        const [vCheck] = await conn.execute('SELECT voucher_date FROM vouchers WHERE id = ?', [voucher_id]);
        if (vCheck.length > 0 && bank_statement_date) {
          if (new Date(vCheck[0].voucher_date) > new Date(bank_statement_date)) {
            throw new Error(`Voucher date cannot be after bank statement date for voucher ID ${voucher_id}`);
          }
        }

        // H4: Parse numeric value safely
        const safeBankAmount = parseFloat(bank_amount || 0) || 0;
        if (isNaN(safeBankAmount)) throw new Error(`Invalid bank amount for voucher ID ${voucher_id}`);

        // M3: Check if already reconciled to a different date
        const [existing] = await conn.execute(
          'SELECT id, bank_statement_date FROM bank_reconciliation WHERE voucher_id = ? AND bank_account_id = ?',
          [voucher_id, bank_account_id]
        );

        if (existing.length > 0) {
          const exDate = existing[0].bank_statement_date ? new Date(existing[0].bank_statement_date).toISOString().split('T')[0] : null;
          const newDate = bank_statement_date ? new Date(bank_statement_date).toISOString().split('T')[0] : null;
          if (exDate && newDate && exDate !== newDate) {
            throw new Error(`Voucher ID ${voucher_id} is already reconciled to ${exDate}`);
          }

          await conn.execute(`
            UPDATE bank_reconciliation
            SET is_reconciled = 1,
                reconciliation_date = CURRENT_TIMESTAMP,
                bank_statement_date = ?,
                bank_statement_ref = ?,
                bank_amount = ?,
                reconciled_by = ?,
                reconciled_at = CURRENT_TIMESTAMP
            WHERE voucher_id = ? AND bank_account_id = ?
          `, [bank_statement_date || null, bank_statement_ref || null, safeBankAmount, req.user.userId, voucher_id, bank_account_id]);
        } else {
          await conn.execute(`
            INSERT INTO bank_reconciliation (bank_account_id, voucher_id, reconciliation_date, bank_statement_date, bank_statement_ref, bank_amount, is_reconciled, reconciled_at, reconciled_by)
            VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?)
          `, [bank_account_id, voucher_id, bank_statement_date || null, bank_statement_ref || null, safeBankAmount, req.user.userId]);
        }
        reconciled++;
      }
      
      await conn.query('COMMIT');
    } catch (err) {
      await conn.query('ROLLBACK');
      throw err;
    } finally {
      conn.release();
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
    
    // C3: Check permissions/who reconciled if we were to enforce strict audit. For now, allow but log unreconciled_by.
    // M7: Log unreconciled_by
    await query(`
      UPDATE bank_reconciliation
      SET is_reconciled = 0, reconciled_at = NULL, reconciled_by = NULL,
          unreconciled_by = $${voucher_ids.length + 2}, unreconciled_at = CURRENT_TIMESTAMP
      WHERE voucher_id IN (${placeholders}) AND bank_account_id = $${voucher_ids.length + 1}
    `, [...voucher_ids, bank_account_id, req.user.userId]);

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

    // Deposits not yet cleared (debits in book, not reconciled in CURRENT period)
    // H6: Include items not reconciled as of asOnDate
    // L1: Limit added to prevent massive payloads. UI can be enhanced later for pagination.
    const depositsNotCleared = await query(`
      SELECT v.id, v.voucher_number as voucher_no, v.voucher_date, v.amount, v.narration, v.cheque_number
      FROM vouchers v
      LEFT JOIN bank_reconciliation br ON br.voucher_id = v.id AND br.bank_account_id = $1
      WHERE v.debit_account_id = $1
        AND v.status = 'posted'
        AND DATE(v.voucher_date) <= DATE($2)
        AND (br.is_reconciled IS NULL OR br.is_reconciled = 0 OR DATE(br.bank_statement_date) > DATE($2))
      ORDER BY v.voucher_date DESC
      LIMIT 100 OFFSET 0
    `, [accountId, asOnDate]);

    // Cheques not yet presented (credits in book, not reconciled in CURRENT period)
    const chequesNotPresented = await query(`
      SELECT v.id, v.voucher_number as voucher_no, v.voucher_date, v.amount, v.narration, v.cheque_number
      FROM vouchers v
      LEFT JOIN bank_reconciliation br ON br.voucher_id = v.id AND br.bank_account_id = $1
      WHERE v.credit_account_id = $1
        AND v.status = 'posted'
        AND DATE(v.voucher_date) <= DATE($2)
        AND (br.is_reconciled IS NULL OR br.is_reconciled = 0 OR DATE(br.bank_statement_date) > DATE($2))
      ORDER BY v.voucher_date DESC
      LIMIT 100 OFFSET 0
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
        },
        // L7: Indication of reconciliation lag
        latest_reconciliation: await query('SELECT MAX(bank_statement_date) as last_date FROM bank_reconciliation WHERE bank_account_id = $1 AND is_reconciled = 1', [accountId]).then(r => r.rows[0]?.last_date || null)
      }
    });
  } catch (error) {
    logError(error, req, { feature: 'bank-reconciliation' });
    res.status(500).json({ success: false, message: 'Failed to generate BRS' });
  }
});

module.exports = router;
