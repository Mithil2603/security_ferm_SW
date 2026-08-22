const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const Decimal = require('decimal.js');
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validators');
const { sendEmail } = require('../utils/email');
const { generateInvoicePDF } = require('../utils/pdfGenerator');
const { saveStatement } = require('../utils/statementSaver');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requirePermission('manage_invoices'));

async function generateInvoiceNumber(dateString = null) {
  const targetDate = dateString ? new Date(dateString) : new Date();
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth() + 1;
  const shortYear = year.toString().slice(-2);
  const padMonth = String(month).padStart(2, '0');
  const prefix = `INV-${shortYear}${padMonth}-`;
  
  // Financial year starts on April 1st.
  const fyStartYear = month < 4 ? year - 1 : year;
  const fyStartDate = `${fyStartYear}-04-01`;
  const fyEndDate = `${fyStartYear + 1}-04-01`;

  const result = await query(
    `SELECT invoice_number FROM invoices 
     WHERE invoice_number LIKE 'INV-%' 
       AND invoice_date >= $1 
       AND invoice_date < $2
     ORDER BY id DESC LIMIT 1`,
    [fyStartDate, fyEndDate]
  );

  let sequence = 1; 
  if (result.rows.length > 0) {
    const lastInvoice = result.rows[0].invoice_number;
    const parts = lastInvoice.split('-');
    if (parts.length >= 3) {
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) {
        sequence = lastSeq + 1;
      }
    }
  }

  const paddedSequence = sequence.toString().padStart(4, '0');
  
  return `${prefix}${paddedSequence}`;
}

function calculateInvoiceAmounts(monthly_rate, billing_period_start, billing_period_end, tax_type = 'none', discount_amount = 0, is_rcm_applicable = false) {
  const start = new Date(billing_period_start);
  const end = new Date(billing_period_end);
  const daysInPeriod = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
  // Use the actual number of days in the billing start month (28-31) instead of fixed 30
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();

  const dailyRate = new Decimal(monthly_rate).dividedBy(daysInMonth);
  const amount_subtotal = dailyRate.times(daysInPeriod).toDecimalPlaces(2);
  
  const discountDec = new Decimal(discount_amount || 0);
  const taxable_amount = amount_subtotal.minus(discountDec);
  const final_taxable = taxable_amount.greaterThan(0) ? taxable_amount : new Decimal(0);
  
  let cgst_amount = new Decimal(0);
  let sgst_amount = new Decimal(0);
  let igst_amount = new Decimal(0);

  if (tax_type === 'cgst_sgst') {
    cgst_amount = final_taxable.times(0.09).toDecimalPlaces(2);
    sgst_amount = final_taxable.times(0.09).toDecimalPlaces(2);
  } else if (tax_type === 'igst') {
    igst_amount = final_taxable.times(0.18).toDecimalPlaces(2);
  }

  let total_amount = final_taxable;
  if (!is_rcm_applicable) {
    total_amount = total_amount.plus(cgst_amount).plus(sgst_amount).plus(igst_amount);
  }
  
  const final_amount = total_amount.toDecimalPlaces(2);

  return {
    daysInPeriod,
    amount_subtotal: parseFloat(amount_subtotal.toString()),
    cgst_amount: parseFloat(cgst_amount.toString()),
    sgst_amount: parseFloat(sgst_amount.toString()),
    igst_amount: parseFloat(igst_amount.toString()),
    total_amount: parseFloat(total_amount.toString()),
    final_amount: parseFloat(final_amount.toString()),
  };
}

