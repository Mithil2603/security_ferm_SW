/**
 * src/routes/salary-structures.js
 * 
 * API endpoints for salary structure management.
 * Phase 2 of ERP Implementation Plan.
 * 
 * Endpoints:
 *   GET    /api/salary-structures                 — List all
 *   GET    /api/salary-structures/components       — List available components
 *   GET    /api/salary-structures/templates/seed   — Seed predefined templates
 *   GET    /api/salary-structures/:id              — Get single with components
 *   POST   /api/salary-structures                  — Create
 *   PUT    /api/salary-structures/:id              — Update
 *   DELETE /api/salary-structures/:id              — Deactivate
 *   GET    /api/salary-structures/:id/employees    — Get assigned employees
 *   POST   /api/salary-structures/:id/assign       — Assign to employee
 *   POST   /api/salary-structures/:id/bulk-assign  — Bulk assign
 */

const logger = require('../utils/logger.js');
const express = require('express');
const { logError, ERROR_SEVERITY, ERROR_CATEGORY } = require('../utils/errorLogger');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const salaryStructureService = require('../services/payroll/salaryStructureService');

router.use(authMiddleware);
router.use(requirePermission('manage_payroll'));

// ─── Validation ──────────────────────────────────────────────────────────────

const createSchema = Joi.object({
  name: Joi.string().max(100).required(),
  base_salary: Joi.number().positive().precision(2).required(),
  dearness_allowance: Joi.number().min(0).precision(2).default(0),
  house_rent_allowance: Joi.number().min(0).precision(2).default(0),
  other_allowances: Joi.number().min(0).precision(2).default(0),
  pf_percentage: Joi.number().min(0).max(100).default(12),
  esi_applicable: Joi.boolean().default(false),
  income_tax_applicable: Joi.boolean().default(false),
  effective_from: Joi.date().iso(),
  effective_to: Joi.date().iso().allow(null),
  description: Joi.string().max(500).allow(null, ''),
  template_type: Joi.string().valid('custom', 'guard', 'supervisor', 'manager').default('custom'),
  components: Joi.array().items(
    Joi.object({
      component_id: Joi.number().integer().positive().required(),
      amount: Joi.number().min(0).default(0),
      percentage: Joi.number().min(0).max(100).allow(null),
    })
  ).default([]),
});

const updateSchema = Joi.object({
  name: Joi.string().max(100),
  base_salary: Joi.number().positive().precision(2),
  dearness_allowance: Joi.number().min(0).precision(2),
  house_rent_allowance: Joi.number().min(0).precision(2),
  other_allowances: Joi.number().min(0).precision(2),
  pf_percentage: Joi.number().min(0).max(100),
  esi_applicable: Joi.boolean(),
  income_tax_applicable: Joi.boolean(),
  effective_from: Joi.date().iso(),
  effective_to: Joi.date().iso().allow(null),
  description: Joi.string().max(500).allow(null, ''),
  template_type: Joi.string().valid('custom', 'guard', 'supervisor', 'manager'),
  is_active: Joi.boolean(),
  components: Joi.array().items(
    Joi.object({
      component_id: Joi.number().integer().positive().required(),
      amount: Joi.number().min(0).default(0),
      percentage: Joi.number().min(0).max(100).allow(null),
    })
  ),
}).min(1);

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const result = await salaryStructureService.findAll(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-structures',
      extra: { message: 'Failed to list salary structures:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/components', async (req, res) => {
  try {
    const components = await salaryStructureService.getAllComponents();
    res.json({ success: true, data: components });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-structures',
      extra: { message: 'Failed to get salary components:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/templates/seed', async (req, res) => {
  try {
    const result = await salaryStructureService.seedTemplates();
    res.json({ success: true, ...result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-structures',
      extra: { message: 'Failed to seed templates:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await salaryStructureService.findById(parseInt(req.params.id));
    if (!result) return res.status(404).json({ success: false, message: 'Salary structure not found' });
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-structures',
      extra: { message: 'Failed to get salary structure:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { error, value } = createSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await salaryStructureService.create(value);
    logger.info(`✅ Salary structure created: "${result.name}" (ID: ${result.id})`);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-structures',
      extra: { message: 'Failed to create salary structure:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { error, value } = updateSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await salaryStructureService.update(parseInt(req.params.id), value);
    res.json({ success: true, data: result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-structures',
      extra: { message: 'Failed to update salary structure:' }
    });
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await salaryStructureService.delete(parseInt(req.params.id));
    res.json({ success: true, ...result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-structures',
      extra: { message: 'Failed to delete salary structure:' }
    });
    const status = err.message.includes('Cannot') ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

router.get('/:id/employees', async (req, res) => {
  try {
    const employees = await salaryStructureService.getEmployeesByStructure(parseInt(req.params.id));
    res.json({ success: true, data: employees });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-structures',
      extra: { message: 'Failed to get employees by structure:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:id/assign', async (req, res) => {
  try {
    const { employee_id } = req.body;
    if (!employee_id) return res.status(400).json({ success: false, message: 'employee_id is required' });
    const result = await salaryStructureService.assignToEmployee(parseInt(employee_id), parseInt(req.params.id));
    res.json({ success: true, ...result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-structures',
      extra: { message: 'Failed to assign structure:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:id/bulk-assign', async (req, res) => {
  try {
    const { employee_ids } = req.body;
    if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'employee_ids array required' });
    }
    const result = await salaryStructureService.bulkAssign(employee_ids, parseInt(req.params.id));
    res.json({ success: true, ...result });
  } catch (err) {
    logError({
      error: err,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.PAYROLL,
      feature: 'salary-structures',
      extra: { message: 'Failed to bulk assign:' }
    });
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
