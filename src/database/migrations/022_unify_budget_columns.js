const logger = require('../../utils/logger.js');

/**
 * Migration 022: Unify budget columns for entity budgets and ERP reporting.
 */
async function up(conn) {
  const database = process.env.DB_NAME || 'security_firm_db';

  async function columnExists(table, column) {
    const [rows] = await conn.execute(
      `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [database, table, column]
    );
    return rows[0].cnt > 0;
  }

  const budgetColumns = [
    { name: 'entity_type',     definition: "VARCHAR(50) DEFAULT 'internal'" },
    { name: 'entity_id',       definition: 'INT NULL' },
    { name: 'budget_category', definition: 'VARCHAR(100) NULL' },
    { name: 'amount',          definition: 'DECIMAL(14,2) DEFAULT 0' },
    { name: 'period_start',    definition: 'DATE NULL' },
    { name: 'period_end',      definition: 'DATE NULL' },
  ];

  for (const col of budgetColumns) {
    if (!(await columnExists('budgets', col.name))) {
      logger.info(`     -> Adding column "${col.name}" to budgets...`);
      await conn.execute(`ALTER TABLE budgets ADD COLUMN ${col.name} ${col.definition}`);
    }
  }

  try {
    await conn.execute("ALTER TABLE budgets MODIFY COLUMN name VARCHAR(100) NULL DEFAULT 'General Budget'");
    await conn.execute("ALTER TABLE budgets MODIFY COLUMN financial_year VARCHAR(9) NULL DEFAULT '2026-27'");
  } catch (err) {
    logger.warn('Could not modify column defaults on budgets:', err.message);
  }
}

module.exports = { up };
