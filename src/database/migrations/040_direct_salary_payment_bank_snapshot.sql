-- Direct/ad-hoc salary payments (no payroll run required) + employee bank
-- account history (one level back) + a snapshot of which bank account a
-- specific salary payment was actually sent to.

ALTER TABLE employees ADD COLUMN previous_bank_account_number VARCHAR(25);
ALTER TABLE employees ADD COLUMN previous_bank_ifsc_code VARCHAR(15);
ALTER TABLE employees ADD COLUMN previous_bank_name VARCHAR(100);
ALTER TABLE employees ADD COLUMN previous_bank_account_holder_name VARCHAR(255);
ALTER TABLE employees ADD COLUMN bank_updated_at DATETIME;

ALTER TABLE payment_transactions ADD COLUMN employee_bank_snapshot VARCHAR(500);
