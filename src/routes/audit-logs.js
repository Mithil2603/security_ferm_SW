const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission, requireCompanyContext } = require('../middleware/auth');
const logger = require('../utils/logger');
const { logError, ERROR_SEVERITY, ERROR_CATEGORY } = require('../utils/enhancedErrorLogger');

router.use(authMiddleware);
router.use(requireCompanyContext);
router.use(requirePermission('manage_settings')); // Only admins/settings managers can view audit logs

// GET /api/audit-logs
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, action, table_name } = req.query;

    // Rows written before company scoping existed (or logged outside any
    // company context, e.g. login) have company_id NULL — still only ever
    // show the caller's own company's rows plus those, never another company's.
    let whereConditions = ['(a.company_id = $1 OR a.company_id IS NULL)'];
    let params = [req.companyId];
    let paramCount = 2;

    if (action) {
      whereConditions.push(`a.action = $${paramCount}`);
      params.push(action);
      paramCount++;
    }

    if (table_name) {
      whereConditions.push(`a.table_name = $${paramCount}`);
      params.push(table_name);
      paramCount++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Fetch the logs and join with users to get the user's name
    const result = await query(
      `SELECT a.*, u.full_name as user_name, u.email as user_email
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...params, parseInt(limit), offset]
    );

    const countResult = await query(`SELECT COUNT(*) AS count FROM audit_logs a ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    logError({
      error,
      req,
      severity: ERROR_SEVERITY.HIGH,
      category: ERROR_CATEGORY.SECURITY,
      feature: 'audit-logs-fetch',
      extra: { query: req.query }
    });
    res.status(500).json({ success: false, message: 'Failed to fetch audit logs' });
  }
});

module.exports = router;
