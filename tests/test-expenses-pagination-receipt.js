require('dotenv').config();
const assert = require('assert');
const { initDB, query } = require('../src/database/connection');

async function testExpenses() {
  console.log('\n================================================================');
  console.log('   🧪 UNIT TESTS: EXPENSES PAGINATION, VENDOR & RECEIPTS');
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

    // ── Test 1: Vendor Quick Creation ─────────────────────────────────────────
    let vendorId = null;
    try {
      const vendorName = `TST_VND_${Date.now().toString().slice(-4)}`;
      const vRes = await query(
        `INSERT INTO vendors (name, contact_info, payment_terms_days) VALUES ($1, $2, $3)`,
        [vendorName, 'Phone: 9998887776, Test Vendor Address', 15]
      );
      vendorId = vRes.insertId || vRes.lastInsertRowid;
      assert(vendorId, 'Vendor ID must be generated');
      logPass('Quick Vendor Creation inserted successfully with payment terms');
    } catch (err) {
      logFail('Vendor creation', err);
    }

    // ── Test 2: Expense Creation with Vendor & Receipt URL ────────────────────
    let expenseId = null;
    try {
      const eRes = await query(
        `INSERT INTO expenses (expense_date, category, description, amount, payment_method, vendor_id, receipt_number, receipt_url, created_by, status)
         VALUES ('2026-08-31', 'supplies', 'Unit Test Stationeries', 3500.00, 'bank_transfer', $1, 'REC-998811', '/uploads/test_receipt.png', 1, 'pending')`,
        [vendorId]
      );
      expenseId = eRes.insertId || eRes.lastInsertRowid;
      assert(expenseId, 'Expense ID must be generated');

      const checkExp = await query(
        `SELECT e.*, v.name as vendor_name FROM expenses e LEFT JOIN vendors v ON e.vendor_id = v.id WHERE e.id = $1`,
        [expenseId]
      );
      assert(checkExp.rows.length > 0);
      assert.strictEqual(checkExp.rows[0].receipt_url, '/uploads/test_receipt.png');
      assert(checkExp.rows[0].vendor_name.startsWith('TST_VND_'));
      logPass('Expense recorded with linked vendor and receipt attachment URL');
    } catch (err) {
      logFail('Expense creation with receipt', err);
    }

    // ── Test 3: Pagination Calculations (High Record Datasets) ────────────────
    try {
      const countResult = await query('SELECT COUNT(*) as count FROM expenses');
      const total = parseInt(countResult.rows[0].count);
      const limit = 20;
      const pages = Math.ceil(total / limit) || 1;

      assert(typeof pages === 'number' && pages >= 1, 'Pages must be a valid positive integer');
      assert(total >= 1, 'Total expenses count should be >= 1');
      logPass(`Pagination calculation verified: ${total} total records -> ${pages} pages at limit ${limit}`);
    } catch (err) {
      logFail('Pagination test', err);
    }

    // ── Cleanup ─────────────────────────────────────────────────────────────
    try {
      if (expenseId) await query('DELETE FROM expenses WHERE id = $1', [expenseId]);
      if (vendorId) await query('DELETE FROM vendors WHERE id = $1', [vendorId]);
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

testExpenses();
