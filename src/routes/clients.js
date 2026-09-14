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

const uploadDir = path.join(process.cwd(), 'uploads', 'docs');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, 'DOC-' + Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

const formatDateLocal = (d) => {
  if (!d) return null;
  if (typeof d === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.substring(0, 10);
  }
  const dateObj = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return null;
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

router.use(authMiddleware);
router.use(requirePermission('manage_invoices'));

// GET /api/clients
router.get('/', async (req, res) => {
  try {
    const { search, city, is_active, page = 1, limit = 50 } = req.query;
    let whereConditions = [];
    let params = [];
    let paramCount = 1;

    if (search) {
      whereConditions.push(`(c.name LIKE $${paramCount} OR c.contact_person LIKE $${paramCount} OR c.phone LIKE $${paramCount})`);
      params.push(`%${search}%`);
      paramCount++;
    }
    if (city) {
      whereConditions.push(`c.city LIKE $${paramCount}`);
      params.push(`%${city}%`);
      paramCount++;
    }
    if (is_active !== undefined) {
      whereConditions.push(`c.is_active = $${paramCount}`);
      params.push(is_active === 'true');
      paramCount++;
    }
    if (req.query.client_type) {
      whereConditions.push(`c.client_type = $${paramCount}`);
      params.push(req.query.client_type);
      paramCount++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT c.*, 
        (SELECT COUNT(*) FROM invoices i WHERE i.client_id = c.id) as total_invoices,
        (SELECT COALESCE(SUM(i.final_amount), 0) FROM invoices i WHERE i.client_id = c.id AND i.status != 'cancelled') as total_billed,
        (SELECT COALESCE(SUM(i.payment_received), 0) FROM invoices i WHERE i.client_id = c.id) as total_paid,
        (SELECT COUNT(*) FROM employees e WHERE e.assigned_client_id = c.id AND e.is_active = 1) as assigned_guards_count,
        COALESCE(c.employee_count, 1) as employee_count
       FROM clients c 
       ${whereClause}
       ORDER BY c.created_at DESC, c.name ASC
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...params, parseInt(limit), offset]
    );

    const countResult = await query(`SELECT COUNT(*) AS count FROM clients c ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: result.rows.map(r => {
        let cats = [];
        if (r.guard_categories) {
          try {
            cats = typeof r.guard_categories === 'string' ? JSON.parse(r.guard_categories) : r.guard_categories;
          } catch (e) {
            cats = [];
          }
        }
        return {
          ...r,
          guard_categories: Array.isArray(cats) ? cats : [],
          contract_start_date: formatDateLocal(r.contract_start_date),
          contract_end_date: formatDateLocal(r.contract_end_date)
        };
      }),
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'clients' });
    logger.error('Get clients error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch clients' });
  }
});

// GET /api/clients/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT c.*, 
        (SELECT COALESCE(SUM(i.final_amount), 0) FROM invoices i WHERE i.client_id = c.id AND i.status != 'cancelled') as total_billed,
        (SELECT COALESCE(SUM(i.payment_received), 0) FROM invoices i WHERE i.client_id = c.id) as total_paid,
        (SELECT COUNT(*) FROM employees e WHERE e.assigned_client_id = c.id AND e.is_active = 1) as assigned_guards_count,
        COALESCE(c.employee_count, 1) as employee_count
       FROM clients c WHERE c.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    const cData = result.rows[0];
    let cats = [];
    if (cData.guard_categories) {
      try {
        cats = typeof cData.guard_categories === 'string' ? JSON.parse(cData.guard_categories) : cData.guard_categories;
      } catch (e) {
        cats = [];
      }
    }
    res.json({
      success: true,
      data: {
        ...cData,
        guard_categories: Array.isArray(cats) ? cats : [],
        contract_start_date: formatDateLocal(cData.contract_start_date),
        contract_end_date: formatDateLocal(cData.contract_end_date)
      }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'clients' });
    res.status(500).json({ success: false, message: 'Failed to fetch client' });
  }
});

// GET /api/clients/:id/attendance-summary — Duty days and absence deduction breakdown
router.get('/:id/attendance-summary', async (req, res) => {
  try {
    const { from_date, to_date, start_date, end_date } = req.query;
    const clientRes = await query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (clientRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    const client = clientRes.rows[0];

    const start = formatDateLocal(start_date || from_date || client.contract_start_date) || new Date().toISOString().split('T')[0];
    const end = formatDateLocal(end_date || to_date || client.contract_end_date) || new Date().toISOString().split('T')[0];
    const daysInPeriod = Math.max(1, Math.ceil((new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00')) / (1000 * 60 * 60 * 24)) + 1);

    let guards = parseInt(client.employee_count, 10) || 1;
    let totalContractedAmount = parseFloat(client.monthly_rate) || 0;

    // Check if client has guard_categories (multi-category breakdown)
    if (client.guard_categories) {
      try {
        const cats = typeof client.guard_categories === 'string' 
          ? JSON.parse(client.guard_categories) 
          : client.guard_categories;
        if (Array.isArray(cats) && cats.length > 0) {
          const catGuards = cats.reduce((s, c) => s + (parseInt(c.guards_count, 10) || 1), 0);
          if (catGuards > 0) guards = catGuards;

          const catTotal = cats.reduce((s, c) => {
            const m = parseFloat(c.monthly_rate) || 0;
            const r = parseFloat(c.rate_per_day) || 0;
            const cnt = parseInt(c.guards_count, 10) || 1;
            return s + (m > 0 ? m : (r > 0 ? r * cnt * daysInPeriod : 0));
          }, 0);
          if (catTotal > 0) totalContractedAmount = catTotal;
        }
      } catch (_) {}
    }

    if (totalContractedAmount <= 0 && client.rate_per_day > 0) {
      totalContractedAmount = parseFloat((client.rate_per_day * guards * daysInPeriod).toFixed(2));
    }

    const contractedDutyDays = guards * daysInPeriod;

    let ratePerDayPerGuard = 0;
    if (client.rate_per_day > 0) {
      ratePerDayPerGuard = parseFloat(client.rate_per_day);
    } else if (contractedDutyDays > 0 && totalContractedAmount > 0) {
      ratePerDayPerGuard = parseFloat((totalContractedAmount / contractedDutyDays).toFixed(2));
    }

    // Fetch attendance for guards assigned to this client or attendance marked with this client_id
    const attRes = await query(
      `SELECT a.status, COUNT(*) as count
       FROM attendance a
       WHERE (a.client_id = $1 OR a.employee_id IN (SELECT id FROM employees WHERE assigned_client_id = $1))
         AND a.attendance_date >= $2 AND a.attendance_date <= $3
       GROUP BY a.status`,
      [client.id, start, end]
    );

    let presentDays = 0;
    let halfDays = 0;
    let explicitAbsentDays = 0;
    let leaveDays = 0;
    let holidayDays = 0;

    attRes.rows.forEach(r => {
      const cnt = parseInt(r.count) || 0;
      if (r.status === 'present') presentDays += cnt;
      else if (r.status === 'half_day') halfDays += cnt;
      else if (r.status === 'absent') explicitAbsentDays += cnt;
      else if (r.status === 'leave' || r.status === 'on_leave') leaveDays += cnt;
      else if (r.status === 'holiday') holidayDays += cnt;
    });

    const totalRecords = presentDays + halfDays + explicitAbsentDays + leaveDays + holidayDays;

    // In Indian security service billing, by default all contracted guard days are assumed fulfilled
    // unless an explicit absence (or half day) is recorded. Unmarked/unrecorded days MUST NEVER be assumed absent!
    const totalAbsentDays = explicitAbsentDays + (halfDays * 0.5);
    const effectivePresentDays = Math.max(0, contractedDutyDays - totalAbsentDays);

    const absenceDeduction = parseFloat((totalAbsentDays * ratePerDayPerGuard).toFixed(2));
    const netBillable = Math.max(0, parseFloat((totalContractedAmount - absenceDeduction).toFixed(2)));

    res.json({
      success: true,
      data: {
        client_id: client.id,
        client_name: client.name,
        guards_count: guards,
        billing_period_start: start,
        billing_period_end: end,
        days_in_period: daysInPeriod,
        contracted_guard_days: contractedDutyDays,
        present_guard_days: effectivePresentDays,
        absent_guard_days: totalAbsentDays,
        rate_per_day_per_guard: ratePerDayPerGuard,
        total_contracted_amount: totalContractedAmount,
        absence_deduction: absenceDeduction,
        net_billable_amount: netBillable,
        has_records: totalRecords > 0
      }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'clients' });
    res.status(500).json({ success: false, message: 'Failed to fetch attendance summary' });
  }
});

// POST /api/clients/import
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const workbook = new exceljs.Workbook();
    await workbook.xlsx.readFile(filePath);
    
    const worksheet = workbook.getWorksheet(1); // Get first sheet
    if (!worksheet) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ success: false, message: 'Invalid or empty Excel file' });
    }

    let importedCount = 0;
    let skippedCount = 0;
    
    // Assume row 1 is headers. We'll read from row 2 onwards.
    // Expected Columns: Name, Address, City, Phone, Email, Monthly Rate
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // Skip headers
      
      const name = row.getCell(1).value?.toString() || '';
      const address = row.getCell(2).value?.toString() || '';
      const city = row.getCell(3).value?.toString() || '';
      const phone = row.getCell(4).value?.toString() || '';
      const email = row.getCell(5).value?.toString() || '';
      const monthly_rate = parseFloat(row.getCell(6).value) || 0;
      
      if (name && address && city && monthly_rate > 0) {
        try {
          const contract_start_date = new Date().toISOString().split('T')[0];
          
          query(
            `INSERT INTO clients (name, address, city, phone, email, monthly_rate, contract_start_date, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [name, address, city, phone, email, monthly_rate, contract_start_date, req.user.userId]
          );
          importedCount++;
        } catch (e) {
          skippedCount++;
        }
      } else {
        skippedCount++;
      }
    });

    // Cleanup the uploaded file
    fs.unlinkSync(filePath);
    
    await logAudit(req, 'clients', null, 'create', `Bulk imported ${importedCount} clients`);

    res.json({
      success: true,
      message: `Successfully imported ${importedCount} clients. Skipped ${skippedCount} invalid rows.`,
      data: { imported: importedCount, skipped: skippedCount }
    });
  } catch (error) {
    logger.error('Import error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, message: 'Failed to process the import file' });
  }
});

