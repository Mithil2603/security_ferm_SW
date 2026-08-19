/**
 * src/routes/tax.js
 * 
 * API endpoints for tax calculation, declarations, and planning.
 * Phase 3 of ERP Implementation Plan.
 * 
 * Endpoints:
 *   POST   /api/tax/compute                    — Compute annual tax
 *   POST   /api/tax/monthly-tds                — Compute monthly TDS with YTD
 *   POST   /api/tax/compare-regimes            — Compare new vs old regime
 *   GET    /api/tax/professional-tax/:state     — Get PT rate for state/salary
 *   GET    /api/tax/declaration/:empId/:fy      — Get employee declaration
 *   POST   /api/tax/declaration/:empId/:fy      — Save/update declaration
 *   POST   /api/tax/declaration/:empId/:fy/submit — Submit for verification
 *   POST   /api/tax/declaration/:empId/:fy/verify — Verify declaration
 *   GET    /api/tax/history/:empId/:fy          — Get computation history
 *   GET    /api/tax/employee-summary/:empId     — Full tax summary for employee
 */

const logger = require('../utils/logger.js');
const express = require('express');
const { logError, ERROR_SEVERITY, ERROR_CATEGORY } = require('../utils/errorLogger');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const taxCalculator = require('../services/payroll/taxCalculator');
const { query } = require('../database/connection');
const { getIndianFinancialYear } = require('../services/utils/dateCalculator');

router.use(authMiddleware);

// ─── Tax Computation (pure calculation, no DB) ──────────────────────────────

