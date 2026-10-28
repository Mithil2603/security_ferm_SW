// Replaces the old global `system_settings.agency_settings` JSON blob, which
// every PDF/report generator used to read directly. That data now lives on
// the per-company `companies` row (added in migration 051), so every former
// consumer of the blob calls getCompanyProfile(companyId) instead — same
// shape, same key names the frontend's Settings page already uses
// (agency_name, agency_address, agency_phone, agency_email, gst_number,
// agency_logo_url), just sourced per-company instead of system-wide.
const { query } = require('../database/connection');

async function getCompanyProfile(companyId) {
  if (!companyId) return null;
  try {
    const result = await query('SELECT * FROM companies WHERE id = $1', [companyId]);
    if (result.rows.length === 0) return null;
    const c = result.rows[0];
    return {
      agency_name: c.name,
      agency_address: c.address,
      agency_phone: c.phone,
      agency_email: c.email,
      gst_number: c.gstin,
      agency_logo_url: c.logo_url,
      legal_name: c.legal_name,
      pan: c.pan,
      bank_account_number: c.bank_account_number,
      bank_ifsc_code: c.bank_ifsc_code,
      bank_name: c.bank_name,
      bank_account_holder_name: c.bank_account_holder_name,
    };
  } catch (_) {
    return null;
  }
}

module.exports = { getCompanyProfile };
