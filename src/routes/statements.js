const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requireRole } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);

// GET /api/statements — List all saved statements with filters + pagination
router.get('/', async (req, res) => {
  try {
    const { domain, from_date, to_date, party_name, search, page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let conditions = ['is_archived = 0'];
    let params = [];
    let paramIdx = 1;

    if (domain) {
      conditions.push(`domain = $${paramIdx++}`);
      params.push(domain);
    }
    if (from_date) {
      conditions.push(`generated_at >= $${paramIdx++}`);
      params.push(`${from_date} 00:00:00`);
    }
    if (to_date) {
      conditions.push(`generated_at <= $${paramIdx++}`);
      params.push(`${to_date} 23:59:59`);
    }
    if (party_name) {
      conditions.push(`party_name LIKE $${paramIdx++}`);
      params.push(`%${party_name}%`);
    }
    if (search) {
      conditions.push(`(statement_number LIKE $${paramIdx} OR title LIKE $${paramIdx} OR party_name LIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countResult = await query(
      `SELECT COUNT(*) as total FROM saved_statements ${whereClause}`,
      params
    );
    const total = countResult.rows[0]?.total || 0;

    // Fetch page
    const dataResult = await query(
      `SELECT id, domain, statement_number, title, reference_id, reference_type,
              total_amount, tax_amount, period_from, period_to, 
              party_name, party_id, generated_at, pdf_path
       FROM saved_statements ${whereClause}
       ORDER BY generated_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, parseInt(limit), offset]
    );

    res.json({
      success: true,
      data: dataResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'statements' });
    logger.error('List statements error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch statements' });
  }
});