// GET /api/invoices
router.get('/', async (req, res) => {
  try {
    const { client_id, status, from_date, to_date, page = 1, limit = 50 } = req.query;
    let conditions = [];
    let params = [];
    let pc = 1;

    if (client_id) { conditions.push(`i.client_id = $${pc}`); params.push(client_id); pc++; }
    if (status) { conditions.push(`i.status = $${pc}`); params.push(status); pc++; }
    if (from_date) { conditions.push(`i.invoice_date >= $${pc}`); params.push(from_date); pc++; }
    if (to_date) { conditions.push(`i.invoice_date <= $${pc}`); params.push(to_date); pc++; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT i.*, c.name as client_name, c.email as client_email, c.phone as client_phone,
        c.address as client_address, c.city as client_city, c.contact_person
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       ${where}
       ORDER BY i.invoice_date DESC, i.created_at DESC
       LIMIT $${pc} OFFSET $${pc + 1}`,
      [...params, parseInt(limit), offset]
    );

    const countResult = await query(`SELECT COUNT(*) AS count FROM invoices i ${where}`, params);

    res.json({
      success: true,
      data: result.rows,
      pagination: { total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(parseInt(countResult.rows[0].count) / parseInt(limit)) }
    });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'invoices' });
    logger.error('Get invoices error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch invoices' });
  }
});

// GET /api/invoices/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT i.*, c.name as client_name, c.email as client_email, c.phone as client_phone,
        c.address as client_address, c.city as client_city, c.state as client_state,
        c.contact_person, c.gst_number as client_gst
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       WHERE i.id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    // Also fetch payments
    const payments = await query(
      'SELECT * FROM payments WHERE invoice_id = $1 ORDER BY payment_date DESC',
      [req.params.id]
    );

    res.json({ success: true, data: { ...result.rows[0], payments: payments.rows } });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'invoices' });
    res.status(500).json({ success: false, message: 'Failed to fetch invoice' });
  }
});

// POST /api/invoices
router.post('/', validate(schemas.createInvoice), async (req, res) => {
  try {
    const { client_id, billing_period_start, billing_period_end, invoice_date, is_rcm_applicable, discount_amount, notes } = req.body;
    // Normalize tax_type: GST_18 is treated as cgst_sgst (18% split)
    const raw_tax_type = req.body.tax_type;
    const tax_type = (raw_tax_type === 'GST_18') ? 'cgst_sgst' : (raw_tax_type || 'none');
    
    if (!client_id || !billing_period_start || !billing_period_end) {
      return res.status(400).json({ success: false, message: 'Client ID, billing period start and end are required' });
    }

    // Check if an invoice already exists for this client for the exact same billing period
    const existingInvoice = await query(
      'SELECT id FROM invoices WHERE client_id = $1 AND billing_period_start = $2 AND billing_period_end = $3',
      [client_id, billing_period_start, billing_period_end]
    );
    if (existingInvoice.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'An invoice already exists for this client for the specified billing period.' });
    }

    // Get client monthly rate
    const clientResult = await query('SELECT * FROM clients WHERE id = $1 AND is_active = 1', [client_id]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Client not found or inactive' });
    }
    const client = clientResult.rows[0];

    const amounts = calculateInvoiceAmounts(client.monthly_rate, billing_period_start, billing_period_end, tax_type, discount_amount, is_rcm_applicable);
    const inv_date = invoice_date || new Date().toISOString().split('T')[0];
    const invoice_number = await generateInvoiceNumber(inv_date);
    const due_date = new Date(new Date(inv_date).getTime() + (parseInt(process.env.INVOICE_DUE_DAYS) || 30) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const result = await query(
      `INSERT INTO invoices (invoice_number, client_id, invoice_date, due_date, billing_period_start, billing_period_end,
        amount_subtotal, tax_type, cgst_amount, sgst_amount, igst_amount, is_rcm_applicable, total_amount, discount_amount, final_amount, payment_due, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [invoice_number, client_id, inv_date, due_date, billing_period_start, billing_period_end,
        amounts.amount_subtotal, tax_type || 'none', amounts.cgst_amount, amounts.sgst_amount, amounts.igst_amount, 
        is_rcm_applicable ? 1 : 0, amounts.total_amount, discount_amount,
        amounts.final_amount, amounts.final_amount, notes, req.user.userId]
    );

    const createdInvoice = result.rows[0];

    // Auto-save Invoice statement
    saveStatement({
      domain: 'invoice',
      statement_number: invoice_number,
      title: `Invoice for ${client.name} - ${billing_period_start} to ${billing_period_end}`,
      reference_id: createdInvoice.id,
      reference_type: 'invoice',
      statement_data: { ...createdInvoice, client_name: client.name, client_address: client.address, client_city: client.city, client_state: client.state, client_gst: client.gst_number, client_phone: client.phone, client_email: client.email },
      total_amount: amounts.final_amount,
      tax_amount: amounts.cgst_amount + amounts.sgst_amount + amounts.igst_amount,
      period_from: billing_period_start,
      period_to: billing_period_end,
      party_name: client.name,
      party_id: client.id,
      generated_by: req.user.userId
    });

    // Auto-save GST entry if tax is applied
    if (tax_type === 'cgst_sgst' || tax_type === 'igst') {
      saveStatement({
        domain: 'gst',
        statement_number: `GST-${invoice_number}`,
        title: `GST Entry: ${client.name} - ${invoice_number}`,
        reference_id: createdInvoice.id,
        reference_type: 'invoice',
        statement_data: {
          invoice_number, client_name: client.name, client_gst: client.gst_number,
          taxable_value: amounts.amount_subtotal, tax_type,
          cgst: amounts.cgst_amount, sgst: amounts.sgst_amount, igst: amounts.igst_amount,
          total: amounts.final_amount, is_rcm: is_rcm_applicable
        },
        total_amount: amounts.final_amount,
        tax_amount: amounts.cgst_amount + amounts.sgst_amount + amounts.igst_amount,
        period_from: billing_period_start,
        period_to: billing_period_end,
        party_name: client.name,
        party_id: client.id,
        generated_by: req.user.userId
      });
    }

    res.status(201).json({ success: true, data: createdInvoice, message: 'Invoice created successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'invoices' });
    logger.error('Create invoice error:', error);
    res.status(500).json({ success: false, message: 'Failed to create invoice' });
  }
});


// POST /api/invoices/:id/payment
router.post('/:id/payment', validate(schemas.recordPayment), async (req, res) => {
  try {
    // Support 'amount' as alias for 'amount_paid', 'reference_number' as alias for 'transaction_reference'
    const amount_paid = req.body.amount_paid || req.body.amount;
    const transaction_reference = req.body.transaction_reference || req.body.reference_number;
    const { tds_deducted = 0, payment_date, payment_method, notes } = req.body;
    if (!amount_paid || !payment_method) {
      return res.status(400).json({ success: false, message: 'Amount and payment method are required' });
    }

    const invoiceResult = await query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    const invoice = invoiceResult.rows[0];
    const total_credit = parseFloat(amount_paid) + parseFloat(tds_deducted);
    const remaining = parseFloat(invoice.final_amount) - parseFloat(invoice.payment_received || 0) - parseFloat(invoice.tds_deducted || 0);

    if (total_credit > remaining + 0.01) {
      return res.status(400).json({ success: false, message: `Amount + TDS exceeds remaining balance of ₹${remaining.toFixed(2)}` });
    }

    // Record payment
    await query(
      'INSERT INTO payments (invoice_id, payment_date, amount_paid, tds_deducted, payment_method, transaction_reference, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [req.params.id, payment_date || new Date().toISOString().split('T')[0], amount_paid, tds_deducted, payment_method, transaction_reference, notes, req.user.userId]
    );

    // Update invoice
    const newReceived = parseFloat(invoice.payment_received || 0) + parseFloat(amount_paid);
    const newTds = parseFloat(invoice.tds_deducted || 0) + parseFloat(tds_deducted);
    const newDue = parseFloat(invoice.final_amount) - newReceived - newTds;
    const newStatus = newDue <= 0.01 ? 'paid' : 'partially_paid';

    await query(
      'UPDATE invoices SET payment_received=$1, tds_deducted=$2, payment_due=$3, status=$4, updated_at=CURRENT_TIMESTAMP WHERE id=$5',
      [newReceived.toFixed(2), newTds.toFixed(2), Math.max(0, newDue).toFixed(2), newStatus, req.params.id]
    );

    const updatedInvoice = await query('SELECT i.*, c.name as client_name, c.gst_number as client_gst FROM invoices i JOIN clients c ON i.client_id = c.id WHERE i.id = $1', [req.params.id]);
    const updatedInv = updatedInvoice.rows[0];

    // Auto-save Payment Receipt statement
    const payDate = payment_date || new Date().toISOString().split('T')[0];
    saveStatement({
      domain: 'invoice',
      statement_number: `PMT-${updatedInv.invoice_number}-${payDate}`,
      title: `Payment Receipt: ${updatedInv.client_name} - ₹${parseFloat(amount_paid).toLocaleString()}`,
      reference_id: updatedInv.id,
      reference_type: 'payment',
      statement_data: {
        invoice_number: updatedInv.invoice_number, client_name: updatedInv.client_name,
        amount_paid: parseFloat(amount_paid), tds_deducted: parseFloat(tds_deducted),
        payment_method, transaction_reference, payment_date: payDate,
        invoice_total: updatedInv.final_amount, total_received: updatedInv.payment_received,
        total_tds: updatedInv.tds_deducted, remaining_due: updatedInv.payment_due,
        status: updatedInv.status
      },
      total_amount: parseFloat(amount_paid),
      party_name: updatedInv.client_name,
      party_id: updatedInv.client_id,
      generated_by: req.user.userId
    });

    // Auto-save TDS Certificate if TDS was deducted
    if (parseFloat(tds_deducted) > 0) {
      saveStatement({
        domain: 'tds',
        statement_number: `TDS-${updatedInv.client_name.replace(/\s+/g, '_')}-${payDate}`,
        title: `TDS Certificate: ${updatedInv.client_name} - ₹${parseFloat(tds_deducted).toLocaleString()}`,
        reference_id: updatedInv.id,
        reference_type: 'payment',
        statement_data: {
          invoice_number: updatedInv.invoice_number, client_name: updatedInv.client_name,
          client_gst: updatedInv.client_gst, payment_amount: parseFloat(amount_paid),
          tds_amount: parseFloat(tds_deducted), payment_method, transaction_reference,
          payment_date: payDate
        },
        total_amount: parseFloat(amount_paid),
        tax_amount: parseFloat(tds_deducted),
        party_name: updatedInv.client_name,
        party_id: updatedInv.client_id,
        generated_by: req.user.userId
      });
    }

    res.json({ success: true, data: updatedInv, message: 'Payment recorded successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'invoices' });
    logger.error('Record payment error:', error);
    res.status(500).json({ success: false, message: 'Failed to record payment' });
  }
});

// POST /api/invoices/calculate
router.post('/calculate', async (req, res) => {
  try {
    const { client_id, billing_period_start, billing_period_end, discount_amount = 0, is_rcm_applicable = false } = req.body;
    const raw_tax_type = req.body.tax_type || 'none';
    const tax_type = (raw_tax_type === 'GST_18') ? 'cgst_sgst' : raw_tax_type;
    const clientResult = await query('SELECT monthly_rate FROM clients WHERE id = $1', [client_id]);
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    const amounts = calculateInvoiceAmounts(clientResult.rows[0].monthly_rate, billing_period_start, billing_period_end, tax_type, discount_amount, is_rcm_applicable);
    res.json({ success: true, data: amounts });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'invoices' });
    res.status(500).json({ success: false, message: 'Calculation failed' });
  }
});

// DELETE /api/invoices/:id
router.delete('/:id', async (req, res) => {
  try {
    // Delete associated payments first to satisfy foreign key constraints
    await query('DELETE FROM payments WHERE invoice_id = $1', [req.params.id]);
    
    // We do a hard delete for invoices, but ensure it exists first
    const result = await query('DELETE FROM invoices WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    
    res.json({ success: true, message: 'Invoice deleted successfully' });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'invoices' });
    logger.error('Delete invoice error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete invoice' });
  }
});

// GET /api/invoices/:id/pdf
router.get('/:id/pdf', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      `SELECT i.*, c.name, c.address, c.city, c.state, c.postal_code, c.email, c.phone, c.gst_number
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       WHERE i.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const invoice = result.rows[0];
    const client = {
      name: invoice.name,
      address: invoice.address,
      city: invoice.city,
      state: invoice.state,
      postal_code: invoice.postal_code,
      email: invoice.email,
      phone: invoice.phone,
      gst_number: invoice.gst_number
    };

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice-${invoice.invoice_number}.pdf"`);

    const agencySetting = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'");
    const agencySettings = agencySetting.rows.length > 0 ? JSON.parse(agencySetting.rows[0].setting_value) : null;

    generateInvoicePDF(invoice, client, agencySettings,
      (chunk) => res.write(chunk),
      () => res.end()
    );
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'invoices' });
    logger.error('Generate invoice PDF error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to generate PDF' });
    }
  }
});

