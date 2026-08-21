-- Migration 021: Add password reset token columns to users table
ALTER TABLE users ADD COLUMN reset_token VARCHAR(64) NULL;
ALTER TABLE users ADD COLUMN reset_token_expires DATETIME NULL;
