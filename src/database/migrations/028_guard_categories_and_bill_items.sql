-- Migration 028: Add guard_categories to clients and bill_items to invoices
ALTER TABLE clients ADD COLUMN guard_categories JSON NULL;
ALTER TABLE invoices ADD COLUMN bill_items JSON NULL;
