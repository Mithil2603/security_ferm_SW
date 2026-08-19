const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const ExcelJS = require('exceljs');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requirePermission('view_reports'));

// GET /api/reports/client-revenue
router.get('/client-revenue', async (req, res) => {
  try {
    const { from_date, to_date, client_id } = req.query;
    let conditions = ["i.status != 'cancelled'"];
    let params = [];
    let pc = 1;

    if (from_date) { conditions.push(`i.invoice_date >= $${pc}`); params.push(from_date); pc++; }
    if (to_date) { conditions.push(`i.invoice_date <= $${pc}`); params.push(to_date); pc++; }
    if (client_id) { conditions.push(`i.client_id = $${pc}`); params.push(client_id); pc++; }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await query(
      `SELECT c.id, c.name as client_name, c.city,
        COUNT(i.id) as invoice_count,
        COALESCE(SUM(i.final_amount), 0) as total_billed,
        COALESCE(SUM(i.payment_received), 0) as total_paid,
        COALESCE(SUM(i.payment_due), 0) as total_due,
        ROUND(CASE WHEN SUM(i.final_amount) > 0 THEN SUM(i.payment_received) * 100.0 / SUM(i.final_amount) ELSE 0 END, 2) as collection_rate
       FROM clients c
       LEFT JOIN invoices i ON c.id = i.client_id ${from_date || to_date || client_id ? `AND ${conditions.filter(c => c !== "i.status != 'cancelled'").join(' AND ')}` : ''}
       WHERE c.is_active = true
       GROUP BY c.id, c.name, c.city
       ORDER BY total_billed DESC`,
      params
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    logger.error('Client revenue report error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate client revenue report' });
  }
});

// GET /api/reports/monthly-revenue
router.get('/monthly-revenue', async (req, res) => {
  try {
    const { year = new Date().getFullYear() } = req.query;
    const result = await query(
      `SELECT 
        strftime('%Y-%m', invoice_date) as month,
        (CASE strftime('%m', invoice_date) WHEN '01' THEN 'Jan ' WHEN '02' THEN 'Feb ' WHEN '03' THEN 'Mar ' WHEN '04' THEN 'Apr ' WHEN '05' THEN 'May ' WHEN '06' THEN 'Jun ' WHEN '07' THEN 'Jul ' WHEN '08' THEN 'Aug ' WHEN '09' THEN 'Sep ' WHEN '10' THEN 'Oct ' WHEN '11' THEN 'Nov ' WHEN '12' THEN 'Dec ' END) || strftime('%Y', invoice_date) as month_label,
        COUNT(*) as invoice_count,
        COALESCE(SUM(final_amount), 0) as total_billed,
        COALESCE(SUM(payment_received), 0) as total_paid,
        COALESCE(SUM(payment_due), 0) as total_due
       FROM invoices
       WHERE CAST(strftime('%Y', invoice_date) AS INTEGER) = $1 AND status != 'cancelled'
       GROUP BY strftime('%Y-%m', invoice_date), (CASE strftime('%m', invoice_date) WHEN '01' THEN 'Jan ' WHEN '02' THEN 'Feb ' WHEN '03' THEN 'Mar ' WHEN '04' THEN 'Apr ' WHEN '05' THEN 'May ' WHEN '06' THEN 'Jun ' WHEN '07' THEN 'Jul ' WHEN '08' THEN 'Aug ' WHEN '09' THEN 'Sep ' WHEN '10' THEN 'Oct ' WHEN '11' THEN 'Nov ' WHEN '12' THEN 'Dec ' END) || strftime('%Y', invoice_date)
       ORDER BY month ASC`,
      [year]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    res.status(500).json({ success: false, message: 'Failed to generate monthly revenue report' });
  }
});

// GET /api/reports/expense-summary
router.get('/expense-summary', async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const year = new Date().getFullYear();

    // Use precise parameterized date range if provided, else fall back to current year
    let categoryParams, categoryWhere;
    if (from_date && to_date) {
      categoryWhere = `AND expense_date >= date($1) AND expense_date <= date($2)`;
      categoryParams = [from_date, to_date];
    } else if (from_date) {
      categoryWhere = `AND expense_date >= date($1)`;
      categoryParams = [from_date];
    } else {
      categoryWhere = `AND CAST(strftime('%Y', expense_date) AS INTEGER) = $1`;
      categoryParams = [year];
    }

    const byCategory = await query(
      `SELECT category, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
       FROM expenses
       WHERE status IN ('approved', 'paid') ${categoryWhere}
       GROUP BY category ORDER BY total DESC`,
      categoryParams
    );

    // Monthly breakdown always shows data for the date range
    let monthlyParams, monthlyWhere;
    if (from_date && to_date) {
      monthlyWhere = `AND expense_date >= date($1) AND expense_date <= date($2)`;
      monthlyParams = [from_date, to_date];
    } else {
      monthlyWhere = `AND CAST(strftime('%Y', expense_date) AS INTEGER) = $1`;
      monthlyParams = [year];
    }

    const monthly = await query(
      `SELECT strftime('%Y-%m', expense_date) as month,
        (CASE strftime('%m', expense_date) WHEN '01' THEN 'Jan ' WHEN '02' THEN 'Feb ' WHEN '03' THEN 'Mar ' WHEN '04' THEN 'Apr ' WHEN '05' THEN 'May ' WHEN '06' THEN 'Jun ' WHEN '07' THEN 'Jul ' WHEN '08' THEN 'Aug ' WHEN '09' THEN 'Sep ' WHEN '10' THEN 'Oct ' WHEN '11' THEN 'Nov ' WHEN '12' THEN 'Dec ' END) || strftime('%Y', expense_date) as month_label,
        COALESCE(SUM(amount), 0) as total
       FROM expenses
       WHERE status IN ('approved', 'paid') ${monthlyWhere}
       GROUP BY strftime('%Y-%m', expense_date), (CASE strftime('%m', expense_date) WHEN '01' THEN 'Jan ' WHEN '02' THEN 'Feb ' WHEN '03' THEN 'Mar ' WHEN '04' THEN 'Apr ' WHEN '05' THEN 'May ' WHEN '06' THEN 'Jun ' WHEN '07' THEN 'Jul ' WHEN '08' THEN 'Aug ' WHEN '09' THEN 'Sep ' WHEN '10' THEN 'Oct ' WHEN '11' THEN 'Nov ' WHEN '12' THEN 'Dec ' END) || strftime('%Y', expense_date)
       ORDER BY month ASC`,
      monthlyParams
    );

    res.json({ success: true, data: { by_category: byCategory.rows, monthly: monthly.rows } });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    res.status(500).json({ success: false, message: 'Failed to generate expense report' });
  }
});

