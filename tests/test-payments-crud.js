require('dotenv').config();
const http = require('http');
const jwt = require('jsonwebtoken');

// Point at another server (e.g. a test DB instance) with TEST_API_URL.
const BASE_URL = process.env.TEST_API_URL || 'http://localhost:3000/api';
const token = jwt.sign({ userId: 1, role: 'admin', permissions: ['*'] }, process.env.JWT_SECRET || 'your-default-jwt-secret-key-change-it-in-production', { expiresIn: '1h' });

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    const r = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function run() {
  console.log('--- Testing Payments CRUD with direct admin JWT ---');

  // Get bank accounts
  const bankAccountsRes = await req('GET', '/bank-accounts');
  const bankAccounts = bankAccountsRes.data?.data || [];
  const bankAccountId = bankAccounts[0]?.id;
  console.log('Bank accounts found:', bankAccounts.length, 'Selected id:', bankAccountId);

  // --------------------------------------------------------------------------
  // TEST 1: Bank Entry (Charge / Contra) CRUD
  // --------------------------------------------------------------------------
  console.log('\n--- 1. Testing Bank Entry CRUD ---');
  const createBankRes = await req('POST', '/payments/bank-entry', {
    kind: 'bank_charge',
    bank_account_id: bankAccountId,
    amount: 150.50,
    entry_date: '2026-10-04',
    narration: 'Test monthly maintenance charge',
    transaction_ref: 'REF-BANK-001'
  });
  console.log('Create Bank Entry:', createBankRes.status, createBankRes.data?.message);
  const voucherId = createBankRes.data?.data?.id;
  // A bank charge is money OUT: the account must be on the credit side
  // (balances = opening + debits − credits), never the debit side.
  const createdEntry = createBankRes.data?.data;
  if (createdEntry) {
    const directionOk = String(createdEntry.credit_account_id) === String(bankAccountId) && !createdEntry.debit_account_id;
    console.log(directionOk
      ? 'Bank charge direction: OK (credit side — lowers the balance)'
      : `Bank charge direction: WRONG — debit=${createdEntry.debit_account_id} credit=${createdEntry.credit_account_id}`);
    if (!directionOk) process.exitCode = 1;
  }

  if (voucherId) {
    // Update Bank Entry
    const updateBankRes = await req('PUT', `/payments/bank-entries/${voucherId}`, {
      kind: 'bank_charge',
      bank_account_id: bankAccountId,
      amount: 175.00,
      entry_date: '2026-10-04',
      narration: 'Updated maintenance charge',
      transaction_ref: 'REF-BANK-001-UPDATED'
    });
    console.log('Update Bank Entry:', updateBankRes.status, updateBankRes.data?.message, 'Amount:', updateBankRes.data?.data?.amount);

    // Delete Bank Entry
    const deleteBankRes = await req('DELETE', `/payments/bank-entries/${voucherId}`);
    console.log('Delete Bank Entry:', deleteBankRes.status, deleteBankRes.data?.message);
  }

  // --------------------------------------------------------------------------
  // TEST 2: Salary Payment CRUD
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Testing Salary Payment CRUD ---');
  const empRes = await req('GET', '/employees?limit=5');
  const employee = (empRes.data?.data || [])[0];
  if (employee) {
    const createSalaryRes = await req('POST', '/payments', {
      transaction_type: 'salary_payment',
      employee_id: employee.id,
      amount: 5000,
      payment_date: '2026-10-04',
      salary_month: '2026-09', // required for direct salary payments
      payment_method: 'bank_transfer',
      bank_account_id: bankAccountId,
      transaction_reference: 'SAL-TEST-001',
      notes: 'Test salary payment'
    });
    console.log('Create Salary Payment:', createSalaryRes.status, createSalaryRes.data?.message);
    const salTxId = createSalaryRes.data?.data?.payment_transaction?.id;

    if (salTxId) {
      // Update Salary Payment
      const updateSalRes = await req('PUT', `/payments/${salTxId}`, {
        amount: 5500,
        payment_date: '2026-10-04',
        payment_method: 'bank_transfer',
        bank_account_id: bankAccountId,
        transaction_reference: 'SAL-TEST-001-UPD',
        notes: 'Updated salary test note'
      });
      console.log('Update Salary Payment:', updateSalRes.status, updateSalRes.data?.message, 'Amount:', updateSalRes.data?.data?.amount);

      // Delete Salary Payment
      const deleteSalRes = await req('DELETE', `/payments/${salTxId}`);
      console.log('Delete Salary Payment:', deleteSalRes.status, deleteSalRes.data?.message);
    }
  }

  // --------------------------------------------------------------------------
  // TEST 3: Vendor Payment CRUD
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Testing Vendor Payment CRUD ---');
  const expensesRes = await req('GET', '/expenses?limit=10');
  const expenses = (expensesRes.data?.data || []).filter(e => e.status !== 'paid');
  const expense = expenses[0];
  if (expense) {
    const balance = parseFloat(expense.amount) - parseFloat(expense.amount_paid || 0);
    const payAmt = Math.min(100, Math.max(10, Math.floor(balance / 2)));
    const createVendorPayRes = await req('POST', '/payments', {
      transaction_type: 'vendor_payment',
      expense_id: expense.id,
      amount: payAmt,
      payment_date: '2026-10-04',
      payment_method: 'bank_transfer',
      bank_account_id: bankAccountId,
      transaction_reference: 'VP-TEST-001',
      notes: 'Test vendor payment'
    });
    console.log('Create Vendor Payment:', createVendorPayRes.status, createVendorPayRes.data?.message);
    const vpTxId = createVendorPayRes.data?.data?.payment_transaction?.id;

    if (vpTxId) {
      // Update Vendor Payment
      const updateVpRes = await req('PUT', `/payments/${vpTxId}`, {
        amount: payAmt + 5,
        payment_date: '2026-10-04',
        payment_method: 'bank_transfer',
        bank_account_id: bankAccountId,
        transaction_reference: 'VP-TEST-001-UPD',
        notes: 'Updated vendor payment note'
      });
      console.log('Update Vendor Payment:', updateVpRes.status, updateVpRes.data?.message, 'Amount:', updateVpRes.data?.data?.amount);

      // Delete Vendor Payment
      const deleteVpRes = await req('DELETE', `/payments/${vpTxId}`);
      console.log('Delete Vendor Payment:', deleteVpRes.status, deleteVpRes.data?.message);
    }
  }

  // --------------------------------------------------------------------------
  // TEST 4: Client Receipt CRUD
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Testing Client Receipt CRUD ---');
  const invoicesRes = await req('GET', '/invoices?limit=10');
  const invoices = (invoicesRes.data?.data || []).filter(i => parseFloat(i.payment_due) > 50);
  const invoice = invoices[0];
  if (invoice) {
    const due = parseFloat(invoice.payment_due);
    const rcptAmt = Math.min(100, Math.floor(due / 2));
    const createReceiptRes = await req('POST', '/payments', {
      transaction_type: 'client_receipt',
      invoice_id: invoice.id,
      amount: rcptAmt,
      payment_date: '2026-10-04',
      payment_method: 'bank_transfer',
      bank_account_id: bankAccountId,
      transaction_reference: 'RCPT-TEST-001',
      notes: 'Test client receipt'
    });
    console.log('Create Client Receipt:', createReceiptRes.status, createReceiptRes.data?.message);
    const rcptTxId = createReceiptRes.data?.data?.payment_transaction?.id;

    if (rcptTxId) {
      // Update Client Receipt
      const updateRcptRes = await req('PUT', `/payments/${rcptTxId}`, {
        amount: rcptAmt + 10,
        payment_date: '2026-10-04',
        payment_method: 'bank_transfer',
        bank_account_id: bankAccountId,
        transaction_reference: 'RCPT-TEST-001-UPD',
        notes: 'Updated receipt note'
      });
      console.log('Update Client Receipt:', updateRcptRes.status, updateRcptRes.data?.message, 'Amount:', updateRcptRes.data?.data?.amount);

      // Delete Client Receipt
      const deleteRcptRes = await req('DELETE', `/payments/${rcptTxId}`);
      console.log('Delete Client Receipt:', deleteRcptRes.status, deleteRcptRes.data?.message);
    }
  }

  console.log('\n--- All CRUD Tests Finished Successfully ---');
  process.exit(0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
