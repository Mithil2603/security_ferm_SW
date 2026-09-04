const request = require('supertest');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { initDB } = require('../../src/database/connection');

// We need to avoid running the actual server on port 5000 during jest
// Since index.js listens if it is the main module or always listens,
// wait, we can mock or just let it start. supertest binds it to an ephemeral port.
// Mock archiver to avoid ESM syntax error in Jest
jest.mock('archiver', () => {
  return jest.fn().mockImplementation(() => ({
    pipe: jest.fn(),
    append: jest.fn(),
    directory: jest.fn(),
    finalize: jest.fn(),
    on: jest.fn()
  }));
});

const app = require('../../src/index.js');

describe('API Happy Paths', () => {
  let token;

  beforeAll(async () => {
    await initDB();
    const jwtSecret = process.env.JWT_SECRET || 'default-secret';
    // Admin token to bypass permission checks
    token = jwt.sign(
      { userId: 1, role: 'admin', username: 'jest_admin', permissions: ['manage_expenses', 'view_reports', 'manage_invoices', 'manage_payroll'] }, 
      jwtSecret, 
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    // Do NOT close the pool here — it's shared across test suites in the same
    // Jest worker process. jest --forceExit handles process cleanup.
  });

  test('GET /api/expenses returns 200', async () => {
    const res = await request(app)
      .get('/api/expenses')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /api/invoices returns 200', async () => {
    const res = await request(app)
      .get('/api/invoices')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /api/payroll returns 200', async () => {
    const res = await request(app)
      .get('/api/payroll')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /api/vouchers returns 200', async () => {
    const res = await request(app)
      .get('/api/vouchers')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /api/reports/profit-loss returns 200', async () => {
    const res = await request(app)
      .get('/api/reports/profit-loss')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  describe('Event Invoice vs Regular Monthly Tracks', () => {
    let eventClientId;
    let regularClientId;
    const createdInvoices = [];

    beforeAll(async () => {
      const { query } = require('../../src/database/connection');
      const evtRes = await query(`
        INSERT INTO clients (name, address, city, state, phone, client_type, monthly_rate, contract_start_date)
        VALUES ('Test Event Festival', 'Grounds', 'Ahmedabad', 'Gujarat', '9898000001', 'event', 0, CURRENT_DATE)
      `);
      eventClientId = evtRes.insertId;

      const regRes = await query(`
        INSERT INTO clients (name, address, city, state, phone, client_type, monthly_rate, contract_start_date)
        VALUES ('Test Monthly Complex', 'Block A', 'Ahmedabad', 'Gujarat', '9898000002', 'regular', 30000, CURRENT_DATE)
      `);
      regularClientId = regRes.insertId;
    });

    afterAll(async () => {
      const { query } = require('../../src/database/connection');
      if (createdInvoices.length > 0) {
        await query(`DELETE FROM invoices WHERE id IN (${createdInvoices.join(',')})`);
        await query(`DELETE FROM saved_statements WHERE reference_id IN (${createdInvoices.join(',')})`);
      }
      if (eventClientId) await query('DELETE FROM clients WHERE id = $1', [eventClientId]);
      if (regularClientId) await query('DELETE FROM clients WHERE id = $1', [regularClientId]);
    });

    test('Monthly auto-generate query strictly excludes Event clients', async () => {
      const { query } = require('../../src/database/connection');
      const res = await query(
        "SELECT id, name, client_type FROM clients WHERE is_active = true AND (client_type IS NULL OR client_type = 'regular') AND id IN ($1, $2)",
        [eventClientId, regularClientId]
      );
      const ids = res.rows.map(r => r.id);
      expect(ids).toContain(regularClientId);
      expect(ids).not.toContain(eventClientId);
    });

    test('POST /api/invoices/event calculates Full Payment without monthly proration (10 days: 2 guards @ 750/day = 15,000)', async () => {
      const payload = {
        client_id: eventClientId,
        invoice_date: '2026-10-01',
        billing_period_start: '2026-10-01',
        billing_period_end: '2026-10-10',
        guards_count: 2,
        rate_per_guard: 750,
        days_worked: 10,
        tax_type: 'cgst_sgst',
        notes: 'Full 10-day event fee'
      };

      const res = await request(app)
        .post('/api/invoices/event')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);

      const inv = res.body.data;
      createdInvoices.push(inv.id);

      // Verify subtotal is full ₹15,000 (not prorated by monthly rate)
      expect(parseFloat(inv.amount_subtotal)).toBe(15000);
      // CGST 9% (1350) + SGST 9% (1350) = 2700
      expect(parseFloat(inv.cgst_amount)).toBe(1350);
      expect(parseFloat(inv.sgst_amount)).toBe(1350);
      expect(parseFloat(inv.final_amount)).toBe(17700);
      expect(inv.is_ad_hoc).toBe(1);
      expect(inv.duty_days_worked).toBe(10);
    });

    test('POST /api/invoices/event with lump-sum fixed amount takes full payment directly', async () => {
      const payload = {
        client_id: eventClientId,
        invoice_date: '2026-11-01',
        billing_period_start: '2026-11-01',
        billing_period_end: '2026-11-05',
        fixed_amount: 50000,
        tax_type: 'none'
      };

      const res = await request(app)
        .post('/api/invoices/event')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.statusCode).toBe(201);
      const inv = res.body.data;
      createdInvoices.push(inv.id);

      expect(parseFloat(inv.amount_subtotal)).toBe(50000);
      expect(parseFloat(inv.final_amount)).toBe(50000);
      expect(inv.is_ad_hoc).toBe(1);
    });
  });
});