// GET /api/reports/payroll-summary
router.get('/payroll-summary', async (req, res) => {
  try {
    const { month, year = new Date().getFullYear() } = req.query;

    let whereClause = `WHERE CAST(strftime('%Y', payroll_month) AS INTEGER) = $1`;
    let params = [year];

    if (month) {
      whereClause += ` AND CAST(strftime('%m', payroll_month) AS INTEGER) = $2`;
      params.push(month);
    }

    const result = await query(
      `SELECT 
        strftime('%Y-%m', payroll_month) as month,
        (CASE strftime('%m', payroll_month) WHEN '01' THEN 'Jan ' WHEN '02' THEN 'Feb ' WHEN '03' THEN 'Mar ' WHEN '04' THEN 'Apr ' WHEN '05' THEN 'May ' WHEN '06' THEN 'Jun ' WHEN '07' THEN 'Jul ' WHEN '08' THEN 'Aug ' WHEN '09' THEN 'Sep ' WHEN '10' THEN 'Oct ' WHEN '11' THEN 'Nov ' WHEN '12' THEN 'Dec ' END) || strftime('%Y', payroll_month) as month_label,
        COUNT(*) as employee_count,
        COALESCE(SUM(gross_salary), 0) as total_gross,
        COALESCE(SUM(pf_deduction), 0) as total_pf,
        COALESCE(SUM(net_salary), 0) as total_net,
        SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) as paid_count,
        SUM(CASE WHEN payment_status = 'pending' THEN 1 ELSE 0 END) as pending_count
       FROM payroll ${whereClause}
       GROUP BY strftime('%Y-%m', payroll_month), (CASE strftime('%m', payroll_month) WHEN '01' THEN 'Jan ' WHEN '02' THEN 'Feb ' WHEN '03' THEN 'Mar ' WHEN '04' THEN 'Apr ' WHEN '05' THEN 'May ' WHEN '06' THEN 'Jun ' WHEN '07' THEN 'Jul ' WHEN '08' THEN 'Aug ' WHEN '09' THEN 'Sep ' WHEN '10' THEN 'Oct ' WHEN '11' THEN 'Nov ' WHEN '12' THEN 'Dec ' END) || strftime('%Y', payroll_month)
       ORDER BY month DESC`,
      params
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    res.status(500).json({ success: false, message: 'Failed to generate payroll report' });
  }
});

// GET /api/reports/profit-loss
router.get('/profit-loss', async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const fromDate = from_date || `${new Date().getFullYear()}-01-01`;
    const toDate   = to_date   || new Date().toISOString().split('T')[0];

    // ── Revenue: filter by exact invoice date within the range ──────────────
    const revenue = await query(
      `SELECT COALESCE(SUM(payment_received), 0) as total_revenue,
              COALESCE(SUM(final_amount),     0) as total_billed
       FROM invoices
       WHERE status != 'cancelled'
         AND invoice_date >= date($1)
         AND invoice_date <= date($2)`,
      [fromDate, toDate]
    );

    // ── Expenses: filter by exact expense date ───────────────────────────────
    const expenses = await query(
      `SELECT COALESCE(SUM(amount), 0) as total_expenses
       FROM expenses
       WHERE status IN ('approved', 'paid')
         AND expense_date >= date($1)
         AND expense_date <= date($2)`,
      [fromDate, toDate]
    );

    // ── Payroll: any payroll month that overlaps the selected date range ─────
    // payroll_month is stored as the 1st of each month (e.g. 2026-04-01).
    // A month overlaps the range if:  month_start <= toDate  AND  month_end >= fromDate
    // month_end  = (date(payroll_month, 'start of month', '+1 month', '-1 day'))
    const payroll = await query(
      `SELECT COALESCE(SUM(net_salary), 0) as total_payroll
       FROM payroll
       WHERE date(payroll_month, 'start of month') <= date($2)
         AND (date(payroll_month, 'start of month', '+1 month', '-1 day')) >= date($1)`,
      [fromDate, toDate]
    );

    const totalRevenue  = parseFloat(revenue.rows[0].total_revenue);
    const totalExpenses = parseFloat(expenses.rows[0].total_expenses);
    const totalPayroll  = parseFloat(payroll.rows[0].total_payroll);
    const totalCosts    = totalExpenses + totalPayroll;
    const profit        = totalRevenue - totalCosts;
    const margin        = totalRevenue > 0 ? (profit / totalRevenue * 100).toFixed(2) : 0;

    // ── Revenue breakdown by client ──────────────────────────────────────────
    const revenueDetails = await query(
      `SELECT c.name, COALESCE(SUM(i.payment_received), 0) as amount
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       WHERE i.status != 'cancelled'
         AND i.invoice_date >= date($1)
         AND i.invoice_date <= date($2)
       GROUP BY c.name
       HAVING SUM(i.payment_received) > 0
       ORDER BY amount DESC`,
      [fromDate, toDate]
    );

    // ── Expense breakdown by category ────────────────────────────────────────
    const expenseDetails = await query(
      `SELECT category as name, COALESCE(SUM(amount), 0) as amount
       FROM expenses
       WHERE status IN ('approved', 'paid')
         AND expense_date >= date($1)
         AND expense_date <= date($2)
       GROUP BY category
       HAVING SUM(amount) > 0
       ORDER BY amount DESC`,
      [fromDate, toDate]
    );

    // ── Payroll breakdown by employee (same month-overlap logic) ─────────────
    const payrollDetails = await query(
      `SELECT e.full_name as name, COALESCE(SUM(p.net_salary), 0) as amount
       FROM payroll p
       JOIN employees e ON p.employee_id = e.id
       WHERE date(p.payroll_month, 'start of month') <= date($2)
         AND (date(p.payroll_month, 'start of month', '+1 month', '-1 day')) >= date($1)
       GROUP BY e.full_name
       HAVING SUM(p.net_salary) > 0
       ORDER BY amount DESC`,
      [fromDate, toDate]
    );

    res.json({
      success: true,
      data: {
        period: { from: fromDate, to: toDate },
        revenue: totalRevenue,
        revenue_details: revenueDetails.rows,
        total_billed: parseFloat(revenue.rows[0].total_billed),
        expenses: totalExpenses,
        expense_details: expenseDetails.rows,
        payroll: totalPayroll,
        payroll_details: payrollDetails.rows,
        total_costs: totalCosts,
        profit,
        margin: parseFloat(margin)
      }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    logger.error('Profit-loss error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate P&L report' });
  }
});

