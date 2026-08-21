const { query, initDB, db } = require('../../src/database/connection');
const { execSync } = require('child_process');
const path = require('path');

describe('Database Seeding', () => {
  beforeAll(async () => {
    // We assume the DB is already created and MySQL is running.
    // Ensure we are operating with the pool initialized
    await initDB();
  });

  afterAll(async () => {
    // Do NOT close the pool here — it's shared across test suites in the same
    // Jest worker process. jest --forceExit handles process cleanup.
  });

  test('Seed script should run successfully without throwing errors', () => {
    const seedScriptPath = path.join(__dirname, '../../src/database/seed.js');
    
    // Execute the seed script via child process
    let output = '';
    try {
      output = execSync(`node "${seedScriptPath}"`, { encoding: 'utf8', stdio: 'pipe', timeout: 60000 });
    } catch (error) {
      console.error("Seed script failed:", error.stdout || error.message);
      throw error;
    }

    // Verify it outputs successful completion messages
    expect(output).toMatch(/SEEDING COMPLETE/);
    expect(output).toMatch(/Clients:\s+\d+/);
    expect(output).toMatch(/Employees:\s+\d+/);
  }, 60000); // 60 seconds timeout for seeding

  test('Database should contain seeded records', async () => {
    // Verify Users
    const usersRes = await query('SELECT COUNT(*) as cnt FROM users');
    expect(usersRes.rows[0].cnt).toBeGreaterThanOrEqual(1);

    // Verify Clients
    const clientsRes = await query('SELECT COUNT(*) as cnt FROM clients');
    expect(clientsRes.rows[0].cnt).toBeGreaterThanOrEqual(20);

    // Verify Employees
    const empRes = await query('SELECT COUNT(*) as cnt FROM employees');
    expect(empRes.rows[0].cnt).toBeGreaterThanOrEqual(10);

    // Verify Attendance
    const attRes = await query('SELECT COUNT(*) as cnt FROM attendance');
    expect(attRes.rows[0].cnt).toBeGreaterThan(100);

    // Verify Invoices
    const invRes = await query('SELECT COUNT(*) as cnt FROM invoices');
    expect(invRes.rows[0].cnt).toBeGreaterThan(10);
  });
});
