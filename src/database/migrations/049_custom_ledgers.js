const logger = require('../../utils/logger.js');

/**
 * Migration 049: custom ledgers (Tally-style).
 *
 * ADDITIVE ONLY — creates two new tables, adds three nullable columns to
 * vouchers and seeds the fixed groups into the new ledger_groups table.
 * No existing row is updated or deleted, so every existing balance/report
 * stays exactly as it was.
 *
 *   ledger_groups — fixed Tally groups (Direct Expenses, Capital Account, …)
 *   ledgers       — user-created ledgers under a group (Rent, Office Expense, …)
 *   vouchers.debit_ledger_id / credit_ledger_id — a voucher side can be a ledger
 *   vouchers.party_side — which side the client/vendor party sits on
 *                         (NULL on old vouchers → legacy per-type direction)
 */
const GROUPS = [
  // name, nature, report, is_direct, sort_order
  ['Direct Expenses', 'expense', 'pl', 1, 10],
  ['Indirect Expenses', 'expense', 'pl', 0, 20],
  ['Direct Incomes', 'income', 'pl', 1, 30],
  ['Indirect Incomes', 'income', 'pl', 0, 40],
  ['Fixed Assets', 'asset', 'bs', 0, 50],
  ['Current Assets', 'asset', 'bs', 0, 60],
  ['Loans & Advances (Asset)', 'asset', 'bs', 0, 70],
  ['Deposits (Asset)', 'asset', 'bs', 0, 80],
  ['Current Liabilities', 'liability', 'bs', 0, 90],
  ['Duties & Taxes', 'liability', 'bs', 0, 100],
  ['Provisions', 'liability', 'bs', 0, 110],
  ['Loans (Liability)', 'liability', 'bs', 0, 120],
  ['Capital Account', 'capital', 'bs', 0, 130],
];

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
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS ledger_groups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      nature VARCHAR(20) NOT NULL,
      report VARCHAR(5) NOT NULL,
      is_direct TINYINT NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      CONSTRAINT chk_ledger_group_nature CHECK (nature IN ('expense','income','asset','liability','capital')),
      CONSTRAINT chk_ledger_group_report CHECK (report IN ('pl','bs'))
    )
  `);

  for (const [name, nature, report, isDirect, sort] of GROUPS) {
    await conn.execute(
      `INSERT IGNORE INTO ledger_groups (name, nature, report, is_direct, sort_order) VALUES (?, ?, ?, ?, ?)`,
      [name, nature, report, isDirect, sort]
    );
  }

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS ledgers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL UNIQUE,
      group_id INT NOT NULL,
      description TEXT,
      is_active TINYINT NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_by INT NULL,
      CONSTRAINT fk_ledgers_group FOREIGN KEY (group_id) REFERENCES ledger_groups(id)
    )
  `);

  // New nullable columns on vouchers — existing rows get NULL, nothing else changes.
  if (!(await columnExists(conn, 'vouchers', 'debit_ledger_id'))) {
    await conn.execute('ALTER TABLE vouchers ADD COLUMN debit_ledger_id INT NULL');
  }
  if (!(await columnExists(conn, 'vouchers', 'credit_ledger_id'))) {
    await conn.execute('ALTER TABLE vouchers ADD COLUMN credit_ledger_id INT NULL');
  }
  if (!(await columnExists(conn, 'vouchers', 'party_side'))) {
    await conn.execute('ALTER TABLE vouchers ADD COLUMN party_side VARCHAR(10) NULL');
  }

  const fks = [
    ['fk_vouchers_debit_ledger', 'debit_ledger_id'],
    ['fk_vouchers_credit_ledger', 'credit_ledger_id'],
  ];
  for (const [name, col] of fks) {
    if (!(await constraintExists(conn, 'vouchers', name))) {
      await conn.execute(`ALTER TABLE vouchers ADD CONSTRAINT ${name} FOREIGN KEY (${col}) REFERENCES ledgers(id)`);
    }
  }
  if (!(await constraintExists(conn, 'vouchers', 'chk_voucher_party_side'))) {
    try {
      await conn.execute(
        `ALTER TABLE vouchers ADD CONSTRAINT chk_voucher_party_side CHECK (party_side IS NULL OR party_side IN ('debit','credit'))`
      );
    } catch (err) {
      logger.warn('Could not add chk_voucher_party_side:', err.message);
    }
  }
}

module.exports = { up };
