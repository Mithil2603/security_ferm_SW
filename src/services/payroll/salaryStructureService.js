/**
 * src/services/payroll/salaryStructureService.js
 * 
 * Service for managing salary structures with dynamic components.
 * Handles structure CRUD, component assignment, and predefined templates.
 */

const { query } = require('../../database/connection');
const { add, multiply, percentage, divide, toDecimal } = require('../utils/decimalMath');
const logger = require('../../utils/logger');

class SalaryStructureService {

  // ─── Structure CRUD ─────────────────────────────────────────────────────────

  /**
   * Create a new salary structure with components.
   */
  async create(data) {
    const {
      name, base_salary, dearness_allowance = 0, house_rent_allowance = 0,
      other_allowances = 0, pf_percentage = 12, esi_applicable = false,
      income_tax_applicable = false, effective_from, effective_to = null,
      description = null, template_type = 'custom', components = [],
    } = data;

    // Calculate CTC
    const ctc = this._calculateCTC(base_salary, dearness_allowance, house_rent_allowance, other_allowances, pf_percentage);

    const result = await query(
      `INSERT INTO salary_structures 
        (name, base_salary, dearness_allowance, house_rent_allowance, other_allowances,
         pf_percentage, esi_applicable, income_tax_applicable, effective_from, effective_to,
         description, template_type, ctc, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1)`,
      [name, base_salary, dearness_allowance, house_rent_allowance, other_allowances,
       pf_percentage, esi_applicable, income_tax_applicable,
       effective_from || new Date().toISOString().split('T')[0], effective_to,
       description, template_type, ctc]
    );

    const structureId = result.insertId;

    // Assign components if provided
    if (components.length > 0) {
      await this.assignComponents(structureId, components);
    }

    return this.findById(structureId);
  }

