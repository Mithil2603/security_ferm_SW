/**
 * src/routes/purchase-orders.js
 *
 * Vendor Purchase Orders — itemized "what was ordered" record (multiple line
 * items, GST) created before a bill exists. Converting a PO to a bill creates
 * a real `expenses` row so every downstream module (Bank & Payments' Vendor
 * Payments tab, Vendor Ledger, GST Bifurcation, Financial Reports, P&L) sees
 * it exactly like any other vendor bill — no parallel pipeline, no risk of
 * drift between "PO-originated" and "manually-entered" bills.
 */

const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { logError } = require('../utils/errorLogger');
const gstService = require('../services/gst/gstComplianceService');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const storageConfig = require('../utils/storageConfig');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, storageConfig.getUploadDir()),
  filename: (req, file, cb) => cb(null, `po_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.xlsx'];
    if (allowedMimes.includes((file.mimetype || '').toLowerCase()) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPG, PNG, WEBP, and XLSX attachments are allowed.'));
    }
  }
});

router.use(authMiddleware);
router.use(requirePermission('manage_expenses'));

// A rejected/oversized file would otherwise leak a raw HTML error page since
// there's no global Express error handler for multer's own errors.
function uploadAttachment(req, res, next) {
  upload.single('attachment_file')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message || 'Failed to process attachment' });
    next();
  });
}

function parseItems(body) {
  if (Array.isArray(body.items)) return body.items;
  if (typeof body.items === 'string') {
    try { return JSON.parse(body.items); } catch { return []; }
  }
  return [];
}

function getFY(dateStr) {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  return d.getMonth() >= 3 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
}

async function nextPoNumber(poDate) {
  const fy = getFY(poDate || new Date());
  // MAX of numeric sequence across both PB- and legacy PO- prefixes
  const maxRes = await query(
    `SELECT MAX(CAST(SUBSTRING_INDEX(po_number, '-', -1) AS UNSIGNED)) as max_seq
     FROM purchase_orders WHERE po_number LIKE $1 OR po_number LIKE $2`,
    [`PB-${fy}-%`, `PO-${fy}-%`]
  );
  const next = (parseInt(maxRes.rows[0].max_seq) || 0) + 1;
  return `PB-${fy}-${String(next).padStart(4, '0')}`;
}

// Self-healing migration check for Vyapar-style enhancement columns
let columnsEnsured = false;
async function ensureColumns() {
  if (columnsEnsured) return;
  columnsEnsured = true;
  try {
    const existing = await query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_name IN ('purchase_orders', 'purchase_order_items')
    `);
    const cols = new Set((existing.rows || []).map(r => `${(r.TABLE_NAME || r.table_name || '').toLowerCase()}.${(r.COLUMN_NAME || r.column_name || '').toLowerCase()}`));

    const stmts = [
      { key: 'purchase_orders.bill_number', sql: `ALTER TABLE purchase_orders ADD COLUMN bill_number VARCHAR(100)` },
      { key: 'purchase_orders.state_of_supply', sql: `ALTER TABLE purchase_orders ADD COLUMN state_of_supply VARCHAR(100)` },
      { key: 'purchase_orders.payment_type', sql: `ALTER TABLE purchase_orders ADD COLUMN payment_type VARCHAR(50) DEFAULT 'cash'` },
      { key: 'purchase_orders.payment_details', sql: `ALTER TABLE purchase_orders ADD COLUMN payment_details VARCHAR(255)` },
      { key: 'purchase_orders.terms_conditions', sql: `ALTER TABLE purchase_orders ADD COLUMN terms_conditions TEXT` },
      { key: 'purchase_orders.round_off', sql: `ALTER TABLE purchase_orders ADD COLUMN round_off DECIMAL(10,2) DEFAULT 0` },
      { key: 'purchase_orders.discount_amount', sql: `ALTER TABLE purchase_orders ADD COLUMN discount_amount DECIMAL(12,2) DEFAULT 0` },
      { key: 'purchase_order_items.unit', sql: `ALTER TABLE purchase_order_items ADD COLUMN unit VARCHAR(50) DEFAULT 'NONE'` },
      { key: 'purchase_order_items.price_type', sql: `ALTER TABLE purchase_order_items ADD COLUMN price_type VARCHAR(20) DEFAULT 'without_tax'` },
      { key: 'purchase_order_items.item_description', sql: `ALTER TABLE purchase_order_items ADD COLUMN item_description TEXT` },
      { key: 'purchase_order_items.discount_percent', sql: `ALTER TABLE purchase_order_items ADD COLUMN discount_percent DECIMAL(5,2) DEFAULT 0` },
      { key: 'purchase_order_items.discount_amount', sql: `ALTER TABLE purchase_order_items ADD COLUMN discount_amount DECIMAL(12,2) DEFAULT 0` },
      { key: 'purchase_order_items.tax_rate', sql: `ALTER TABLE purchase_order_items ADD COLUMN tax_rate DECIMAL(5,2) DEFAULT 0` },
      { key: 'purchase_order_items.tax_amount', sql: `ALTER TABLE purchase_order_items ADD COLUMN tax_amount DECIMAL(12,2) DEFAULT 0` },
    ];

    for (const item of stmts) {
      if (!cols.has(item.key.toLowerCase())) {
        try { await query(item.sql); } catch (_) {}
      }
    }

    // Auto-migrate legacy PO- identifiers to PB- (Purchase Bill) and ensure bill_number is populated
    try {
      await query(`UPDATE purchase_orders SET po_number = REPLACE(po_number, 'PO-', 'PB-') WHERE po_number LIKE 'PO-%'`);
      await query(`UPDATE purchase_orders SET bill_number = po_number WHERE bill_number IS NULL OR bill_number = ''`);
    } catch (_) {}
  } catch (_) {}
}

