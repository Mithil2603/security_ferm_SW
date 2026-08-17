-- ============================================================
-- Security Firm Management Software — MySQL 8+ Schema
-- Converted from SQLite schema
-- ============================================================

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- ============================================================
-- 1. USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    role VARCHAR(20) NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    last_login DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT,
    permissions TEXT,
    CONSTRAINT chk_users_role CHECK (role IN ('admin', 'manager', 'accountant', 'employee'))
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    ip_address VARCHAR(45),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================================
-- 2. CLIENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL DEFAULT 'Gujarat',
    postal_code VARCHAR(10),
    email VARCHAR(255),
    phone VARCHAR(20),
    contact_person VARCHAR(255),
    gst_number VARCHAR(20),
    contract_start_date DATE NOT NULL DEFAULT (CURDATE()),
    contract_end_date DATE,
    monthly_rate DOUBLE NOT NULL,
    billing_cycle INT DEFAULT 1,
    notes TEXT,
    is_active TINYINT(1) DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT,
    CONSTRAINT positive_rate CHECK (monthly_rate > 0),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_clients_name ON clients(name);
CREATE INDEX idx_clients_city ON clients(city);
CREATE INDEX idx_clients_active ON clients(is_active);

-- ============================================================
-- 3. SALARY STRUCTURES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS salary_structures (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    base_salary DOUBLE NOT NULL,
    dearness_allowance DOUBLE DEFAULT 0,
    house_rent_allowance DOUBLE DEFAULT 0,
    other_allowances DOUBLE DEFAULT 0,
    pf_percentage DOUBLE DEFAULT 12.0,
    esi_applicable TINYINT(1) DEFAULT 0,
    income_tax_applicable TINYINT(1) DEFAULT 0,
    effective_from DATE NOT NULL DEFAULT (CURDATE()),
    effective_to DATE,
    is_active TINYINT(1) DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT positive_salary CHECK (base_salary > 0),
    CONSTRAINT valid_pf CHECK (pf_percentage BETWEEN 0 AND 100)
);

-- ============================================================
-- 4. EMPLOYEES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS employees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    date_of_birth DATE,
    address TEXT,
    city VARCHAR(100),
    aadhar_number VARCHAR(12),
    pan_number VARCHAR(10),
    bank_account_number VARCHAR(25),
    bank_ifsc_code VARCHAR(15),
    bank_name VARCHAR(100),
    bank_account_holder_name VARCHAR(255),
    date_of_joining DATE NOT NULL DEFAULT (CURDATE()),
    designation VARCHAR(100) DEFAULT 'Watchman',
    salary_structure_id INT,
    assigned_client_id INT,
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(20),
    notes TEXT,
    is_active TINYINT(1) DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (salary_structure_id) REFERENCES salary_structures(id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_client_id) REFERENCES clients(id) ON DELETE SET NULL
);

CREATE INDEX idx_employees_name ON employees(full_name);
CREATE INDEX idx_employees_joining ON employees(date_of_joining);
CREATE INDEX idx_employees_active ON employees(is_active);
CREATE INDEX idx_employees_client_id ON employees(assigned_client_id);
CREATE INDEX idx_employees_salary_struct ON employees(salary_structure_id);

-- ============================================================
-- 5. ATTENDANCE TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    client_id INT,
    attendance_date DATE NOT NULL,
    check_in_time TIME,
    check_out_time TIME,
    hours_worked DOUBLE,
    status VARCHAR(20) DEFAULT 'present',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT,
    UNIQUE KEY uq_attendance (employee_id, attendance_date),
    CONSTRAINT chk_attendance_status CHECK (status IN ('present', 'absent', 'leave', 'holiday', 'half_day')),
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_attendance_emp_date ON attendance(employee_id, attendance_date);
CREATE INDEX idx_attendance_client_date ON attendance(client_id, attendance_date);
CREATE INDEX idx_attendance_date ON attendance(attendance_date);