// GET /api/statements/export — Export filtered statements as CSV
router.get('/export', async (req, res) => {
  try {
    const { domain, from_date, to_date, party_name } = req.query;
    
    let conditions = ['is_archived = 0'];
    let params = [];
    let paramIdx = 1;

    if (domain) { conditions.push(`domain = $${paramIdx++}`); params.push(domain); }
    if (from_date) { conditions.push(`generated_at >= $${paramIdx++}`); params.push(`${from_date} 00:00:00`); }
    if (to_date) { conditions.push(`generated_at <= $${paramIdx++}`); params.push(`${to_date} 23:59:59`); }
    if (party_name) { conditions.push(`party_name LIKE $${paramIdx++}`); params.push(`%${party_name}%`); }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT domain, statement_number, title, party_name, total_amount, tax_amount,
              period_from, period_to, generated_at
       FROM saved_statements ${whereClause}
       ORDER BY generated_at DESC`,
      params
    );

    // Build CSV
    const escCsv = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
    let csv = 'Domain,Statement #,Title,Party,Amount,Tax,Period From,Period To,Date\n';
    result.rows.forEach(row => {
      csv += [
        escCsv(row.domain), escCsv(row.statement_number), escCsv(row.title), escCsv(row.party_name),
        row.total_amount, row.tax_amount, escCsv(row.period_from), escCsv(row.period_to),
        escCsv(row.generated_at)
      ].join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="Statement_Archive_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'statements' });
    logger.error('Export statements error:', error);
    res.status(500).json({ success: false, message: 'Failed to export statements' });
  }
});

// GET /api/statements/domain-counts — Quick counts per domain for tab badges
router.get('/domain-counts', async (req, res) => {
  try {
    const result = await query(
      `SELECT domain, COUNT(*) as count FROM saved_statements WHERE is_archived = 0 GROUP BY domain`
    );
    const counts = {};
    result.rows.forEach(r => { counts[r.domain] = r.count; });
    res.json({ success: true, data: counts });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'statements' });
    logger.error('Domain counts error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch counts' });
  }
});

// GET /api/statements/:id — Get full statement details including JSON snapshot
router.get('/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM saved_statements WHERE id = $1 AND is_archived = 0`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Statement not found' });
    }

    const stmt = result.rows[0];
    let data = {};
    try {
      data = typeof stmt.statement_data === 'string' ? JSON.parse(stmt.statement_data) : (stmt.statement_data || {});
    } catch (e) {
      data = {};
    }

    // Dynamic hydration from source records if core fields are missing
    if (stmt.domain === 'invoice') {
      const isPayment = stmt.reference_type === 'payment' || stmt.statement_number?.startsWith('PMT-');
      if (isPayment) {
        if (!data.amount_paid || !data.invoice_number) {
          try {
            const pmtRes = await query(
              `SELECT p.*, i.invoice_number, i.final_amount as invoice_total, i.payment_received as total_received,
                      i.tds_deducted as total_tds, i.payment_due as remaining_due, i.status as invoice_status,
                      c.name as client_name, c.gst_number as client_gst
               FROM payments p
               JOIN invoices i ON p.invoice_id = i.id
               JOIN clients c ON i.client_id = c.id
               WHERE p.id = $1 OR i.id = $2 LIMIT 1`,
              [stmt.reference_id, stmt.reference_id]
            );
            if (pmtRes.rows.length > 0) {
              const p = pmtRes.rows[0];
              data = {
                ...p,
                ...data,
                invoice_number: data.invoice_number || p.invoice_number,
                client_name: data.client_name || p.client_name || stmt.party_name,
                amount_paid: data.amount_paid || p.amount_paid || stmt.total_amount,
                payment_date: data.payment_date || p.payment_date,
                payment_method: data.payment_method || p.payment_method,
                transaction_reference: data.transaction_reference || p.transaction_reference,
                invoice_total: data.invoice_total || p.invoice_total,
                status: data.status || p.invoice_status
              };
            }
          } catch (_) {}
        }
      } else {
        // Standard invoice
        if (!data.final_amount || !data.invoice_number || !data.amount_subtotal) {
          try {
            const invRes = await query(
              `SELECT i.*, c.name as client_name, c.address as client_address, c.city as client_city,
                      c.state as client_state, c.gst_number as client_gst, c.phone as client_phone, c.email as client_email
               FROM invoices i
               JOIN clients c ON i.client_id = c.id
               WHERE i.id = $1 OR i.invoice_number = $2 LIMIT 1`,
              [stmt.reference_id, stmt.statement_number]
            );
            if (invRes.rows.length > 0) {
              const inv = invRes.rows[0];
              data = { ...inv, ...data };
            }
          } catch (_) {}
        }
      }
    } else if (stmt.domain === 'payroll') {
      if (!data.net_salary || !data.employee_name || data.employee_name.includes('undefined')) {
        try {
          const payRes = await query(
            `SELECT p.*, e.full_name as employee_name, e.employee_id as emp_id
             FROM payroll p
             JOIN employees e ON p.employee_id = e.id
             WHERE p.id = $1 LIMIT 1`,
            [stmt.reference_id]
          );
          if (payRes.rows.length > 0) {
            data = { ...payRes.rows[0], ...data, employee_name: payRes.rows[0].employee_name, emp_id: payRes.rows[0].emp_id };
          } else {
            const slipRes = await query(
              `SELECT s.*, e.full_name as employee_name, e.employee_id as emp_id
               FROM salary_slips s
               JOIN employees e ON s.employee_id = e.id
               WHERE s.id = $1 LIMIT 1`,
              [stmt.reference_id]
            );
            if (slipRes.rows.length > 0) {
              data = { ...slipRes.rows[0], ...data, employee_name: slipRes.rows[0].employee_name, emp_id: slipRes.rows[0].emp_id };
            }
          }
        } catch (_) {}
      }
    } else if (stmt.domain === 'vendor') {
      if (!data.amount && !data.expense_amount) {
        try {
          const expRes = await query(
            `SELECT e.*, v.name as vendor_name
             FROM expenses e
             LEFT JOIN vendors v ON e.vendor_id = v.id
             WHERE e.id = $1 LIMIT 1`,
            [stmt.reference_id]
          );
          if (expRes.rows.length > 0) {
            data = { ...expRes.rows[0], ...data };
          }
        } catch (_) {}
      }
    } else if (stmt.domain === 'gst') {
      if (!data.taxable_value || !data.invoice_number) {
        try {
          const gstInvNum = stmt.statement_number.replace(/^GST-/, '');
          const gstRes = await query(
            `SELECT i.*, c.name as client_name, c.gst_number as client_gst
             FROM invoices i
             JOIN clients c ON i.client_id = c.id
             WHERE i.id = $1 OR i.invoice_number = $2 LIMIT 1`,
            [stmt.reference_id, gstInvNum]
          );
          if (gstRes.rows.length > 0) {
            const i = gstRes.rows[0];
            data = {
              invoice_number: i.invoice_number,
              client_name: i.client_name,
              client_gst: i.client_gst,
              taxable_value: i.amount_subtotal,
              tax_type: i.tax_type,
              cgst: i.cgst_amount,
              sgst: i.sgst_amount,
              igst: i.igst_amount,
              total: i.final_amount,
              is_rcm: i.is_rcm_applicable,
              ...data
            };
          }
        } catch (_) {}
      }
    }

    // Top-level fallbacks from stmt columns
    data.statement_number = data.statement_number || stmt.statement_number;
    data.party_name = data.party_name || stmt.party_name;
    data.client_name = data.client_name || stmt.party_name;
    data.total_amount = data.total_amount !== undefined ? data.total_amount : stmt.total_amount;
    data.tax_amount = data.tax_amount !== undefined ? data.tax_amount : stmt.tax_amount;
    data.period_from = data.period_from || stmt.period_from;
    data.period_to = data.period_to || stmt.period_to;
    data.billing_period_start = data.billing_period_start || stmt.period_from;
    data.billing_period_end = data.billing_period_end || stmt.period_to;

    stmt.statement_data = data;
    res.json({ success: true, data: stmt });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'statements' });
    logger.error('Get statement error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch statement' });
  }
});

// DELETE /api/statements/:id — Soft-delete (archive) a statement
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await query(
      `UPDATE saved_statements SET is_archived = 1 WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true, message: 'Statement archived' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'statements' });
    logger.error('Archive statement error:', error);
    res.status(500).json({ success: false, message: 'Failed to archive statement' });
  }
});

module.exports = router;
