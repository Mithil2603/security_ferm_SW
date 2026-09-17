-- Add gender column to employees table
ALTER TABLE employees
  ADD COLUMN gender ENUM('Male', 'Female', 'Other') NULL AFTER date_of_birth;
