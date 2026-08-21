/**
 * src/routes/pf-gratuity.js
 * 
 * API endpoints for PF accounts, contributions, loans, gratuity estimates,
 * accruals, payouts, and liability reporting.
 * Phase 4 of ERP Implementation Plan.
 */

const logger = require('../utils/logger.js');
const express = require('express');
const { logError, ERROR_SEVERITY, ERROR_CATEGORY } = require('../utils/errorLogger');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const pfCalculator = require('../services/payroll/pfCalculator');
const gratuityCalculator = require('../services/payroll/gratuityCalculator');

router.use(authMiddleware);
router.use(requirePermission('manage_payroll'));

// ═══════════════════════════════════════════════════════════════════════════
// PF: Calculate (pure, no DB)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/pf/calculate', async (req, res) => {
  try {
    const schema = Joi.object({
      basic_salary: Joi.number().min(0).required(),
      cap_at_statutory: Joi.boolean().default(false),
      employee_id: Joi.any().optional(),
      month: Joi.any().optional()
    }).unknown(true);
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = pfCalculator.calculateContribution(value.basic_salary, value.cap_at_statutory);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY?.HIGH,
      category: ERROR_CATEGORY?.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'PF calculate error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PF Accounts
// ═══════════════════════════════════════════════════════════════════════════
router.get('/pf/accounts', async (req, res) => {
  try {
    const result = await pfCalculator.listAccounts(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY?.HIGH,
      category: ERROR_CATEGORY?.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'PF accounts list error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/pf/accounts/:empId', async (req, res) => {
  try {
    const account = await pfCalculator.getAccount(parseInt(req.params.empId));
    if (!account) return res.status(404).json({ success: false, message: 'PF account not found' });
    res.json({ success: true, data: account });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'Get PF account error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/pf/accounts', async (req, res) => {
  try {
    const schema = Joi.object({
      employee_id: Joi.number().integer().positive().required(),
      uan_number: Joi.string().max(20).allow(null, ''),
      pf_number: Joi.string().max(30).allow(null, ''),
      date_of_enrollment: Joi.date().iso(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await pfCalculator.createAccount(value.employee_id, value);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'Create PF account error:' }
    });
    const status = err.message.includes('already exists') ? 409 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

router.put('/pf/accounts/:empId', async (req, res) => {
  try {
    const result = await pfCalculator.updateAccount(parseInt(req.params.empId), req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'Update PF account error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PF Contributions
// ═══════════════════════════════════════════════════════════════════════════
router.post('/pf/process', async (req, res) => {
  try {
    const schema = Joi.object({
      employee_id: Joi.number().integer().positive().required(),
      payroll_month: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
      basic_salary: Joi.number().min(0).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await pfCalculator.processMonthly(value.employee_id, value.payroll_month, value.basic_salary);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'PF process error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/pf/batch-process', async (req, res) => {
  try {
    const schema = Joi.object({
      payroll_month: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await pfCalculator.batchProcess(value.payroll_month);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'PF batch process error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/pf/transactions/:empId', async (req, res) => {
  try {
    const result = await pfCalculator.getTransactions(parseInt(req.params.empId), req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'PF transactions error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/pf/interest/:empId', async (req, res) => {
  try {
    const result = await pfCalculator.calculateInterest(parseInt(req.params.empId), req.query.fy);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'PF interest error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PF Loans
// ═══════════════════════════════════════════════════════════════════════════
router.post('/pf/loans', async (req, res) => {
  try {
    const schema = Joi.object({
      employee_id: Joi.number().integer().positive().required(),
      loan_amount: Joi.number().positive().required(),
      monthly_repayment: Joi.number().positive().required(),
      interest_rate: Joi.number().min(0).default(1),
      purpose: Joi.string().valid('medical', 'housing', 'education', 'marriage', 'other').default('other'),
      start_month: Joi.string().pattern(/^\d{4}-\d{2}$/),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await pfCalculator.createLoan(value.employee_id, value);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'PF loan create error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/pf/loans/:id/approve', async (req, res) => {
  try {
    const result = await pfCalculator.approveLoan(parseInt(req.params.id), req.user.id);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'PF loan approve error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/pf/loans/:empId', async (req, res) => {
  try {
    const result = await pfCalculator.getLoans(parseInt(req.params.empId));
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'Get PF loans error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GRATUITY
// ═══════════════════════════════════════════════════════════════════════════

router.post('/gratuity/calculate', async (req, res) => {
  try {
    const schema = Joi.object({
      basic_salary: Joi.number().min(0).required(),
      da: Joi.number().min(0).default(0),
      years_of_service: Joi.number().min(0).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = gratuityCalculator.calculate(value.basic_salary, value.da, value.years_of_service);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'Gratuity calc error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/gratuity/estimate/:empId', async (req, res) => {
  try {
    const result = await gratuityCalculator.getEmployeeEstimate(parseInt(req.params.empId));
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.message === 'Employee not found') {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'Gratuity estimate error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/gratuity/accrue', async (req, res) => {
  try {
    const schema = Joi.object({
      employee_id: Joi.number().integer().positive().required(),
      accrual_month: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await gratuityCalculator.processMonthlyAccrual(value.employee_id, value.accrual_month);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'Gratuity accrue error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/gratuity/batch-accrue', async (req, res) => {
  try {
    const schema = Joi.object({
      accrual_month: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await gratuityCalculator.batchAccrual(value.accrual_month);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'Gratuity batch accrue error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/gratuity/payout', async (req, res) => {
  try {
    const schema = Joi.object({
      employee_id: Joi.number().integer().positive().required(),
      separation_date: Joi.date().iso().required(),
      separation_reason: Joi.string().valid('resignation', 'retirement', 'termination', 'death', 'disability').required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await gratuityCalculator.createPayout(value.employee_id, value.separation_date, value.separation_reason);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'Gratuity payout error:' }
    });
    const status = err.message.includes('years') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

router.post('/gratuity/payout/:id/approve', async (req, res) => {
  try {
    const result = await gratuityCalculator.approvePayout(parseInt(req.params.id), req.user.id);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'Gratuity approve error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/gratuity/payout/:id/pay', async (req, res) => {
  try {
    const result = await gratuityCalculator.markPayoutPaid(parseInt(req.params.id), req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'Gratuity pay error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/gratuity/payouts', async (req, res) => {
  try {
    const result = await gratuityCalculator.getPayouts(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'Get payouts error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/gratuity/liability-report', async (req, res) => {
  try {
    const result = await gratuityCalculator.getLiabilityReport();
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'pf-gratuity',
      extra: { message: 'Liability report error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
