const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validators');
const { logError } = require('../utils/errorLogger');
const { logAudit } = require('../middleware/audit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const exceljs = require('exceljs');
const crypto = require('crypto');

// Ensure uploads directory exists
const baseUploadPath = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const uploadDir = path.join(baseUploadPath, 'docs');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'DOC-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPG, PNG, WEBP are allowed.'));
    }
  }
});

const importUpload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.originalname.endsWith('.xlsx')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only XLSX is allowed for import.'));
    }
  }
});

router.use(authMiddleware);
router.use(requirePermission('manage_employees'));

// GET /api/employees
router.get('/', async (req, res) => {
  try {
    const { search, is_active, client_id, page = 1, limit = 50 } = req.query;
    let conditions = [];
    let params = [];
    let pc = 1;

    if (search) {
      conditions.push(`(e.full_name LIKE $${params.length + 1} OR e.employee_id LIKE $${params.length + 2} OR e.phone LIKE $${params.length + 3})`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (is_active !== undefined) {
      conditions.push(`e.is_active = $${params.length + 1}`);
      params.push(is_active === 'true');
    }
    if (client_id) {
      conditions.push(`e.assigned_client_id = $${params.length + 1}`);
      params.push(client_id);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT e.*, 
        ss.base_salary, ss.dearness_allowance, ss.house_rent_allowance, ss.pf_percentage,
        c.name as client_name,
        ss.name as salary_structure_name
       FROM employees e
       LEFT JOIN clients c ON e.assigned_client_id = c.id
       LEFT JOIN salary_structures ss ON e.salary_structure_id = ss.id
       ${where}
       ORDER BY e.is_active DESC, e.full_name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit), offset]
    );

    const countResult = await query(`SELECT COUNT(*) AS count FROM employees e ${where}`, params);

    const canReveal = req.query.reveal === 'true' && (req.user.role === 'admin' || req.user.role === 'accountant');
    
    if (canReveal && result.rows.length > 0) {
      logger.warn(`AUDIT: User ${req.user.userId} (${req.user.role}) revealed PII for employee list.`);
    }

    const maskedRows = result.rows.map(emp => {
      if (!canReveal) {
        if (emp.aadhar_number && emp.aadhar_number.length >= 4) {
          emp.aadhar_number = 'XXXX-XXXX-' + emp.aadhar_number.slice(-4);
        }
        if (emp.pan_number && emp.pan_number.length >= 4) {
          emp.pan_number = 'XXXXX' + emp.pan_number.slice(-4);
        }
        if (emp.bank_account_number && emp.bank_account_number.length >= 4) {
          emp.bank_account_number = 'XXXXX' + emp.bank_account_number.slice(-4);
        }
      }
      return emp;
    });

    res.json({
      success: true,
      data: maskedRows,
      pagination: { total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) }
    });
  } catch (error) {
    logError(error, req, { feature: 'employees' });
    logger.error('Get employees error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch employees' });
  }
});

// GET /api/employees/salary-structures
router.get('/meta/salary-structures', async (req, res) => {
  try {
    const result = await query('SELECT * FROM salary_structures WHERE is_active = 1 ORDER BY base_salary ASC');
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, req, { feature: 'employees' });
    res.status(500).json({ success: false, message: 'Failed to fetch salary structures' });
  }
});

// GET /api/employees/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT e.*, c.name as client_name, ss.name as salary_structure_name,
        ss.base_salary, ss.dearness_allowance, ss.house_rent_allowance, ss.other_allowances, ss.pf_percentage
       FROM employees e
       LEFT JOIN clients c ON e.assigned_client_id = c.id
       LEFT JOIN salary_structures ss ON e.salary_structure_id = ss.id
       WHERE e.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    let emp = result.rows[0];
    const canReveal = req.query.reveal === 'true' && (req.user.role === 'admin' || req.user.role === 'accountant');
    
    if (canReveal) {
      logger.warn(`AUDIT: User ${req.user.userId} (${req.user.role}) revealed PII for employee ID ${emp.id}.`);
    } else {
      if (emp.aadhar_number && emp.aadhar_number.length >= 4) emp.aadhar_number = 'XXXX-XXXX-' + emp.aadhar_number.slice(-4);
      if (emp.pan_number && emp.pan_number.length >= 4) emp.pan_number = 'XXXXX' + emp.pan_number.slice(-4);
      if (emp.bank_account_number && emp.bank_account_number.length >= 4) emp.bank_account_number = 'XXXXX' + emp.bank_account_number.slice(-4);
    }

    res.json({ success: true, data: emp });
  } catch (error) {
    logError(error, req, { feature: 'employees' });
    res.status(500).json({ success: false, message: 'Failed to fetch employee' });
  }
});

