-- Migration 038: unified Payments module — payment_transactions + payment_tax_details
--
-- Client payments, vendor payments, and salary payments existed as three disconnected
-- mechanisms, none of which wrote to `vouchers` (the only thing that moves a bank
-- account balance and the only thing Party/Vendor Ledger already read for a party).
-- payment_transactions is the shared money-movement record for all three; the
-- domain tables (payments/vendor_payments/salary_slips/payroll) keep being updated
-- alongside it so existing screens/reports are unaffected.
--
-- payment_tax_details is deliberately a separate table: GST is fixed once on the
-- bill/invoice and only ever gets prorated across payments against it, while TDS is
-- always a real per-payment entry (deducted at time of payment, not at invoice time).
-- Keeping these apart lets GST/TDS-by-party reporting query one clean table instead
-- of scattered columns, without touching the money-movement bookkeeping above it.

CREATE TABLE IF NOT EXISTS payment_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_type VARCHAR(20) NOT NULL,   -- 'client_receipt' | 'vendor_payment' | 'salary_payment'
    party_type VARCHAR(20) NOT NULL,          -- 'client' | 'vendor' | 'employee'
    party_id INTEGER NOT NULL,
    reference_type VARCHAR(20),               -- 'invoice' | 'expense' | 'payroll' | 'salary_slip' | 'none'
    reference_id INTEGER,
    amount REAL NOT NULL,
    payment_method VARCHAR(20) NOT NULL,      -- cash|cheque|bank_transfer|upi|card
    bank_account_id INTEGER REFERENCES bank_accounts(id),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    transaction_reference VARCHAR(100),
    attachment_url VARCHAR(500),
    notes TEXT,
    voucher_id INTEGER REFERENCES vouchers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_payment_tx_type ON payment_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_payment_tx_party ON payment_transactions(party_type, party_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_reference ON payment_transactions(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_date ON payment_transactions(payment_date);
CREATE INDEX IF NOT EXISTS idx_payment_tx_voucher ON payment_transactions(voucher_id);

CREATE TABLE IF NOT EXISTS payment_tax_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_transaction_id INTEGER NOT NULL REFERENCES payment_transactions(id) ON DELETE CASCADE,
    party_type VARCHAR(20) NOT NULL,          -- 'client' | 'vendor' (denormalized for report speed)
    party_id INTEGER NOT NULL,
    taxable_value REAL DEFAULT 0,
    tax_type VARCHAR(20) DEFAULT 'none',      -- 'none' | 'cgst_sgst' | 'igst'
    tax_rate REAL DEFAULT 0,
    cgst_amount REAL DEFAULT 0,
    sgst_amount REAL DEFAULT 0,
    igst_amount REAL DEFAULT 0,
    total_gst_amount REAL DEFAULT 0,          -- denormalized cgst+sgst+igst, for fast report SUMs
    is_rcm_applicable INTEGER DEFAULT 0,
    tds_amount REAL DEFAULT 0,
    tax_period DATE NOT NULL,                 -- normalized to 1st of month, for GST/TDS period reports
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_tax_party ON payment_tax_details(party_type, party_id);
CREATE INDEX IF NOT EXISTS idx_payment_tax_period ON payment_tax_details(tax_period);
CREATE INDEX IF NOT EXISTS idx_payment_tax_tx ON payment_tax_details(payment_transaction_id);
