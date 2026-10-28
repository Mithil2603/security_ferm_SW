/**
 * Migration 055: rescope the unique constraints that used to be global
 * singletons so they're unique per-company instead of unique system-wide.
 *
 * Exact pre-existing index names (confirmed live against the dev DB before
 * writing this migration — several were MySQL's auto-generated single-column
 * names, not custom ones):
 *   invoice_counters   PRIMARY KEY (fiscal_year)                — single-column PK
 *   voucher_counters   UNIQUE INDEX `voucher_type` (voucher_type, financial_year)
 *   employees          UNIQUE INDEX `employee_id` (employee_id)
 *   vendors            UNIQUE INDEX `uq_vendors_code` (vendor_code)
 *   ledgers            UNIQUE INDEX `name` (name)
 *   ledgers            UNIQUE INDEX `uq_ledgers_source` (source_type, source_key)
 *   expense_categories UNIQUE INDEX `name` (name)
 *   gst_configurations no existing unique constraint
 */

async function indexExists(conn, table, name) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, name]
  );
  return rows.length > 0;
}

async function primaryKeyColumnCount(conn, table) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) as cnt FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'`,
    [table]
  );
  return rows[0].cnt;
}

async function dropIndexIfExists(conn, table, name) {
  if (await indexExists(conn, table, name)) {
    await conn.execute(`ALTER TABLE \`${table}\` DROP INDEX \`${name}\``);
  }
}

async function addUniqueIfMissing(conn, table, name, columns) {
  if (!(await indexExists(conn, table, name))) {
    await conn.execute(`CREATE UNIQUE INDEX \`${name}\` ON \`${table}\` (${columns})`);
  }
}

async function up(conn) {
  // invoice_counters: fiscal_year alone → (company_id, fiscal_year)
  if ((await primaryKeyColumnCount(conn, 'invoice_counters')) < 2) {
    await conn.execute('ALTER TABLE invoice_counters DROP PRIMARY KEY, ADD PRIMARY KEY (company_id, fiscal_year)');
  }

  // voucher_counters: (voucher_type, financial_year) → (company_id, voucher_type, financial_year)
  await dropIndexIfExists(conn, 'voucher_counters', 'voucher_type');
  await addUniqueIfMissing(conn, 'voucher_counters', 'uq_voucher_counters_company', 'company_id, voucher_type, financial_year');

  // employees: employee_id alone → (company_id, employee_id)
  await dropIndexIfExists(conn, 'employees', 'employee_id');
  await addUniqueIfMissing(conn, 'employees', 'uq_employees_company_empid', 'company_id, employee_id');

  // vendors: vendor_code alone → (company_id, vendor_code)
  await dropIndexIfExists(conn, 'vendors', 'uq_vendors_code');
  await addUniqueIfMissing(conn, 'vendors', 'uq_vendors_company_code', 'company_id, vendor_code');

  // ledgers: name alone → (company_id, name)
  await dropIndexIfExists(conn, 'ledgers', 'name');
  await addUniqueIfMissing(conn, 'ledgers', 'uq_ledgers_company_name', 'company_id, name');

  // ledgers: (source_type, source_key) → (company_id, source_type, source_key)
  await dropIndexIfExists(conn, 'ledgers', 'uq_ledgers_source');
  await addUniqueIfMissing(conn, 'ledgers', 'uq_ledgers_company_source', 'company_id, source_type, source_key');

  // expense_categories: name alone → (company_id, name)
  await dropIndexIfExists(conn, 'expense_categories', 'name');
  await addUniqueIfMissing(conn, 'expense_categories', 'uq_expense_categories_company_name', 'company_id, name');

  // gst_configurations: no prior unique — one config per company per FY
  await addUniqueIfMissing(conn, 'gst_configurations', 'uq_gst_configurations_company_fy', 'company_id, financial_year');
}

module.exports = { up };
