const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { logError } = require('../utils/errorLogger');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Dynamic uploads directory configuration
const storageConfig = require('../utils/storageConfig');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, storageConfig.getUploadDir('vendor_docs'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'VND-DOC-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, JPG, PNG, WEBP, XLSX, DOCX'));
    }
  }
});

router.use(authMiddleware);

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET /api/vendors/alerts/expiring-docs — Documents expiring within 30 days
// ─────────────────────────────────────────────────────────────────────────────
router.get('/alerts/expiring-docs', async (req, res) => {
  try {
    const result = await query(`
      SELECT vd.*, v.legal_name, v.display_name, v.vendor_code
      FROM vendor_documents vd
      JOIN vendors v ON vd.vendor_id = v.id
      WHERE vd.expiry_date IS NOT NULL 
        AND vd.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
        AND v.is_active = 1
      ORDER BY vd.expiry_date ASC
    `);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'vendors' });
    res.status(500).json({ success: false, message: 'Failed to fetch document alerts' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GET /api/vendors — List vendors with search, filters & financial stats
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { search, is_active, all, page = 1, limit = 50 } = req.query;

    // Fast dropdown support
    if (all === 'true' && !search && is_active === undefined) {
      const result = await query(`
        SELECT v.id, v.vendor_code, v.legal_name, v.display_name, v.name, v.tax_id, v.is_active
        FROM vendors v
        WHERE v.is_active = 1
        ORDER BY COALESCE(v.display_name, v.name) ASC
      `);
      return res.json({ success: true, data: result.rows });
    }

    let conditions = [];
    let params = [];
    let pc = 1;

    if (search) {
      conditions.push(`(
        v.vendor_code LIKE $${pc} OR 
        v.legal_name LIKE $${pc} OR 
        v.display_name LIKE $${pc} OR 
        v.name LIKE $${pc} OR 
        v.tax_id LIKE $${pc} OR
        v.contact_info LIKE $${pc}
      )`);
      params.push(`%${search}%`);
      pc++;
    }

    if (is_active !== undefined && is_active !== '') {
      conditions.push(`v.is_active = $${pc}`);
      params.push(is_active === 'true' || is_active === '1' ? 1 : 0);
      pc++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const dataSql = `
      SELECT v.*,
        ec.name AS default_account_name,
        (SELECT COUNT(*) FROM vendor_documents vd WHERE vd.vendor_id = v.id) AS total_documents,
        (SELECT COUNT(*) FROM vendor_documents vd WHERE vd.vendor_id = v.id AND vd.status = 'Pending') AS pending_documents,
        COALESCE((SELECT SUM(amount) FROM expenses e WHERE e.vendor_id = v.id AND e.status != 'rejected'), 0) AS total_billed,
        COALESCE((SELECT SUM(amount_paid) FROM expenses e WHERE e.vendor_id = v.id AND e.status != 'rejected'), 0) AS total_paid
      FROM vendors v
      LEFT JOIN expense_categories ec ON v.default_account_id = ec.id
      ${whereClause}
      ORDER BY v.created_at DESC, v.id DESC
      LIMIT $${pc} OFFSET $${pc + 1}
    `;

    const countSql = `SELECT COUNT(*) AS total FROM vendors v ${whereClause}`;

    const [dataResult, countResult] = await Promise.all([
      query(dataSql, [...params, parseInt(limit), offset]),
      query(countSql, params)
    ]);

    const total = parseInt(countResult.rows[0]?.total || 0);

    const formattedRows = dataResult.rows.map(row => ({
      ...row,
      balance_due: (parseFloat(row.total_billed) || 0) - (parseFloat(row.total_paid) || 0)
    }));

    res.json({
      success: true,
      data: formattedRows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'vendors' });
    logger.error('Get vendors error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch vendors' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GET /api/vendors/:id — Single vendor detail
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const result = await query(`
      SELECT v.*,
        ec.name AS default_account_name,
        (SELECT COUNT(*) FROM vendor_documents vd WHERE vd.vendor_id = v.id) AS total_documents,
        (SELECT COUNT(*) FROM vendor_documents vd WHERE vd.vendor_id = v.id AND vd.status = 'Pending') AS pending_documents,
        COALESCE((SELECT SUM(amount) FROM expenses e WHERE e.vendor_id = v.id AND e.status != 'rejected'), 0) AS total_billed,
        COALESCE((SELECT SUM(amount_paid) FROM expenses e WHERE e.vendor_id = v.id AND e.status != 'rejected'), 0) AS total_paid
      FROM vendors v
      LEFT JOIN expense_categories ec ON v.default_account_id = ec.id
      WHERE v.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      data: {
        ...row,
        balance_due: (parseFloat(row.total_billed) || 0) - (parseFloat(row.total_paid) || 0)
      }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'vendors' });
    res.status(500).json({ success: false, message: 'Failed to fetch vendor' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Require manage_expenses permission for write operations
// ─────────────────────────────────────────────────────────────────────────────
router.use(requirePermission('manage_expenses'));

// POST /api/vendors — Create new vendor
router.post('/', async (req, res) => {
  try {
    const {
      vendor_code,
      legal_name,
      display_name,
      name,
      tax_id,
      currency = 'INR',
      contact_info,
      payment_terms_days = 0,
      bank_name,
      bank_account_no,
      bank_routing_code,
      default_account_id,
      is_active = true
    } = req.body;

    const finalDisplayName = display_name || legal_name || name;
    const finalLegalName = legal_name || display_name || name;

    if (!finalDisplayName) {
      return res.status(400).json({ success: false, message: 'Vendor name is required' });
    }

    // Auto-generate vendor_code if not provided
    let finalCode = vendor_code?.trim() || null;
    if (!finalCode) {
      const maxRes = await query('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM vendors');
      const nextId = maxRes.rows[0]?.next_id || 1;
      finalCode = `VND-${String(nextId).padStart(3, '0')}`;
    }

    const result = await query(`
      INSERT INTO vendors (
        vendor_code, legal_name, display_name, name, tax_id, currency,
        contact_info, payment_terms_days, bank_name, bank_account_no,
        bank_routing_code, default_account_id, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      finalCode,
      finalLegalName,
      finalDisplayName,
      finalDisplayName, // for backward compatibility
      tax_id ? tax_id.trim().toUpperCase() : null,
      currency || 'INR',
      contact_info || null,
      parseInt(payment_terms_days) || 0,
      bank_name || null,
      bank_account_no || null,
      bank_routing_code ? bank_routing_code.trim().toUpperCase() : null,
      default_account_id || null,
      is_active ? 1 : 0
    ]);

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Vendor created successfully'
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'vendors' });
    logger.error('Create vendor error:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Vendor code or Tax ID already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to create vendor' });
  }
});

