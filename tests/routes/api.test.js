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
    const { pool } = require('../../src/database/connection.js');
    if (pool) await pool.end();
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
});
