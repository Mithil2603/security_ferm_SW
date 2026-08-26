/**
 * src/services/payroll/gratuityCalculator.js
 * 
 * Gratuity Calculator Service.
 * Indian Payment of Gratuity Act, 1972:
 *  - Eligible after 5 years of continuous service
 *  - Formula: (Last drawn Basic + DA) × Years of Service / 26
 *  - Cap: ₹20,00,000
 *  - Monthly provisioning for liability management
 */

const Decimal = require('decimal.js');
const { query } = require('../../database/connection');
const { yearsOfService } = require('../utils/dateCalculator');
const logger = require('../../utils/logger');

class GratuityCalculator {

  static GRATUITY_CAP = 2000000;  // ₹20 lakhs
  static MIN_YEARS = 5;           // Minimum years for eligibility
  static DIVISOR = 26;            // Working days in a month

  // ═══════════════════════════════════════════════════════════════════════════
  // Pure Calculation (no DB)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calculate gratuity amount.
   * @param {number} lastBasic - Last drawn monthly basic salary
   * @param {number} lastDA - Last drawn monthly DA
   * @param {number} years - Completed years of service
   * @returns {Object} Gratuity breakdown
   */
  calculate(lastBasic, lastDA, years) {
    const D = (v) => new Decimal(v || 0);
    const basicPlusDa = D(lastBasic).plus(lastDA);
    const yrs = D(years);

    // Statutory formula: (Basic + DA) × 15 days per month × Years / 26 working days per month
    const gratuity = basicPlusDa.times(15).times(yrs).dividedBy(GratuityCalculator.DIVISOR).toDecimalPlaces(2);

    const capped = Decimal.min(gratuity, GratuityCalculator.GRATUITY_CAP);
    const isEligible = Math.floor(years) >= GratuityCalculator.MIN_YEARS;
    
    const monthlyProvision = (!isEligible || yrs.lte(0)) 
                             ? 0 
                             : capped.dividedBy(yrs.times(12)).toDecimalPlaces(2);

    return {
      last_drawn_basic: this._toFloat(D(lastBasic)),
      last_drawn_da: this._toFloat(D(lastDA)),
      basic_plus_da: this._toFloat(basicPlusDa),
      years_of_service: years,
      is_eligible: isEligible,
      calculated_amount: this._toFloat(gratuity),
      capped_amount: this._toFloat(capped),
      is_capped: gratuity.greaterThan(GratuityCalculator.GRATUITY_CAP),
      monthly_provision: this._toFloat(monthlyProvision),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Employee Gratuity Estimate
  // ═══════════════════════════════════════════════════════════════════════════

  async getEmployeeEstimate(employeeId) {
    const result = await query(
      `SELECT e.*, ss.base_salary, ss.dearness_allowance
       FROM employees e
       LEFT JOIN salary_structures ss ON e.salary_structure_id = ss.id
       WHERE e.id = $1`,
      [employeeId]
    );
    if (result.rows.length === 0) throw new Error('Employee not found');
    const emp = result.rows[0];

    const years = yearsOfService(emp.date_of_joining);
    const gratuity = this.calculate(
      emp.base_salary || 0,
      emp.dearness_allowance || 0,
      years
    );

    return {
      employee: { id: emp.id, name: emp.full_name, designation: emp.designation, date_of_joining: emp.date_of_joining },
      ...gratuity,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Monthly Accrual (Provisioning)
  // ═══════════════════════════════════════════════════════════════════════════

  async processMonthlyAccrual(employeeId, accrualMonth) {
    if (!/^\d{4}-\d{2}$/.test(accrualMonth)) throw new Error('Invalid month format');
    const result = await query(
      `SELECT e.*, ss.base_salary, ss.dearness_allowance
       FROM employees e
       LEFT JOIN salary_structures ss ON e.salary_structure_id = ss.id
       WHERE e.id = $1 AND e.is_active = 1`,
      [employeeId]
    );
    if (result.rows.length === 0) throw new Error('Active employee not found');
    const emp = result.rows[0];

    // Check duplicate
    const existing = await query(
      `SELECT id FROM gratuity_accruals WHERE employee_id = $1 AND accrual_month = $2`,
      [employeeId, accrualMonth]
    );
    if (existing.rows.length > 0) throw new Error(`Accrual already recorded for ${accrualMonth}`);

    const years = yearsOfService(emp.date_of_joining);
    const gratuity = this.calculate(emp.base_salary || 0, emp.dearness_allowance || 0, years);

    // Get cumulative
    const cumResult = await query(
      `SELECT COALESCE(SUM(monthly_provision), 0) as cum FROM gratuity_accruals WHERE employee_id = $1`,
      [employeeId]
    );
    const cumulative = parseFloat(cumResult.rows[0].cum) + gratuity.monthly_provision;

    await query(
      `INSERT INTO gratuity_accruals (employee_id, accrual_month, basic_plus_da, years_of_service,
       gratuity_amount, monthly_provision, cumulative_provision, is_eligible)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        employeeId, accrualMonth, gratuity.basic_plus_da, years,
        gratuity.capped_amount, gratuity.monthly_provision, cumulative,
        gratuity.is_eligible ? 1 : 0,
      ]
    );

    return { ...gratuity, cumulative_provision: cumulative };
  }

  /**
   * Batch process monthly gratuity accruals for all active employees.
   */
  async batchAccrual(accrualMonth) {
    const employees = await query(
      `SELECT e.id, e.full_name
       FROM employees e
       LEFT JOIN salary_structures ss ON e.salary_structure_id = ss.id
       WHERE e.is_active = 1 AND ss.base_salary IS NOT NULL`
    );

    let processed = 0, skipped = 0, errors = 0;
    for (const emp of employees.rows) {
      try {
        const existing = await query(
          `SELECT id FROM gratuity_accruals WHERE employee_id = $1 AND accrual_month = $2`,
          [emp.id, accrualMonth]
        );
        if (existing.rows.length > 0) { skipped++; continue; }
        await this.processMonthlyAccrual(emp.id, accrualMonth);
        processed++;
      } catch (err) {
        errors++;
      }
    }
    return { processed, skipped, errors, total: employees.rows.length };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Gratuity Payout (on separation)
  // ═══════════════════════════════════════════════════════════════════════════

  async createPayout(employeeId, separationDate, separationReason) {
    const result = await query(
      `SELECT e.*, ss.base_salary, ss.dearness_allowance
       FROM employees e
       LEFT JOIN salary_structures ss ON e.salary_structure_id = ss.id
       WHERE e.id = $1`,
      [employeeId]
    );
    if (result.rows.length === 0) throw new Error('Employee not found');
    const emp = result.rows[0];

    const years = yearsOfService(emp.date_of_joining, separationDate);
    const gratuity = this.calculate(emp.base_salary || 0, emp.dearness_allowance || 0, years);

    if (!gratuity.is_eligible) {
      throw new Error(`Employee has ${years} years of service. Minimum 5 years required for gratuity.`);
    }

    await query(
      `INSERT INTO gratuity_payouts 
        (employee_id, last_drawn_basic, last_drawn_da, years_of_service,
         calculated_amount, capped_amount, separation_date, separation_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        employeeId, emp.base_salary || 0, emp.dearness_allowance || 0,
        years, gratuity.calculated_amount, gratuity.capped_amount,
        separationDate, separationReason,
      ]
    );

    const payout = await query(
      `SELECT * FROM gratuity_payouts WHERE employee_id = $1 ORDER BY id DESC LIMIT 1`,
      [employeeId]
    );
    return payout.rows[0];
  }

  async approvePayout(payoutId, userId) {
    await query(
      `UPDATE gratuity_payouts SET status = 'approved', approved_by = $1,
       approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND status = 'pending'`,
      [userId, payoutId]
    );
    const result = await query(`SELECT * FROM gratuity_payouts WHERE id = $1`, [payoutId]);
    if (result.rows.length) {
      await query(
        `INSERT INTO audit_logs (table_name, record_id, action, changed_by, old_values, new_values)
         VALUES ('gratuity_payouts', $1, 'APPROVE_PAYOUT', $2, '{}', '{"status":"approved"}')`
         , [payoutId, userId]
      ).catch(() => logger.warn('Audit log insert failed for gratuity_payouts'));
    }
    return result.rows[0];
  }

  async markPayoutPaid(payoutId, paymentDetails = {}) {
    await query(
      `UPDATE gratuity_payouts SET status = 'paid', payment_date = CURRENT_DATE,
       payment_method = $1, transaction_reference = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND status = 'approved'`,
      [paymentDetails.payment_method || 'bank_transfer',
       paymentDetails.transaction_reference || null, payoutId]
    );
    const result = await query(`SELECT * FROM gratuity_payouts WHERE id = $1`, [payoutId]);
    return result.rows[0];
  }

  async getPayouts(filters = {}) {
    const { employee_id, status, page = 1, limit = 50 } = filters;
    let conditions = [];
    let params = [];
    let pc = 1;

    if (employee_id) { conditions.push(`gp.employee_id = $${pc}`); params.push(employee_id); pc++; }
    if (status) { conditions.push(`gp.status = $${pc}`); params.push(status); pc++; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT gp.*, e.full_name, e.employee_id as emp_code, e.designation
       FROM gratuity_payouts gp
       JOIN employees e ON gp.employee_id = e.id
       ${where}
       ORDER BY gp.created_at DESC
       LIMIT $${pc} OFFSET $${pc + 1}`,
      [...params, parseInt(limit), offset]
    );

    return { data: result.rows };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Liability Report
  // ═══════════════════════════════════════════════════════════════════════════

  async getLiabilityReport() {
    const result = await query(
      `SELECT e.id, e.full_name, e.designation, e.date_of_joining,
              ss.base_salary, ss.dearness_allowance,
              COALESCE(SUM(ga.monthly_provision), 0) as total_provisioned
       FROM employees e
       LEFT JOIN salary_structures ss ON e.salary_structure_id = ss.id
       LEFT JOIN gratuity_accruals ga ON e.id = ga.employee_id
       WHERE e.is_active = 1
       GROUP BY e.id
       ORDER BY e.date_of_joining ASC`
    );

    let totalLiability = 0;
    const employees = result.rows.map(emp => {
      const years = yearsOfService(emp.date_of_joining);
      const gratuity = this.calculate(emp.base_salary || 0, emp.dearness_allowance || 0, years);
      totalLiability += gratuity.capped_amount;
      return {
        ...emp,
        date_of_joining: emp.date_of_joining ? new Date(emp.date_of_joining).toLocaleDateString('en-IN') : null,
        years_of_service: years,
        is_eligible: gratuity.is_eligible,
        gratuity_liability: gratuity.capped_amount,
        provisioned: parseFloat(emp.total_provisioned),
        gap: parseFloat((gratuity.capped_amount - emp.total_provisioned).toFixed(2)),
      };
    });

    return {
      total_liability: parseFloat(totalLiability.toFixed(2)),
      total_employees: employees.length,
      eligible_employees: employees.filter(e => e.is_eligible).length,
      employees,
    };
  }

  _toFloat(decimal) {
    return parseFloat(new Decimal(decimal || 0).toDecimalPlaces(2).toString());
  }
}

module.exports = new GratuityCalculator();
