const logger = require('../../utils/logger.js');

/**
 * Migration 051: multi-company foundation.
 *
 * Introduces the tenancy model: a `business` (one SaaS account/login-group)
 * owns one or more `companies` (fully separate books — invoices, vouchers,
 * ledgers, payroll, etc. all get scoped to a company in later migrations).
 * Every user belongs to exactly one business and automatically has access
 * to every company that business owns, using their existing role/permissions
 * unchanged — there is no per-company role table.
 *
 * ADDITIVE for existing installs: seeds exactly one business + one company
 * (derived from the existing `agency_settings` blob) and backfills every
 * existing user onto it, so a pre-existing single-company install behaves
 * identically immediately after this migration runs.
 */

async function columnExists(conn, table, column) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function constraintExists(conn, table, name) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [table, name]
  );
  return rows.length > 0;
}

async function up(conn) {
  // ── 1. New tables ──────────────────────────────────────────────────────
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS businesses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS companies (
      id INT AUTO_INCREMENT PRIMARY KEY,
      business_id INT NOT NULL,
      name VARCHAR(200) NOT NULL,
      legal_name VARCHAR(200),
      gstin VARCHAR(15),
      pan VARCHAR(10),
      address TEXT,
      city VARCHAR(100),
      state VARCHAR(100),
      state_code VARCHAR(2),
      postal_code VARCHAR(10),
      phone VARCHAR(20),
      email VARCHAR(255),
      bank_account_number VARCHAR(25),
      bank_ifsc_code VARCHAR(15),
      bank_name VARCHAR(100),
      bank_account_holder_name VARCHAR(255),
      financial_year_start_month TINYINT NOT NULL DEFAULT 4,
      logo_url VARCHAR(500),
      invoice_email_template TEXT,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      archived_at DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_by INT NULL,
      CONSTRAINT fk_companies_business FOREIGN KEY (business_id) REFERENCES businesses(id)
    )
  `);

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS company_settings (
      company_id INT NOT NULL,
      setting_key VARCHAR(50) NOT NULL,
      setting_value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (company_id, setting_key),
      CONSTRAINT fk_company_settings_company FOREIGN KEY (company_id) REFERENCES companies(id)
    )
  `);

  // ── 2. New columns on existing tables (nullable first) ─────────────────
  if (!(await columnExists(conn, 'users', 'business_id'))) {
    await conn.execute('ALTER TABLE users ADD COLUMN business_id INT NULL');
  }
  if (!(await columnExists(conn, 'users', 'default_company_id'))) {
    await conn.execute('ALTER TABLE users ADD COLUMN default_company_id INT NULL');
  }
  if (!(await columnExists(conn, 'refresh_tokens', 'company_id'))) {
    await conn.execute('ALTER TABLE refresh_tokens ADD COLUMN company_id INT NULL');
  }

  // ── 3. Seed exactly one business + one company for existing data ───────
  const [existingBusinesses] = await conn.execute('SELECT COUNT(*) as cnt FROM businesses');
  if (existingBusinesses[0].cnt === 0) {
    let agencyName = 'My Company';
    let legalName = null;
    let gstin = null;
    let pan = null;
    let address = null;
    let city = null;
    let state = null;
    let postalCode = null;
    let phone = null;
    let email = null;
    let bankAccountNumber = null;
    let bankIfsc = null;
    let bankName = null;
    let bankHolder = null;
    let logoUrl = null;

    try {
      const [settingsRows] = await conn.execute(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'`
      );
      if (settingsRows.length > 0) {
        const parsed = JSON.parse(settingsRows[0].setting_value);
        agencyName = parsed.agency_name || parsed.company_name || agencyName;
        legalName = parsed.legal_name || null;
        gstin = parsed.gstin || parsed.gst_number || null;
        pan = parsed.pan || null;
        address = parsed.address || null;
        city = parsed.city || null;
        state = parsed.state || null;
        postalCode = parsed.postal_code || parsed.pincode || null;
        phone = parsed.phone || null;
        email = parsed.email || null;
        bankAccountNumber = parsed.bank_account_number || null;
        bankIfsc = parsed.bank_ifsc_code || parsed.ifsc_code || null;
        bankName = parsed.bank_name || null;
        bankHolder = parsed.bank_account_holder_name || null;
        logoUrl = parsed.agency_logo_url || parsed.logo_url || null;
      }
    } catch (err) {
      logger.warn('Could not parse existing agency_settings during migration 051:', err.message);
    }

    const [businessResult] = await conn.execute(
      'INSERT INTO businesses (name) VALUES (?)',
      [agencyName]
    );
    const businessId = businessResult.insertId;

    const [companyResult] = await conn.execute(
      `INSERT INTO companies (
        business_id, name, legal_name, gstin, pan, address, city, state, postal_code,
        phone, email, bank_account_number, bank_ifsc_code, bank_name, bank_account_holder_name, logo_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [businessId, agencyName, legalName, gstin, pan, address, city, state, postalCode,
        phone, email, bankAccountNumber, bankIfsc, bankName, bankHolder, logoUrl]
    );
    const companyId = companyResult.insertId;

    await conn.execute(
      'UPDATE users SET business_id = ?, default_company_id = ? WHERE business_id IS NULL',
      [businessId, companyId]
    );

    logger.info(`   ↪ Seeded Business #${businessId} ("${agencyName}") and Company #${companyId} for existing data.`);
  }

  // ── 4. Enforce NOT NULL + FK on users.business_id now that it's backfilled ─
  const [stillNull] = await conn.execute('SELECT COUNT(*) as cnt FROM users WHERE business_id IS NULL');
  if (stillNull[0].cnt === 0) {
    await conn.execute('ALTER TABLE users MODIFY COLUMN business_id INT NOT NULL');
  } else {
    logger.warn(`   ⚠ ${stillNull[0].cnt} user(s) still missing business_id after seeding — leaving column nullable.`);
  }

  if (!(await constraintExists(conn, 'users', 'fk_users_business'))) {
    await conn.execute('ALTER TABLE users ADD CONSTRAINT fk_users_business FOREIGN KEY (business_id) REFERENCES businesses(id)');
  }
  if (!(await constraintExists(conn, 'users', 'fk_users_default_company'))) {
    await conn.execute('ALTER TABLE users ADD CONSTRAINT fk_users_default_company FOREIGN KEY (default_company_id) REFERENCES companies(id)');
  }
  if (!(await constraintExists(conn, 'refresh_tokens', 'fk_refresh_tokens_company'))) {
    await conn.execute('ALTER TABLE refresh_tokens ADD CONSTRAINT fk_refresh_tokens_company FOREIGN KEY (company_id) REFERENCES companies(id)');
  }
}

module.exports = { up };
