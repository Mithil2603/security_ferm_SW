const logger = require('../../utils/logger.js');
/**
 * Migration 011: Fix missing GST tax columns in invoices & permissions in users.
 * Rewritten for MySQL — uses INFORMATION_SCHEMA instead of SQLite PRAGMA.
 */
async function up(conn) {
  const database = process.env.DB_NAME || 'security_firm_db';

  // Helper: check if a column exists in a table
  async function columnExists(table, column) {
    const [rows] = await conn.execute(
      `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [database, table, column]
    );
    return rows[0].cnt > 0;
  }

  // Add missing columns to invoices
  const invoiceColumns = [
    { name: 'tax_type',          definition: "VARCHAR(20) DEFAULT 'none'" },
    { name: 'cgst_amount',       definition: 'DOUBLE DEFAULT 0' },
    { name: 'sgst_amount',       definition: 'DOUBLE DEFAULT 0' },
    { name: 'igst_amount',       definition: 'DOUBLE DEFAULT 0' },
    { name: 'is_rcm_applicable', definition: 'TINYINT(1) DEFAULT 0' },
    { name: 'duty_days_worked',  definition: 'INT' },
    { name: 'is_ad_hoc',         definition: 'TINYINT(1) DEFAULT 0' },
  ];

  for (const col of invoiceColumns) {
    if (!(await columnExists('invoices', col.name))) {
      logger.info(`     -> Adding column "${col.name}" to invoices...`);
      await conn.execute(`ALTER TABLE invoices ADD COLUMN ${col.name} ${col.definition}`);
    }
  }

  // Add permissions column to users if missing
  if (!(await columnExists('users', 'permissions'))) {
    logger.info('     -> Adding column "permissions" to users...');
    await conn.execute('ALTER TABLE users ADD COLUMN permissions TEXT');
  }
}

module.exports = { up };
