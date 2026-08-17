CREATE TABLE IF NOT EXISTS bank_accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    account_name VARCHAR(255) NOT NULL,
    account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('bank', 'cash')),
    account_number VARCHAR(50),
    bank_name VARCHAR(255),
    ifsc_code VARCHAR(20),
    branch VARCHAR(255),
    opening_balance DOUBLE DEFAULT 0,
    opening_balance_date DATE,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT
);

CREATE TABLE IF NOT EXISTS vouchers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    voucher_number VARCHAR(50) UNIQUE NOT NULL,
    voucher_type VARCHAR(20) NOT NULL CHECK (voucher_type IN (
        'cash_payment', 'cash_receipt',
        'bank_payment', 'bank_receipt',
        'journal', 'contra',
        'debit_note', 'credit_note'
    )),
    voucher_date DATE NOT NULL DEFAULT (CURDATE()),
    amount DOUBLE NOT NULL CHECK (amount > 0),
    debit_account_id INT,
    credit_account_id INT,
    party_type VARCHAR(20) CHECK (party_type IN ('client', 'employee', 'vendor', 'other', NULL)),
    party_id INT,
    party_name VARCHAR(255),
    reference_type VARCHAR(30) CHECK (reference_type IN ('invoice', 'expense', 'payroll', 'none', NULL)),
    reference_id INT,
    narration TEXT,
    cheque_number VARCHAR(50),
    cheque_date DATE,
    transaction_ref VARCHAR(100),
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'posted', 'cancelled')),
    approved_by INT,
    approval_date TIMESTAMP,
    cancelled_by INT,
    cancellation_date TIMESTAMP,
    cancellation_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT
);