// POST /api/clients
router.post('/', validate(schemas.createClient), async (req, res) => {
  try {
    const { 
      name, address, city, state = 'Gujarat', postal_code, email, phone, contact_person, gst_number, 
      client_type = 'regular', monthly_rate, contract_start_date, contract_end_date, notes,
      employee_count = 1, timeline_unit = 'months', timeline_duration = 1, rate_per_day, total_timeline_amount,
      guard_categories
    } = req.body;
    
    if (!name || !address || !city) {
      return res.status(400).json({ success: false, message: 'Name, address, and city are required' });
    }

    let parsedCategories = null;
    if (guard_categories) {
      try {
        parsedCategories = typeof guard_categories === 'string' ? JSON.parse(guard_categories) : guard_categories;
      } catch (e) {
        parsedCategories = null;
      }
    }

    let guards = Math.max(1, parseInt(employee_count) || 1);
    if (Array.isArray(parsedCategories) && parsedCategories.length > 0) {
      const catGuards = parsedCategories.reduce((s, c) => s + (parseInt(c.guards_count) || 0), 0);
      if (catGuards > 0) guards = catGuards;
    }

    const finalStartDate = formatDateLocal(contract_start_date) || new Date().toISOString().split('T')[0];
    const unit = timeline_unit || 'months';
    const duration = Math.max(1, parseInt(timeline_duration) || 1);

    // Calculate contract_end_date if not provided
    let finalEndDate = formatDateLocal(contract_end_date);
    if (!finalEndDate) {
      const s = new Date(finalStartDate + 'T00:00:00');
      if (unit === 'months') {
        s.setMonth(s.getMonth() + duration);
        s.setDate(s.getDate() - 1);
      } else {
        s.setDate(s.getDate() + duration - 1);
      }
      finalEndDate = formatDateLocal(s);
    }

    const daysCount = Math.max(1, Math.ceil((new Date(finalEndDate + 'T00:00:00') - new Date(finalStartDate + 'T00:00:00')) / (1000 * 60 * 60 * 24)) + 1);

    // Two-way synchronized rate calculation
    let finalTotalAmount = 0;
    let finalRatePerDay = 0;
    let finalMonthlyRate = 0;

    if (total_timeline_amount !== undefined && total_timeline_amount !== '' && parseFloat(total_timeline_amount) > 0) {
      finalTotalAmount = parseFloat(parseFloat(total_timeline_amount).toFixed(2));
      finalRatePerDay = parseFloat((finalTotalAmount / (guards * daysCount)).toFixed(2));
      finalMonthlyRate = parseFloat(((finalTotalAmount / daysCount) * 30).toFixed(2));
    } else if (rate_per_day !== undefined && rate_per_day !== '' && parseFloat(rate_per_day) > 0) {
      finalRatePerDay = parseFloat(parseFloat(rate_per_day).toFixed(2));
      finalTotalAmount = parseFloat((finalRatePerDay * guards * daysCount).toFixed(2));
      finalMonthlyRate = parseFloat((finalRatePerDay * guards * 30).toFixed(2));
    } else if (monthly_rate !== undefined && monthly_rate !== '' && parseFloat(monthly_rate) > 0) {
      finalMonthlyRate = parseFloat(parseFloat(monthly_rate).toFixed(2));
      finalRatePerDay = parseFloat((finalMonthlyRate / (guards * 30)).toFixed(2));
      finalTotalAmount = parseFloat(((finalMonthlyRate / 30) * daysCount).toFixed(2));
    } else if (Array.isArray(parsedCategories) && parsedCategories.length > 0) {
      const catMonthly = parsedCategories.reduce((s, c) => s + ((parseInt(c.guards_count) || 1) * (parseFloat(c.monthly_rate) || 0)), 0);
      if (catMonthly > 0) {
        finalMonthlyRate = catMonthly;
        finalRatePerDay = parseFloat((finalMonthlyRate / (guards * 30)).toFixed(2));
        finalTotalAmount = parseFloat(((finalMonthlyRate / 30) * daysCount).toFixed(2));
      }
    }

    const isEvent = client_type === 'event';
    if (!isEvent && finalMonthlyRate <= 0 && finalTotalAmount <= 0 && finalRatePerDay <= 0) {
      return res.status(400).json({ success: false, message: 'Please enter a valid rate (per day, monthly, or timeline total)' });
    }

    // Check for duplicate client name
    const existingClient = await query(
      'SELECT id FROM clients WHERE name LIKE $1 AND is_active = 1 LIMIT 1',
      [name]
    );
    if (existingClient.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'A client with this exact name already exists. Please use the Edit button (pencil icon) on the existing client instead of creating a new one.' });
    }

    const result = await query(
      `INSERT INTO clients (
        name, address, city, state, postal_code, email, phone, contact_person, gst_number, client_type, 
        monthly_rate, contract_start_date, contract_end_date, notes, created_by,
        employee_count, timeline_unit, timeline_duration, rate_per_day, total_timeline_amount, addon_days, guard_categories
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,0,$21) RETURNING *`,
      [
        name, address, city, state, postal_code, email, phone, contact_person, gst_number, client_type || 'regular',
        finalMonthlyRate, finalStartDate, finalEndDate || null, notes, req.user.userId,
        guards, unit, duration, finalRatePerDay, finalTotalAmount,
        parsedCategories ? JSON.stringify(parsedCategories) : null
      ]
    );

    await logAudit(req, 'clients', result.rows[0].id, 'create', `Created client: ${name} (${guards} guards, ${finalStartDate} to ${finalEndDate})`);

    res.status(201).json({ success: true, data: result.rows[0], message: 'Client created successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'clients' });
    res.status(500).json({ success: false, message: 'Failed to create client' });
  }
});

