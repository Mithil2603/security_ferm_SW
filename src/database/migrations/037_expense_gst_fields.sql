-- Migration 037: optional GST/RCM fields on vendor bills (expenses)
--
-- Invoices already carry tax_type/cgst_amount/sgst_amount/igst_amount/is_rcm_applicable,
-- but expenses (vendor bills) had none, so there was nothing for the new Payments
-- module to prorate GST from when a vendor payment settles part of a bill.
-- Mirrors the invoices columns exactly, all optional (default 'none'/0).

ALTER TABLE expenses ADD COLUMN tax_type VARCHAR(20) DEFAULT 'none';
ALTER TABLE expenses ADD COLUMN tax_rate DOUBLE DEFAULT 0;
ALTER TABLE expenses ADD COLUMN cgst_amount DOUBLE DEFAULT 0;
ALTER TABLE expenses ADD COLUMN sgst_amount DOUBLE DEFAULT 0;
ALTER TABLE expenses ADD COLUMN igst_amount DOUBLE DEFAULT 0;
ALTER TABLE expenses ADD COLUMN is_rcm_applicable TINYINT(1) DEFAULT 0;
