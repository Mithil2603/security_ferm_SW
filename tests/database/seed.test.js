const { query, initDB } = require('../../src/database/connection');

describe('Database Seeding', () => {
  beforeAll(async () => {
    await initDB();
  });

  afterAll(async () => {
    // Do NOT close the pool here — it's shared across test suites in the same
    // Jest worker process. jest --forceExit handles process cleanup.
  });

  test('Database should contain seeded records', async () => {
    // Verify Users
    const usersRes = await query('SELECT COUNT(*) as cnt FROM users');
    expect(usersRes.rows[0].cnt).toBeGreaterThanOrEqual(1);

    // Verify Clients
    const clientsRes = await query('SELECT COUNT(*) as cnt FROM clients');
    expect(clientsRes.rows[0].cnt).toBeGreaterThanOrEqual(1);

    // Verify Employees
    const empRes = await query('SELECT COUNT(*) as cnt FROM employees');
    expect(empRes.rows[0].cnt).toBeGreaterThanOrEqual(1);

    // Verify Attendance
    const attRes = await query('SELECT COUNT(*) as cnt FROM attendance');
    expect(attRes.rows[0].cnt).toBeGreaterThanOrEqual(10);

    // Verify Invoices
    const invRes = await query('SELECT COUNT(*) as cnt FROM invoices');
    expect(invRes.rows[0].cnt).toBeGreaterThanOrEqual(1);
  });
});
