-- Migration 044: Purchase Order attachments + link legacy `payments` rows
-- back to the payment_transactions row that created them.
--
-- The legacy `payments` table (still read by the TDS/collections reports and
-- an invoice's payment-history list) had no way to trace a row back to the
-- payment_transactions row that created it, other than guessing by
-- invoice_id+date+amount. Deleting/undoing a client receipt needs a precise
-- match, so recordClientReceipt now stamps this id at insert time.
ALTER TABLE purchase_orders ADD COLUMN attachment_url VARCHAR(500);
ALTER TABLE payments ADD COLUMN payment_transaction_id INT;
