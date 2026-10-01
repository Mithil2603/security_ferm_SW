-- Migration 043: variable GST rate for recurring invoice templates
--
-- Recurring invoices only stored tax_type (cgst_sgst/igst/none) and always
-- generated at a hardcoded 18% whenever GST was on. Adding tax_rate lets a
-- template bill at whatever rate applies (5/12/18/28/etc), matching the same
-- flexibility already added to plain, event, and edited invoices.

ALTER TABLE recurring_invoices ADD COLUMN tax_rate DOUBLE DEFAULT 18;
