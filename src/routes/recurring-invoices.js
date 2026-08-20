/**
 * src/routes/recurring-invoices.js
 * 
 * API endpoints for recurring invoice management.
 * Phase 1 of ERP Implementation Plan.
 * 
 * Endpoints:
 *   POST   /api/recurring-invoices           — Create recurring invoice
 *   GET    /api/recurring-invoices            — List all (with filters)
 *   GET    /api/recurring-invoices/stats      — Dashboard stats
 *   GET    /api/recurring-invoices/:id        — Get single
 *   PUT    /api/recurring-invoices/:id        — Update
 *   DELETE /api/recurring-invoices/:id        — Cancel (soft delete)
 *   POST   /api/recurring-invoices/:id/pause  — Pause
 *   POST   /api/recurring-invoices/:id/resume — Resume
 *   POST   /api/recurring-invoices/:id/generate — Generate invoice now
 *   GET    /api/recurring-invoices/:id/history — Generation history
 */

const logger = require('../utils/logger.js');
const express = require('express');
const { logError, ERROR_SEVERITY, ERROR_CATEGORY } = require('../utils/errorLogger');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const recurringInvoiceService = require('../services/invoicing/recurringInvoices');
const { sendEmail } = require('../utils/email');

router.use(authMiddleware);
router.use(requirePermission('manage_invoices'));

// ─── Validation Schemas ──────────────────────────────────────────────────────

const createSchema = Joi.object({
  client_id: Joi.number().integer().positive().required(),
  monthly_rate: Joi.number().positive().precision(2).optional(),  // auto-fetched from client if not provided
  tax_type: Joi.string().valid('none', 'cgst_sgst', 'igst', 'GST_18').default('cgst_sgst'),
  discount_amount: Joi.number().min(0).precision(2).default(0),
  is_rcm_applicable: Joi.boolean().default(false),
  frequency: Joi.string().valid('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly').required(),
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().greater(Joi.ref('start_date')).allow(null).default(null),
  next_run_date: Joi.date().iso().allow(null, '').optional(),  // alias for start_date, ignored internally
  auto_generate: Joi.boolean().default(true),
  reminder_days: Joi.number().integer().min(0).max(30).default(5),
  invoice_description: Joi.string().max(500).allow(null, ''),
  invoice_notes: Joi.string().max(1000).allow(null, ''),
});

const updateSchema = Joi.object({
  monthly_rate: Joi.number().positive().precision(2),
  tax_type: Joi.string().valid('none', 'cgst_sgst', 'igst'),
  discount_amount: Joi.number().min(0).precision(2),
  is_rcm_applicable: Joi.boolean(),
  frequency: Joi.string().valid('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'),
  end_date: Joi.date().iso().allow(null),
  auto_generate: Joi.boolean(),
  reminder_days: Joi.number().integer().min(0).max(30),
  invoice_description: Joi.string().max(500).allow(null, ''),
  invoice_notes: Joi.string().max(1000).allow(null, ''),
}).min(1);

