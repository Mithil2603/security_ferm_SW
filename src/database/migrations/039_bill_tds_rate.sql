-- Migration 039: optional TDS rate at bill-creation time
--
-- Client invoices and vendor bills already carry a fixed GST split, set once
-- at creation. TDS didn't have an equivalent "this bill is subject to X% TDS"
-- field — only a running `tds_deducted` total updated as payments come in.
-- Adding tds_rate lets the Payments module auto-derive and lock TDS from the
-- bill's own known rate, instead of always requiring manual entry.

ALTER TABLE invoices ADD COLUMN tds_rate DOUBLE DEFAULT 0;
ALTER TABLE expenses ADD COLUMN tds_rate DOUBLE DEFAULT 0;
