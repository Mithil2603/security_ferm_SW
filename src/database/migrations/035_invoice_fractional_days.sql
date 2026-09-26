-- Migration 035: allow fractional duty days on invoices
--
-- Guards sometimes work half-days (0.5), but duty_days_worked / total_duty_days
-- were INTEGER, which silently truncated 22.5 -> 22 and made billing inexact.
-- Widen them to DECIMAL so half-days (and other fractional days) survive.

ALTER TABLE invoices MODIFY COLUMN duty_days_worked DECIMAL(6,2);
ALTER TABLE invoices MODIFY COLUMN total_duty_days DECIMAL(6,2);
