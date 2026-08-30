require('dotenv').config();
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { initDB, query } = require('../src/database/connection');
const backupService = require('../src/services/backupService');
const { timeToCron, rescheduleBackupJob } = require('../src/utils/backupJob');

async function runBackupUnitTests() {
  console.log('\n======================================================');
  console.log('   🧪 UNIT TESTS: DATABASE BACKUP & SCHEDULE SYSTEM');
  console.log('======================================================\n');

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

    // ── Test 1: Time to Cron Converter ──────────────────────────────────────
    try {
      assert.strictEqual(timeToCron('02:00', 'daily'), '0 2 * * *');
      assert.strictEqual(timeToCron('20:30', 'daily'), '30 20 * * *');
      assert.strictEqual(timeToCron('08:15', 'weekly'), '15 8 * * 0');
      logPass('timeToCron correctly formats daily and weekly cron expressions');
    } catch (err) {
      logFail('timeToCron formatting', err);
    }

    // ── Test 2: Get and Save Backup Settings ─────────────────────────────────
    const testCustomDir = path.join(process.cwd(), 'backups_test_destination');
    try {
      const saved = await backupService.saveBackupSettings({
        backup_destination_path: testCustomDir,
        auto_backup_enabled: true,
        auto_backup_time: '21:00',
        auto_backup_frequency: 'daily',
        allowed_roles: ['admin', 'manager']
      });

      assert.strictEqual(saved.backup_destination_path, testCustomDir);
      assert.strictEqual(saved.auto_backup_time, '21:00');
      assert.strictEqual(saved.allowed_roles.includes('manager'), true);

      const retrieved = await backupService.getBackupSettings();
      assert.strictEqual(retrieved.backup_destination_path, testCustomDir);
      assert.strictEqual(retrieved.auto_backup_time, '21:00');
      assert(fs.existsSync(testCustomDir), 'Destination directory should exist');
      logPass('saveBackupSettings & getBackupSettings successfully store and retrieve configuration');
    } catch (err) {
      logFail('saveBackupSettings & getBackupSettings', err);
    }

    // ── Test 3: Reschedule Backup Job ────────────────────────────────────────
    try {
      await rescheduleBackupJob();
      logPass('rescheduleBackupJob dynamic cron restart completes without errors');
    } catch (err) {
      logFail('rescheduleBackupJob', err);
    }

    // ── Test 4: Manual Backup Creation in Custom Directory ───────────────────
    let createdBackup = null;
    try {
      createdBackup = await backupService.createBackup(testCustomDir);
      assert(createdBackup.filename.startsWith('backup-'), 'Filename should start with backup-');
      assert(createdBackup.filename.endsWith('.zip'), 'File should be a .zip');
      assert(fs.existsSync(createdBackup.path), 'Backup zip file must exist on disk');
      assert(createdBackup.sizeBytes > 0, 'Backup file size must be > 0');
      logPass(`createBackup generates valid zip file in custom directory (${createdBackup.sizeBytes} bytes)`);
    } catch (err) {
      logFail('createBackup in custom directory', err);
    }

    // ── Test 5: List Available Backups ───────────────────────────────────────
    try {
      const list = await backupService.getAvailableBackups();
      assert(list.length > 0, 'Should return at least 1 backup in list');
      assert.strictEqual(list[0].filename, createdBackup.filename);
      logPass('getAvailableBackups correctly lists existing archives from destination path');
    } catch (err) {
      logFail('getAvailableBackups', err);
    }

    // ── Test 6: Delete Backup ────────────────────────────────────────────────
    try {
      const deleted = await backupService.deleteBackup(createdBackup.filename);
      assert.strictEqual(deleted, true);
      assert(!fs.existsSync(createdBackup.path), 'Backup file should be deleted from disk');
      logPass('deleteBackup correctly removes the zip file from storage');
    } catch (err) {
      logFail('deleteBackup', err);
    }

    // Cleanup test custom directory
    try {
      if (fs.existsSync(testCustomDir)) {
        fs.rmSync(testCustomDir, { recursive: true, force: true });
      }
      // Reset settings to default
      await backupService.saveBackupSettings({
        backup_destination_path: backupService.DEFAULT_BACKUPS_DIR,
        auto_backup_enabled: true,
        auto_backup_time: '02:00',
        auto_backup_frequency: 'daily',
        allowed_roles: ['admin']
      });
    } catch (_) {}

    console.log('\n======================================================');
    console.log(`   🏁 RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('======================================================\n');

    process.exit(failed === 0 ? 0 : 1);
  } catch (globalErr) {
    console.error('Global test error:', globalErr);
    process.exit(1);
  }
}

runBackupUnitTests();
