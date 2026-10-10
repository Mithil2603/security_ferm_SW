const logger = require('../../utils/logger.js');

/**
 * Migration 048: new voucher types — 'salary' (Salary Account) and
 * 'petty_cash' (Petty Cash Entry).
 *
 * vouchers.voucher_type has an unnamed CHECK (from migration 009), so MySQL
 * auto-named it (usually vouchers_chk_1). Look up whichever check mentions
 * voucher_type, drop it, and re-add a named one with the wider list.
 */
const VOUCHER_TYPES = [
  'cash_payment', 'cash_receipt',
  'bank_payment', 'bank_receipt',
  'journal', 'contra',
  'debit_note', 'credit_note',
  'salary', 'petty_cash',
];

async function up(conn) {
  try {
    const [checks] = await conn.execute(
      `SELECT cc.CONSTRAINT_NAME AS name
         FROM information_schema.CHECK_CONSTRAINTS cc
         JOIN information_schema.TABLE_CONSTRAINTS tc
           ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
        WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
          AND tc.TABLE_NAME = 'vouchers'
          AND tc.CONSTRAINT_TYPE = 'CHECK'
          AND cc.CHECK_CLAUSE LIKE '%voucher_type%'`
    );
    for (const { name } of checks) {
      logger.info(`     -> Dropping voucher_type check ${name}...`);
      await conn.execute(`ALTER TABLE vouchers DROP CHECK \`${name}\``);
    }
  } catch (err) {
    logger.warn('Could not inspect/drop voucher_type check:', err.message);
  }

  const list = VOUCHER_TYPES.map((t) => `'${t}'`).join(', ');
  try {
    await conn.execute(`ALTER TABLE vouchers ADD CONSTRAINT chk_voucher_type CHECK (voucher_type IN (${list}))`);
  } catch (err) {
    // Re-running after a partial apply: the named check may already exist.
    try {
      await conn.execute('ALTER TABLE vouchers DROP CHECK chk_voucher_type');
      await conn.execute(`ALTER TABLE vouchers ADD CONSTRAINT chk_voucher_type CHECK (voucher_type IN (${list}))`);
    } catch (err2) {
      logger.warn('Could not add chk_voucher_type:', err2.message);
    }
  }
}

module.exports = { up };
