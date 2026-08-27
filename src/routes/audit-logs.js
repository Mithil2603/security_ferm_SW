const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const logger = require('../utils/logger');
const { logError, ERROR_SEVERITY, ERROR_CATEGORY } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requirePermission('manage_settings')); // Only admins/settings managers can view audit logs
router.use((req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Admins only' });
  }
  next();
});

// GET /api/audit-logs/meta
router.get('/meta', async (req, res) => {
  try {
    const result = await query('SELECT DISTINCT table_name FROM audit_logs WHERE table_name IS NOT NULL');
    res.json({ success: true, data: result.rows.map(r => r.table_name) });
  } catch (error) {
    logError(error, req, { severity: ERROR_SEVERITY.HIGH, category: ERROR_CATEGORY.SECURITY, feature: 'audit-logs-meta' });
    res.status(500).json({ success: false, message: 'Failed to fetch meta' });
  }
});

// GET /api/audit-logs/export
router.get('/export', async (req, res) => {
  try {
    const { action, table_name, date_from, date_to } = req.query;
    let whereConditions = [];
    let params = [];

    if (action && !/^[a-zA-Z0-9_]+$/.test(action)) return res.status(400).json({ success: false, message: 'Invalid action format' });
    if (table_name && !/^[a-zA-Z0-9_]+$/.test(table_name)) return res.status(400).json({ success: false, message: 'Invalid table_name format' });

    if (action) { whereConditions.push(`a.action = $${params.length + 1}`); params.push(action); }
    if (table_name) { whereConditions.push(`a.table_name = $${params.length + 1}`); params.push(table_name); }
    if (date_from) { whereConditions.push(`a.created_at >= $${params.length + 1}`); params.push(date_from); }
    if (date_to) { whereConditions.push(`a.created_at <= $${params.length + 1}`); params.push(date_to + ' 23:59:59'); }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const result = await query(
      `SELECT a.*, u.full_name as user_name, u.email as user_email
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       ${whereClause}
       ORDER BY a.created_at DESC`,
      params
    );

    let csvContent = 'ID,User,Action,Table,Record ID,Description,IP Address,Created At\n';
    result.rows.forEach(r => {
      const ip = r.ip_address ? r.ip_address.replace(/\d+\.\d+$/, 'x.x') : 'N/A';
      const desc = r.description ? `"${r.description.replace(/"/g, '""')}"` : 'N/A';
      csvContent += `${r.id},${r.user_name || 'System'},${r.action},${r.table_name},${r.record_id},${desc},${ip},${r.created_at}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit_logs.csv"');
    res.send(csvContent);
  } catch (error) {
    logError(error, req, { severity: ERROR_SEVERITY.HIGH, category: ERROR_CATEGORY.SECURITY, feature: 'audit-logs-export' });
    res.status(500).json({ success: false, message: 'Failed to export logs' });
  }
});

// DELETE /api/audit-logs/archive
router.delete('/archive', async (req, res) => {
  try {
    const { days = 90 } = req.body;
    if (isNaN(parseInt(days))) return res.status(400).json({ success: false, message: 'Invalid days parameter' });
    
    await query(`DELETE FROM audit_logs WHERE created_at < datetime('now', '-${parseInt(days)} days')`);
    res.json({ success: true, message: `Logs older than ${days} days deleted.` });
  } catch (error) {
    logError(error, req, { severity: ERROR_SEVERITY.HIGH, category: ERROR_CATEGORY.SECURITY, feature: 'audit-logs-archive' });
    res.status(500).json({ success: false, message: 'Failed to archive logs' });
  }
});

// GET /api/audit-logs
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, action, table_name, date_from, date_to } = req.query;
    
    if (action && !/^[a-zA-Z0-9_]+$/.test(action)) return res.status(400).json({ success: false, message: 'Invalid action format' });
    if (table_name && !/^[a-zA-Z0-9_]+$/.test(table_name)) return res.status(400).json({ success: false, message: 'Invalid table_name format' });

    const safeLimit = Math.min(parseInt(limit) || 50, 200);
    
    let whereConditions = [];
    let params = [];

    if (action) {
      whereConditions.push(`a.action = $${params.length + 1}`);
      params.push(action);
    }

    if (table_name) {
      whereConditions.push(`a.table_name = $${params.length + 1}`);
      params.push(table_name);
    }

    if (date_from) {
      whereConditions.push(`a.created_at >= $${params.length + 1}`);
      params.push(date_from);
    }
    
    if (date_to) {
      whereConditions.push(`a.created_at <= $${params.length + 1}`);
      params.push(date_to + ' 23:59:59');
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * safeLimit;

    // Fetch the logs and join with users to get the user's name
    const result = await query(
      `SELECT a.*, u.full_name as user_name, u.email as user_email
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, safeLimit, offset]
    );

    const maskedRows = result.rows.map(row => {
      if (row.ip_address) {
        row.ip_address = row.ip_address.replace(/\d+\.\d+$/, 'x.x');
      }
      return row;
    });

    const countResult = await query(`SELECT COUNT(*) AS count FROM audit_logs a ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: maskedRows,
      pagination: {
        total,
        page: parseInt(page),
        limit: safeLimit,
        pages: Math.ceil(total / safeLimit)
      }
    });
  } catch (error) {
    logError(error, req, {
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.SECURITY,
      feature: 'audit-logs-fetch',
      extra: { query: req.query }
    });
    res.status(500).json({ success: false, message: 'Failed to fetch audit logs' });
  }
});

module.exports = router;
