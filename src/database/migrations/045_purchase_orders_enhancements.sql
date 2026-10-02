-- Migration 045: Purchase Orders Enhancements
-- Adds bill number, state of supply, payment type, payment details, terms & conditions,
-- round off, and line item attributes (unit, price type, discounts, taxes).

ALTER TABLE purchase_orders ADD COLUMN bill_number VARCHAR(100);
ALTER TABLE purchase_orders ADD COLUMN state_of_supply VARCHAR(100);
ALTER TABLE purchase_orders ADD COLUMN payment_type VARCHAR(50) DEFAULT 'cash';
ALTER TABLE purchase_orders ADD COLUMN payment_details VARCHAR(255);
ALTER TABLE purchase_orders ADD COLUMN terms_conditions TEXT;
ALTER TABLE purchase_orders ADD COLUMN round_off DECIMAL(10,2) DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN discount_amount DECIMAL(12,2) DEFAULT 0;

ALTER TABLE purchase_order_items ADD COLUMN unit VARCHAR(50) DEFAULT 'NONE';
ALTER TABLE purchase_order_items ADD COLUMN price_type VARCHAR(20) DEFAULT 'without_tax';
ALTER TABLE purchase_order_items ADD COLUMN item_description TEXT;
ALTER TABLE purchase_order_items ADD COLUMN discount_percent DECIMAL(5,2) DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN discount_amount DECIMAL(12,2) DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN tax_rate DECIMAL(5,2) DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN tax_amount DECIMAL(12,2) DEFAULT 0;