-- ============================================================
-- 6. INVOICES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    client_id INT NOT NULL,
    invoice_date DATE NOT NULL DEFAULT (CURDATE()),
    due_date DATE NOT NULL,
    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL,
    amount_subtotal DOUBLE NOT NULL,
    tax_rate DOUBLE DEFAULT 0,
    tax_amount DOUBLE DEFAULT 0,
    total_amount DOUBLE NOT NULL,
    discount_amount DOUBLE DEFAULT 0,
    final_amount DOUBLE NOT NULL,
    status VARCHAR(20) DEFAULT 'draft',
    payment_received DOUBLE DEFAULT 0,
    payment_due DOUBLE,
    tax_type VARCHAR(20) DEFAULT 'none',
    cgst_amount DOUBLE DEFAULT 0,
    sgst_amount DOUBLE DEFAULT 0,
    igst_amount DOUBLE DEFAULT 0,
    is_rcm_applicable TINYINT(1) DEFAULT 0,
    duty_days_worked INT,
    is_ad_hoc TINYINT(1) DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT,
    CONSTRAINT chk_invoice_status CHECK (status IN ('draft','sent','paid','partially_paid','overdue','cancelled')),
    CONSTRAINT chk_tax_type CHECK (tax_type IN ('none','cgst_sgst','igst')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_invoices_client ON invoices(client_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_due_date ON invoices(due_date);
CREATE INDEX idx_invoices_date ON invoices(invoice_date);
CREATE INDEX idx_invoices_created_by ON invoices(created_by);

-- ============================================================
-- 6.5. EXPENSE CATEGORIES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS expense_categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 7. PAYMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    invoice_id INT NOT NULL,
    payment_date DATE NOT NULL DEFAULT (CURDATE()),
    amount_paid DOUBLE NOT NULL,
    payment_method VARCHAR(20) NOT NULL,
    transaction_reference VARCHAR(100),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INT,
    CONSTRAINT positive_payment CHECK (amount_paid > 0),
    CONSTRAINT chk_payment_method CHECK (payment_method IN ('cash','cheque','bank_transfer','upi','card')),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_payments_invoice ON payments(invoice_id);
CREATE INDEX idx_payments_date ON payments(payment_date);
CREATE INDEX idx_payments_created_by ON payments(created_by);

-- ============================================================
-- 8. PAYROLL TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS payroll (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    payroll_month DATE NOT NULL,
    days_in_month INT NOT NULL DEFAULT 30,
    days_worked INT NOT NULL DEFAULT 0,
    days_absent INT DEFAULT 0,
    days_leave INT DEFAULT 0,
    base_salary DOUBLE NOT NULL,
    da_amount DOUBLE DEFAULT 0,
    hra_amount DOUBLE DEFAULT 0,
    other_allowances DOUBLE DEFAULT 0,
    gross_salary DOUBLE NOT NULL,
    pf_deduction DOUBLE DEFAULT 0,
    esi_deduction DOUBLE DEFAULT 0,
    tax_deduction DOUBLE DEFAULT 0,
    other_deductions DOUBLE DEFAULT 0,
    total_deductions DOUBLE DEFAULT 0,
    net_salary DOUBLE NOT NULL,
    payment_status VARCHAR(20) DEFAULT 'pending',
    payment_date DATE,
    payment_method VARCHAR(20),
    transaction_reference VARCHAR(100),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by INT,
    UNIQUE KEY uq_payroll (employee_id, payroll_month),
    CONSTRAINT chk_payroll_status CHECK (payment_status IN ('pending','paid','cancelled')),
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_payroll_emp_month ON payroll(employee_id, payroll_month);
CREATE INDEX idx_payroll_status ON payroll(payment_status);
CREATE INDEX idx_payroll_month ON payroll(payroll_month);
CREATE INDEX idx_payroll_created_by ON payroll(created_by);

-- ============================================================
-- 9. EXPENSES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    expense_date DATE NOT NULL DEFAULT (CURDATE()),
    category VARCHAR(30) NOT NULL,
    description TEXT NOT NULL,
    amount DOUBLE NOT NULL,
    payment_method VARCHAR(20) NOT NULL,
    vendor_name VARCHAR(255),
    receipt_number VARCHAR(50),
    status VARCHAR(20) DEFAULT 'pending',
    approver_id INT,
    approval_date DATETIME,
    approval_notes TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INT,
    CONSTRAINT positive_expense CHECK (amount > 0),
    CONSTRAINT chk_expense_category CHECK (category IN ('utilities','equipment','supplies','maintenance','transport','communication','salary_advance','miscellaneous')),
    CONSTRAINT chk_expense_payment CHECK (payment_method IN ('cash','cheque','bank_transfer','card','upi')),
    CONSTRAINT chk_expense_status CHECK (status IN ('pending','approved','rejected','paid')),
    FOREIGN KEY (approver_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_expenses_date ON expenses(expense_date);
CREATE INDEX idx_expenses_category ON expenses(category);
CREATE INDEX idx_expenses_status ON expenses(status);
CREATE INDEX idx_expenses_approver_id ON expenses(approver_id);
CREATE INDEX idx_expenses_created_by ON expenses(created_by);

-- ============================================================
-- 10. AUDIT LOGS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    record_id INT,
    action VARCHAR(10) NOT NULL,
    old_values TEXT,
    new_values TEXT,
    user_id INT,
    ip_address VARCHAR(45),
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_audit_action CHECK (action IN ('create','update','delete','login','logout')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_table_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

-- ============================================================
-- 11. ERROR LOGS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS error_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    error_type VARCHAR(100),
    error_message TEXT,
    stack_trace TEXT,
    endpoint VARCHAR(500),
    method VARCHAR(10),
    user_id INT,
    client_ip VARCHAR(45),
    additional_data TEXT,
    severity VARCHAR(20) DEFAULT 'medium',
    feature VARCHAR(100),
    is_critical TINYINT(1) DEFAULT 0,
    is_resolved TINYINT(1) DEFAULT 0,
    assigned_to INT,
    resolution_notes TEXT,
    resolved_by INT,
    resolved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS error_summary (
    id INT AUTO_INCREMENT PRIMARY KEY,
    date DATE UNIQUE,
    total_errors INT DEFAULT 0,
    critical_errors INT DEFAULT 0,
    high_errors INT DEFAULT 0,
    medium_errors INT DEFAULT 0,
    low_errors INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS error_notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    error_log_id INT NOT NULL,
    user_id INT NOT NULL,
    notified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    acknowledged TINYINT(1) DEFAULT 0,
    acknowledged_at DATETIME,
    FOREIGN KEY (error_log_id) REFERENCES error_logs(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_errors_severity_created ON error_logs(severity, created_at);
CREATE INDEX idx_errors_feature_created ON error_logs(feature, created_at);
CREATE INDEX idx_errors_is_resolved ON error_logs(is_resolved);

-- ============================================================
-- 12. SYSTEM SETTINGS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(50) PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO system_settings (setting_key, setting_value)
VALUES (
    'invoice_email_template',
    'Dear {{client_name}},\n\nPlease find attached the invoice {{invoice_number}} for the period {{billing_period}}.\n\nTotal Amount: ₹{{total_amount}}\nDue Date: {{due_date}}\n\nThank you for your business.\n\nRegards,\nSecurity Agency'
);

INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('schema_version', '0');

-- ============================================================
-- SAMPLE SALARY STRUCTURES (for fresh installs)
-- ============================================================
INSERT IGNORE INTO salary_structures (name, base_salary, dearness_allowance, house_rent_allowance, pf_percentage) VALUES
('Basic Watchman - Grade A', 18000, 2000, 1500, 12.0),
('Senior Watchman - Grade B', 22000, 2500, 2000, 12.0),
('Head Guard - Grade C', 28000, 3000, 2500, 12.0),
('Supervisor - Grade D', 35000, 4000, 3000, 12.0);

-- ============================================================
-- SAMPLE CLIENTS (for fresh installs)
-- ============================================================
INSERT IGNORE INTO clients (name, address, city, state, phone, contact_person, monthly_rate, contract_start_date) VALUES
('Shanti Apartment Society', 'Plot 12, SG Highway, Bodakdev', 'Ahmedabad', 'Gujarat', '9876543210', 'Ramesh Patel', 45000, '2025-01-01'),
('Green Valley Complex', '34, Science City Road, Sola', 'Ahmedabad', 'Gujarat', '9876543211', 'Sunil Shah', 55000, '2025-02-01'),
('Sunrise Residency', '78, Bopal Road, Ghuma', 'Ahmedabad', 'Gujarat', '9876543212', 'Kavita Mehta', 38000, '2025-03-01'),
('Royal Heights', '22, Prahlad Nagar, Anandnagar', 'Ahmedabad', 'Gujarat', '9876543213', 'Ajay Desai', 62000, '2025-01-15'),
('Metro Tower', '5, CG Road, Navrangpura', 'Ahmedabad', 'Gujarat', '9876543214', 'Priya Joshi', 75000, '2024-12-01');
