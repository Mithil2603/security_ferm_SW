const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validators');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');

const path = require('path');
const { logError } = require('../utils/errorLogger');
const baseUploadPath = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const tempDir = path.join(baseUploadPath, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}
const upload = multer({ dest: tempDir });

router.use(authMiddleware);
router.use(requirePermission('manage_employees'));

// GET /api/attendance
router.get('/', async (req, res) => {
  try {
    const { employee_id, client_id, from_date, to_date, status, page = 1, limit = 100 } = req.query;
    let conditions = [];
    let params = [];
    let pc = 1;

    if (employee_id) { conditions.push(`a.employee_id = $${pc}`); params.push(employee_id); pc++; }
    if (client_id) { conditions.push(`a.client_id = $${pc}`); params.push(client_id); pc++; }
    if (from_date) { conditions.push(`a.attendance_date >= $${pc}`); params.push(from_date); pc++; }
    if (to_date) { conditions.push(`a.attendance_date <= $${pc}`); params.push(to_date); pc++; }
    if (status) { conditions.push(`a.status = $${pc}`); params.push(status); pc++; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT a.*, e.full_name as employee_name, e.employee_id as emp_id, c.name as client_name
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       LEFT JOIN clients c ON a.client_id = c.id
       ${where}
       ORDER BY a.attendance_date DESC, e.full_name ASC
       LIMIT $${pc} OFFSET $${pc + 1}`,
      [...params, parseInt(limit), offset]
    );

    const countResult = await query(`SELECT COUNT(*) AS count FROM attendance a ${where}`, params);

    res.json({
      success: true,
      data: result.rows,
      pagination: { total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'attendance' });
    logger.error('Get attendance error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch attendance' });
  }
});

// POST /api/attendance (mark single)
router.post('/', validate(schemas.markAttendance), async (req, res) => {
  try {
    const { employee_id, client_id, attendance_date, check_in_time, check_out_time, status = 'present', notes } = req.body;
    if (!employee_id || !attendance_date) {
      return res.status(400).json({ success: false, message: 'Employee ID and date are required' });
    }
    if (new Date(attendance_date) > new Date()) {
      return res.status(400).json({ success: false, message: 'Cannot mark attendance for future dates' });
    }

    let hours_worked = null;
    if (check_in_time && check_out_time) {
      const [inH, inM] = check_in_time.split(':').map(Number);
      const [outH, outM] = check_out_time.split(':').map(Number);
      let diff = (outH * 60 + outM) - (inH * 60 + inM);
      if (diff < 0) diff += 24 * 60; // Handle overnight shifts
      hours_worked = parseFloat((diff / 60).toFixed(2));
    }

    const result = await query(
      `INSERT INTO attendance (employee_id, client_id, attendance_date, check_in_time, check_out_time, hours_worked, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON DUPLICATE KEY UPDATE
         client_id=VALUES(client_id), check_in_time=VALUES(check_in_time), check_out_time=VALUES(check_out_time),
         hours_worked=VALUES(hours_worked), status=VALUES(status), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP`,
      [employee_id, client_id || null, attendance_date, check_in_time || null, check_out_time || null, hours_worked, status, notes, req.user.userId]
    );

    // Fetch the inserted/updated row
    const fetched = await query(
      'SELECT * FROM attendance WHERE employee_id = $1 AND attendance_date = $2',
      [employee_id, attendance_date]
    );
    res.status(201).json({ success: true, data: fetched.rows[0] });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'attendance' });
    logger.error('Mark attendance error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark attendance' });
  }
});

// PUT /api/attendance/:id
router.put('/:id', async (req, res) => {
  try {
    const { client_id, check_in_time, check_out_time, status, notes } = req.body;
    let hours_worked = null;
    if (check_in_time && check_out_time) {
      const [inH, inM] = check_in_time.split(':').map(Number);
      const [outH, outM] = check_out_time.split(':').map(Number);
      let diff = (outH * 60 + outM) - (inH * 60 + inM);
      if (diff < 0) diff += 24 * 60;
      hours_worked = parseFloat((diff / 60).toFixed(2));
    }

    const result = await query(
      `UPDATE attendance SET 
        client_id = $1, check_in_time = $2, check_out_time = $3, 
        hours_worked = $4, status = $5, notes = $6, updated_at = CURRENT_TIMESTAMP
       WHERE id = $7 RETURNING *`,
      [client_id || null, check_in_time || null, check_out_time || null, hours_worked, status, notes, req.params.id]
    );

    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Record not found' });
    res.json({ success: true, data: result.rows[0], message: 'Record updated successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'attendance' });
    res.status(500).json({ success: false, message: 'Failed to update attendance' });
  }
});

// DELETE /api/attendance/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM attendance WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Record not found' });
    res.json({ success: true, message: 'Record deleted successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'attendance' });
    res.status(500).json({ success: false, message: 'Failed to delete attendance' });
  }
});

// POST /api/attendance/bulk
router.post('/bulk', validate(schemas.bulkAttendance), async (req, res) => {
  try {
    const { records } = req.body; // Array of attendance records
    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, message: 'Records array is required' });
    }

    const bulkDate = records[0]?.attendance_date;
    if (bulkDate && new Date(bulkDate) > new Date()) {
      return res.status(400).json({ success: false, message: 'Cannot mark attendance for future dates' });
    }

    let successCount = 0;
    let errors = [];

    for (const record of records) {
      try {
        const { employee_id, client_id, attendance_date, check_in_time, check_out_time, status = 'present', notes } = record;
        let hours_worked = null;
        if (check_in_time && check_out_time) {
          const [inH, inM] = check_in_time.split(':').map(Number);
          const [outH, outM] = check_out_time.split(':').map(Number);
          let diff = (outH * 60 + outM) - (inH * 60 + inM);
          if (diff < 0) diff += 24 * 60;
          hours_worked = parseFloat((diff / 60).toFixed(2));
        }
        await query(
          `INSERT INTO attendance (employee_id, client_id, attendance_date, check_in_time, check_out_time, hours_worked, status, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON DUPLICATE KEY UPDATE
             client_id=VALUES(client_id), check_in_time=VALUES(check_in_time), check_out_time=VALUES(check_out_time),
             hours_worked=VALUES(hours_worked), status=VALUES(status), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP`,
          [employee_id, client_id || null, attendance_date, check_in_time || null, check_out_time || null, hours_worked, status, notes, req.user.userId]
        );
        successCount++;
      } catch (err) {
    logError(err, typeof req !== 'undefined' ? req : {}, { feature: 'attendance' });
        errors.push({ record, error: err.message });
      }
    }

    res.json({ success: true, message: `${successCount} records marked`, errors });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'attendance' });
    res.status(500).json({ success: false, message: 'Bulk attendance failed' });
  }
});

// GET /api/attendance/summary/:employee_id/:month (YYYY-MM)
router.get('/summary/:employee_id/:month', async (req, res) => {
  try {
    const { employee_id, month } = req.params;
    const [year, mon] = month.split('-');
    const startDate = `${year}-${mon}-01`;
    const endDate = new Date(parseInt(year), parseInt(mon), 0).toISOString().split('T')[0];

    const result = await query(
      `SELECT 
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present_days,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_days,
        SUM(CASE WHEN status = 'leave' THEN 1 ELSE 0 END) as leave_days,
        SUM(CASE WHEN status = 'holiday' THEN 1 ELSE 0 END) as holiday_days,
        SUM(CASE WHEN status = 'half_day' THEN 1 ELSE 0 END) as half_days,
        COALESCE(SUM(hours_worked), 0) as total_hours,
        COUNT(*) as total_records
       FROM attendance
       WHERE employee_id = $1 AND attendance_date BETWEEN $2 AND $3`,
      [employee_id, startDate, endDate]
    );

    res.json({ success: true, data: { ...result.rows[0], month, employee_id, start_date: startDate, end_date: endDate } });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'attendance' });
    res.status(500).json({ success: false, message: 'Failed to get attendance summary' });
  }
});

// POST /api/attendance/bulk-upload
router.post('/bulk-upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const results = [];
  const errors = [];
  let successCount = 0;

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('error', (err) => {
      res.status(500).json({ success: false, message: 'Failed to read CSV file' });
    })
    .on('end', async () => {
      try {

      for (const row of results) {
        try {
          // Expected columns: employee_id, date, check_in, check_out, status, notes
          // Find employee by employee_id string or just id
          let empId = null;
          if (row.id) {
            empId = row.id;
          } else if (row.employee_id) {
            const empRes = await query('SELECT id, assigned_client_id FROM employees WHERE employee_id = $1', [row.employee_id]);
            if (empRes.rows.length > 0) {
              empId = empRes.rows[0].id;
              row.client_id = row.client_id || empRes.rows[0].assigned_client_id;
            }
          }
          
          if (!empId) {
            errors.push({ row, error: 'Employee not found' });
            continue;
          }

          const attendance_date = row.date;
          if (!attendance_date) {
            errors.push({ row, error: 'Date is required' });
            continue;
          }

          const check_in_time = row.check_in || null;
          const check_out_time = row.check_out || null;
          const status = row.status || 'present';
          const notes = row.notes || '';

          let hours_worked = null;
          if (check_in_time && check_out_time) {
            const [inH, inM] = check_in_time.split(':').map(Number);
            const [outH, outM] = check_out_time.split(':').map(Number);
            let diff = (outH * 60 + outM) - (inH * 60 + inM);
            if (diff < 0) diff += 24 * 60;
            hours_worked = parseFloat((diff / 60).toFixed(2));
          }

          await query(
            `INSERT INTO attendance (employee_id, client_id, attendance_date, check_in_time, check_out_time, hours_worked, status, notes, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON DUPLICATE KEY UPDATE
               client_id=VALUES(client_id), check_in_time=VALUES(check_in_time), check_out_time=VALUES(check_out_time),
               hours_worked=VALUES(hours_worked), status=VALUES(status), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP`,
            [empId, row.client_id || null, attendance_date, check_in_time, check_out_time, hours_worked, status, notes, req.user.userId]
          );
          successCount++;
        } catch (err) {
    logError(err, typeof req !== 'undefined' ? req : {}, { feature: 'attendance' });
          errors.push({ row, error: err.message });
        }
      }

      res.json({
        success: true,
        message: `Bulk upload completed. ${successCount} records added/updated. ${errors.length} failed.`,
        successCount,
        errors
      });
      } catch (err) {
        logError(err, typeof req !== 'undefined' ? req : {}, { feature: 'attendance' });
        logger.error('Bulk upload error:', err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: 'An error occurred during bulk processing' });
        }
      } finally {
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      }
    });
});

module.exports = router;
