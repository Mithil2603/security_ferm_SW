/**
 * src/services/payments/paymentTransactionService.js
 *
 * Single shared implementation of "what happens when money moves" for all three
 * payment directions (client receipts, vendor payments, salary payments). Called
 * both by the new unified Payments module AND by the pre-existing entry points
 * (Invoices "Record Payment", Expenses "Pay", Payroll/Salary Slip "Mark as Paid")
 * so there is never a screen that bypasses voucher creation / ledger sync.
 *
 * Every function:
 *   1. Inserts a payment_transactions row (the money-movement record).
 *   2. If a bill/invoice was selected, derives and inserts a payment_tax_details
 *      row by prorating the bill's own fixed GST split across whatever fraction
 *      of the bill this payment settles (TDS is always a real entered value).
 *   3. Updates the existing domain table(s) so current screens/reports are unaffected.
 *   4. Creates a posted `vouchers` row against the chosen bank/cash account, which
 *      is what makes Party Ledger / Vendor Ledger / Balance Sheet reflect it.
 */

const { query } = require('../../database/connection');
const gstService = require('../gst/gstComplianceService');
const { getNextVoucherNumber } = require('../../utils/voucherNumbering');
const { saveStatement } = require('../../utils/statementSaver');
const logger = require('../../utils/logger');

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function firstOfMonth(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// Resolves a bank account when the caller (an older screen not yet updated with
// a bank-account picker) doesn't supply one — mirrors the existing default-bank
// fallback already used in src/routes/invoices.js, so vouchers still get created.
async function resolveDefaultBankAccountId(paymentMethod) {
  if (paymentMethod === 'cash') {
    const cash = await query("SELECT id FROM bank_accounts WHERE account_type = 'cash' AND is_active = 1 ORDER BY id ASC LIMIT 1");
    if (cash.rows.length > 0) return cash.rows[0].id;
  }
  const bank = await query(
    "SELECT id FROM bank_accounts WHERE account_number = '252528112019' OR (account_type = 'bank' AND is_active = 1) ORDER BY (account_number = '252528112019') DESC, id ASC LIMIT 1"
  );
  return bank.rows.length > 0 ? bank.rows[0].id : null;
}

// Prorates a bill's fixed GST split across the portion this payment settles.
// remainingBase/remainingTaxable/remainingCgst/remainingSgst/remainingIgst are
// what's left un-settled on the bill BEFORE this payment. `isClosing` (the
// settlement reaches/exceeds what's left) makes this installment absorb the
// full remainder instead of a fractional slice, so rounding never drifts.
function prorateTax(settlementAmount, remainingBase, remainingTaxable, remainingCgst, remainingSgst, remainingIgst) {
  if (remainingBase <= 0) {
    return { taxable_value: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0 };
  }
  const isClosing = settlementAmount >= remainingBase - 0.5;
  const fraction = isClosing ? 1 : Math.max(0, Math.min(1, settlementAmount / remainingBase));
  const round2 = (v) => Math.round(v * 100) / 100;
  return {
    taxable_value: round2(remainingTaxable * fraction),
    cgst_amount: round2(remainingCgst * fraction),
    sgst_amount: round2(remainingSgst * fraction),
    igst_amount: round2(remainingIgst * fraction),
  };
}

async function sumPriorTaxDetail(referenceType, referenceId) {
  const result = await query(
    `SELECT COALESCE(SUM(ptd.taxable_value),0) as taxable_value,
            COALESCE(SUM(ptd.cgst_amount),0) as cgst_amount,
            COALESCE(SUM(ptd.sgst_amount),0) as sgst_amount,
            COALESCE(SUM(ptd.igst_amount),0) as igst_amount
     FROM payment_tax_details ptd
     JOIN payment_transactions pt ON pt.id = ptd.payment_transaction_id
     WHERE pt.reference_type = $1 AND pt.reference_id = $2`,
    [referenceType, referenceId]
  );
  const r = result.rows[0] || {};
  return {
    taxable_value: parseFloat(r.taxable_value) || 0,
    cgst_amount: parseFloat(r.cgst_amount) || 0,
    sgst_amount: parseFloat(r.sgst_amount) || 0,
    igst_amount: parseFloat(r.igst_amount) || 0,
  };
}

async function insertPaymentTransaction({ transaction_type, party_type, party_id, reference_type, reference_id, amount, payment_method, bank_account_id, payment_date, transaction_reference, attachment_url, notes, created_by, employee_bank_snapshot }) {
  const result = await query(
    `INSERT INTO payment_transactions
      (transaction_type, party_type, party_id, reference_type, reference_id, amount,
       payment_method, bank_account_id, payment_date, transaction_reference, attachment_url, notes, created_by, employee_bank_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [transaction_type, party_type, party_id, reference_type || 'none', reference_id || null, amount,
     payment_method, bank_account_id || null, payment_date, transaction_reference || null, attachment_url || null, notes || null, created_by, employee_bank_snapshot || null]
  );
  return result.rows[0];
}

async function insertTaxDetail({ payment_transaction_id, party_type, party_id, taxable_value, tax_type, tax_rate, cgst_amount, sgst_amount, igst_amount, is_rcm_applicable, tds_amount, payment_date }) {
  const total_gst_amount = Math.round((cgst_amount + sgst_amount + igst_amount) * 100) / 100;
  await query(
    `INSERT INTO payment_tax_details
      (payment_transaction_id, party_type, party_id, taxable_value, tax_type, tax_rate,
       cgst_amount, sgst_amount, igst_amount, total_gst_amount, is_rcm_applicable, tds_amount, tax_period)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [payment_transaction_id, party_type, party_id, taxable_value, tax_type || 'none', tax_rate || 0,
     cgst_amount, sgst_amount, igst_amount, total_gst_amount, is_rcm_applicable ? 1 : 0, tds_amount || 0, firstOfMonth(payment_date)]
  );
}

// Creates a posted voucher for a completed payment. Returns the voucher id, or
// null if there's no positive cash/bank movement to record (e.g. a payment
// that's entirely TDS, with nothing physically transferred).
async function createPostedVoucher({ direction, amount, bankAccountId, partyType, partyId, partyName, referenceType, referenceId, voucherDate, narration, createdBy }) {
  if (!amount || amount <= 0 || !bankAccountId) return null;

  const accountRes = await query('SELECT account_type FROM bank_accounts WHERE id = $1', [bankAccountId]);
  const isCash = accountRes.rows[0]?.account_type === 'cash';
  const voucherType = direction === 'receipt'
    ? (isCash ? 'cash_receipt' : 'bank_receipt')
    : (isCash ? 'cash_payment' : 'bank_payment');

  const voucherNumber = await getNextVoucherNumber(voucherType, voucherDate);

  const result = await query(
    `INSERT INTO vouchers
      (voucher_number, voucher_type, voucher_date, amount, debit_account_id, credit_account_id,
       party_type, party_id, party_name, reference_type, reference_id, narration, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'posted',$13)
     RETURNING id`,
    [
      voucherNumber, voucherType, voucherDate, amount,
      direction === 'receipt' ? bankAccountId : null,
      direction === 'payment' ? bankAccountId : null,
      partyType, partyId || null, partyName || null,
      referenceType || 'none', referenceId || null, narration || null,
      createdBy
    ]
  );
  return result.rows[0].id;
}

// ─────────────────────────────────────────────────────────────────────────────
// BANK ENTRY — bank charges, interest credited, other misc charges/credits, and
// inter-account transfers (bank<->bank, cash<->bank). These aren't tied to any
// client/vendor/employee — they're direct adjustments to a bank/cash account's
// own balance, or a movement between two of the agency's own accounts. Posted
// immediately (no manual approval step), same as every other payment-module
// entry point, reusing the existing 'journal' (single account) and 'contra'
// (two-account transfer) voucher types.
// ─────────────────────────────────────────────────────────────────────────────
async function recordBankEntry(params, userId) {
  const { kind, bank_account_id, to_account_id, amount, entry_date, narration, transaction_ref } = params;
  const finalAmount = parseFloat(amount);
  if (isNaN(finalAmount) || finalAmount <= 0) throw new Error('A valid amount is required');
  const entryDate = entry_date || todayStr();

  let voucherType, debitAccountId, creditAccountId, finalNarration;

  if (kind === 'transfer') {
    if (!bank_account_id || !to_account_id) throw new Error('Both a from-account and a to-account are required for a transfer');
    if (String(bank_account_id) === String(to_account_id)) throw new Error('From and To accounts must be different');
    voucherType = 'contra';
    creditAccountId = bank_account_id; // money leaves the source account
    debitAccountId = to_account_id;    // money arrives at the destination account
    finalNarration = narration || 'Transfer between accounts';
  } else {
    if (!bank_account_id) throw new Error('A bank/cash account is required');
    voucherType = 'journal';
    const isDebit = kind === 'bank_charge' || kind === 'other_debit';
    debitAccountId = isDebit ? bank_account_id : null;
    creditAccountId = isDebit ? null : bank_account_id;
    finalNarration = narration || (
      kind === 'bank_charge' ? 'Bank charges'
      : kind === 'interest_credited' ? 'Interest credited'
      : kind === 'other_credit' ? 'Other credit'
      : 'Other charge'
    );
  }

  const voucherNumber = await getNextVoucherNumber(voucherType, entryDate);
  const result = await query(
    `INSERT INTO vouchers
      (voucher_number, voucher_type, voucher_date, amount, debit_account_id, credit_account_id,
       party_type, narration, transaction_ref, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'posted',$10)
     RETURNING *`,
    [voucherNumber, voucherType, entryDate, finalAmount, debitAccountId || null, creditAccountId || null,
     'other', finalNarration, transaction_ref || null, userId]
  );
  return result.rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT RECEIPT
// ─────────────────────────────────────────────────────────────────────────────
async function recordClientReceipt(params, userId) {
  const {
    invoice_id, amount_paid, tds_deducted = 0, payment_date, payment_method,
    bank_account_id, transaction_reference, attachment_url, notes
  } = params;

  const invRes = await query(
    'SELECT i.*, c.name as client_name FROM invoices i JOIN clients c ON i.client_id = c.id WHERE i.id = $1',
    [invoice_id]
  );
  if (invRes.rows.length === 0) throw new Error('Invoice not found');
  const invoice = invRes.rows[0];

  const remainingBefore = parseFloat(invoice.final_amount) - parseFloat(invoice.payment_received || 0) - parseFloat(invoice.tds_deducted || 0);
  if (remainingBefore <= 0.5) {
    throw new Error('This invoice is already fully paid — please select a different bill');
  }
  const totalCredit = parseFloat(amount_paid || 0) + parseFloat(tds_deducted || 0);
  if (totalCredit > remainingBefore + 0.5) {
    throw new Error(`Amount + TDS exceeds remaining balance of ₹${remainingBefore.toFixed(2)}`);
  }

  const payDate = payment_date || todayStr();
  const resolvedBankAccountId = bank_account_id || await resolveDefaultBankAccountId(payment_method);

  // 1. payment_transactions
  const paymentTx = await insertPaymentTransaction({
    transaction_type: 'client_receipt', party_type: 'client', party_id: invoice.client_id,
    reference_type: 'invoice', reference_id: invoice_id, amount: parseFloat(amount_paid || 0),
    payment_method, bank_account_id: resolvedBankAccountId, payment_date: payDate,
    transaction_reference, attachment_url, notes, created_by: userId
  });

  // 2. payment_tax_details — prorated from the invoice's own fixed GST split
  const priorTax = await sumPriorTaxDetail('invoice', invoice_id);
  const remainingTaxable = parseFloat(invoice.amount_subtotal || 0) - priorTax.taxable_value;
  const remainingCgst = parseFloat(invoice.cgst_amount || 0) - priorTax.cgst_amount;
  const remainingSgst = parseFloat(invoice.sgst_amount || 0) - priorTax.sgst_amount;
  const remainingIgst = parseFloat(invoice.igst_amount || 0) - priorTax.igst_amount;
  const prorated = prorateTax(totalCredit, remainingBefore, remainingTaxable, remainingCgst, remainingSgst, remainingIgst);
  await insertTaxDetail({
    payment_transaction_id: paymentTx.id, party_type: 'client', party_id: invoice.client_id,
    taxable_value: prorated.taxable_value, tax_type: invoice.tax_type, tax_rate: invoice.tax_rate,
    cgst_amount: prorated.cgst_amount, sgst_amount: prorated.sgst_amount, igst_amount: prorated.igst_amount,
    is_rcm_applicable: invoice.is_rcm_applicable, tds_amount: parseFloat(tds_deducted || 0), payment_date: payDate
  });

  // 3. legacy payments table — still the source read by the TDS/collections
  // reports and the invoice's payment-history list; keep it in lockstep.
  // Stamped with the payment_transaction_id so a later delete/undo can find
  // this exact row instead of guessing by invoice_id+date+amount.
  await query(
    'INSERT INTO payments (invoice_id, payment_date, amount_paid, tds_deducted, payment_method, transaction_reference, notes, created_by, payment_transaction_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [invoice_id, payDate, parseFloat(amount_paid || 0), parseFloat(tds_deducted || 0), payment_method, transaction_reference || null, notes || null, userId, paymentTx.id]
  );

  // 4. update invoice
  const newReceived = parseFloat(invoice.payment_received || 0) + parseFloat(amount_paid || 0);
  const newTds = parseFloat(invoice.tds_deducted || 0) + parseFloat(tds_deducted || 0);
  const newDue = parseFloat(invoice.final_amount) - newReceived - newTds;
  const isPaid = newDue <= 0.5;
  const newStatus = isPaid ? 'paid' : 'partially_paid';
  await query(
    'UPDATE invoices SET payment_received=$1, tds_deducted=$2, payment_due=$3, status=$4, updated_at=CURRENT_TIMESTAMP WHERE id=$5',
    [newReceived.toFixed(2), newTds.toFixed(2), (isPaid ? 0 : Math.max(0, newDue)).toFixed(2), newStatus, invoice_id]
  );

  // 5. voucher
  const voucherId = await createPostedVoucher({
    direction: 'receipt', amount: parseFloat(amount_paid || 0), bankAccountId: resolvedBankAccountId,
    partyType: 'client', partyId: invoice.client_id, partyName: invoice.client_name,
    referenceType: 'invoice', referenceId: invoice_id, voucherDate: payDate,
    narration: `Payment received - Invoice ${invoice.invoice_number}`, createdBy: userId
  });
  if (voucherId) {
    await query('UPDATE payment_transactions SET voucher_id = $1 WHERE id = $2', [voucherId, paymentTx.id]);
  }

  const updatedInvoice = await query(
    'SELECT i.*, c.name as client_name, c.gst_number as client_gst FROM invoices i JOIN clients c ON i.client_id = c.id WHERE i.id = $1',
    [invoice_id]
  );
  return { payment_transaction: { ...paymentTx, voucher_id: voucherId }, invoice: updatedInvoice.rows[0] };
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE CLIENT RECEIPT — reverses everything recordClientReceipt did: rolls
// back the invoice's payment_received/tds_deducted/payment_due/status, removes
// the payment_tax_details row (there's no real FK cascade here — MySQL parses
// but ignores the inline REFERENCES in migration 038), deletes the matching
// legacy payments row, and soft-cancels the linked voucher — matching the
// existing cancel convention in src/routes/vouchers.js rather than erasing
// ledger history outright.
// ─────────────────────────────────────────────────────────────────────────────
async function deleteClientReceipt(paymentTransactionId, userId) {
  const txRes = await query('SELECT * FROM payment_transactions WHERE id = $1', [paymentTransactionId]);
  if (txRes.rows.length === 0) throw new Error('Payment not found');
  const tx = txRes.rows[0];
  if (tx.transaction_type !== 'client_receipt') throw new Error('Only client receipts can be deleted here');

  const invRes = await query('SELECT * FROM invoices WHERE id = $1', [tx.reference_id]);
  if (invRes.rows.length === 0) throw new Error('The linked invoice could not be found');
  const invoice = invRes.rows[0];

  const taxRes = await query(
    'SELECT COALESCE(SUM(tds_amount),0) as tds_amount FROM payment_tax_details WHERE payment_transaction_id = $1',
    [paymentTransactionId]
  );
  const tdsFromTx = parseFloat(taxRes.rows[0]?.tds_amount) || 0;

  const newReceived = Math.max(0, parseFloat(invoice.payment_received || 0) - parseFloat(tx.amount || 0));
  const newTds = Math.max(0, parseFloat(invoice.tds_deducted || 0) - tdsFromTx);
  const newDue = parseFloat(invoice.final_amount) - newReceived - newTds;
  const newStatus = invoice.status === 'cancelled'
    ? 'cancelled'
    : newDue <= 0.5 ? 'paid' : (newReceived > 0.5 || newTds > 0.5 ? 'partially_paid' : 'sent');

  await query(
    'UPDATE invoices SET payment_received=$1, tds_deducted=$2, payment_due=$3, status=$4, updated_at=CURRENT_TIMESTAMP WHERE id=$5',
    [newReceived.toFixed(2), newTds.toFixed(2), Math.max(0, newDue).toFixed(2), newStatus, invoice.id]
  );

  await query('DELETE FROM payment_tax_details WHERE payment_transaction_id = $1', [paymentTransactionId]);

  // Prefer the precise link; fall back to matching for receipts recorded
  // before payment_transaction_id existed on `payments` (migration 044).
  const linkedDelete = await query('DELETE FROM payments WHERE payment_transaction_id = $1', [paymentTransactionId]);
  if (!linkedDelete.rowCount) {
    await query(
      `DELETE FROM payments WHERE invoice_id=$1 AND payment_date=$2 AND amount_paid=$3 AND COALESCE(tds_deducted,0)=$4 LIMIT 1`,
      [tx.reference_id, tx.payment_date, parseFloat(tx.amount || 0), tdsFromTx]
    );
  }

  if (tx.voucher_id) {
    await query(
      `UPDATE vouchers SET status='cancelled', cancelled_by=$1, cancellation_date=CURRENT_TIMESTAMP, cancellation_reason=$2 WHERE id=$3 AND status != 'cancelled'`,
      [userId, 'Client receipt deleted', tx.voucher_id]
    );
  }

  await query('DELETE FROM payment_transactions WHERE id = $1', [paymentTransactionId]);

  const updatedInvoice = await query('SELECT * FROM invoices WHERE id = $1', [invoice.id]);
  return { invoice: updatedInvoice.rows[0] };
}

// ─────────────────────────────────────────────────────────────────────────────
// VENDOR PAYMENT
// ─────────────────────────────────────────────────────────────────────────────
async function recordVendorPayment(params, userId) {
  const {
    expense_id, amount, payment_date, payment_method, bank_account_id, reference_number,
    attachment_url, notes, tds_amount = 0,
    // Only used when the bill itself carries no GST info (ad hoc entry):
    tax_type: manualTaxType, tax_rate: manualTaxRate, is_rcm_applicable: manualRcm
  } = params;

  const expRes = await query('SELECT * FROM expenses WHERE id = $1', [expense_id]);
  if (expRes.rows.length === 0) throw new Error('Expense not found');
  const expense = expRes.rows[0];
  if (expense.status === 'paid') throw new Error('Expense is already fully paid');

  const paymentAmount = parseFloat(amount);
  if (isNaN(paymentAmount) || paymentAmount <= 0) throw new Error('Invalid payment amount');

  const payDate = payment_date || todayStr();
  const resolvedBankAccountId = bank_account_id || await resolveDefaultBankAccountId(payment_method);
  const currentSettled = parseFloat(expense.amount_paid) || 0;
  const remainingBefore = parseFloat(expense.amount) - currentSettled;
  if (remainingBefore <= 0.5) {
    throw new Error('This bill is already fully paid — please select a different bill');
  }
  const totalSettlement = paymentAmount + parseFloat(tds_amount || 0);
  if (totalSettlement > remainingBefore + 0.5) {
    throw new Error(`Amount + TDS exceeds remaining bill balance of ₹${remainingBefore.toFixed(2)}`);
  }

  // 1. payment_transactions
  const paymentTx = await insertPaymentTransaction({
    transaction_type: 'vendor_payment', party_type: 'vendor', party_id: expense.vendor_id,
    reference_type: 'expense', reference_id: expense_id, amount: paymentAmount,
    payment_method: payment_method || 'bank_transfer', bank_account_id: resolvedBankAccountId, payment_date: payDate,
    transaction_reference: reference_number, attachment_url, notes, created_by: userId
  });

  // 2. payment_tax_details
  const hasBillTax = expense.tax_type && expense.tax_type !== 'none';
  let taxDetail;
  if (hasBillTax) {
    const billTaxableTotal = parseFloat(expense.amount) - parseFloat(expense.cgst_amount || 0) - parseFloat(expense.sgst_amount || 0) - parseFloat(expense.igst_amount || 0);
    const priorTax = await sumPriorTaxDetail('expense', expense_id);
    const remainingTaxable = billTaxableTotal - priorTax.taxable_value;
    const remainingCgst = parseFloat(expense.cgst_amount || 0) - priorTax.cgst_amount;
    const remainingSgst = parseFloat(expense.sgst_amount || 0) - priorTax.sgst_amount;
    const remainingIgst = parseFloat(expense.igst_amount || 0) - priorTax.igst_amount;
    const prorated = prorateTax(totalSettlement, remainingBefore, remainingTaxable, remainingCgst, remainingSgst, remainingIgst);
    taxDetail = { ...prorated, tax_type: expense.tax_type, tax_rate: expense.tax_rate, is_rcm_applicable: expense.is_rcm_applicable };
  } else if (manualTaxType && manualTaxType !== 'none' && manualTaxRate) {
    // Ad hoc payment with no bill-level tax info: back out the taxable value
    // from this installment's GST-inclusive amount.
    const rate = parseFloat(manualTaxRate) || 0;
    const taxableValue = Math.round((totalSettlement / (1 + rate / 100)) * 100) / 100;
    const gst = gstService.calculateGST(taxableValue, rate, manualTaxType);
    taxDetail = { taxable_value: taxableValue, cgst_amount: gst.cgst, sgst_amount: gst.sgst, igst_amount: gst.igst, tax_type: manualTaxType, tax_rate: rate, is_rcm_applicable: manualRcm };
  } else {
    taxDetail = { taxable_value: totalSettlement, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_type: 'none', tax_rate: 0, is_rcm_applicable: false };
  }
  await insertTaxDetail({
    payment_transaction_id: paymentTx.id, party_type: 'vendor', party_id: expense.vendor_id,
    taxable_value: taxDetail.taxable_value, tax_type: taxDetail.tax_type, tax_rate: taxDetail.tax_rate,
    cgst_amount: taxDetail.cgst_amount, sgst_amount: taxDetail.sgst_amount, igst_amount: taxDetail.igst_amount,
    is_rcm_applicable: taxDetail.is_rcm_applicable, tds_amount: parseFloat(tds_amount || 0), payment_date: payDate
  });

  // 3. vendor_payments + expenses (existing behavior, extended for TDS settlement)
  await query(
    `INSERT INTO vendor_payments (vendor_id, expense_id, payment_date, amount, payment_method, reference_number, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [expense.vendor_id, expense.id, payDate, paymentAmount, payment_method || 'bank_transfer', reference_number, notes, userId]
  );
  const newSettled = currentSettled + totalSettlement;
  const newStatus = newSettled >= parseFloat(expense.amount) ? 'paid' : expense.status;
  await query('UPDATE expenses SET amount_paid = $1, status = $2 WHERE id = $3', [newSettled, newStatus, expense.id]);
  const updatedExpense = await query('SELECT * FROM expenses WHERE id = $1', [expense.id]);
  const finalExpense = updatedExpense.rows[0];

  // 4. voucher (net cash/bank movement only — TDS withheld never physically moves)
  const vendorRes = await query('SELECT name FROM vendors WHERE id = $1', [expense.vendor_id]);
  const vendorName = vendorRes.rows[0]?.name || expense.vendor_name || 'Unknown';
  const voucherId = await createPostedVoucher({
    direction: 'payment', amount: paymentAmount, bankAccountId: resolvedBankAccountId,
    partyType: 'vendor', partyId: expense.vendor_id, partyName: vendorName,
    referenceType: 'expense', referenceId: expense_id, voucherDate: payDate,
    narration: `Payment to vendor - ${expense.description}`, createdBy: userId
  });
  if (voucherId) {
    await query('UPDATE payment_transactions SET voucher_id = $1 WHERE id = $2', [voucherId, paymentTx.id]);
  }

  // Preserve existing statement archival behavior
  try {
    await saveStatement({
      domain: 'vendor',
      statement_number: `VP-${vendorName.replace(/\s+/g, '_')}-${payDate}`,
      title: `Vendor Payment: ${vendorName} - ₹${paymentAmount.toLocaleString()}`,
      reference_id: expense.id,
      reference_type: 'vendor_payment',
      statement_data: {
        expense_id: expense.id, vendor_name: vendorName, description: expense.description,
        category: expense.category, expense_amount: parseFloat(expense.amount),
        payment_amount: paymentAmount, tds_amount: parseFloat(tds_amount || 0), total_paid: newSettled,
        payment_method: payment_method || 'bank_transfer', reference_number, payment_date: payDate, status: newStatus
      },
      total_amount: paymentAmount,
      tax_amount: taxDetail.cgst_amount + taxDetail.sgst_amount + taxDetail.igst_amount,
      party_name: vendorName,
      party_id: expense.vendor_id,
      generated_by: userId
    });
  } catch (e) {
    logger.error('Failed to archive vendor payment statement:', e);
  }

  return { payment_transaction: { ...paymentTx, voucher_id: voucherId }, expense: finalExpense };
}

// ─────────────────────────────────────────────────────────────────────────────
// SALARY PAYMENT
// ─────────────────────────────────────────────────────────────────────────────
async function recordSalaryPayment(params, userId) {
  const {
    reference_type, reference_id, employee_id, amount, payment_date, payment_method,
    bank_account_id, transaction_reference, attachment_url, notes, employee_bank_snapshot
  } = params;

  const payDate = payment_date || todayStr();
  let employeeId, employeeName, payrollId = null, netSalary;

  // Direct/ad-hoc payment: no payroll run or salary slip to close out — just
  // pay the employee directly (e.g. an advance, off-cycle reimbursement).
  // Nothing to mark "paid" in payroll/salary_slips since there's no such row.
  if (!reference_id) {
    if (!employee_id) throw new Error('employee_id is required for a direct salary payment');
    const empRes = await query('SELECT full_name FROM employees WHERE id = $1', [employee_id]);
    if (empRes.rows.length === 0) throw new Error('Employee not found');
    employeeId = employee_id;
    employeeName = empRes.rows[0].full_name;
    netSalary = null;
  } else if (reference_type === 'salary_slip') {
    const salarySlipService = require('../payroll/salarySlipService');
    const slip = await salarySlipService.markPaid(reference_id, { payment_date: payDate, payment_method, transaction_reference });
    const empRes = await query('SELECT full_name FROM employees WHERE id = $1', [slip.employee_id]);
    employeeId = slip.employee_id;
    employeeName = empRes.rows[0]?.full_name || 'Employee';
    payrollId = slip.payroll_id || null;
    netSalary = slip.net_salary;

    // Keep the legacy payroll table in sync so Balance Sheet's Salary Payable
    // and P&L's payroll cost line (which read `payroll`, not `salary_slips`)
    // reflect the disbursement regardless of which screen recorded it.
    if (payrollId) {
      await query(
        `UPDATE payroll SET payment_status='paid', payment_date=$1, payment_method=$2, transaction_reference=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$4`,
        [payDate, payment_method, transaction_reference, payrollId]
      );
    }
  } else {
    const payrollRes = await query('SELECT * FROM payroll WHERE id = $1', [reference_id]);
    if (payrollRes.rows.length === 0) throw new Error('Payroll record not found');
    const payroll = payrollRes.rows[0];
    await query(
      `UPDATE payroll SET payment_status='paid', payment_date=$1, payment_method=$2, transaction_reference=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$4`,
      [payDate, payment_method, transaction_reference, reference_id]
    );
    const empRes = await query('SELECT full_name FROM employees WHERE id = $1', [payroll.employee_id]);
    employeeId = payroll.employee_id;
    employeeName = empRes.rows[0]?.full_name || 'Employee';
    payrollId = payroll.id;
    netSalary = payroll.net_salary;

    // Keep salary_slips in sync too, if a matching slip exists for this payroll row.
    const slipRes = await query('SELECT id FROM salary_slips WHERE payroll_id = $1', [payrollId]);
    if (slipRes.rows.length > 0 && slipRes.rows[0].status !== 'paid') {
      await query(
        `UPDATE salary_slips SET status='paid', paid_at=$1, payment_method=$2, transaction_reference=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$4`,
        [payDate, payment_method, transaction_reference, slipRes.rows[0].id]
      );
    }
  }

  const resolvedBankAccountId = bank_account_id || await resolveDefaultBankAccountId(payment_method);
  const finalAmount = parseFloat(amount) || parseFloat(netSalary) || 0;
  if (finalAmount <= 0) throw new Error('A valid payment amount is required');
  const finalReferenceType = (payrollId || reference_id) ? 'payroll' : 'none';
  const finalReferenceId = payrollId || reference_id || null;

  const paymentTx = await insertPaymentTransaction({
    transaction_type: 'salary_payment', party_type: 'employee', party_id: employeeId,
    reference_type: finalReferenceType, reference_id: finalReferenceId, amount: finalAmount,
    payment_method, bank_account_id: resolvedBankAccountId, payment_date: payDate,
    transaction_reference, attachment_url, notes, created_by: userId, employee_bank_snapshot
  });

  const voucherId = await createPostedVoucher({
    direction: 'payment', amount: finalAmount, bankAccountId: resolvedBankAccountId,
    partyType: 'employee', partyId: employeeId, partyName: employeeName,
    referenceType: finalReferenceType, referenceId: finalReferenceId, voucherDate: payDate,
    narration: `Salary payment - ${employeeName}`, createdBy: userId
  });
  if (voucherId) {
    await query('UPDATE payment_transactions SET voucher_id = $1 WHERE id = $2', [voucherId, paymentTx.id]);
  }

  return { payment_transaction: { ...paymentTx, voucher_id: voucherId }, employee_id: employeeId, payroll_id: payrollId };
}

module.exports = { recordClientReceipt, recordVendorPayment, recordSalaryPayment, recordBankEntry, resolveDefaultBankAccountId, deleteClientReceipt };