// POST /api/invoices/:id/email
router.post('/:id/email', async (req, res) => {
  try {
    const result = await query(
      `SELECT i.*, c.name as client_name, c.email as client_email
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       WHERE i.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const invoice = result.rows[0];

    if (!invoice.client_email) {
      return res.status(400).json({ success: false, message: 'Client has no email address configured' });
    }

    // Fetch template from system_settings
    const settingResult = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'invoice_email_template'");
    let template = settingResult.rows.length > 0 ? settingResult.rows[0].setting_value : '';

    if (!template) {
      // Fallback template
      template = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <h2 style="color: #0f766e;">Invoice {{invoice_number}}</h2>
        <p>Dear {{client_name}},</p>
        <p>Please find the details of your latest invoice below:</p>
        
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px; margin-bottom: 20px;">
          <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 10px 0; font-weight: bold;">Billing Period:</td>
            <td style="padding: 10px 0; text-align: right;">{{billing_period}}</td>
          </tr>
          <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 10px 0; font-weight: bold;">Subtotal:</td>
            <td style="padding: 10px 0; text-align: right;">₹{{subtotal}}</td>
          </tr>
          <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 10px 0; font-weight: bold;">Tax ({{tax_rate}}%):</td>
            <td style="padding: 10px 0; text-align: right;">₹{{tax_amount}}</td>
          </tr>
          <tr style="border-bottom: 2px solid #0f766e; background-color: #f0fdfa;">
            <td style="padding: 12px 10px; font-weight: bold; font-size: 16px;">Total Amount:</td>
            <td style="padding: 12px 10px; text-align: right; font-weight: bold; font-size: 16px; color: #0f766e;">₹{{total_amount}}</td>
          </tr>
        </table>
        
        <p style="margin-top: 30px;">Amount Due: <strong>₹{{amount_due}}</strong></p>
        <p>Due Date: <strong>{{due_date}}</strong></p>
        
        <p style="margin-top: 40px; font-size: 12px; color: #777;">Thank you for your business!<br>Security Agency Administration</p>
      </div>
      `;
    }

    // Replace placeholders
    const billingPeriodStr = `${new Date(invoice.billing_period_start).toLocaleDateString()} to ${new Date(invoice.billing_period_end).toLocaleDateString()}`;
    const emailHtml = template
      .replace(/{{client_name}}/g, invoice.client_name)
      .replace(/{{invoice_number}}/g, invoice.invoice_number)
      .replace(/{{billing_period}}/g, billingPeriodStr)
      .replace(/{{subtotal}}/g, parseFloat(invoice.amount_subtotal).toLocaleString('en-IN'))
      .replace(/{{tax_rate}}/g, invoice.tax_rate)
      .replace(/{{tax_amount}}/g, parseFloat(invoice.tax_amount).toLocaleString('en-IN'))
      .replace(/{{total_amount}}/g, parseFloat(invoice.final_amount).toLocaleString('en-IN'))
      .replace(/{{amount_due}}/g, parseFloat(invoice.payment_due).toLocaleString('en-IN'))
      .replace(/{{due_date}}/g, new Date(invoice.due_date).toLocaleDateString());

    const client = {
      name: invoice.client_name,
      address: invoice.address,
      city: invoice.city,
      state: invoice.state,
      postal_code: invoice.postal_code,
      email: invoice.client_email,
      phone: invoice.phone,
      gst_number: invoice.gst_number
    };

    const agencySetting = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'");
    const agencySettings = agencySetting.rows.length > 0 ? JSON.parse(agencySetting.rows[0].setting_value) : null;

    // Generate PDF to memory buffer
    const chunks = [];
    await new Promise((resolve, reject) => {
      try {
        generateInvoicePDF(invoice, client, agencySettings,
          (chunk) => chunks.push(chunk),
          () => resolve()
        );
      } catch (err) {
    logError(err, typeof req !== 'undefined' ? req : {}, { feature: 'invoices' });
        reject(err);
      }
    });
    
    const pdfBuffer = Buffer.concat(chunks);

    try {
      await sendEmail({
        to: invoice.client_email,
        subject: `Invoice ${invoice.invoice_number} from Security Agency`,
        html: emailHtml,
        text: `Invoice ${invoice.invoice_number} is ready. Total amount: ₹${invoice.final_amount}. Amount due: ₹${invoice.payment_due}. Due date: ${new Date(invoice.due_date).toLocaleDateString()}.`,
        attachments: [
          {
            filename: `Invoice-${invoice.invoice_number}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
          }
        ]
      });
      res.json({ success: true, message: 'Invoice sent successfully' });
    } catch (emailErr) {
    logError(emailErr, typeof req !== 'undefined' ? req : {}, { feature: 'invoices' });
      res.status(500).json({ success: false, message: `Email failed: ${emailErr.message}` });
    }
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'invoices' });
    logger.error('Email invoice error:', error);
    res.status(500).json({ success: false, message: 'Failed to send invoice email' });
  }
});

// POST /api/invoices/event (Direct Event Invoicing)
router.post('/event', async (req, res) => {
  try {
    const { 
      client_name, phone, email, address, city, state, gst_number,
      guards_count, rate_per_guard, days_worked,
      tax_type, is_rcm_applicable, notes 
    } = req.body;

    if (!client_name || !guards_count || !rate_per_guard || !days_worked) {
      return res.status(400).json({ success: false, message: 'Client name, guards count, rate, and days are required' });
    }

    // 1. Find or create client
    let client_id;
    const clientCheck = await query('SELECT id FROM clients WHERE name = $1 OR (phone = $2 AND phone IS NOT NULL AND phone != \'\')', [client_name, phone]);
    
    if (clientCheck.rows.length > 0) {
      client_id = clientCheck.rows[0].id;
    } else {
      const newClient = await query(
        `INSERT INTO clients (name, address, city, state, email, phone, gst_number, monthly_rate, contract_start_date) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE) RETURNING id`,
        [client_name, address || 'N/A', city || 'N/A', state || 'Gujarat', email, phone, gst_number, rate_per_guard * 30]
      );
      client_id = newClient.rows[0].id;
    }

    // 2. Calculate Math
    const amount_subtotal = parseFloat((guards_count * rate_per_guard * days_worked).toFixed(2));
    let cgst_amount = 0, sgst_amount = 0, igst_amount = 0;

    if (tax_type === 'cgst_sgst') {
      cgst_amount = parseFloat((amount_subtotal * 0.09).toFixed(2));
      sgst_amount = parseFloat((amount_subtotal * 0.09).toFixed(2));
    } else if (tax_type === 'igst') {
      igst_amount = parseFloat((amount_subtotal * 0.18).toFixed(2));
    }

    let total_amount = amount_subtotal;
    if (!is_rcm_applicable) {
      total_amount += cgst_amount + sgst_amount + igst_amount;
    }
    total_amount = parseFloat(total_amount.toFixed(2));

    const inv_date = new Date().toISOString().split('T')[0];
    const dueDays = parseInt(process.env.INVOICE_DUE_DAYS) || 30;
    const due_date = new Date(Date.now() + dueDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const invoice_number = await generateInvoiceNumber(inv_date);
    
    // Create Invoice
    const result = await query(
      `INSERT INTO invoices (
        invoice_number, client_id, invoice_date, due_date, 
        billing_period_start, billing_period_end, 
        amount_subtotal, total_amount, final_amount, payment_due,
        tax_type, cgst_amount, sgst_amount, igst_amount, is_rcm_applicable,
        duty_days_worked, is_ad_hoc, notes, created_by
      ) VALUES ($1, $2, $15, $16, $15, $15, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13, $14)
      RETURNING *`,
      [
        invoice_number, client_id, amount_subtotal, total_amount, total_amount, total_amount,
        tax_type || 'none', cgst_amount, sgst_amount, igst_amount, is_rcm_applicable ? 1 : 0,
        days_worked, notes, req.user.userId, inv_date, due_date
      ]
    );

    res.status(201).json({ success: true, message: 'Event invoice generated', data: result.rows[0] });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'invoices' });
    logger.error('Event invoice error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate event invoice' });
  }
});

// PUT /api/invoices/:id (Edit Invoice)
router.put('/:id', async (req, res) => {
  try {
    const {
      amount_subtotal, discount_amount, tax_type, is_rcm_applicable,
      due_date, notes, duty_days_worked
    } = req.body;

    const invoiceCheck = await query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (invoiceCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    const invoice = invoiceCheck.rows[0];

    const sub = parseFloat(amount_subtotal || invoice.amount_subtotal);
    const disc = parseFloat(discount_amount || invoice.discount_amount || 0);
    const taxType = tax_type || invoice.tax_type;
    
    let cgst_amount = 0, sgst_amount = 0, igst_amount = 0;
    const taxable_value = Math.max(0, sub - disc);
    
    if (taxType === 'cgst_sgst') {
      cgst_amount = parseFloat((taxable_value * 0.09).toFixed(2));
      sgst_amount = parseFloat((taxable_value * 0.09).toFixed(2));
    } else if (taxType === 'igst') {
      igst_amount = parseFloat((taxable_value * 0.18).toFixed(2));
    }

    const applyRcm = is_rcm_applicable === undefined ? invoice.is_rcm_applicable : (is_rcm_applicable ? 1 : 0);
    
    let final_amount = taxable_value;
    if (!applyRcm) {
      final_amount += cgst_amount + sgst_amount + igst_amount;
    }
    final_amount = parseFloat(final_amount.toFixed(2));
    const total_amount = parseFloat((taxable_value + cgst_amount + sgst_amount + igst_amount).toFixed(2));
    
    // Recalculate payment due
    const payment_due = parseFloat((final_amount - (invoice.payment_received || 0) - (invoice.tds_deducted || 0)).toFixed(2));
    let status = invoice.status;
    if (payment_due <= 0 && status !== 'cancelled') {
      status = 'paid';
    } else if (payment_due < final_amount && payment_due > 0 && status !== 'cancelled') {
      status = 'partially_paid';
    }

    const result = await query(
      `UPDATE invoices SET 
        amount_subtotal = $1, discount_amount = $2, total_amount = $3, final_amount = $4,
        payment_due = $5, tax_type = $6, cgst_amount = $7, sgst_amount = $8, igst_amount = $9,
        is_rcm_applicable = $10, due_date = $11, notes = $12, duty_days_worked = $13,
        status = $14, updated_at = CURRENT_TIMESTAMP
       WHERE id = $15 RETURNING *`,
      [
        sub, disc, total_amount, final_amount, payment_due,
        taxType, cgst_amount, sgst_amount, igst_amount, 
        is_rcm_applicable === undefined ? invoice.is_rcm_applicable : (is_rcm_applicable ? 1 : 0),
        due_date || invoice.due_date, notes || invoice.notes, 
        duty_days_worked || invoice.duty_days_worked,
        status, req.params.id
      ]
    );

    res.json({ success: true, message: 'Invoice updated successfully', data: result.rows[0] });
  } catch (error) {
    logError(error, typeof req !== 'undefined' ? req : {}, { feature: 'invoices' });
    logger.error('Update invoice error:', error);
    res.status(500).json({ success: false, message: 'Failed to update invoice' });
  }
});

module.exports = router;