// PUT /api/clients/:id
router.put('/:id', validate(schemas.updateClient), async (req, res) => {
  try {
    const { 
      name, address, city, state, postal_code, email, phone, contact_person, gst_number, client_type, 
      monthly_rate, contract_start_date, contract_end_date, notes, is_active,
      employee_count, timeline_unit, timeline_duration, rate_per_day, total_timeline_amount,
      addon_days, guard_categories
    } = req.body;

    const existingRes = await query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    const existing = existingRes.rows[0];

    let parsedCategories = undefined;
    if (guard_categories !== undefined) {
      try {
        parsedCategories = typeof guard_categories === 'string' ? JSON.parse(guard_categories) : guard_categories;
      } catch (e) {
        parsedCategories = null;
      }
    }

    const isActiveBool = is_active !== undefined ? Boolean(is_active) : Boolean(existing.is_active);
    let guards = employee_count !== undefined ? Math.max(1, parseInt(employee_count) || 1) : (existing.employee_count || 1);
    if (Array.isArray(parsedCategories) && parsedCategories.length > 0) {
      const catGuards = parsedCategories.reduce((s, c) => s + (parseInt(c.guards_count) || 0), 0);
      if (catGuards > 0) guards = catGuards;
    }

    const finalStartDate = formatDateLocal(contract_start_date || existing.contract_start_date) || new Date().toISOString().split('T')[0];
    const unit = timeline_unit || existing.timeline_unit || 'months';
    const duration = timeline_duration !== undefined ? Math.max(1, parseInt(timeline_duration) || 1) : (existing.timeline_duration || 1);

    let finalEndDate = formatDateLocal(contract_end_date || existing.contract_end_date);
    let newAddonDays = existing.addon_days || 0;
    const additionalDays = parseInt(addon_days) || 0;

    // Handle "Add on (days)" extension
    if (additionalDays > 0) {
      const baseEndDateStr = finalEndDate || finalStartDate;
      const endD = new Date(baseEndDateStr + 'T00:00:00');
      endD.setDate(endD.getDate() + additionalDays);
      finalEndDate = formatDateLocal(endD);
      newAddonDays += additionalDays;
    }

    const daysCount = Math.max(1, Math.ceil((new Date((finalEndDate || finalStartDate) + 'T00:00:00') - new Date(finalStartDate + 'T00:00:00')) / (1000 * 60 * 60 * 24)) + 1);

    // Two-way calculation updates
    let finalTotalAmount = existing.total_timeline_amount || 0;
    let finalRatePerDay = existing.rate_per_day || 0;
    let finalMonthlyRate = existing.monthly_rate || 0;

    if (total_timeline_amount !== undefined && total_timeline_amount !== '' && parseFloat(total_timeline_amount) > 0) {
      finalTotalAmount = parseFloat(parseFloat(total_timeline_amount).toFixed(2));
      finalRatePerDay = parseFloat((finalTotalAmount / (guards * daysCount)).toFixed(2));
      finalMonthlyRate = parseFloat(((finalTotalAmount / daysCount) * 30).toFixed(2));
    } else if (rate_per_day !== undefined && rate_per_day !== '' && parseFloat(rate_per_day) > 0) {
      finalRatePerDay = parseFloat(parseFloat(rate_per_day).toFixed(2));
      finalTotalAmount = parseFloat((finalRatePerDay * guards * daysCount).toFixed(2));
      finalMonthlyRate = parseFloat((finalRatePerDay * guards * 30).toFixed(2));
    } else if (monthly_rate !== undefined && monthly_rate !== '' && parseFloat(monthly_rate) > 0) {
      finalMonthlyRate = parseFloat(parseFloat(monthly_rate).toFixed(2));
      finalRatePerDay = parseFloat((finalMonthlyRate / (guards * 30)).toFixed(2));
      finalTotalAmount = parseFloat(((finalMonthlyRate / 30) * daysCount).toFixed(2));
    } else if (Array.isArray(parsedCategories) && parsedCategories.length > 0) {
      const catMonthly = parsedCategories.reduce((s, c) => s + ((parseInt(c.guards_count) || 1) * (parseFloat(c.monthly_rate) || 0)), 0);
      if (catMonthly > 0) {
        finalMonthlyRate = catMonthly;
        finalRatePerDay = parseFloat((finalMonthlyRate / (guards * 30)).toFixed(2));
        finalTotalAmount = parseFloat(((finalMonthlyRate / 30) * daysCount).toFixed(2));
      }
    } else if (additionalDays > 0 && finalRatePerDay > 0) {
      // If add-on days were added, add incremental cost to total
      const addCost = parseFloat((additionalDays * guards * finalRatePerDay).toFixed(2));
      finalTotalAmount += addCost;
    }

    const guardCatsJson = parsedCategories !== undefined ? (parsedCategories ? JSON.stringify(parsedCategories) : null) : undefined;

    await query(
      `UPDATE clients SET 
        name=$1, address=$2, city=$3, state=$4, postal_code=$5, email=$6, phone=$7, contact_person=$8, 
        gst_number=$9, client_type=COALESCE($10, client_type), monthly_rate=$11, contract_start_date=$12, contract_end_date=$13, 
        notes=$14, is_active=$15, employee_count=$16, timeline_unit=$17, timeline_duration=$18, rate_per_day=$19, 
        total_timeline_amount=$20, addon_days=$21, 
        guard_categories=CASE WHEN $22 IS NOT NULL THEN $22 ELSE guard_categories END,
        updated_at=CURRENT_TIMESTAMP
       WHERE id=$23`,
      [
        name || existing.name, address || existing.address, city || existing.city, state || existing.state, postal_code || existing.postal_code,
        email !== undefined ? email : existing.email, phone !== undefined ? phone : existing.phone,
        contact_person !== undefined ? contact_person : existing.contact_person, gst_number !== undefined ? gst_number : existing.gst_number,
        client_type || existing.client_type, finalMonthlyRate, finalStartDate, finalEndDate || null,
        notes !== undefined ? notes : existing.notes, isActiveBool, guards, unit, duration,
        finalRatePerDay, finalTotalAmount, newAddonDays, guardCatsJson !== undefined ? guardCatsJson : null, req.params.id
      ]
    );

    const updated = await query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    await logAudit(req, 'clients', req.params.id, 'update', `Updated client: ${name || existing.name}${additionalDays > 0 ? ` (+${additionalDays} add-on days)` : ''}`);

    const updatedRow = updated.rows[0];
    let resCats = [];
    if (updatedRow.guard_categories) {
      try {
        resCats = typeof updatedRow.guard_categories === 'string' ? JSON.parse(updatedRow.guard_categories) : updatedRow.guard_categories;
      } catch (e) {
        resCats = [];
      }
    }

    res.json({ 
      success: true, 
      data: {
        ...updatedRow,
        guard_categories: Array.isArray(resCats) ? resCats : [],
        contract_start_date: formatDateLocal(updatedRow.contract_start_date),
        contract_end_date: formatDateLocal(updatedRow.contract_end_date)
      }, 
      message: 'Client updated successfully' 
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'clients' });
    logger.error('Update client error:', error);
    res.status(500).json({ success: false, message: 'Failed to update client' });
  }
});

