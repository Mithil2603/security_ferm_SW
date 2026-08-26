/**
 * src/services/payroll/pfCalculator.js
 * 
 * Provident Fund Calculator Service.
 * Handles PF account management, monthly contribution computation,
 * employer/employee split (PF + EPS), loan management, and interest.
 * 
 * Indian PF Rules:
 *  - Employee PF: 12% of Basic Salary
 *  - Employer PF:  3.67% of Basic to PF Account
 *  - Employer EPS: 8.33% of Basic to EPS (capped at ₹15,000 basic)
 *  - Admin Charges: ~0.50% of Basic (employer-paid)
 *  - EDLI: 0.50% of Basic (employer-paid, capped at ₹15,000 basic)
 *  - PF Basic Cap: ₹15,000/month (statutory minimum; can be on actual basic)
 */

const Decimal = require('decimal.js');
const { query } = require('../../database/connection');
const logger = require('../../utils/logger');

class PFCalculator {

  static PF_RATE_EMPLOYEE = 12;        // 12% of basic
  static PF_RATE_EMPLOYER_PF = 3.67;   // 3.67% to PF account
  static PF_RATE_EMPLOYER_EPS = 8.33;  // 8.33% to EPS
  static PF_BASIC_CAP = Number(process.env.PF_BASIC_CAP) || 15000;         // Statutory cap
  static ADMIN_CHARGE_RATE = 0.50;     // Admin charges
  static DEFAULT_INTEREST_RATE = 8.25; // FY 2024-25
  static GRATUITY_CAP = Number(process.env.GRATUITY_CAP) || 2000000;       // ₹20 lakhs

