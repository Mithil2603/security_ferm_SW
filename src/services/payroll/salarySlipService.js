/**
 * src/services/payroll/salarySlipService.js
 * 
 * Service for generating salary slips from salary structures.
 * Handles generation, batch processing, approval workflow,
 * and component-level breakdowns.
 */

const { query } = require('../../database/connection');
const { add, subtract, multiply, divide, percentage, toDecimal, sum } = require('../utils/decimalMath');
const { daysInMonth } = require('../utils/dateCalculator');
const {
  normalizePayrollMonth,
  resolveAttendanceDays,
  getMissingAttendancePolicy,
} = require('./attendanceCalculator');
const { resolvePfPercentage } = require('./statutory');
const Decimal = require('decimal.js');
const logger = require('../../utils/logger');

class SalarySlipService {

  /**
   * Generate a salary slip for a single employee for a given month.
   *
   * @param {number}  employeeId
   * @param {string}  payrollMonth  the payroll PERIOD, "YYYY-MM". This is the
   *                                only date the calculation trusts — it is not
   *                                derived from "today", so early/festival runs
   *                                keep calculating the selected month.
   * @param {number}  [daysWorked]  explicit payable-days override for manual
   *                                corrections. When omitted, payable days are
   *                                computed from THIS month's attendance.
   * @param {number}  userId
   */
  async generate(employeeId, payrollMonth, daysWorked, userId, options = {}) {
    payrollMonth = normalizePayrollMonth(payrollMonth);

    const { calculation_basis = 'full_month', cut_off_day = null } = options;

    // Check for duplicate
    const existing = await query(
      `SELECT id FROM salary_slips WHERE employee_id = $1 AND payroll_month = $2`,
      [employeeId, payrollMonth]
    );
    if (existing.rows.length > 0) {
      throw new Error(`Salary slip already exists for employee #${employeeId} for ${payrollMonth}`);
    }

    // Get employee with salary structure
    const empResult = await query(
      `SELECT e.*, ss.id as struct_id, ss.base_salary, ss.dearness_allowance, 
              ss.house_rent_allowance, ss.other_allowances, ss.pf_percentage, 
              ss.esi_applicable, ss.income_tax_applicable, ss.name as structure_name
       FROM employees e
       LEFT JOIN salary_structures ss ON e.salary_structure_id = ss.id
       WHERE e.id = $1 AND e.is_active = 1`,
      [employeeId]
    );

    if (empResult.rows.length === 0) throw new Error('Employee not found or inactive');
    const emp = empResult.rows[0];
    if (!emp.base_salary) throw new Error(`No salary structure assigned to ${emp.full_name}`);

    // Parse month
    const [year, month] = payrollMonth.split('-').map(Number);
    const calendarDays = daysInMonth(month, year);

    // If calculation_basis is 'to_date', bound evaluation to cut_off_day
    const isToDate = calculation_basis === 'to_date' && cut_off_day && Number(cut_off_day) > 0;
    const periodDays = isToDate ? Math.min(Number(cut_off_day), calendarDays) : calendarDays;
    const cutOffDate = isToDate ? `${payrollMonth}-${String(periodDays).padStart(2, '0')}` : null;

    // Payable days: use explicit override if provided, otherwise derive from attendance
    let effectiveDays;
    let attendanceSummary = null;
    if (daysWorked !== undefined && daysWorked !== null && daysWorked !== '') {
      effectiveDays = Number(daysWorked);
    } else {
      const missingPolicy = await getMissingAttendancePolicy(query);
      attendanceSummary = await resolveAttendanceDays(query, employeeId, payrollMonth, missingPolicy, cutOffDate);
      effectiveDays = attendanceSummary.payableDays;
    }
    if (!Number.isFinite(effectiveDays) || effectiveDays < 0) effectiveDays = 0;
    if (effectiveDays > periodDays) effectiveDays = periodDays;

    const absentDays = Math.round((periodDays - effectiveDays) * 100) / 100;
    // Daily wage is based on standard calendar days of the month
    const ratio = new Decimal(effectiveDays).dividedBy(calendarDays);

    // ─── Calculate Earnings ───────────────────────────────────────────────────
    const earnings = [];
    const D = (v) => new Decimal(v || 0);

    const baseSalary = D(emp.base_salary).times(ratio).toDecimalPlaces(2);
    earnings.push({ code: 'BASIC', name: 'Basic Salary', amount: parseFloat(baseSalary.toString()), order: 1 });

    const hra = D(emp.house_rent_allowance).times(ratio).toDecimalPlaces(2);
    if (hra.greaterThan(0)) {
      earnings.push({ code: 'HRA', name: 'House Rent Allowance', amount: parseFloat(hra.toString()), order: 2 });
    }

    const da = D(emp.dearness_allowance).times(ratio).toDecimalPlaces(2);
    if (da.greaterThan(0)) {
      earnings.push({ code: 'DA', name: 'Dearness Allowance', amount: parseFloat(da.toString()), order: 3 });
    }

    // Fetch unsettled ledger additions
    const ledgerResult = await query(
      `SELECT * FROM employee_ledger WHERE employee_id = $1 AND payroll_id IS NULL`,
      [employeeId]
    );
    let customAdditions = D(0);
    let customDeductions = D(0);
    for (const adj of ledgerResult.rows) {
      if (adj.type === 'addition') customAdditions = customAdditions.plus(adj.amount);
      if (adj.type === 'deduction') customDeductions = customDeductions.plus(adj.amount);
    }

    const otherAllow = D(emp.other_allowances).times(ratio).plus(customAdditions).toDecimalPlaces(2);
    if (otherAllow.greaterThan(0)) {
      earnings.push({ code: 'SPECIAL', name: 'Special / Other Allowances', amount: parseFloat(otherAllow.toString()), order: 4 });
    }

    const totalEarnings = earnings.reduce((sum, e) => sum.plus(e.amount), D(0)).toDecimalPlaces(2);
    const grossSalary = totalEarnings;

    // ─── Calculate Deductions ─────────────────────────────────────────────────
    const deductions = [];

    // PF (Employee share): on basic salary.
    // resolvePfPercentage honours an explicit 0 — only an unset value
    // falls back to the statutory 12%.
    const pfPercentage = resolvePfPercentage(emp.pf_percentage);
    const pfAmount = baseSalary.times(D(pfPercentage)).dividedBy(100).toDecimalPlaces(2);
    if (pfAmount.greaterThan(0)) {
      deductions.push({ code: 'PF_EE', name: 'Provident Fund (Employee)', amount: parseFloat(pfAmount.toString()), order: 10 });
    }

    // ESI: 0.75% of gross (applicable if gross ≤ 21,000)
    if (emp.esi_applicable) {
      const monthlyGross = D(emp.base_salary).plus(emp.house_rent_allowance).plus(emp.dearness_allowance).plus(emp.other_allowances);
      if (monthlyGross.lessThanOrEqualTo(21000)) {
        const esiAmount = grossSalary.times(0.0075).toDecimalPlaces(2);
        if (esiAmount.greaterThan(0)) {
          deductions.push({ code: 'ESI_EE', name: 'ESI (Employee)', amount: parseFloat(esiAmount.toString()), order: 11 });
        }
      }
    }

    // TDS (monthly income tax) — basic slab calculation (New Regime FY 2025-26)
    if (emp.income_tax_applicable) {
      const standardDeduction = D(75000);
      const annualizedGross = grossSalary.times(12).minus(standardDeduction);
      const taxableIncome = annualizedGross.greaterThan(0) ? annualizedGross : D(0);
      let annualTax = D(0);

      if (taxableIncome.greaterThan(1500000)) {
        annualTax = taxableIncome.minus(1500000).times(0.3).plus(150000);
      } else if (taxableIncome.greaterThan(1200000)) {
        annualTax = taxableIncome.minus(1200000).times(0.2).plus(90000);
      } else if (taxableIncome.greaterThan(900000)) {
        annualTax = taxableIncome.minus(900000).times(0.15).plus(45000);
      } else if (taxableIncome.greaterThan(600000)) {
        annualTax = taxableIncome.minus(600000).times(0.1).plus(15000);
      } else if (taxableIncome.greaterThan(300000)) {
        annualTax = taxableIncome.minus(300000).times(0.05);
      }

      // Section 87A Rebate
      if (annualizedGross.lessThanOrEqualTo(1200000)) {
        annualTax = D(0);
      }

      const monthlyTDS = annualTax.dividedBy(12).toDecimalPlaces(2);
      if (monthlyTDS.greaterThan(0)) {
        deductions.push({ code: 'TDS', name: 'Tax Deducted at Source', amount: parseFloat(monthlyTDS.toString()), order: 13 });
      }
    }

    // Custom deductions from ledger
    if (customDeductions.greaterThan(0)) {
      deductions.push({ code: 'ADV', name: 'Ledger Deductions / Advances', amount: parseFloat(customDeductions.toString()), order: 15 });
    }

    const totalDeductions = deductions.reduce((sum, d) => sum.plus(d.amount), D(0)).toDecimalPlaces(2);
    const netSalary = grossSalary.minus(totalDeductions).toDecimalPlaces(2);

    if (netSalary.lessThan(0)) {
      throw new Error(`Deductions (₹${totalDeductions}) exceed Gross (₹${grossSalary}). Cannot generate negative net pay.`);
    }

    // ─── Insert Salary Slip ───────────────────────────────────────────────────
    const slipResult = await query(
      `INSERT INTO salary_slips 
        (employee_id, payroll_month, salary_structure_id, days_in_month, days_worked, days_absent,
         total_earnings, total_deductions, net_salary, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10)`,
      [
        employeeId, payrollMonth, emp.struct_id, periodDays, effectiveDays, absentDays,
        parseFloat(totalEarnings.toString()),
        parseFloat(totalDeductions.toString()),
        parseFloat(netSalary.toString()),
        userId,
      ]
    );

    const slipId = slipResult.insertId || slipResult.lastInsertRowid || (slipResult.rows && slipResult.rows[0]?.id);

    // ─── Insert Component Breakdown ───────────────────────────────────────────
    for (const e of earnings) {
      await query(
        `INSERT INTO salary_slip_components (salary_slip_id, component_code, component_name, type, amount, display_order)
          VALUES ($1, $2, $3, 'earning', $4, $5)`,
        [slipId, e.code, e.name, e.amount, e.order]
      );
    }
    for (const d of deductions) {
      await query(
        `INSERT INTO salary_slip_components (salary_slip_id, component_code, component_name, type, amount, display_order)
          VALUES ($1, $2, $3, 'deduction', $4, $5)`,
        [slipId, d.code, d.name, d.amount, d.order]
      );
    }

    return this.findById(slipId);
  }

