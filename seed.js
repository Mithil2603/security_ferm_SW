/**
 * seed.js
 * MySQL Database Seeding Script
 * 
 * Usage:
 *   node seed.js
 *   npm run seed
 */

require('dotenv').config();
const { query, initDB, pool } = require('./src/database/connection');
const bcrypt = require('bcryptjs');

async function seed() {
  console.log('🌱 Starting MySQL database seeding...\n');

  try {
    // 1. Initialize schema and connection pool
    await initDB();

    // 2. Seed Admin Users
    console.log('👤 Seeding default admin users...');
    const adminPasswordHash = await bcrypt.hash('admin123', 10);

    await query(
      `INSERT INTO users (full_name, email, password_hash, role, is_active)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), is_active = 1`,
      ['Administrator', 'admin@example.com', adminPasswordHash, 'admin']
    );

    await query(
      `INSERT INTO users (full_name, email, password_hash, role, is_active)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), is_active = 1`,
      ['Admin User', 'admin@test.com', adminPasswordHash, 'admin']
    );

    // 3. Seed Default Salary Structures
    console.log('💰 Seeding default salary structures...');
    const salaryStructures = [
      { name: 'Standard Guard (8hr)', base_salary: 15000, pf_percentage: 12, esi_applicable: 1 },
      { name: 'Senior Guard (12hr)', base_salary: 22000, pf_percentage: 12, esi_applicable: 1 },
      { name: 'Supervisor Grade A', base_salary: 28000, pf_percentage: 12, esi_applicable: 1 },
      { name: 'Head Guard / Gunman', base_salary: 25000, pf_percentage: 12, esi_applicable: 1 }
    ];

    for (const ss of salaryStructures) {
      await query(
        `INSERT INTO salary_structures (name, base_salary, pf_percentage, esi_applicable, is_active)
         VALUES (?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE base_salary = VALUES(base_salary)`,
        [ss.name, ss.base_salary, ss.pf_percentage, ss.esi_applicable]
      );
    }

    // 4. Seed Default Expense Categories
    console.log('📂 Seeding expense categories...');
    const categories = [
      'Uniform & Gear',
      'Fuel & Transport',
      'Office Supplies',
      'Training & Certification',
      'Equipment & Maintenance',
      'Utilities & Rent',
      'Staff Welfare'
    ];

    for (const name of categories) {
      await query(
        `INSERT INTO expense_categories (name, is_active)
         VALUES (?, 1)
         ON DUPLICATE KEY UPDATE is_active = 1`,
        [name]
      );
    }

    // 5. Seed Sample Clients
    console.log('🏢 Seeding sample clients...');
    const sampleClients = [
      { name: 'Royal Residency', city: 'Ahmedabad', state: 'Gujarat', monthly_rate: 45000, email: 'contact@royalresidency.com' },
      { name: 'Green Heights Complex', city: 'Ahmedabad', state: 'Gujarat', monthly_rate: 55000, email: 'info@greenheights.com' },
      { name: 'Sunrise Corporate Park', city: 'Ahmedabad', state: 'Gujarat', monthly_rate: 85000, email: 'admin@sunrisepark.com' },
      { name: 'Metro Trade Center', city: 'Ahmedabad', state: 'Gujarat', monthly_rate: 65000, email: 'ops@metrocenter.com' }
    ];

    const today = new Date().toISOString().split('T')[0];
    for (const c of sampleClients) {
      await query(
        `INSERT INTO clients (name, address, city, state, postal_code, email, phone, contact_person, contract_start_date, monthly_rate, billing_cycle, is_active, created_by)
         VALUES (?, ?, ?, ?, '380001', ?, '9876543210', 'Site Manager', ?, ?, 1, 1, 1)
         ON DUPLICATE KEY UPDATE monthly_rate = VALUES(monthly_rate)`,
        [c.name, `Plot 10, ${c.name} Road`, c.city, c.state, c.email, today, c.monthly_rate]
      );
    }

    console.log('\n✅ Database seeding completed successfully!');
    console.log('───────────────────────────────────────────────────────');
    console.log('Admin Login:    admin@example.com (or admin@test.com)');
    console.log('Admin Password: admin123');
    console.log('───────────────────────────────────────────────────────\n');

  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
    console.error(err);
    process.exit(1);
  }
  process.exit(0);
}

seed();
