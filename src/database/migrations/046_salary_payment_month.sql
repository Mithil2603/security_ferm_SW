-- Migration 046: salary month on salary payments
--
-- payment_date is when the money moved; salary_month (YYYY-MM) is which month's
-- salary it pays for — they often differ (September salary paid on 5 October),
-- and direct payments with no payroll run had no record of the month at all.

ALTER TABLE payment_transactions ADD COLUMN salary_month VARCHAR(7);
