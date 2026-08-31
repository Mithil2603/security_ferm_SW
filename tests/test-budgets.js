const assert = require('assert');
const { initDB, query } = require('../src/database/connection');

async function runBudgetTests() {
  console.log('\n================================================================');
  console.log('   🧪 UNIT TESTS: BUDGETS & ACTUALS');
  console.log('================================================================\n');

  await initDB();

  // 1. Create a test budget
  const insertResult = await query(`
    INSERT INTO budgets (name, financial_year, entity_type, entity_id, budget_category, amount, period_start, period_end, total_expense_budget)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    'Test Operations Budget',
    '2026-27',
    'internal',
    null,
    'Operations',
    100000,
    '2026-04-01',
    '2027-03-31',
    100000
  ]);

  assert(insertResult.insertId, 'InsertId should be returned');
  const budgetId = insertResult.insertId;
  console.log(`✅ PASS: Budget created successfully (ID: ${budgetId})`);

  // 2. Fetch budgets
  const fetchResult = await query('SELECT * FROM budgets WHERE id = $1', [budgetId]);
  assert.strictEqual(fetchResult.rows.length, 1, 'Should find created budget');
  assert.strictEqual(fetchResult.rows[0].entity_type, 'internal');
  assert.strictEqual(parseFloat(fetchResult.rows[0].amount), 100000);
  console.log('✅ PASS: Budget retrieved and verified');

  // 3. Clean up
  await query('DELETE FROM budgets WHERE id = $1', [budgetId]);
  const checkDelete = await query('SELECT * FROM budgets WHERE id = $1', [budgetId]);
  assert.strictEqual(checkDelete.rows.length, 0, 'Budget should be deleted');
  console.log('✅ PASS: Budget deletion verified');

  console.log('\n================================================================');
  console.log('   🏁 RESULTS: ALL BUDGET TESTS PASSED');
  console.log('================================================================\n');
}

runBudgetTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
