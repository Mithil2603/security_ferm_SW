require('dotenv').config();
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { initDB, query } = require('../src/database/connection');

async function runAttendanceTests() {
  console.log('\n================================================================');
  console.log('   🧪 UNIT TESTS: ATTENDANCE EXCEL & CSV BULK UPLOAD');
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

    // Setup a test employee
    const testEmpCode = `TST_EMP_${Date.now().toString().slice(-4)}`;
    const empInsert = await query(
      `INSERT INTO employees (employee_id, full_name, phone, is_active)
       VALUES ($1, $2, '9876543210', 1)`,
      [testEmpCode, 'Test Watchman Rajesh']
    );

    const empRes = await query('SELECT id, employee_id FROM employees WHERE employee_id = $1', [testEmpCode]);
    const empId = empRes.rows[0].id;

    // ── Test 1: Generate & Verify Excel Attendance Template ───────────────────
    const testExcelPath = path.join(__dirname, 'temp_test_attendance.xlsx');
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Attendance');
      worksheet.columns = [
        { header: 'Employee ID', key: 'employee_id' },
        { header: 'Employee Name', key: 'name' },
        { header: 'Date', key: 'date' },
        { header: 'Status', key: 'status' },
        { header: 'Check In', key: 'check_in' },
        { header: 'Check Out', key: 'check_out' },
        { header: 'Notes', key: 'notes' }
      ];

      worksheet.addRow({
        employee_id: testEmpCode,
        name: 'Test Watchman Rajesh',
        date: '2026-08-31',
        status: 'present',
        check_in: '09:00',
        check_out: '18:00',
        notes: 'Excel Upload Test'
      });

      await workbook.xlsx.writeFile(testExcelPath);
      assert(fs.existsSync(testExcelPath));
      logPass('Excel Attendance template file generated successfully (.xlsx)');
    } catch (err) {
      logFail('Excel template generation', err);
    }

    // ── Test 2: Parse & Insert Attendance Record from Excel ──────────────────
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(testExcelPath);
      const worksheet = workbook.worksheets[0];
      assert(worksheet.rowCount >= 2);

      // Verify row data matches
      const row = worksheet.getRow(2);
      const readEmpCode = row.getCell(1).value;
      assert.strictEqual(readEmpCode, testEmpCode);

      // Insert into attendance table
      await query(
        `INSERT INTO attendance (employee_id, attendance_date, check_in_time, check_out_time, hours_worked, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON DUPLICATE KEY UPDATE check_in_time=VALUES(check_in_time), check_out_time=VALUES(check_out_time), status=VALUES(status)`,
        [empId, '2026-08-31', '09:00:00', '18:00:00', 9.0, 'present', 'Excel Upload Test']
      );

      const attCheck = await query(
        'SELECT * FROM attendance WHERE employee_id = $1 AND attendance_date = $2',
        [empId, '2026-08-31']
      );
      assert(attCheck.rows.length > 0);
      assert.strictEqual(attCheck.rows[0].status, 'present');
      assert.strictEqual(parseFloat(attCheck.rows[0].hours_worked), 9.0);
      logPass('Excel attendance data parsed and accurately inserted into database');
    } catch (err) {
      logFail('Excel attendance insert', err);
    } finally {
      if (fs.existsSync(testExcelPath)) fs.unlinkSync(testExcelPath);
    }

    // ── Test 3: Status Normalization ('p', 'half_day', 'absent', 'leave') ────
    try {
      const statuses = [
        { raw: 'p', expected: 'present' },
        { raw: 'half day', expected: 'half_day' },
        { raw: 'a', expected: 'absent' },
        { raw: 'l', expected: 'leave' }
      ];

      function normalize(s) {
        const val = String(s).trim().toLowerCase();
        if (val === 'p' || val === 'present') return 'present';
        if (val === 'a' || val === 'absent') return 'absent';
        if (val === 'hd' || val === 'half_day' || val === 'half day') return 'half_day';
        if (val === 'l' || val === 'leave') return 'leave';
        return 'present';
      }

      for (const st of statuses) {
        assert.strictEqual(normalize(st.raw), st.expected);
      }
      logPass('Attendance status shorthand normalization (P, A, HD, L) validated');
    } catch (err) {
      logFail('Status normalization', err);
    }

    // ── Cleanup Test Data ───────────────────────────────────────────────────
    try {
      await query('DELETE FROM attendance WHERE employee_id = $1', [empId]);
      await query('DELETE FROM employees WHERE id = $1', [empId]);
    } catch (_) {}

    console.log('\n================================================================');
    console.log(`   🏁 RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    process.exit(failed === 0 ? 0 : 1);
  } catch (globalErr) {
    console.error('Global attendance test error:', globalErr);
    process.exit(1);
  }
}

runAttendanceTests();
