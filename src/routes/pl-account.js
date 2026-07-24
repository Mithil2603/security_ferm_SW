const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { saveStatement } = require('../utils/statementSaver');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requirePermission('view_pl_account'));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pl-account — Generate full Profit & Loss statement
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { from_date, to_date, compare } = req.query;

    // Default: Indian Financial Year (April 1 → today)
    const now = new Date();
    const fyStart = now.getMonth() >= 3
      ? `${now.getFullYear()}-04-01`
      : `${now.getFullYear() - 1}-04-01`;

    const fromDate = from_date || fyStart;
    const toDate = to_date || now.toISOString().split('T')[0];

    const currentPeriod = await buildPeriodData(fromDate, toDate);

    let previousPeriod = null;
    if (compare === 'true') {
      // Previous year same months
      const prevFrom = shiftYear(fromDate, -1);
      const prevTo = shiftYear(toDate, -1);
      previousPeriod = await buildPeriodData(prevFrom, prevTo);
    }

    // Monthly trend for 12 months of the year containing fromDate
    const trendYear = parseInt(fromDate.substring(0, 4));
    const monthlyTrend = await buildMonthlyTrend(trendYear, trendYear + 1);

    res.json({
      success: true,
      data: {
        current_period: currentPeriod,
        previous_period: previousPeriod,
        monthly_trend: monthlyTrend
      }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'pl-account' });
    logger.error('P&L Account error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate P&L statement' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/pl-account/generate — Generate & save to Statement Archive
// ─────────────────────────────────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  try {
    const { from_date, to_date } = req.body;
    const now = new Date();
    const fyStart = now.getMonth() >= 3
      ? `${now.getFullYear()}-04-01`
      : `${now.getFullYear() - 1}-04-01`;

    const fromDate = from_date || fyStart;
    const toDate = to_date || now.toISOString().split('T')[0];

    const periodData = await buildPeriodData(fromDate, toDate);

    // Save to archive
    saveStatement({
      domain: 'invoice',
      statement_number: `PL-${fromDate}-to-${toDate}`,
      title: `Profit & Loss Account: ${formatDateShort(fromDate)} to ${formatDateShort(toDate)}`,
      reference_id: null,
      reference_type: 'pl_account',
      statement_data: periodData,
      total_amount: periodData.net_profit,
      tax_amount: periodData.tax_summary.gst_collected,
      period_from: fromDate,
      period_to: toDate,
      party_name: 'Agency P&L',
      party_id: null,
      generated_by: req.user.userId
    });

    res.json({
      success: true,
      message: 'P&L statement generated and archived',
      data: periodData
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'pl-account' });
    logger.error('P&L generate error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate P&L statement' });
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

