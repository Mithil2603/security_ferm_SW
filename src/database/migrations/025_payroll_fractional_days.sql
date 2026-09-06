-- Migration 025: allow fractional payable days on salary slips
--
-- "Batch Generate All" now derives payable days from attendance, where a
-- half-day counts as 0.5. days_worked / days_absent were INTEGER, which
-- silently truncated 22.5 -> 22. Widen them to DECIMAL so half-days survive.

ALTER TABLE salary_slips MODIFY COLUMN days_worked DECIMAL(6,2) NOT NULL DEFAULT 0;
ALTER TABLE salary_slips MODIFY COLUMN days_absent DECIMAL(6,2) DEFAULT 0;
