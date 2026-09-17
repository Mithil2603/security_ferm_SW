const { generateInvoicePDF } = require('../../../src/utils/pdfGenerator');

describe('Invoice PDF Generator Formatting & Layout', () => {
  const dummyClient = {
    name: 'D & C Hospitality Services Pvt Ltd.',
    address: '501, Kairos, Opp Mahatma Gandhi Labour Institute, Near Manav Mandir, Ahmedabad 380052, Gujarat',
    gst_number: '24ABDCS0817J1ZH'
  };

  const dummySettings = {
    agency_name: 'EAGLE EYE SECURITY SERVICE',
    agency_address: '418, SHIVALIK SATYAMEV, BOPAL-AMBLI JUNCTION, AHMEDABAD-380058',
    agency_phone: '8320931124',
    agency_email: 'info@eagleeyesecuritygroup.in',
    gst_number: '24AVYPP2011K1ZB',
    pan_number: 'AVYPP2011K'
  };

  test('generates valid PDF buffer for single-page invoice matching EES17 format', (done) => {
    const invoiceEES17 = {
      invoice_number: 'EES17',
      invoice_date: '2026-08-01',
      client_name: 'D & C Hospitality Services Pvt Ltd.',
      site_name: 'FLH 1',
      is_rcm_applicable: 1,
      amount_subtotal: 117984.00,
      final_amount: 117984.00,
      tax_type: 'none',
      bill_items: JSON.stringify([
        { particular: 'Security Guard', monthly_rate: 16000, guards_count: 8, rate_per_day: 516.00, hsn_code: '998525', total_duty_days: 224, amount: 115584.00 },
        { particular: 'Extra Security Guard', monthly_rate: '', guards_count: 3, rate_per_day: 800.00, hsn_code: '998525', total_duty_days: 3, amount: 2400.00 }
      ])
    };

    const chunks = [];
    const doc = generateInvoicePDF(
      invoiceEES17,
      dummyClient,
      dummySettings,
      chunk => chunks.push(chunk),
      () => {
        const buf = Buffer.concat(chunks);
        expect(buf.length).toBeGreaterThan(1000);
        expect(buf.slice(0, 4).toString()).toBe('%PDF');
        done();
      }
    );
    expect(doc).toBeDefined();
  });

  test('generates valid multi-page PDF buffer when items exceed PAGE_1_MAX (7 items)', (done) => {
    const items = [];
    for (let i = 1; i <= 10; i++) {
      items.push({
        particular: 'Guard Category ' + i,
        monthly_rate: 18000,
        guards_count: 2,
        rate_per_day: 600,
        hsn_code: '998525',
        total_duty_days: 62,
        amount: 36000
      });
    }

    const multiPageInvoice = {
      invoice_number: 'EES99',
      invoice_date: '2026-09-01',
      client_name: 'Big Multi-Site Client Ltd.',
      amount_subtotal: 360000,
      final_amount: 424800,
      tax_type: 'cgst_sgst',
      cgst_amount: 32400,
      sgst_amount: 32400,
      bill_items: JSON.stringify(items)
    };

    const chunks = [];
    generateInvoicePDF(
      multiPageInvoice,
      dummyClient,
      dummySettings,
      chunk => chunks.push(chunk),
      () => {
        const buf = Buffer.concat(chunks);
        expect(buf.length).toBeGreaterThan(2000);
        expect(buf.slice(0, 4).toString()).toBe('%PDF');
        done();
      }
    );
  });
});
