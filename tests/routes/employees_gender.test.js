const request = require('supertest');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { initDB, query } = require('../../src/database/connection');

// Mock archiver to avoid ESM syntax errors in Jest
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

describe('Employee Gender & ID Card Data Test Suite', () => {
  let adminToken;
  let createdEmpId;

  beforeAll(async () => {
    await initDB();
    const jwtSecret = process.env.JWT_SECRET || 'default-secret';
    adminToken = jwt.sign(
      { userId: 1, role: 'admin', username: 'admin_test', permissions: ['manage_employees'] },
      jwtSecret,
      { expiresIn: '2h' }
    );
  });

  afterAll(async () => {
    if (createdEmpId) {
      try {
        await query('DELETE FROM employees WHERE id = $1', [createdEmpId]);
      } catch (_) {}
    }
  });

  test('Creates employee with gender: Male and verifies persistence', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        full_name: 'Vikramaditya Singh',
        phone: '9876501234',
        date_of_joining: '2026-02-01',
        designation: 'Security Supervisor',
        gender: 'Male',
        date_of_birth: '1992-05-15'
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.gender).toBe('Male');
    createdEmpId = res.body.data.id;
  });

  test('GET /api/employees/:id returns the gender field', async () => {
    const res = await request(app)
      .get(`/api/employees/${createdEmpId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.gender).toBe('Male');
    expect(res.body.data.date_of_birth).toBeDefined();
  });

  test('PUT /api/employees/:id successfully updates gender to Female', async () => {
    const res = await request(app)
      .put(`/api/employees/${createdEmpId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        full_name: 'Vikramaditya Singh',
        phone: '9876501234',
        date_of_joining: '2026-02-01',
        gender: 'Female'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.gender).toBe('Female');
  });

  test('Edge case: Fails with 400 when invalid gender value is passed', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        full_name: 'Invalid Gender Test',
        phone: '9876509999',
        date_of_joining: '2026-02-01',
        gender: 'InvalidGenderOption'
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('Supports gender: Other', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        full_name: 'Samira Rao',
        phone: '9876508888',
        date_of_joining: '2026-02-01',
        gender: 'Other'
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.data.gender).toBe('Other');

    // Clean up
    await query('DELETE FROM employees WHERE id = $1', [res.body.data.id]);
  });
});
