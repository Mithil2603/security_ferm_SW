/**
 * Migration 053: backfill company_id = 1 (the company seeded in 051 from the
 * pre-existing single-company data) on every row that doesn't have one yet.
 * Safe to run on a brand-new install too — SCOPED_TABLES are all empty there.
 */
const { SCOPED_TABLES } = require('./052_add_company_id_columns');

async function tableExists(conn, table) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows.length > 0;
}

async function up(conn) {
  const [companies] = await conn.execute('SELECT id FROM companies ORDER BY id ASC LIMIT 1');
  if (companies.length === 0) return; // nothing to backfill onto (shouldn't happen post-051)
  const defaultCompanyId = companies[0].id;

  for (const table of SCOPED_TABLES) {
    if (!(await tableExists(conn, table))) continue;
    await conn.execute(
      `UPDATE \`${table}\` SET company_id = ? WHERE company_id IS NULL`,
      [defaultCompanyId]
    );
  }
}

module.exports = { up };
