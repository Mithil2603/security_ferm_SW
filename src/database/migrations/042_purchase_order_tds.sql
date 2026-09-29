-- TDS isn't a Purchase Order concept under Indian tax law (it's triggered at
-- bill-booking or payment time, whichever is earlier) — but capturing the
-- expected rate on the PO for planning, then carrying it through to the real
-- bill on conversion, mirrors how GST is already handled here and lets Vendor
-- Payments auto-lock TDS the same way it does for any other bill with a known rate.
ALTER TABLE purchase_orders ADD COLUMN tds_rate DOUBLE DEFAULT 0;