// DELETE /api/clients/:id (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const result = await query(
      'UPDATE clients SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    
    await logAudit(req, 'clients', req.params.id, 'update', 'Deactivated client');
    
    res.json({ success: true, message: 'Client deactivated successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'clients' });
    res.status(500).json({ success: false, message: 'Failed to deactivate client' });
  }
});

// PATCH /api/clients/:id/reactivate (re-enable a soft-deleted client)
router.patch('/:id/reactivate', async (req, res) => {
  try {
    const result = await query(
      'UPDATE clients SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    await logAudit(req, 'clients', req.params.id, 'update', 'Reactivated client');

    res.json({ success: true, message: 'Client reactivated successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'clients' });
    res.status(500).json({ success: false, message: 'Failed to reactivate client' });
  }
});

// DELETE /api/clients/:id/hard (hard delete)
router.delete('/:id/hard', async (req, res) => {
  try {
    const result = await query('DELETE FROM clients WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    
    await logAudit(req, 'clients', req.params.id, 'delete', 'Permanently deleted client');
    
    res.json({ success: true, message: 'Client permanently deleted' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'clients' });
    if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || (error.message && error.message.includes('FOREIGN KEY'))) {
      return res.status(400).json({ success: false, message: 'Cannot delete client: linked invoices or employees exist. Please delete or reassign them first.' });
    }
    res.status(500).json({ success: false, message: 'Failed to permanently delete client' });
  }
});

// PATCH /api/clients/:id/renew
router.patch('/:id/renew', async (req, res) => {
  try {
    // Accept both naming conventions for safety
    const contract_end_date = req.body.contract_end_date || req.body.new_end_date;
    const monthly_rate = req.body.monthly_rate || req.body.new_monthly_rate;

    if (!contract_end_date) {
      return res.status(400).json({ success: false, message: 'contract_end_date is required' });
    }
    if (new Date(contract_end_date) <= new Date()) {
      return res.status(400).json({ success: false, message: 'New contract end date must be in the future.' });
    }
    const updates = ['contract_end_date = $1', 'updated_at = CURRENT_TIMESTAMP'];
    const params = [contract_end_date];
    if (monthly_rate) {
      updates.push(`monthly_rate = $${params.length + 1}`);
      params.push(monthly_rate);
    }
    params.push(req.params.id);
    const result = await query(
      `UPDATE clients SET ${updates.join(', ')} WHERE id = $${params.length}`,
      params
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    const updated = await query('SELECT id, name, contract_end_date, monthly_rate FROM clients WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Contract renewed successfully', data: updated.rows[0] });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'clients' });
    logger.error('Contract renewal error:', error);
    res.status(500).json({ success: false, message: 'Failed to renew contract' });
  }
});
// GET /api/clients/:id/statement
router.get('/:id/statement', async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    
    // Fetch client details
    const clientRes = await query('SELECT name, address, city, phone, email, monthly_rate FROM clients WHERE id = $1', [req.params.id]);
    if (clientRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    let dateWhere = '';
    let params = [req.params.id];
    let pc = 2;
    if (from_date && to_date) {
      dateWhere = `AND date >= date($${pc}) AND date <= date($${pc+1})`;
      params.push(from_date, to_date);
    }

    // Use a UNION query to get both invoices (debits) and payments (credits)
    // For invoices we use invoice_date, for payments we use payment_date
    const statementQuery = `
      WITH statement_data AS (
        SELECT id as ref_id, invoice_number as reference, invoice_date as date, 'Invoice' as type, final_amount as debit, 0 as credit
        FROM invoices WHERE client_id = $1 AND status != 'cancelled'
        UNION ALL
        SELECT p.id as ref_id, p.transaction_reference as reference, p.payment_date as date, 'Payment' as type, 0 as debit, p.amount_paid as credit
        FROM payments p JOIN invoices i ON p.invoice_id = i.id WHERE i.client_id = $1
      )
      SELECT * FROM statement_data
      WHERE 1=1 ${dateWhere}
      ORDER BY date ASC, type DESC
    `;

    const result = await query(statementQuery, params);

    // Calculate running balance
    let balance = 0;
    const transactions = result.rows.map(row => {
      balance += (parseFloat(row.debit) - parseFloat(row.credit));
      return {
        ...row,
        debit: parseFloat(row.debit),
        credit: parseFloat(row.credit),
        balance: parseFloat(balance.toFixed(2))
      };
    });

    res.json({ 
      success: true, 
      data: {
        client: clientRes.rows[0],
        period: { from: from_date, to: to_date },
        transactions,
        final_balance: parseFloat(balance.toFixed(2))
      } 
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'clients' });
    logger.error('Statement error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate statement' });
  }
});

module.exports = router;
