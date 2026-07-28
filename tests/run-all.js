/**
 * Master Test Runner
 * Runs all 6 critical-path test suites in sequence and prints a final summary.
 */
const { waitForServer } = require('./helpers');

const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

async function main() {
  console.log('');
  console.log(`${COLORS.bold}═══════════════════════════════════════════════════════════${COLORS.reset}`);
  console.log(`${COLORS.bold}  SECURITY FIRM MANAGEMENT - CRITICAL PATH TEST RUNNER${COLORS.reset}`);
  console.log(`${COLORS.bold}═══════════════════════════════════════════════════════════${COLORS.reset}`);
  console.log(`${COLORS.dim}  Date: ${new Date().toLocaleString()}${COLORS.reset}`);
  console.log('');

  // Verify server is reachable before running any tests
  try {
    console.log(`${COLORS.cyan}⏳ Checking server connectivity...${COLORS.reset}`);
    await waitForServer();
    console.log(`${COLORS.green}✅ Server is running on localhost:5000${COLORS.reset}\n`);
  } catch (e) {
    console.error(`${COLORS.red}❌ Server is NOT reachable. Please start the app first.${COLORS.reset}`);
    console.error(`   Run: npm start (or launch the Electron app)`);
    process.exit(1);
  }

  const suites = [
    { name: 'Auth Flow',             module: './test-auth-flow' },
    { name: 'Login & Setup Flow',    module: './test-login-setup-flow' },
    { name: 'Employee CRUD',         module: './test-employee-crud' },
    { name: 'Payroll Math',          module: './test-payroll-math' },
    { name: 'Invoice PDF',           module: './test-invoice-pdf' },
    { name: 'DB Integrity',          module: './test-database-integrity' },
    { name: 'Settings Persistence',  module: './test-settings-persistence' },
  ];

  const summaries = [];

  for (const suite of suites) {
    try {
      const mod = require(suite.module);
      const result = await mod.run();
      summaries.push(result);
    } catch (e) {
      console.error(`${COLORS.red}❌ Suite "${suite.name}" crashed: ${e.message}${COLORS.reset}`);
      summaries.push({ suite: suite.name, passed: 0, total: 1, allPassed: false });
    }
  }

  // ── Final Summary ─────────────────────────────────────────────────
  console.log('');
  console.log(`${COLORS.bold}╔══════════════════════════════════════════════════════════╗${COLORS.reset}`);
  console.log(`${COLORS.bold}║        CRITICAL PATH TEST RESULTS — FINAL SUMMARY       ║${COLORS.reset}`);
  console.log(`${COLORS.bold}╠══════════════════════════════════════════════════════════╣${COLORS.reset}`);

  let totalPassed = 0;
  let totalTests = 0;

  for (const s of summaries) {
    const icon = s.allPassed ? `${COLORS.green}✅ PASS${COLORS.reset}` : `${COLORS.red}❌ FAIL${COLORS.reset}`;
    const scoreStr = `${s.passed}/${s.total}`;
    console.log(`${COLORS.bold}║${COLORS.reset}  ${s.suite.padEnd(30)} ${scoreStr.padStart(6)}   ${icon}  ${COLORS.bold}║${COLORS.reset}`);
    totalPassed += s.passed;
    totalTests += s.total;
  }

  const allPassed = totalPassed === totalTests;
  const finalIcon = allPassed ? `${COLORS.green}✅ ALL PASS${COLORS.reset}` : `${COLORS.red}❌ FAILURES${COLORS.reset}`;
  const passRate = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;

  console.log(`${COLORS.bold}╠══════════════════════════════════════════════════════════╣${COLORS.reset}`);
  console.log(`${COLORS.bold}║${COLORS.reset}  ${'TOTAL'.padEnd(30)} ${(totalPassed + '/' + totalTests).padStart(6)}   ${finalIcon}  ${COLORS.bold}║${COLORS.reset}`);
  console.log(`${COLORS.bold}║${COLORS.reset}  ${'PASS RATE'.padEnd(30)} ${(passRate + '%').padStart(6)}          ${COLORS.bold}║${COLORS.reset}`);
  console.log(`${COLORS.bold}╠══════════════════════════════════════════════════════════╣${COLORS.reset}`);

  if (allPassed) {
    console.log(`${COLORS.bold}║${COLORS.reset}  ${COLORS.green}RECOMMENDATION: APPROVED FOR DELIVERY${COLORS.reset}                 ${COLORS.bold}║${COLORS.reset}`);
  } else {
    console.log(`${COLORS.bold}║${COLORS.reset}  ${COLORS.red}RECOMMENDATION: REQUIRES FIXES BEFORE DELIVERY${COLORS.reset}        ${COLORS.bold}║${COLORS.reset}`);
  }

  console.log(`${COLORS.bold}╚══════════════════════════════════════════════════════════╝${COLORS.reset}`);
  console.log('');

  process.exit(allPassed ? 0 : 1);
}

main();
