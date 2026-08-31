require('dotenv').config();
const { initDB, query } = require('../src/database/connection');
const { generateInvoicePDF } = require('../src/utils/pdfGenerator');

async function testAllInvoices() {
  await initDB();
  const invs = await query(
    `SELECT i.*, c.name, c.address, c.city, c.state, c.postal_code, c.email, c.phone, c.gst_number
     FROM invoices i
     JOIN clients c ON i.client_id = c.id`
  );
  console.log(`Testing PDF generation on ${invs.rows.length} real database invoices...`);

  const agencySetting = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'");
  const agencySettings = agencySetting.rows.length > 0 ? JSON.parse(agencySetting.rows[0].setting_value) : null;

  let errors = 0;
  for (const inv of invs.rows) {
    try {
      const client = {
        name: inv.name || 'Client',
        address: inv.address || '',
        city: inv.city || '',
        state: inv.state || '',
        postal_code: inv.postal_code || '',
        email: inv.email || '',
        phone: inv.phone || '',
        gst_number: inv.gst_number || ''
      };
      const chunks = [];
      await new Promise((res, rej) => {
        try {
          generateInvoicePDF(inv, client, agencySettings, c => chunks.push(c), () => res());
        } catch (e) {
          rej(e);
        }
      });
      const buf = Buffer.concat(chunks);
      if (buf.length < 500) throw new Error('Buffer too small: ' + buf.length);
    } catch (err) {
      errors++;
      console.error(`❌ Failed on invoice id=${inv.id} (${inv.invoice_number}):`, err.message);
    }
  }

  if (errors === 0) {
    console.log(`✅ All ${invs.rows.length} database invoices generated valid PDF binaries without errors!`);
  } else {
    console.error(`❌ ${errors} invoices failed.`);
  }
  process.exit(errors === 0 ? 0 : 1);
}

testAllInvoices();
