/**
 * src/services/invoicing/recurringInvoices.js
 * 
 * Core service for managing recurring invoice templates.
 * Handles CRUD, frequency scheduling, pro-rata calculations,
 * and automatic invoice generation via cron integration.
 */

const { query } = require('../../database/connection');
const { calculateNextDate, daysInMonth, today } = require('../utils/dateCalculator');
const { add, subtract, multiply, divide, percentage, isPositive, toDecimal } = require('../utils/decimalMath');
const Decimal = require('decimal.js');
const logger = require('../../utils/logger');

class RecurringInvoiceService {

  /**
   * Create a new recurring invoice template.
   */
  async create(data, userId) {
    const {
      client_id,
      monthly_rate,
      tax_type = 'cgst_sgst',
      discount_amount = 0,
      is_rcm_applicable = false,
      frequency = 'monthly',
      start_date,
      end_date = null,
      auto_generate = true,
      reminder_days = 5,
      invoice_description = null,
      invoice_notes = null,
    } = data;

    // Calculate first invoice date (same as start_date)
    const next_invoice_date = start_date;

    const result = await query(
      `INSERT INTO recurring_invoices 
        (client_id, monthly_rate, tax_type, discount_amount, is_rcm_applicable,
         frequency, start_date, end_date, next_invoice_date, auto_generate,
         reminder_days, invoice_description, invoice_notes, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'active', $14)`,
      [
        client_id, monthly_rate, tax_type, discount_amount, is_rcm_applicable,
        frequency, start_date, end_date, next_invoice_date, auto_generate,
        reminder_days, invoice_description, invoice_notes, userId,
      ]
    );

    // Log the creation
    const newId = result.insertId;
    if (newId) {
      await this._log(newId, null, 'CREATED', `Recurring invoice created with ${frequency} frequency`);
    }

    return this.findById(newId);
  }