// PUT /api/vendors/:id — Update vendor
router.put('/:id', async (req, res) => {
  try {
    const {
      vendor_code,
      legal_name,
      display_name,
      name,
      tax_id,
      currency = 'INR',
      contact_info,
      payment_terms_days,
      bank_name,
      bank_account_no,
      bank_routing_code,
      default_account_id,
      is_active
    } = req.body;

    const finalDisplayName = display_name || legal_name || name;
    const finalLegalName = legal_name || display_name || name;

    if (!finalDisplayName) {
      return res.status(400).json({ success: false, message: 'Vendor name is required' });
    }

    const result = await query(`
      UPDATE vendors SET
        vendor_code = COALESCE($1, vendor_code),
        legal_name = $2,
        display_name = $3,
        name = $4,
        tax_id = $5,
        currency = $6,
        contact_info = $7,
        payment_terms_days = $8,
        bank_name = $9,
        bank_account_no = $10,
        bank_routing_code = $11,
        default_account_id = $12,
        is_active = $13,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
    `, [
      vendor_code || null,
      finalLegalName,
      finalDisplayName,
      finalDisplayName,
      tax_id ? tax_id.trim().toUpperCase() : null,
      currency || 'INR',
      contact_info || null,
      payment_terms_days !== undefined ? parseInt(payment_terms_days) || 0 : 0,
      bank_name || null,
      bank_account_no || null,
      bank_routing_code ? bank_routing_code.trim().toUpperCase() : null,
      default_account_id || null,
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
      req.params.id
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    const updated = await query('SELECT * FROM vendors WHERE id = $1', [req.params.id]);
    res.json({
      success: true,
      data: updated.rows[0],
      message: 'Vendor updated successfully'
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'vendors' });
    logger.error('Update vendor error:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Vendor code or Tax ID already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to update vendor' });
  }
});

// PATCH /api/vendors/:id/toggle-status — Activate / Deactivate vendor
router.patch('/:id/toggle-status', async (req, res) => {
  try {
    const existing = await query('SELECT is_active FROM vendors WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    const nextStatus = existing.rows[0].is_active ? 0 : 1;
    await query('UPDATE vendors SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [nextStatus, req.params.id]);
    res.json({ success: true, is_active: nextStatus === 1, message: `Vendor ${nextStatus ? 'activated' : 'deactivated'}` });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'vendors' });
    res.status(500).json({ success: false, message: 'Failed to toggle vendor status' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Vendor Documents API (Compliance & Audit)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/vendors/:id/documents — List documents
router.get('/:id/documents', async (req, res) => {
  try {
    const result = await query(`
      SELECT vd.*, u.full_name AS verified_by_name
      FROM vendor_documents vd
      LEFT JOIN users u ON vd.verified_by = u.id
      WHERE vd.vendor_id = $1
      ORDER BY vd.created_at DESC
    `, [req.params.id]);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'vendors' });
    res.status(500).json({ success: false, message: 'Failed to fetch vendor documents' });
  }
});

// POST /api/vendors/:id/documents — Upload document
router.post('/:id/documents', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No document file uploaded' });
    }

    const { document_type, expiry_date } = req.body;
    if (!document_type) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Document type is required' });
    }

    const fileUrl = `/uploads/vendor_docs/${req.file.filename}`;

    const result = await query(`
      INSERT INTO vendor_documents (
        vendor_id, document_type, file_url, file_name, file_size, mime_type, expiry_date, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending')
      RETURNING *
    `, [
      req.params.id,
      document_type,
      fileUrl,
      req.file.originalname,
      req.file.size,
      req.file.mimetype,
      expiry_date || null
    ]);

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Document uploaded successfully'
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'vendors' });
    logger.error('Upload vendor document error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload document' });
  }
});