// GET /api/reports/advanced-metrics
router.get('/advanced-metrics', async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const fromDate = from_date || `${new Date().getFullYear()}-01-01`;
    const toDate   = to_date   || new Date().toISOString().split('T')[0];

    // Days in the selected period
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysInPeriod = Math.max(1, Math.round(
      (new Date(toDate) - new Date(fromDate)) / msPerDay
    ) + 1);

    // ── DSO: (Total Outstanding Receivables / Total Billed) × Days in Period ──
    const dsoData = await query(
      `SELECT
         COALESCE(SUM(payment_due), 0)   AS total_due,
         COALESCE(SUM(final_amount), 0)  AS total_billed
       FROM invoices
       WHERE status != 'cancelled'
         AND invoice_date >= date($1)
         AND invoice_date <= date($2)`,
      [fromDate, toDate]
    );
    const totalDue    = parseFloat(dsoData.rows[0].total_due);
    const totalBilled = parseFloat(dsoData.rows[0].total_billed);
    const dso = totalBilled > 0
      ? parseFloat(((totalDue / totalBilled) * daysInPeriod).toFixed(1))
      : 0;

    // ── Client Profitability: per-client revenue vs guard payroll cost ──────
    const clientProfit = await query(
      `SELECT
         c.id,
         c.name AS client_name,
         c.monthly_rate,
         COALESCE(inv.total_billed, 0)    AS total_billed,
         COALESCE(inv.total_collected, 0) AS total_collected,
         COALESCE(pay.guard_cost, 0)      AS guard_cost,
         COUNT(e.id)                       AS guard_count
       FROM clients c
       LEFT JOIN (
         SELECT client_id,
                COALESCE(SUM(final_amount), 0)     AS total_billed,
                COALESCE(SUM(payment_received), 0) AS total_collected
         FROM invoices
         WHERE status != 'cancelled'
           AND invoice_date >= date($1)
           AND invoice_date <= date($2)
         GROUP BY client_id
       ) inv ON c.id = inv.client_id
       LEFT JOIN employees e ON e.assigned_client_id = c.id AND e.is_active = true
       LEFT JOIN (
         SELECT emp.assigned_client_id,
                COALESCE(SUM(p.net_salary), 0) AS guard_cost
         FROM payroll p
         JOIN employees emp ON p.employee_id = emp.id
         WHERE date(p.payroll_month, 'start of month') <= date($2)
           AND (date(p.payroll_month, 'start of month', '+1 month', '-1 day')) >= date($1)
         GROUP BY emp.assigned_client_id
       ) pay ON c.id = pay.assigned_client_id
       WHERE c.is_active = true
       GROUP BY c.id, c.name, c.monthly_rate, inv.total_billed, inv.total_collected, pay.guard_cost
       ORDER BY total_collected DESC`,
      [fromDate, toDate]
    );

    const clientData = clientProfit.rows.map(r => {
      const revenue   = parseFloat(r.total_collected);
      const cost      = parseFloat(r.guard_cost);
      const profit    = revenue - cost;
      const margin    = revenue > 0 ? parseFloat((profit / revenue * 100).toFixed(1)) : 0;
      return {
        client_name:     r.client_name,
        total_billed:    parseFloat(r.total_billed),
        total_collected: revenue,
        guard_cost:      cost,
        guard_count:     parseInt(r.guard_count),
        profit,
        margin
      };
    });

    res.json({
      success: true,
      data: {
        dso,
        days_in_period: daysInPeriod,
        total_due:    totalDue,
        total_billed: totalBilled,
        client_profitability: clientData
      }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    logger.error('Advanced metrics error:', error);
    res.status(500).json({ success: false, message: 'Failed to compute advanced metrics' });
  }
});

