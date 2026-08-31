require('dotenv').config();
const assert = require('assert');
const { initDB, query } = require('../src/database/connection');

async function testMonthlyInvoice() {
  console.log('\n================================================================');
  console.log('   🧪 UNIT TESTS: MONTHLY INVOICE CREATION & CALCULATIONS');
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

    const clientRes = await query('SELECT * FROM clients LIMIT 1');
    assert(clientRes.rows.length > 0, 'Must have at least one active client');
    const client = clientRes.rows[0];

    // ── Test 1: Monthly Invoice with Intra-state GST (9% CGST + 9% SGST) ─────
    try {
      const invNum = `INV-TST-MTH-${Date.now().toString().slice(-4)}`;
      const subtotal = parseFloat(client.monthly_rate) || 50000;
      const discount = 1000;
      const taxable = subtotal - discount;
      const cgst = taxable * 0.09;
      const sgst = taxable * 0.09;
      const finalAmount = taxable + cgst + sgst;

      const res = await query(
        `INSERT INTO invoices 
         (invoice_number, client_id, invoice_date, due_date, billing_period_start, billing_period_end,
          amount_subtotal, discount_amount, tax_type, tax_rate, cgst_amount, sgst_amount, igst_amount,
          final_amount, total_amount, payment_due, status, is_rcm_applicable, is_ad_hoc, notes)
         VALUES ($1, $2, '2026-08-31', '2026-09-30', '2026-08-01', '2026-08-31',
                 $3, $4, 'cgst_sgst', 18, $5, $6, 0, $7, $7, $7, 'draft', 0, 0, 'Monthly Test')`,
        [invNum, client.id, subtotal, discount, cgst, sgst, finalAmount]
      );

      const check = await query('SELECT * FROM invoices WHERE invoice_number = $1', [invNum]);
      assert(check.rows.length > 0);
      assert.strictEqual(parseFloat(check.rows[0].discount_amount), 1000);
      assert.strictEqual(parseFloat(check.rows[0].final_amount), finalAmount);
      logPass('Monthly Invoice with client selection, dates, discounts & GST inserted accurately');

      // Cleanup
      await query('DELETE FROM invoices WHERE invoice_number = $1', [invNum]);
    } catch (err) {
      logFail('Monthly invoice creation test', err);
    }

    console.log('\n================================================================');
    console.log(`   🏁 RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    process.exit(failed === 0 ? 0 : 1);
  } catch (globalErr) {
    console.error('Global error:', globalErr);
    process.exit(1);
  }
}

testMonthlyInvoice();
