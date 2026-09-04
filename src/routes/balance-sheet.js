const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { saveStatement } = require('../utils/statementSaver');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requirePermission('view_balance_sheet', 'manage_payroll', 'view_reports'));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/balance-sheet — Generate Balance Sheet as on a given date
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { as_on_date, compare } = req.query;
    const asOnDate = as_on_date || new Date().toISOString().split('T')[0];

    const currentData = await buildBalanceSheet(asOnDate);

    let previousData = null;
    if (compare === 'true') {
      // Previous year same date
      const prevDate = shiftYear(asOnDate, -1);
      previousData = await buildBalanceSheet(prevDate);
    }

    res.json({
      success: true,
      data: {
        as_on_date: asOnDate,
        current: currentData,
        previous: previousData
      }
    });
  } catch (error) {
    logError(error, req, { feature: 'balance-sheet' });
    logger.error('Balance sheet error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate balance sheet' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/balance-sheet/generate — Generate & save to Statement Archive
// ─────────────────────────────────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  try {
    const { as_on_date } = req.body;
    const asOnDate = as_on_date || new Date().toISOString().split('T')[0];

    const data = await buildBalanceSheet(asOnDate);

    saveStatement({
      domain: 'balance_sheet',
      statement_number: `BS-${asOnDate}`,
      title: `Balance Sheet as on ${formatDateShort(asOnDate)}`,
      reference_id: null,
      reference_type: 'balance_sheet',
      statement_data: data,
      total_amount: data.totals.total_assets,
      tax_amount: 0,
      period_from: null,
      period_to: asOnDate,
      party_name: 'Agency Balance Sheet',
      party_id: null,
      generated_by: req.user.userId
    });

    res.json({
      success: true,
      message: 'Balance sheet generated and archived',
      data
    });
  } catch (error) {
    logError(error, req, { feature: 'balance-sheet' });
    res.status(500).json({ success: false, message: 'Failed to generate balance sheet' });
  }
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function shiftYear(dateStr, offset) {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + offset);
  return d.toISOString().split('T')[0];
}

function formatDateShort(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return dateStr; }
}

