require('dotenv').config();
const assert = require('assert');
const { initDB, query } = require('../src/database/connection');
const { generateInvoicePDF } = require('../src/utils/pdfGenerator');

async function runPDFTests() {
  console.log('\n================================================================');
  console.log('   🧪 UNIT TESTS: INVOICE PDF GENERATION (PAID & PENDING)');
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
    assert(clientRes.rows.length > 0, 'Must have at least one client for testing');
    const client = clientRes.rows[0];

    const agencySetting = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'");
    const agencySettings = agencySetting.rows.length > 0 ? JSON.parse(agencySetting.rows[0].setting_value) : {
      agency_name: 'EAGLE EYE SECURITY SERVICE',
      gst_number: '24AVYPP2011K1ZB'
    };

    // ── Test 1: Generate PDF for Payment Status = 'pending' (Unpaid Invoice) ─
    try {
      const pendingInvoice = {
        id: 9991,
        invoice_number: 'INV-2608-TEST1',
        invoice_date: '2026-08-31',
        billing_period_start: '2026-08-01',
        billing_period_end: '2026-08-31',
        amount_subtotal: 45000,
        tax_type: 'cgst_sgst',
        tax_rate: 18,
        sgst_amount: 4050,
        cgst_amount: 4050,
        igst_amount: 0,
        final_amount: 53100,
        payment_status: 'pending',
        is_ad_hoc: 0,
        notes: 'Monthly Security Services - Pending'
      };

      const chunks = [];
      await new Promise((resolve, reject) => {
        generateInvoicePDF(
          pendingInvoice,
          client,
          agencySettings,
          (chunk) => chunks.push(chunk),
          () => resolve()
        );
      });

      const pdfBuffer = Buffer.concat(chunks);
      assert(pdfBuffer.length > 1000, 'PDF buffer must contain generated data');
      assert(pdfBuffer.toString('utf8', 0, 5) === '%PDF-', 'Buffer must have PDF magic header %PDF-');
      logPass('PDF generated successfully for unpaid / payment pending invoice');
    } catch (err) {
      logFail('Pending invoice PDF generation', err);
    }

    // ── Test 2: Generate PDF for Payment Status = 'paid' ─────────────────────
    try {
      const paidInvoice = {
        id: 9992,
        invoice_number: 'INV-2608-TEST2',
        invoice_date: '2026-08-31',
        billing_period_start: '2026-08-01',
        billing_period_end: '2026-08-31',
        amount_subtotal: 60000,
        tax_type: 'igst',
        tax_rate: 18,
        sgst_amount: 0,
        cgst_amount: 0,
        igst_amount: 10800,
        final_amount: 70800,
        payment_status: 'paid',
        is_ad_hoc: 0,
        notes: 'Monthly Security Services - Paid in Full'
      };

      const chunks = [];
      await new Promise((resolve, reject) => {
        generateInvoicePDF(
          paidInvoice,
          client,
          agencySettings,
          (chunk) => chunks.push(chunk),
          () => resolve()
        );
      });

      const pdfBuffer = Buffer.concat(chunks);
      assert(pdfBuffer.length > 1000);
      assert(pdfBuffer.toString('utf8', 0, 5) === '%PDF-');
      logPass('PDF generated successfully for paid invoice');
    } catch (err) {
      logFail('Paid invoice PDF generation', err);
    }

    // ── Test 3: Generate PDF for Event / Ad-hoc Invoice ─────────────────────
    try {
      const eventInvoice = {
        id: 9993,
        invoice_number: 'INV-EVT-2608-01',
        invoice_date: '2026-08-31',
        billing_period_start: '2026-08-30',
        billing_period_end: '2026-08-30',
        amount_subtotal: 15000,
        tax_type: 'none',
        tax_rate: 0,
        sgst_amount: 0,
        cgst_amount: 0,
        igst_amount: 0,
        final_amount: 15000,
        payment_status: 'partial',
        is_ad_hoc: 1,
        guards_count: 5,
        duty_days_worked: 1,
        notes: 'Corporate Event Security'
      };

      const chunks = [];
      await new Promise((resolve, reject) => {
        generateInvoicePDF(
          eventInvoice,
          client,
          agencySettings,
          (chunk) => chunks.push(chunk),
          () => resolve()
        );
      });

      const pdfBuffer = Buffer.concat(chunks);
      assert(pdfBuffer.length > 1000);
      assert(pdfBuffer.toString('utf8', 0, 5) === '%PDF-');
      logPass('PDF generated successfully for event / ad-hoc invoice');
    } catch (err) {
      logFail('Event invoice PDF generation', err);
    }

    console.log('\n================================================================');
    console.log(`   🏁 RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    process.exit(failed === 0 ? 0 : 1);
  } catch (globalErr) {
    console.error('Global PDF test error:', globalErr);
    process.exit(1);
  }
}

runPDFTests();