// GET /api/reports/outstanding-invoices
router.get('/outstanding-invoices', async (req, res) => {
  try {
    const result = await query(
      `SELECT i.*, c.name as client_name, c.phone as client_phone, c.email as client_email,
        c.contact_person,
        date('now', 'localtime') - i.due_date as days_overdue
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       WHERE i.status IN ('sent', 'partially_paid', 'overdue') AND i.payment_due > 0
       ORDER BY i.due_date ASC`
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    res.status(500).json({ success: false, message: 'Failed to fetch outstanding invoices' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/alerts  — Smart Alerts Centre
// ─────────────────────────────────────────────────────────────────────────────
router.get('/alerts', async (req, res) => {
  try {
    const alerts = [];

    // 1. Contracts expiring within 60 days
    const expiring = await query(
      `SELECT id, name, contract_end_date,
              (contract_end_date - date('now', 'localtime')) AS days_left,
              monthly_rate
       FROM clients
       WHERE is_active = true
         AND contract_end_date IS NOT NULL
         AND contract_end_date >= date('now', 'localtime')
         AND contract_end_date <= date('now', 'localtime', '+60 days')
       ORDER BY days_left ASC`
    );
    expiring.rows.forEach(r => {
      const days = parseInt(r.days_left);
      alerts.push({
        type: 'contract_expiring',
        severity: days <= 14 ? 'critical' : days <= 30 ? 'high' : 'medium',
        title: `Contract Expiring — ${r.name}`,
        message: `Contract expires in ${days} day${days === 1 ? '' : 's'} on ${r.contract_end_date?.toISOString?.()?.split('T')[0] || r.contract_end_date}`,
        meta: { client_id: r.id, monthly_rate: r.monthly_rate },
        action: { label: 'View Client', path: '/clients' }
      });
    });

    // 2. Overdue invoices (status = overdue OR due_date passed)
    const overdue = await query(
      `SELECT i.id, i.invoice_number, i.payment_due, i.due_date,
              c.name AS client_name,
              (date('now', 'localtime') - i.due_date) AS days_overdue
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       WHERE i.payment_due > 0
         AND i.status NOT IN ('paid','cancelled')
         AND i.due_date < date('now', 'localtime')
       ORDER BY i.due_date ASC
       LIMIT 5`
    );
    overdue.rows.forEach(r => {
      const days = parseInt(r.days_overdue);
      alerts.push({
        type: 'invoice_overdue',
        severity: days > 60 ? 'critical' : days > 30 ? 'high' : 'medium',
        title: `Overdue Invoice — ${r.client_name}`,
        message: `${r.invoice_number}: ₹${parseFloat(r.payment_due).toLocaleString('en-IN')} overdue by ${days} day${days === 1 ? '' : 's'}`,
        meta: { invoice_id: r.id, amount: r.payment_due },
        action: { label: 'View Invoice', path: '/invoices' }
      });
    });

    // 3. Payroll pending for current month
    const payrollPending = await query(
      `SELECT COUNT(*) AS pending_count, COALESCE(SUM(net_salary),0) AS pending_amount
       FROM payroll
       WHERE payment_status = 'pending'
         AND payroll_month >= date('now', 'localtime', 'start of month')`
    );
    if (parseInt(payrollPending.rows[0].pending_count) > 0) {
      alerts.push({
        type: 'payroll_pending',
        severity: 'high',
        title: 'Payroll Pending',
        message: `${payrollPending.rows[0].pending_count} employees not paid this month — ₹${parseFloat(payrollPending.rows[0].pending_amount).toLocaleString('en-IN')} outstanding`,
        action: { label: 'Process Payroll', path: '/payroll' }
      });
    }

    // 4. High labour ratio warning (last 30 days)
    const labourCheck = await query(
      `SELECT
         COALESCE(SUM(p.net_salary), 0) AS payroll,
         COALESCE((SELECT SUM(payment_received) FROM invoices
                   WHERE invoice_date >= date('now', 'localtime', '-30 days')), 0) AS revenue
       FROM payroll p
       WHERE p.payroll_month >= date('now', 'localtime', 'start of month', '-30 days')
         AND p.payroll_month <= date('now', 'localtime', 'start of month')`
    );
    const lPayroll = parseFloat(labourCheck.rows[0].payroll);
    const lRevenue = parseFloat(labourCheck.rows[0].revenue);
    const lRatio = lRevenue > 0 ? (lPayroll / lRevenue * 100) : 0;
    if (lRatio > 75) {
      alerts.push({
        type: 'high_labour_ratio',
        severity: 'high',
        title: 'Labour Cost Too High',
        message: `Payroll is ${lRatio.toFixed(1)}% of recent revenue (target: < 65%). Profitability at risk.`,
        action: { label: 'View Reports', path: '/reports' }
      });
    }

    // 5. Collection rate below 70% (last 60 days)
    const collectionCheck = await query(
      `SELECT
         COALESCE(SUM(final_amount), 0) AS billed,
         COALESCE(SUM(payment_received), 0) AS collected
       FROM invoices
       WHERE status != 'cancelled'
         AND invoice_date >= date('now', 'localtime', '-60 days')`
    );
    const cBilled    = parseFloat(collectionCheck.rows[0].billed);
    const cCollected = parseFloat(collectionCheck.rows[0].collected);
    const cRate      = cBilled > 0 ? (cCollected / cBilled * 100) : 100;
    if (cBilled > 0 && cRate < 70) {
      alerts.push({
        type: 'low_collection',
        severity: 'medium',
        title: 'Low Collection Rate',
        message: `Only ${cRate.toFixed(1)}% collected in the last 60 days. ₹${(cBilled - cCollected).toLocaleString('en-IN')} still outstanding.`,
        action: { label: 'View Invoices', path: '/invoices' }
      });
    }

    // Sort by severity
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    alerts.sort((a, b) => order[a.severity] - order[b.severity]);

    res.json({ success: true, alerts, count: alerts.length });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    logger.error('Alerts error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch alerts' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/monthly-trend  — Revenue Trend (date-range aware)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/monthly-trend', async (req, res) => {
  try {
    const { from_date, to_date, year } = req.query;

    // Build date boundaries
    const fromDate = from_date || `${year || new Date().getFullYear()}-01-01`;
    const toDate   = to_date   || new Date().toISOString().split('T')[0];

    // Monthly revenue actuals within the date range
    const trend = await query(
      `SELECT
         DATE_FORMAT(invoice_date, '%Y-%m') AS ym,
         COALESCE(SUM(payment_received), 0) AS collected,
         COALESCE(SUM(final_amount), 0) AS billed
       FROM invoices
       WHERE status != 'cancelled'
         AND invoice_date >= $1
         AND invoice_date <= $2
       GROUP BY ym
       ORDER BY ym`,
      [fromDate, toDate]
    );

    // Monthly payroll costs within range (MySQL-compatible)
    const costs = await query(
      `SELECT
         DATE_FORMAT(payroll_month, '%Y-%m') AS ym,
         COALESCE(SUM(net_salary), 0) AS payroll_cost
       FROM payroll
       WHERE DATE_FORMAT(payroll_month, '%Y-%m') >= DATE_FORMAT($1, '%Y-%m')
         AND DATE_FORMAT(payroll_month, '%Y-%m') <= DATE_FORMAT($2, '%Y-%m')
       GROUP BY ym`,
      [fromDate, toDate]
    );
    const costMap = {};
    costs.rows.forEach(r => { costMap[r.ym] = parseFloat(r.payroll_cost); });

    const expCosts = await query(
      `SELECT
         DATE_FORMAT(expense_date, '%Y-%m') AS ym,
         COALESCE(SUM(amount), 0) AS exp_cost
       FROM expenses
       WHERE status IN ('approved', 'paid')
         AND expense_date >= $1
         AND expense_date <= $2
       GROUP BY ym`,
      [fromDate, toDate]
    );
    expCosts.rows.forEach(r => {
      costMap[r.ym] = (costMap[r.ym] || 0) + parseFloat(r.exp_cost);
    });

    // Build a rolling month list from fromDate to toDate
    const monthlyData = [];
    const start = new Date(fromDate + 'T00:00:00');
    const end   = new Date(toDate   + 'T00:00:00');
    const now   = new Date();
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    while (cur <= end) {
      const ym  = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}`;
      const row = trend.rows.find(r => r.ym === ym);
      const isFuture = cur > now;
      monthlyData.push({
        month:     `${monthLabels[cur.getMonth()]} ${cur.getFullYear()}`,
        month_num: cur.getMonth() + 1,
        ym,
        collected: row ? parseFloat(row.collected) : 0,
        billed:    row ? parseFloat(row.billed)    : 0,
        costs:     costMap[ym] || 0,
        is_future: isFuture
      });
      cur.setMonth(cur.getMonth() + 1);
    }

    // Forecast from actual months
    const actualMonths = monthlyData.filter(m => !m.is_future && m.collected > 0);
    const runRate = actualMonths.length > 0
      ? actualMonths.reduce((s, m) => s + m.collected, 0) / actualMonths.length : 0;
    const ytdCollected = actualMonths.reduce((s, m) => s + m.collected, 0);
    const remainingMonths = Math.max(0, 12 - (now.getMonth() + 1));
    const forecast = ytdCollected + (runRate * remainingMonths);

    // MoM growth
    for (let i = 1; i < monthlyData.length; i++) {
      const prev = monthlyData[i-1].collected;
      const curr = monthlyData[i].collected;
      monthlyData[i].mom_pct = prev > 0 && curr > 0
        ? parseFloat(((curr - prev) / prev * 100).toFixed(1)) : null;
    }
    if (monthlyData.length > 0) monthlyData[0].mom_pct = null;

    res.json({
      success: true,
      monthly: monthlyData,
      run_rate: parseFloat(runRate.toFixed(0)),
      ytd_collected: ytdCollected,
      year_end_forecast: parseFloat(forecast.toFixed(0)),
      months_elapsed: actualMonths.length
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    logger.error('Monthly trend error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate monthly trend' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/receivables-aging  — Aging Buckets
// ─────────────────────────────────────────────────────────────────────────────
router.get('/receivables-aging', async (req, res) => {
  try {
    const result = await query(
      `SELECT
         i.id, i.invoice_number, i.due_date,
         i.payment_due, i.payment_received, i.final_amount, i.status,
         c.name AS client_name, c.phone AS client_phone,
         (date('now', 'localtime') - i.due_date) AS days_overdue,
         CASE
           WHEN date('now', 'localtime') - i.due_date <= 0  THEN 'current'
           WHEN date('now', 'localtime') - i.due_date <= 30 THEN '1_30'
           WHEN date('now', 'localtime') - i.due_date <= 60 THEN '31_60'
           WHEN date('now', 'localtime') - i.due_date <= 90 THEN '61_90'
           ELSE '90_plus'
         END AS bucket
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       WHERE i.payment_due > 0
         AND i.status NOT IN ('paid', 'cancelled')
       ORDER BY i.due_date ASC`
    );

    const rows = result.rows;
    const buckets = {
      current: { label: 'Current (Not Yet Due)', amount: 0, count: 0, invoices: [] },
      '1_30':   { label: '1–30 Days Overdue',   amount: 0, count: 0, invoices: [] },
      '31_60':  { label: '31–60 Days Overdue',  amount: 0, count: 0, invoices: [] },
      '61_90':  { label: '61–90 Days Overdue',  amount: 0, count: 0, invoices: [] },
      '90_plus':{ label: '90+ Days (Bad Debt Risk)', amount: 0, count: 0, invoices: [] }
    };

    rows.forEach(r => {
      const b = r.bucket;
      const amt = parseFloat(r.payment_due);
      buckets[b].amount += amt;
      buckets[b].count  += 1;
      buckets[b].invoices.push({
        id: r.id,
        invoice_number: r.invoice_number,
        client_name: r.client_name,
        due_date: r.due_date,
        days_overdue: parseInt(r.days_overdue),
        payment_due: amt,
        status: r.status
      });
    });

    const totalOutstanding = Object.values(buckets).reduce((s, b) => s + b.amount, 0);

    res.json({ success: true, buckets, total_outstanding: totalOutstanding });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    logger.error('Receivables aging error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch receivables aging' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/clients/:id/renew — Contract Renewal
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/business-analytics — Medium-tier analytics bundle
// Computes: attendance rate, rev/employee, concentration risk, burn rate,
//           expense vs revenue growth, break-even, salary advances
// ─────────────────────────────────────────────────────────────────────────────
router.get('/business-analytics', async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const fromDate = from_date || `${new Date().getFullYear()}-01-01`;
    const toDate   = to_date   || new Date().toISOString().split('T')[0];

    // ── 1. Attendance Rate & Absenteeism Cost ─────────────────────────────
    const attendance = await query(
      `SELECT
         COUNT(*) AS total_records,
         SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present,
         SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END)  AS absent,
         SUM(CASE WHEN status = 'leave' THEN 1 ELSE 0 END)   AS on_leave,
         SUM(CASE WHEN status = 'half_day' THEN 1 ELSE 0 END) AS half_day,
         SUM(CASE WHEN status = 'holiday' THEN 1 ELSE 0 END)  AS holidays
       FROM attendance
       WHERE attendance_date >= date($1) AND attendance_date <= date($2)`,
      [fromDate, toDate]
    );
    const att = attendance.rows[0];
    const totalWorking = parseInt(att.total_records) - parseInt(att.holidays);
    const presentDays  = parseInt(att.present) + parseInt(att.half_day) * 0.5;
    const attendanceRate = totalWorking > 0 ? parseFloat((presentDays / totalWorking * 100).toFixed(1)) : 0;

    // Per-client attendance
    const clientAttendance = await query(
      `SELECT c.name AS client_name,
         COUNT(*) AS total,
         SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
         SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END)  AS absent
       FROM attendance a
       JOIN clients c ON a.client_id = c.id
       WHERE a.attendance_date >= date($1) AND a.attendance_date <= date($2)
       GROUP BY c.name
       ORDER BY present DESC`,
      [fromDate, toDate]
    );

    // Absenteeism cost estimate
    const absentCost = await query(
      `SELECT COALESCE(SUM(p.base_salary / 30.0 * p.days_absent), 0) AS cost
       FROM payroll p
       WHERE p.payroll_month >= date($1, 'start of month')
         AND p.payroll_month <= date($2)`,
      [fromDate, toDate]
    );

    // ── 2. Revenue Per Employee ───────────────────────────────────────────
    const revenuePerEmp = await query(
      `SELECT
         COALESCE(SUM(i.payment_received), 0) AS total_revenue,
         (SELECT COUNT(*) FROM employees WHERE is_active = true) AS active_employees,
         (SELECT COALESCE(AVG(net_salary), 0) FROM payroll 
          WHERE payroll_month >= date($1, 'start of month') AND payroll_month <= date($2)) AS avg_salary
       FROM invoices i
       WHERE i.status != 'cancelled'
         AND i.invoice_date >= date($1) AND i.invoice_date <= date($2)`,
      [fromDate, toDate]
    );
    const rpe = revenuePerEmp.rows[0];
    const empCount = parseInt(rpe.active_employees) || 1;
    const totalRev = parseFloat(rpe.total_revenue);
    // Months in range for per-month calculation
    const monthsInRange = Math.max(1, Math.ceil(
      (new Date(toDate) - new Date(fromDate)) / (1000 * 60 * 60 * 24 * 30)
    ));
    const revPerEmpPerMonth = parseFloat((totalRev / empCount / monthsInRange).toFixed(0));

    // ── 3. Client Concentration Risk ──────────────────────────────────────
    const concentration = await query(
      `SELECT c.name AS client_name,
         COALESCE(SUM(i.payment_received), 0) AS revenue
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       WHERE i.status != 'cancelled'
         AND i.invoice_date >= date($1) AND i.invoice_date <= date($2)
       GROUP BY c.name
       ORDER BY revenue DESC`,
      [fromDate, toDate]
    );
    const totalConcentrationRev = concentration.rows.reduce((s, r) => s + parseFloat(r.revenue), 0);
    const concentrationData = concentration.rows.map(r => ({
      client: r.client_name,
      revenue: parseFloat(r.revenue),
      pct: totalConcentrationRev > 0 ? parseFloat((parseFloat(r.revenue) / totalConcentrationRev * 100).toFixed(1)) : 0
    }));
    const topClientPct = concentrationData.length > 0 ? concentrationData[0].pct : 0;
    const top3Pct = concentrationData.slice(0, 3).reduce((s, c) => s + c.pct, 0);
    const concentrationRisk = topClientPct > 40 ? 'critical' : topClientPct > 30 ? 'high' : 'healthy';

    // ── 4. Burn Rate & Runway ─────────────────────────────────────────────
    const burnData = await query(
      `SELECT
         COALESCE((SELECT SUM(net_salary) FROM payroll 
                   WHERE payroll_month >= date($1, 'start of month') AND payroll_month <= date($2)), 0) AS payroll_cost,
         COALESCE((SELECT SUM(amount) FROM expenses 
                   WHERE status IN ('approved','paid') AND expense_date >= date($1) AND expense_date <= date($2)), 0) AS expense_cost,
         COALESCE((SELECT SUM(payment_received) FROM invoices 
                   WHERE status != 'cancelled' AND invoice_date >= date($1) AND invoice_date <= date($2)), 0) AS cash_in
       `,
      [fromDate, toDate]
    );
    const bd = burnData.rows[0];
    const totalCosts  = parseFloat(bd.payroll_cost) + parseFloat(bd.expense_cost);
    const monthlyBurn = parseFloat((totalCosts / monthsInRange).toFixed(0));
    const monthlyCashIn = parseFloat((parseFloat(bd.cash_in) / monthsInRange).toFixed(0));
    const netBurn     = Math.max(0, monthlyBurn - monthlyCashIn);
    const cashBalance = parseFloat(bd.cash_in) - totalCosts;
    const runway      = netBurn > 0 ? parseFloat((cashBalance / netBurn).toFixed(1)) : 99;

    // ── 5. Expense vs Revenue Growth ──────────────────────────────────────
    // Compare first half of period vs second half
    const midDate = new Date((new Date(fromDate).getTime() + new Date(toDate).getTime()) / 2);
    const midStr  = midDate.toISOString().split('T')[0];

    const growthData = await query(
      `SELECT
         COALESCE((SELECT SUM(payment_received) FROM invoices WHERE status != 'cancelled' AND invoice_date >= date($1) AND invoice_date < date($3)), 0) AS rev_first,
         COALESCE((SELECT SUM(payment_received) FROM invoices WHERE status != 'cancelled' AND invoice_date >= date($3) AND invoice_date <= date($2)), 0) AS rev_second,
         COALESCE((SELECT SUM(amount) FROM expenses WHERE status IN ('approved','paid') AND expense_date >= date($1) AND expense_date < date($3)), 0) AS exp_first,
         COALESCE((SELECT SUM(amount) FROM expenses WHERE status IN ('approved','paid') AND expense_date >= date($3) AND expense_date <= date($2)), 0) AS exp_second,
         COALESCE((SELECT SUM(net_salary) FROM payroll WHERE payroll_month >= date($1, 'start of month') AND payroll_month < date($3)), 0) AS pay_first,
         COALESCE((SELECT SUM(net_salary) FROM payroll WHERE payroll_month >= date($3) AND payroll_month <= date($2)), 0) AS pay_second
       `,
      [fromDate, toDate, midStr]
    );
    const gd = growthData.rows[0];
    const revFirst  = parseFloat(gd.rev_first);
    const revSecond = parseFloat(gd.rev_second);
    const expFirst  = parseFloat(gd.exp_first) + parseFloat(gd.pay_first);
    const expSecond = parseFloat(gd.exp_second) + parseFloat(gd.pay_second);
    const revGrowth = revFirst > 0 ? parseFloat(((revSecond - revFirst) / revFirst * 100).toFixed(1)) : 0;
    const expGrowth = expFirst > 0 ? parseFloat(((expSecond - expFirst) / expFirst * 100).toFixed(1)) : 0;
    const scissorsWarning = expGrowth > revGrowth && expGrowth > 0;

    // ── 6. Break-Even Revenue ─────────────────────────────────────────────
    // Fixed costs = payroll (relatively fixed for security agency)
    // Variable costs = expenses (equipment, transport, etc.)
    const fixedCostsMonthly = parseFloat((parseFloat(bd.payroll_cost) / monthsInRange).toFixed(0));
    const variableCostsMonthly = parseFloat((parseFloat(bd.expense_cost) / monthsInRange).toFixed(0));
    const variableRatio = monthlyCashIn > 0 ? variableCostsMonthly / monthlyCashIn : 0;
    const breakEven = variableRatio < 1 
      ? parseFloat((fixedCostsMonthly / (1 - variableRatio)).toFixed(0)) 
      : fixedCostsMonthly + variableCostsMonthly;
    const aboveBreakEven = monthlyCashIn >= breakEven;

    // ── 7. Salary Advance Tracking ────────────────────────────────────────
    const advances = await query(
      `SELECT
         COALESCE(SUM(amount), 0) AS total_advanced
       FROM expenses
       WHERE category = 'salary_advance' AND status IN ('approved','paid')
         AND expense_date >= date($1) AND expense_date <= date($2)`,
      [fromDate, toDate]
    );
    const deductions = await query(
      `SELECT COALESCE(SUM(other_deductions), 0) AS total_recovered
       FROM payroll
       WHERE payroll_month >= date($1, 'start of month') AND payroll_month <= date($2)`,
      [fromDate, toDate]
    );
    const totalAdvanced  = parseFloat(advances.rows[0].total_advanced);
    const totalRecovered = parseFloat(deductions.rows[0].total_recovered);
    const advanceBalance = Math.max(0, totalAdvanced - totalRecovered);
    const recoveryRate   = totalAdvanced > 0 ? parseFloat((totalRecovered / totalAdvanced * 100).toFixed(1)) : 100;

    res.json({
      success: true,
      attendance: {
        rate: attendanceRate,
        present: parseInt(att.present),
        absent: parseInt(att.absent),
        leave: parseInt(att.on_leave),
        half_day: parseInt(att.half_day),
        total_working: totalWorking,
        absenteeism_cost: parseFloat(parseFloat(absentCost.rows[0].cost).toFixed(0)),
        by_client: clientAttendance.rows.map(r => ({
          client: r.client_name,
          total: parseInt(r.total),
          present: parseInt(r.present),
          absent: parseInt(r.absent),
          rate: parseInt(r.total) > 0 ? parseFloat((parseInt(r.present) / parseInt(r.total) * 100).toFixed(1)) : 0
        }))
      },
      revenue_per_employee: {
        per_month: revPerEmpPerMonth,
        total_revenue: totalRev,
        employee_count: empCount,
        avg_salary: parseFloat(parseFloat(rpe.avg_salary).toFixed(0)),
        margin_per_head: revPerEmpPerMonth - parseFloat(parseFloat(rpe.avg_salary).toFixed(0))
      },
      concentration: {
        data: concentrationData,
        top_client_pct: topClientPct,
        top3_pct: parseFloat(top3Pct.toFixed(1)),
        risk: concentrationRisk
      },
      burn_rate: {
        monthly_burn: monthlyBurn,
        monthly_cash_in: monthlyCashIn,
        net_burn: netBurn,
        cash_balance: parseFloat(cashBalance.toFixed(0)),
        runway_months: runway
      },
      growth: {
        revenue_growth: revGrowth,
        expense_growth: expGrowth,
        scissors_warning: scissorsWarning,
        rev_first_half: revFirst,
        rev_second_half: revSecond,
        exp_first_half: expFirst,
        exp_second_half: expSecond
      },
      break_even: {
        monthly_break_even: breakEven,
        monthly_revenue: monthlyCashIn,
        above_break_even: aboveBreakEven,
        fixed_costs: fixedCostsMonthly,
        variable_ratio: parseFloat((variableRatio * 100).toFixed(1))
      },
      salary_advances: {
        total_advanced: totalAdvanced,
        total_recovered: totalRecovered,
        outstanding_balance: advanceBalance,
        recovery_rate: recoveryRate
      }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    logger.error('Business analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to compute business analytics' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/cost-per-guard — Low priority, dedicated site cost analysis
// ─────────────────────────────────────────────────────────────────────────────
router.get('/cost-per-guard', async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const fromDate = from_date || `${new Date().getFullYear()}-01-01`;
    const toDate   = to_date   || new Date().toISOString().split('T')[0];

    const siteData = await query(
      `SELECT
         c.id,
         c.name AS client_name,
         c.monthly_rate,
         COUNT(e.id) AS guards_deployed,
         COALESCE((
           SELECT SUM(p.net_salary)
           FROM payroll p
           JOIN employees emp ON p.employee_id = emp.id
           WHERE emp.assigned_client_id = c.id
             AND date(p.payroll_month, 'start of month') <= date($2)
             AND (date(p.payroll_month, 'start of month', '+1 month', '-1 day')) >= date($1)
         ), 0) AS total_guard_cost,
         COALESCE((
           SELECT SUM(final_amount)
           FROM invoices
           WHERE client_id = c.id
             AND status != 'cancelled'
             AND invoice_date >= date($1)
             AND invoice_date <= date($2)
         ), 0) AS total_billed
       FROM clients c
       LEFT JOIN employees e ON e.assigned_client_id = c.id AND e.is_active = true
       WHERE c.is_active = true
       GROUP BY c.id, c.name, c.monthly_rate
       HAVING COUNT(e.id) > 0
       ORDER BY total_billed DESC`,
      [fromDate, toDate]
    );

    // Calculate derived metrics
    const data = siteData.rows.map(r => {
      const billed = parseFloat(r.total_billed);
      const cost   = parseFloat(r.total_guard_cost);
      const guards = parseInt(r.guards_deployed);
      const profit = billed - cost;
      
      return {
        client_id: r.id,
        client_name: r.client_name,
        guards_deployed: guards,
        total_guard_cost: cost,
        cost_per_guard: guards > 0 ? parseFloat((cost / guards).toFixed(0)) : 0,
        monthly_billed: billed,
        site_margin_pct: billed > 0 ? parseFloat((profit / billed * 100).toFixed(1)) : 0,
        profit: profit
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    logger.error('Cost per guard error:', error);
    res.status(500).json({ success: false, message: 'Failed to compute cost per guard' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/export-excel
// ─────────────────────────────────────────────────────────────────────────────
router.get('/export-excel', async (req, res) => {
  try {
    const { type, from_date, to_date } = req.query;
    if (!['invoices', 'payroll', 'expenses'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid export type' });
    }

    const fromDate = from_date || `${new Date().getFullYear()}-01-01`;
    const toDate = to_date || new Date().toISOString().split('T')[0];

    const workbook = new ExcelJS.Workbook();
    
    // Sanitize values to prevent CSV/Excel formula injection (Issue #18)
    const sanitizeRow = (row) => {
      const sanitized = {};
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) {
          sanitized[key] = "'" + value;
        } else {
          sanitized[key] = value;
        }
      }
      return sanitized;
    };

    workbook.creator = 'Security Firm Software';
    workbook.created = new Date();
    
    const sheetName = type.charAt(0).toUpperCase() + type.slice(1);
    const worksheet = workbook.addWorksheet(sheetName);

    if (type === 'invoices') {
      const data = await query(
        `SELECT i.invoice_number, i.invoice_date, i.due_date, c.name as client_name, 
          i.amount_subtotal, i.tax_amount, i.final_amount, i.payment_received, i.status
         FROM invoices i JOIN clients c ON i.client_id = c.id
         WHERE i.invoice_date >= date($1) AND i.invoice_date <= date($2)
         ORDER BY i.invoice_date ASC`,
        [fromDate, toDate]
      );
      worksheet.columns = [
        { header: 'Invoice Number', key: 'invoice_number', width: 20 },
        { header: 'Client', key: 'client_name', width: 30 },
        { header: 'Date', key: 'invoice_date', width: 15 },
        { header: 'Due Date', key: 'due_date', width: 15 },
        { header: 'Subtotal', key: 'amount_subtotal', width: 15 },
        { header: 'Tax', key: 'tax_amount', width: 15 },
        { header: 'Final Amount', key: 'final_amount', width: 15 },
        { header: 'Paid', key: 'payment_received', width: 15 },
        { header: 'Status', key: 'status', width: 15 }
      ];
      data.rows.forEach(r => worksheet.addRow(sanitizeRow(r)));
    } else if (type === 'payroll') {
      const data = await query(
        `SELECT e.employee_id, e.full_name, e.designation, p.payroll_month, 
          p.days_worked, p.gross_salary, p.total_deductions, p.net_salary, p.payment_status
         FROM payroll p JOIN employees e ON p.employee_id = e.id
         WHERE p.payroll_month >= date($1, 'start of month') 
           AND p.payroll_month <= date($2)
         ORDER BY p.payroll_month ASC, e.full_name ASC`,
        [fromDate, toDate]
      );
      worksheet.columns = [
        { header: 'Emp ID', key: 'employee_id', width: 15 },
        { header: 'Name', key: 'full_name', width: 30 },
        { header: 'Designation', key: 'designation', width: 25 },
        { header: 'Month', key: 'payroll_month', width: 15 },
        { header: 'Days Worked', key: 'days_worked', width: 15 },
        { header: 'Gross Salary', key: 'gross_salary', width: 15 },
        { header: 'Deductions', key: 'total_deductions', width: 15 },
        { header: 'Net Salary', key: 'net_salary', width: 15 },
        { header: 'Status', key: 'payment_status', width: 15 }
      ];
      data.rows.forEach(r => worksheet.addRow(sanitizeRow(r)));
    } else if (type === 'expenses') {
      const data = await query(
        `SELECT expense_date, category, description, amount, payment_method, status
         FROM expenses
         WHERE expense_date >= date($1) AND expense_date <= date($2)
         ORDER BY expense_date ASC`,
        [fromDate, toDate]
      );
      worksheet.columns = [
        { header: 'Date', key: 'expense_date', width: 15 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Description', key: 'description', width: 40 },
        { header: 'Amount', key: 'amount', width: 15 },
        { header: 'Method', key: 'payment_method', width: 15 },
        { header: 'Status', key: 'status', width: 15 }
      ];
      data.rows.forEach(r => worksheet.addRow(sanitizeRow(r)));
    }

    // Styling
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${sheetName}_Export_${fromDate}_to_${toDate}.xlsx"`);
    
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    logger.error('Excel export error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to export Excel file' });
    }
  }
});
// GET /api/reports/tds
router.get('/tds', async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    let dateFilter = '';
    let params = [];
    if (from_date && to_date) {
      dateFilter = 'WHERE p.payment_date >= $1 AND p.payment_date <= $2 AND p.tds_deducted > 0';
      params = [from_date, to_date];
    } else {
      dateFilter = 'WHERE p.tds_deducted > 0';
    }

    const result = await query(
      `SELECT 
         c.id as client_id, c.name as client_name, c.gst_number,
         SUM(p.tds_deducted) as total_tds_deducted,
         SUM(p.amount_paid) as total_amount_paid,
         COUNT(p.id) as payment_count
       FROM payments p
       JOIN invoices i ON p.invoice_id = i.id
       JOIN clients c ON i.client_id = c.id
       ${dateFilter}
       GROUP BY c.id, c.name, c.gst_number
       ORDER BY total_tds_deducted DESC`,
      params
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    logger.error('TDS report error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate TDS report' });
  }
});
// GET /api/reports/gst-bifurcation
router.get('/gst-bifurcation', async (req, res) => {
  try {
    const { from_date, to_date, type = 'client' } = req.query;
    let dateFilter = '';
    let params = [];
    
    if (type === 'client') {
      if (from_date && to_date) {
        dateFilter = `AND i.invoice_date >= $1 AND i.invoice_date <= $2`;
        params = [from_date, to_date];
      }
      const result = await query(
        `SELECT 
           c.id as party_id, c.name as party_name, c.gst_number,
           SUM(i.amount_subtotal) as total_taxable_value,
           SUM(i.cgst_amount) as total_cgst,
           SUM(i.sgst_amount) as total_sgst,
           SUM(i.igst_amount) as total_igst,
           SUM(i.final_amount) as total_invoice_amount,
           COUNT(i.id) as invoice_count
         FROM invoices i
         JOIN clients c ON i.client_id = c.id
         WHERE i.status != 'cancelled' ${dateFilter}
         GROUP BY c.id, c.name, c.gst_number
         ORDER BY total_taxable_value DESC`,
        params
      );
      res.json({ success: true, data: result.rows });
    } else if (type === 'vendor') {
      if (from_date && to_date) {
        dateFilter = `AND expense_date >= $1 AND expense_date <= $2`;
        params = [from_date, to_date];
      }
      const result = await query(
        `SELECT 
           vendor_name as party_name, 
           'N/A' as gst_number,
           SUM(amount) as total_taxable_value,
           0 as total_cgst,
           0 as total_sgst,
           0 as total_igst,
           SUM(amount) as total_invoice_amount,
           COUNT(id) as invoice_count
         FROM expenses
         WHERE status IN ('approved', 'paid') AND vendor_name IS NOT NULL AND vendor_name != '' ${dateFilter}
         GROUP BY vendor_name
         ORDER BY total_taxable_value DESC`,
        params
      );
      res.json({ success: true, data: result.rows });
    } else {
      res.status(400).json({ success: false, message: 'Invalid type' });
    }
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    logger.error('GST bifurcation report error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate GST bifurcation report' });
  }
});
// --- DRILL-DOWN ENDPOINTS ---

