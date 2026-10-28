/**
 * Migration 052: add a nullable `company_id` column to every business-data
 * table. Nullable for now so the ALTER never fails on populated tables —
 * backfilled in 053, then locked to NOT NULL + FK in 054.
 *
 * Deliberately NOT scoped (stay global/shared across every company):
 *   hsn_sac_codes, professional_tax_rates, ledger_groups, system_settings,
 *   users, refresh_tokens, businesses, companies, company_settings,
 *   audit_logs, error_logs/error_summary/error_notifications, notifications,
 *   workflow_logs, financial_snapshots — cross-cutting/diagnostic/reference
 *   tables, out of scope for this pass.
 */
const SCOPED_TABLES = [
  'clients', 'invoices', 'invoice_counters', 'invoice_gst_details',
  'recurring_invoices', 'recurring_invoice_log', 'payments', 'reminder_escalations',
  'vendors', 'vendor_documents', 'recurring_expenses', 'vendor_payments',
  'purchase_orders', 'purchase_order_items',
  'expense_categories', 'expenses',
  'salary_structures', 'salary_components', 'salary_structure_components',
  'employees', 'employee_documents', 'attendance', 'payroll', 'employee_ledger',
  'salary_slips', 'salary_slip_components', 'employee_tax_declarations', 'tax_computation_log',
  'pf_accounts', 'pf_transactions', 'pf_loans', 'gratuity_accruals', 'gratuity_payouts',
  'bank_accounts', 'voucher_counters', 'vouchers', 'bank_reconciliation', 'recurring_vouchers',
  'ledgers', 'payment_transactions', 'payment_tax_details',
  'gst_configurations', 'gstr_filings',
  'budgets', 'budget_items', 'report_schedules', 'saved_statements',
  'workflow_rules', 'auto_approval_rules',
];

async function columnExists(conn, table, column) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows.length > 0;
}

async function up(conn) {
  for (const table of SCOPED_TABLES) {
    if (!(await tableExists(conn, table))) continue; // old DB missing a newer table — skip
    if (!(await columnExists(conn, table, 'company_id'))) {
      await conn.execute(`ALTER TABLE \`${table}\` ADD COLUMN company_id INT NULL`);
    }
  }
}

module.exports = { up, SCOPED_TABLES };
