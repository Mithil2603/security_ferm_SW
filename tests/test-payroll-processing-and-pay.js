require('dotenv').config();
const assert = require('assert');
const { initDB, query } = require('../src/database/connection');
const salarySlipService = require('../src/services/payroll/salarySlipService');

async function runPayrollTests() {
  console.log('\n================================================================');
  console.log('   🧪 UNIT TESTS: PAYROLL PROCESSING & MARK AS PAID');
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

    const empRes = await query('SELECT * FROM employees WHERE is_active = 1 LIMIT 1');
    assert(empRes.rows.length > 0, 'Must have at least one active employee for payroll test');
    const employee = empRes.rows[0];

    const testMonth = '2026-08';

    // ── Test 1: Single Salary Slip Generation ─────────────────────────────────
    let slipId = null;
    try {
      // Clean previous slip if exists
      await query('DELETE FROM salary_slips WHERE employee_id = $1 AND payroll_month = $2', [employee.id, testMonth]);

      const slip = await salarySlipService.generate(employee.id, testMonth, 26, 1);
      assert(slip && slip.id, 'Slip ID must be returned');
      assert.strictEqual(slip.status, 'draft');
      slipId = slip.id;
      logPass('Single salary slip generated successfully in draft status');
    } catch (err) {
      logFail('Single salary slip generation', err);
    }

    // ── Test 2: Status Transition Workflow (Draft -> Pending -> Approved) ────
    try {
      await salarySlipService.submitForApproval(slipId);
      const pendingCheck = await salarySlipService.findById(slipId);
      assert.strictEqual(pendingCheck.status, 'pending');

      await salarySlipService.approve(slipId, 1);
      const approvedCheck = await salarySlipService.findById(slipId);
      assert.strictEqual(approvedCheck.status, 'approved');
      logPass('Salary slip approval workflow (draft -> pending -> approved) verified');
    } catch (err) {
      logFail('Approval workflow', err);
    }

    // ── Test 3: Mark As Paid with Date, Method & Reference ───────────────────
    try {
      const payDetails = {
        payment_method: 'upi',
        transaction_reference: 'UPI/20260831/987654321',
        payment_date: '2026-08-31'
      };

      const paidSlip = await salarySlipService.markPaid(slipId, payDetails);
      assert.strictEqual(paidSlip.status, 'paid');
      assert.strictEqual(paidSlip.payment_method, 'upi');
      assert.strictEqual(paidSlip.transaction_reference, 'UPI/20260831/987654321');
      assert(paidSlip.paid_at, 'paid_at date must be recorded');
      logPass('Salary slip successfully marked as paid with payment date, method & reference');
    } catch (err) {
      logFail('Mark as paid test', err);
    }

    // ── Cleanup ─────────────────────────────────────────────────────────────
    try {
      if (slipId) {
        await query('DELETE FROM salary_slip_components WHERE salary_slip_id = $1', [slipId]);
        await query('DELETE FROM salary_slips WHERE id = $1', [slipId]);
      }
    } catch (_) {}

    console.log('\n================================================================');
    console.log(`   🏁 RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    process.exit(failed === 0 ? 0 : 1);
  } catch (globalErr) {
    console.error('Global error:', globalErr);
    process.exit(1);
  }
}

runPayrollTests();
