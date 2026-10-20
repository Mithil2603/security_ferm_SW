/**
 * Migration 050: auto-linked ledgers.
 *
 * Adds source_type / source_key to the `ledgers` table (created in 049), so a
 * ledger can be fed automatically from another module:
 *   expense_category:<category>  → expenses / purchase bills in that category
 *   payroll                      → salary (payroll)
 *   bank_entry:<kind>            → bank entries (bank charges, interest, …)
 *
 * Schema only — the linked amounts are read live from the existing tables;
 * no existing row anywhere is updated or deleted.
 */
async function columnExists(conn, table, column) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function up(conn) {
  if (!(await columnExists(conn, 'ledgers', 'source_type'))) {
    await conn.execute('ALTER TABLE ledgers ADD COLUMN source_type VARCHAR(30) NULL');
  }
  if (!(await columnExists(conn, 'ledgers', 'source_key'))) {
    await conn.execute('ALTER TABLE ledgers ADD COLUMN source_key VARCHAR(100) NULL');
  }
  const [idx] = await conn.execute(
    `SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ledgers' AND INDEX_NAME = 'uq_ledgers_source'`
  );
  if (idx.length === 0) {
    await conn.execute('CREATE UNIQUE INDEX uq_ledgers_source ON ledgers (source_type, source_key)');
  }
}

module.exports = { up };
