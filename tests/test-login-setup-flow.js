/**
 * Test Script 7: Login & Setup Flow Resiliency
 * Tests edge cases in authentication: setup guards, SQL injection, short passwords, inactive users, etc.
 */
const { request, logResult, printSummary, waitForServer } = require('./helpers');

async function run() {
  console.log('\n🔐 Test Suite: Login & Setup Resiliency\n');
  const results = [];

  await waitForServer();

  // ── Setup 1: Status check ──────────────────────────────────────────
  try {
    const res = await request('GET', '/auth/setup-status');
    const ok = res.status === 200 && 'setupComplete' in res.data;
    results.push({ passed: ok });
    logResult('GET /auth/setup-status returns correct structure', ok, ok ? '' : JSON.stringify(res.data));
  } catch (e) {
    results.push({ passed: false });
    logResult('GET /auth/setup-status returns correct structure', false, e.message);
  }

  // ── Setup 2: Duplicate admin guard ────────────────────────────────
  try {
    const res = await request('POST', '/auth/setup-init', {
      email: 'hacker@admin.com',
      password: 'password123',
      full_name: 'Hacker'
    });
    // Assuming an admin already exists (from seed), this should fail with 400 ADMIN_EXISTS
    const ok = res.status === 400 && res.data.errorCode === 'ADMIN_EXISTS';
    results.push({ passed: ok });
    logResult('POST /auth/setup-init blocked when admin exists (ADMIN_EXISTS)', ok, ok ? '' : `status=${res.status} error=${res.data.errorCode}`);
  } catch (e) {
    results.push({ passed: false });
    logResult('POST /auth/setup-init blocked when admin exists (ADMIN_EXISTS)', false, e.message);
  }

  // ── Setup 3: Short password validation ─────────────────────────────
  try {
    // We mock a scenario by simulating the validation rule, assuming it triggers before the admin guard
    const res = await request('POST', '/auth/setup-init', {
      email: 'new@admin.com',
      password: '123', // too short
      full_name: 'New'
    });
    const ok = res.status === 400 && res.data.errorCode === 'PASSWORD_TOO_SHORT';
    results.push({ passed: ok });
    logResult('POST /auth/setup-init blocks short passwords', ok, ok ? '' : `status=${res.status} error=${res.data.errorCode}`);
  } catch (e) {
    results.push({ passed: false });
    logResult('POST /auth/setup-init blocks short passwords', false, e.message);
  }

  // ── Setup 4: Invalid email format ──────────────────────────────────
  try {
    const res = await request('POST', '/auth/setup-init', {
      email: 'not-an-email',
      password: 'password123',
      full_name: 'New'
    });
    const ok = res.status === 400 && res.data.errorCode === 'INVALID_EMAIL_FORMAT';
    results.push({ passed: ok });
    logResult('POST /auth/setup-init blocks invalid emails', ok, ok ? '' : `status=${res.status} error=${res.data.errorCode}`);
  } catch (e) {
    results.push({ passed: false });
    logResult('POST /auth/setup-init blocks invalid emails', false, e.message);
  }

  // ── Login 1: Invalid email credentials ─────────────────────────────
  try {
    const res = await request('POST', '/auth/login', { email: 'fake@email.com', password: 'password123' });
    const ok = res.status === 401 && res.data.errorCode === 'INVALID_CREDENTIALS';
    results.push({ passed: ok });
    logResult('Login with non-existent email returns INVALID_CREDENTIALS safely', ok, ok ? '' : `status=${res.status} error=${res.data.errorCode}`);
  } catch (e) {
    results.push({ passed: false });
    logResult('Login with non-existent email returns INVALID_CREDENTIALS safely', false, e.message);
  }

  // ── Login 2: Wrong password credentials ────────────────────────────
  try {
    const res = await request('POST', '/auth/login', { email: 'admin@admin.com', password: 'wrongpassword' });
    const ok = res.status === 401 && res.data.errorCode === 'INVALID_CREDENTIALS';
    results.push({ passed: ok });
    logResult('Login with wrong password returns INVALID_CREDENTIALS', ok, ok ? '' : `status=${res.status} error=${res.data.errorCode}`);
  } catch (e) {
    results.push({ passed: false });
    logResult('Login with wrong password returns INVALID_CREDENTIALS', false, e.message);
  }

  // ── Login 3: SQL Injection Prevention ──────────────────────────────
  try {
    const res = await request('POST', '/auth/login', { email: "' OR 1=1 --", password: 'password123' });
    // Should be rejected safely without crashing the server (either USER_NOT_FOUND or 400 format)
    const ok = (res.status === 401 || res.status === 400) && res.data.success === false;
    results.push({ passed: ok });
    logResult('Login with SQL injection string handled safely', ok, ok ? '' : `status=${res.status}`);
  } catch (e) {
    results.push({ passed: false });
    logResult('Login with SQL injection string handled safely', false, e.message);
  }

  // ── Login 4: Rate Limiting (16 rapid requests) ─────────────────────
  try {
    let rateLimited = false;
    
    // We fire 16 rapid requests. Max is 15 in auth.js.
    // The 16th should fail with 429 Too Many Requests
    for (let i = 0; i < 16; i++) {
      const res = await request('POST', '/auth/login', { email: 'admin@admin.com', password: 'wrong' });
      if (res.status === 429) {
        rateLimited = true;
        break; 
      }
    }
    
    const ok = rateLimited;
    results.push({ passed: ok });
    logResult('Rate limit triggers after 15 failed logins (429)', ok, ok ? '' : `Failed to trigger 429 status`);
  } catch (e) {
    results.push({ passed: false });
    logResult('Rate limit triggers after 15 failed logins (429)', false, e.message);
  }

  return printSummary('Login & Setup Flow', results);
}

if (require.main === module) {
  run().then((s) => process.exit(s.allPassed ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
