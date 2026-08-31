require('dotenv').config();
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { initDB, query } = require('../src/database/connection');
const backupService = require('../src/services/backupService');

async function testBackupAndLogo() {
  console.log('\n================================================================');
  console.log('   🧪 UNIT TESTS: DATABASE BACKUP & AGENCY SETTINGS');
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

    // ── Test 1: Agency Logo Settings in DB ────────────────────────────────────
    try {
      const testLogoUrl = '/uploads/agency_logo_test_123.png';
      const currentSettingsRes = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'");
      let agencySettings = {};
      if (currentSettingsRes.rows.length > 0) {
        try { agencySettings = JSON.parse(currentSettingsRes.rows[0].setting_value); } catch(_) {}
      }
      agencySettings.agency_logo_url = testLogoUrl;

      await query(
        `INSERT INTO system_settings (setting_key, setting_value, updated_at)
         VALUES ('agency_settings', $1, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE setting_value = $1, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify(agencySettings)]
      );

      const verifyRes = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'");
      const saved = JSON.parse(verifyRes.rows[0].setting_value);
      assert.strictEqual(saved.agency_logo_url, testLogoUrl);
      logPass('Agency logo settings updated and retrieved from system_settings');
    } catch (err) {
      logFail('Agency logo test', err);
    }

    // ── Test 2: Trigger Manual Database Backup ────────────────────────────────
    let backupFile = null;
    try {
      const backupResult = await backupService.createBackup();
      assert(backupResult && backupResult.filename, 'Backup must return filename');
      assert(fs.existsSync(backupResult.path), 'Backup zip file must exist on disk');
      assert(backupResult.sizeBytes > 0, 'Backup file size must be > 0 bytes');
      backupFile = backupResult.filename;
      logPass(`Manual database backup generated: ${backupResult.filename} (${backupResult.sizeBytes} bytes)`);
    } catch (err) {
      logFail('Manual backup creation', err);
    }

    // ── Test 3: List Available Backups ─────────────────────────────────────────
    try {
      const available = await backupService.getAvailableBackups();
      assert(Array.isArray(available), 'Backups list must be an array');
      assert(available.length > 0, 'Must contain at least 1 backup');
      const found = available.find(b => b.filename === backupFile);
      assert(found, 'Newly created backup must appear in available backups list');
      logPass(`Backup list verified successfully (${available.length} backups listed)`);
    } catch (err) {
      logFail('Backup list test', err);
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

testBackupAndLogo();
