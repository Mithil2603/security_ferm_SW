-- Migration 026: Add timeline, guard count, and daily billing fields to clients

ALTER TABLE clients ADD COLUMN employee_count INT NOT NULL DEFAULT 1;
ALTER TABLE clients ADD COLUMN timeline_unit VARCHAR(20) NOT NULL DEFAULT 'months';
ALTER TABLE clients ADD COLUMN timeline_duration INT NOT NULL DEFAULT 1;
ALTER TABLE clients ADD COLUMN rate_per_day DOUBLE NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN total_timeline_amount DOUBLE NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN addon_days INT NOT NULL DEFAULT 0;

-- Populate existing regular clients with rate_per_day = monthly_rate / 30 and total_timeline_amount
UPDATE clients 
SET rate_per_day = ROUND(monthly_rate / 30, 2),
    total_timeline_amount = monthly_rate
WHERE (rate_per_day IS NULL OR rate_per_day = 0) AND monthly_rate > 0;
