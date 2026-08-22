const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const Decimal = require('decimal.js');
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validators');
const { generatePayslipPDF } = require('../utils/payslipGenerator');
const { saveStatement } = require('../utils/statementSaver');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requirePermission('manage_payroll'));

async function calculatePayroll(employee_id, payroll_month, manual_days_worked) {
  // Get employee with salary structure
  const empResult = await query(
    `SELECT e.*, ss.base_salary, ss.dearness_allowance, ss.house_rent_allowance, 
      ss.other_allowances, ss.pf_percentage, ss.esi_applicable
     FROM employees e
     LEFT JOIN salary_structures ss ON e.salary_structure_id = ss.id
     WHERE e.id = $1 AND e.is_active = 1`,
    [employee_id]
  );

  if (empResult.rows.length === 0) throw new Error(`Employee ${employee_id} not found or inactive`);
  const emp = empResult.rows[0];
  if (!emp.base_salary) throw new Error(`No salary structure assigned to employee ${emp.full_name}`);

  // Manual payroll days entry logic
  const monthStart = payroll_month;
  const [year, month] = payroll_month.split('-');
  const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate();

  const effectiveDays = manual_days_worked;
  const absentDays = Math.max(0, daysInMonth - effectiveDays);
  const leaveDays = 0; // Not tracked automatically anymore

  // Fetch unsettled ledger entries
  const ledgerResult = await query(
    `SELECT * FROM employee_ledger WHERE employee_id = $1 AND payroll_id IS NULL`,
    [employee_id]
  );
  const adjustments = ledgerResult.rows;

  // Calculate salary using Decimal.js for precision
  const D = (v) => new Decimal(v || 0);
  const ratio = effectiveDays / daysInMonth;
  const baseSalary = D(emp.base_salary).times(ratio).toDecimalPlaces(2);
  const da = D(emp.dearness_allowance).times(ratio).toDecimalPlaces(2);
  const hra = D(emp.house_rent_allowance).times(ratio).toDecimalPlaces(2);
  // Custom adjustments
  let customAdditions = D(0);
  let customDeductions = D(0);
  for (const adj of adjustments) {
    if (adj.type === 'addition') customAdditions = customAdditions.plus(adj.amount);
    if (adj.type === 'deduction') customDeductions = customDeductions.plus(adj.amount);
  }

  const otherAllow = D(emp.other_allowances).times(ratio).plus(customAdditions).toDecimalPlaces(2);
  const grossSalary = baseSalary.plus(da).plus(hra).plus(otherAllow).toDecimalPlaces(2);
  
  // PF deduction on base salary (as per Indian standards), not gross
  const pfDeduction = baseSalary.times(D(emp.pf_percentage || 12)).dividedBy(100).toDecimalPlaces(2);
  const esiDeduction = emp.esi_applicable ? grossSalary.times(0.75).dividedBy(100).toDecimalPlaces(2) : D(0);
  
  // Basic Indian Income Tax Calculation (New Regime FY 2025-26+)
  // Apply ₹75,000 standard deduction before tax calculation
  const standardDeduction = D(75000);
  const annualizedGross = grossSalary.times(12).minus(standardDeduction);
  const taxableIncome = annualizedGross.greaterThan(0) ? annualizedGross : D(0);
  let annualTax = D(0);
  if (taxableIncome.greaterThan(2400000)) {
    annualTax = annualTax.plus(taxableIncome.minus(2400000).times(0.3)).plus(300000);
  } else if (taxableIncome.greaterThan(2000000)) {
    annualTax = annualTax.plus(taxableIncome.minus(2000000).times(0.25)).plus(200000);
  } else if (taxableIncome.greaterThan(1600000)) {
    annualTax = annualTax.plus(taxableIncome.minus(1600000).times(0.2)).plus(120000);
  } else if (taxableIncome.greaterThan(1200000)) {
    annualTax = annualTax.plus(taxableIncome.minus(1200000).times(0.15)).plus(60000);
  } else if (taxableIncome.greaterThan(800000)) {
    annualTax = annualTax.plus(taxableIncome.minus(800000).times(0.1)).plus(20000);
  } else if (taxableIncome.greaterThan(400000)) {
    annualTax = annualTax.plus(taxableIncome.minus(400000).times(0.05));
  }
  // Section 87A Rebate: if taxable income is <= 1,200,000 under new regime, tax is 0
  if (taxableIncome.lessThanOrEqualTo(1200000)) {
    annualTax = D(0);
  } else {
    // 4% Health & Education Cess
    annualTax = annualTax.times(1.04);
  }
  const taxDeduction = annualTax.dividedBy(12).toDecimalPlaces(2);

  const totalDeductions = pfDeduction.plus(esiDeduction).plus(taxDeduction).plus(customDeductions).toDecimalPlaces(2);
  const netSalary = grossSalary.minus(totalDeductions).toDecimalPlaces(2);

  if (netSalary.lessThan(0)) {
    throw new Error(`Deductions (₹${totalDeductions.toString()}) exceed Gross Salary (₹${grossSalary.toString()}). Cannot process a negative net pay.`);
  }

  return {
    employee_id,
    payroll_month: `${monthStart}`,
    days_in_month: daysInMonth,
    days_worked: effectiveDays,
    days_absent: absentDays,
    days_leave: leaveDays,
    base_salary: parseFloat(baseSalary.toString()),
    da_amount: parseFloat(da.toString()),
    hra_amount: parseFloat(hra.toString()),
    other_allowances: parseFloat(otherAllow.toString()),
    gross_salary: parseFloat(grossSalary.toString()),
    pf_deduction: parseFloat(pfDeduction.toString()),
    esi_deduction: parseFloat(esiDeduction.toString()),
    tax_deduction: parseFloat(taxDeduction.toString()),
    other_deductions: parseFloat(customDeductions.toString()),
    total_deductions: parseFloat(totalDeductions.toString()),
    net_salary: parseFloat(netSalary.toString()),
    adjustments: JSON.stringify(adjustments),
  };
}

