-- Migration 036: drop the stale expense category check constraint
--
-- expense_categories is a user-managed table (Settings > Expense Categories)
-- that lets admins add arbitrary categories like "Office". The expenses
-- table's chk_expense_category constraint still hardcoded the original
-- 8 categories, so any custom category failed with a check-constraint error.
-- Category values are already normalized/validated at the app layer.

ALTER TABLE expenses DROP CHECK chk_expense_category;