async function buildPeriodData(fromDate, toDate) {
  // ── 1. INCOME ──────────────────────────────────────────────────────────────
  const revenueTotal = await query(
    `SELECT COALESCE(SUM(payment_received), 0) as total_collected,
            COALESCE(SUM(final_amount), 0) as total_billed,
            COUNT(*) as invoice_count
     FROM invoices
     WHERE status != 'cancelled'
       AND invoice_date >= date($1)
       AND invoice_date <= date($2)`,
    [fromDate, toDate]
  );

  const revenueByClient = await query(
    `SELECT c.name, COALESCE(SUM(i.payment_received), 0) as collected,
            COALESCE(SUM(i.final_amount), 0) as billed,
            COUNT(i.id) as count
     FROM invoices i
     JOIN clients c ON i.client_id = c.id
     WHERE i.status != 'cancelled'
       AND i.invoice_date >= date($1)
       AND i.invoice_date <= date($2)
     GROUP BY c.name
     ORDER BY collected DESC`,
    [fromDate, toDate]
  );

  // ── 2. COST OF SERVICES (Payroll) ──────────────────────────────────────────
  const payrollTotal = await query(
    `SELECT COALESCE(SUM(net_salary), 0) as total_payroll,
            COALESCE(SUM(gross_salary), 0) as total_gross,
            COALESCE(SUM(pf_deduction), 0) as total_pf,
            COALESCE(SUM(esi_deduction), 0) as total_esi,
            COALESCE(SUM(tax_deduction), 0) as total_tax,
            COUNT(DISTINCT employee_id) as employee_count
     FROM payroll
     WHERE date(payroll_month, 'start of month') <= date($2)
       AND (date(payroll_month, 'start of month', '+1 month', '-1 day')) >= date($1)`,
    [fromDate, toDate]
  );

  const payrollByEmployee = await query(
    `SELECT e.full_name as name, e.employee_id as emp_id,
            COALESCE(SUM(p.net_salary), 0) as net_salary,
            COALESCE(SUM(p.gross_salary), 0) as gross_salary,
            COUNT(p.id) as months_count
     FROM payroll p
     JOIN employees e ON p.employee_id = e.id
     WHERE date(p.payroll_month, 'start of month') <= date($2)
       AND (date(p.payroll_month, 'start of month', '+1 month', '-1 day')) >= date($1)
     GROUP BY e.full_name, e.employee_id
     ORDER BY net_salary DESC`,
    [fromDate, toDate]
  );

  // ── 3. OPERATING EXPENSES ──────────────────────────────────────────────────
  const expenseTotal = await query(
    `SELECT COALESCE(SUM(amount), 0) as total_expenses,
            COUNT(*) as expense_count
     FROM expenses
     WHERE status IN ('approved', 'paid')
       AND expense_date >= date($1)
       AND expense_date <= date($2)`,
    [fromDate, toDate]
  );

  const expenseByCategory = await query(
    `SELECT category as name, COALESCE(SUM(amount), 0) as amount, COUNT(*) as count
     FROM expenses
     WHERE status IN ('approved', 'paid')
       AND expense_date >= date($1)
       AND expense_date <= date($2)
     GROUP BY category
     HAVING SUM(amount) > 0
     ORDER BY amount DESC`,
    [fromDate, toDate]
  );

  const expenseByVendor = await query(
    `SELECT COALESCE(v.name, 'Direct Expense') as name,
            COALESCE(SUM(e.amount), 0) as amount, COUNT(e.id) as count
     FROM expenses e
     LEFT JOIN vendors v ON e.vendor_id = v.id
     WHERE e.status IN ('approved', 'paid')
       AND e.expense_date >= date($1)
       AND e.expense_date <= date($2)
     GROUP BY v.name
     HAVING SUM(e.amount) > 0
     ORDER BY amount DESC`,
    [fromDate, toDate]
  );

  // ── 4. TAX SUMMARY ────────────────────────────────────────────────────────
  const gstData = await query(
    `SELECT COALESCE(SUM(cgst_amount + sgst_amount + igst_amount), 0) as gst_collected,
            COALESCE(SUM(cgst_amount), 0) as total_cgst,
            COALESCE(SUM(sgst_amount), 0) as total_sgst,
            COALESCE(SUM(igst_amount), 0) as total_igst
     FROM invoices
     WHERE status != 'cancelled'
       AND invoice_date >= date($1)
       AND invoice_date <= date($2)`,
    [fromDate, toDate]
  );

  const tdsData = await query(
    `SELECT COALESCE(SUM(tds_deducted), 0) as total_tds
     FROM payments
     WHERE payment_date >= $1 AND payment_date <= $2 AND tds_deducted > 0`,
    [fromDate, toDate]
  );

  // ── CALCULATIONS ───────────────────────────────────────────────────────────
  const totalIncome = parseFloat(revenueTotal.rows[0].total_collected);
  const totalBilled = parseFloat(revenueTotal.rows[0].total_billed);
  const totalPayroll = parseFloat(payrollTotal.rows[0].total_gross);
  const totalExpenses = parseFloat(expenseTotal.rows[0].total_expenses);
  const grossProfit = totalIncome - totalPayroll;
  const grossMargin = totalIncome > 0 ? parseFloat((grossProfit / totalIncome * 100).toFixed(2)) : 0;
  const netProfit = grossProfit - totalExpenses;
  const netMargin = totalIncome > 0 ? parseFloat((netProfit / totalIncome * 100).toFixed(2)) : 0;

  return {
    period: { from: fromDate, to: toDate },
    income: {
      total: totalIncome,
      total_billed: totalBilled,
      invoice_count: parseInt(revenueTotal.rows[0].invoice_count),
      by_client: revenueByClient.rows.map(r => ({
        name: r.name,
        collected: parseFloat(r.collected),
        billed: parseFloat(r.billed),
        count: parseInt(r.count)
      }))
    },
    cost_of_services: {
      total: totalPayroll,
      gross_payroll: parseFloat(payrollTotal.rows[0].total_gross),
      pf_total: parseFloat(payrollTotal.rows[0].total_pf),
      esi_total: parseFloat(payrollTotal.rows[0].total_esi),
      tax_total: parseFloat(payrollTotal.rows[0].total_tax),
      employee_count: parseInt(payrollTotal.rows[0].employee_count),
      by_employee: payrollByEmployee.rows.map(r => ({
        name: r.name,
        emp_id: r.emp_id,
        net_salary: parseFloat(r.net_salary),
        gross_salary: parseFloat(r.gross_salary),
        months: parseInt(r.months_count)
      }))
    },
    operating_expenses: {
      total: totalExpenses,
      expense_count: parseInt(expenseTotal.rows[0].expense_count),
      by_category: expenseByCategory.rows.map(r => ({
        name: r.name,
        amount: parseFloat(r.amount),
        count: parseInt(r.count)
      })),
      by_vendor: expenseByVendor.rows.map(r => ({
        name: r.name,
        amount: parseFloat(r.amount),
        count: parseInt(r.count)
      }))
    },
    gross_profit: grossProfit,
    gross_margin: grossMargin,
    net_profit: netProfit,
    net_margin: netMargin,
    tax_summary: {
      gst_collected: parseFloat(gstData.rows[0].gst_collected),
      cgst: parseFloat(gstData.rows[0].total_cgst),
      sgst: parseFloat(gstData.rows[0].total_sgst),
      igst: parseFloat(gstData.rows[0].total_igst),
      tds_deducted: parseFloat(tdsData.rows[0].total_tds)
    }
  };
}

