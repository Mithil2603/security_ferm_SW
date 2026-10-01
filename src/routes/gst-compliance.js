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
      default_tax_rate: Joi.number().min(0).max(100).default(18),
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

router.get('/hsn-sac', async (req, res) => {
  try {
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
      gst_rate: Joi.number().min(0).max(100).required(),
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

router.put('/hsn-sac/:id', requirePermission('manage_settings'), async (req, res) => {
  try {
    const schema = Joi.object({
      code: Joi.string().max(8).required(),
      type: Joi.string().valid('HSN', 'SAC').required(),
      description: Joi.string().required(),
      gst_rate: Joi.number().min(0).max(100).required(),
      cgst_rate: Joi.number().min(0),
      sgst_rate: Joi.number().min(0),
      igst_rate: Joi.number().min(0),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await gstService.updateHSNSACCode(req.params.id, value);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.message === 'HSN/SAC code not found') {
      return res.status(404).json({ success: false, message: err.message });
    }
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'Update HSN/SAC error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/hsn-sac/:id', requirePermission('manage_settings'), async (req, res) => {
  try {
    const result = await gstService.deactivateHSNSACCode(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'Deactivate HSN/SAC error:' }
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

router.post('/gstr1/generate', requirePermission('manage_payroll'), async (req, res) => {
  try {
    const schema = Joi.object({
      return_period: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

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

router.post('/gstr3b/generate', requirePermission('manage_payroll'), async (req, res) => {
  try {
    const schema = Joi.object({
      return_period: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

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
// GSTR-1A Preview (read-only B2B/B2CS/B2CL breakdown for a date range)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/gstr1/preview', async (req, res) => {
  try {
    const schema = Joi.object({
      from_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
      to_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
    });
    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await gstService.previewGSTR1A(value.from_date, value.to_date);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.message.includes('GST configuration not found')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.MEDIUM,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'GSTR-1A preview error:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GSTR-2B Preview (purchase/ITC register for a date range)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/gstr2b', async (req, res) => {
  try {
    const schema = Joi.object({
      from_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
      to_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
    });
    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await gstService.getGSTR2B(value.from_date, value.to_date);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.MEDIUM,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'GSTR-2B preview error:' }
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
    const schema = Joi.object({ arn_number: Joi.string().required() });
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
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(filing.json_data);
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

// ═══════════════════════════════════════════════════════════════════════════
// Download Excel / PDF (human-readable exports of the same filing)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/filings/:id/download/excel', async (req, res) => {
  try {
    const filing = await gstService.getFiling(parseInt(req.params.id));
    if (!filing) return res.status(404).json({ success: false, message: 'Filing not found' });

    const ExcelJS = require('exceljs');
    const { sections } = gstService._flattenFilingForExport(filing);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Security Firm Software';
    workbook.created = new Date();

    sections.forEach(section => {
      const sheet = workbook.addWorksheet(section.name.slice(0, 31));
      sheet.columns = section.columns.map(c => ({ header: c.label, key: c.key, width: 18 }));
      section.rows.forEach(r => sheet.addRow(r));
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };
    });

    const filename = `${filing.return_type}_${filing.return_period}_${filing.gstin}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'Excel export filing error:' }
    });
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/filings/:id/download/pdf', async (req, res) => {
  try {
    const filing = await gstService.getFiling(parseInt(req.params.id));
    if (!filing) return res.status(404).json({ success: false, message: 'Filing not found' });

    const { query } = require('../database/connection');
    const { generateMultiSectionReportPDF } = require('../utils/paymentsPdfGenerator');
    const { sections } = gstService._flattenFilingForExport(filing);
    const agencySetting = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'");
    const agencySettings = agencySetting.rows.length > 0 ? JSON.parse(agencySetting.rows[0].setting_value) : null;

    const chunks = [];
    generateMultiSectionReportPDF(
      {
        title: `${filing.return_type} — ${filing.return_period}`,
        subtitleLines: [`GSTIN: ${filing.gstin} | Status: ${filing.status.toUpperCase()}`],
        sections,
        agencySettings,
      },
      (chunk) => chunks.push(chunk),
      () => {
        const pdfBuffer = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', pdfBuffer.length);
        res.setHeader('Content-Disposition', `attachment; filename="${filing.return_type}_${filing.return_period}_${filing.gstin}.pdf"`);
        res.end(pdfBuffer);
      }
    );
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.GST,
      feature: 'gst-compliance',
      extra: { message: 'PDF export filing error:' }
    });
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