  /**
   * Batch generate salary slips for all active employees for one payroll month.
   *
   * Uses exactly the same attendance resolution and salary calculation as
   * generate() — each employee's payable days come from resolveAttendanceDays()
   * for the SELECTED month only.
   */
  async batchGenerate(payrollMonth, userId, options = {}) {
    payrollMonth = normalizePayrollMonth(payrollMonth);
    const missingPolicy = await getMissingAttendancePolicy(query);

    const [year, month] = payrollMonth.split('-').map(Number);
    const calendarDays = daysInMonth(month, year);
    const isToDate = options.calculation_basis === 'to_date' && options.cut_off_day && Number(options.cut_off_day) > 0;
    const periodDays = isToDate ? Math.min(Number(options.cut_off_day), calendarDays) : calendarDays;
    const cutOffDate = isToDate ? `${payrollMonth}-${String(periodDays).padStart(2, '0')}` : null;

    const employees = await query(
      `SELECT e.id, e.full_name, e.salary_structure_id
       FROM employees e
       WHERE e.is_active = 1 AND e.salary_structure_id IS NOT NULL`
    );

    let generated = 0, skipped = 0, errors = 0;
    const results = [];

    for (const emp of employees.rows) {
      try {
        // Check existing
        const existing = await query(
          `SELECT id FROM salary_slips WHERE employee_id = $1 AND payroll_month = $2`,
          [emp.id, payrollMonth]
        );
        if (existing.rows.length > 0) { skipped++; continue; }

        // Resolve payable days from THIS month's attendance (shared calculator).
        const att = await resolveAttendanceDays(query, emp.id, payrollMonth, missingPolicy, cutOffDate);

        const slip = await this.generate(emp.id, payrollMonth, att.payableDays, userId, options);
        results.push({
          employee: emp.full_name,
          status: 'generated',
          slip_id: slip.id,
          days: {
            payable: att.payableDays,
            present: att.presentDays,
            half_day: att.halfDays,
            holiday: att.holidayDays,
            leave: att.leaveDays,
            absent: att.absentDays,
            missing: att.missingDays,
            total: periodDays,
          },
        });
        generated++;
      } catch (err) {
        results.push({ employee: emp.full_name, status: 'error', error: err.message });
        errors++;
      }
    }

    return {
      generated,
      skipped,
      errors,
      total: employees.rows.length,
      payroll_month: payrollMonth,
      calculation_basis: isToDate ? 'to_date' : 'full_month',
      cut_off_day: periodDays,
      missing_attendance_policy: missingPolicy,
      details: results,
    };
  }