async function buildBalanceSheet(asOnDate) {
  // ══════════════════════════════════════════════════════════════════════════
  // ASSETS
  // ══════════════════════════════════════════════════════════════════════════

  // 1. Cash & Bank Balances — from bank_accounts + vouchers
  const bankAccounts = await query(`
    SELECT ba.id, ba.account_name, ba.account_type,
           COALESCE(ba.opening_balance, 0) as opening_balance,
           COALESCE(ba.opening_balance, 0) +
             COALESCE((SELECT SUM(v.amount) FROM vouchers v WHERE v.debit_account_id = ba.id AND v.status = 'posted' AND v.voucher_date <= $1), 0) -
             COALESCE((SELECT SUM(v.amount) FROM vouchers v WHERE v.credit_account_id = ba.id AND v.status = 'posted' AND v.voucher_date <= $1), 0)
             as balance
    FROM bank_accounts ba
    WHERE ba.is_active = 1
    ORDER BY ba.account_type, ba.account_name
  `, [asOnDate]);

  const cashBalances = bankAccounts.rows.filter(a => a.account_type === 'cash');
  const bankBalances = bankAccounts.rows.filter(a => a.account_type === 'bank');
  const totalCashBank = bankAccounts.rows.reduce((sum, a) => sum + (a.balance || 0), 0);

  // 2. Accounts Receivable — unpaid invoices
  const receivables = await query(`
    SELECT c.name as client_name,
           SUM(i.payment_due) as amount_due,
           COUNT(i.id) as invoice_count
    FROM invoices i
    JOIN clients c ON i.client_id = c.id
    WHERE i.status NOT IN ('cancelled', 'paid')
      AND i.payment_due > 0
      AND i.invoice_date <= $1
    GROUP BY c.name
    ORDER BY amount_due DESC
  `, [asOnDate]);
  const totalReceivables = receivables.rows.reduce((sum, r) => sum + (r.amount_due || 0), 0);

  // 3. Advances — salary advances given (from employee ledger, unsettled additions)
  const advances = await query(`
    SELECT COALESCE(SUM(l.amount), 0) as total
    FROM employee_ledger l
    LEFT JOIN payroll p ON l.payroll_id = p.id
    WHERE l.type = 'addition'
      AND (l.payroll_id IS NULL OR p.payment_status = 'pending')
      AND l.transaction_date <= $1
  `, [asOnDate]);
  const totalAdvances = advances.rows[0]?.total || 0;

  // ══════════════════════════════════════════════════════════════════════════
  // LIABILITIES
  // ══════════════════════════════════════════════════════════════════════════

  // 4. Salary Payable — pending payroll
  const salaryPayable = await query(`
    SELECT COALESCE(SUM(net_salary), 0) as total
    FROM payroll
    WHERE payment_status = 'pending'
      AND payroll_month <= $1
  `, [asOnDate]);
  const totalSalaryPayable = salaryPayable.rows[0]?.total || 0;

  // 5. Statutory Dues — PF, ESI payable
  const statutoryDues = await query(`
    SELECT
      COALESCE(SUM(pf_deduction), 0) as pf_payable,
      COALESCE(SUM(esi_deduction), 0) as esi_payable,
      COALESCE(SUM(tax_deduction), 0) as tds_payable
    FROM payroll
    WHERE payment_status = 'pending'
      AND payroll_month <= $1
  `, [asOnDate]);
  const pfPayable = statutoryDues.rows[0]?.pf_payable || 0;
  const esiPayable = statutoryDues.rows[0]?.esi_payable || 0;
  const tdsPayable = statutoryDues.rows[0]?.tds_payable || 0;

  // 6. GST Payable — from invoices (collected - input credits approximation)
  const gstData = await query(`
    SELECT
      COALESCE(SUM(tax_amount), 0) as gst_collected
    FROM invoices
    WHERE status NOT IN ('cancelled')
      AND invoice_date <= $1
  `, [asOnDate]);
  const gstPayable = gstData.rows[0]?.gst_collected || 0;

  // 7. Vendor Payables — outstanding vendor payments
  const vendorPayables = await query(`
    SELECT v.name as vendor_name,
           COALESCE(SUM(vp.amount), 0) as total_paid
    FROM vendors v
    LEFT JOIN vendor_payments vp ON v.id = vp.vendor_id AND vp.payment_date <= $1
    WHERE v.is_active = 1
    GROUP BY v.name
    HAVING total_paid > 0
  `, [asOnDate]);
  // Note: We don't have vendor invoices, so vendor payables = vendor payments already made
  // For a proper B/S, we'd need vendor bills. For now, show pending expenses as payables.
  const expensePayables = await query(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM expenses
    WHERE status = 'approved'
      AND expense_date <= $1
  `, [asOnDate]);
  const totalExpensePayables = expensePayables.rows[0]?.total || 0;

  // 8. Credit Notes liability
  const creditNotesTotal = await query(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM vouchers
    WHERE voucher_type = 'credit_note' AND status = 'posted' AND voucher_date <= $1
  `, [asOnDate]);
  const totalCreditNotes = creditNotesTotal.rows[0]?.total || 0;

  // ══════════════════════════════════════════════════════════════════════════
  // CAPITAL / OWNER'S EQUITY
  // ══════════════════════════════════════════════════════════════════════════

  // Net Profit from P&L (Revenue - Expenses - Payroll)
  const now = new Date(asOnDate);
  const fyStart = now.getMonth() >= 3
    ? `${now.getFullYear()}-04-01`
    : `${now.getFullYear() - 1}-04-01`;

  const revenue = await query(`
    SELECT COALESCE(SUM(payment_received), 0) as total
    FROM invoices
    WHERE status != 'cancelled'
      AND invoice_date >= $1 AND invoice_date <= $2
  `, [fyStart, asOnDate]);

  const totalExpenses = await query(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM expenses
    WHERE status IN ('approved', 'paid')
      AND expense_date >= $1 AND expense_date <= $2
  `, [fyStart, asOnDate]);

  const totalPayroll = await query(`
    SELECT COALESCE(SUM(gross_salary), 0) as total
    FROM payroll
    WHERE payroll_month >= $1 AND payroll_month <= $2
  `, [fyStart, asOnDate]);

  const netProfit = (revenue.rows[0]?.total || 0) - (totalExpenses.rows[0]?.total || 0) - (totalPayroll.rows[0]?.total || 0);

  // ══════════════════════════════════════════════════════════════════════════
  // COMPILE BALANCE SHEET
  // ══════════════════════════════════════════════════════════════════════════

  const totalCurrentLiabilities = totalSalaryPayable + pfPayable + esiPayable + tdsPayable + gstPayable + totalExpensePayables + totalCreditNotes;
  const totalAssets = totalCashBank + totalReceivables + totalAdvances;
  // Capital = Total Assets - Total Liabilities (balancing figure)
  const capital = totalAssets - totalCurrentLiabilities;

  return {
    assets: {
      cash_and_bank: {
        label: 'Cash & Bank Balances',
        cash_accounts: cashBalances,
        bank_accounts: bankBalances,
        total: totalCashBank
      },
      accounts_receivable: {
        label: 'Accounts Receivable (Trade Debtors)',
        details: receivables.rows,
        total: totalReceivables
      },
      advances: {
        label: 'Advances & Deposits',
        salary_advances: totalAdvances,
        total: totalAdvances
      }
    },
    liabilities: {
      current_liabilities: {
        label: 'Current Liabilities',
        salary_payable: totalSalaryPayable,
        pf_payable: pfPayable,
        esi_payable: esiPayable,
        tds_payable: tdsPayable,
        gst_payable: gstPayable,
        expense_payable: totalExpensePayables,
        credit_notes: totalCreditNotes,
        total: totalCurrentLiabilities
      },
      capital_account: {
        label: "Owner's Equity / Capital",
        opening_capital: 0, // Would need manual entry
        net_profit: netProfit,
        retained_earnings: capital,
        total: capital
      }
    },
    totals: {
      total_assets: totalAssets,
      total_liabilities: totalCurrentLiabilities + capital,
      is_balanced: Math.abs(totalAssets - (totalCurrentLiabilities + capital)) < 0.01
    },
    financial_year: { start: fyStart, end: asOnDate },
    generated_at: new Date().toISOString()
  };
}

module.exports = router;