  // ═══════════════════════════════════════════════════════════════════════════
  // PF Contribution Calculation (pure, no DB)
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Calculate monthly PF contributions.
   * @param {number} basicSalary - Monthly basic salary
   * @param {boolean} [capAtStatutory=false] - Cap basic at ₹15,000
   * @returns {Object} Breakdown of employee/employer contributions
   */
  calculateContribution(basicSalary, capAtStatutory = false) {
    const D = (v) => new Decimal(v || 0);
    const basic = D(basicSalary);
    const pfBasic = capAtStatutory ? Decimal.min(basic, PFCalculator.PF_BASIC_CAP) : basic;
    const epsBasic = Decimal.min(basic, PFCalculator.PF_BASIC_CAP); // EPS always capped

    // Employee contribution: 12% of basic (or capped basic)
    const employeeContribution = pfBasic.times(PFCalculator.PF_RATE_EMPLOYEE).dividedBy(100).toDecimalPlaces(2);

    // Employer EPS: 8.33% of basic capped at 15K
    const employerEPS = epsBasic.times(PFCalculator.PF_RATE_EMPLOYER_EPS).dividedBy(100).toDecimalPlaces(2);

    // Employer PF: 3.67% of basic (same base as employee)
    const employerPF = pfBasic.times(PFCalculator.PF_RATE_EMPLOYER_PF).dividedBy(100).toDecimalPlaces(2);

    // Admin charges: 0.50% of basic
    const adminCharges = pfBasic.times(PFCalculator.ADMIN_CHARGE_RATE).dividedBy(100).toDecimalPlaces(2);

    // Total employer cost
    const totalEmployer = employerPF.plus(employerEPS).plus(adminCharges).toDecimalPlaces(2);

    return {
      basic_salary: this._toFloat(basic),
      pf_basic: this._toFloat(pfBasic),
      employee_contribution: this._toFloat(employeeContribution),
      employer_pf_contribution: this._toFloat(employerPF),
      employer_eps_contribution: this._toFloat(employerEPS),
      admin_charges: this._toFloat(adminCharges),
      total_employer_cost: this._toFloat(totalEmployer),
      total_monthly_deposit: this._toFloat(employeeContribution.plus(employerPF).plus(employerEPS)),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PF Account CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  async getAccount(employeeId) {
    const result = await query(
      `SELECT pa.*, e.full_name, e.employee_id as emp_code, e.date_of_joining,
              e.designation, ss.base_salary
       FROM pf_accounts pa
       JOIN employees e ON pa.employee_id = e.id
       LEFT JOIN salary_structures ss ON e.salary_structure_id = ss.id
       WHERE pa.employee_id = $1`,
      [employeeId]
    );
    return result.rows[0] || null;
  }

  async createAccount(employeeId, data = {}) {
    const emp = await query('SELECT id FROM employees WHERE id = $1', [employeeId]);
    if (!emp.rows.length) throw new Error('Employee not found');

    const existing = await this.getAccount(employeeId);
    if (existing) throw new Error('PF account already exists for this employee');

    await query(
      `INSERT INTO pf_accounts (employee_id, uan_number, pf_number, date_of_enrollment)
       VALUES ($1, $2, $3, $4)`,
      [employeeId, data.uan_number || null, data.pf_number || null,
       data.date_of_enrollment || new Date().toISOString().split('T')[0]]
    );
    return this.getAccount(employeeId);
  }

  async updateAccount(employeeId, data) {
    const fields = [];
    const params = [];
    let pc = 1;
    for (const key of ['uan_number', 'pf_number', 'interest_rate']) {
      if (data[key] !== undefined) {
        fields.push(`${key} = $${pc}`);
        params.push(data[key]);
        pc++;
      }
    }
    if (fields.length === 0) return this.getAccount(employeeId);
    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(employeeId);
    await query(
      `UPDATE pf_accounts SET ${fields.join(', ')} WHERE employee_id = $${pc}`,
      params
    );
    return this.getAccount(employeeId);
  }

  async listAccounts(filters = {}) {
    const { is_active = 1, page = 1, limit = 50 } = filters;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT pa.*, e.full_name, e.employee_id as emp_code, e.designation,
              e.date_of_joining, ss.base_salary
       FROM pf_accounts pa
       JOIN employees e ON pa.employee_id = e.id
       LEFT JOIN salary_structures ss ON e.salary_structure_id = ss.id
       WHERE pa.is_active = $1
       ORDER BY e.full_name
       LIMIT $2 OFFSET $3`,
      [is_active, parseInt(limit), offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as count FROM pf_accounts WHERE is_active = $1`, [is_active]
    );

    return {
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Monthly PF Processing
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Process monthly PF contribution for a single employee.
   */
  async processMonthly(employeeId, payrollMonth, basicSalary, salarySlipId = null) {
    const account = await this.getAccount(employeeId);
    if (!account) throw new Error(`No PF account for employee #${employeeId}`);

    // Check duplicate
    const existing = await query(
      `SELECT id FROM pf_transactions WHERE employee_id = $1 AND payroll_month = $2 AND transaction_type = 'contribution'`,
      [employeeId, payrollMonth]
    );
    if (existing.rows.length > 0) {
      throw new Error(`PF contribution already recorded for ${payrollMonth}`);
    }

    const contrib = this.calculateContribution(basicSalary);
    const totalDeposit = contrib.employee_contribution + contrib.employer_pf_contribution + contrib.employer_eps_contribution;

    // Update account balances first and get the new total balance (prevents race condition)
    const updateRes = await query(
      `UPDATE pf_accounts SET 
         employee_balance = employee_balance + $1,
         employer_balance = employer_balance + $2,
         eps_balance = eps_balance + $3,
         total_balance = total_balance + $4,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING total_balance`,
      [contrib.employee_contribution, contrib.employer_pf_contribution,
       contrib.employer_eps_contribution, totalDeposit, account.id]
    );
    const newBalance = parseFloat(updateRes.rows[0].total_balance);

    // Insert transaction
    try {
      await query(
        `INSERT INTO pf_transactions 
          (pf_account_id, employee_id, payroll_month, transaction_type,
           basic_salary, employee_contribution, employer_pf_contribution,
           employer_eps_contribution, admin_charges, total_amount, running_balance, salary_slip_id)
         VALUES ($1, $2, $3, 'contribution', $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          account.id, employeeId, payrollMonth,
          contrib.basic_salary, contrib.employee_contribution,
          contrib.employer_pf_contribution, contrib.employer_eps_contribution,
          contrib.admin_charges, totalDeposit, newBalance, salarySlipId,
        ]
      );
    } catch (err) {
      if (err.code === '23503') throw new Error('Employee record missing');
      throw err;
    }

    return { contribution: contrib, new_balance: newBalance };
  }

  /**
   * Batch process PF for all active employees for a month.
   */
  async batchProcess(payrollMonth) {
    const employees = await query(
      `SELECT e.id, e.full_name, ss.base_salary
       FROM employees e
       JOIN pf_accounts pa ON e.id = pa.employee_id AND pa.is_active = 1
       LEFT JOIN salary_structures ss ON e.salary_structure_id = ss.id
       WHERE e.is_active = 1 AND ss.base_salary IS NOT NULL`
    );

    let processed = 0, skipped = 0, errors = 0;
    const results = [];

    for (const emp of employees.rows) {
      try {
        const existing = await query(
          `SELECT id FROM pf_transactions WHERE employee_id = $1 AND payroll_month = $2 AND transaction_type = 'contribution'`,
          [emp.id, payrollMonth]
        );
        if (existing.rows.length > 0) { skipped++; continue; }

        const result = await this.processMonthly(emp.id, payrollMonth, emp.base_salary);
        results.push({ employee: emp.full_name, status: 'processed', ...result.contribution });
        processed++;
      } catch (err) {
        results.push({ employee: emp.full_name, status: 'error', error: err.message });
        errors++;
      }
    }

    return { processed, skipped, errors, total: employees.rows.length, details: results };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Transaction History
  // ═══════════════════════════════════════════════════════════════════════════

  async getTransactions(employeeId, filters = {}) {
    const { page = 1, limit = 24 } = filters;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT * FROM pf_transactions 
       WHERE employee_id = $1 
       ORDER BY payroll_month DESC, created_at DESC
       LIMIT $2 OFFSET $3`,
      [employeeId, parseInt(limit), offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as count FROM pf_transactions WHERE employee_id = $1`,
      [employeeId]
    );

    return {
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Interest Calculation (annual)
  // ═══════════════════════════════════════════════════════════════════════════

  async calculateInterest(employeeId, financialYear) {
    const account = await this.getAccount(employeeId);
    if (!account) throw new Error('PF account not found');

    const D = (v) => new Decimal(v || 0);
    const rate = D(account.interest_rate || PFCalculator.DEFAULT_INTEREST_RATE);
    const balance = D(account.total_balance);
    const interest = balance.times(rate).dividedBy(100).toDecimalPlaces(2);

    return {
      balance: this._toFloat(balance),
      interest_rate: this._toFloat(rate),
      annual_interest: this._toFloat(interest),
      monthly_interest: this._toFloat(interest.dividedBy(12).toDecimalPlaces(2)),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PF Loans
  // ═══════════════════════════════════════════════════════════════════════════

  async createLoan(employeeId, data) {
    const account = await this.getAccount(employeeId);
    if (!account) throw new Error('PF account not found');

    // Max loan: 75% of employee balance
    const maxLoan = parseFloat((account.employee_balance * 0.75).toFixed(2));
    if (data.loan_amount > maxLoan) {
      throw new Error(`Loan amount exceeds 75% of employee PF balance (max: ₹${maxLoan})`);
    }

    await query(
      `INSERT INTO pf_loans (pf_account_id, employee_id, loan_amount, outstanding_balance,
       monthly_repayment, interest_rate, purpose, status, start_month)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
      [account.id, employeeId, data.loan_amount, data.loan_amount,
       data.monthly_repayment, data.interest_rate || 1,
       data.purpose || 'other', data.start_month]
    );

    return this.getLoans(employeeId);
  }

  async approveLoan(loanId, userId) {
    await query(
      `UPDATE pf_loans SET status = 'active', approved_by = $1, approved_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND status = 'pending'`,
      [userId, loanId]
    );
    const result = await query(`SELECT * FROM pf_loans WHERE id = $1`, [loanId]);
    return result.rows[0];
  }

  async getLoans(employeeId) {
    const result = await query(
      `SELECT * FROM pf_loans WHERE employee_id = $1 ORDER BY created_at DESC`,
      [employeeId]
    );
    return result.rows;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private
  // ═══════════════════════════════════════════════════════════════════════════

  _toFloat(decimal) {
    return parseFloat(new Decimal(decimal || 0).toDecimalPlaces(2).toString());
  }
}

module.exports = new PFCalculator();
