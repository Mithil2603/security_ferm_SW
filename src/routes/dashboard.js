const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requireRole('admin', 'manager', 'accountant', 'employee'));

// GET /api/dashboard - All KPIs in one call
router.get('/', async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const monthStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
    const today = new Date().toISOString().split('T')[0];

    // Execute all queries in parallel for high performance
    const [
      revenueResult,
      empResult,
      clientResult,
      expenseResult,
      payrollResult,
      trendResult,
      recentInvoices,
      topClients,
      expByCategory,
      attendanceResult
    ] = await Promise.all([
      // 1. Revenue this month
      query(
        `SELECT 
          COALESCE(SUM(final_amount), 0) as total_billed,
          COALESCE(SUM(payment_received), 0) as total_collected,
          COALESCE(SUM(payment_due), 0) as total_outstanding,
          COUNT(*) as invoice_count,
          COALESCE(SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END), 0) as overdue_count
         FROM invoices WHERE invoice_date >= $1 AND status != 'cancelled'`,
        [monthStart]
      ),

      // 2. Employee stats
      query(
        `SELECT 
          COUNT(*) as total_employees,
          COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0) as active_employees
         FROM employees`
      ),

      // 3. Client stats
      query(
        `SELECT 
          COUNT(*) as total_clients,
          COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0) as active_clients
         FROM clients`
      ),

      // 4. Expense this month
      query(
        `SELECT COALESCE(SUM(amount), 0) as total_expenses
         FROM expenses WHERE expense_date >= $1 AND status IN ('approved', 'paid')`,
        [monthStart]
      ),

      // 5. Pending payroll
      query(
        `SELECT COUNT(*) as pending_count, COALESCE(SUM(net_salary), 0) as pending_amount
         FROM payroll WHERE payment_status = 'pending'`
      ),

      // 6. Last 6 months revenue trend
      query(
        `SELECT 
          DATE_FORMAT(invoice_date, '%b') as month,
          CAST(DATE_FORMAT(invoice_date, '%m') AS UNSIGNED) as month_num,
          CAST(DATE_FORMAT(invoice_date, '%Y') AS UNSIGNED) as year,
          COALESCE(SUM(payment_received), 0) as collected,
          COALESCE(SUM(final_amount), 0) as billed
         FROM invoices
         WHERE invoice_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH) AND status != 'cancelled'
         GROUP BY year, month_num, month
         ORDER BY year ASC, month_num ASC`
      ),

      // 7. Recent invoices
      query(
        `SELECT i.invoice_number, i.status, i.final_amount, i.invoice_date, c.name as client_name
         FROM invoices i JOIN clients c ON i.client_id = c.id
         ORDER BY i.created_at DESC LIMIT 5`
      ),

      // 8. Top clients by revenue
      query(
        `SELECT c.name, c.city,
          COALESCE(SUM(i.payment_received), 0) as revenue
         FROM clients c
         LEFT JOIN invoices i ON c.id = i.client_id AND i.status != 'cancelled'
         GROUP BY c.id, c.name, c.city
         ORDER BY revenue DESC LIMIT 5`
      ),

      // 9. Expense by category this month
      query(
        `SELECT category, COALESCE(SUM(amount), 0) as total
         FROM expenses WHERE expense_date >= $1 AND status IN ('approved', 'paid')
         GROUP BY category ORDER BY total DESC`,
        [monthStart]
      ),

      // 10. Today's attendance summary
      query(
        `SELECT 
          COUNT(*) as total_marked,
          COALESCE(SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END), 0) as present_count,
          COALESCE(SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END), 0) as absent_count,
          COALESCE(SUM(CASE WHEN status = 'half_day' THEN 1 ELSE 0 END), 0) as half_day_count,
          COALESCE(SUM(CASE WHEN status = 'leave' THEN 1 ELSE 0 END), 0) as leave_count
         FROM attendance WHERE attendance_date = CURDATE()`
      )
    ]);

    const revenue = revenueResult.rows[0];
    const employees = empResult.rows[0];
    const clients = clientResult.rows[0];
    const attRow = attendanceResult.rows[0] || {};

    res.json({
      success: true,
      data: {
        kpis: {
          revenue: {
            billed: parseFloat(revenue.total_billed),
            collected: parseFloat(revenue.total_collected),
            outstanding: parseFloat(revenue.total_outstanding),
            invoice_count: parseInt(revenue.invoice_count),
            overdue_count: parseInt(revenue.overdue_count)
          },
          employees: {
            total: parseInt(employees.total_employees),
            active: parseInt(employees.active_employees)
          },
          clients: {
            total: parseInt(clients.total_clients),
            active: parseInt(clients.active_clients)
          },
          attendance: {
            total_marked: parseInt(attRow.total_marked || 0),
            present: parseInt(attRow.present_count || 0),
            absent: parseInt(attRow.absent_count || 0),
            half_day: parseInt(attRow.half_day_count || 0),
            leave: parseInt(attRow.leave_count || 0)
          },
          expenses: parseFloat(expenseResult.rows[0].total_expenses),
          payroll: {
            pending_count: parseInt(payrollResult.rows[0].pending_count),
            pending_amount: parseFloat(payrollResult.rows[0].pending_amount)
          }
        },
        revenue_trend: trendResult.rows,
        recent_invoices: recentInvoices.rows,
        top_clients: topClients.rows,
        expense_by_category: expByCategory.rows
      }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'dashboard' });
    logger.error('Dashboard error:', error);
    res.status(500).json({ success: false, message: 'Failed to load dashboard data' });
  }
});

module.exports = router;