// GET /api/reports/drilldown/billed
router.get('/drilldown/billed', async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    let queryStr = `
      SELECT i.id, i.invoice_number, i.invoice_date, c.name as client_name, i.final_amount, i.status 
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.status != 'cancelled'
    `;
    const params = [];
    if (from_date) {
      params.push(from_date);
      queryStr += ` AND i.invoice_date >= $${params.length}`;
    }
    if (to_date) {
      params.push(to_date);
      queryStr += ` AND i.invoice_date <= $${params.length}`;
    }
    queryStr += ` ORDER BY i.invoice_date DESC`;
    const result = await query(queryStr, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    res.status(500).json({ success: false, message: 'Failed to fetch billed details' });
  }
});

// GET /api/reports/drilldown/collected
router.get('/drilldown/collected', async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    let queryStr = `
      SELECT p.id, p.payment_date, i.invoice_number, c.name as client_name, p.amount_paid, p.payment_method
      FROM payments p
      JOIN invoices i ON p.invoice_id = i.id
      JOIN clients c ON i.client_id = c.id
      WHERE 1=1
    `;
    const params = [];
    if (from_date) {
      params.push(from_date);
      queryStr += ` AND p.payment_date >= $${params.length}`;
    }
    if (to_date) {
      params.push(to_date);
      queryStr += ` AND p.payment_date <= $${params.length}`;
    }
    queryStr += ` ORDER BY p.payment_date DESC`;
    const result = await query(queryStr, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    res.status(500).json({ success: false, message: 'Failed to fetch collected details' });
  }
});