// GET /api/payroll
router.get('/', async (req, res) => {
  try {
    const { employee_id, month, status, page = 1, limit = 50 } = req.query;
    let conditions = [];
    let params = [];
    let pc = 1;

    if (employee_id) { conditions.push(`p.employee_id = $${pc}`); params.push(employee_id); pc++; }
    if (month) { conditions.push(`strftime('%Y-%m', p.payroll_month) = $${pc}`); params.push(month); pc++; }
    if (status) { conditions.push(`p.payment_status = $${pc}`); params.push(status); pc++; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT p.*, e.full_name as employee_name, e.employee_id as emp_id, e.designation,
        e.bank_account_number, e.bank_ifsc_code, e.bank_name
       FROM payroll p
       JOIN employees e ON p.employee_id = e.id
       ${where}
       ORDER BY p.payroll_month DESC, e.full_name ASC
       LIMIT $${pc} OFFSET $${pc + 1}`,
      [...params, parseInt(limit), offset]
    );

    const countResult = await query(`SELECT COUNT(*) AS count FROM payroll p ${where}`, params);

    const canReveal = req.query.reveal === 'true' && (req.user.role === 'admin' || req.user.role === 'accountant');
    if (canReveal && result.rows.length > 0) {
      logger.warn(`AUDIT: User ${req.user.userId} (${req.user.role}) revealed Bank PII in Payroll list.`);
    }

    const maskedRows = result.rows.map(row => {
      if (!canReveal) {
        if (row.bank_account_number && row.bank_account_number.length >= 4) {
          row.bank_account_number = 'XXXXX' + row.bank_account_number.slice(-4);
        }
      }
      return row;
    });

    res.json({
      success: true,
      data: maskedRows,
      pagination: { total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(parseInt(countResult.rows[0].count) / parseInt(limit)) }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'payroll' });
    logger.error('Get payroll error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch payroll' });
  }
});

// POST /api/payroll/calculate
router.post('/calculate', validate(schemas.generatePayroll), async (req, res) => {
  try {
    const { entries, month } = req.body; // entries: [{ employee_id, days_worked }]
    if (!month) {
      return res.status(400).json({ success: false, message: 'Month is required (YYYY-MM-01 format)' });
    }

    const results = [];
    const errors = [];

    for (const entry of entries) {
      const { employee_id: empId, days_worked } = entry;
      try {
        // Check if payroll already exists
        const existing = await query(
          "SELECT id, payment_status FROM payroll WHERE employee_id = $1 AND strftime('%Y-%m', payroll_month) = $2",
          [empId, month.substring(0, 7)]
        );
        if (existing.rows.length > 0) {
          if (existing.rows[0].payment_status === 'paid') {
            errors.push({ employee_id: empId, error: 'Payroll already paid and locked for this month' });
            continue;
          } else {
            // Recalculate: delete the pending payroll
            await query("UPDATE employee_ledger SET payroll_id = NULL WHERE payroll_id = $1", [existing.rows[0].id]);
            await query("DELETE FROM payroll WHERE id = $1", [existing.rows[0].id]);
          }
        }

        const data = await calculatePayroll(empId, month, days_worked);
        const inserted = await query(
          `INSERT INTO payroll (employee_id, payroll_month, days_in_month, days_worked, days_absent, days_leave,
            base_salary, da_amount, hra_amount, other_allowances, gross_salary, pf_deduction, esi_deduction,
            tax_deduction, other_deductions, total_deductions, net_salary, created_by, adjustments)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
          [data.employee_id, data.payroll_month, data.days_in_month, data.days_worked, data.days_absent,
            data.days_leave, data.base_salary, data.da_amount, data.hra_amount, data.other_allowances,
            data.gross_salary, data.pf_deduction, data.esi_deduction, data.tax_deduction, data.other_deductions,
            data.total_deductions, data.net_salary, req.user.userId, data.adjustments]
        );
        
        // Mark ledger entries as settled
        if (data.adjustments && JSON.parse(data.adjustments).length > 0) {
          await query(
            `UPDATE employee_ledger SET payroll_id = $1 WHERE employee_id = $2 AND payroll_id IS NULL`,
            [inserted.rows[0].id, empId]
          );
        }
        
        results.push(inserted.rows[0]);
      } catch (err) {
    logError(err, typeof req !== 'undefined' ? req : {}, { feature: 'payroll' });
        errors.push({ employee_id: empId, error: err.message });
      }
    }

    // Auto-save payroll statements for each processed employee
    for (const payroll of results) {
      const empRes = await query('SELECT full_name, employee_id as emp_id FROM employees WHERE id = $1', [payroll.employee_id]);
      const empName = empRes.rows.length > 0 ? empRes.rows[0].full_name : `Employee #${payroll.employee_id}`;
      const monthStr = new Date(payroll.payroll_month).toLocaleString('default', { month: 'short', year: 'numeric' });

      saveStatement({
        domain: 'payroll',
        statement_number: `PAY-${empRes.rows[0]?.emp_id || payroll.employee_id}-${month.substring(0, 7)}`,
        title: `Payslip: ${empName} - ${monthStr}`,
        reference_id: payroll.id,
        reference_type: 'payroll',
        statement_data: { ...payroll, employee_name: empName },
        total_amount: payroll.net_salary,
        period_from: payroll.payroll_month,
        period_to: payroll.payroll_month,
        party_name: empName,
        party_id: payroll.employee_id,
        generated_by: req.user.userId
      });
    }

    res.json({
      success: true,
      message: `Payroll calculated for ${results.length} employees`,
      data: results,
      errors
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'payroll' });
    logger.error('Calculate payroll error:', error);
    res.status(500).json({ success: false, message: 'Failed to calculate payroll' });
  }
});

