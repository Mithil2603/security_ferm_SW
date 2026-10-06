-- Migration 047: round off on client receipts / vendor payments
--
-- A client pays ₹11,200 against ₹11,227 due and the ₹27 is written off as
-- round off, closing the bill. Like TDS, it settles the bill without any money
-- moving, so it's kept out of payment_received / the bank voucher (cash only).
--   payment_transactions.round_off   — per payment (+ written off, − excess received)
--   invoices.settlement_round_off    — running total for the invoice; payment_due
--                                      = final_amount − payment_received − tds_deducted − settlement_round_off
-- Vendor bills need no new column: expenses.amount_paid already holds the total
-- settled (cash + TDS), and the round off is added into it the same way.

ALTER TABLE payment_transactions ADD COLUMN round_off DOUBLE DEFAULT 0;
ALTER TABLE invoices ADD COLUMN settlement_round_off DOUBLE DEFAULT 0;
