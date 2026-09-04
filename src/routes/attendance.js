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
router.use((req, res, next) => {
  if (req.user && ['admin', 'manager', 'accountant'].includes(req.user.role)) {
    return next();
  }
  return requirePermission('manage_employees', 'manage_payroll')(req, res, next);
});

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

// POST /api/attendance/bulk
router.post('/bulk', validate(schemas.bulkAttendance), async (req, res) => {
  try {
    const { records } = req.body; // Array of attendance records
    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, message: 'Records array is required' });
    }

    let successCount = 0;
    let errors = [];

    for (const record of records) {
      try {
        const { employee_id, attendance_date, check_in_time, check_out_time, status = 'present', notes } = record;
        let hours_worked = null;
        if (check_in_time && check_out_time) {
          const [inH, inM] = check_in_time.split(':').map(Number);
          const [outH, outM] = check_out_time.split(':').map(Number);
          let diff = (outH * 60 + outM) - (inH * 60 + inM);
          if (diff < 0) diff += 24 * 60;
          hours_worked = parseFloat((diff / 60).toFixed(2));
        }
        await query(
          `INSERT INTO attendance (employee_id, attendance_date, check_in_time, check_out_time, hours_worked, status, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON DUPLICATE KEY UPDATE status=VALUES(status)`,
          [employee_id, attendance_date, check_in_time || null, check_out_time || null, hours_worked, status, notes, req.user.userId]
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

const ExcelJS = require('exceljs');

function extractCellText(cell) {
  if (!cell || cell.value === null || cell.value === undefined) return '';
  const val = cell.value;
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number') return String(val);
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'object') {
    if (val.text) return String(val.text).trim();
    if (val.result !== undefined && val.result !== null) return String(val.result).trim();
    if (Array.isArray(val.richText)) return val.richText.map(t => t.text || '').join('').trim();
  }
  return String(val).trim();
}

function parseDateString(dateVal) {
  if (!dateVal) return null;
  if (dateVal instanceof Date) return dateVal.toISOString().split('T')[0];
  
  const num = Number(dateVal);
  // Detect Excel date serial number (e.g. 46031 or 46031.00011574074)
  if (!isNaN(num) && num > 25000 && num < 80000) {
    try {
      const date = new Date(Math.round((num - 25569) * 86400 * 1000));
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    } catch (_) {}
  }

  const str = String(dateVal).trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(str)) {
    const [y, m, d] = str.split('-');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // DD-MM-YYYY or DD/MM/YYYY
  if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}$/.test(str)) {
    const parts = str.split(/[-\/]/);
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2];
    return `${y}-${m}-${d}`;
  }
  // DD-MMM-YYYY (e.g. 04-Sep-2026 or 4-Aug-2026)
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return null;
}

