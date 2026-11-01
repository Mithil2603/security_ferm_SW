/**
 * Migration 036: drop the stale expense category check constraint.
 *
 * expense_categories is a user-managed table (Settings > Expense Categories)
 * that lets admins add arbitrary categories like "Office". The expenses
 * table's chk_expense_category constraint still hardcoded the original
 * 8 categories, so any custom category failed with a check-constraint error.
 * Category values are already normalized/validated at the app layer.
 *
 * Rewritten from a raw .sql file (unconditional `DROP CHECK`) because on at
 * least one real install the constraint was already absent and the server's
 * reported error code for that case didn't match what the migration runner
 * ignores, halting the entire migration chain. Checking existence first
 * avoids depending on error-code behavior across MySQL/MariaDB versions.
 */

async function constraintExists(conn, table, name) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [table, name]
  );
  return rows.length > 0;
}

async function up(conn) {
  if (await constraintExists(conn, 'expenses', 'chk_expense_category')) {
    await conn.execute('ALTER TABLE expenses DROP CHECK chk_expense_category');
  }
}

module.exports = { up };
