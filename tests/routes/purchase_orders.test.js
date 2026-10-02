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

describe('Purchase Orders Suite — Vyapar Layout & Full Edit/Delete', () => {
  let adminToken;
  let testVendorId;
  let createdPoId;

  beforeAll(async () => {
    await initDB();
    const jwtSecret = process.env.JWT_SECRET || 'default-secret';

    adminToken = jwt.sign(
      { userId: 1, role: 'admin', username: 'admin_test', permissions: ['manage_expenses', 'view_reports'] },
      jwtSecret,
      { expiresIn: '2h' }
    );

    // Create a temporary vendor for PO tests
    const vRes = await query(
      `INSERT INTO vendors (name, legal_name, display_name, tax_id, contact_info, is_active)
       VALUES ($1, $2, $3, $4, $5, 1) RETURNING id`,
      ['Test Uniform Vendor Ltd', 'Test Uniform Vendor Ltd', 'Test Uniforms', '24AABCT1234F1Z1', '9876543210']
    );
    testVendorId = vRes.rows[0].id;
  });

  afterAll(async () => {
    if (createdPoId) {
      try {
        await query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [createdPoId]);
        await query('DELETE FROM purchase_orders WHERE id = $1', [createdPoId]);
      } catch (_) {}
    }
    if (testVendorId) {
      try {
        await query('DELETE FROM vendors WHERE id = $1', [testVendorId]);
      } catch (_) {}
    }
  });

  test('POST /api/purchase-orders creates a PO with rich line items, discounts, taxes, and terms', async () => {
    const items = [
      {
        description: 'Security Guard Uniform (Shirt + Trouser)',
        hsn_code: '6203',
        item_description: 'Navy blue poly-viscose cloth',
        quantity: 10,
        unit: 'Set',
        unit_price: 1200,
        price_type: 'without_tax',
        discount_percent: 10,
        tax_rate: 18,
      },
      {
        description: 'Safety Tactical Boots',
        hsn_code: '6403',
        item_description: 'Steel toe ankle boot',
        quantity: 10,
        unit: 'Pair',
        unit_price: 800,
        price_type: 'without_tax',
        discount_percent: 0,
        discount_amount: 500,
        tax_rate: 18,
      }
    ];

    const res = await request(app)
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('vendor_id', testVendorId)
      .field('po_date', '2026-10-02')
      .field('bill_number', 'INV-2026-VENDOR-01')
      .field('state_of_supply', 'Gujarat')
      .field('payment_type', 'bank_transfer')
      .field('payment_details', 'NEFT Ref: 98127391823')
      .field('terms_conditions', '1. Inspection on receipt\n2. 30 days payment')
      .field('notes', 'Urgent requirement for Site A deployment')
      .field('round_off', '-0.40')
      .field('items', JSON.stringify(items));

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.po_number).toMatch(/^PO-/);
    expect(res.body.data.bill_number).toBe('INV-2026-VENDOR-01');
    expect(res.body.data.state_of_supply).toBe('Gujarat');
    expect(res.body.data.payment_type).toBe('bank_transfer');

    createdPoId = res.body.data.id;

    // Verify items were saved
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.items[0].unit).toBe('Set');
    expect(res.body.data.items[1].unit).toBe('Pair');
  });

  test('GET /api/purchase-orders/:id retrieves all enhanced fields', async () => {
    const res = await request(app)
      .get(`/api/purchase-orders/${createdPoId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const po = res.body.data;
    expect(po.id).toBe(createdPoId);
    expect(po.vendor_name).toBe('Test Uniform Vendor Ltd');
    expect(po.vendor_contact).toBe('9876543210');
    expect(po.bill_number).toBe('INV-2026-VENDOR-01');
    expect(po.terms_conditions).toContain('Inspection on receipt');
    expect(po.items).toHaveLength(2);
  });

  test('PUT /api/purchase-orders/:id updates purchase order items, discounts, and terms', async () => {
    const updatedItems = [
      {
        description: 'Security Guard Uniform (Shirt + Trouser) - Updated Qty',
        hsn_code: '6203',
        item_description: 'Updated color black',
        quantity: 15,
        unit: 'Set',
        unit_price: 1150,
        price_type: 'without_tax',
        discount_percent: 5,
        tax_rate: 18,
      }
    ];

    const res = await request(app)
      .put(`/api/purchase-orders/${createdPoId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('vendor_id', testVendorId)
      .field('po_date', '2026-10-03')
      .field('bill_number', 'INV-2026-VENDOR-01-REV')
      .field('state_of_supply', 'Maharashtra')
      .field('payment_type', 'cheque')
      .field('payment_details', 'Cheque # 543210')
      .field('terms_conditions', '1. Revised terms 45 days')
      .field('notes', 'Revised PO with discount renegotiation')
      .field('items', JSON.stringify(updatedItems));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.bill_number).toBe('INV-2026-VENDOR-01-REV');
    expect(res.body.data.state_of_supply).toBe('Maharashtra');
    expect(res.body.data.payment_type).toBe('cheque');
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].description).toBe('Security Guard Uniform (Shirt + Trouser) - Updated Qty');
    expect(parseFloat(res.body.data.items[0].quantity)).toBe(15);
  });

  test('DELETE /api/purchase-orders/:id permanently deletes draft purchase order and cascades items', async () => {
    const res = await request(app)
      .delete(`/api/purchase-orders/${createdPoId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify it is gone
    const checkRes = await request(app)
      .get(`/api/purchase-orders/${createdPoId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(checkRes.status).toBe(404);

    createdPoId = null; // already deleted
  });
});
