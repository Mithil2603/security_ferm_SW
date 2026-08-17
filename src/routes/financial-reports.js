/**
 * src/routes/financial-reports.js
 * 
 * API endpoints for advanced financial reporting: cash flow, variance analysis,
 * KPI dashboard, budgets, and financial snapshots.
 * Phase 6 of ERP Implementation Plan.
 */

const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const reportService = require('../services/reports/financialReportingService');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requirePermission('manage_payroll'));

// ═══════════════════════════════════════════════════════════════════════════
// Cash Flow Statement
// ═══════════════════════════════════════════════════════════════════════════

router.post('/cash-flow', async (req, res) => {
  try {
    const schema = Joi.object({
      start_date: Joi.date().iso().required(),
      end_date: Joi.date().iso().required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await reportService.generateCashFlow(
      value.start_date.toISOString().split('T')[0],
      value.end_date.toISOString().split('T')[0]
    );
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.REPORTING,
      feature: 'financial-reports',
      extra: { message: 'Cash flow error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Financial KPIs (pure calculation)
// ═══════════════════════════════════════════════════════════════════════════

router.post('/kpis/calculate', async (req, res) => {
  try {
    const schema = Joi.object({
      revenue: Joi.number().min(0).required(),
      cogs: Joi.number().min(0).default(0),
      totalExpenses: Joi.number().min(0).required(),
      receivables: Joi.number().min(0).default(0),
      payables: Joi.number().min(0).default(0),
      cashBalance: Joi.number().min(0).default(0),
      employeeCount: Joi.number().integer().min(0).default(0),
      periodDays: Joi.number().integer().min(1).default(30),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = reportService.calculateKPIs(value);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.REPORTING,
      feature: 'financial-reports',
      extra: { message: 'KPI calc error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Financial Snapshots
// ═══════════════════════════════════════════════════════════════════════════

router.post('/snapshots/generate', async (req, res) => {
  try {
    const schema = Joi.object({
      month: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await reportService.generateSnapshot(value.month);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.REPORTING,
      feature: 'financial-reports',
      extra: { message: 'Snapshot error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/snapshots', async (req, res) => {
  try {
    const fy = req.query.financial_year || '2025-26';
    const result = await reportService.getSnapshots(fy);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.REPORTING,
      feature: 'financial-reports',
      extra: { message: 'List snapshots error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Budgets
// ═══════════════════════════════════════════════════════════════════════════

router.get('/budgets', async (req, res) => {
  try {
    const result = await reportService.getBudgets(req.query.financial_year);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.REPORTING,
      feature: 'financial-reports',
      extra: { message: 'List budgets error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/budgets/:id', async (req, res) => {
  try {
    const result = await reportService.getBudget(parseInt(req.params.id));
    if (!result) return res.status(404).json({ success: false, message: 'Budget not found' });
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.REPORTING,
      feature: 'financial-reports',
      extra: { message: 'Get budget error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/budgets', async (req, res) => {
  try {
    const schema = Joi.object({
      name: Joi.string().required(),
      financial_year: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
      budget_type: Joi.string().valid('annual', 'quarterly', 'monthly').default('annual'),
      total_revenue_budget: Joi.number().min(0).default(0),
      total_expense_budget: Joi.number().min(0).default(0),
      notes: Joi.string().allow('', null),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await reportService.createBudget(value);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.REPORTING,
      feature: 'financial-reports',
      extra: { message: 'Create budget error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/budgets/:id/items', async (req, res) => {
  try {
    const schema = Joi.object({
      category: Joi.string().required(),
      sub_category: Joi.string().allow('', null),
      item_type: Joi.string().valid('revenue', 'expense').required(),
      apr: Joi.number().default(0), may: Joi.number().default(0),
      jun: Joi.number().default(0), jul: Joi.number().default(0),
      aug: Joi.number().default(0), sep: Joi.number().default(0),
      oct: Joi.number().default(0), nov: Joi.number().default(0),
      dec_val: Joi.number().default(0), jan: Joi.number().default(0),
      feb: Joi.number().default(0), mar: Joi.number().default(0),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await reportService.addBudgetItem(parseInt(req.params.id), value);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.REPORTING,
      feature: 'financial-reports',
      extra: { message: 'Add budget item error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/budgets/:id/approve', async (req, res) => {
  try {
    const result = await reportService.approveBudget(parseInt(req.params.id), req.user.id);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.REPORTING,
      feature: 'financial-reports',
      extra: { message: 'Approve budget error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Variance Analysis
// ═══════════════════════════════════════════════════════════════════════════

router.get('/variance/:budgetId', async (req, res) => {
  try {
    const result = await reportService.getVarianceAnalysis(parseInt(req.params.budgetId));
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.REPORTING,
      feature: 'financial-reports',
      extra: { message: 'Variance analysis error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