// ─── POST /api/recurring-invoices — Create ───────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const { error, value } = createSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    // Normalize GST_18 → cgst_sgst
    if (value.tax_type === 'GST_18') value.tax_type = 'cgst_sgst';

    // Auto-fetch monthly_rate from client if not provided
    if (!value.monthly_rate) {
      const { query } = require('../database/connection');
      const clientRow = await query('SELECT monthly_rate FROM clients WHERE id = $1 AND is_active = 1', [value.client_id]);
      if (clientRow.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Client not found or inactive' });
      }
      value.monthly_rate = parseFloat(clientRow.rows[0].monthly_rate);
    }

    const result = await recurringInvoiceService.create(value, req.user.id);

    logger.info(`✅ Recurring invoice created: ID ${result.id} for client ${result.client_name}`);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.INVOICING,
      feature: 'recurring-invoices',
      extra: { message: 'Failed to create recurring invoice:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/recurring-invoices — List All ──────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { client_id, status, frequency, page, limit } = req.query;
    const result = await recurringInvoiceService.findAll({ client_id, status, frequency, page, limit });
    res.json({ success: true, ...result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.INVOICING,
      feature: 'recurring-invoices',
      extra: { message: 'Failed to list recurring invoices:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/recurring-invoices/stats — Dashboard Stats ─────────────────────

router.get('/stats', async (req, res) => {
  try {
    const stats = await recurringInvoiceService.getDashboardStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.INVOICING,
      feature: 'recurring-invoices',
      extra: { message: 'Failed to get recurring invoice stats:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/recurring-invoices/:id — Get Single ────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const result = await recurringInvoiceService.findById(parseInt(req.params.id));
    if (!result) return res.status(404).json({ success: false, message: 'Recurring invoice not found' });
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.INVOICING,
      feature: 'recurring-invoices',
      extra: { message: 'Failed to get recurring invoice:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── PUT /api/recurring-invoices/:id — Update ────────────────────────────────

router.put('/:id', async (req, res) => {
  try {
    const { error, value } = updateSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await recurringInvoiceService.update(parseInt(req.params.id), value);
    logger.info(`✅ Recurring invoice updated: ID ${req.params.id}`);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.INVOICING,
      feature: 'recurring-invoices',
      extra: { message: 'Failed to update recurring invoice:' }
    });
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// ─── DELETE /api/recurring-invoices/:id — Cancel ─────────────────────────────

router.delete('/:id', async (req, res) => {
  try {
    const result = await recurringInvoiceService.delete(parseInt(req.params.id));
    logger.info(`🗑️ Recurring invoice cancelled: ID ${req.params.id}`);
    res.json({ success: true, ...result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.INVOICING,
      feature: 'recurring-invoices',
      extra: { message: 'Failed to delete recurring invoice:' }
    });
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// ─── POST /api/recurring-invoices/:id/pause — Pause ──────────────────────────

router.post('/:id/pause', async (req, res) => {
  try {
    const result = await recurringInvoiceService.pause(parseInt(req.params.id));
    logger.info(`⏸️ Recurring invoice paused: ID ${req.params.id}`);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.INVOICING,
      feature: 'recurring-invoices',
      extra: { message: 'Failed to pause recurring invoice:' }
    });
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
});

// ─── POST /api/recurring-invoices/:id/resume — Resume ────────────────────────

router.post('/:id/resume', async (req, res) => {
  try {
    const result = await recurringInvoiceService.resume(parseInt(req.params.id));
    logger.info(`▶️ Recurring invoice resumed: ID ${req.params.id}`);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.INVOICING,
      feature: 'recurring-invoices',
      extra: { message: 'Failed to resume recurring invoice:' }
    });
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
});

// ─── POST /api/recurring-invoices/:id/generate — Generate Now ────────────────

router.post('/:id/generate', async (req, res) => {
  try {
    const result = await recurringInvoiceService.generateInvoice(parseInt(req.params.id));
    logger.info(`📄 Invoice generated from recurring template: ${result.invoice_number}`);

    // Try to send email notification
    try {
      const recurring = await recurringInvoiceService.findById(parseInt(req.params.id));
      if (recurring && recurring.client_email) {
        await sendEmail({
          to: recurring.client_email,
          subject: `Invoice ${result.invoice_number} Generated`,
          text: `Dear ${recurring.client_name},\n\nA new invoice (${result.invoice_number}) has been generated for ₹${result.amount}.\nBilling period: ${result.billing_period.start} to ${result.billing_period.end}.\n\nPlease review and process the payment at your earliest convenience.\n\nRegards,\nSecurity Firm Management`,
        });
      }
    } catch (emailErr) {
      logger.warn('Email notification failed (non-blocking):', emailErr.message);
    }

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.INVOICING,
      feature: 'recurring-invoices',
      extra: { message: 'Failed to generate invoice:' }
    });
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, message: err.message });
  }
});

// ─── GET /api/recurring-invoices/:id/history — Generation History ────────────

router.get('/:id/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const history = await recurringInvoiceService.getHistory(parseInt(req.params.id), limit);
    res.json({ success: true, data: history });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.INVOICING,
      feature: 'recurring-invoices',
      extra: { message: 'Failed to get recurring invoice history:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
