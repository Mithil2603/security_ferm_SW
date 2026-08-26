/**
 * src/routes/gst-compliance.js
 * 
 * API endpoints for GST compliance: configuration, HSN/SAC codes,
 * GSTR-1/3B generation, filing management, and GST calculation.
 * Phase 5 of ERP Implementation Plan.
 */

const logger = require('../utils/logger.js');
const express = require('express');
const { logError, ERROR_SEVERITY, ERROR_CATEGORY } = require('../utils/errorLogger');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const gstService = require('../services/gst/gstComplianceService');

router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════════════════
// GST Configuration
// ═══════════════════════════════════════════════════════════════════════════

router.get('/config', async (req, res) => {
  try {
    const config = await gstService.getConfig();
    res.json({ success: true, data: config });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'GST config error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/config', requirePermission('manage_settings'), async (req, res) => {
  try {
    const schema = Joi.object({
      gstin: Joi.string().length(15).required(),
      legal_name: Joi.string().required(),
      trade_name: Joi.string().allow('', null),
      state_code: Joi.string().length(2).required(),
      state_name: Joi.string().required(),
      registration_type: Joi.string().valid('regular', 'composition', 'unregistered').default('regular'),
      default_tax_rate: Joi.number().min(0).max(28).default(18),
      financial_year: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await gstService.saveConfig(value);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'Save GST config error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// HSN/SAC Codes
// ═══════════════════════════════════════════════════════════════════════════

router.get('/hsn-sac', requirePermission('view_gst_settings'), async (req, res) => {
  try {
    if (req.query.search && !/^[a-zA-Z0-9\s\-]*$/.test(req.query.search)) {
      return res.status(400).json({ success: false, message: 'Invalid search format' });
    }
    const codes = await gstService.getHSNSACCodes(req.query);
    res.json({ success: true, data: codes });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'HSN/SAC list error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/hsn-sac', requirePermission('manage_settings'), async (req, res) => {
  try {
    const schema = Joi.object({
      code: Joi.string().max(8).required(),
      type: Joi.string().valid('HSN', 'SAC').required(),
      description: Joi.string().required(),
      gst_rate: Joi.number().min(0).max(28).required(),
      cgst_rate: Joi.number().min(0),
      sgst_rate: Joi.number().min(0),
      igst_rate: Joi.number().min(0),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await gstService.addHSNSACCode(value);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'Add HSN/SAC error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GST Calculation (pure, no DB)
// ═══════════════════════════════════════════════════════════════════════════

router.post('/calculate', async (req, res) => {
  try {
    // Accept 'base_amount' as alias for 'taxable_value'
    const taxable_value = req.body.taxable_value ?? req.body.base_amount;
    
    // Normalize GST_18 → cgst_sgst (at 18%)
    let raw_tax_type = req.body.tax_type || 'cgst_sgst';
    let gst_rate = req.body.gst_rate;
    if (raw_tax_type === 'GST_18') {
      raw_tax_type = 'cgst_sgst';
      gst_rate = gst_rate || 18;
    }

    const schema = Joi.object({
      taxable_value: Joi.number().min(0).required(),
      gst_rate: Joi.number().min(0).default(18),
      tax_type: Joi.string().valid('cgst_sgst', 'igst').default('cgst_sgst'),
      is_rcm: Joi.boolean().optional(),  // accepted but unused
    });
    const normalizedBody = { taxable_value, gst_rate, tax_type: raw_tax_type, is_rcm: req.body.is_rcm };
    const { error, value } = schema.validate(normalizedBody);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = gstService.calculateGST(value.taxable_value, value.gst_rate, value.tax_type);
    res.json({ success: true, data: { ...result, taxable_value: value.taxable_value, gst_rate: value.gst_rate } });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'GST calc error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/classify-supply', async (req, res) => {
  try {
    const schema = Joi.object({
      buyer_gstin: Joi.string().allow('', null),
      seller_state_code: Joi.string().length(2).required(),
      buyer_state_code: Joi.string().length(2).allow('', null),
      invoice_amount: Joi.number().min(0).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const supplyType = gstService.classifySupplyType(
      value.buyer_gstin, value.seller_state_code, value.buyer_state_code, value.invoice_amount
    );
    const taxType = gstService.determineTaxType(value.seller_state_code, value.buyer_state_code || value.seller_state_code);

    res.json({ success: true, data: { supply_type: supplyType, tax_type: taxType } });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'Classify supply error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GSTR-1 Generation
// ═══════════════════════════════════════════════════════════════════════════

router.post('/gstr1/generate', requirePermission('manage_settings'), async (req, res) => {
  try {
    const schema = Joi.object({
      return_period: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const [y, m] = value.return_period.split('-');
    if (new Date(y, m - 1) > new Date()) throw new Error('Cannot generate return for future period');

    const result = await gstService.generateGSTR1(value.return_period);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.message.includes('GST configuration not found')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'GSTR-1 generation error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GSTR-3B Generation
// ═══════════════════════════════════════════════════════════════════════════

router.post('/gstr3b/generate', requirePermission('manage_settings'), async (req, res) => {
  try {
    const schema = Joi.object({
      return_period: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const [y, m] = value.return_period.split('-');
    if (new Date(y, m - 1) > new Date()) throw new Error('Cannot generate return for future period');

    const result = await gstService.generateGSTR3B(value.return_period);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'GSTR-3B generation error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Filings Management
// ═══════════════════════════════════════════════════════════════════════════

router.get('/filings', async (req, res) => {
  try {
    const filings = await gstService.getFilings(req.query);
    res.json({ success: true, data: filings });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'List filings error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/filings/:id', async (req, res) => {
  try {
    const filing = await gstService.getFiling(parseInt(req.params.id));
    if (!filing) return res.status(404).json({ success: false, message: 'Filing not found' });
    res.json({ success: true, data: filing });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'Get filing error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/filings/:id/mark-filed', requirePermission('manage_settings'), async (req, res) => {
  try {
    const schema = Joi.object({ arn_number: Joi.string().pattern(/^\d{10}$/).required() });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await gstService.markFiled(parseInt(req.params.id), value.arn_number);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'Mark filed error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Download JSON (for GST portal upload)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/filings/:id/download', async (req, res) => {
  try {
    const filing = await gstService.getFiling(parseInt(req.params.id));
    if (!filing) return res.status(404).json({ success: false, message: 'Filing not found' });

    const filename = `${filing.return_type}_${filing.return_period}_${filing.gstin}.json`;
    
    let jsonData = filing.json_data;
    if (typeof jsonData === 'string') {
      try {
        JSON.parse(jsonData);
      } catch (err) {
        return res.status(500).json({ success: false, message: 'Invalid JSON data in database' });
      }
    } else {
      jsonData = JSON.stringify(jsonData);
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(jsonData);
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'Download filing error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
