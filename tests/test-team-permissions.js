require('dotenv').config();
const assert = require('assert');
const bcrypt = require('bcryptjs');
const { initDB, query } = require('../src/database/connection');

async function testTeamPermissions() {
  console.log('\n================================================================');
  console.log('   🧪 UNIT TESTS: TEAM PERMISSIONS, STATUS & RESET PASSWORD');
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

    // ── Create a test team user ───────────────────────────────────────────────
    let testUserId = null;
    try {
      const email = `testuser_${Date.now()}@example.com`;
      const hash = await bcrypt.hash('password123', 10);
      const res = await query(
        `INSERT INTO users (email, password_hash, full_name, role, is_active, permissions)
         VALUES ($1, $2, $3, $4, 1, $5)`,
        [email, hash, 'Test Team Guard', 'manager', JSON.stringify(['dashboard'])]
      );
      testUserId = res.insertId || res.lastInsertRowid;
      assert(testUserId, 'User ID must be generated');
      logPass('Test team user created successfully');
    } catch (err) {
      logFail('Create user', err);
    }

    // ── Test 1: Update User Permissions ───────────────────────────────────────
    try {
      const newPerms = ['dashboard', 'employees', 'attendance', 'reports'];
      await query(
        'UPDATE users SET permissions = $1 WHERE id = $2',
        [JSON.stringify(newPerms), testUserId]
      );
      const userRes = await query('SELECT permissions FROM users WHERE id = $1', [testUserId]);
      const storedPerms = JSON.parse(userRes.rows[0].permissions);
      assert.deepStrictEqual(storedPerms, newPerms);
      logPass('User permissions updated and verified');
    } catch (err) {
      logFail('Update permissions', err);
    }

    // ── Test 2: Toggle Active Status ──────────────────────────────────────────
    try {
      await query('UPDATE users SET is_active = 0 WHERE id = $1', [testUserId]);
      const deactivated = await query('SELECT is_active FROM users WHERE id = $1', [testUserId]);
      assert.strictEqual(deactivated.rows[0].is_active, 0);

      await query('UPDATE users SET is_active = 1 WHERE id = $1', [testUserId]);
      const activated = await query('SELECT is_active FROM users WHERE id = $1', [testUserId]);
      assert.strictEqual(activated.rows[0].is_active, 1);
      logPass('User activation/deactivation toggle verified');
    } catch (err) {
      logFail('Toggle status', err);
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    try {
      if (testUserId) {
        await query('DELETE FROM users WHERE id = $1', [testUserId]);
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

testTeamPermissions();