  /**
   * Find a salary structure by ID with its components.
   */
  async findById(id) {
    const result = await query(
      `SELECT * FROM salary_structures WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return null;

    const structure = result.rows[0];

    // Fetch assigned components
    const comps = await query(
      `SELECT ssc.*, sc.code, sc.name as component_name, sc.type, sc.calc_type,
              sc.is_statutory, sc.is_taxable, sc.affects_pf
       FROM salary_structure_components ssc
       JOIN salary_components sc ON ssc.salary_component_id = sc.id
       WHERE ssc.salary_structure_id = $1
       ORDER BY sc.display_order`,
      [id]
    );

    structure.components = comps.rows;
    return structure;
  }

  /**
   * List all salary structures.
   */
  async findAll(filters = {}) {
    const { is_active, template_type, page = 1, limit = 50 } = filters;

    let conditions = [];
    let params = [];
    let pc = 1;

    if (is_active !== undefined) { conditions.push(`is_active = $${pc}`); params.push(is_active ? 1 : 0); pc++; }
    if (template_type) { conditions.push(`template_type = $${pc}`); params.push(template_type); pc++; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT ss.*, 
        (SELECT COUNT(*) FROM employees e WHERE e.salary_structure_id = ss.id AND e.is_active = 1) as employee_count
       FROM salary_structures ss
       ${where}
       ORDER BY ss.is_active DESC, ss.name ASC
       LIMIT $${pc} OFFSET $${pc + 1}`,
      [...params, parseInt(limit), offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as count FROM salary_structures ${where}`,
      params
    );

    return {
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
      },
    };
  }

  /**
   * Update a salary structure.
   */
  async update(id, data) {
    const existing = await this.findById(id);
    if (!existing) throw new Error('Salary structure not found');

    const fields = [];
    const params = [];
    let pc = 1;

    const allowedFields = [
      'name', 'base_salary', 'dearness_allowance', 'house_rent_allowance',
      'other_allowances', 'pf_percentage', 'esi_applicable', 'income_tax_applicable',
      'effective_from', 'effective_to', 'description', 'template_type', 'is_active',
    ];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        fields.push(`${field} = $${pc}`);
        params.push(data[field]);
        pc++;
      }
    }

    // Recalculate CTC if salary fields changed
    const baseSal = data.base_salary ?? existing.base_salary;
    const da = data.dearness_allowance ?? existing.dearness_allowance;
    const hra = data.house_rent_allowance ?? existing.house_rent_allowance;
    const other = data.other_allowances ?? existing.other_allowances;
    const pfPct = data.pf_percentage ?? existing.pf_percentage;
    const ctc = this._calculateCTC(baseSal, da, hra, other, pfPct);
    fields.push(`ctc = $${pc}`);
    params.push(ctc);
    pc++;

    if (fields.length === 0) return existing;

    params.push(id);
    await query(
      `UPDATE salary_structures SET ${fields.join(', ')} WHERE id = $${pc}`,
      params
    );

    // Update components if provided
    if (data.components) {
      await this.assignComponents(id, data.components);
    }

    return this.findById(id);
  }

  /**
   * Delete a salary structure (soft: deactivate).
   */
  async delete(id) {
    // Check if any employees use this structure
    const empCheck = await query(
      `SELECT COUNT(*) as count FROM employees WHERE salary_structure_id = $1 AND is_active = 1`,
      [id]
    );
    if (parseInt(empCheck.rows[0].count) > 0) {
      throw new Error(`Cannot delete: ${empCheck.rows[0].count} active employee(s) use this structure`);
    }

    await query(
      `UPDATE salary_structures SET is_active = 0 WHERE id = $1`,
      [id]
    );
    return { success: true, message: 'Salary structure deactivated' };
  }

  // ─── Component Management ──────────────────────────────────────────────────

  /**
   * Get all available salary components.
   */
  async getAllComponents() {
    const result = await query(
      `SELECT * FROM salary_components WHERE is_active = 1 ORDER BY display_order`
    );
    return result.rows;
  }

  /**
   * Assign components to a salary structure.
   */
  async assignComponents(structureId, components) {
    // Clear existing
    await query(`DELETE FROM salary_structure_components WHERE salary_structure_id = $1`, [structureId]);

    // Insert new
    for (const comp of components) {
      await query(
        `INSERT INTO salary_structure_components (salary_structure_id, salary_component_id, amount, percentage)
         VALUES ($1, $2, $3, $4)`,
        [structureId, comp.component_id, comp.amount || 0, comp.percentage || null]
      );
    }
  }

  // ─── Predefined Templates ─────────────────────────────────────────────────

  /**
   * Seed predefined salary structure templates for security agencies.
   */
  async seedTemplates() {
    const templates = [
      {
        name: 'Security Guard — Grade I',
        base_salary: 20000, dearness_allowance: 1600,
        house_rent_allowance: 4000, other_allowances: 1000,
        pf_percentage: 12, esi_applicable: true,
        description: 'Entry-level security guard. Basic + HRA (20%) + DA (8%) + Special ₹1,000',
        template_type: 'guard',
      },
      {
        name: 'Security Guard — Grade II',
        base_salary: 24000, dearness_allowance: 1920,
        house_rent_allowance: 4800, other_allowances: 1500,
        pf_percentage: 12, esi_applicable: true,
        description: 'Experienced guard. Basic + HRA (20%) + DA (8%) + Special ₹1,500',
        template_type: 'guard',
      },
      {
        name: 'Supervisor',
        base_salary: 30000, dearness_allowance: 2400,
        house_rent_allowance: 6000, other_allowances: 5000,
        pf_percentage: 12, esi_applicable: true,
        description: 'Site supervisor. Basic + HRA (20%) + DA (8%) + Bonus ₹5,000',
        template_type: 'supervisor',
      },
      {
        name: 'Team Lead',
        base_salary: 38000, dearness_allowance: 3040,
        house_rent_allowance: 7600, other_allowances: 6000,
        pf_percentage: 12, esi_applicable: false,
        description: 'Team lead overseeing multiple sites. Higher base + allowances.',
        template_type: 'manager',
      },
      {
        name: 'Operations Manager',
        base_salary: 50000, dearness_allowance: 4000,
        house_rent_allowance: 10000, other_allowances: 10000,
        pf_percentage: 12, esi_applicable: false,
        income_tax_applicable: true,
        description: 'Branch/operations manager. Highest grade with TDS applicable.',
        template_type: 'manager',
      },
    ];

    let created = 0;
    for (const t of templates) {
      // Skip if already exists
      const exists = await query(
        `SELECT id FROM salary_structures WHERE name = $1`,
        [t.name]
      );
      if (exists.rows.length > 0) continue;

      await this.create({
        ...t,
        effective_from: new Date().toISOString().split('T')[0],
      });
      created++;
    }

    return { created, message: `${created} templates seeded` };
  }

  // ─── Employee Assignment ───────────────────────────────────────────────────

  /**
   * Assign a salary structure to an employee.
   */
  async assignToEmployee(employeeId, structureId) {
    const structure = await this.findById(structureId);
    if (!structure) throw new Error('Salary structure not found');

    await query(
      `UPDATE employees SET salary_structure_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [structureId, employeeId]
    );
    return { success: true, message: `Structure "${structure.name}" assigned to employee #${employeeId}` };
  }

  /**
   * Bulk assign a structure to multiple employees.
   */
  async bulkAssign(employeeIds, structureId) {
    const structure = await this.findById(structureId);
    if (!structure) throw new Error('Salary structure not found');

    let assigned = 0;
    for (const empId of employeeIds) {
      await query(
        `UPDATE employees SET salary_structure_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND is_active = 1`,
        [structureId, empId]
      );
      assigned++;
    }
    return { success: true, assigned, message: `Structure assigned to ${assigned} employees` };
  }

  /**
   * Get employees by salary structure.
   */
  async getEmployeesByStructure(structureId) {
    const result = await query(
      `SELECT id, employee_id, full_name, designation, date_of_joining
       FROM employees 
       WHERE salary_structure_id = $1 AND is_active = 1
       ORDER BY full_name`,
      [structureId]
    );
    return result.rows;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  _calculateCTC(baseSalary, da, hra, other, pfPct) {
    const gross = add(baseSalary, da, hra, other);
    const employerPF = percentage(baseSalary, pfPct);
    return add(gross, employerPF);
  }
}

module.exports = new SalaryStructureService();