// PATCH /api/vendors/:id/documents/:docId/status — Review / Approve / Reject
router.patch('/:id/documents/:docId/status', async (req, res) => {
  try {
    const { status, rejection_reason } = req.body;
    if (!['Pending', 'Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be Pending, Approved, or Rejected' });
    }

    const userId = req.user?.userId || req.user?.id || null;

    const result = await query(`
      UPDATE vendor_documents SET
        status = $1,
        rejection_reason = $2,
        verified_by = $3,
        verified_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 AND vendor_id = $5
    `, [
      status,
      status === 'Rejected' ? rejection_reason || 'Rejected during compliance review' : null,
      status === 'Pending' ? null : userId,
      req.params.docId,
      req.params.id
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const updated = await query(`
      SELECT vd.*, u.full_name AS verified_by_name
      FROM vendor_documents vd
      LEFT JOIN users u ON vd.verified_by = u.id
      WHERE vd.id = $1
    `, [req.params.docId]);

    res.json({
      success: true,
      data: updated.rows[0],
      message: `Document marked as ${status}`
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'vendors' });
    res.status(500).json({ success: false, message: 'Failed to update document status' });
  }
});

// DELETE /api/vendors/:id/documents/:docId — Delete document
router.delete('/:id/documents/:docId', async (req, res) => {
  try {
    const docRes = await query('SELECT * FROM vendor_documents WHERE id = $1 AND vendor_id = $2', [req.params.docId, req.params.id]);
    if (docRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }
    const doc = docRes.rows[0];

    // Remove file if exists locally
    if (doc.file_url) {
      const fileName = path.basename(doc.file_url);
      const filePath = path.join(storageConfig.getUploadDir('vendor_docs'), fileName);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_) {}
      } else {
        const defaultFilePath = path.join(storageConfig.getDefaultUploadDir(), 'vendor_docs', fileName);
        if (fs.existsSync(defaultFilePath)) {
          try { fs.unlinkSync(defaultFilePath); } catch (_) {}
        }
      }
    }

    await query('DELETE FROM vendor_documents WHERE id = $1', [req.params.docId]);
    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'vendors' });
    res.status(500).json({ success: false, message: 'Failed to delete document' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. GET /api/vendors/:id/statement — Existing Statement Integration
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/statement', async (req, res) => {
  try {
    const vendorId = req.params.id;

    const vendorRes = await query('SELECT * FROM vendors WHERE id = $1', [vendorId]);
    if (vendorRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    const vendor = vendorRes.rows[0];

    const expensesRes = await query(`
      SELECT * FROM expenses 
      WHERE vendor_id = $1 
      ORDER BY expense_date DESC, created_at DESC
    `, [vendorId]);

    const expenses = expensesRes.rows;

    let totalBilled = 0;
    let totalPaid = 0;

    expenses.forEach(exp => {
      if (exp.status !== 'rejected') {
        totalBilled += parseFloat(exp.amount) || 0;
        totalPaid += parseFloat(exp.amount_paid) || 0;
      }
    });

    const paymentsRes = await query(`
      SELECT vp.*, e.description as expense_description, e.expense_date
      FROM vendor_payments vp
      LEFT JOIN expenses e ON vp.expense_id = e.id
      WHERE vp.vendor_id = $1
      ORDER BY vp.payment_date DESC, vp.created_at DESC
    `, [vendorId]);

    res.json({
      success: true,
      data: {
        vendor,
        total_billed: totalBilled,
        total_paid: totalPaid,
        balance_due: totalBilled - totalPaid,
        expenses,
        payments: paymentsRes.rows
      }
    });

  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'vendors' });
    logger.error('Get vendor statement error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch vendor statement' });
  }
});

module.exports = router;
