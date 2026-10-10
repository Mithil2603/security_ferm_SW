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

// Round off on a client receipt / vendor payment: the part of the bill settled
// without cash (+ = written off, e.g. ₹27 on ₹11,227 paid as ₹11,200; − = a
// little extra received). Like TDS it closes the bill but never hits the bank.
function parseRoundOff(value, remaining) {
  const ro = parseFloat(value);
  if (value === undefined || value === null || value === '' || isNaN(ro)) return 0;
  const rounded = Math.round(ro * 100) / 100;
  if (Math.abs(rounded) > Math.max(0, remaining) + 0.5) {
    throw new Error(`Round off of ₹${Math.abs(rounded).toFixed(2)} is larger than the bill balance of ₹${Math.max(0, remaining).toFixed(2)}`);
  }
  return rounded;
}

// 'YYYY-MM' (also accepts a 'YYYY-MM-DD' payroll date) → 'YYYY-MM', else null.
function normalizeSalaryMonth(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})/);
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  return `${m[1]}-${m[2]}`;
}

function salaryMonthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
}

async function insertPaymentTransaction({ transaction_type, party_type, party_id, reference_type, reference_id, amount, payment_method, bank_account_id, payment_date, transaction_reference, attachment_url, notes, created_by, employee_bank_snapshot, salary_month, round_off }) {
  const result = await query(
    `INSERT INTO payment_transactions
      (transaction_type, party_type, party_id, reference_type, reference_id, amount,
       payment_method, bank_account_id, payment_date, transaction_reference, attachment_url, notes, created_by, employee_bank_snapshot, salary_month, round_off)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [transaction_type, party_type, party_id, reference_type || 'none', reference_id || null, amount,
     payment_method, bank_account_id || null, payment_date, transaction_reference || null, attachment_url || null, notes || null, created_by, employee_bank_snapshot || null, salary_month || null, round_off || 0]
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
// Which side of the voucher the account goes on for each kind of bank entry.
// Every balance in the app (bank accounts, cash book, balance sheet, BRS) is
//   opening + SUM(debit_account_id = acct) − SUM(credit_account_id = acct)
// so debit_account_id is money IN and credit_account_id is money OUT — the same
// as "Debit Account (Money To)" / "Credit Account (Money From)" on the Vouchers
// screen. (Bank entries used to be saved the other way round, so a bank charge
// raised the balance. Existing rows are deliberately not migrated — client data
// stays as entered; opening an old entry in Edit and saving it with the right
// type puts it on the correct side.)
const BANK_ENTRY_KINDS = {
  bank_charge: { direction: 'out', narration: 'Bank charges' },
  other_debit: { direction: 'out', narration: 'Other payment' },
  interest_credited: { direction: 'in', narration: 'Interest received' },
  other_credit: { direction: 'in', narration: 'Other receipt' },
};

function bankEntryVoucherFields({ kind, bank_account_id, to_account_id, narration }) {
  if (kind === 'transfer') {
    if (!bank_account_id || !to_account_id) throw new Error('Both a from-account and a to-account are required for a transfer');
    if (String(bank_account_id) === String(to_account_id)) throw new Error('From and To accounts must be different');
    return {
      voucherType: 'contra',
      debitAccountId: to_account_id,    // money arrives at the destination account
      creditAccountId: bank_account_id, // money leaves the source account
      narration: narration || 'Transfer between accounts',
      category: 'transfer',
    };
  }
  const def = BANK_ENTRY_KINDS[kind];
  if (!def) throw new Error('Unknown bank entry type');
  if (!bank_account_id) throw new Error('A bank/cash account is required');
  return {
    voucherType: 'journal',
    debitAccountId: def.direction === 'in' ? bank_account_id : null,
    creditAccountId: def.direction === 'out' ? bank_account_id : null,
    narration: narration || def.narration,
    category: kind,
  };
}

async function recordBankEntry(params, userId) {
  const { kind, bank_account_id, to_account_id, amount, entry_date, narration, transaction_ref } = params;
  const finalAmount = parseFloat(amount);
  if (isNaN(finalAmount) || finalAmount <= 0) throw new Error('A valid amount is required');
  const entryDate = entry_date || todayStr();
  const f = bankEntryVoucherFields({ kind, bank_account_id, to_account_id, narration });

  const voucherNumber = await getNextVoucherNumber(f.voucherType, entryDate);
  const result = await query(
    `INSERT INTO vouchers
      (voucher_number, voucher_type, voucher_date, amount, debit_account_id, credit_account_id,
       party_type, narration, transaction_ref, status, created_by, category)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'posted',$10,$11)
     RETURNING *`,
    [voucherNumber, f.voucherType, entryDate, finalAmount, f.debitAccountId || null, f.creditAccountId || null,
     'other', f.narration, transaction_ref || null, userId, f.category]
  );
  return result.rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT RECEIPT
// ─────────────────────────────────────────────────────────────────────────────
async function recordClientReceipt(params, userId) {
  const {
    invoice_id, amount_paid, tds_deducted = 0, payment_date, payment_method,
    bank_account_id, transaction_reference, attachment_url, notes, round_off
  } = params;

  const invRes = await query(
    'SELECT i.*, c.name as client_name FROM invoices i JOIN clients c ON i.client_id = c.id WHERE i.id = $1',
    [invoice_id]
  );
  if (invRes.rows.length === 0) throw new Error('Invoice not found');
  const invoice = invRes.rows[0];

  const remainingBefore = parseFloat(invoice.final_amount) - parseFloat(invoice.payment_received || 0) - parseFloat(invoice.tds_deducted || 0) - parseFloat(invoice.settlement_round_off || 0);
  if (remainingBefore <= 0.5) {
    throw new Error('This invoice is already fully paid — please select a different bill');
  }
  const roundOff = parseRoundOff(round_off, remainingBefore);
  const totalCredit = parseFloat(amount_paid || 0) + parseFloat(tds_deducted || 0) + roundOff;
  if (totalCredit > remainingBefore + 0.5) {
    throw new Error(`Amount + TDS + round off exceeds remaining balance of ₹${remainingBefore.toFixed(2)}`);
  }

  const payDate = payment_date || todayStr();
  const resolvedBankAccountId = bank_account_id || await resolveDefaultBankAccountId(payment_method);

  // 1. payment_transactions
  const paymentTx = await insertPaymentTransaction({
    transaction_type: 'client_receipt', party_type: 'client', party_id: invoice.client_id,
    reference_type: 'invoice', reference_id: invoice_id, amount: parseFloat(amount_paid || 0),
    payment_method, bank_account_id: resolvedBankAccountId, payment_date: payDate,
    transaction_reference, attachment_url, notes, created_by: userId, round_off: roundOff
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
  const newRoundOff = parseFloat(invoice.settlement_round_off || 0) + roundOff;
  const newDue = parseFloat(invoice.final_amount) - newReceived - newTds - newRoundOff;
  const isPaid = newDue <= 0.5;
  const newStatus = isPaid ? 'paid' : 'partially_paid';
  await query(
    'UPDATE invoices SET payment_received=$1, tds_deducted=$2, settlement_round_off=$3, payment_due=$4, status=$5, updated_at=CURRENT_TIMESTAMP WHERE id=$6',
    [newReceived.toFixed(2), newTds.toFixed(2), newRoundOff.toFixed(2), (isPaid ? 0 : Math.max(0, newDue)).toFixed(2), newStatus, invoice_id]
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
  const newRoundOff = parseFloat(invoice.settlement_round_off || 0) - parseFloat(tx.round_off || 0);
  const newDue = parseFloat(invoice.final_amount) - newReceived - newTds - newRoundOff;
  const newStatus = invoice.status === 'cancelled'
    ? 'cancelled'
    : newDue <= 0.5 ? 'paid' : (newReceived > 0.5 || newTds > 0.5 ? 'partially_paid' : 'sent');

  await query(
    'UPDATE invoices SET payment_received=$1, tds_deducted=$2, settlement_round_off=$3, payment_due=$4, status=$5, updated_at=CURRENT_TIMESTAMP WHERE id=$6',
    [newReceived.toFixed(2), newTds.toFixed(2), newRoundOff.toFixed(2), Math.max(0, newDue).toFixed(2), newStatus, invoice.id]
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
    attachment_url, notes, tds_amount = 0, round_off,
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
  const roundOff = parseRoundOff(round_off, remainingBefore);
  const totalSettlement = paymentAmount + parseFloat(tds_amount || 0) + roundOff;
  if (totalSettlement > remainingBefore + 0.5) {
    throw new Error(`Amount + TDS + round off exceeds remaining bill balance of ₹${remainingBefore.toFixed(2)}`);
  }

  // 1. payment_transactions
  const paymentTx = await insertPaymentTransaction({
    transaction_type: 'vendor_payment', party_type: 'vendor', party_id: expense.vendor_id || 0,
    reference_type: 'expense', reference_id: expense_id, amount: paymentAmount,
    payment_method: payment_method || 'bank_transfer', bank_account_id: resolvedBankAccountId, payment_date: payDate,
    transaction_reference: reference_number, attachment_url, notes, created_by: userId, round_off: roundOff
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
    payment_transaction_id: paymentTx.id, party_type: 'vendor', party_id: expense.vendor_id || 0,
    taxable_value: taxDetail.taxable_value, tax_type: taxDetail.tax_type, tax_rate: taxDetail.tax_rate,
    cgst_amount: taxDetail.cgst_amount, sgst_amount: taxDetail.sgst_amount, igst_amount: taxDetail.igst_amount,
    is_rcm_applicable: taxDetail.is_rcm_applicable, tds_amount: parseFloat(tds_amount || 0), payment_date: payDate
  });

  // 3. vendor_payments + expenses (existing behavior, extended for TDS settlement)
  await query(
    `INSERT INTO vendor_payments (vendor_id, expense_id, payment_date, amount, payment_method, reference_number, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [expense.vendor_id || 0, expense.id, payDate, paymentAmount, payment_method || 'bank_transfer', reference_number, notes, userId]
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
    bank_account_id, transaction_reference, attachment_url, notes, employee_bank_snapshot, salary_month
  } = params;

  const payDate = payment_date || todayStr();
  let employeeId, employeeName, payrollId = null, netSalary;
  // A payroll run / salary slip already fixes the month it pays for; a direct
  // payment needs it from the user.
  let salaryMonth = normalizeSalaryMonth(salary_month);

  // Direct/ad-hoc payment: no payroll run or salary slip to close out — just
  // pay the employee directly (e.g. an advance, off-cycle reimbursement).
  // Nothing to mark "paid" in payroll/salary_slips since there's no such row.
  if (!reference_id) {
    if (!employee_id) throw new Error('employee_id is required for a direct salary payment');
    if (!salaryMonth) throw new Error('Please select the month this salary is for');
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
    salaryMonth = normalizeSalaryMonth(slip.payroll_month) || salaryMonth;

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
    salaryMonth = normalizeSalaryMonth(payroll.payroll_month) || salaryMonth;

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
  if (!salaryMonth) salaryMonth = normalizeSalaryMonth(payDate);
  const finalReferenceType = (payrollId || reference_id) ? 'payroll' : 'none';
  const finalReferenceId = payrollId || reference_id || null;

  const paymentTx = await insertPaymentTransaction({
    transaction_type: 'salary_payment', party_type: 'employee', party_id: employeeId,
    reference_type: finalReferenceType, reference_id: finalReferenceId, amount: finalAmount,
    payment_method, bank_account_id: resolvedBankAccountId, payment_date: payDate,
    transaction_reference, attachment_url, notes, created_by: userId, employee_bank_snapshot, salary_month: salaryMonth
  });

  const voucherId = await createPostedVoucher({
    direction: 'payment', amount: finalAmount, bankAccountId: resolvedBankAccountId,
    partyType: 'employee', partyId: employeeId, partyName: employeeName,
    referenceType: finalReferenceType, referenceId: finalReferenceId, voucherDate: payDate,
    narration: `Salary payment - ${employeeName} (${salaryMonthLabel(salaryMonth)})`, createdBy: userId
  });
  if (voucherId) {
    await query('UPDATE payment_transactions SET voucher_id = $1 WHERE id = $2', [voucherId, paymentTx.id]);
  }

  return { payment_transaction: { ...paymentTx, voucher_id: voucherId }, employee_id: employeeId, payroll_id: payrollId };
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE VENDOR PAYMENT — reverses vendor payment on expense and cancels voucher
// ─────────────────────────────────────────────────────────────────────────────
async function deleteVendorPayment(paymentTransactionId, userId) {
  const txRes = await query('SELECT * FROM payment_transactions WHERE id = $1', [paymentTransactionId]);
  if (txRes.rows.length === 0) throw new Error('Payment not found');
  const tx = txRes.rows[0];
  if (tx.transaction_type !== 'vendor_payment') throw new Error('Only vendor payments can be deleted here');

  let updatedExpense = null;
  if (tx.reference_id) {
    const expRes = await query('SELECT * FROM expenses WHERE id = $1', [tx.reference_id]);
    if (expRes.rows.length > 0) {
      const expense = expRes.rows[0];
      const taxRes = await query(
        'SELECT COALESCE(SUM(tds_amount),0) as tds_amount FROM payment_tax_details WHERE payment_transaction_id = $1',
        [paymentTransactionId]
      );
      const tdsFromTx = parseFloat(taxRes.rows[0]?.tds_amount) || 0;
      const totalSettlement = parseFloat(tx.amount || 0) + tdsFromTx + parseFloat(tx.round_off || 0);

      const newSettled = Math.max(0, parseFloat(expense.amount_paid || 0) - totalSettlement);
      let newStatus = expense.status;
      if (newSettled >= parseFloat(expense.amount) - 0.01) {
        newStatus = 'paid';
      } else if (expense.approver_id) {
        newStatus = 'approved';
      } else {
        newStatus = 'pending';
      }

      await query(
        'UPDATE expenses SET amount_paid=$1, status=$2 WHERE id=$3',
        [newSettled, newStatus, expense.id]
      );

      await query(
        'DELETE FROM vendor_payments WHERE expense_id = $1 AND payment_date = $2 AND amount = $3 LIMIT 1',
        [tx.reference_id, tx.payment_date, parseFloat(tx.amount || 0)]
      );

      const expUpdated = await query('SELECT * FROM expenses WHERE id = $1', [expense.id]);
      updatedExpense = expUpdated.rows[0];
    }
  }

  await query('DELETE FROM payment_tax_details WHERE payment_transaction_id = $1', [paymentTransactionId]);

  if (tx.voucher_id) {
    await query(
      `UPDATE vouchers SET status='cancelled', cancelled_by=$1, cancellation_date=CURRENT_TIMESTAMP, cancellation_reason=$2 WHERE id=$3 AND status != 'cancelled'`,
      [userId, 'Vendor payment deleted', tx.voucher_id]
    );
  }

  await query('DELETE FROM payment_transactions WHERE id = $1', [paymentTransactionId]);

  return { expense: updatedExpense };
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE SALARY PAYMENT — reverses salary payment on payroll/slips and cancels voucher
// ─────────────────────────────────────────────────────────────────────────────
async function deleteSalaryPayment(paymentTransactionId, userId) {
  const txRes = await query('SELECT * FROM payment_transactions WHERE id = $1', [paymentTransactionId]);
  if (txRes.rows.length === 0) throw new Error('Payment not found');
  const tx = txRes.rows[0];
  if (tx.transaction_type !== 'salary_payment') throw new Error('Only salary payments can be deleted here');

  if (tx.reference_id) {
    if (tx.reference_type === 'salary_slip') {
      await query(
        `UPDATE salary_slips SET status='approved', paid_at=NULL, payment_method=NULL, transaction_reference=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
        [tx.reference_id]
      );
      const slipRes = await query('SELECT payroll_id FROM salary_slips WHERE id = $1', [tx.reference_id]);
      const payrollId = slipRes.rows[0]?.payroll_id;
      if (payrollId) {
        await query(
          `UPDATE payroll SET payment_status='pending', payment_date=NULL, payment_method=NULL, transaction_reference=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
          [payrollId]
        );
      }
    } else if (tx.reference_type === 'payroll') {
      await query(
        `UPDATE payroll SET payment_status='pending', payment_date=NULL, payment_method=NULL, transaction_reference=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
        [tx.reference_id]
      );
      await query(
        `UPDATE salary_slips SET status='approved', paid_at=NULL, payment_method=NULL, transaction_reference=NULL, updated_at=CURRENT_TIMESTAMP WHERE payroll_id=$1`,
        [tx.reference_id]
      );
    }
  }

  if (tx.voucher_id) {
    await query(
      `UPDATE vouchers SET status='cancelled', cancelled_by=$1, cancellation_date=CURRENT_TIMESTAMP, cancellation_reason=$2 WHERE id=$3 AND status != 'cancelled'`,
      [userId, 'Salary payment deleted', tx.voucher_id]
    );
  }

  await query('DELETE FROM payment_transactions WHERE id = $1', [paymentTransactionId]);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE CLIENT RECEIPT
// ─────────────────────────────────────────────────────────────────────────────
async function updateClientReceipt(paymentTransactionId, params, userId) {
  const txRes = await query('SELECT * FROM payment_transactions WHERE id = $1', [paymentTransactionId]);
  if (txRes.rows.length === 0) throw new Error('Payment not found');
  const tx = txRes.rows[0];
  if (tx.transaction_type !== 'client_receipt') throw new Error('Only client receipts can be updated here');

  const invRes = await query('SELECT i.*, c.name as client_name FROM invoices i JOIN clients c ON i.client_id = c.id WHERE i.id = $1', [tx.reference_id]);
  if (invRes.rows.length === 0) throw new Error('Linked invoice not found');
  const invoice = invRes.rows[0];

  const oldTaxRes = await query('SELECT COALESCE(SUM(tds_amount),0) as tds_amount FROM payment_tax_details WHERE payment_transaction_id = $1', [paymentTransactionId]);
  const oldTds = parseFloat(oldTaxRes.rows[0]?.tds_amount) || 0;
  const oldAmount = parseFloat(tx.amount || 0);

  const oldRoundOff = parseFloat(tx.round_off || 0);
  const baseReceived = Math.max(0, parseFloat(invoice.payment_received || 0) - oldAmount);
  const baseTds = Math.max(0, parseFloat(invoice.tds_deducted || 0) - oldTds);
  const baseRoundOff = parseFloat(invoice.settlement_round_off || 0) - oldRoundOff;
  const maxAllowed = parseFloat(invoice.final_amount) - baseReceived - baseTds - baseRoundOff;

  const newAmount = params.amount !== undefined ? parseFloat(params.amount) : (params.amount_paid !== undefined ? parseFloat(params.amount_paid) : oldAmount);
  const newTds = params.tds_deducted !== undefined ? parseFloat(params.tds_deducted) : (params.tds_amount !== undefined ? parseFloat(params.tds_amount) : oldTds);
  const newRoundOff = params.round_off !== undefined ? parseRoundOff(params.round_off, maxAllowed) : oldRoundOff;

  if (isNaN(newAmount) || newAmount <= 0) throw new Error('A valid amount is required');
  if (newAmount + newTds + newRoundOff > maxAllowed + 0.5) {
    throw new Error(`Amount + TDS + round off exceeds remaining invoice balance of ₹${maxAllowed.toFixed(2)}`);
  }

  const payDate = params.payment_date || tx.payment_date;
  const payMethod = params.payment_method || tx.payment_method;
  const bankAccId = params.bank_account_id !== undefined ? (params.bank_account_id ? parseInt(params.bank_account_id) : null) : tx.bank_account_id;
  const txRef = params.transaction_reference !== undefined ? params.transaction_reference : tx.transaction_reference;
  const notes = params.notes !== undefined ? params.notes : tx.notes;
  const attachUrl = params.attachment_url !== undefined ? params.attachment_url : tx.attachment_url;

  // 1. Update payment_transactions
  await query(
    `UPDATE payment_transactions SET
      amount = $1, payment_date = $2, payment_method = $3, bank_account_id = $4,
      transaction_reference = $5, notes = $6, attachment_url = $7, round_off = $8
     WHERE id = $9`,
    [newAmount, payDate, payMethod, bankAccId, txRef, notes, attachUrl, newRoundOff, paymentTransactionId]
  );

  // 2. Update payment_tax_details
  await query('DELETE FROM payment_tax_details WHERE payment_transaction_id = $1', [paymentTransactionId]);
  const priorTax = await sumPriorTaxDetail('invoice', invoice.id);
  const remainingTaxable = parseFloat(invoice.amount_subtotal || 0) - priorTax.taxable_value;
  const remainingCgst = parseFloat(invoice.cgst_amount || 0) - priorTax.cgst_amount;
  const remainingSgst = parseFloat(invoice.sgst_amount || 0) - priorTax.sgst_amount;
  const remainingIgst = parseFloat(invoice.igst_amount || 0) - priorTax.igst_amount;
  const prorated = prorateTax(newAmount + newTds + newRoundOff, maxAllowed, remainingTaxable, remainingCgst, remainingSgst, remainingIgst);
  await insertTaxDetail({
    payment_transaction_id: paymentTransactionId, party_type: 'client', party_id: invoice.client_id,
    taxable_value: prorated.taxable_value, tax_type: invoice.tax_type, tax_rate: invoice.tax_rate,
    cgst_amount: prorated.cgst_amount, sgst_amount: prorated.sgst_amount, igst_amount: prorated.igst_amount,
    is_rcm_applicable: invoice.is_rcm_applicable, tds_amount: newTds, payment_date: payDate
  });

  // 3. Update legacy payments table
  const legacyUpdate = await query(
    `UPDATE payments SET
      payment_date = $1, amount_paid = $2, tds_deducted = $3, payment_method = $4,
      transaction_reference = $5, notes = $6
     WHERE payment_transaction_id = $7`,
    [payDate, newAmount, newTds, payMethod, txRef, notes, paymentTransactionId]
  );
  if (!legacyUpdate.rowCount) {
    await query(
      `UPDATE payments SET
        payment_date = $1, amount_paid = $2, tds_deducted = $3, payment_method = $4,
        transaction_reference = $5, notes = $6, payment_transaction_id = $7
       WHERE invoice_id = $8 AND amount_paid = $9 LIMIT 1`,
      [payDate, newAmount, newTds, payMethod, txRef, notes, paymentTransactionId, invoice.id, oldAmount]
    );
  }

  // 4. Update invoice
  const newReceived = baseReceived + newAmount;
  const newTotalTds = baseTds + newTds;
  const newTotalRoundOff = baseRoundOff + newRoundOff;
  const newDue = parseFloat(invoice.final_amount) - newReceived - newTotalTds - newTotalRoundOff;
  const isPaid = newDue <= 0.5;
  const newStatus = isPaid ? 'paid' : 'partially_paid';
  await query(
    'UPDATE invoices SET payment_received=$1, tds_deducted=$2, settlement_round_off=$3, payment_due=$4, status=$5, updated_at=CURRENT_TIMESTAMP WHERE id=$6',
    [newReceived.toFixed(2), newTotalTds.toFixed(2), newTotalRoundOff.toFixed(2), (isPaid ? 0 : Math.max(0, newDue)).toFixed(2), newStatus, invoice.id]
  );

  // 5. Update or recreate Voucher
  if (tx.voucher_id) {
    const accountRes = bankAccId ? await query('SELECT account_type FROM bank_accounts WHERE id = $1', [bankAccId]) : { rows: [] };
    const isCash = accountRes.rows[0]?.account_type === 'cash';
    const voucherType = isCash ? 'cash_receipt' : 'bank_receipt';
    await query(
      `UPDATE vouchers SET
        voucher_date = $1, amount = $2, debit_account_id = $3, voucher_type = $4,
        narration = $5, transaction_ref = $6, updated_at = CURRENT_TIMESTAMP
       WHERE id = $7`,
      [payDate, newAmount, bankAccId, voucherType, `Payment received - Invoice ${invoice.invoice_number}`, txRef, tx.voucher_id]
    );
  } else if (newAmount > 0 && bankAccId) {
    const voucherId = await createPostedVoucher({
      direction: 'receipt', amount: newAmount, bankAccountId: bankAccId,
      partyType: 'client', partyId: invoice.client_id, partyName: invoice.client_name,
      referenceType: 'invoice', referenceId: invoice.id, voucherDate: payDate,
      narration: `Payment received - Invoice ${invoice.invoice_number}`, createdBy: userId
    });
    if (voucherId) {
      await query('UPDATE payment_transactions SET voucher_id = $1 WHERE id = $2', [voucherId, paymentTransactionId]);
    }
  }

  const updatedTx = await query('SELECT * FROM payment_transactions WHERE id = $1', [paymentTransactionId]);
  return updatedTx.rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE VENDOR PAYMENT
// ─────────────────────────────────────────────────────────────────────────────
async function updateVendorPayment(paymentTransactionId, params, userId) {
  const txRes = await query('SELECT * FROM payment_transactions WHERE id = $1', [paymentTransactionId]);
  if (txRes.rows.length === 0) throw new Error('Payment not found');
  const tx = txRes.rows[0];
  if (tx.transaction_type !== 'vendor_payment') throw new Error('Only vendor payments can be updated here');

  const expRes = await query('SELECT * FROM expenses WHERE id = $1', [tx.reference_id]);
  if (expRes.rows.length === 0) throw new Error('Expense not found');
  const expense = expRes.rows[0];

  const oldTaxRes = await query('SELECT COALESCE(SUM(tds_amount),0) as tds_amount FROM payment_tax_details WHERE payment_transaction_id = $1', [paymentTransactionId]);
  const oldTds = parseFloat(oldTaxRes.rows[0]?.tds_amount) || 0;
  const oldAmount = parseFloat(tx.amount || 0);
  const oldRoundOff = parseFloat(tx.round_off || 0);
  const oldTotalSettlement = oldAmount + oldTds + oldRoundOff;

  const baseSettled = Math.max(0, (parseFloat(expense.amount_paid) || 0) - oldTotalSettlement);
  const remainingBefore = parseFloat(expense.amount) - baseSettled;

  const newAmount = params.amount !== undefined ? parseFloat(params.amount) : oldAmount;
  const newTds = params.tds_amount !== undefined ? parseFloat(params.tds_amount) : oldTds;
  const newRoundOff = params.round_off !== undefined ? parseRoundOff(params.round_off, remainingBefore) : oldRoundOff;
  const newTotalSettlement = newAmount + newTds + newRoundOff;

  if (isNaN(newAmount) || newAmount <= 0) throw new Error('A valid amount is required');
  if (newTotalSettlement > remainingBefore + 0.5) {
    throw new Error(`Amount + TDS + round off exceeds remaining bill balance of ₹${remainingBefore.toFixed(2)}`);
  }

  const payDate = params.payment_date || tx.payment_date;
  const payMethod = params.payment_method || tx.payment_method;
  const bankAccId = params.bank_account_id !== undefined ? (params.bank_account_id ? parseInt(params.bank_account_id) : null) : tx.bank_account_id;
  const txRef = params.transaction_reference !== undefined ? params.transaction_reference : (params.reference_number || tx.transaction_reference);
  const notes = params.notes !== undefined ? params.notes : tx.notes;
  const attachUrl = params.attachment_url !== undefined ? params.attachment_url : tx.attachment_url;

  // 1. Update payment_transactions
  await query(
    `UPDATE payment_transactions SET
      amount = $1, payment_date = $2, payment_method = $3, bank_account_id = $4,
      transaction_reference = $5, notes = $6, attachment_url = $7, round_off = $8
     WHERE id = $9`,
    [newAmount, payDate, payMethod, bankAccId, txRef, notes, attachUrl, newRoundOff, paymentTransactionId]
  );

  // 2. Update payment_tax_details
  await query('DELETE FROM payment_tax_details WHERE payment_transaction_id = $1', [paymentTransactionId]);
  const hasBillTax = expense.tax_type && expense.tax_type !== 'none';
  let taxDetail;
  if (hasBillTax) {
    const billTaxableTotal = parseFloat(expense.amount) - parseFloat(expense.cgst_amount || 0) - parseFloat(expense.sgst_amount || 0) - parseFloat(expense.igst_amount || 0);
    const priorTax = await sumPriorTaxDetail('expense', expense.id);
    const remainingTaxable = billTaxableTotal - priorTax.taxable_value;
    const remainingCgst = parseFloat(expense.cgst_amount || 0) - priorTax.cgst_amount;
    const remainingSgst = parseFloat(expense.sgst_amount || 0) - priorTax.sgst_amount;
    const remainingIgst = parseFloat(expense.igst_amount || 0) - priorTax.igst_amount;
    const prorated = prorateTax(newTotalSettlement, remainingBefore, remainingTaxable, remainingCgst, remainingSgst, remainingIgst);
    taxDetail = { ...prorated, tax_type: expense.tax_type, tax_rate: expense.tax_rate, is_rcm_applicable: expense.is_rcm_applicable };
  } else {
    taxDetail = { taxable_value: newTotalSettlement, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_type: 'none', tax_rate: 0, is_rcm_applicable: false };
  }
  await insertTaxDetail({
    payment_transaction_id: paymentTransactionId, party_type: 'vendor', party_id: expense.vendor_id || 0,
    taxable_value: taxDetail.taxable_value, tax_type: taxDetail.tax_type, tax_rate: taxDetail.tax_rate,
    cgst_amount: taxDetail.cgst_amount, sgst_amount: taxDetail.sgst_amount, igst_amount: taxDetail.igst_amount,
    is_rcm_applicable: taxDetail.is_rcm_applicable, tds_amount: newTds, payment_date: payDate
  });

  // 3. Update vendor_payments
  await query(
    `UPDATE vendor_payments SET
      payment_date = $1, amount = $2, payment_method = $3, reference_number = $4, notes = $5
     WHERE expense_id = $6 AND payment_date = $7 AND amount = $8 LIMIT 1`,
    [payDate, newAmount, payMethod, txRef, notes, expense.id, tx.payment_date, oldAmount]
  );

  // 4. Update expenses
  const newSettled = baseSettled + newTotalSettlement;
  const newStatus = newSettled >= parseFloat(expense.amount) - 0.01 ? 'paid' : (expense.approver_id ? 'approved' : 'pending');
  await query('UPDATE expenses SET amount_paid = $1, status = $2 WHERE id = $3', [newSettled, newStatus, expense.id]);

  // 5. Update voucher
  if (tx.voucher_id) {
    const accountRes = bankAccId ? await query('SELECT account_type FROM bank_accounts WHERE id = $1', [bankAccId]) : { rows: [] };
    const isCash = accountRes.rows[0]?.account_type === 'cash';
    const voucherType = isCash ? 'cash_payment' : 'bank_payment';
    await query(
      `UPDATE vouchers SET
        voucher_date = $1, amount = $2, credit_account_id = $3, voucher_type = $4,
        narration = $5, transaction_ref = $6, updated_at = CURRENT_TIMESTAMP
       WHERE id = $7`,
      [payDate, newAmount, bankAccId, voucherType, `Payment to vendor - ${expense.description}`, txRef, tx.voucher_id]
    );
  }

  const updatedTx = await query('SELECT * FROM payment_transactions WHERE id = $1', [paymentTransactionId]);
  return updatedTx.rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE SALARY PAYMENT
// ─────────────────────────────────────────────────────────────────────────────
async function updateSalaryPayment(paymentTransactionId, params, userId) {
  const txRes = await query('SELECT * FROM payment_transactions WHERE id = $1', [paymentTransactionId]);
  if (txRes.rows.length === 0) throw new Error('Payment not found');
  const tx = txRes.rows[0];
  if (tx.transaction_type !== 'salary_payment') throw new Error('Only salary payments can be updated here');

  const newAmount = params.amount !== undefined ? parseFloat(params.amount) : parseFloat(tx.amount);
  if (isNaN(newAmount) || newAmount <= 0) throw new Error('A valid amount is required');

  const payDate = params.payment_date || tx.payment_date;
  const payMethod = params.payment_method || tx.payment_method;
  const bankAccId = params.bank_account_id !== undefined ? (params.bank_account_id ? parseInt(params.bank_account_id) : null) : tx.bank_account_id;
  const txRef = params.transaction_reference !== undefined ? params.transaction_reference : tx.transaction_reference;
  const notes = params.notes !== undefined ? params.notes : tx.notes;
  const attachUrl = params.attachment_url !== undefined ? params.attachment_url : tx.attachment_url;
  const empBankSnap = params.employee_bank_snapshot !== undefined ? params.employee_bank_snapshot : tx.employee_bank_snapshot;
  // Month is fixed by the payroll run when one is linked; only direct payments can change it.
  let salaryMonth = tx.salary_month;
  if (params.salary_month !== undefined && params.salary_month !== '' && !tx.reference_id) {
    salaryMonth = normalizeSalaryMonth(params.salary_month);
    if (!salaryMonth) throw new Error('Salary month must be in YYYY-MM format');
  }

  await query(
    `UPDATE payment_transactions SET
      amount = $1, payment_date = $2, payment_method = $3, bank_account_id = $4,
      transaction_reference = $5, notes = $6, attachment_url = $7, employee_bank_snapshot = $8, salary_month = $9
     WHERE id = $10`,
    [newAmount, payDate, payMethod, bankAccId, txRef, notes, attachUrl, empBankSnap, salaryMonth, paymentTransactionId]
  );

  // Update voucher
  if (tx.voucher_id) {
    const accountRes = bankAccId ? await query('SELECT account_type FROM bank_accounts WHERE id = $1', [bankAccId]) : { rows: [] };
    const isCash = accountRes.rows[0]?.account_type === 'cash';
    const voucherType = isCash ? 'cash_payment' : 'bank_payment';
    await query(
      `UPDATE vouchers SET
        voucher_date = $1, amount = $2, credit_account_id = $3, voucher_type = $4,
        transaction_ref = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [payDate, newAmount, bankAccId, voucherType, txRef, tx.voucher_id]
    );
  }

  // Update payroll / salary_slip if linked
  if (tx.reference_id) {
    if (tx.reference_type === 'payroll') {
      await query(
        `UPDATE payroll SET payment_date=$1, payment_method=$2, transaction_reference=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$4`,
        [payDate, payMethod, txRef, tx.reference_id]
      );
    } else if (tx.reference_type === 'salary_slip') {
      await query(
        `UPDATE salary_slips SET paid_at=$1, payment_method=$2, transaction_reference=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$4`,
        [payDate, payMethod, txRef, tx.reference_id]
      );
    }
  }

  const updatedTx = await query('SELECT * FROM payment_transactions WHERE id = $1', [paymentTransactionId]);
  return updatedTx.rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE BANK ENTRY (voucher)
// ─────────────────────────────────────────────────────────────────────────────
async function updateBankEntry(voucherId, params, userId) {
  const existingRes = await query('SELECT * FROM vouchers WHERE id = $1', [voucherId]);
  if (existingRes.rows.length === 0) throw new Error('Bank entry not found');
  const existing = existingRes.rows[0];
  if (!['journal', 'contra'].includes(existing.voucher_type)) {
    throw new Error('This voucher is not a bank entry');
  }

  const { kind, bank_account_id, to_account_id, amount, entry_date, narration, transaction_ref } = params;
  const finalAmount = parseFloat(amount);
  if (isNaN(finalAmount) || finalAmount <= 0) throw new Error('A valid amount is required');
  const entryDate = entry_date || existing.voucher_date;
  const f = bankEntryVoucherFields({ kind, bank_account_id, to_account_id, narration });

  const result = await query(
    `UPDATE vouchers SET
      voucher_type = $1, voucher_date = $2, amount = $3, debit_account_id = $4,
      credit_account_id = $5, narration = $6, transaction_ref = $7, category = $8, updated_at = CURRENT_TIMESTAMP
     WHERE id = $9
     RETURNING *`,
    [f.voucherType, entryDate, finalAmount, f.debitAccountId || null, f.creditAccountId || null,
     f.narration, transaction_ref || null, f.category, voucherId]
  );
  return result.rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE BANK ENTRY (voucher)
// ─────────────────────────────────────────────────────────────────────────────
async function deleteBankEntry(voucherId, userId) {
  const existing = await query('SELECT * FROM vouchers WHERE id = $1', [voucherId]);
  if (existing.rows.length === 0) throw new Error('Bank entry not found');
  if (!['journal', 'contra'].includes(existing.rows[0].voucher_type)) {
    throw new Error('This voucher is not a bank entry');
  }
  if (existing.rows[0].status === 'cancelled') {
    throw new Error('Bank entry is already cancelled');
  }

  await query(
    `UPDATE vouchers SET status='cancelled', cancelled_by=$1, cancellation_date=CURRENT_TIMESTAMP, cancellation_reason=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$3`,
    [userId, 'Bank entry deleted', voucherId]
  );
  return { success: true };
}

module.exports = {
  recordClientReceipt,
  recordVendorPayment,
  recordSalaryPayment,
  recordBankEntry,
  resolveDefaultBankAccountId,
  deleteClientReceipt,
  deleteVendorPayment,
  deleteSalaryPayment,
  updateClientReceipt,
  updateVendorPayment,
  updateSalaryPayment,
  updateBankEntry,
  deleteBankEntry,
};
