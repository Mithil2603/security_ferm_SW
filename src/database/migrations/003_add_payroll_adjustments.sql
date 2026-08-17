-- Add adjustments JSON column to payroll table to store dynamic additions and deductions
ALTER TABLE payroll ADD COLUMN adjustments TEXT DEFAULT ('[]');