// POST /api/employees/import
router.post('/import', importUpload.single('file'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    filePath = req.file.path;
    const workbook = new exceljs.Workbook();
    await workbook.xlsx.readFile(filePath);
    
    const worksheet = workbook.getWorksheet(1); // Get first sheet
    if (!worksheet) {
      return res.status(400).json({ success: false, message: 'Invalid or empty Excel file' });
    }

    let importedCount = 0;
    let skippedCount = 0;
    
    const rowsToProcess = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // Skip headers
      
      const full_name = row.getCell(1).value?.toString() || '';
      const phone = row.getCell(2).value?.toString() || '';
      const email = row.getCell(3).value?.toString() || '';
      const address = row.getCell(4).value?.toString() || '';
      const city = row.getCell(5).value?.toString() || '';
      
      if (full_name && phone) {
        rowsToProcess.push({ full_name, phone, email, address, city });
      } else {
        skippedCount++;
      }
    });

    const promises = rowsToProcess.map(async (data) => {
      const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
      const employee_id = `EMP-${randomHex}`;
      const date_of_joining = new Date().toISOString().split('T')[0];
      return query(
        `INSERT INTO employees (employee_id, full_name, phone, email, address, city, date_of_joining)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [employee_id, data.full_name, data.phone, data.email, data.address, data.city, date_of_joining]
      );
    });

    const results = await Promise.allSettled(promises);
    results.forEach(r => {
      if (r.status === 'fulfilled') importedCount++;
      else skippedCount++;
    });

    await logAudit(req, 'employees', null, 'create', `Bulk imported ${importedCount} employees`);

    res.json({
      success: true,
      message: `Successfully imported ${importedCount} employees. Skipped ${skippedCount} invalid rows.`,
      data: { imported: importedCount, skipped: skippedCount }
    });
  } catch (error) {
    logger.error('Import error:', error);
    res.status(500).json({ success: false, message: 'Failed to process the import file' });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});


// POST /api/employees
router.post('/', validate(schemas.createEmployee), async (req, res) => {
  try {
    const { full_name, phone, email, date_of_birth, address, city, aadhar_number, pan_number,
      bank_account_number, bank_ifsc_code, bank_name, bank_account_holder_name,
      date_of_joining, designation = 'Watchman', salary_structure_id, assigned_client_id,
      emergency_contact_name, emergency_contact_phone, notes } = req.body;

    if (!full_name || !phone || !date_of_joining) {
      return res.status(400).json({ success: false, message: 'Name, phone, and joining date are required' });
    }

    let employee_id;
    let collision = true;
    let attempts = 0;
    while(collision && attempts < 3) {
      const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
      employee_id = `EMP-${randomHex}`;
      const check = await query('SELECT id FROM employees WHERE employee_id = $1', [employee_id]);
      if (check.rows.length === 0) collision = false;
      attempts++;
    }
    if (collision) return res.status(500).json({ success: false, message: 'Failed to generate unique employee ID' });

    const result = await query(
      `INSERT INTO employees (employee_id, full_name, phone, email, date_of_birth, address, city, 
        aadhar_number, pan_number, bank_account_number, bank_ifsc_code, bank_name, bank_account_holder_name,
        date_of_joining, designation, salary_structure_id, assigned_client_id, 
        emergency_contact_name, emergency_contact_phone, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [employee_id, full_name, phone, email, date_of_birth || null, address, city, aadhar_number, pan_number,
        bank_account_number, bank_ifsc_code, bank_name, bank_account_holder_name,
        date_of_joining, designation, salary_structure_id || null, assigned_client_id || null,
        emergency_contact_name, emergency_contact_phone, notes]
    );

    await logAudit(req, 'employees', result.rows[0].id, 'create', `Created employee: ${full_name} (${employee_id})`);

    res.status(201).json({ success: true, data: result.rows[0], message: 'Employee created successfully' });
  } catch (error) {
    logError(error, req, { feature: 'employees' });
    logger.error('Create employee error:', error);
    res.status(500).json({ success: false, message: 'Failed to create employee' });
  }
});

