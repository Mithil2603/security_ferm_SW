/**
 * Migration 056: scope audit_logs by company.
 *
 * Found during the multi-company retrofit: audit_logs had zero tenant
 * scoping, so any admin with `manage_settings` could read every business's
 * audit trail via GET /api/audit-logs. Nullable (not every audited action —
 * login, setup — has a company context), filtered wherever present.
 */
async function columnExists(conn, table, column) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
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
  if (!(await columnExists(conn, 'audit_logs', 'company_id'))) {
    await conn.execute('ALTER TABLE audit_logs ADD COLUMN company_id INT NULL');
  }
  if (!(await constraintExists(conn, 'audit_logs', 'fk_audit_logs_company'))) {
    await conn.execute('ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_logs_company FOREIGN KEY (company_id) REFERENCES companies(id)');
  }

  // Backfill existing rows onto the same default company everything else landed on.
  const [companies] = await conn.execute('SELECT id FROM companies ORDER BY id ASC LIMIT 1');
  if (companies.length > 0) {
    await conn.execute('UPDATE audit_logs SET company_id = ? WHERE company_id IS NULL', [companies[0].id]);
  }
}

module.exports = { up };
