const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { logError, ERROR_SEVERITY, ERROR_CATEGORY } = require('../utils/enhancedErrorLogger');
const jwt = require('jsonwebtoken');

// POST /api/errors (Used by Frontend Error Interceptor)
router.post('/', async (req, res) => {
  try {
    const { error_type, error_message, stack_trace, endpoint, method, additional_data, severity, category } = req.body;
    
    // DC-C4: Enforce size caps
    const safeMessage = typeof error_message === 'string' ? error_message.substring(0, 500) : '';
    const safeStack = typeof stack_trace === 'string' ? stack_trace.substring(0, 10000) : '';
    const safeData = typeof additional_data === 'string' ? additional_data.substring(0, 5000) : (additional_data ? JSON.stringify(additional_data).substring(0, 5000) : '');

    // Pass the request to the enhanced error logger which handles auth tokens natively
    await logError({
      error: { message: safeMessage, stack: safeStack, name: error_type },
      req,
      severity: severity || ERROR_SEVERITY.HIGH,
      category: category || ERROR_CATEGORY.FRONTEND,
      feature: 'frontend_client',
      endpoint: endpoint,
      method: method,
      extra: additional_data
    });

    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Failed to log error to DB:', err);
    res.status(500).json({ success: false });
  }
});

// Admin endpoints protected by master passcode OR view_dev_errors permission
const masterPasscodeMiddleware = (req, res, next) => {
  const code = req.headers['x-master-passcode'];
  if (code && process.env.MASTER_PASSCODE && code === process.env.MASTER_PASSCODE) {
    return next();
  }
  
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const isAuthorized = decoded.role === 'admin' || (decoded.permissions && decoded.permissions.includes('view_dev_errors'));
      if (isAuthorized) {
        req.user = decoded;
        return next();
      }
    } catch (err) {
      const logger = require('../utils/logger');
      logger.warn('Dev console auth failure:', err.message, req.ip);
    }
  }
  return res.status(403).json({ success: false, message: 'Forbidden' });
};

router.get('/stats', masterPasscodeMiddleware, async (req, res) => { try { const result = await query(SELECT severity, COUNT(*) as count FROM error_logs WHERE is_resolved = 0 GROUP BY severity); const stats = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }; result.rows.forEach(r => { if (stats[r.severity] !== undefined) stats[r.severity] = parseInt(r.count); }); const total = await query(SELECT COUNT(*) as count FROM error_logs); res.json({ success: true, data: { ...stats, total: parseInt(total.rows[0].count) }}); } catch (e) { res.status(500).json({ success: false }); } });

// GET /api/errors
router.get('/', masterPasscodeMiddleware, async (req, res) => {
  try {
    const { is_resolved, severity, category, search, page = 1, limit = 50 } = req.query;
    let whereConditions = [];
    let params = [];
    let paramCount = 1;

    if (is_resolved && is_resolved !== 'all') {
      whereConditions.push(`e.is_resolved = $${paramCount}`);
      params.push(is_resolved === 'resolved' ? 1 : 0);
      paramCount++;
    }

    if (severity && severity !== 'all') {
      whereConditions.push(`e.severity = $${paramCount}`);
      params.push(severity);
      paramCount++;
    }

    if (category && category !== 'all') {
      whereConditions.push(`e.error_type = $${paramCount}`);
      params.push(category);
      paramCount++;
    }

    if (search) {
      whereConditions.push(`(e.error_message LIKE $${paramCount} OR e.endpoint LIKE $${paramCount + 1} OR e.feature LIKE $${paramCount + 2})`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      paramCount += 3;
    }
    
    const safeLimit = Math.min(parseInt(limit) || 50, 500);
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * safeLimit;
    
    const result = await query(
      `SELECT e.*, u.full_name as user_name
       FROM error_logs e
       LEFT JOIN users u ON e.user_id = u.id
       ${whereClause}
       ORDER BY e.created_at DESC
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...params, safeLimit, offset]
    );
    
    const countResult = await query(`SELECT COUNT(*) AS count FROM error_logs e ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: safeLimit,
        pages: Math.ceil(total / safeLimit)
      }
    });
  } catch (error) {
    console.error('Get errors error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch error logs' });
  }
});

// DELETE /api/errors/clear-resolved
router.delete('/clear-resolved', masterPasscodeMiddleware, async (req, res) => {
  try {
    if (req.query.confirm !== 'true') {
      return res.status(400).json({ success: false, message: 'Missing confirm=true param' });
    }
    
    const logger = require('../utils/logger');
    logger.info(`Resolved errors cleared by user ID: ${req.user ? req.user.userId : 'unknown'}`, { ip: req.ip });
    
    await query('DELETE FROM error_logs WHERE is_resolved = 1');
    res.json({ success: true, message: 'Resolved errors cleared' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to clear resolved errors' });
  }
});

// PATCH /api/errors/:id/resolve
router.patch('/:id/resolve', masterPasscodeMiddleware, async (req, res) => {
  try {
    const result = await query(
      `UPDATE error_logs SET is_resolved = 1, resolved_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, message: 'Error marked as resolved' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to resolve error' });
  }
});



module.exports = router;
