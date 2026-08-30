require('dotenv').config();
const assert = require('assert');
const { initDB, query } = require('../src/database/connection');
const { calculateInvoiceAmounts } = require('../src/routes/invoices');

async function runTests() {
  console.log('\n================================================================');
  console.log('   🧪 UNIT TESTS: INVOICING, DATES & VENDOR LEDGER FIXES');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function logPass(name) {
    passed++;
    console.log(`✅ PASS: ${name}`);
  }

  function logFail(name, err) {
    failed++;
    console.error(`❌ FAIL: ${name}`, err.message);
  }

  try {
    await initDB();

    // ── Test 1: Monthly Invoice Calculations with Intra-State GST (CGST+SGST) ─
    try {
      const calc1 = calculateInvoiceAmounts(10000, '2026-08-01', '2026-08-31', 'cgst_sgst', 0, false);
      assert.strictEqual(calc1.amount_subtotal, 10000);
      assert.strictEqual(calc1.cgst_amount, 900);
      assert.strictEqual(calc1.sgst_amount, 900);
      assert.strictEqual(calc1.igst_amount, 0);
      assert.strictEqual(calc1.total_amount, 11800);
      assert.strictEqual(calc1.final_amount, 11800);
      logPass('calculateInvoiceAmounts correctly computes Intra-state CGST(9%) + SGST(9%) for monthly invoice');
    } catch (err) {
      logFail('Monthly Invoice Intra-State GST', err);
    }

    // ── Test 2: Monthly Invoice Calculations with Inter-State IGST ────────────
    try {
      const calc2 = calculateInvoiceAmounts(20000, '2026-08-01', '2026-08-31', 'igst', 1000, false);
      assert.strictEqual(calc2.amount_subtotal, 20000);
      // Taxable = 20000 - 1000 = 19000. IGST (18%) = 3420. Total = 19000 + 3420 = 22420.
      assert.strictEqual(calc2.cgst_amount, 0);
      assert.strictEqual(calc2.sgst_amount, 0);
      assert.strictEqual(calc2.igst_amount, 3420);
      assert.strictEqual(calc2.total_amount, 22420);
      assert.strictEqual(calc2.final_amount, 22420);
      logPass('calculateInvoiceAmounts correctly computes Inter-state IGST(18%) on taxable amount after discount');
    } catch (err) {
      logFail('Monthly Invoice IGST with discount', err);
    }

    // ── Test 3: Reverse Charge Mechanism (RCM) Behavior ─────────────────────
    try {
      const calcRcm = calculateInvoiceAmounts(15000, '2026-08-01', '2026-08-31', 'cgst_sgst', 0, true);
      assert.strictEqual(calcRcm.cgst_amount, 1350);
      assert.strictEqual(calcRcm.sgst_amount, 1350);
      // Under RCM, GST is reported but customer is billed only subtotal
      assert.strictEqual(calcRcm.total_amount, 15000);
      assert.strictEqual(calcRcm.final_amount, 15000);
      logPass('calculateInvoiceAmounts RCM correctly sets billed total to subtotal while computing GST');
    } catch (err) {
      logFail('RCM Invoice Calculation', err);
    }

    // ── Test 4: Custom Invoice Date & Event Invoice Persistence ──────────────
    try {
      const customInvDate = '2026-08-15';
      const customEventDate = '2026-08-12';
      
      // Ensure test client exists
      let clientRes = await query("SELECT id FROM clients WHERE name = 'Unit Test Client Corp'");
      let clientId;
      if (clientRes.rows.length === 0) {
        await query(
          "INSERT INTO clients (name, address, city, state, email, phone, monthly_rate, contract_start_date, is_active) " +
          "VALUES ('Unit Test Client Corp', '123 Test St', 'Ahmedabad', 'Gujarat', 'test@corp.com', '9876543210', 12000, '2026-01-01', 1)"
        );
        const refetch = await query("SELECT id FROM clients WHERE name = 'Unit Test Client Corp'");
        clientId = refetch.rows[0].id;
      } else {
        clientId = clientRes.rows[0].id;
      }

      // Insert event invoice with explicit dates
      const invNum = `INV-TEST-EVT-${Date.now().toString().slice(-6)}`;
      await query(
        `INSERT INTO invoices (
          invoice_number, client_id, invoice_date, due_date,
          billing_period_start, billing_period_end,
          amount_subtotal, total_amount, final_amount, payment_due,
          tax_type, cgst_amount, sgst_amount, igst_amount, is_rcm_applicable,
          duty_days_worked, is_ad_hoc, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 1, $17)`,
        [
          invNum, clientId, customInvDate, '2026-09-15',
          customEventDate, customEventDate,
          3000, 3540, 3540, 3540,
          'cgst_sgst', 270, 270, 0, 0,
          2, 'Unit Test Event Invoice'
        ]
      );

      const fetchInv = await query("SELECT * FROM invoices WHERE invoice_number = $1", [invNum]);
      assert(fetchInv.rows.length > 0, 'Saved invoice must exist in database');
      const savedInv = fetchInv.rows[0];
      const savedDateStr = new Date(savedInv.invoice_date).toISOString().split('T')[0];
      const savedPeriodStartStr = new Date(savedInv.billing_period_start).toISOString().split('T')[0];
      assert.strictEqual(savedDateStr, customInvDate, 'Saved invoice date must match custom input');
      assert.strictEqual(savedPeriodStartStr, customEventDate, 'Saved event date must match custom input');
      logPass('Event Invoice correctly stores custom invoice_date and event_date in database');

      // Clean up test invoice
      await query('DELETE FROM invoices WHERE id = $1', [savedInv.id]);
    } catch (err) {
      logFail('Event Invoice Custom Dates Persistence', err);
    }

    // ── Test 5: Vendor Statement Data & Date Formatting Integrity ───────────
    try {
      let vendorRes = await query("SELECT id FROM vendors WHERE name = 'Unit Test Vendor'");
      let vendorId;
      if (vendorRes.rows.length === 0) {
        await query(
          "INSERT INTO vendors (name, contact_info, payment_terms_days, is_active) " +
          "VALUES ('Unit Test Vendor', 'testvendor@supplies.com', 30, 1)"
        );
        const refetchV = await query("SELECT id FROM vendors WHERE name = 'Unit Test Vendor'");
        vendorId = refetchV.rows[0].id;
      } else {
        vendorId = vendorRes.rows[0].id;
      }

      // Add a test expense with custom date
      const testExpenseDate = '2026-08-20';
      await query(
        "INSERT INTO expenses (expense_date, category, description, amount, payment_method, vendor_id, status) " +
        "VALUES ($1, 'supplies', 'Security uniform badges', 4500, 'bank_transfer', $2, 'approved')",
        [testExpenseDate, vendorId]
      );

      // Verify vendor statement query
      const stmtExpenses = await query('SELECT * FROM expenses WHERE vendor_id = $1', [vendorId]);
      assert(stmtExpenses.rows.length > 0);
      const savedExp = stmtExpenses.rows[0];
      assert(savedExp.expense_date !== null, 'Expense date must not be null');
      const expDateStr = new Date(savedExp.expense_date).toISOString().split('T')[0];
      assert.strictEqual(expDateStr, testExpenseDate);
      logPass('Vendor ledger statement query properly fetches expenses with valid expense_date');

      // Clean up test expense and vendor
      await query('DELETE FROM expenses WHERE id = $1', [savedExp.id]);
      await query('DELETE FROM vendors WHERE id = $1', [vendorId]);
    } catch (err) {
      logFail('Vendor Statement Date Integrity', err);
    }

    console.log('\n================================================================');
    console.log(`   🏁 RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    process.exit(failed === 0 ? 0 : 1);
  } catch (globalErr) {
    console.error('Global test error:', globalErr);
    process.exit(1);
  }
}

runTests();
