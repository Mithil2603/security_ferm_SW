const logger = require('../../utils/logger.js');

/**
 * Migration 057: fix a field-mapping bug in 051's one-time seed.
 *
 * The real `agency_settings` JSON blob (written by the frontend's Settings
 * page) uses the keys `agency_address` / `agency_phone` / `agency_email` —
 * not `address` / `phone` / `email` as 051 assumed. So 051 correctly carried
 * over name/gstin/logo but left address/phone/email blank on the seeded
 * company. Re-reads the same blob and fills in just those three columns,
 * only where they're still empty.
 */
async function up(conn) {
  const [settingsRows] = await conn.execute(
    `SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'`
  );
  if (settingsRows.length === 0) return;

  let parsed;
  try {
    parsed = JSON.parse(settingsRows[0].setting_value);
  } catch (err) {
    logger.warn('Could not parse agency_settings during migration 057:', err.message);
    return;
  }

  const address = parsed.agency_address || null;
  const phone = parsed.agency_phone || null;
  const email = parsed.agency_email || null;
  if (!address && !phone && !email) return;

  await conn.execute(
    `UPDATE companies SET
       address = COALESCE(NULLIF(address, ''), ?),
       phone = COALESCE(NULLIF(phone, ''), ?),
       email = COALESCE(NULLIF(email, ''), ?)
     WHERE id = (SELECT id FROM (SELECT MIN(id) as id FROM companies) t)`,
    [address, phone, email]
  );
}

module.exports = { up };
