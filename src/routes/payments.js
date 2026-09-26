const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { query } = require('../database/connection');
const { authMiddleware, requirePermission, getEffectivePermissions } = require('../middleware/auth');
const { logError } = require('../utils/errorLogger');
const storageConfig = require('../utils/storageConfig');
const {
  recordClientReceipt,
  recordVendorPayment,
  recordSalaryPayment,
} = require('../services/payments/paymentTransactionService');

router.use(authMiddleware);
router.use(requirePermission('manage_invoices', 'manage_expenses', 'manage_payroll'));

// Permission required to record a payment of a given type — each tab is gated by
// the permission that already governs that domain, not a new blanket permission.
const TYPE_PERMISSION = {
  client_receipt: 'manage_invoices',
  vendor_payment: 'manage_expenses',
  salary_payment: 'manage_payroll',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, storageConfig.getUploadDir('payment_attachments')),
  filename: (req, file, cb) => cb(null, `payment_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Invalid file type. Only JPG, PNG, WEBP, and PDF attachments are allowed.'));
  },
});

// There's no global Express error handler in this app, so a rejected/oversized
// file would otherwise leak a raw HTML error page instead of clean JSON.
function uploadAttachment(req, res, next) {
  upload.single('attachment')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message || 'Failed to process attachment' });
    next();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments — register of all payment transactions, any tab
// ─────────────────────────────────────────────────────────────────────────────
const ALL_TYPES = ['client_receipt', 'vendor_payment', 'salary_payment'];

// Accepts either `types=client_receipt,vendor_payment` (any combination) or the
// legacy singular `transaction_type` — so "all", "just vendor", "2 of 3", etc.
// are all just different subsets of the same filter, in both the register and the PDF.
function resolveTypesFilter(req) {
  if (req.query.types) {
    const requested = String(req.query.types).split(',').map((t) => t.trim()).filter(Boolean);
    const valid = requested.filter((t) => ALL_TYPES.includes(t));
    return valid.length > 0 ? valid : ALL_TYPES;
  }
  if (req.query.transaction_type) return [req.query.transaction_type];
  return ALL_TYPES;
}

async function fetchPaymentRows({ types, party_id, from_date, to_date, limit, offset }) {
  let conditions = [];
  let params = [];
  let pc = 1;

  const typePlaceholders = types.map(() => `$${pc++}`);
  conditions.push(`pt.transaction_type IN (${typePlaceholders.join(',')})`);
  params.push(...types);

  if (party_id) { conditions.push(`pt.party_id = $${pc}`); params.push(party_id); pc++; }
  if (from_date) { conditions.push(`pt.payment_date >= $${pc}`); params.push(from_date); pc++; }
  if (to_date) { conditions.push(`pt.payment_date <= $${pc}`); params.push(to_date); pc++; }

  const where = `WHERE ${conditions.join(' AND ')}`;

  let limitClause = '';
  if (limit) {
    limitClause = `LIMIT $${pc} OFFSET $${pc + 1}`;
    params.push(parseInt(limit), parseInt(offset) || 0);
  }

  const result = await query(
    `SELECT pt.*,
            COALESCE(c.name, v.name, e.full_name) as party_name,
            i.invoice_number, ex.description as expense_description,
            ba.account_name as bank_account_name, ba.account_type as bank_account_type
     FROM payment_transactions pt
     LEFT JOIN clients c ON pt.party_type = 'client' AND pt.party_id = c.id
     LEFT JOIN vendors v ON pt.party_type = 'vendor' AND pt.party_id = v.id
     LEFT JOIN employees e ON pt.party_type = 'employee' AND pt.party_id = e.id
     LEFT JOIN invoices i ON pt.reference_type = 'invoice' AND pt.reference_id = i.id
     LEFT JOIN expenses ex ON pt.reference_type = 'expense' AND pt.reference_id = ex.id
     LEFT JOIN bank_accounts ba ON pt.bank_account_id = ba.id
     ${where}
     ORDER BY pt.payment_date DESC, pt.id DESC
     ${limitClause}`,
    params
  );

  const countResult = await query(`SELECT COUNT(*) as count FROM payment_transactions pt ${where}`, params.slice(0, pc - 1));
  return { rows: result.rows, total: parseInt(countResult.rows[0].count) };
}

router.get('/', async (req, res) => {
  try {
    const { party_id, from_date, to_date, page = 1, limit = 50 } = req.query;
    const types = resolveTypesFilter(req);
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { rows, total } = await fetchPaymentRows({ types, party_id, from_date, to_date, limit, offset });

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    logError(error, req, { feature: 'payments' });
    res.status(500).json({ success: false, message: 'Failed to fetch payments' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/open-bills — bills a party can close out with a payment
// ─────────────────────────────────────────────────────────────────────────────
router.get('/open-bills', async (req, res) => {
  try {
    const { party_type, party_id } = req.query;
    if (!party_type || !party_id) {
      return res.status(400).json({ success: false, message: 'party_type and party_id are required' });
    }

    if (party_type === 'client') {
      // 'draft' just means "not yet formally sent" — the money owed is still
      // real and collectible, so it must not be excluded here (an allow-list
      // of statuses previously missed this; an exclude-list is more robust).
      const result = await query(
        `SELECT id, invoice_number, invoice_date, final_amount, payment_received, payment_due, status,
                tax_type, tax_rate, cgst_amount, sgst_amount, igst_amount, is_rcm_applicable, tds_rate
         FROM invoices
         WHERE client_id = $1 AND status != 'cancelled' AND payment_due > 0
         ORDER BY invoice_date ASC`,
        [party_id]
      );
      return res.json({ success: true, data: result.rows });
    }

    if (party_type === 'vendor') {
      const result = await query(
        `SELECT id, expense_date, description, category, amount, amount_paid,
                (amount - COALESCE(amount_paid,0)) as balance_due, status,
                tax_type, tax_rate, cgst_amount, sgst_amount, igst_amount, is_rcm_applicable, tds_rate
         FROM expenses
         WHERE vendor_id = $1 AND status != 'paid' AND status != 'rejected'
         ORDER BY expense_date ASC`,
        [party_id]
      );
      return res.json({ success: true, data: result.rows });
    }

    if (party_type === 'employee') {
      const slips = await query(
        `SELECT id, 'salary_slip' as source, payroll_month as period, net_salary as amount, status
         FROM salary_slips
         WHERE employee_id = $1 AND status IN ('approved','pending')
         ORDER BY payroll_month DESC`,
        [party_id]
      );
      const legacy = await query(
        `SELECT id, 'payroll' as source, payroll_month as period, net_salary as amount, payment_status as status
         FROM payroll
         WHERE employee_id = $1 AND payment_status = 'pending'
         ORDER BY payroll_month DESC`,
        [party_id]
      );
      return res.json({ success: true, data: [...slips.rows, ...legacy.rows] });
    }

    res.status(400).json({ success: false, message: 'Invalid party_type' });
  } catch (error) {
    logError(error, req, { feature: 'payments' });
    res.status(500).json({ success: false, message: 'Failed to fetch open bills' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/register/pdf — any combination of client/vendor/employee
// (types=client_receipt,vendor_payment,salary_payment — 1, 2, or all 3), with
// a Debit/Credit column and totals, so the same filter that's on screen is
// what gets downloaded.
// ─────────────────────────────────────────────────────────────────────────────
const TYPE_LABELS = { client_receipt: 'Client Receipts', vendor_payment: 'Vendor Payments', salary_payment: 'Salary Payments' };
const DIRECTION = { client_receipt: 'credit', vendor_payment: 'debit', salary_payment: 'debit' };

router.get('/register/pdf', async (req, res) => {
  try {
    const { party_id, from_date, to_date } = req.query;
    const types = resolveTypesFilter(req);
    const { rows } = await fetchPaymentRows({ types, party_id, from_date, to_date });

    let totalDebit = 0, totalCredit = 0;
    const tableRows = rows.map((r) => {
      const amount = parseFloat(r.amount) || 0;
      const isCredit = DIRECTION[r.transaction_type] === 'credit';
      if (isCredit) totalCredit += amount; else totalDebit += amount;
      return {
        date: r.payment_date,
        type: TYPE_LABELS[r.transaction_type] || r.transaction_type,
        party: r.party_name || '',
        reference: r.invoice_number || r.expense_description || r.transaction_reference || '',
        debit: isCredit ? '' : amount.toFixed(2),
        credit: isCredit ? amount.toFixed(2) : '',
        method: (r.payment_method || '').replace('_', ' '),
        account: r.bank_account_name || '',
      };
    });

    const agencySetting = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'");
    const agencySettings = agencySetting.rows.length > 0 ? JSON.parse(agencySetting.rows[0].setting_value) : null;

    const includedLabel = types.length === 3 ? 'All Payments' : types.map((t) => TYPE_LABELS[t]).join(' + ');
    const subtitleLines = [includedLabel];
    if (from_date || to_date) subtitleLines.push(`Period: ${from_date || 'Start'} to ${to_date || 'Today'}`);

    const { generateTabularReportPDF } = require('../utils/paymentsPdfGenerator');
    const chunks = [];
    generateTabularReportPDF(
      {
        title: 'Payments Register',
        subtitleLines,
        columns: [
          { key: 'date', label: 'Date', width: 1.1 },
          { key: 'type', label: 'Type', width: 1.3 },
          { key: 'party', label: 'Party', width: 1.6 },
          { key: 'reference', label: 'Reference', width: 1.6 },
          { key: 'debit', label: 'Debit', width: 1, align: 'right' },
          { key: 'credit', label: 'Credit', width: 1, align: 'right' },
          { key: 'method', label: 'Method', width: 1.1 },
          { key: 'account', label: 'Account', width: 1.4 },
        ],
        rows: tableRows,
        totalsRow: { date: '', type: '', party: '', reference: 'TOTAL', debit: totalDebit.toFixed(2), credit: totalCredit.toFixed(2), method: '', account: `Net: ${(totalCredit - totalDebit).toFixed(2)}` },
        agencySettings,
      },
      (chunk) => chunks.push(chunk),
      () => {
        const pdfBuffer = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', pdfBuffer.length);
        res.setHeader('Content-Disposition', `attachment; filename="Payments-Register-${includedLabel.replace(/\s+/g, '-')}.pdf"`);
        res.end(pdfBuffer);
      }
    );
  } catch (error) {
    logError(error, req, { feature: 'payments' });
    logger.error('Payments register PDF error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to generate PDF' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments — record a payment for whichever tab
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', uploadAttachment, async (req, res) => {
  try {
    const { transaction_type } = req.body;
    const requiredPermission = TYPE_PERMISSION[transaction_type];
    if (!requiredPermission) {
      return res.status(400).json({ success: false, message: 'transaction_type must be client_receipt, vendor_payment, or salary_payment' });
    }

    const effectivePerms = getEffectivePermissions(req.user.role, req.user.permissions);
    if (!effectivePerms.includes('*') && !effectivePerms.includes(requiredPermission)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to record this type of payment' });
    }

    const attachment_url = req.file ? `/uploads/payment_attachments/${req.file.filename}` : (req.body.attachment_url || null);

    // Every payment settles a specific bill/invoice/payroll run — there is no
    // "ad hoc, no bill" concept in this data model, so fail clearly up front
    // rather than surfacing a confusing "not found" from deeper in the service.
    const idField = transaction_type === 'client_receipt' ? 'invoice_id' : transaction_type === 'vendor_payment' ? 'expense_id' : 'reference_id';
    if (!req.body[idField]) {
      return res.status(400).json({ success: false, message: `Please select a ${transaction_type === 'client_receipt' ? 'invoice' : transaction_type === 'vendor_payment' ? 'bill' : 'salary run'} to record this payment against.` });
    }

    let result;
    if (transaction_type === 'client_receipt') {
      result = await recordClientReceipt(
        {
          invoice_id: req.body.invoice_id,
          amount_paid: req.body.amount_paid || req.body.amount,
          tds_deducted: req.body.tds_deducted || 0,
          payment_date: req.body.payment_date,
          payment_method: req.body.payment_method,
          bank_account_id: req.body.bank_account_id,
          transaction_reference: req.body.transaction_reference,
          attachment_url,
          notes: req.body.notes,
        },
        req.user.userId
      );
    } else if (transaction_type === 'vendor_payment') {
      result = await recordVendorPayment(
        {
          expense_id: req.body.expense_id,
          amount: req.body.amount,
          payment_date: req.body.payment_date,
          payment_method: req.body.payment_method,
          bank_account_id: req.body.bank_account_id,
          reference_number: req.body.transaction_reference || req.body.reference_number,
          attachment_url,
          notes: req.body.notes,
          tds_amount: req.body.tds_amount || 0,
          tax_type: req.body.tax_type,
          tax_rate: req.body.tax_rate,
          is_rcm_applicable: req.body.is_rcm_applicable === 'true' || req.body.is_rcm_applicable === true,
        },
        req.user.userId
      );
    } else {
      result = await recordSalaryPayment(
        {
          reference_type: req.body.reference_type || 'payroll',
          reference_id: req.body.reference_id,
          amount: req.body.amount,
          payment_date: req.body.payment_date,
          payment_method: req.body.payment_method,
          bank_account_id: req.body.bank_account_id,
          transaction_reference: req.body.transaction_reference,
          attachment_url,
          notes: req.body.notes,
        },
        req.user.userId
      );
    }

    res.status(201).json({ success: true, data: result, message: 'Payment recorded successfully' });
  } catch (error) {
    logError(error, req, { feature: 'payments' });
    logger.error('Record payment error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to record payment' });
  }
});

module.exports = router;
