-- Migration 030: Add Round Off
ALTER TABLE invoices ADD COLUMN round_off DOUBLE NULL DEFAULT 0;
