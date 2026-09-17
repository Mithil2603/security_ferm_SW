const request = require('supertest');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
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

describe('Vendor Management & Compliance Module Test Suite', () => {
  let adminToken;
  let viewerToken;
  let createdVendorId;
  let createdDocId;
  let testFilePath;

  beforeAll(async () => {
    await initDB();
    const jwtSecret = process.env.JWT_SECRET || 'default-secret';

    adminToken = jwt.sign(
      { userId: 1, role: 'admin', username: 'admin_test', permissions: ['manage_expenses', 'view_reports'] },
      jwtSecret,
      { expiresIn: '2h' }
    );

    viewerToken = jwt.sign(
      { userId: 2, role: 'employee', username: 'viewer_test', permissions: ['view_reports'] },
      jwtSecret,
      { expiresIn: '2h' }
    );

    // Create a dummy test file for document upload tests
    testFilePath = path.join(__dirname, 'test_sample_gst.pdf');
    fs.writeFileSync(testFilePath, '%PDF-1.4 dummy pdf content for vendor compliance test');
  });

  afterAll(async () => {
    if (fs.existsSync(testFilePath)) {
      try { fs.unlinkSync(testFilePath); } catch (_) {}
    }
    // Cleanup created test vendor
    if (createdVendorId) {
      try {
        await query('DELETE FROM vendor_documents WHERE vendor_id = $1', [createdVendorId]);
        await query('DELETE FROM vendors WHERE id = $1', [createdVendorId]);
      } catch (_) {}
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Authorization & Access Control Edge Cases
  // ───────────────────────────────────────────────────────────────────────────
  describe('Authorization & Security Checks', () => {
    test('Unauthenticated request to GET /api/vendors returns 401', async () => {
      const res = await request(app).get('/api/vendors');
      expect(res.statusCode).toBe(401);
    });

    test('User without manage_expenses permission cannot create a vendor (403)', async () => {
      const res = await request(app)
        .post('/api/vendors')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ display_name: 'Unauthorized Vendor' });
      expect(res.statusCode).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Vendor CRUD & Blueprint Fields Validation
  // ───────────────────────────────────────────────────────────────────────────
  describe('Vendor CRUD Operations', () => {
    test('Edge case: Fails with 400 when vendor name is omitted', async () => {
      const res = await request(app)
        .post('/api/vendors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ tax_id: '24ABCDE1234F1Z5' });
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('Creates vendor with all blueprint fields and auto-generates vendor_code', async () => {
      const res = await request(app)
        .post('/api/vendors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          legal_name: 'Shield Guard Gear Private Limited',
          display_name: 'Shield Guard Gear',
          tax_id: '24ABCDE1234F1Z5',
          currency: 'INR',
          bank_name: 'HDFC Bank',
          bank_account_no: '50100456789012',
          bank_routing_code: 'HDFC0000123',
          payment_terms_days: 45,
          contact_info: 'sales@shieldgear.com | 9876543210'
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.vendor_code).toMatch(/^VND-\d{3,}$/);
      expect(res.body.data.display_name).toBe('Shield Guard Gear');
      expect(res.body.data.legal_name).toBe('Shield Guard Gear Private Limited');
      expect(res.body.data.tax_id).toBe('24ABCDE1234F1Z5');
      expect(res.body.data.currency).toBe('INR');
      expect(res.body.data.bank_name).toBe('HDFC Bank');
      expect(res.body.data.bank_account_no).toBe('50100456789012');
      expect(res.body.data.bank_routing_code).toBe('HDFC0000123');
      expect(res.body.data.is_active).toBe(1);

      createdVendorId = res.body.data.id;
    });

    test('Edge case: Prevents duplicate vendor_code with 400', async () => {
      const res = await request(app)
        .post('/api/vendors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          vendor_code: 'VND-UNIQUE-DUPE-TEST',
          display_name: 'First Vendor'
        });
      expect(res.statusCode).toBe(201);
      const firstId = res.body.data.id;

      // Try creating second vendor with same vendor_code
      const dupeRes = await request(app)
        .post('/api/vendors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          vendor_code: 'VND-UNIQUE-DUPE-TEST',
          display_name: 'Duplicate Code Vendor'
        });
      expect(dupeRes.statusCode).toBe(400);

      // Clean up firstId
      await query('DELETE FROM vendors WHERE id = $1', [firstId]);
    });

    test('GET /api/vendors lists vendors with pagination and financial fields', async () => {
      const res = await request(app)
        .get('/api/vendors?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toBeDefined();

      const found = res.body.data.find(v => v.id === createdVendorId);
      expect(found).toBeDefined();
      expect(found).toHaveProperty('total_documents');
      expect(found).toHaveProperty('pending_documents');
      expect(found).toHaveProperty('total_billed');
      expect(found).toHaveProperty('total_paid');
      expect(found).toHaveProperty('balance_due');
    });

    test('GET /api/vendors?all=true returns lightweight array for dropdowns', async () => {
      const res = await request(app)
        .get('/api/vendors?all=true')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const found = res.body.data.find(v => v.id === createdVendorId);
      expect(found).toBeDefined();
      expect(found).toHaveProperty('vendor_code');
    });

    test('GET /api/vendors?search=... searches by vendor code, legal name, tax_id', async () => {
      const res = await request(app)
        .get('/api/vendors?search=24ABCDE1234F1Z5')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].id).toBe(createdVendorId);
    });

    test('Edge case: Search with non-matching query returns empty array gracefully', async () => {
      const res = await request(app)
        .get('/api/vendors?search=ZZZZ_NON_EXISTENT_99999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });

    test('GET /api/vendors/:id returns single vendor details', async () => {
      const res = await request(app)
        .get(`/api/vendors/${createdVendorId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(createdVendorId);
      expect(res.body.data.legal_name).toBe('Shield Guard Gear Private Limited');
    });

    test('Edge case: GET /api/vendors/:id returns 404 for non-existent vendor', async () => {
      const res = await request(app)
        .get('/api/vendors/999999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
    });

    test('PUT /api/vendors/:id updates vendor banking and contact information', async () => {
      const res = await request(app)
        .put(`/api/vendors/${createdVendorId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          display_name: 'Shield Guard Gear (Updated)',
          legal_name: 'Shield Guard Gear Private Limited',
          bank_name: 'State Bank of India',
          bank_account_no: '30001234567',
          bank_routing_code: 'SBIN0001234',
          payment_terms_days: 60,
          currency: 'INR'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.display_name).toBe('Shield Guard Gear (Updated)');
      expect(res.body.data.bank_name).toBe('State Bank of India');
      expect(res.body.data.payment_terms_days).toBe(60);
    });

    test('Edge case: PUT /api/vendors/:id returns 404 for non-existent vendor', async () => {
      const res = await request(app)
        .put('/api/vendors/999999')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ display_name: 'Ghost Vendor' });

      expect(res.statusCode).toBe(404);
    });

    test('PATCH /api/vendors/:id/toggle-status toggles vendor active state', async () => {
      // Deactivate
      const res1 = await request(app)
        .patch(`/api/vendors/${createdVendorId}/toggle-status`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res1.statusCode).toBe(200);
      expect(res1.body.is_active).toBe(false);

      // Reactivate
      const res2 = await request(app)
        .patch(`/api/vendors/${createdVendorId}/toggle-status`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res2.statusCode).toBe(200);
      expect(res2.body.is_active).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Compliance Documents Lifecycle & Audit Workflow
  // ───────────────────────────────────────────────────────────────────────────
  describe('Compliance Document Management & Lifecycle', () => {
    test('Edge case: Upload document fails with 400 when file is missing', async () => {
      const res = await request(app)
        .post(`/api/vendors/${createdVendorId}/documents`)
        .set('Authorization', `Bearer ${adminToken}`)
        .field('document_type', 'GST Certificate');

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/no document file/i);
    });

    test('Edge case: Upload document fails with 400 when document_type is missing', async () => {
      const res = await request(app)
        .post(`/api/vendors/${createdVendorId}/documents`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', testFilePath);

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/document type is required/i);
    });

    test('Uploads compliance document with expiry date, initial status defaults to Pending', async () => {
      const futureExpiry = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 15 days ahead

      const res = await request(app)
        .post(`/api/vendors/${createdVendorId}/documents`)
        .set('Authorization', `Bearer ${adminToken}`)
        .field('document_type', 'GST Certificate')
        .field('expiry_date', futureExpiry)
        .attach('file', testFilePath);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.document_type).toBe('GST Certificate');
      expect(res.body.data.status).toBe('Pending');
      expect(res.body.data.file_url).toMatch(/^\/uploads\/vendor_docs\//);

      createdDocId = res.body.data.id;
    });

    test('GET /api/vendors/:id/documents lists uploaded compliance documents', async () => {
      const res = await request(app)
        .get(`/api/vendors/${createdVendorId}/documents`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].id).toBe(createdDocId);
    });

    test('GET /api/vendors/alerts/expiring-docs returns documents expiring in < 30 days', async () => {
      const res = await request(app)
        .get('/api/vendors/alerts/expiring-docs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const foundAlert = res.body.data.find(d => d.id === createdDocId);
      expect(foundAlert).toBeDefined();
      expect(foundAlert.vendor_id).toBe(createdVendorId);
    });

    test('Edge case: PATCH status with invalid status returns 400', async () => {
      const res = await request(app)
        .patch(`/api/vendors/${createdVendorId}/documents/${createdDocId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'InvalidStatus' });

      expect(res.statusCode).toBe(400);
    });

    test('Approves document and records verified_by user and verified_at timestamp', async () => {
      const res = await request(app)
        .patch(`/api/vendors/${createdVendorId}/documents/${createdDocId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'Approved' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('Approved');
      expect(res.body.data.verified_by).toBe(1);
      expect(res.body.data.verified_at).toBeDefined();
    });

    test('Rejects document with reason note', async () => {
      const res = await request(app)
        .patch(`/api/vendors/${createdVendorId}/documents/${createdDocId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'Rejected',
          rejection_reason: 'GSTIN mismatch with corporate registry'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('Rejected');
      expect(res.body.data.rejection_reason).toBe('GSTIN mismatch with corporate registry');
    });

    test('DELETE /api/vendors/:id/documents/:docId deletes the document and file', async () => {
      const res = await request(app)
        .delete(`/api/vendors/${createdVendorId}/documents/${createdDocId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify deletion from DB
      const checkRes = await query('SELECT * FROM vendor_documents WHERE id = $1', [createdDocId]);
      expect(checkRes.rows.length).toBe(0);
    });

    test('Edge case: DELETE non-existent document returns 404', async () => {
      const res = await request(app)
        .delete(`/api/vendors/${createdVendorId}/documents/999999`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(404);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Statement & Ledger Integration
  // ───────────────────────────────────────────────────────────────────────────
  describe('Statement & Financial Calculation Integration', () => {
    test('GET /api/vendors/:id/statement returns financial totals and lists', async () => {
      const res = await request(app)
        .get(`/api/vendors/${createdVendorId}/statement`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.vendor.id).toBe(createdVendorId);
      expect(res.body.data.total_billed).toBeDefined();
      expect(res.body.data.total_paid).toBeDefined();
      expect(res.body.data.balance_due).toBeDefined();
      expect(Array.isArray(res.body.data.expenses)).toBe(true);
      expect(Array.isArray(res.body.data.payments)).toBe(true);
    });

    test('Edge case: Statement returns 404 for non-existent vendor', async () => {
      const res = await request(app)
        .get('/api/vendors/999999/statement')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(404);
    });
  });
});
