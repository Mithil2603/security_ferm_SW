-- Migration 034: Add sites JSON column to clients table
ALTER TABLE clients ADD COLUMN sites JSON NULL;