// PUT /api/employees/:id
router.put('/:id', validate(schemas.updateEmployee), async (req, res) => {
  try {
    const { full_name, phone, email, date_of_birth, address, city, aadhar_number, pan_number,
      bank_account_number, bank_ifsc_code, bank_name, bank_account_holder_name,
      date_of_joining, designation, salary_structure_id, assigned_client_id,
      emergency_contact_name, emergency_contact_phone, notes, is_active } = req.body;

    // Coerce is_active to boolean (SQLite returns 0/1 which round-trips through the form)
    const isActiveBool = is_active === true || is_active === 1 || is_active === 'true' || is_active === '1';

    const result = await query(
      `UPDATE employees SET full_name=$1, phone=$2, email=$3, date_of_birth=$4, address=$5, city=$6,
        aadhar_number=$7, pan_number=$8, bank_account_number=$9, bank_ifsc_code=$10, bank_name=$11,
        bank_account_holder_name=$12, date_of_joining=$13, designation=$14, salary_structure_id=$15,
        assigned_client_id=$16, emergency_contact_name=$17, emergency_contact_phone=$18, notes=$19,
        is_active=$20, updated_at=CURRENT_TIMESTAMP
       WHERE id=$21`,
      [full_name, phone, email, date_of_birth || null, address, city, aadhar_number, pan_number,
        bank_account_number, bank_ifsc_code, bank_name, bank_account_holder_name,
        date_of_joining, designation, salary_structure_id || null, assigned_client_id || null,
        emergency_contact_name, emergency_contact_phone, notes, isActiveBool,
        req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    await logAudit(req, 'employees', req.params.id, 'update', `Updated employee: ${full_name}`);

    res.json({ success: true, data: { id: req.params.id, ...req.body, is_active: isActiveBool }, message: 'Employee updated successfully' });
  } catch (error) {
    logError(error, req, { feature: 'employees' });
    logger.error('Update employee error:', error);
    res.status(500).json({ success: false, message: 'Failed to update employee' });
  }
});

// DELETE /api/employees/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await query(
      'UPDATE employees SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    
    await logAudit(req, 'employees', req.params.id, 'update', 'Deactivated employee');
    
    res.json({ success: true, message: 'Employee deactivated successfully' });
  } catch (error) {
    logError(error, req, { feature: 'employees' });
    res.status(500).json({ success: false, message: 'Failed to deactivate employee' });
  }
});

// DELETE /api/employees/:id/hard (hard delete)
router.delete('/:id/hard', async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Only admins can permanently delete employees' });
  }
  try {
    const check = await query(`
      SELECT 
        (SELECT COUNT(*) FROM payroll WHERE employee_id = $1) as pc,
        (SELECT COUNT(*) FROM attendance WHERE employee_id = $1) as ac
    `, [req.params.id]);
    if (parseInt(check.rows[0].pc) > 0 || parseInt(check.rows[0].ac) > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete employee: linked payroll or attendance records exist. Please delete them first.' });
    }
    const result = await query('DELETE FROM employees WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    res.json({ success: true, message: 'Employee permanently deleted' });
  } catch (error) {
    logError(error, req, { feature: 'employees' });
    if (error.code === 'ER_ROW_IS_REFERENCED' || error.code === 'ER_ROW_IS_REFERENCED_2' || error.errno === 1451 || error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || (error.message && error.message.includes('FOREIGN KEY'))) {
      return res.status(400).json({ success: false, message: 'Cannot delete employee: linked payroll or attendance records exist. Please delete them first.' });
    }
    res.status(500).json({ success: false, message: 'Failed to permanently delete employee' });
  }
});



// POST /api/employees/:id/upload-doc
router.post('/:id/upload-doc', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const result = await query(
      'INSERT INTO employee_documents (employee_id, file_name, file_path) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, path.basename(req.file.originalname), req.file.filename]
    );

    res.json({ success: true, message: 'Document uploaded successfully', data: result.rows[0] });
  } catch (error) {
    logError(error, req, { feature: 'employees' });
    logger.error('Upload document error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to upload document' });
  }
});

// GET /api/employees/:id/docs
router.get('/:id/docs', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, file_name, file_path, uploaded_at FROM employee_documents WHERE employee_id = $1 ORDER BY uploaded_at DESC',
      [req.params.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logError(error, req, { feature: 'employees' });
    res.status(500).json({ success: false, message: 'Failed to fetch documents' });
  }
});

// GET /api/employees/:id/docs/:docId/download
router.get('/:id/docs/:docId/download', async (req, res) => {
  try {
    const result = await query('SELECT file_path, file_name FROM employee_documents WHERE id = $1 AND employee_id = $2', [req.params.docId, req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Document not found' });
    
    const file = path.join(uploadDir, result.rows[0].file_path);
    if (!fs.existsSync(file)) return res.status(404).json({ success: false, message: 'File missing on disk' });
    
    res.download(file, result.rows[0].file_name);
  } catch(e) {
    logError(e, req, { feature: 'employees' });
    res.status(500).json({ success: false, message: 'Failed to download document' });
  }
});

module.exports = router;
