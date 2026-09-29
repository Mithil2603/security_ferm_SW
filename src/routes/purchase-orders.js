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

router.use(authMiddleware);
router.use(requirePermission('manage_expenses'));

function getFY(dateStr) {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  return d.getMonth() >= 3 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
}

async function nextPoNumber(poDate) {
  const fy = getFY(poDate || new Date());
  const countRes = await query(`SELECT COUNT(*) as c FROM purchase_orders WHERE po_number LIKE $1`, [`PO-${fy}-%`]);
  const next = (parseInt(countRes.rows[0].c) || 0) + 1;
  return `PO-${fy}-${String(next).padStart(4, '0')}`;
}

function computeTotals(items, tax_type, tax_rate) {
  const subtotal = items.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0), 0);
  let cgst_amount = 0, sgst_amount = 0, igst_amount = 0, total_amount = subtotal;
  const finalTaxType = tax_type && tax_type !== 'none' ? tax_type : 'none';
  if (finalTaxType !== 'none' && tax_rate) {
    const rate = parseFloat(tax_rate) || 0;
    const gst = gstService.calculateGST(subtotal, rate, finalTaxType);
    cgst_amount = gst.cgst; sgst_amount = gst.sgst; igst_amount = gst.igst;
    total_amount = subtotal + gst.total_gst;
  }
  return {
    subtotal: parseFloat(subtotal.toFixed(2)),
    cgst_amount, sgst_amount, igst_amount,
    total_amount: parseFloat(total_amount.toFixed(2)),
    tax_type: finalTaxType,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/purchase-orders — list with search + pagination
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { search, status, vendor_id, page = 1, limit = 20 } = req.query;
    let conditions = [];
    let params = [];
    let pc = 1;

    if (search) {
      conditions.push(`(po.po_number LIKE $${pc} OR v.name LIKE $${pc})`);
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
    res.status(500).json({ success: false, message: 'Failed to fetch purchase orders' });
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
    if (poRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Purchase order not found' });
    const items = await query(`SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY id`, [req.params.id]);
    res.json({ success: true, data: { ...poRes.rows[0], items: items.rows } });
  } catch (error) {
    logError(error, req, { feature: 'purchase-orders' });
    logger.error('Get purchase order error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch purchase order' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/purchase-orders — create with multiple line items
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { vendor_id, po_date, items, tax_type, tax_rate, is_rcm_applicable, tds_rate, notes } = req.body;

    if (!vendor_id || !po_date) {
      return res.status(400).json({ success: false, message: 'Vendor and PO date are required' });
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

    const totals = computeTotals(items, tax_type, tax_rate);
    const poNumber = await nextPoNumber(po_date);

    const poResult = await query(
      `INSERT INTO purchase_orders
        (po_number, vendor_id, po_date, status, subtotal, tax_type, tax_rate, cgst_amount, sgst_amount, igst_amount,
         is_rcm_applicable, total_amount, notes, created_by, tds_rate)
       VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [poNumber, vendor_id, po_date, totals.subtotal, totals.tax_type, tax_rate || 0,
       totals.cgst_amount, totals.sgst_amount, totals.igst_amount,
       is_rcm_applicable ? 1 : 0, totals.total_amount, notes || null, req.user.userId, tds_rate || 0]
    );
    const po = poResult.rows[0];

    for (const it of items) {
      const amount = parseFloat((parseFloat(it.quantity) * parseFloat(it.unit_price)).toFixed(2));
      await query(
        `INSERT INTO purchase_order_items (purchase_order_id, description, hsn_code, quantity, unit_price, amount)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [po.id, it.description, it.hsn_code || null, it.quantity, it.unit_price, amount]
      );
    }

    const itemsResult = await query(`SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY id`, [po.id]);
    res.status(201).json({ success: true, data: { ...po, items: itemsResult.rows }, message: 'Purchase order created successfully' });
  } catch (error) {
    logError(error, req, { feature: 'purchase-orders' });
    logger.error('Create purchase order error:', error);
    res.status(500).json({ success: false, message: 'Failed to create purchase order' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/purchase-orders/:id — edit (draft only)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const existing = await query('SELECT * FROM purchase_orders WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Purchase order not found' });
    if (existing.rows[0].status !== 'draft') {
      return res.status(400).json({ success: false, message: 'Only draft purchase orders can be edited — this one has already been billed or cancelled' });
    }

    const { vendor_id, po_date, items, tax_type, tax_rate, is_rcm_applicable, tds_rate, notes } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one line item is required' });
    }
    for (const it of items) {
      if (!it.description || !(parseFloat(it.quantity) > 0) || !(parseFloat(it.unit_price) >= 0)) {
        return res.status(400).json({ success: false, message: 'Each item needs a description, a positive quantity, and a unit price' });
      }
    }

    const totals = computeTotals(items, tax_type, tax_rate);

    await query(
      `UPDATE purchase_orders SET vendor_id=$1, po_date=$2, subtotal=$3, tax_type=$4, tax_rate=$5,
        cgst_amount=$6, sgst_amount=$7, igst_amount=$8, is_rcm_applicable=$9, total_amount=$10, notes=$11,
        tds_rate=$12, updated_at=CURRENT_TIMESTAMP
       WHERE id=$13`,
      [vendor_id || existing.rows[0].vendor_id, po_date || existing.rows[0].po_date, totals.subtotal, totals.tax_type,
       tax_rate || 0, totals.cgst_amount, totals.sgst_amount, totals.igst_amount, is_rcm_applicable ? 1 : 0,
       totals.total_amount, notes || null, tds_rate || 0, req.params.id]
    );

    await query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [req.params.id]);
    for (const it of items) {
      const amount = parseFloat((parseFloat(it.quantity) * parseFloat(it.unit_price)).toFixed(2));
      await query(
        `INSERT INTO purchase_order_items (purchase_order_id, description, hsn_code, quantity, unit_price, amount)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.params.id, it.description, it.hsn_code || null, it.quantity, it.unit_price, amount]
      );
    }

    const updated = await query('SELECT * FROM purchase_orders WHERE id = $1', [req.params.id]);
    const itemsResult = await query(`SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY id`, [req.params.id]);
    res.json({ success: true, data: { ...updated.rows[0], items: itemsResult.rows }, message: 'Purchase order updated successfully' });
  } catch (error) {
    logError(error, req, { feature: 'purchase-orders' });
    logger.error('Update purchase order error:', error);
    res.status(500).json({ success: false, message: 'Failed to update purchase order' });
  }
});

// DELETE /api/purchase-orders/:id — draft only (cascade deletes items)
router.delete('/:id', async (req, res) => {
  try {
    const existing = await query('SELECT status FROM purchase_orders WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Purchase order not found' });
    if (existing.rows[0].status === 'billed') {
      return res.status(400).json({ success: false, message: 'This purchase order has already been billed and cannot be deleted' });
    }
    await query('DELETE FROM purchase_orders WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Purchase order deleted successfully' });
  } catch (error) {
    logError(error, req, { feature: 'purchase-orders' });
    logger.error('Delete purchase order error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete purchase order' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/purchase-orders/:id/convert-to-bill — the integration point: turns
// this PO into a real `expenses` row so Vendor Payments, Vendor Ledger, GST
// Bifurcation, and Financial Reports all pick it up exactly like any other
// vendor bill, with zero special-casing anywhere else in the app.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/convert-to-bill', async (req, res) => {
  try {
    const poRes = await query(
      `SELECT po.*, v.name as vendor_name FROM purchase_orders po JOIN vendors v ON po.vendor_id = v.id WHERE po.id = $1`,
      [req.params.id]
    );
    if (poRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Purchase order not found' });
    const po = poRes.rows[0];
    if (po.status === 'billed') return res.status(400).json({ success: false, message: 'This purchase order has already been billed' });
    if (po.status === 'cancelled') return res.status(400).json({ success: false, message: 'A cancelled purchase order cannot be billed' });

    const items = await query('SELECT description FROM purchase_order_items WHERE purchase_order_id = $1', [po.id]);
    const description = items.rows.length === 1
      ? items.rows[0].description
      : `${items.rows[0]?.description || 'Purchase'} + ${items.rows.length - 1} more item(s) (PO ${po.po_number})`;

    const { expense_date, payment_method } = req.body;

    const expenseResult = await query(
      `INSERT INTO expenses (expense_date, category, description, amount, payment_method, vendor_id, notes, created_by,
        tax_type, tax_rate, cgst_amount, sgst_amount, igst_amount, is_rcm_applicable, tds_rate)
       VALUES ($1,'purchase_order',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [expense_date || po.po_date, description, po.total_amount, payment_method || 'bank_transfer', po.vendor_id,
       `Converted from Purchase Order ${po.po_number}`, req.user.userId,
       po.tax_type, po.tax_rate, po.cgst_amount, po.sgst_amount, po.igst_amount, po.is_rcm_applicable, po.tds_rate || 0]
    );
    const expense = expenseResult.rows[0];

    await query(
      `UPDATE purchase_orders SET status='billed', expense_id=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2`,
      [expense.id, po.id]
    );

    res.json({ success: true, data: { purchase_order_id: po.id, expense }, message: `Purchase order billed — now visible as an expense ready for Vendor Payments` });
  } catch (error) {
    logError(error, req, { feature: 'purchase-orders' });
    logger.error('Convert purchase order to bill error:', error);
    res.status(500).json({ success: false, message: 'Failed to convert purchase order to a bill' });
  }
});

// POST /api/purchase-orders/:id/cancel
router.post('/:id/cancel', async (req, res) => {
  try {
    const existing = await query('SELECT status FROM purchase_orders WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Purchase order not found' });
    if (existing.rows[0].status === 'billed') {
      return res.status(400).json({ success: false, message: 'This purchase order has already been billed and cannot be cancelled' });
    }
    await query(`UPDATE purchase_orders SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [req.params.id]);
    res.json({ success: true, message: 'Purchase order cancelled' });
  } catch (error) {
    logError(error, req, { feature: 'purchase-orders' });
    logger.error('Cancel purchase order error:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel purchase order' });
  }
});

module.exports = router;
