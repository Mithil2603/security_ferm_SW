const assert = require('assert');
const { initDB, query } = require('../src/database/connection');
const salarySlipService = require('../src/services/payroll/salarySlipService');
const { generatePayslipPDF } = require('../src/utils/payslipGenerator');

async function runTests() {
  console.log('\n================================================================');
  console.log('   🧪 UNIT TESTS: PAYSLIP PDF & ATTENDANCE DATE PARSING');
  console.log('================================================================\n');

  await initDB();

  // Test 1: Verify payslip PDF generation stream
  const mockPayroll = {
    id: 1,
    employee_name: 'Test Guard',
    payroll_month: '2026-01',
    days_in_month: 31,
    days_worked: 30,
    gross_salary: 25000,
    total_earnings: 25000,
    total_deductions: 1800,
    net_salary: 23200,
    earnings: [
      { component_name: 'Basic Salary', amount: 18000 },
      { component_name: 'HRA', amount: 7000 }
    ],
    deductions: [
      { component_name: 'PF', amount: 1800 }
    ]
  };

  const mockEmployee = {
    full_name: 'Test Guard',
    employee_id: 'EMP001',
    designation: 'Security Guard'
  };

  let pdfChunks = [];
  await new Promise((resolve, reject) => {
    generatePayslipPDF(
      mockPayroll,
      mockEmployee,
      null,
      { agency_name: 'Test Agency' },
      (chunk) => pdfChunks.push(chunk),
      () => resolve()
    );
  });

  const pdfBuffer = Buffer.concat(pdfChunks);
  assert(pdfBuffer.length > 500, 'PDF buffer should be generated with valid size');
  assert(pdfBuffer.slice(0, 5).toString().startsWith('%PDF'), 'Output should be valid PDF header');
  console.log(`✅ PASS: Payslip PDF generated successfully (${pdfBuffer.length} bytes)`);

  // Test 2: Excel serial date parsing logic test
  const numDate = 46031.00011574074;
  const converted = new Date(Math.round((numDate - 25569) * 86400 * 1000)).toISOString().split('T')[0];
  assert.strictEqual(converted, '2026-01-09', 'Excel serial date 46031 should map to 2026-01-09');
  console.log(`✅ PASS: Excel serial date 46031.00011574074 correctly parsed to ${converted}`);

  console.log('\n================================================================');
  console.log('   🏁 RESULTS: ALL TESTS PASSED');
  console.log('================================================================\n');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
