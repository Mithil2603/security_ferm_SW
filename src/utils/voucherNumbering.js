const { query } = require('../database/connection');

// Shared with src/routes/vouchers.js and src/services/payments/paymentTransactionService.js
// so voucher numbering never drifts between manually-created and payment-module-created vouchers.
const VOUCHER_PREFIXES = {
  cash_payment: 'CP',
  cash_receipt: 'CR',
  bank_payment: 'BP',
  bank_receipt: 'BR',
  journal: 'JV',
  contra: 'CT',
  debit_note: 'DN',
  credit_note: 'CN',
  salary: 'SA',       // Salary Account
  petty_cash: 'PC',   // Petty Cash Entry
  // Common aliases
  payment: 'BP',      // alias for bank_payment
  receipt: 'BR',      // alias for bank_receipt
};

const VOUCHER_TYPE_LABELS = {
  cash_payment: 'Cash Payment',
  cash_receipt: 'Cash Receipt',
  bank_payment: 'Bank Payment',
  bank_receipt: 'Bank Receipt',
  journal: 'Journal Entry',
  contra: 'Contra',
  debit_note: 'Debit Note',
  credit_note: 'Credit Note',
  salary: 'Salary Account',
  petty_cash: 'Petty Cash Entry'
};

function getFinancialYear(dateStr) {
  const d = new Date(dateStr);
  const month = d.getMonth(); // 0-indexed
  const year = d.getFullYear();
  if (month >= 3) {
    return `${year}-${String(year + 1).slice(2)}`;
  }
  return `${year - 1}-${String(year).slice(2)}`;
}

async function getNextVoucherNumber(voucherType, voucherDate) {
  const fy = getFinancialYear(voucherDate);
  const prefix = VOUCHER_PREFIXES[voucherType];

  // Upsert the counter
  await query(`
    INSERT INTO voucher_counters (voucher_type, financial_year, last_number)
    VALUES ($1, $2, 0)
    ON CONFLICT DO NOTHING
  `, [voucherType, fy]);

  // Increment
  await query(`
    UPDATE voucher_counters
    SET last_number = last_number + 1
    WHERE voucher_type = $1 AND financial_year = $2
  `, [voucherType, fy]);

  // Return
  const result = await query(`
    SELECT last_number
    FROM voucher_counters
    WHERE voucher_type = $1 AND financial_year = $2
  `, [voucherType, fy]);

  const num = result.rows[0].last_number;
  return `${prefix}/${fy}/${String(num).padStart(4, '0')}`;
}

module.exports = { VOUCHER_PREFIXES, VOUCHER_TYPE_LABELS, getFinancialYear, getNextVoucherNumber };