// Expense description for a booked purchase bill.
function describeBill(items, billRef) {
  return items.length === 1
    ? items[0].description
    : `${items[0]?.description || 'Purchase'} + ${items.length - 1} more item(s) (Bill ${billRef})`;
}

async function getLinkedExpense(po) {
  if (po.status !== 'billed' || !po.expense_id) return null;
  const res = await query('SELECT * FROM expenses WHERE id = $1', [po.expense_id]);
  return res.rows[0] || null;
}

function computeTotals(items, tax_type, tax_rate, round_off_val = 0) {
  let subtotal = 0;
  let totalDiscount = 0;
  let totalTax = 0;

  const enrichedItems = items.map(it => {
    const qty = parseFloat(it.quantity) || 0;
    const unitPrice = parseFloat(it.unit_price) || 0;
    const base = qty * unitPrice;

    // Discount
    let discAmt = 0;
    const discPct = parseFloat(it.discount_percent) || 0;
    if (discPct > 0) {
      discAmt = (base * discPct) / 100;
    } else if (parseFloat(it.discount_amount) > 0) {
      discAmt = parseFloat(it.discount_amount);
    }
    discAmt = Math.min(base, discAmt);
    totalDiscount += discAmt;

    // Price mode & Tax
    const priceType = it.price_type === 'with_tax' ? 'with_tax' : 'without_tax';
    const itemTaxRate = it.tax_rate !== undefined && it.tax_rate !== '' ? (parseFloat(it.tax_rate) || 0) : (parseFloat(tax_rate) || 0);
    let taxable = 0;
    let lineTax = 0;
    let lineTotal = 0;

    if (priceType === 'with_tax') {
      const gross = Math.max(0, base - discAmt);
      if (itemTaxRate > 0) {
        taxable = gross / (1 + itemTaxRate / 100);
        lineTax = gross - taxable;
      } else {
        taxable = gross;
        lineTax = 0;
      }
      lineTotal = gross;
    } else {
      taxable = Math.max(0, base - discAmt);
      lineTax = itemTaxRate > 0 ? (taxable * itemTaxRate) / 100 : 0;
      lineTotal = taxable + lineTax;
    }

    subtotal += taxable;
    totalTax += lineTax;

    return {
      description: it.description || '',
      hsn_code: it.hsn_code || null,
      item_description: it.item_description || it.notes || '',
      quantity: qty,
      unit: it.unit || 'NONE',
      unit_price: unitPrice,
      price_type: priceType,
      discount_percent: discPct,
      discount_amount: parseFloat(discAmt.toFixed(2)),
      tax_rate: itemTaxRate,
      tax_amount: parseFloat(lineTax.toFixed(2)),
      amount: parseFloat(lineTotal.toFixed(2)),
    };
  });

  const finalTaxType = tax_type && tax_type !== 'none' ? tax_type : 'none';
  let cgst_amount = 0, sgst_amount = 0, igst_amount = 0;

  if (finalTaxType === 'igst') {
    igst_amount = parseFloat(totalTax.toFixed(2));
  } else if (finalTaxType === 'cgst_sgst' || (finalTaxType !== 'none' && totalTax > 0)) {
    const half = parseFloat((totalTax / 2).toFixed(2));
    cgst_amount = half;
    sgst_amount = parseFloat((totalTax - half).toFixed(2));
  }

  const rawTotal = subtotal + totalTax;
  const roundOff = parseFloat(round_off_val) || 0;
  const total_amount = parseFloat((rawTotal + roundOff).toFixed(2));

  return {
    subtotal: parseFloat(subtotal.toFixed(2)),
    totalDiscount: parseFloat(totalDiscount.toFixed(2)),
    totalTax: parseFloat(totalTax.toFixed(2)),
    cgst_amount,
    sgst_amount,
    igst_amount,
    total_amount,
    round_off: roundOff,
    tax_type: finalTaxType,
    items: enrichedItems,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/purchase-orders — list with search + pagination
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    await ensureColumns();
    const { search, status, vendor_id, page = 1, limit = 20 } = req.query;
    let conditions = [];
    let params = [];
    let pc = 1;

    if (search) {
      conditions.push(`(po.po_number LIKE $${pc} OR po.bill_number LIKE $${pc} OR v.name LIKE $${pc})`);
      params.push(`%${search}%`); pc++;
    }
    if (status) { conditions.push(`po.status = $${pc}`); params.push(status); pc++; }
    if (vendor_id) { conditions.push(`po.vendor_id = $${pc}`); params.push(vendor_id); pc++; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT po.*, v.name as vendor_name, v.tax_id as vendor_gstin,
              (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) as item_count
       FROM purchase_orders po
       JOIN vendors v ON po.vendor_id = v.id
       ${where}
       ORDER BY po.po_date DESC, po.id DESC
       LIMIT $${pc} OFFSET $${pc + 1}`,
      [...params, parseInt(limit), offset]
    );
    const countResult = await query(
      `SELECT COUNT(*) as count FROM purchase_orders po JOIN vendors v ON po.vendor_id = v.id ${where}`,
      params
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: { total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (error) {
    logError(error, req, { feature: 'purchase-orders' });
    logger.error('List purchase orders error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch purchase bills' });
  }
});

// GET /api/purchase-orders/:id
router.get('/:id', async (req, res) => {
  try {
    const poRes = await query(
      `SELECT po.*, v.name as vendor_name, v.tax_id as vendor_gstin, v.contact_info as vendor_contact
       FROM purchase_orders po JOIN vendors v ON po.vendor_id = v.id WHERE po.id = $1`,
      [req.params.id]
    );
    if (poRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Purchase bill not found' });
    const items = await query(`SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY id`, [req.params.id]);
    res.json({ success: true, data: { ...poRes.rows[0], items: items.rows } });
  } catch (error) {
    logError(error, req, { feature: 'purchase-orders' });
    logger.error('Get purchase order error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch purchase bill' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/purchase-orders — create with multiple line items
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', uploadAttachment, async (req, res) => {
  try {
    await ensureColumns();
    const {
      vendor_id, po_date, bill_number, state_of_supply,
      payment_type, payment_details, terms_conditions,
      tax_type, tax_rate, is_rcm_applicable, tds_rate, notes, round_off
    } = req.body;
    const items = parseItems(req.body);

    if (!vendor_id || !po_date) {
      return res.status(400).json({ success: false, message: 'Vendor and bill date are required' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one line item is required' });
    }
    for (const it of items) {
      if (!it.description || !(parseFloat(it.quantity) > 0) || !(parseFloat(it.unit_price) >= 0)) {
        return res.status(400).json({ success: false, message: 'Each item needs a description, a positive quantity, and a unit price' });
      }
    }

    const vendorRes = await query('SELECT id FROM vendors WHERE id = $1', [vendor_id]);
    if (vendorRes.rows.length === 0) return res.status(400).json({ success: false, message: 'Vendor not found' });

    const totals = computeTotals(items, tax_type, tax_rate, round_off);
    const poNumber = await nextPoNumber(po_date);
    const assignedBillNumber = (bill_number && String(bill_number).trim()) ? String(bill_number).trim() : poNumber;
    const attachment_url = req.file ? `/uploads/${req.file.filename}` : null;

    const poResult = await query(
      `INSERT INTO purchase_orders
        (po_number, vendor_id, po_date, bill_number, state_of_supply, payment_type, payment_details, terms_conditions,
         status, subtotal, tax_type, tax_rate, cgst_amount, sgst_amount, igst_amount,
         is_rcm_applicable, round_off, discount_amount, total_amount, notes, created_by, tds_rate, attachment_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`,
      [
        poNumber, vendor_id, po_date, assignedBillNumber, state_of_supply || null,
        payment_type || 'cash', payment_details || null, terms_conditions || null,
        totals.subtotal, totals.tax_type, tax_rate || 0,
        totals.cgst_amount, totals.sgst_amount, totals.igst_amount,
        (is_rcm_applicable === true || is_rcm_applicable === 'true') ? 1 : 0,
        totals.round_off, totals.totalDiscount, totals.total_amount,
        notes || null, req.user.userId, tds_rate || 0, attachment_url
      ]
    );
    const po = poResult.rows[0];

    for (const it of totals.items) {
      await query(
        `INSERT INTO purchase_order_items
          (purchase_order_id, description, hsn_code, quantity, unit, unit_price, price_type, item_description, discount_percent, discount_amount, tax_rate, tax_amount, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          po.id, it.description, it.hsn_code || null, it.quantity, it.unit || 'NONE',
          it.unit_price, it.price_type, it.item_description || null,
          it.discount_percent, it.discount_amount, it.tax_rate, it.tax_amount, it.amount
        ]
      );
    }

    const itemsResult = await query(`SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY id`, [po.id]);
    res.status(201).json({ success: true, data: { ...po, items: itemsResult.rows }, message: 'Purchase bill created successfully' });
  } catch (error) {
    logError(error, req, { feature: 'purchase-orders' });
    logger.error('Create purchase order error:', error);
    res.status(500).json({ success: false, message: 'Failed to create purchase bill' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/purchase-orders/:id — edit (draft or billed; a billed bill's
// linked expense is kept in sync so Vendor Payments / Ledger see the change)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', uploadAttachment, async (req, res) => {
  try {
    await ensureColumns();
    const existing = await query('SELECT * FROM purchase_orders WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Purchase bill not found' });
    if (existing.rows[0].status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'A cancelled purchase bill cannot be edited' });
    }
    const linkedExpense = await getLinkedExpense(existing.rows[0]);

    const {
      vendor_id, po_date, bill_number, state_of_supply,
      payment_type, payment_details, terms_conditions,
      tax_type, tax_rate, is_rcm_applicable, tds_rate, notes, round_off, remove_attachment
    } = req.body;
    const items = parseItems(req.body);

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one line item is required' });
    }
    for (const it of items) {
      if (!it.description || !(parseFloat(it.quantity) > 0) || !(parseFloat(it.unit_price) >= 0)) {
        return res.status(400).json({ success: false, message: 'Each item needs a description, a positive quantity, and a unit price' });
      }
    }

    const totals = computeTotals(items, tax_type, tax_rate, round_off);

    // Payments already made against the booked expense put limits on the edit.
    if (linkedExpense) {
      const settled = parseFloat(linkedExpense.amount_paid) || 0;
      if (settled > 0 && totals.total_amount < settled - 0.01) {
        return res.status(400).json({
          success: false,
          message: `₹${settled.toFixed(2)} has already been paid against this bill — the total can't be reduced below that. Delete or edit the vendor payment first.`,
        });
      }
      if (settled > 0 && vendor_id && String(vendor_id) !== String(existing.rows[0].vendor_id)) {
        return res.status(400).json({ success: false, message: 'This bill already has payments recorded — the vendor cannot be changed.' });
      }
    }

    const assignedBillNumber = (bill_number !== undefined && String(bill_number).trim())
      ? String(bill_number).trim()
      : (existing.rows[0].bill_number || existing.rows[0].po_number);

    let newAttachmentUrl = existing.rows[0].attachment_url;
    if (req.file) {
      newAttachmentUrl = `/uploads/${req.file.filename}`;
    } else if (remove_attachment === 'true' || remove_attachment === true) {
      newAttachmentUrl = null;
    }

    await query(
      `UPDATE purchase_orders SET
        vendor_id=$1, po_date=$2, bill_number=$3, state_of_supply=$4,
        payment_type=$5, payment_details=$6, terms_conditions=$7,
        subtotal=$8, tax_type=$9, tax_rate=$10,
        cgst_amount=$11, sgst_amount=$12, igst_amount=$13,
        is_rcm_applicable=$14, round_off=$15, discount_amount=$16,
        total_amount=$17, notes=$18, tds_rate=$19,
        attachment_url=$20, updated_at=CURRENT_TIMESTAMP
       WHERE id=$21`,
      [
        vendor_id || existing.rows[0].vendor_id,
        po_date || existing.rows[0].po_date,
        assignedBillNumber,
        state_of_supply !== undefined ? state_of_supply : existing.rows[0].state_of_supply,
        payment_type !== undefined ? payment_type : existing.rows[0].payment_type,
        payment_details !== undefined ? payment_details : existing.rows[0].payment_details,
        terms_conditions !== undefined ? terms_conditions : existing.rows[0].terms_conditions,
        totals.subtotal, totals.tax_type, tax_rate || 0,
        totals.cgst_amount, totals.sgst_amount, totals.igst_amount,
        (is_rcm_applicable === true || is_rcm_applicable === 'true') ? 1 : 0,
        totals.round_off, totals.totalDiscount, totals.total_amount,
        notes !== undefined ? notes : existing.rows[0].notes,
        tds_rate || 0, newAttachmentUrl, req.params.id
      ]
    );

    await query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [req.params.id]);
    for (const it of totals.items) {
      await query(
        `INSERT INTO purchase_order_items
          (purchase_order_id, description, hsn_code, quantity, unit, unit_price, price_type, item_description, discount_percent, discount_amount, tax_rate, tax_amount, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          req.params.id, it.description, it.hsn_code || null, it.quantity, it.unit || 'NONE',
          it.unit_price, it.price_type, it.item_description || null,
          it.discount_percent, it.discount_amount, it.tax_rate, it.tax_amount, it.amount
        ]
      );
    }

    const updated = await query(
      `SELECT po.*, v.name as vendor_name, v.tax_id as vendor_gstin, v.contact_info as vendor_contact
       FROM purchase_orders po JOIN vendors v ON po.vendor_id = v.id WHERE po.id = $1`,
      [req.params.id]
    );

    if (linkedExpense) {
      const po = updated.rows[0];
      const settled = parseFloat(linkedExpense.amount_paid) || 0;
      let expenseStatus = linkedExpense.status;
      if (settled >= po.total_amount - 0.01 && settled > 0) expenseStatus = 'paid';
      else if (linkedExpense.status === 'paid') expenseStatus = linkedExpense.approver_id ? 'approved' : 'pending';
      await query(
        `UPDATE expenses SET description=$1, amount=$2, vendor_id=$3, tax_type=$4, tax_rate=$5,
          cgst_amount=$6, sgst_amount=$7, igst_amount=$8, is_rcm_applicable=$9, tds_rate=$10, status=$11
         WHERE id=$12`,
        [
          describeBill(totals.items, po.bill_number || po.po_number), po.total_amount, po.vendor_id,
          po.tax_type, po.tax_rate, po.cgst_amount, po.sgst_amount, po.igst_amount, po.is_rcm_applicable,
          po.tds_rate || 0, expenseStatus, linkedExpense.id,
        ]
      );
    }
    const itemsResult = await query(`SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY id`, [req.params.id]);
    res.json({ success: true, data: { ...updated.rows[0], items: itemsResult.rows }, message: 'Purchase bill updated successfully' });
  } catch (error) {
    logError(error, req, { feature: 'purchase-orders' });
    logger.error('Update purchase order error:', error);
    res.status(500).json({ success: false, message: 'Failed to update purchase bill' });
  }
});

// DELETE /api/purchase-orders/:id — cascade deletes items; a billed bill also
// removes its booked expense, as long as no vendor payment has been made on it.
router.delete('/:id', async (req, res) => {
  try {
    const existing = await query('SELECT id, status, expense_id FROM purchase_orders WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Purchase bill not found' });
    const linkedExpense = await getLinkedExpense(existing.rows[0]);
    if (linkedExpense) {
      const payments = await query(
        `SELECT COUNT(*) as count FROM payment_transactions WHERE reference_type = 'expense' AND reference_id = $1`,
        [linkedExpense.id]
      );
      if ((parseFloat(linkedExpense.amount_paid) || 0) > 0 || parseInt(payments.rows[0].count) > 0) {
        return res.status(400).json({
          success: false,
          message: 'This bill has vendor payments recorded against it. Delete those payments in Bank & Payments first, then delete the bill.',
        });
      }
    }
    await query('DELETE FROM purchase_orders WHERE id = $1', [req.params.id]);
    if (linkedExpense) {
      await query('DELETE FROM vendor_payments WHERE expense_id = $1', [linkedExpense.id]);
      await query('DELETE FROM expenses WHERE id = $1', [linkedExpense.id]);
    }
    res.json({ success: true, message: 'Purchase bill deleted successfully' });
  } catch (error) {
    logError(error, req, { feature: 'purchase-orders' });
    logger.error('Delete purchase order error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete purchase bill' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/purchase-orders/:id/convert-to-bill — turns this Purchase Bill
// into a real `expenses` row so Vendor Payments, Vendor Ledger, GST
// Bifurcation, and Financial Reports all pick it up.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/convert-to-bill', async (req, res) => {
  try {
    const poRes = await query(
      `SELECT po.*, v.name as vendor_name FROM purchase_orders po JOIN vendors v ON po.vendor_id = v.id WHERE po.id = $1`,
      [req.params.id]
    );
    if (poRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Purchase bill not found' });
    const po = poRes.rows[0];
    if (po.status === 'billed') return res.status(400).json({ success: false, message: 'This purchase bill has already been billed' });
    if (po.status === 'cancelled') return res.status(400).json({ success: false, message: 'A cancelled purchase bill cannot be billed' });

    const items = await query('SELECT description FROM purchase_order_items WHERE purchase_order_id = $1', [po.id]);
    const billRef = po.bill_number || po.po_number;
    const description = describeBill(items.rows, billRef);

    const { expense_date, payment_method } = req.body;

    const expenseResult = await query(
      `INSERT INTO expenses (expense_date, category, description, amount, payment_method, vendor_id, notes, created_by,
        tax_type, tax_rate, cgst_amount, sgst_amount, igst_amount, is_rcm_applicable, tds_rate)
       VALUES ($1,'purchase_order',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [expense_date || po.po_date, description, po.total_amount, payment_method || 'bank_transfer', po.vendor_id,
       `Converted from Purchase Bill ${billRef}`, req.user.userId,
       po.tax_type, po.tax_rate, po.cgst_amount, po.sgst_amount, po.igst_amount, po.is_rcm_applicable, po.tds_rate || 0]
    );
    const expense = expenseResult.rows[0];

    await query(
      `UPDATE purchase_orders SET status='billed', expense_id=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2`,
      [expense.id, po.id]
    );

    res.json({ success: true, data: { purchase_order_id: po.id, expense }, message: `Purchase bill booked — now visible as an expense ready for Vendor Payments` });
  } catch (error) {
    logError(error, req, { feature: 'purchase-orders' });
    logger.error('Convert purchase order to bill error:', error);
    res.status(500).json({ success: false, message: 'Failed to convert purchase bill to an expense' });
  }
});

// POST /api/purchase-orders/:id/cancel
router.post('/:id/cancel', async (req, res) => {
  try {
    const existing = await query('SELECT status FROM purchase_orders WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Purchase bill not found' });
    if (existing.rows[0].status === 'billed') {
      return res.status(400).json({ success: false, message: 'This purchase bill has already been billed and cannot be cancelled' });
    }
    await query(`UPDATE purchase_orders SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [req.params.id]);
    res.json({ success: true, message: 'Purchase bill cancelled' });
  } catch (error) {
    logError(error, req, { feature: 'purchase-orders' });
    logger.error('Cancel purchase order error:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel purchase bill' });
  }
});

module.exports = router;
