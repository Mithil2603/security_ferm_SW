-- Migration 027: Add Invoice Format Fields & Seed IndusInd Bank
-- Allows custom site name, payment bank account, particular description, and custom rates on invoices

ALTER TABLE invoices ADD COLUMN site_name VARCHAR(255) NULL;
ALTER TABLE invoices ADD COLUMN bank_account_id INT NULL;
ALTER TABLE invoices ADD COLUMN particular VARCHAR(255) NULL DEFAULT 'Security Guard';
ALTER TABLE invoices ADD COLUMN rate_per_day DOUBLE NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN monthly_rate DOUBLE NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN guards_count INT NULL DEFAULT 1;
ALTER TABLE invoices ADD COLUMN hsn_code VARCHAR(20) NULL DEFAULT '998525';
ALTER TABLE invoices ADD COLUMN total_duty_days INT NULL DEFAULT 0;

-- Insert IndusInd Bank account into bank_accounts if not already present
INSERT INTO bank_accounts (account_name, bank_name, account_number, ifsc_code, account_type, is_active, created_at)
SELECT 'Eagle Eye Security Service', 'Indusind Bank', '252528112019', 'INDB0000676', 'bank', 1, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM bank_accounts WHERE account_number = '252528112019'
);

-- Ensure agency_settings has correct Eagle Eye Security details
UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, '{}'),
  '$.agency_name', 'EAGLE EYE SECURITY SERVICE',
  '$.agency_address', '418, SHIVALIK SATYAMEV, BOPAL-AMBLI JUNCTION, AHMEDABAD-380058',
  '$.agency_phone', '8320931124',
  '$.agency_email', 'info@eagleeyesecuritygroup.in',
  '$.gst_number', '24AVYPP2011K1ZB',
  '$.pan_number', 'AVYPP2011K',
  '$.jurisdiction_city', 'Ahmedabad',
  '$.bank_name', 'Indusind Bank',
  '$.bank_account_number', '252528112019',
  '$.bank_ifsc', 'INDB0000676'
),
updated_at = CURRENT_TIMESTAMP
WHERE setting_key = 'agency_settings';
