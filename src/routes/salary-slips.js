/**
 * src/routes/salary-slips.js
 * 
 * API endpoints for salary slip management.
 * Phase 2 of ERP Implementation Plan.
 * 
 * Endpoints:
 *   POST   /api/salary-slips/generate        — Generate single slip
 *   POST   /api/salary-slips/batch-generate   — Batch generate for all employees
 *   GET    /api/salary-slips                  — List with filters
 *   GET    /api/salary-slips/:id              — Get single with components
 *   POST   /api/salary-slips/:id/submit       — Submit for approval
 *   POST   /api/salary-slips/:id/approve      — Approve
 *   POST   /api/salary-slips/bulk-approve     — Bulk approve for a month
 *   POST   /api/salary-slips/:id/pay          — Mark as paid
 *   POST   /api/salary-slips/:id/cancel       — Cancel
 */

const logger = require('../utils/logger.js');
const express = require('express');
const { logError, ERROR_SEVERITY, ERROR_CATEGORY } = require('../utils/errorLogger');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const salarySlipService = require('../services/payroll/salarySlipService');

router.use(authMiddleware);
router.use(requirePermission('manage_payroll'));

// ─── Generate ────────────────────────────────────────────────────────────────

router.post('/generate', async (req, res) => {
  try {
    let rawMonth = req.body.payroll_month || req.body.month;
    if (rawMonth && rawMonth.length > 7) {
      rawMonth = rawMonth.substring(0, 7); // convert YYYY-MM-DD to YYYY-MM
    }

    const schema = Joi.object({
      employee_id: Joi.number().integer().positive().required(),
      payroll_month: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
      days_worked: Joi.number().integer().min(0).max(31),
    });
    
    const { error, value } = schema.validate({
      ...req.body,
      payroll_month: rawMonth
    });
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await salarySlipService.generate(
      value.employee_id, value.payroll_month, value.days_worked, req.user.id
    );
    logger.info(`✅ Salary slip generated: Employee #${value.employee_id}, Month ${value.payroll_month}`);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-slips',
      extra: { message: 'Failed to generate salary slip:' }
    });
    const status = err.message.includes('already exists') ? 409 : 
                   err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

router.post('/batch-generate', async (req, res) => {
  try {
    const schema = Joi.object({
      payroll_month: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await salarySlipService.batchGenerate(value.payroll_month, req.user.id);
    logger.info(`✅ Batch salary slips: ${result.generated} generated, ${result.skipped} skipped, ${result.errors} errors`);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-slips',
      extra: { message: 'Failed to batch generate:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── List & Get ──────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const result = await salarySlipService.findAll(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-slips',
      extra: { message: 'Failed to list salary slips:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await salarySlipService.findById(parseInt(req.params.id));
    if (!result) return res.status(404).json({ success: false, message: 'Salary slip not found' });
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-slips',
      extra: { message: 'Failed to get salary slip:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Approval Workflow ──────────────────────────────────────────────────────

router.post('/:id/submit', async (req, res) => {
  try {
    const result = await salarySlipService.submitForApproval(parseInt(req.params.id));
    logger.info(`📋 Salary slip #${req.params.id} submitted for approval`);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-slips',
      extra: { message: 'Failed to submit for approval:' }
    });
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/:id/approve', async (req, res) => {
  try {
    const result = await salarySlipService.approve(parseInt(req.params.id), req.user.id);
    logger.info(`✅ Salary slip #${req.params.id} approved by ${req.user.userId}`);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-slips',
      extra: { message: 'Failed to approve:' }
    });
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/bulk-approve', async (req, res) => {
  try {
    const schema = Joi.object({
      payroll_month: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await salarySlipService.bulkApprove(value.payroll_month, req.user.id);
    logger.info(`✅ Bulk approved ${result.approved} slips for ${value.payroll_month}`);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-slips',
      extra: { message: 'Failed to bulk approve:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:id/pay', async (req, res) => {
  try {
    const schema = Joi.object({
      payment_method: Joi.string().valid('bank_transfer', 'cash', 'cheque', 'upi').default('bank_transfer'),
      transaction_reference: Joi.string().max(100).allow(null, ''),
      payment_date: Joi.string().allow(null, ''),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await salarySlipService.markPaid(parseInt(req.params.id), value);
    logger.info(`💰 Salary slip #${req.params.id} marked as paid`);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-slips',
      extra: { message: 'Failed to mark as paid:' }
    });
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/:id/cancel', async (req, res) => {
  try {
    const result = await salarySlipService.cancel(parseInt(req.params.id));
    logger.info(`🗑️ Salary slip #${req.params.id} cancelled`);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-slips',
      extra: { message: 'Failed to cancel:' }
    });
    res.status(400).json({ success: false, message: err.message });
  }
});

// GET /api/salary-slips/:id/pdf - Download Salary Slip PDF
router.get('/:id/pdf', async (req, res) => {
  try {
    const { query } = require('../database/connection');
    const { generatePayslipPDF } = require('../utils/payslipGenerator');

    const slip = await salarySlipService.findById(parseInt(req.params.id));
    if (!slip) {
      return res.status(404).json({ success: false, message: 'Salary slip not found' });
    }

    const employee = {
      full_name: slip.employee_name,
      employee_id: slip.emp_code || `EMP${slip.employee_id}`,
      designation: slip.designation || 'Staff',
      aadhar_number: slip.aadhar_number || '',
      pan_number: slip.pan_number || '',
      bank_account_number: slip.bank_account_number || '',
      bank_ifsc_code: slip.bank_ifsc_code || '',
      bank_name: slip.bank_name || ''
    };

    const client = slip.client_name ? { name: slip.client_name } : null;

    const formattedPayroll = {
      ...slip,
      payroll_month: slip.payroll_month,
      days_in_month: slip.days_in_month || 30,
      days_worked: slip.days_worked || 0,
      days_absent: Math.max(0, (slip.days_in_month || 30) - (slip.days_worked || 0)),
      days_leave: 0,
      gross_salary: slip.total_earnings,
      total_earnings: slip.total_earnings,
      total_deductions: slip.total_deductions,
      net_salary: slip.net_salary,
      earnings: slip.earnings || [],
      deductions: slip.deductions || []
    };

    const agencySetting = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'");
    const agencySettings = agencySetting.rows.length > 0 ? JSON.parse(agencySetting.rows[0].setting_value) : null;

    res.setHeader('Content-Type', 'application/pdf');
    const safeEmpName = (slip.employee_name || 'Employee').replace(/\s+/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="Payslip-${safeEmpName}-${slip.payroll_month}.pdf"`);

    generatePayslipPDF(
      formattedPayroll,
      employee,
      client,
      agencySettings,
      (chunk) => res.write(chunk),
      () => res.end()
    );
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-slips',
      extra: { message: 'Failed to generate payslip PDF:' }
    });
    res.status(500).json({ success: false, message: 'Failed to generate payslip PDF' });
  }
});

module.exports = router;