async function buildMonthlyTrend(startYear, endYear) {
  const months = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  const trend = [];

  for (let i = 0; i < 12; i++) {
    const monthIdx = (i + 3) % 12; // April=3 → March=2
    const year = monthIdx >= 3 ? startYear : endYear;
    const monthNum = monthIdx + 1;
    const monthStart = `${year}-${String(monthNum).padStart(2, '0')}-01`;

    // Revenue
    const rev = await query(
      `SELECT COALESCE(SUM(payment_received), 0) as revenue,
              COALESCE(SUM(final_amount), 0) as billed
       FROM invoices
       WHERE status != 'cancelled'
         AND strftime('%Y-%m', invoice_date) = $1`,
      [`${year}-${String(monthNum).padStart(2, '0')}`]
    );

    // Payroll
    const pay = await query(
      `SELECT COALESCE(SUM(gross_salary), 0) as payroll
       FROM payroll
       WHERE strftime('%Y-%m', payroll_month) = $1`,
      [`${year}-${String(monthNum).padStart(2, '0')}`]
    );

    // Expenses
    const exp = await query(
      `SELECT COALESCE(SUM(amount), 0) as expenses
       FROM expenses
       WHERE status IN ('approved', 'paid')
         AND strftime('%Y-%m', expense_date) = $1`,
      [`${year}-${String(monthNum).padStart(2, '0')}`]
    );

    const revenue = parseFloat(rev.rows[0].revenue);
    const payroll = parseFloat(pay.rows[0].payroll);
    const expenses = parseFloat(exp.rows[0].expenses);
    const totalCosts = payroll + expenses;
    const profit = revenue - totalCosts;

    trend.push({
      month: months[i],
      month_num: monthNum,
      year,
      revenue,
      billed: parseFloat(rev.rows[0].billed),
      payroll,
      expenses,
      total_costs: totalCosts,
      profit
    });
  }

  return trend;
}

module.exports = router;
