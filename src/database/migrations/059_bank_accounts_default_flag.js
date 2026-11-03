/**
 * Migration 059: a per-company "default bank account" flag.
 *
 * Invoice generation already lets a user pick any bank_accounts row, but the
 * fallback used when none is picked was a hardcoded match on one specific
 * account number ('252528112019', the originally-seeded IndusInd account) —
 * meaningless for any other company/install. This adds a real is_default
 * flag so that resolution works generically, and backfills the existing
 * hardcoded account (if present) as each company's current default so
 * behavior doesn't change for installs already relying on it.
 */

async function columnExists(conn, table, column) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function up(conn) {
  if (!(await columnExists(conn, 'bank_accounts', 'is_default'))) {
    await conn.execute('ALTER TABLE bank_accounts ADD COLUMN is_default TINYINT(1) NOT NULL DEFAULT 0');
  }

  // Backfill: the legacy hardcoded account becomes each company's default
  // where it exists, so existing installs keep picking the same account.
  await conn.execute(`UPDATE bank_accounts SET is_default = 1 WHERE account_number = '252528112019'`);

  // Any company left with no default yet (no such account, or a fresh
  // signup) gets its first active bank-type account promoted automatically.
  const [companies] = await conn.execute(`
    SELECT DISTINCT ba.company_id FROM bank_accounts ba
    WHERE ba.account_type = 'bank' AND ba.is_active = 1
      AND NOT EXISTS (SELECT 1 FROM bank_accounts d WHERE d.company_id = ba.company_id AND d.is_default = 1)
  `);
  for (const { company_id } of companies) {
    const [rows] = await conn.execute(
      `SELECT id FROM bank_accounts WHERE company_id = ? AND account_type = 'bank' AND is_active = 1 ORDER BY id ASC LIMIT 1`,
      [company_id]
    );
    if (rows.length > 0) {
      await conn.execute('UPDATE bank_accounts SET is_default = 1 WHERE id = ?', [rows[0].id]);
    }
  }
}

module.exports = { up };
