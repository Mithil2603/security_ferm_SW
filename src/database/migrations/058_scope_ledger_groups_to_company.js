/**
 * Migration 058: let each company manage its own ledger groups.
 *
 * ledger_groups was seeded once as a fixed, global Tally-style taxonomy
 * (Direct Expenses, Capital Account, …) shared system-wide. Now that users
 * can create/edit/delete groups, it can no longer stay global in a
 * multi-tenant app — one company's custom group (or a delete) would leak
 * into every other company. This adds a nullable company_id:
 *   company_id IS NULL → the original 13 seeded "system" groups, kept
 *                         visible to every company, never editable/deletable.
 *   company_id = N      → a group created by company N, visible and
 *                         mutable only by that company.
 */

async function columnExists(conn, table, column) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, name) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, name]
  );
  return rows.length > 0;
}

async function constraintExists(conn, table, name) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [table, name]
  );
  return rows.length > 0;
}

async function up(conn) {
  if (!(await columnExists(conn, 'ledger_groups', 'company_id'))) {
    await conn.execute('ALTER TABLE ledger_groups ADD COLUMN company_id INT NULL');
  }

  if (await indexExists(conn, 'ledger_groups', 'name')) {
    await conn.execute('ALTER TABLE ledger_groups DROP INDEX `name`');
  }
  if (!(await indexExists(conn, 'ledger_groups', 'uq_ledger_groups_company_name'))) {
    await conn.execute('CREATE UNIQUE INDEX uq_ledger_groups_company_name ON ledger_groups (company_id, name)');
  }

  if (!(await constraintExists(conn, 'ledger_groups', 'fk_ledger_groups_company'))) {
    await conn.execute('ALTER TABLE ledger_groups ADD CONSTRAINT fk_ledger_groups_company FOREIGN KEY (company_id) REFERENCES companies(id)');
  }
}

module.exports = { up };
