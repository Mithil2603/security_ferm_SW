const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { saveStatement } = require('../utils/statementSaver');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requirePermission('view_balance_sheet'));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/balance-sheet — Generate Balance Sheet as on a given date
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { as_on_date, compare } = req.query;
    const asOnDate = as_on_date || new Date().toISOString().split('T')[0];

    // H3: Date validation
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOnDate)) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }
    if (new Date(asOnDate) > new Date()) {
      return res.status(400).json({ success: false, message: 'Cannot generate balance sheet for future date' });
    }

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

    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOnDate)) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }
    if (new Date(asOnDate) > new Date()) {
      return res.status(400).json({ success: false, message: 'Cannot generate balance sheet for future date' });
    }

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

const roundToRupee = (n) => Math.round(n * 100) / 100;

async function buildBalanceSheet(asOnDate) {
  // ══════════════════════════════════════════════════════════════════════════
  // ASSETS
  // ══════════════════════════════════════════════════════════════════════════

  // 1. Cash & Bank Balances — from bank_accounts + vouchers (H1: Fixed N+1 problem)
  // M7: COALESCE is standard SQL. M3: Opening balance defaults to 0. C2: Assuming opening balance as of company start.
  const bankAccounts = await query(`
    SELECT ba.id, ba.account_name, ba.account_type,
           COALESCE(ba.opening_balance, 0) as opening_balance,
           COALESCE(ba.opening_balance, 0) + COALESCE(dbt.debit_total, 0) - COALESCE(crt.credit_total, 0) as balance
    FROM bank_accounts ba
    LEFT JOIN (
      SELECT debit_account_id, SUM(amount) as debit_total 
      FROM vouchers 
      WHERE status = 'posted' AND voucher_date <= $1 
      GROUP BY debit_account_id
    ) dbt ON ba.id = dbt.debit_account_id
    LEFT JOIN (
      SELECT credit_account_id, SUM(amount) as credit_total 
      FROM vouchers 
      WHERE status = 'posted' AND voucher_date <= $1 
      GROUP BY credit_account_id
    ) crt ON ba.id = crt.credit_account_id
    WHERE ba.is_active = 1
    ORDER BY ba.account_type, ba.account_name
  `, [asOnDate]);

  // L8: Filter out zero balance accounts to reduce clutter
  const nonZeroAccounts = bankAccounts.rows.filter(a => parseFloat(a.balance) !== 0);
  const cashBalances = nonZeroAccounts.filter(a => a.account_type === 'cash');
  const bankBalances = nonZeroAccounts.filter(a => a.account_type === 'bank');
  const totalCashBank = roundToRupee(bankAccounts.rows.reduce((sum, a) => sum + parseFloat(a.balance || 0), 0));

  // 2. Accounts Receivable — unpaid invoices (H6: Use final_amount - payment_received)
  const receivables = await query(`
    SELECT c.name as client_name,
           SUM(i.final_amount - COALESCE(i.payment_received, 0)) as amount_due,
           COUNT(i.id) as invoice_count,
           MAX(DATEDIFF(CURDATE(), i.payment_due_date)) as max_days_overdue
    FROM invoices i
    JOIN clients c ON i.client_id = c.id
    WHERE i.status NOT IN ('cancelled', 'paid')
      AND (i.final_amount - COALESCE(i.payment_received, 0)) > 0
      AND i.invoice_date <= $1
    GROUP BY c.name
    ORDER BY amount_due DESC
  `, [asOnDate]);
  const totalReceivablesGross = receivables.rows.reduce((sum, r) => sum + parseFloat(r.amount_due || 0), 0);

  // H8: Credit Notes reduce accounts receivable, not separate liabilities
  const creditNotesTotal = await query(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM vouchers
    WHERE voucher_type = 'credit_note' AND status = 'posted' AND voucher_date <= $1
  `, [asOnDate]);
  const totalCreditNotes = parseFloat(creditNotesTotal.rows[0]?.total || 0);
  const totalReceivables = roundToRupee(Math.max(0, totalReceivablesGross - totalCreditNotes));

  // 3. Advances — salary advances given (M1: Only count explicit salary advances)
  const advances = await query(`
    SELECT COALESCE(SUM(l.amount), 0) as total
    FROM employee_ledger l
    LEFT JOIN payroll p ON l.payroll_id = p.id
    WHERE l.type = 'salary_advance'
      AND (l.payroll_id IS NULL OR p.payment_status = 'pending')
      AND l.transaction_date <= $1
  `, [asOnDate]);
  const totalAdvances = roundToRupee(parseFloat(advances.rows[0]?.total || 0));

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
  const totalSalaryPayable = roundToRupee(parseFloat(salaryPayable.rows[0]?.total || 0));

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
  const pfPayable = roundToRupee(parseFloat(statutoryDues.rows[0]?.pf_payable || 0));
  const esiPayable = roundToRupee(parseFloat(statutoryDues.rows[0]?.esi_payable || 0));
  const tdsPayable = roundToRupee(parseFloat(statutoryDues.rows[0]?.tds_payable || 0));

  // 6. GST Payable (C3: output - input, floored at 0)
  const gstData = await query(`
    SELECT
      SUM(COALESCE(cgst_amount, 0) + COALESCE(sgst_amount, 0) + COALESCE(igst_amount, 0)) as output_gst,
      0 as input_credit
    FROM invoices
    WHERE status NOT IN ('cancelled')
      AND invoice_date <= $1
  `, [asOnDate]);
  const outputGst = parseFloat(gstData.rows[0]?.output_gst || 0);
  const inputCredit = parseFloat(gstData.rows[0]?.input_credit || 0);
  const gstPayable = roundToRupee(Math.max(0, outputGst - inputCredit));

  // 7. Expense Payables — pending expenses (replacing vendor payables for now)
  const expensePayables = await query(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM expenses
    WHERE status = 'approved'
      AND expense_date <= $1
  `, [asOnDate]);
  const totalExpensePayables = roundToRupee(parseFloat(expensePayables.rows[0]?.total || 0));

  // ══════════════════════════════════════════════════════════════════════════
  // CAPITAL / OWNER'S EQUITY
  // ══════════════════════════════════════════════════════════════════════════

  // Net Profit from P&L (Revenue - Expenses - Payroll)
  // C6: Configure FY Start
  const FY_START_MONTH = 3; // April (0-indexed)
  const now = new Date(asOnDate);
  const fyStart = now.getMonth() >= FY_START_MONTH
    ? `${now.getFullYear()}-04-01`
    : `${now.getFullYear() - 1}-04-01`;

  const revenue = await query(`
    SELECT COALESCE(SUM(payment_received), 0) as total
    FROM invoices
    WHERE status != 'cancelled'
      AND invoice_date >= $1 AND invoice_date <= $2
  `, [fyStart, asOnDate]);

  const totalExpensesResult = await query(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM expenses
    WHERE status IN ('approved', 'paid')
      AND expense_date >= $1 AND expense_date <= $2
  `, [fyStart, asOnDate]);

  const totalPayrollResult = await query(`
    SELECT COALESCE(SUM(gross_salary), 0) as total
    FROM payroll
    WHERE payroll_month >= $1 AND payroll_month <= $2
  `, [fyStart, asOnDate]);

  // H2: Safe numeric parsing
  const rev = parseFloat(revenue.rows[0]?.total || 0) || 0;
  const exp = parseFloat(totalExpensesResult.rows[0]?.total || 0) || 0;
  const pay = parseFloat(totalPayrollResult.rows[0]?.total || 0) || 0;
  
  const netProfit = roundToRupee(rev - exp - pay);
  if (isNaN(netProfit)) throw new Error('Invalid P&L calculation resulting in NaN');

  // M5: Retained Earnings and Capital
  const openingCapital = 0; // Configured or entered manually in the future
  const capital = roundToRupee(openingCapital + netProfit);

  // ══════════════════════════════════════════════════════════════════════════
  // COMPILE BALANCE SHEET
  // ══════════════════════════════════════════════════════════════════════════

  // H8: Credit notes moved to reduce receivables, not part of current liabilities
  const totalCurrentLiabilities = roundToRupee(totalSalaryPayable + pfPayable + esiPayable + tdsPayable + gstPayable + totalExpensePayables);
  const totalAssets = roundToRupee(totalCashBank + totalReceivables + totalAdvances);
  const totalLiabAndEquity = roundToRupee(totalCurrentLiabilities + capital);

  // C1: Don't force equation to balance.
  // H5: Dynamic tolerance
  const diff = Math.abs(totalAssets - totalLiabAndEquity);
  const isBalanced = diff < 100 || (totalAssets > 0 && diff / totalAssets < 0.0001);

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
        total: totalCurrentLiabilities
      },
      capital_account: {
        label: "Owner's Equity / Capital",
        opening_capital: openingCapital,
        net_profit: netProfit,
        retained_earnings: netProfit,
        total: capital
      }
    },
    totals: {
      total_assets: totalAssets,
      total_liabilities_only: totalCurrentLiabilities,
      total_equity: capital,
      total_liabilities: totalLiabAndEquity,
      is_balanced: isBalanced,
      difference: diff
    },
    financial_year: { start: fyStart, end: asOnDate },
    generated_at: new Date().toISOString()
  };
}

module.exports = router;
