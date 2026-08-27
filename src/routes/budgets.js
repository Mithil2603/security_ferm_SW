const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const logger = require('../utils/logger');

// 1. Create a Budget
// C1: Permission check
router.post('/', authMiddleware, requirePermission('manage_budgets'), async (req, res, next) => {
  try {
    const { entity_type, entity_id, budget_category, amount, period_start, period_end } = req.body;
    
    // C5: Amount validation
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Budget amount must be a positive number' });
    }

    if (!entity_type || !period_start || !period_end) {
      return res.status(400).json({ success: false, message: 'Missing required budget fields' });
    }

    // C4: Date validation
    if (new Date(period_start) > new Date(period_end)) {
      return res.status(400).json({ success: false, message: 'Start date must be before end date' });
    }
    
    // C6: entity_id parsing
    const parsedEntityId = entity_id ? parseInt(entity_id) : null;
    if (entity_id && isNaN(parsedEntityId)) {
      return res.status(400).json({ success: false, message: 'Invalid entity ID' });
    }

    // H7: Duplicate budget check
    const existing = await query(`
      SELECT id FROM budgets 
      WHERE entity_type = $1 AND (entity_id = $2 OR (entity_id IS NULL AND $2 IS NULL))
        AND (budget_category = $3 OR (budget_category IS NULL AND $3 IS NULL))
        AND period_start = $4 AND period_end = $5
    `, [entity_type, parsedEntityId, budget_category || null, period_start, period_end]);
    
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'Identical budget already exists for this period' });
    }

    const insertResult = await query(`
      INSERT INTO budgets (entity_type, entity_id, budget_category, amount, period_start, period_end)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [entity_type, parsedEntityId, budget_category || null, parsedAmount, period_start, period_end]);

    const newId = insertResult.insertId;
    if (!newId) return res.status(201).json({ success: true, message: 'Budget created successfully' });

    const newBudget = await query('SELECT * FROM budgets WHERE id = $1', [newId]);

    // H2: Check if retrieve failed
    if (newBudget.rows.length === 0) {
      return res.status(500).json({ success: false, message: 'Budget created but could not be retrieved' });
    }

    res.status(201).json({ success: true, data: newBudget.rows[0], message: 'Budget created successfully' });
  } catch (err) {
    logger.error('Error creating budget:', err);
    next(err);
  }
});

// 2. Get Budgets vs Actuals
router.get('/vs-actual', authMiddleware, requirePermission('view_budgets'), async (req, res, next) => {
  try {
    const { entity_type, entity_id, period_start, period_end } = req.query;
    
    // M1: Query building
    const conditions = [];
    const params = [];

    if (entity_type) {
      params.push(entity_type);
      conditions.push(`b.entity_type = $${params.length}`);
    }
    if (entity_id) {
      params.push(entity_id);
      conditions.push(`b.entity_id = $${params.length}`);
    }
    if (period_start) {
      params.push(period_start);
      conditions.push(`b.period_start >= $${params.length}`);
    }
    if (period_end) {
      params.push(period_end);
      conditions.push(`b.period_end <= $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // C2: N+1 query problem fix
    // M3: LOWER(category)
    // M5: internal budgets handling
    // L4: Sorting
    const budgetQuery = `
      SELECT b.*,
        COALESCE(SUM(v.amount), 0) as actual_amount
      FROM budgets b
      LEFT JOIN vouchers v ON v.status = 'posted'
        AND DATE(v.voucher_date) >= DATE(b.period_start)
        AND DATE(v.voucher_date) <= DATE(b.period_end)
        AND (
          (b.entity_type IN ('client', 'vendor') AND v.party_type = b.entity_type AND v.party_id = b.entity_id)
          OR (b.entity_type = 'internal' AND (v.party_id IS NULL OR v.party_type = 'internal'))
        )
        AND (b.budget_category IS NULL OR b.budget_category = '' OR LOWER(v.category) = LOWER(b.budget_category))
      ${whereClause}
      GROUP BY b.id
      ORDER BY b.period_start DESC, b.entity_type ASC
    `;

    const budgets = await query(budgetQuery, params);

    // L8: Round percentage
    for (const b of budgets.rows) {
      b.actual_amount = parseFloat(b.actual_amount) || 0;
      b.amount = parseFloat(b.amount) || 0;
      b.variance = b.amount - b.actual_amount;
      b.percentage = b.amount > 0 ? Math.round((b.actual_amount / b.amount) * 1000) / 10 : 0;
    }

    res.json({ success: true, data: budgets.rows });
  } catch (err) {
    logger.error('Error fetching budgets vs actuals:', err);
    next(err);
  }
});

// 3. Delete a Budget
router.delete('/:id', authMiddleware, requirePermission('manage_budgets'), async (req, res, next) => {
  try {
    const result = await query('DELETE FROM budgets WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Budget not found' });
    }
    res.json({ success: true, message: 'Budget deleted successfully' });
  } catch (err) {
    logger.error('Error deleting budget:', err);
    next(err);
  }
});

module.exports = router;
