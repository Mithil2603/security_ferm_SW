// Permanently delete a voucher — shared by the Vouchers screen and Bank
// Reconciliation. Bank/cash balances are derived from posted vouchers, so they
// adjust on their own. Refused when the voucher belongs to a payment (the
// invoice/bill it settled would stay marked paid with no money behind it) or
// has been bank-reconciled (undo the reconciliation first).
const { query } = require('../database/connection');

const PAYMENT_KIND = {
  client_receipt: 'client receipt',
  vendor_payment: 'vendor payment',
  salary_payment: 'salary payment',
};

/** @returns {Promise<{ ok: boolean, status?: number, message: string }>} */
async function deleteVoucher(id) {
  const existing = await query('SELECT * FROM vouchers WHERE id = $1', [id]);
  if (existing.rows.length === 0) return { ok: false, status: 404, message: 'Voucher not found' };
  const voucher = existing.rows[0];

  const linkedPayment = await query(
    'SELECT transaction_type FROM payment_transactions WHERE voucher_id = $1 LIMIT 1',
    [id]
  );
  if (linkedPayment.rows.length > 0) {
    const kind = PAYMENT_KIND[linkedPayment.rows[0].transaction_type] || 'payment';
    return {
      ok: false,
      status: 400,
      message: `${voucher.voucher_number} was created by a ${kind}. Delete that payment in Bank & Payments instead — it also reverses the invoice/bill it settled.`,
    };
  }

  // Tables may be absent on very old databases — treat a missing table as "no link".
  const reconciled = await query(
    'SELECT id FROM bank_reconciliation WHERE voucher_id = $1 AND is_reconciled = 1 LIMIT 1',
    [id]
  ).catch(() => ({ rows: [] }));
  if (reconciled.rows.length > 0) {
    return {
      ok: false,
      status: 400,
      message: `${voucher.voucher_number} is reconciled. Undo the reconciliation in Bank Reconciliation first, then delete it.`,
    };
  }

  await query('DELETE FROM bank_reconciliation WHERE voucher_id = $1', [id]).catch(() => {});
  await query('DELETE FROM recurring_vouchers WHERE template_voucher_id = $1', [id]).catch(() => {});
  await query('DELETE FROM vouchers WHERE id = $1', [id]);
  return { ok: true, message: `Voucher ${voucher.voucher_number} deleted` };
}

module.exports = { deleteVoucher };