// PUT /api/payroll/:id/mark-paid
router.put('/:id/mark-paid', async (req, res) => {
  try {
    const { payment_date, payment_method, transaction_reference } = req.body;
    const result = await query(
      `UPDATE payroll SET payment_status='paid', payment_date=$1, payment_method=$2, 
        transaction_reference=$3, updated_at=CURRENT_TIMESTAMP
       WHERE id=$4`,
      [payment_date || new Date().toISOString().split('T')[0], payment_method, transaction_reference, req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Payroll record not found' });
    }
    const updated = await query(
      `SELECT p.*, e.full_name as employee_name, e.employee_id as emp_id
       FROM payroll p JOIN employees e ON p.employee_id = e.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    const payroll = updated.rows[0];
    const monthStr = new Date(payroll.payroll_month).toLocaleString('default', { month: 'short', year: 'numeric' });

    // Auto-save payroll payment statement
    saveStatement({
      domain: 'payroll',
      statement_number: `PAY-PAID-${payroll.emp_id}-${payroll.payroll_month.substring(0, 7)}`,
      title: `Payslip Paid: ${payroll.employee_name} - ${monthStr}`,
      reference_id: payroll.id,
      reference_type: 'payroll_paid',
      statement_data: payroll,
      total_amount: payroll.net_salary,
      period_from: payroll.payroll_month,
      period_to: payroll.payroll_month,
      party_name: payroll.employee_name,
      party_id: payroll.employee_id,
      generated_by: req.user.userId
    });

    res.json({ success: true, data: payroll, message: 'Payroll marked as paid' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'payroll' });
    res.status(500).json({ success: false, message: 'Failed to update payroll status' });
  }
});

// POST /api/payroll/preview
router.post('/preview', async (req, res) => {
  try {
    // Support both single {employee_id, month} and batch {month, entries:[{employee_id, days_worked}]}
    let { employee_id, month, entries } = req.body;

    if (entries && Array.isArray(entries)) {
      // Batch preview mode
      const previews = await Promise.all(
        entries.map(e => calculatePayroll(e.employee_id, month, e.days_worked))
      );
      return res.json({ success: true, data: previews });
    }

    // Single employee mode
    const data = await calculatePayroll(employee_id, month);
    res.json({ success: true, data });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'payroll' });
    res.status(400).json({ success: false, message: error.message });
  }
});

// GET /api/payroll/:id/pdf
router.get('/:id/pdf', async (req, res) => {
  try {
    const result = await query(
      `SELECT p.*, e.full_name, e.employee_id as emp_id, e.designation, e.aadhar_number, 
        e.pan_number, e.bank_account_number, e.bank_ifsc_code, e.bank_name,
        c.name as client_name
       FROM payroll p
       JOIN employees e ON p.employee_id = e.id
       LEFT JOIN clients c ON e.assigned_client_id = c.id
       WHERE p.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Payroll record not found' });
    }

    const payroll = result.rows[0];
    const employee = {
      full_name: payroll.full_name,
      employee_id: payroll.emp_id,
      designation: payroll.designation,
      aadhar_number: payroll.aadhar_number,
      pan_number: payroll.pan_number,
      bank_account_number: payroll.bank_account_number,
      bank_ifsc_code: payroll.bank_ifsc_code,
      bank_name: payroll.bank_name
    };
    const client = payroll.client_name ? { name: payroll.client_name } : null;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Payslip-${employee.full_name.replace(/\s+/g, '_')}-${new Date(payroll.payroll_month).toLocaleString('default', { month: 'short', year: 'numeric' })}.pdf"`);

    const agencySetting = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'");
    const agencySettings = agencySetting.rows.length > 0 ? JSON.parse(agencySetting.rows[0].setting_value) : null;

    generatePayslipPDF(payroll, employee, client, agencySettings,
      (chunk) => res.write(chunk),
      () => res.end()
    );
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'payroll' });
    logger.error('Generate payslip PDF error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to generate Payslip PDF' });
    }
  }
});

module.exports = router;
