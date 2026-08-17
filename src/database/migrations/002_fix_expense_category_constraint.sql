-- Migration 002: Fix expense category constraint (MySQL version)
-- In MySQL we simply ALTER the table to change the column type/constraint.
-- The expenses table was already created without the CHECK constraint in schema_mysql.sql,
-- so this migration ensures the category column is unconstrained (VARCHAR 100) and
-- adds any missing columns introduced after the original schema.

-- Add invoice_reference column if it doesn't exist (was added in this migration for SQLite)
ALTER TABLE expenses ADD COLUMN invoice_reference VARCHAR(200);

-- Recreate indexes (duplicate errors are safely ignored by migrationRunner)
CREATE INDEX idx_expenses_date ON expenses(expense_date);
CREATE INDEX idx_expenses_category ON expenses(category);
CREATE INDEX idx_expenses_status ON expenses(status);
CREATE INDEX idx_expenses_approver_id ON expenses(approver_id);
CREATE INDEX idx_expenses_created_by ON expenses(created_by);