router.post('/compute', requirePermission('manage_payroll'), async (req, res) => {
  try {
    const schema = Joi.object({
      grossAnnualIncome: Joi.number().min(0).required(),
      regime: Joi.string().valid('old', 'new').default('new'),
      basicAnnual: Joi.number().min(0).default(0),
      hraAnnual: Joi.number().min(0).default(0),
      daAnnual: Joi.number().min(0).default(0),
      declarations: Joi.object().default({}),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = taxCalculator.computeAnnualTax(value);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.TAX,
      feature: 'tax',
      extra: { message: 'Tax compute error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/monthly-tds', requirePermission('manage_payroll'), async (req, res) => {
  try {
    const schema = Joi.object({
      grossAnnualIncome: Joi.number().min(0).required(),
      regime: Joi.string().valid('old', 'new').default('new'),
      basicAnnual: Joi.number().min(0).default(0),
      hraAnnual: Joi.number().min(0).default(0),
      daAnnual: Joi.number().min(0).default(0),
      declarations: Joi.object().default({}),
      currentMonth: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
      tdsAlreadyDeducted: Joi.number().min(0).default(0),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = taxCalculator.computeMonthlyTDS(value);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.TAX,
      feature: 'tax',
      extra: { message: 'Monthly TDS error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/compare-regimes', requirePermission('manage_payroll'), async (req, res) => {
  try {
    const schema = Joi.object({
      grossAnnualIncome: Joi.number().min(0).required(),
      basicAnnual: Joi.number().min(0).default(0),
      hraAnnual: Joi.number().min(0).default(0),
      daAnnual: Joi.number().min(0).default(0),
      declarations: Joi.object().default({}),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = taxCalculator.compareRegimes(value);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.TAX,
      feature: 'tax',
      extra: { message: 'Regime compare error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Professional Tax ───────────────────────────────────────────────────────

router.get('/professional-tax/:state', async (req, res) => {
  try {
    const salary = parseFloat(req.query.salary || 0);
    const pt = await taxCalculator.getProfessionalTax(req.params.state, salary);
    res.json({ success: true, data: { state: req.params.state, salary, monthly_tax: pt } });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.TAX,
      feature: 'tax',
      extra: { message: 'PT lookup error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Declarations ───────────────────────────────────────────────────────────

router.get('/declaration/:empId/:fy', async (req, res) => {
  try {
    const decl = await taxCalculator.getDeclaration(parseInt(req.params.empId), req.params.fy);
    res.json({ success: true, data: decl });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.TAX,
      feature: 'tax',
      extra: { message: 'Get declaration error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/declaration/:empId/:fy', requirePermission('manage_payroll'), async (req, res) => {
  try {
    const schema = Joi.object({
      tax_regime: Joi.string().valid('old', 'new'),
      sec_80c_ppf: Joi.number().min(0),
      sec_80c_elss: Joi.number().min(0),
      sec_80c_lic: Joi.number().min(0),
      sec_80c_nsc: Joi.number().min(0),
      sec_80c_tuition: Joi.number().min(0),
      sec_80c_home_loan_principal: Joi.number().min(0),
      sec_80c_others: Joi.number().min(0),
      sec_80d_self: Joi.number().min(0),
      sec_80d_parents: Joi.number().min(0),
      sec_80d_senior_parents: Joi.number().min(0),
      sec_80e_education_loan: Joi.number().min(0),
      sec_24b_home_loan_interest: Joi.number().min(0),
      hra_rent_paid_annual: Joi.number().min(0),
      hra_city_type: Joi.string().valid('metro', 'non_metro'),
      sec_80ccd_nps: Joi.number().min(0),
      professional_tax_annual: Joi.number().min(0),
      notes: Joi.string().allow('', null),
    }).min(1);
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await taxCalculator.saveDeclaration(parseInt(req.params.empId), req.params.fy, value);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.TAX,
      feature: 'tax',
      extra: { message: 'Save declaration error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/declaration/:empId/:fy/submit', async (req, res) => {
  try {
    const result = await taxCalculator.submitDeclaration(parseInt(req.params.empId), req.params.fy);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.TAX,
      feature: 'tax',
      extra: { message: 'Submit declaration error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/declaration/:empId/:fy/verify', requirePermission('manage_payroll'), async (req, res) => {
  try {
    const result = await taxCalculator.verifyDeclaration(parseInt(req.params.empId), req.params.fy, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.TAX,
      feature: 'tax',
      extra: { message: 'Verify declaration error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Tax History ────────────────────────────────────────────────────────────

router.get('/history/:empId/:fy', requirePermission('manage_payroll'), async (req, res) => {
  try {
    const history = await taxCalculator.getTaxHistory(parseInt(req.params.empId), req.params.fy);
    res.json({ success: true, data: history });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.TAX,
      feature: 'tax',
      extra: { message: 'Tax history error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Employee Tax Summary ───────────────────────────────────────────────────

router.get('/employee-summary/:empId', requirePermission('manage_payroll'), async (req, res) => {
  try {
    const empId = parseInt(req.params.empId);
    const now = new Date();
    const fy = getIndianFinancialYear(now);

    // Get employee
    const empResult = await query(
      `SELECT e.*, ss.base_salary, ss.dearness_allowance, ss.house_rent_allowance,
              ss.other_allowances, ss.pf_percentage
       FROM employees e
       LEFT JOIN salary_structures ss ON e.salary_structure_id = ss.id
       WHERE e.id = $1`,
      [empId]
    );
    if (empResult.rows.length === 0) return res.status(404).json({ success: false, message: 'Employee not found' });
    const emp = empResult.rows[0];

    // Get declaration
    const decl = await taxCalculator.getDeclaration(empId, fy) || {};
    const regime = decl.tax_regime || emp.tax_regime || 'new';

    // Calculate gross annual
    const gross = ((emp.base_salary || 0) + (emp.dearness_allowance || 0) +
                   (emp.house_rent_allowance || 0) + (emp.other_allowances || 0)) * 12;

    // Get YTD TDS
    const tdsResult = await query(
      `SELECT COALESCE(SUM(monthly_tds), 0) as ytd_tds FROM tax_computation_log 
       WHERE employee_id = $1 AND financial_year = $2`,
      [empId, fy]
    );

    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const taxResult = taxCalculator.computeMonthlyTDS({
      grossAnnualIncome: gross,
      regime,
      basicAnnual: (emp.base_salary || 0) * 12,
      hraAnnual: (emp.house_rent_allowance || 0) * 12,
      daAnnual: (emp.dearness_allowance || 0) * 12,
      declarations: decl,
      currentMonth,
      tdsAlreadyDeducted: parseFloat(tdsResult.rows[0].ytd_tds),
    });

    // Professional tax
    const pt = await taxCalculator.getProfessionalTax(emp.state || 'Gujarat', emp.base_salary || 0);

    // Comparison
    const comparison = taxCalculator.compareRegimes({
      grossAnnualIncome: gross,
      basicAnnual: (emp.base_salary || 0) * 12,
      hraAnnual: (emp.house_rent_allowance || 0) * 12,
      daAnnual: (emp.dearness_allowance || 0) * 12,
      declarations: decl,
    });

    res.json({
      success: true,
      data: {
        employee: { id: emp.id, name: emp.full_name, designation: emp.designation, regime },
        financial_year: fy,
        tax_computation: taxResult,
        professional_tax_monthly: pt,
        regime_comparison: comparison,
        declaration: decl,
      },
    });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.TAX,
      feature: 'tax',
      extra: { message: 'Employee tax summary error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