function parseTimeString(timeVal) {
  if (!timeVal) return null;
  if (timeVal instanceof Date) {
    const hh = String(timeVal.getHours()).padStart(2, '0');
    const mm = String(timeVal.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}:00`;
  }
  const num = Number(timeVal);
  // Detect Excel fractional time of day (e.g. 0.375 for 09:00)
  if (!isNaN(num) && num >= 0 && num < 1) {
    const totalSeconds = Math.round(num * 86400);
    const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const ss = String(totalSeconds % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  const str = String(timeVal).trim();
  const match = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (match) {
    let hh = parseInt(match[1]);
    const mm = match[2];
    const ss = match[3] || '00';
    const ampm = match[4]?.toLowerCase();
    if (ampm === 'pm' && hh < 12) hh += 12;
    if (ampm === 'am' && hh === 12) hh = 0;
    return `${String(hh).padStart(2, '0')}:${mm}:${ss}`;
  }
  return null;
}

function normalizeStatus(statusVal) {
  if (!statusVal) return 'present';
  const s = String(statusVal).trim().toLowerCase();
  if (['p', 'present', 'pr', 'fullday', 'full_day', 'full', 'd', 'day', 'night', 'yes'].includes(s)) return 'present';
  if (['a', 'absent', 'ab', 'no'].includes(s)) return 'absent';
  if (['hd', 'half_day', 'half day', 'half-day', 'half', 'h/d'].includes(s)) return 'half_day';
  if (['l', 'leave', 'cl', 'pl', 'sl', 'el', 'paid_leave'].includes(s)) return 'leave';
  if (['h', 'holiday', 'wo', 'week_off', 'week-off', 'weekoff', 'off'].includes(s)) return 'holiday';
  return 'present';
}

async function parseAttendanceRows(filePath, originalname) {
  const isExcel = /\.(xlsx|xls)$/i.test(originalname || '') || /\.(xlsx|xls)$/i.test(filePath || '');
  const rows = [];

  if (isExcel) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return rows;

    // Detect header row dynamically (in case row 1 is a title or empty)
    let headerRowNumber = 1;
    for (let r = 1; r <= Math.min(10, worksheet.rowCount || 10); r++) {
      const row = worksheet.getRow(r);
      let matchCount = 0;
      row.eachCell((cell) => {
        const txt = extractCellText(cell).toLowerCase();
        if (txt.includes('employee') || txt.includes('name') || txt.includes('date') || txt.includes('status') || txt.includes('emp') || txt.includes('guard') || txt.includes('check')) {
          matchCount++;
        }
      });
      if (matchCount >= 2) {
        headerRowNumber = r;
        break;
      }
    }

    const headers = [];
    const headerRow = worksheet.getRow(headerRowNumber);
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber] = extractCellText(cell).toLowerCase().replace(/[\s_-]+/g, '_');
    });

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowNumber) return;
      const rowData = {};
      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber];
        if (header) {
          let val = cell.value;
          if (val instanceof Date) {
            val = val.toISOString().split('T')[0];
          } else if (typeof val === 'object' && val !== null) {
            val = val.text || val.result || (val.richText ? val.richText.map(t => t.text).join('') : '');
          }
          rowData[header] = typeof val === 'string' ? val.trim() : val;
        }
      });
      if (Object.keys(rowData).length > 0) {
        rows.push(rowData);
      }
    });
  } else {
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => {
          const normalized = {};
          for (const k in data) {
            normalized[k.trim().toLowerCase().replace(/[\s_-]+/g, '_')] = typeof data[k] === 'string' ? data[k].trim() : data[k];
          }
          rows.push(normalized);
        })
        .on('end', resolve)
        .on('error', reject);
    });
  }
  return rows;
}

// POST /api/attendance/bulk-upload (supports both Excel .xlsx/.xls and CSV)
router.post('/bulk-upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const errors = [];
  let successCount = 0;
  const datesMarked = new Set();
  const employeesMarked = new Set();

  try {
    const rawRows = await parseAttendanceRows(req.file.path, req.file.originalname);
    
    // Fetch all employees for resilient matching across ID, normalized ID, and full name
    const employeesRes = await query('SELECT id, employee_id, full_name FROM employees');
    
    const byId = new Map();
    const byExactCode = new Map();
    const byNormCode = new Map();
    const byDigits = new Map();
    const byExactName = new Map();
    const byNormName = new Map();

    for (const emp of employeesRes.rows) {
      byId.set(String(emp.id), emp.id);
      if (emp.employee_id) {
        const c = String(emp.employee_id).trim().toLowerCase();
        byExactCode.set(c, emp.id);
        const norm = c.replace(/[^a-z0-9]/g, '');
        if (norm) byNormCode.set(norm, emp.id);
        const digits = c.replace(/\D/g, '');
        if (digits) byDigits.set(parseInt(digits, 10), emp.id);
      }
      if (emp.full_name) {
        const n = String(emp.full_name).trim().toLowerCase();
        byExactName.set(n, emp.id);
        const norm = n.replace(/\s+/g, ' ');
        byNormName.set(norm, emp.id);
      }
    }

    let lineIdx = 1;
    for (const row of rawRows) {
      lineIdx++;
      try {
        const rawId = row.employee_id || row.empid || row.emp_id || row.employee_code || row.emp_code || row.id || row.code || row.staff_id || row.employee_no || row.emp_no || row.badge_no || row.badge_number;
        const rawName = row.employee_name || row.emp_name || row.empname || row.full_name || row.name || row.guard_name || row.staff_name || row.worker_name || row.personnel_name || row.employee;

        if (!rawId && !rawName) {
          errors.push({ line: lineIdx, row, error: 'Employee ID or Name missing' });
          continue;
        }

        let matchedEmpId = null;

        // 1. Try matching by ID/code (exact, alphanumeric normalized, or numeric digits)
        if (rawId !== undefined && rawId !== null && String(rawId).trim() !== '') {
          const idStr = String(rawId).trim();
          const idLower = idStr.toLowerCase();
          const idNorm = idLower.replace(/[^a-z0-9]/g, '');
          const idDigits = idLower.replace(/\D/g, '');

          if (byId.has(idStr)) matchedEmpId = byId.get(idStr);
          else if (byExactCode.has(idLower)) matchedEmpId = byExactCode.get(idLower);
          else if (idNorm && byNormCode.has(idNorm)) matchedEmpId = byNormCode.get(idNorm);
          else if (idDigits && byDigits.has(parseInt(idDigits, 10))) matchedEmpId = byDigits.get(parseInt(idDigits, 10));
        }

        // 2. Fallback to matching by Employee Name if ID didn't match or was omitted
        if (!matchedEmpId && rawName) {
          const nameStr = String(rawName).trim().toLowerCase();
          const nameNorm = nameStr.replace(/\s+/g, ' ');
          if (byExactName.has(nameStr)) matchedEmpId = byExactName.get(nameStr);
          else if (byNormName.has(nameNorm)) matchedEmpId = byNormName.get(nameNorm);
          else {
            const cleanName = nameNorm.replace(/^(mr\.?|mrs\.?|ms\.?|shri\.?|smt\.?)\s+/i, '').trim();
            for (const [key, empId] of byNormName.entries()) {
              const cleanKey = key.replace(/^(mr\.?|mrs\.?|ms\.?|shri\.?|smt\.?)\s+/i, '').trim();
              if (cleanKey === cleanName || (cleanName.length > 4 && (cleanKey.includes(cleanName) || cleanName.includes(cleanKey)))) {
                matchedEmpId = empId;
                break;
              }
            }
          }
        }

        if (!matchedEmpId) {
          errors.push({ line: lineIdx, row, error: `Employee not found: "${rawId || rawName}"` });
          continue;
        }

        const rawDate = row.date || row.attendance_date || row.attendance_day || row.day || row.shift_date || row.duty_date;
        const attendance_date = parseDateString(rawDate);
        if (!attendance_date) {
          errors.push({ line: lineIdx, row, error: `Invalid date format: "${rawDate || ''}"` });
          continue;
        }

        const rawCheckIn = row.check_in || row.check_in_time || row.in_time || row.in || row.punch_in || row.start_time;
        const rawCheckOut = row.check_out || row.check_out_time || row.out_time || row.out || row.punch_out || row.end_time;
        const check_in_time = parseTimeString(rawCheckIn);
        const check_out_time = parseTimeString(rawCheckOut);

        const status = normalizeStatus(row.status || row.attendance_status || row.presence);
        const notes = row.notes || row.remarks || row.remark || row.shift || '';

        let hours_worked = null;
        if (check_in_time && check_out_time) {
          const [inH, inM] = check_in_time.split(':').map(Number);
          const [outH, outM] = check_out_time.split(':').map(Number);
          let diff = (outH * 60 + outM) - (inH * 60 + inM);
          if (diff < 0) diff += 24 * 60;
          hours_worked = parseFloat((diff / 60).toFixed(2));
        }

        await query(
          `INSERT INTO attendance (employee_id, attendance_date, check_in_time, check_out_time, hours_worked, status, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON DUPLICATE KEY UPDATE
             check_in_time=VALUES(check_in_time), check_out_time=VALUES(check_out_time),
             hours_worked=VALUES(hours_worked), status=VALUES(status), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP`,
          [matchedEmpId, attendance_date, check_in_time, check_out_time, hours_worked, status, notes, req.user?.userId || null]
        );

        successCount++;
        datesMarked.add(attendance_date);
        employeesMarked.add(matchedEmpId);
      } catch (err) {
        logError(err, typeof req !== 'undefined' ? req : {}, { feature: 'attendance' });
        errors.push({ line: lineIdx, row, error: err.message });
      }
    }

    const sortedDates = Array.from(datesMarked).sort();

    res.json({
      success: true,
      message: `Bulk upload completed. ${successCount} attendance record(s) processed successfully across ${datesMarked.size} date(s).${errors.length > 0 ? ` ${errors.length} row(s) had issues.` : ''}`,
      successCount,
      totalRows: rawRows.length,
      datesMarked: sortedDates,
      employeesCount: employeesMarked.size,
      errors
    });
  } catch (err) {
    logError(err, typeof req !== 'undefined' ? req : {}, { feature: 'attendance' });
    logger.error('Bulk upload processing error:', err);
    res.status(500).json({ success: false, message: 'Failed to process uploaded file: ' + err.message });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
  }
});

module.exports = router;
