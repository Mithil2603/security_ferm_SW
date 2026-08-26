const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(process.cwd(), 'database.sqlite');

try {
  const db = new Database(dbPath);
  
  const htmlTemplate = `
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

  db.exec(`
    UPDATE system_settings 
    SET setting_value = '${htmlTemplate.replace(/'/g, "''")}'
    WHERE setting_key = 'invoice_email_template';
  `);
  console.log('✅ HTML Email Template successfully injected into database!');
} catch (err) {
  console.error('Failed:', err);
}
