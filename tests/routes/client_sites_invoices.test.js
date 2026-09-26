const request = require('supertest');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { initDB, query } = require('../../src/database/connection');

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

describe('Client Sites Management & Multi-Bill Invoicing', () => {
  let token;
  let testClientId;
  const createdInvoices = [];

  beforeAll(async () => {
    await initDB();
    const jwtSecret = process.env.JWT_SECRET || 'default-secret';
    token = jwt.sign(
      { userId: 1, role: 'admin', username: 'jest_admin', permissions: ['manage_invoices'] },
      jwtSecret,
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    if (createdInvoices.length > 0) {
      await query(`DELETE FROM invoices WHERE id IN (${createdInvoices.join(',')})`);
      await query(`DELETE FROM saved_statements WHERE reference_id IN (${createdInvoices.join(',')})`);
    }
    if (testClientId) {
      await query('DELETE FROM clients WHERE id = $1', [testClientId]);
    }
  });

  test('POST /api/clients creates client with multiple sites', async () => {
    const payload = {
      name: 'Alpha Mega Infra Ltd',
      address: 'Near Ring Road',
      city: 'Ahmedabad',
      state: 'Gujarat',
      phone: '9825012345',
      monthly_rate: 45000,
      contract_start_date: '2026-01-01',
      contract_end_date: '2026-12-31',
      sites: [
        { name: 'Site North Plant', address: 'Plot 101, GIDC' },
        { name: 'Site Corporate Tower', address: 'Floor 7, SG Highway' }
      ]
    };

    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    testClientId = res.body.data.id;
    expect(Array.isArray(res.body.data.sites)).toBe(true);
    expect(res.body.data.sites.length).toBe(2);
    expect(res.body.data.sites[0].name).toBe('Site North Plant');
  });

  test('GET /api/clients/:id retrieves client with parsed sites array', async () => {
    const res = await request(app)
      .get(`/api/clients/${testClientId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.sites)).toBe(true);
    expect(res.body.data.sites.length).toBe(2);
    expect(res.body.data.sites[1].name).toBe('Site Corporate Tower');
    expect(res.body.data.sites[1].address).toBe('Floor 7, SG Highway');
  });

  test('PUT /api/clients/:id updates client sites', async () => {
    const updatedSites = [
      { name: 'Site North Plant (Renovated)', address: 'Plot 101, GIDC' },
      { name: 'Site Corporate Tower', address: 'Floor 7, SG Highway' },
      { name: 'Site Logistics Hub', address: 'Sanand GIDC' }
    ];

    const res = await request(app)
      .put(`/api/clients/${testClientId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sites: updatedSites });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sites.length).toBe(3);
    expect(res.body.data.sites[2].name).toBe('Site Logistics Hub');
  });

  test('POST /api/invoices creates first invoice for Site North Plant', async () => {
    const payload = {
      client_id: testClientId,
      invoice_number: `TST-${Date.now()}-1`,
      invoice_date: '2026-03-01',
      billing_period_start: '2026-03-01',
      billing_period_end: '2026-03-31',
      site_name: 'Site North Plant (Renovated)',
      amount_subtotal: 45000,
      tax_type: 'none'
    };

    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.site_name).toBe('Site North Plant (Renovated)');
    createdInvoices.push(res.body.data.id);
  });

  test('POST /api/invoices permits creating a SECOND invoice for the SAME client/site/period (multi-bill site generation)', async () => {
    // Exact same client, same billing period, same site, different invoice number (e.g. night shift or supplementary bill)
    const payload = {
      client_id: testClientId,
      invoice_number: `TST-${Date.now()}-2`,
      invoice_date: '2026-03-01',
      billing_period_start: '2026-03-01',
      billing_period_end: '2026-03-31',
      site_name: 'Site North Plant (Renovated)',
      amount_subtotal: 22500,
      tax_type: 'none'
    };

    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.site_name).toBe('Site North Plant (Renovated)');
    createdInvoices.push(res.body.data.id);
  });

  test('POST /api/invoices/event creates event invoice with site_name', async () => {
    const payload = {
      client_id: testClientId,
      invoice_number: `EVT-${Date.now()}`,
      invoice_date: '2026-04-01',
      billing_period_start: '2026-04-01',
      billing_period_end: '2026-04-05',
      guards_count: 2,
      rate_per_guard: 800,
      days_worked: 5,
      site_name: 'Site Logistics Hub',
      tax_type: 'none'
    };

    const res = await request(app)
      .post('/api/invoices/event')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.site_name).toBe('Site Logistics Hub');
    expect(parseFloat(res.body.data.final_amount)).toBe(8000);
    createdInvoices.push(res.body.data.id);
  });
});
