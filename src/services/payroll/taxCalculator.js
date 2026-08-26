/**
 * src/services/payroll/taxCalculator.js
 * 
 * Comprehensive Indian Income Tax Calculator.
 * Supports New Regime (FY 2025-26+) and Old Regime with:
 *  - Income tax slab computation (both regimes)
 *  - Section 80C/80D/80E/80CCD(1B)/24b deductions (old regime)
 *  - HRA exemption calculation (old regime)
 *  - Standard Deduction (both regimes)
 *  - Education Cess (4%)
 *  - Surcharge (50L+ income)
 *  - Section 87A Rebate
 *  - Professional Tax (state-wise)
 *  - Monthly TDS with YTD adjustment
 *  - Tax projection/planning
 */

const Decimal = require('decimal.js');
const { query } = require('../../database/connection');
const { getIndianFinancialYear } = require('../utils/dateCalculator');
const logger = require('../../utils/logger');

class TaxCalculator {

  // ═══════════════════════════════════════════════════════════════════════════
  // NEW REGIME SLABS (FY 2025-26 Budget)
  // ═══════════════════════════════════════════════════════════════════════════
  static NEW_REGIME_SLABS = [
    { min: 0,       max: 400000,   rate: 0    },
    { min: 400000,  max: 800000,   rate: 0.05 },
    { min: 800000,  max: 1200000,  rate: 0.10 },
    { min: 1200000, max: 1600000,  rate: 0.15 },
    { min: 1600000, max: 2000000,  rate: 0.20 },
    { min: 2000000, max: 2400000,  rate: 0.25 },
    { min: 2400000, max: 9999999999, rate: 0.30 },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // OLD REGIME SLABS (FY 2025-26)
  // ═══════════════════════════════════════════════════════════════════════════
  static OLD_REGIME_SLABS = [
    { min: 0,       max: 250000,   rate: 0    },
    { min: 250000,  max: 500000,   rate: 0.05 },
    { min: 500000,  max: 1000000,  rate: 0.20 },
    { min: 1000000, max: 9999999999, rate: 0.30 },
  ];

  static STANDARD_DEDUCTION_NEW = 75000;
  static STANDARD_DEDUCTION_OLD = 50000;
  static SEC_80C_CAP = 150000;
  static SEC_80D_SELF_CAP = 25000;
  static SEC_80D_PARENTS_CAP = 25000;
  static SEC_80D_SENIOR_PARENTS_CAP = 50000;
  static SEC_80CCD_NPS_CAP = 50000;
  static SEC_24B_HOME_LOAN_CAP = 200000;
  static REBATE_87A_NEW_LIMIT = 1200000;
  static REBATE_87A_OLD_LIMIT = 500000;
  static EDUCATION_CESS_RATE = 0.04;

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE: Compute annual tax for an employee
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Full tax computation with all deductions.
   * @param {Object} params 
   * @returns {Object} Detailed tax breakdown
   */
  computeAnnualTax(params) {
    const {
      grossAnnualIncome,
      regime = 'new',
      basicAnnual = 0,
      hraAnnual = 0,
      daAnnual = 0,
      declarations = {},
    } = params;

    const D = (v) => new Decimal(v || 0);
    const gross = D(grossAnnualIncome);

    // Step 1: Standard Deduction
    const stdDeduction = regime === 'new'
      ? D(TaxCalculator.STANDARD_DEDUCTION_NEW)
      : D(TaxCalculator.STANDARD_DEDUCTION_OLD);

    let totalExemptions = stdDeduction;

    // Step 2: HRA Exemption (Old Regime only)
    let hraExemption = D(0);
    if (regime === 'old' && hraAnnual > 0) {
      hraExemption = this._calculateHRAExemption(
        D(basicAnnual), D(daAnnual), D(hraAnnual),
        D(declarations.hra_rent_paid_annual || 0),
        declarations.hra_city_type || 'non_metro'
      );
      totalExemptions = totalExemptions.plus(hraExemption);
    }

    // Step 3: Chapter VI-A Deductions (Old Regime only)
    let sec80c = D(0), sec80d = D(0), sec80e = D(0), sec80ccd = D(0), sec24b = D(0);

    if (regime === 'old') {
      // 80C: Sum all items, capped at 1.5L
      const total80c = D(declarations.sec_80c_ppf || 0)
        .plus(declarations.sec_80c_elss || 0)
        .plus(declarations.sec_80c_lic || 0)
        .plus(declarations.sec_80c_nsc || 0)
        .plus(declarations.sec_80c_tuition || 0)
        .plus(declarations.sec_80c_home_loan_principal || 0)
        .plus(declarations.sec_80c_others || 0);
      sec80c = Decimal.min(total80c, TaxCalculator.SEC_80C_CAP);

      // 80D: Health insurance
      const selfCap = D(TaxCalculator.SEC_80D_SELF_CAP);
      const parentCap = declarations.sec_80d_senior_parents > 0
        ? D(TaxCalculator.SEC_80D_SENIOR_PARENTS_CAP)
        : D(TaxCalculator.SEC_80D_PARENTS_CAP);
      sec80d = Decimal.min(D(declarations.sec_80d_self || 0), selfCap)
        .plus(Decimal.min(D(declarations.sec_80d_parents || 0).plus(declarations.sec_80d_senior_parents || 0), parentCap));

      // 80E: Education loan interest (no cap)
      sec80e = D(declarations.sec_80e_education_loan || 0);

      // 80CCD(1B): NPS additional, capped at 50K
      sec80ccd = Decimal.min(D(declarations.sec_80ccd_nps || 0), TaxCalculator.SEC_80CCD_NPS_CAP);

      // 24b: Home loan interest, capped at 2L
      sec24b = Decimal.min(D(declarations.sec_24b_home_loan_interest || 0), TaxCalculator.SEC_24B_HOME_LOAN_CAP);

      totalExemptions = totalExemptions.plus(sec80c).plus(sec80d).plus(sec80e).plus(sec80ccd).plus(sec24b);
    }

    // Step 4: Taxable Income
    const taxableIncome = Decimal.max(gross.minus(totalExemptions), 0);

    // Step 5: Tax on Slabs
    const slabs = regime === 'new' ? TaxCalculator.NEW_REGIME_SLABS : TaxCalculator.OLD_REGIME_SLABS;
    const taxOnIncome = this._computeSlabTax(taxableIncome, slabs);

    // Step 6: Surcharge
    const surcharge = this._computeSurcharge(taxOnIncome, taxableIncome);

    // Step 7: Education Cess (4% on tax + surcharge)
    const taxPlusSurcharge = taxOnIncome.plus(surcharge);
    const educationCess = taxPlusSurcharge.times(TaxCalculator.EDUCATION_CESS_RATE).toDecimalPlaces(2);

    // Step 8: Total tax before rebate
    let totalTax = taxPlusSurcharge.plus(educationCess);

    // Step 9: Section 87A Rebate
    const rebateLimit = regime === 'new'
      ? TaxCalculator.REBATE_87A_NEW_LIMIT
      : TaxCalculator.REBATE_87A_OLD_LIMIT;
    if (taxableIncome.lessThanOrEqualTo(rebateLimit)) {
      totalTax = D(0);
    }

    return {
      regime,
      gross_annual_income: this._toFloat(gross),
      standard_deduction: this._toFloat(stdDeduction),
      hra_exemption: this._toFloat(hraExemption),
      sec_80c_total: this._toFloat(sec80c),
      sec_80d_total: this._toFloat(sec80d),
      sec_80e_total: this._toFloat(sec80e),
      sec_80ccd_nps: this._toFloat(sec80ccd),
      sec_24b_home_loan: this._toFloat(sec24b),
      total_exemptions: this._toFloat(totalExemptions),
      taxable_income: this._toFloat(taxableIncome),
      tax_on_income: this._toFloat(taxOnIncome),
      surcharge: this._toFloat(surcharge),
      education_cess: this._toFloat(educationCess),
      total_annual_tax: this._toFloat(totalTax),
      monthly_tds: this._toFloat(totalTax.dividedBy(12).toDecimalPlaces(2)),
      effective_rate: gross.greaterThan(0)
        ? this._toFloat(totalTax.dividedBy(gross).times(100).toDecimalPlaces(2))
        : 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Monthly TDS with YTD Adjustment
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Calculate monthly TDS considering already-deducted amounts.
   */
  computeMonthlyTDS(params) {
    const { grossAnnualIncome, regime, basicAnnual, hraAnnual, daAnnual,
            declarations, currentMonth, tdsAlreadyDeducted = 0 } = params;

    const tax = this.computeAnnualTax({
      grossAnnualIncome, regime, basicAnnual, hraAnnual, daAnnual, declarations,
    });

    const D = (v) => new Decimal(v || 0);

    // Calculate months remaining in FY (April = month 1)
    const [year, month] = currentMonth.split('-').map(Number);
    const fyStart = month >= 4 ? year : year - 1;
    const monthOfFY = month >= 4 ? month - 3 : month + 9; // Apr=1, Mar=12
    const monthsRemaining = Math.max(1, 13 - monthOfFY);

    const totalTax = D(tax.total_annual_tax);
    const alreadyDeducted = D(tdsAlreadyDeducted);
    const remainingTax = Decimal.max(totalTax.minus(alreadyDeducted), 0);
    const monthlyTDS = remainingTax.dividedBy(monthsRemaining).toDecimalPlaces(2);

    return {
      ...tax,
      months_remaining: monthsRemaining,
      tds_already_deducted: this._toFloat(alreadyDeducted),
      remaining_tax: this._toFloat(remainingTax),
      monthly_tds: this._toFloat(monthlyTDS),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Tax Comparison (New vs Old Regime)
  // ═══════════════════════════════════════════════════════════════════════════
  compareRegimes(params) {
    const newTax = this.computeAnnualTax({ ...params, regime: 'new' });
    const oldTax = this.computeAnnualTax({ ...params, regime: 'old' });

    const savings = Math.abs(newTax.total_annual_tax - oldTax.total_annual_tax);
    const recommended = newTax.total_annual_tax <= oldTax.total_annual_tax ? 'new' : 'old';

    return {
      new_regime: newTax,
      old_regime: oldTax,
      recommended,
      annual_savings: savings,
      monthly_savings: parseFloat((savings / 12).toFixed(2)),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Professional Tax Lookup
  // ═══════════════════════════════════════════════════════════════════════════
  async getProfessionalTax(state, monthlySalary) {
    const result = await query(
      `SELECT monthly_tax FROM professional_tax_rates 
       WHERE state = $1 AND min_salary <= $2 
         AND (max_salary IS NULL OR max_salary >= $2)
         AND is_active = 1
       ORDER BY min_salary DESC LIMIT 1`,
      [state, monthlySalary]
    );
    return result.rows.length > 0 ? parseFloat(result.rows[0].monthly_tax) : 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Tax Declaration CRUD
  // ═══════════════════════════════════════════════════════════════════════════
  async getDeclaration(employeeId, financialYear) {
    const result = await query(
      `SELECT * FROM employee_tax_declarations WHERE employee_id = $1 AND financial_year = $2`,
      [employeeId, financialYear]
    );
    return result.rows[0] || null;
  }

  async saveDeclaration(employeeId, financialYear, data) {
    const existing = await this.getDeclaration(employeeId, financialYear);

    const fields = [
      'tax_regime', 'sec_80c_ppf', 'sec_80c_elss', 'sec_80c_lic', 'sec_80c_nsc',
      'sec_80c_tuition', 'sec_80c_home_loan_principal', 'sec_80c_others',
      'sec_80d_self', 'sec_80d_parents', 'sec_80d_senior_parents',
      'sec_80e_education_loan', 'sec_24b_home_loan_interest',
      'hra_rent_paid_annual', 'hra_city_type', 'sec_80ccd_nps',
      'professional_tax_annual', 'notes',
    ];

    if (existing) {
      const setClauses = [];
      const params = [];
      let pc = 1;
      for (const f of fields) {
        if (data[f] !== undefined) {
          setClauses.push(`${f} = $${pc}`);
          params.push(data[f]);
          pc++;
        }
      }
      if (setClauses.length === 0) return existing;
      setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
      params.push(existing.id);
      await query(
        `UPDATE employee_tax_declarations SET ${setClauses.join(', ')} WHERE id = $${pc}`,
        params
      );
      return this.getDeclaration(employeeId, financialYear);
    }

    // Insert new
    const insertFields = ['employee_id', 'financial_year'];
    const values = [employeeId, financialYear];
    for (const f of fields) {
      if (data[f] !== undefined) {
        insertFields.push(f);
        values.push(data[f]);
      }
    }
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    await query(
      `INSERT INTO employee_tax_declarations (${insertFields.join(', ')}) VALUES (${placeholders})`,
      values
    );
    return this.getDeclaration(employeeId, financialYear);
  }

  async submitDeclaration(employeeId, financialYear) {
    await query(
      `UPDATE employee_tax_declarations SET status = 'submitted', updated_at = CURRENT_TIMESTAMP
       WHERE employee_id = $1 AND financial_year = $2 AND status = 'draft'`,
      [employeeId, financialYear]
    );
    return this.getDeclaration(employeeId, financialYear);
  }

  async verifyDeclaration(employeeId, financialYear, verifierId) {
    await query(
      `UPDATE employee_tax_declarations SET status = 'verified', verified_by = $1, 
       verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE employee_id = $2 AND financial_year = $3 AND status = 'submitted'`,
      [verifierId, employeeId, financialYear]
    );
    return this.getDeclaration(employeeId, financialYear);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Log Tax Computation
  // ═══════════════════════════════════════════════════════════════════════════
  async logComputation(employeeId, payrollMonth, taxResult) {
    const fy = getIndianFinancialYear(new Date(payrollMonth + '-01'));
    await query(
      `INSERT INTO tax_computation_log 
        (employee_id, payroll_month, financial_year, tax_regime,
         gross_annual_income, standard_deduction, hra_exemption,
         sec_80c_total, sec_80d_total, other_deductions, taxable_income,
         tax_on_income, education_cess, surcharge, total_annual_tax,
         months_remaining, tds_already_deducted, monthly_tds, professional_tax_monthly)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        employeeId, payrollMonth, fy, taxResult.regime,
        taxResult.gross_annual_income, taxResult.standard_deduction, taxResult.hra_exemption || 0,
        taxResult.sec_80c_total || 0, taxResult.sec_80d_total || 0,
        (taxResult.sec_80e_total || 0) + (taxResult.sec_80ccd_nps || 0) + (taxResult.sec_24b_home_loan || 0),
        taxResult.taxable_income, taxResult.tax_on_income,
        taxResult.education_cess, taxResult.surcharge, taxResult.total_annual_tax,
        taxResult.months_remaining || 12, taxResult.tds_already_deducted || 0,
        taxResult.monthly_tds, 0,
      ]
    );
  }

  async getTaxHistory(employeeId, financialYear) {
    const result = await query(
      `SELECT * FROM tax_computation_log 
       WHERE employee_id = $1 AND financial_year = $2
       ORDER BY payroll_month ASC`,
      [employeeId, financialYear]
    );
    return result.rows;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  _computeSlabTax(taxableIncome, slabs) {
    let tax = new Decimal(0);
    for (const slab of slabs) {
      const min = new Decimal(slab.min);
      const max = slab.max === Infinity || slab.max >= 9999999999 ? new Decimal('999999999999') : new Decimal(slab.max);
      if (taxableIncome.greaterThan(min)) {
        const slabAmount = Decimal.min(taxableIncome, max).minus(min);
        tax = tax.plus(slabAmount.times(slab.rate));
      }
    }
    return tax.toDecimalPlaces(2);
  }

  _computeSurcharge(taxAmount, taxableIncome) {
    const D = (v) => new Decimal(v || 0);
    // Surcharge rates for FY 2025-26
    if (taxableIncome.greaterThan(50000000)) {
      return taxAmount.times(0.37).toDecimalPlaces(2); // >5Cr: 37%
    } else if (taxableIncome.greaterThan(20000000)) {
      return taxAmount.times(0.25).toDecimalPlaces(2); // >2Cr: 25%
    } else if (taxableIncome.greaterThan(10000000)) {
      return taxAmount.times(0.15).toDecimalPlaces(2); // >1Cr: 15%
    } else if (taxableIncome.greaterThan(5000000)) {
      return taxAmount.times(0.10).toDecimalPlaces(2); // >50L: 10%
    }
    return D(0);
  }

  _calculateHRAExemption(basic, da, hra, rentPaid, cityType) {
    // HRA Exemption = minimum of:
    // 1) Actual HRA received
    // 2) 50% (metro) or 40% (non-metro) of (Basic + DA)
    // 3) Rent paid - 10% of (Basic + DA)
    const D = (v) => new Decimal(v || 0);
    const basicPlusDa = basic.plus(da);
    const cityPct = cityType === 'metro' ? 0.50 : 0.40;

    const opt1 = hra;
    const opt2 = basicPlusDa.times(cityPct).toDecimalPlaces(2);
    const opt3 = Decimal.max(rentPaid.minus(basicPlusDa.times(0.10)), 0).toDecimalPlaces(2);

    return Decimal.min(opt1, opt2, opt3).toDecimalPlaces(2);
  }

  _toFloat(decimal) {
    return parseFloat(new Decimal(decimal || 0).toDecimalPlaces(2).toString());
  }
}

module.exports = new TaxCalculator();