// GET /api/reports/drilldown/pending
router.get('/drilldown/pending', async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    let queryStr = `
      SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, c.name as client_name, i.final_amount, i.payment_due
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.status NOT IN ('paid', 'cancelled') AND i.payment_due > 0
    `;
    const params = [];
    if (from_date) {
      params.push(from_date);
      queryStr += ` AND i.invoice_date >= $${params.length}`;
    }
    if (to_date) {
      params.push(to_date);
      queryStr += ` AND i.invoice_date <= $${params.length}`;
    }
    queryStr += ` ORDER BY i.due_date ASC`;
    const result = await query(queryStr, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    res.status(500).json({ success: false, message: 'Failed to fetch pending details' });
  }
});

// GET /api/reports/drilldown/expenses
router.get('/drilldown/expenses', async (req, res) => {
  try {
    const { from_date, to_date, category } = req.query;
    let queryStr = `
      SELECT id, expense_date, category, vendor_name, description, amount, status
      FROM expenses
      WHERE status IN ('approved', 'paid')
    `;
    const params = [];
    if (category) {
      params.push(category);
      queryStr += ` AND category = $${params.length}`;
    }
    if (from_date) {
      params.push(from_date);
      queryStr += ` AND expense_date >= $${params.length}`;
    }
    if (to_date) {
      params.push(to_date);
      queryStr += ` AND expense_date <= $${params.length}`;
    }
    queryStr += ` ORDER BY expense_date DESC`;
    const result = await query(queryStr, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    res.status(500).json({ success: false, message: 'Failed to fetch expense details' });
  }
});

// GET /api/reports/drilldown/monthly
router.get('/drilldown/monthly', async (req, res) => {
  try {
    const { year, month } = req.query; // month is 1-12
    if (!year || !month) return res.status(400).json({ success: false, message: 'Year and month required' });
    
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]; // Last day of month

    // Fetch invoices for this month
    const invoices = await query(`
      SELECT i.invoice_number, i.invoice_date, c.name as client_name, i.final_amount, 'Billed' as type
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.status != 'cancelled' AND i.invoice_date >= $1 AND i.invoice_date <= $2
      ORDER BY i.invoice_date DESC
    `, [startDate, endDate]);

    // Fetch payments for this month
    const payments = await query(`
      SELECT p.payment_date, i.invoice_number, c.name as client_name, p.amount_paid as final_amount, 'Collected' as type
      FROM payments p
      JOIN invoices i ON p.invoice_id = i.id
      JOIN clients c ON i.client_id = c.id
      WHERE p.payment_date >= $1 AND p.payment_date <= $2
      ORDER BY p.payment_date DESC
    `, [startDate, endDate]);

    res.json({ 
      success: true, 
      data: {
        billed: invoices.rows,
        collected: payments.rows
      }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    res.status(500).json({ success: false, message: 'Failed to fetch monthly details' });
  }
});

// GET /api/reports/drilldown/revenue
router.get('/drilldown/revenue', async (req, res) => {
  try {
    const { from_date, to_date, client_name } = req.query;
    let queryStr = `
      SELECT i.invoice_number, i.invoice_date, c.name as client_name, i.final_amount, i.payment_received
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.status != 'cancelled' AND i.payment_received > 0
    `;
    const params = [];
    if (from_date) {
      params.push(from_date);
      queryStr += ` AND i.invoice_date >= $${params.length}`;
    }
    if (to_date) {
      params.push(to_date);
      queryStr += ` AND i.invoice_date <= $${params.length}`;
    }
    if (client_name) {
      params.push(client_name);
      queryStr += ` AND c.name = $${params.length}`;
    }
    queryStr += ` ORDER BY i.invoice_date DESC`;
    
    const result = await query(queryStr, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'reports' });
    res.status(500).json({ success: false, message: 'Failed to fetch revenue drilldown details' });
  }
});

module.exports = router;
