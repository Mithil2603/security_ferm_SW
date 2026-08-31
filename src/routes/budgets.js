const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware } = require('../middleware/auth');
const logger = require('../utils/logger');

// 1. Create a Budget
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { entity_type, entity_id, budget_category, amount, period_start, period_end } = req.body;
    
    if (!entity_type || !amount || !period_start || !period_end) {
      return res.status(400).json({ success: false, message: 'Missing required budget fields' });
    }

    const numAmount = parseFloat(amount) || 0;
    const startYear = parseInt(String(period_start).slice(0, 4)) || new Date().getFullYear();
    const fy = `${startYear}-${String(startYear + 1).slice(2, 4)}`;
    const name = `Budget (${entity_type.toUpperCase()}) ${budget_category ? '- ' + budget_category : ''}`;

    const insertResult = await query(`
      INSERT INTO budgets (name, financial_year, entity_type, entity_id, budget_category, amount, period_start, period_end, total_expense_budget)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [name, fy, entity_type, entity_id ? parseInt(entity_id) : null, budget_category || null, numAmount, period_start, period_end, numAmount]);

    const newBudget = await query('SELECT * FROM budgets WHERE id = $1', [insertResult.insertId]);

    res.status(201).json({ success: true, data: newBudget.rows[0] || {}, message: 'Budget created successfully' });
  } catch (err) {
    logger.error('Error creating budget:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to create budget' });
  }
});

// 2. Get Budgets vs Actuals
router.get('/vs-actual', authMiddleware, async (req, res) => {
  try {
    const { entity_type, entity_id, period_start, period_end } = req.query;
    
    let budgetQuery = 'SELECT * FROM budgets WHERE 1=1';
    const params = [];
    let pIdx = 1;

    if (entity_type) {
      budgetQuery += ` AND entity_type = $${pIdx++}`;
      params.push(entity_type);
    }
    if (entity_id) {
      budgetQuery += ` AND entity_id = $${pIdx++}`;
      params.push(entity_id);
    }
    if (period_start) {
      budgetQuery += ` AND period_start >= $${pIdx++}`;
      params.push(period_start);
    }
    if (period_end) {
      budgetQuery += ` AND period_end <= $${pIdx++}`;
      params.push(period_end);
    }

    budgetQuery += ' ORDER BY id DESC';

    const budgets = await query(budgetQuery, params);

    // Calculate actuals for each budget
    for (const b of budgets.rows) {
      b.amount = parseFloat(b.amount || b.total_expense_budget || 0);

      if (!b.period_start || !b.period_end) {
        b.actual_amount = 0;
        b.variance = b.amount;
        b.percentage = 0;
        continue;
      }

      // Find vouchers that match this budget
      let actualQuery = `
        SELECT SUM(amount) as actual_amount 
        FROM vouchers 
        WHERE status = 'posted' 
        AND voucher_date >= $1 AND voucher_date <= $2
      `;
      const actualParams = [b.period_start, b.period_end];
      let aIdx = 3;

      if (b.entity_type === 'client' && b.entity_id) {
        actualQuery += ` AND party_type = 'client' AND party_id = $${aIdx++}`;
        actualParams.push(b.entity_id);
      } else if (b.entity_type === 'vendor' && b.entity_id) {
        actualQuery += ` AND party_type = 'vendor' AND party_id = $${aIdx++}`;
        actualParams.push(b.entity_id);
      }

      if (b.budget_category) {
        actualQuery += ` AND category = $${aIdx++}`;
        actualParams.push(b.budget_category);
      }

      try {
        const actuals = await query(actualQuery, actualParams);
        b.actual_amount = parseFloat(actuals.rows[0]?.actual_amount || 0);
      } catch (_) {
        b.actual_amount = 0;
      }

      b.variance = b.amount - b.actual_amount;
      b.percentage = b.amount > 0 ? (b.actual_amount / b.amount) * 100 : 0;
    }

    res.json({ success: true, data: budgets.rows });
  } catch (err) {
    logger.error('Error fetching budgets vs actuals:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to fetch budgets' });
  }
});

// 3. Delete a Budget
router.delete('/:id', authMiddleware, async (req, res, next) => {
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
