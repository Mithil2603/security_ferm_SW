/**
 * src/services/reports/financialReportingService.js
 * 
 * Advanced Financial Reporting Service.
 * Handles:
 *  - Cash Flow Statement (Operating/Investing/Financing)
 *  - Variance Analysis (Budget vs Actual)
 *  - Financial KPI computation (margins, DSO, current ratio)
 *  - Monthly financial snapshot generation
 *  - Budget CRUD and line items
 */

const Decimal = require('decimal.js');
const { query } = require('../../database/connection');
const logger = require('../../utils/logger');

class FinancialReportingService {

  // ═══════════════════════════════════════════════════════════════════════════
  // Cash Flow Statement
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate Cash Flow Statement for a period.
   * Uses indirect method: start from net profit, adjust for non-cash items.
   */
  async generateCashFlow(startDate, endDate) {
    // Operating Activities
    const revenue = await query(
      `SELECT COALESCE(SUM(payment_received), 0) as collected
       FROM invoices WHERE invoice_date BETWEEN $1 AND $2
       AND status IN ('paid', 'partially_paid')`,
      [startDate, endDate]
    );

    const expenses = await query(
      `SELECT COALESCE(SUM(amount), 0) as paid
       FROM expenses WHERE expense_date BETWEEN $1 AND $2
       AND status = 'approved'`,
      [startDate, endDate]
    );

    const payroll = await query(
      `SELECT COALESCE(SUM(net_salary), 0) as paid
       FROM salary_slips
       WHERE strftime('%Y-%m', payroll_month) >= strftime('%Y-%m', $1)
         AND strftime('%Y-%m', payroll_month) <= strftime('%Y-%m', $2)
       AND status = 'paid'`,
      [startDate, endDate]
    );

    // Receivables change
    const arStart = await query(
      `SELECT COALESCE(SUM(payment_due), 0) as ar FROM invoices
       WHERE invoice_date < $1 AND status IN ('sent', 'partially_paid', 'overdue')`,
      [startDate]
    );
    const arEnd = await query(
      `SELECT COALESCE(SUM(payment_due), 0) as ar FROM invoices
       WHERE invoice_date <= $1 AND status IN ('sent', 'partially_paid', 'overdue')`,
      [endDate]
    );
    const arChange = parseFloat(arEnd.rows[0].ar) - parseFloat(arStart.rows[0].ar);

    const collected = parseFloat(revenue.rows[0].collected);
    const expensesPaid = parseFloat(expenses.rows[0].paid);
    const payrollPaid = parseFloat(payroll.rows[0].paid);

    const operatingCashFlow = this._round(collected - expensesPaid - payrollPaid);

    // Investing Activities (placeholder — no fixed assets module yet)
    const investingCashFlow = 0;

    // Financing Activities (PF deposits = outflow, loans = inflow)
    const pfDeposits = await query(
      `SELECT COALESCE(SUM(total_amount), 0) as total
       FROM pf_transactions WHERE payroll_month >= $1 AND payroll_month <= $2
       AND transaction_type = 'contribution'`,
      [startDate.substring(0, 7), endDate.substring(0, 7)]
    );
    const financingCashFlow = -parseFloat(pfDeposits.rows[0].total);

    const netCashFlow = this._round(operatingCashFlow + investingCashFlow + financingCashFlow);

    return {
      period: { start: startDate, end: endDate },
      operating_activities: {
        cash_from_customers: collected,
        cash_paid_to_suppliers: -expensesPaid,
        cash_paid_to_employees: -payrollPaid,
        change_in_receivables: -this._round(arChange),
        net_operating_cash_flow: operatingCashFlow,
      },
      investing_activities: {
        net_investing_cash_flow: investingCashFlow,
      },
      financing_activities: {
        pf_deposits: -parseFloat(pfDeposits.rows[0].total),
        net_financing_cash_flow: this._round(financingCashFlow),
      },
      net_cash_flow: netCashFlow,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Variance Analysis (Budget vs Actual)
  // ═══════════════════════════════════════════════════════════════════════════

  async getVarianceAnalysis(budgetId) {
    const budget = await query(`SELECT * FROM budgets WHERE id = $1`, [budgetId]);
    if (budget.rows.length === 0) throw new Error('Budget not found');
    const b = budget.rows[0];

    const items = await query(
      `SELECT * FROM budget_items WHERE budget_id = $1 ORDER BY item_type, category`,
      [budgetId]
    );

    // Get actuals from invoices (revenue) and expenses
    const fy = b.financial_year;
    const [fyStart, fyEndSuffix] = fy.split('-');
    // Support both '2025-26' (2-digit suffix) and '2025-2026' (4-digit)
    const endYr = fyEndSuffix.length === 2 ? '20' + fyEndSuffix : fyEndSuffix;
    const startDate = `${fyStart}-04-01`;
    const endDate = `${endYr}-03-31`;

    const actualRevenue = await query(
      `SELECT COALESCE(SUM(final_amount), 0) as total
       FROM invoices WHERE invoice_date BETWEEN $1 AND $2
       AND status IN ('sent', 'paid', 'partially_paid')`,
      [startDate, endDate]
    );

    const actualExpenses = await query(
      `SELECT category, COALESCE(SUM(amount), 0) as total
       FROM expenses WHERE expense_date BETWEEN $1 AND $2
       AND status = 'approved'
       GROUP BY category`,
      [startDate, endDate]
    );

    const actualPayroll = await query(
      `SELECT COALESCE(SUM(total_earnings), 0) as total
       FROM salary_slips
       WHERE strftime('%Y-%m', payroll_month) >= strftime('%Y-%m', $1)
         AND strftime('%Y-%m', payroll_month) <= strftime('%Y-%m', $2)
       AND status IN ('approved', 'paid')`,
      [startDate, endDate]
    );

    const expenseMap = {};
    for (const e of actualExpenses.rows) {
      expenseMap[e.category] = parseFloat(e.total);
    }

    // Build variance items
    const varianceItems = items.rows.map(item => {
      let actual = 0;
      if (item.item_type === 'revenue') {
        actual = parseFloat(actualRevenue.rows[0].total);
      } else if (item.category.toLowerCase().includes('payroll') || item.category.toLowerCase().includes('salary')) {
        actual = parseFloat(actualPayroll.rows[0].total);
      } else {
        actual = expenseMap[item.category] || 0;
      }

      const budgeted = parseFloat(item.annual_total);
      const variance = this._round(actual - budgeted);
      const variancePct = budgeted > 0 ? this._round((variance / budgeted) * 100) : 0;
      const isFavorable = item.item_type === 'revenue' ? variance >= 0 : variance <= 0;

      return {
        category: item.category,
        sub_category: item.sub_category,
        item_type: item.item_type,
        budgeted,
        actual,
        variance,
        variance_pct: variancePct,
        is_favorable: isFavorable,
      };
    });

    const totalBudgetedRevenue = varianceItems.filter(i => i.item_type === 'revenue').reduce((s, i) => s + i.budgeted, 0);
    const totalActualRevenue = varianceItems.filter(i => i.item_type === 'revenue').reduce((s, i) => s + i.actual, 0);
    const totalBudgetedExpense = varianceItems.filter(i => i.item_type === 'expense').reduce((s, i) => s + i.budgeted, 0);
    const totalActualExpense = varianceItems.filter(i => i.item_type === 'expense').reduce((s, i) => s + i.actual, 0);

    return {
      budget: { id: b.id, name: b.name, financial_year: b.financial_year },
      items: varianceItems,
      summary: {
        budgeted_revenue: this._round(totalBudgetedRevenue),
        actual_revenue: this._round(totalActualRevenue),
        revenue_variance: this._round(totalActualRevenue - totalBudgetedRevenue),
        budgeted_expense: this._round(totalBudgetedExpense),
        actual_expense: this._round(totalActualExpense),
        expense_variance: this._round(totalActualExpense - totalBudgetedExpense),
        budgeted_profit: this._round(totalBudgetedRevenue - totalBudgetedExpense),
        actual_profit: this._round(totalActualRevenue - totalActualExpense),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Financial KPIs
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calculate KPIs (pure computation, no DB).
   */
  calculateKPIs(params) {
    const { revenue, cogs, totalExpenses, receivables, payables, cashBalance, employeeCount, periodDays = 30 } = params;
    const D = (v) => new Decimal(v || 0);

    const grossProfit = D(revenue).minus(cogs || 0);
    const netProfit = D(revenue).minus(totalExpenses);
    const grossMargin = D(revenue).greaterThan(0) ? grossProfit.dividedBy(revenue).times(100).toDecimalPlaces(2) : D(0);
    const netMargin = D(revenue).greaterThan(0) ? netProfit.dividedBy(revenue).times(100).toDecimalPlaces(2) : D(0);

    // DSO = (Receivables / Revenue) × Days
    const dso = D(revenue).greaterThan(0)
      ? D(receivables).dividedBy(revenue).times(periodDays).toDecimalPlaces(1) : D(0);

    // Current Ratio = (Cash + Receivables) / Payables
    const currentAssets = D(cashBalance).plus(receivables);
    const currentRatio = D(payables).greaterThan(0)
      ? currentAssets.dividedBy(payables).toDecimalPlaces(2) : D(0);

    // Revenue per employee
    const revenuePerEmp = D(employeeCount).greaterThan(0)
      ? D(revenue).dividedBy(employeeCount).toDecimalPlaces(2) : D(0);

    return {
      gross_profit: this._toFloat(grossProfit),
      net_profit: this._toFloat(netProfit),
      gross_margin: this._toFloat(grossMargin),
      net_margin: this._toFloat(netMargin),
      dso: this._toFloat(dso),
      current_ratio: this._toFloat(currentRatio),
      revenue_per_employee: this._toFloat(revenuePerEmp),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Monthly Financial Snapshot
  // ═══════════════════════════════════════════════════════════════════════════

  async generateSnapshot(month) {
    const [year, mon] = month.split('-').map(Number);
    const startDate = `${month}-01`;
    const endDate = `${month}-${new Date(year, mon, 0).getDate()}`;
    const fy = mon >= 4 ? `${year}-${(year + 1).toString().slice(2)}` : `${year - 1}-${year.toString().slice(2)}`;

    // Revenue
    const rev = await query(
      `SELECT COALESCE(SUM(final_amount), 0) as invoiced,
              COALESCE(SUM(payment_received), 0) as collected
       FROM invoices WHERE strftime('%Y-%m', invoice_date) = $1
       AND status IN ('sent', 'paid', 'partially_paid')`,
      [month]
    );

    // Expenses
    const exp = await query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
       WHERE strftime('%Y-%m', expense_date) = $1 AND status = 'approved'`,
      [month]
    );

    // Payroll
    const payroll = await query(
      `SELECT COALESCE(SUM(total_earnings), 0) as total FROM salary_slips
       WHERE payroll_month = $1
       AND status IN ('approved', 'paid')`,
      [month]
    );

    // AR / AP
    const ar = await query(
      `SELECT COALESCE(SUM(payment_due), 0) as total FROM invoices
       WHERE status IN ('sent', 'partially_paid', 'overdue')
       AND invoice_date <= $1`,
      [endDate]
    );

    // Employee count
    const empCount = await query(
      `SELECT COUNT(*) as count FROM employees WHERE is_active = 1`
    );

    const invoiced = parseFloat(rev.rows[0].invoiced);
    const collected = parseFloat(rev.rows[0].collected);
    const totalExpenses = parseFloat(exp.rows[0].total) + parseFloat(payroll.rows[0].total);
    const receivables = parseFloat(ar.rows[0].total);
    const employees = parseInt(empCount.rows[0].count);

    const kpis = this.calculateKPIs({
      revenue: invoiced,
      cogs: parseFloat(payroll.rows[0].total),
      totalExpenses,
      receivables,
      payables: 0,
      cashBalance: collected,
      employeeCount: employees,
    });

    // Upsert snapshot
    const existing = await query(`SELECT id FROM financial_snapshots WHERE snapshot_month = $1`, [month]);
    const snapshotData = {
      snapshot_month: month,
      financial_year: fy,
      total_revenue: invoiced,
      invoiced_amount: invoiced,
      collected_amount: collected,
      total_expenses: totalExpenses,
      payroll_expense: parseFloat(payroll.rows[0].total),
      operational_expense: parseFloat(exp.rows[0].total),
      gross_profit: kpis.gross_profit,
      net_profit: kpis.net_profit,
      gross_margin: kpis.gross_margin,
      net_margin: kpis.net_margin,
      accounts_receivable: receivables,
      accounts_payable: 0,
      cash_balance: collected,
      dso: kpis.dso,
      current_ratio: kpis.current_ratio,
      employee_count: employees,
      revenue_per_employee: kpis.revenue_per_employee,
    };

    if (existing.rows.length > 0) {
      const fields = Object.keys(snapshotData).filter(k => k !== 'snapshot_month');
      const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
      const vals = fields.map(f => snapshotData[f]);
      vals.push(existing.rows[0].id);
      await query(`UPDATE financial_snapshots SET ${sets} WHERE id = $${vals.length}`, vals);
    } else {
      const fields = Object.keys(snapshotData);
      const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
      await query(
        `INSERT INTO financial_snapshots (${fields.join(', ')}) VALUES (${placeholders})`,
        fields.map(f => snapshotData[f])
      );
    }

    return snapshotData;
  }

  async getSnapshots(financialYear) {
    const result = await query(
      `SELECT * FROM financial_snapshots WHERE financial_year = $1 ORDER BY snapshot_month`,
      [financialYear]
    );
    return result.rows;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Budget CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  async createBudget(data) {
    await query(
      `INSERT INTO budgets (name, financial_year, budget_type, total_revenue_budget,
       total_expense_budget, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [data.name, data.financial_year, data.budget_type || 'annual',
       data.total_revenue_budget || 0, data.total_expense_budget || 0, data.notes || null]
    );
    const result = await query(`SELECT * FROM budgets ORDER BY id DESC LIMIT 1`);
    return result.rows[0];
  }

  async getBudgets(financialYear) {
    const conditions = financialYear ? 'WHERE financial_year = $1' : '';
    const params = financialYear ? [financialYear] : [];
    const result = await query(`SELECT * FROM budgets ${conditions} ORDER BY created_at DESC`, params);
    return result.rows;
  }

  async getBudget(id) {
    const budget = await query(`SELECT * FROM budgets WHERE id = $1`, [id]);
    if (budget.rows.length === 0) return null;
    const items = await query(`SELECT * FROM budget_items WHERE budget_id = $1 ORDER BY item_type, category`, [id]);
    return { ...budget.rows[0], items: items.rows };
  }

  async addBudgetItem(budgetId, data) {
    const total = (data.apr || 0) + (data.may || 0) + (data.jun || 0) + (data.jul || 0) +
      (data.aug || 0) + (data.sep || 0) + (data.oct || 0) + (data.nov || 0) +
      (data.dec_val || 0) + (data.jan || 0) + (data.feb || 0) + (data.mar || 0);

    await query(
      `INSERT INTO budget_items (budget_id, category, sub_category, item_type,
       apr, may, jun, jul, aug, sep, oct, nov, dec_val, jan, feb, mar, annual_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [budgetId, data.category, data.sub_category || null, data.item_type,
       data.apr || 0, data.may || 0, data.jun || 0, data.jul || 0,
       data.aug || 0, data.sep || 0, data.oct || 0, data.nov || 0,
       data.dec_val || 0, data.jan || 0, data.feb || 0, data.mar || 0, total]
    );
    return this.getBudget(budgetId);
  }

  async approveBudget(id, userId) {
    await query(
      `UPDATE budgets SET status = 'approved', approved_by = $1,
       approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND status = 'draft'`,
      [userId, id]
    );
    return this.getBudget(id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  _round(val) {
    return parseFloat(parseFloat(val || 0).toFixed(2));
  }

  _toFloat(decimal) {
    return parseFloat(new Decimal(decimal || 0).toDecimalPlaces(2).toString());
  }
}

module.exports = new FinancialReportingService();