  /**
   * Find a salary slip by ID with components.
   */
  async findById(id) {
    const result = await query(
      `SELECT ss.*, e.full_name as employee_name, e.employee_id as emp_code,
              e.designation, e.bank_account_number, e.bank_ifsc_code, e.bank_name,
              e.pan_number, e.aadhar_number,
              st.name as structure_name,
              st.base_salary as struct_base_salary,
              st.dearness_allowance as struct_da,
              st.house_rent_allowance as struct_hra,
              st.other_allowances as struct_other,
              u.full_name as approved_by_name
       FROM salary_slips ss
       JOIN employees e ON ss.employee_id = e.id
       LEFT JOIN salary_structures st ON ss.salary_structure_id = st.id
       LEFT JOIN users u ON ss.approved_by = u.id
       WHERE ss.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return null;

    const slip = result.rows[0];

    // Fetch components
    const comps = await query(
      `SELECT * FROM salary_slip_components WHERE salary_slip_id = $1 ORDER BY display_order`,
      [id]
    );
    slip.earnings = comps.rows.filter(c => c.type === 'earning');
    slip.deductions = comps.rows.filter(c => c.type === 'deduction');

    // Calculate full monthly gross & loss of pay (LOP)
    const structBase = parseFloat(slip.struct_base_salary || 0);
    const structDa = parseFloat(slip.struct_da || 0);
    const structHra = parseFloat(slip.struct_hra || 0);
    const structOther = parseFloat(slip.struct_other || 0);
    const fullGross = structBase + structDa + structHra + structOther;

    slip.full_monthly_gross = fullGross > 0 ? fullGross : parseFloat(slip.total_earnings);
    slip.struct_base_salary = structBase;
    slip.struct_da = structDa;
    slip.struct_hra = structHra;
    slip.struct_other = structOther;

    const daysInMonth = parseInt(slip.days_in_month) || 30;
    const daysWorked = parseFloat(slip.days_worked) || 0;
    slip.lop_amount = Math.max(0, Math.round((slip.full_monthly_gross - parseFloat(slip.total_earnings)) * 100) / 100);

    return slip;
  }

  /**
   * List salary slips with filters.
   */
  async findAll(filters = {}) {
    const { employee_id, payroll_month, status, page = 1, limit = 50 } = filters;

    let conditions = [];
    let params = [];
    let pc = 1;

    if (employee_id) { conditions.push(`ss.employee_id = $${pc}`); params.push(employee_id); pc++; }
    if (payroll_month) { conditions.push(`ss.payroll_month = $${pc}`); params.push(payroll_month); pc++; }
    if (status) { conditions.push(`ss.status = $${pc}`); params.push(status); pc++; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT ss.*, e.full_name as employee_name, e.employee_id as emp_code, e.designation,
              st.name as structure_name
       FROM salary_slips ss
       JOIN employees e ON ss.employee_id = e.id
       LEFT JOIN salary_structures st ON ss.salary_structure_id = st.id
       ${where}
       ORDER BY ss.payroll_month DESC, e.full_name ASC
       LIMIT $${pc} OFFSET $${pc + 1}`,
      [...params, parseInt(limit), offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as count FROM salary_slips ss ${where}`,
      params
    );

    // Summary totals for the filtered set
    const totalsResult = await query(
      `SELECT 
         SUM(total_earnings) as sum_earnings,
         SUM(total_deductions) as sum_deductions,
         SUM(net_salary) as sum_net,
         COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft_count,
         COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
         COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_count,
         COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_count
       FROM salary_slips ss ${where}`,
      params
    );

    return {
      data: result.rows,
      summary: totalsResult.rows[0],
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
      },
    };
  }

  // ─── Approval Workflow ────────────────────────────────────────────────────

  /**
   * Submit slip for approval (draft → pending).
   */
  async submitForApproval(id) {
    return this._transition(id, 'draft', 'pending');
  }

  /**
   * Approve a salary slip (pending → approved).
   */
  async approve(id, userId) {
    const slip = await this.findById(id);
    if (!slip) throw new Error('Salary slip not found');
    if (slip.status !== 'pending') throw new Error('Only pending slips can be approved');

    await query(
      `UPDATE salary_slips SET status = 'approved', approved_by = $1, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [userId, id]
    );
    return this.findById(id);
  }

  /**
   * Bulk approve all pending slips for a month.
   */
  async bulkApprove(payrollMonth, userId) {
    const result = await query(
      `UPDATE salary_slips SET status = 'approved', approved_by = $1, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE payroll_month = $2 AND status = 'pending'`,
      [userId, payrollMonth]
    );
    return { approved: result.rowCount, payroll_month: payrollMonth };
  }

  /**
   * Mark as paid (draft/pending/approved → paid).
   */
  async markPaid(id, paymentDetails = {}) {
    const slip = await this.findById(id);
    if (!slip) throw new Error('Salary slip not found');
    if (slip.status === 'paid') throw new Error('Salary slip is already marked as paid');
    if (slip.status === 'cancelled') throw new Error('Cannot pay a cancelled salary slip');

    const paidAt = paymentDetails.payment_date 
      ? new Date(paymentDetails.payment_date) 
      : new Date();

    await query(
      `UPDATE salary_slips SET status = 'paid', paid_at = $1, 
       payment_method = $2, transaction_reference = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [paidAt, paymentDetails.payment_method || 'bank_transfer', paymentDetails.transaction_reference || null, id]
    );
    return this.findById(id);
  }

  /**
   * Cancel a slip (any status except paid → cancelled).
   */
  async cancel(id) {
    const slip = await this.findById(id);
    if (!slip) throw new Error('Salary slip not found');
    if (slip.status === 'paid') throw new Error('Cannot cancel a paid salary slip');

    await query(
      `UPDATE salary_slips SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );
    return this.findById(id);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  async _transition(id, fromStatus, toStatus) {
    const slip = await this.findById(id);
    if (!slip) throw new Error('Salary slip not found');
    if (slip.status !== fromStatus) throw new Error(`Slip must be "${fromStatus}" to transition to "${toStatus}"`);

    await query(
      `UPDATE salary_slips SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [toStatus, id]
    );
    return this.findById(id);
  }
}

module.exports = new SalarySlipService();
