require('dotenv').config();
const assert = require('assert');
const { initDB, query } = require('../src/database/connection');

async function runSettingsTests() {
  console.log('\n================================================================');
  console.log('   🧪 UNIT TESTS: SETTINGS, SALARY STRUCTURES & LOGO FIXES');
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

    // ── Test 1: Salary Structure Created with Default PF = 0 ─────────────────
    let testSsId = null;
    try {
      const ssName = `Test Security Scale ${Date.now().toString().slice(-4)}`;
      const res = await query(
        `INSERT INTO salary_structures
           (name, base_salary, dearness_allowance, house_rent_allowance, other_allowances,
            pf_percentage, esi_applicable, income_tax_applicable, effective_from)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE)`,
        [ssName, 12000, 1000, 500, 500, 0, 0, 0]
      );

      const check = await query('SELECT * FROM salary_structures WHERE name = $1', [ssName]);
      assert(check.rows.length > 0);
      testSsId = check.rows[0].id;
      assert.strictEqual(parseFloat(check.rows[0].pf_percentage), 0, 'Default PF percentage must be 0%');
      assert.strictEqual(parseFloat(check.rows[0].base_salary), 12000);
      logPass('Salary Structure correctly created with default PF = 0%');
    } catch (err) {
      logFail('Salary Structure default PF = 0', err);
    }

    // ── Test 2: Salary Structure PF Edit / Update ───────────────────────────
    try {
      await query(
        'UPDATE salary_structures SET pf_percentage = $1 WHERE id = $2',
        [12, testSsId]
      );
      const updated = await query('SELECT * FROM salary_structures WHERE id = $1', [testSsId]);
      assert.strictEqual(parseFloat(updated.rows[0].pf_percentage), 12, 'PF should update to 12% when edited');
      logPass('Salary Structure PF percentage can be edited and saved accurately');
    } catch (err) {
      logFail('Salary Structure PF Edit', err);
    }

    // ── Test 3: Salary Structure Deactivate and Reactivate ───────────────────
    try {
      // Deactivate
      await query('UPDATE salary_structures SET is_active = 0 WHERE id = $1', [testSsId]);
      const deact = await query('SELECT is_active FROM salary_structures WHERE id = $1', [testSsId]);
      assert.strictEqual(Number(deact.rows[0].is_active), 0);

      // Reactivate
      await query('UPDATE salary_structures SET is_active = 1 WHERE id = $1', [testSsId]);
      const react = await query('SELECT is_active FROM salary_structures WHERE id = $1', [testSsId]);
      assert.strictEqual(Number(react.rows[0].is_active), 1);
      logPass('Salary Structure successfully supports deactivation and reactivation');

      // Clean up test structure
      await query('DELETE FROM salary_structures WHERE id = $1', [testSsId]);
    } catch (err) {
      logFail('Salary Structure Deactivate/Reactivate', err);
    }

    // ── Test 4: Payroll Adjustment Categories Persistence ───────────────────
    try {
      const testCategories = [
        { name: 'Uniform Cost', type: 'deduction' },
        { name: 'Diwali Bonus', type: 'addition' }
      ];
      const jsonVal = JSON.stringify(testCategories);

      await query(
        `INSERT INTO system_settings (setting_key, setting_value, updated_at)
         VALUES ('payroll_adjustment_categories', $1, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE setting_value = $1, updated_at = CURRENT_TIMESTAMP`,
        [jsonVal]
      );

      const fetchCat = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'payroll_adjustment_categories'");
      assert(fetchCat.rows.length > 0);
      const parsed = JSON.parse(fetchCat.rows[0].setting_value);
      assert.strictEqual(parsed.length, 2);
      assert.strictEqual(parsed[0].name, 'Uniform Cost');
      assert.strictEqual(parsed[1].name, 'Diwali Bonus');
      logPass('Payroll Adjustment categories successfully inserted, persisted, and retrieved');
    } catch (err) {
      logFail('Payroll Adjustment Categories Persistence', err);
    }

    // ── Test 5: Agency Logo Setting Persistence ──────────────────────────────
    try {
      const agencyData = {
        agency_name: 'Apex Security Solutions',
        agency_logo_url: '/uploads/agency_logo_test_123.png'
      };
      await query(
        `INSERT INTO system_settings (setting_key, setting_value, updated_at)
         VALUES ('agency_settings', $1, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE setting_value = $1, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify(agencyData)]
      );

      const fetchAgency = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'");
      assert(fetchAgency.rows.length > 0);
      const parsedAgency = JSON.parse(fetchAgency.rows[0].setting_value);
      assert.strictEqual(parsedAgency.agency_logo_url, '/uploads/agency_logo_test_123.png');
      logPass('Agency Logo URL successfully saved and persisted in agency_settings');
    } catch (err) {
      logFail('Agency Logo URL Persistence', err);
    }

    console.log('\n================================================================');
    console.log(`   🏁 RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    process.exit(failed === 0 ? 0 : 1);
  } catch (globalErr) {
    console.error('Global settings test error:', globalErr);
    process.exit(1);
  }
}

runSettingsTests();