  /**
   * Find a recurring invoice by ID.
   */
  async findById(id) {
    const result = await query(
      `SELECT ri.*, c.name as client_name, c.email as client_email, 
              c.monthly_rate as client_monthly_rate, c.city as client_city,
              u.full_name as created_by_name
       FROM recurring_invoices ri
       JOIN clients c ON ri.client_id = c.id
       LEFT JOIN users u ON ri.created_by = u.id
       WHERE ri.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * List all recurring invoices with filters.
   */
  async findAll(filters = {}) {
    const { client_id, status, frequency, page = 1, limit = 50 } = filters;

    let conditions = [];
    let params = [];
    let pc = 1;

    if (client_id) { conditions.push(`ri.client_id = $${pc}`); params.push(client_id); pc++; }
    if (status) { conditions.push(`ri.status = $${pc}`); params.push(status); pc++; }
    if (frequency) { conditions.push(`ri.frequency = $${pc}`); params.push(frequency); pc++; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT ri.*, c.name as client_name, c.email as client_email
       FROM recurring_invoices ri
       JOIN clients c ON ri.client_id = c.id
       ${where}
       ORDER BY ri.next_invoice_date ASC, ri.created_at DESC
       LIMIT $${pc} OFFSET $${pc + 1}`,
      [...params, parseInt(limit), offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as count FROM recurring_invoices ri ${where}`,
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
   * Update a recurring invoice template.
   */
  async update(id, data) {
    const existing = await this.findById(id);
    if (!existing) throw new Error('Recurring invoice not found');

    const fields = [];
    const params = [];
    let pc = 1;

    const allowedFields = [
      'monthly_rate', 'tax_type', 'discount_amount', 'is_rcm_applicable',
      'frequency', 'end_date', 'auto_generate', 'reminder_days',
      'invoice_description', 'invoice_notes',
    ];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        fields.push(`${field} = $${pc}`);
        params.push(data[field]);
        pc++;
      }
    }

    if (fields.length === 0) return existing;

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    await query(
      `UPDATE recurring_invoices SET ${fields.join(', ')} WHERE id = $${pc}`,
      params
    );

    await this._log(id, null, 'UPDATED', `Fields updated: ${Object.keys(data).join(', ')}`);

    return this.findById(id);
  }

  /**
   * Delete a recurring invoice (soft: set status to cancelled).
   */
  async delete(id) {
    const existing = await this.findById(id);
    if (!existing) throw new Error('Recurring invoice not found');

    await query(
      `UPDATE recurring_invoices SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );

    await this._log(id, null, 'CANCELLED', 'Recurring invoice cancelled');
    return { success: true, message: 'Recurring invoice cancelled' };
  }

  /**
   * Pause a recurring invoice.
   */
  async pause(id) {
    const existing = await this.findById(id);
    if (!existing) throw new Error('Recurring invoice not found');
    if (existing.status !== 'active') throw new Error('Only active recurring invoices can be paused');

    await query(
      `UPDATE recurring_invoices SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );

    await this._log(id, null, 'PAUSED', 'Recurring invoice paused');
    return this.findById(id);
  }

  /**
   * Resume a paused recurring invoice.
   */
  async resume(id) {
    const existing = await this.findById(id);
    if (!existing) throw new Error('Recurring invoice not found');
    if (existing.status !== 'paused') throw new Error('Only paused recurring invoices can be resumed');

    // Recalculate next invoice date from today
    const nextDate = calculateNextDate(today(), existing.frequency);

    await query(
      `UPDATE recurring_invoices 
       SET status = 'active', next_invoice_date = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2`,
      [nextDate, id]
    );

    await this._log(id, null, 'RESUMED', `Recurring invoice resumed, next date: ${nextDate}`);
    return this.findById(id);
  }

  /**
   * Generate an invoice NOW from a recurring template.
   * This is the core generation logic used by both manual trigger and cron job.
   */
  async generateInvoice(id) {
    const recurring = await this.findById(id);
    if (!recurring) throw new Error('Recurring invoice not found');
    if (recurring.status === 'cancelled') throw new Error('Cannot generate from cancelled recurring invoice');

    // Calculate billing period
    const billingStart = recurring.next_invoice_date;
    const billingEnd = this._calculateBillingEnd(billingStart, recurring.frequency);

    // Calculate amounts using existing invoice logic pattern
    const monthlyRate = new Decimal(recurring.monthly_rate);
    const startDate = new Date(billingStart);
    const endDate = new Date(billingEnd);
    const daysInPeriod = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    const totalDaysInMonth = daysInMonth(startDate.getMonth() + 1, startDate.getFullYear());

    const dailyRate = monthlyRate.dividedBy(totalDaysInMonth);
    const amountSubtotal = dailyRate.times(daysInPeriod).toDecimalPlaces(2);

    const discountDec = new Decimal(recurring.discount_amount || 0);
    const taxableAmount = Decimal.max(amountSubtotal.minus(discountDec), 0);

    let cgst = new Decimal(0), sgst = new Decimal(0), igst = new Decimal(0);
    if (recurring.tax_type === 'cgst_sgst') {
      cgst = taxableAmount.times(0.09).toDecimalPlaces(2);
      sgst = taxableAmount.times(0.09).toDecimalPlaces(2);
    } else if (recurring.tax_type === 'igst') {
      igst = taxableAmount.times(0.18).toDecimalPlaces(2);
    }

    let totalAmount = taxableAmount;
    if (!recurring.is_rcm_applicable) {
      totalAmount = totalAmount.plus(cgst).plus(sgst).plus(igst);
    }
    const finalAmount = totalAmount.toDecimalPlaces(2);

    // Generate invoice number
    const invoiceNumber = await this._generateInvoiceNumber(startDate);

    const todayDate = today();
    const dueDate = calculateNextDate(todayDate, 'biweekly'); // Net 15

    // Insert invoice
    const invoiceResult = await query(
      `INSERT INTO invoices 
        (client_id, invoice_number, invoice_date, due_date, billing_period_start, billing_period_end,
         amount_subtotal, tax_rate, tax_amount, cgst_amount, sgst_amount, igst_amount,
         discount_amount, final_amount, payment_due, status, 
         recurring_invoice_id, is_recurring, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'draft', $16, 1, $17)`,
      [
        recurring.client_id,
        invoiceNumber,
        todayDate,
        dueDate,
        billingStart,
        billingEnd,
        parseFloat(amountSubtotal.toString()),
        recurring.tax_type === 'none' ? 0 : 18,
        parseFloat(cgst.plus(sgst).plus(igst).toString()),
        parseFloat(cgst.toString()),
        parseFloat(sgst.toString()),
        parseFloat(igst.toString()),
        parseFloat(discountDec.toString()),
        parseFloat(finalAmount.toString()),
        parseFloat(finalAmount.toString()),
        id,
        recurring.created_by,
      ]
    );

    const generatedInvoiceId = invoiceResult.lastInsertRowid;

    // Update recurring invoice: advance next_invoice_date
    const nextDate = calculateNextDate(billingStart, recurring.frequency);

    // Check if we've passed the end date
    let newStatus = 'active';
    if (recurring.end_date && nextDate > recurring.end_date) {
      newStatus = 'expired';
    }

    await query(
      `UPDATE recurring_invoices 
       SET next_invoice_date = $1, last_invoice_date = $2, status = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [nextDate, todayDate, newStatus, id]
    );

    await this._log(id, generatedInvoiceId, 'INVOICE_GENERATED',
      `Invoice ${invoiceNumber} generated for period ${billingStart} to ${billingEnd}, amount: ₹${finalAmount}`);

    return {
      recurring_invoice_id: id,
      generated_invoice_id: generatedInvoiceId,
      invoice_number: invoiceNumber,
      amount: parseFloat(finalAmount.toString()),
      billing_period: { start: billingStart, end: billingEnd },
      next_invoice_date: nextDate,
      status: newStatus,
    };
  }

  /**
   * Get all recurring invoices due for generation (used by cron job).
   */
  async getDueForGeneration() {
    const todayStr = today();
    const result = await query(
      `SELECT ri.*, c.name as client_name, c.email as client_email
       FROM recurring_invoices ri
       JOIN clients c ON ri.client_id = c.id
       WHERE ri.status = 'active'
         AND ri.auto_generate = 1
         AND ri.next_invoice_date <= $1
         AND (ri.end_date IS NULL OR ri.end_date >= $1)`,
      [todayStr]
    );
    return result.rows;
  }

  /**
   * Get recurring invoices due for reminder emails.
   */
  async getDueForReminder() {
    const result = await query(
      `SELECT ri.*, c.name as client_name, c.email as client_email
       FROM recurring_invoices ri
       JOIN clients c ON ri.client_id = c.id
       WHERE ri.status = 'active'
         AND ri.reminder_days > 0
         AND date(ri.next_invoice_date, '-' || ri.reminder_days || ' days') <= date('now')
         AND ri.next_invoice_date > date('now')`,
      []
    );
    return result.rows;
  }

  /**
   * Get generation history for a recurring invoice.
   */
  async getHistory(id, limit = 20) {
    const result = await query(
      `SELECT ril.*, i.invoice_number, i.final_amount, i.status as invoice_status
       FROM recurring_invoice_log ril
       LEFT JOIN invoices i ON ril.generated_invoice_id = i.id
       WHERE ril.recurring_invoice_id = $1
       ORDER BY ril.created_at DESC
       LIMIT $2`,
      [id, limit]
    );
    return result.rows;
  }

  /**
   * Get dashboard stats for recurring invoices.
   */
  async getDashboardStats() {
    const stats = await query(
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
         SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused,
         SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired,
         SUM(CASE WHEN status = 'active' THEN monthly_rate ELSE 0 END) as monthly_recurring_revenue
       FROM recurring_invoices
       WHERE status != 'cancelled'`
    );

    const upcoming = await query(
      `SELECT ri.id, ri.next_invoice_date, ri.monthly_rate, ri.frequency,
              c.name as client_name
       FROM recurring_invoices ri
       JOIN clients c ON ri.client_id = c.id
       WHERE ri.status = 'active'
         AND ri.next_invoice_date <= date('now', '+7 days')
       ORDER BY ri.next_invoice_date ASC
       LIMIT 10`
    );

    return {
      ...stats.rows[0],
      upcoming_invoices: upcoming.rows,
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Calculate billing period end date based on frequency.
   */
  _calculateBillingEnd(startDate, frequency) {
    const start = new Date(startDate);
    let end;
    switch (frequency) {
      case 'weekly':
        end = new Date(start);
        end.setDate(end.getDate() + 6);
        break;
      case 'biweekly':
        end = new Date(start);
        end.setDate(end.getDate() + 13);
        break;
      case 'monthly':
        end = new Date(start.getFullYear(), start.getMonth() + 1, 0); // Last day of month
        break;
      case 'quarterly':
        end = new Date(start.getFullYear(), start.getMonth() + 3, 0);
        break;
      case 'yearly':
        end = new Date(start.getFullYear() + 1, start.getMonth(), 0);
        break;
      default:
        end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    }
    // Format as YYYY-MM-DD using local date parts (avoid UTC timezone shift)
    const y = end.getFullYear();
    const m = String(end.getMonth() + 1).padStart(2, '0');
    const d = String(end.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Generate a unique invoice number (matches existing pattern from invoices.js).
   */
  async _generateInvoiceNumber(date) {
    const targetDate = date instanceof Date ? date : new Date(date);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth() + 1;
    const shortYear = year.toString().slice(-2);
    const padMonth = String(month).padStart(2, '0');
    const prefix = `INV-${shortYear}${padMonth}-`;

    const fyStartYear = month < 4 ? year - 1 : year;
    const fyStartDate = `${fyStartYear}-04-01`;
    const fyEndDate = `${fyStartYear + 1}-04-01`;

    const result = await query(
      `SELECT invoice_number FROM invoices 
       WHERE invoice_number LIKE 'INV-%' 
         AND invoice_date >= $1 
         AND invoice_date < $2
       ORDER BY id DESC LIMIT 1`,
      [fyStartDate, fyEndDate]
    );

    let sequence = 1;
    if (result.rows.length > 0) {
      const parts = result.rows[0].invoice_number.split('-');
      if (parts.length >= 3) {
        const lastSeq = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastSeq)) sequence = lastSeq + 1;
      }
    }

    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }

  /**
   * Log recurring invoice actions.
   */
  async _log(recurringInvoiceId, generatedInvoiceId, action, details) {
    try {
      await query(
        `INSERT INTO recurring_invoice_log (recurring_invoice_id, generated_invoice_id, action, details)
         VALUES ($1, $2, $3, $4)`,
        [recurringInvoiceId, generatedInvoiceId, action, details]
      );
    } catch (err) {
      logger.error('Failed to log recurring invoice action:', err);
    }
  }
}

module.exports = new RecurringInvoiceService();
