const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requireRole, requirePermission } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);

// GET /api/statements — List all saved statements with filters + pagination
router.get('/', async (req, res) => {
  try {
    const { domain, from_date, to_date, party_name, search, page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    let conditions = ['is_archived = 0'];
    let params = [];
    let paramIdx = 1;

    if (domain) {
      conditions.push(`domain = $${paramIdx++}`);
      params.push(domain);
    }
    if (from_date) {
      conditions.push(`generated_at >= $${paramIdx++}`);
      params.push(from_date);
    }
    if (to_date) {
      conditions.push(`DATE(generated_at) <= $${paramIdx++}`);
      params.push(to_date);
    }
    if (party_name) {
      conditions.push(`party_name LIKE $${paramIdx++}`);
      params.push(`%${party_name}%`);
    }
    if (search) {
      conditions.push(`(statement_number LIKE $${paramIdx} OR title LIKE $${paramIdx+1} OR party_name LIKE $${paramIdx+2})`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      paramIdx += 3;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countResult = await query(
      `SELECT COUNT(*) as total FROM saved_statements ${whereClause}`,
      params
    );
    const total = countResult.rows[0]?.total || 0;

    // Fetch page
    const dataResult = await query(
      `SELECT id, domain, statement_number, title, reference_id, reference_type,
              total_amount, tax_amount, period_from, period_to, 
              party_name, party_id, generated_at, pdf_path
       FROM saved_statements ${whereClause}
       ORDER BY generated_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, parseInt(limit), offset]
    );

    res.json({
      success: true,
      data: dataResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'statements' });
    logger.error('List statements error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch statements' });
  }
});

// GET /api/statements/export — Export filtered statements as CSV
router.get('/export', requireRole('admin'), async (req, res) => {
  try {
    const { domain, from_date, to_date, party_name } = req.query;
    
    let conditions = ['is_archived = 0'];
    let params = [];
    let paramIdx = 1;

    if (domain) { conditions.push(`domain = $${paramIdx++}`); params.push(domain); }
    if (from_date) { conditions.push(`generated_at >= $${paramIdx++}`); params.push(from_date); }
    if (to_date) { conditions.push(`DATE(generated_at) <= $${paramIdx++}`); params.push(to_date); }
    if (party_name) { conditions.push(`party_name LIKE $${paramIdx++}`); params.push(`%${party_name}%`); }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT domain, statement_number, title, party_name, total_amount, tax_amount,
              period_from, period_to, generated_at
       FROM saved_statements ${whereClause}
       ORDER BY generated_at DESC`,
      params
    );

    // Build CSV
    const escCsv = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
    let csv = 'Domain,Statement #,Title,Party,Amount,Tax,Period From,Period To,Date\n';
    result.rows.forEach(row => {
      csv += [
        escCsv(row.domain), escCsv(row.statement_number), escCsv(row.title), escCsv(row.party_name),
        row.total_amount, row.tax_amount, escCsv(row.period_from), escCsv(row.period_to),
        escCsv(row.generated_at)
      ].join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="Statement_Archive_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'statements' });
    logger.error('Export statements error:', error);
    res.status(500).json({ success: false, message: 'Failed to export statements' });
  }
});

// GET /api/statements/domain-counts — Quick counts per domain for tab badges
router.get('/domain-counts', async (req, res) => {
  try {
    const result = await query(
      `SELECT domain, COUNT(*) as count FROM saved_statements WHERE is_archived = 0 GROUP BY domain`
    );
    const counts = {};
    result.rows.forEach(r => { counts[r.domain] = parseInt(r.count || 0); });
    res.json({ success: true, data: counts });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'statements' });
    logger.error('Domain counts error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch counts' });
  }
});

// GET /api/statements/:id — Get full statement details including JSON snapshot
router.get('/:id', requirePermission('manage_settings'), async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM saved_statements WHERE id = $1 AND is_archived = 0`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Statement not found' });
    }

    const stmt = result.rows[0];
    // Parse JSON data
    try {
      stmt.statement_data = JSON.parse(stmt.statement_data);
    } catch (e) {
    logError(e, typeof req !== 'undefined' ? req : {}, { feature: 'statements' });
      // Already an object or invalid JSON — leave as is
    }

    res.json({ success: true, data: stmt });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'statements' });
    logger.error('Get statement error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch statement' });
  }
});

// DELETE /api/statements/:id — Soft-delete (archive) a statement
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await query(
      `UPDATE saved_statements SET is_archived = 1 WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true, message: 'Statement archived' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'statements' });
    logger.error('Archive statement error:', error);
    res.status(500).json({ success: false, message: 'Failed to archive statement' });
  }
});

module.exports = router;
