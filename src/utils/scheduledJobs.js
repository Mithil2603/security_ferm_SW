const logger = require('./logger.js');
const cron = require('node-cron');
const { query } = require('../database/connection');
const { sendEmail } = require('./email');

// Auto-generate invoices on the 1st of every month at 00:01 AM
const startScheduledJobs = () => {
  cron.schedule('1 0 1 * *', async () => {
    logger.info('⏳ [CRON] Running monthly auto-invoice generation...');
    try {
      // 1. Fetch active regular clients (exclude event clients from auto-monthly generation)
      const clientsResult = await query(
        "SELECT * FROM clients WHERE is_active = true AND (client_type IS NULL OR client_type = 'regular')"
      );
      const activeClients = clientsResult.rows;

      if (activeClients.length === 0) {
        logger.info('⏳ [CRON] No active clients found.');
        return;
      }

      const today = new Date();
      const billingMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
      
      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      const nextMonthEnd = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0);
      
      let createdCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const client of activeClients) {
        try {
          const checkExists = await query(
            'SELECT id FROM invoices WHERE client_id = $1 AND billing_period_start >= $2',
            [client.id, billingMonth]
          );

          if (checkExists.rows.length > 0) {
            skippedCount++;
            continue;
          }

          const baseAmount = parseFloat(client.monthly_rate) || 0;
          const taxRate = 18;
          const taxAmount = (baseAmount * taxRate) / 100;
          const finalAmount = baseAmount + taxAmount;

          const invoiceNumber = `INV-${today.getFullYear().toString().slice(-2)}${String(today.getMonth() + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
          
          await query(
            `INSERT INTO invoices 
            (client_id, invoice_number, invoice_date, due_date, billing_period_start, billing_period_end, amount_subtotal, tax_rate, tax_amount, final_amount, payment_due, status, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              client.id,
              invoiceNumber,
              today.toISOString().split('T')[0],
              new Date(today.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Net 15
              nextMonth.toISOString().split('T')[0],
              nextMonthEnd.toISOString().split('T')[0],
              baseAmount,
              taxRate,
              taxAmount,
              finalAmount,
              finalAmount,
              'draft',
              null // created by system
            ]
          );
          createdCount++;
        } catch (err) {
          logger.error(`⏳ [CRON] Error creating invoice for client ${client.id}:`, err);
          errorCount++;
        }
      }

      logger.info(`✅ [CRON] Invoice generation completed: ${createdCount} created, ${skippedCount} skipped (already exist), ${errorCount} errors.`);
    } catch (error) {
      logger.error('⏳ [CRON] Failed to run monthly invoice generation:', error);
      try {
        const adminResult = await query("SELECT email FROM users WHERE role = 'admin' LIMIT 1");
        if (adminResult.rows.length > 0 && adminResult.rows[0].email) {
          await sendEmail({
            to: adminResult.rows[0].email,
            subject: '🚨 URGENT: Monthly Auto-Invoice CRON Failed',
            text: `The automated monthly invoice generation job failed entirely.\n\nError details:\n${error.message}\n\nPlease check the server logs immediately.`
          });
          logger.info('🚨 Admin alerted via email regarding invoice CRON failure.');
        }
      } catch (mailErr) {
        logger.error('Failed to send CRON failure alert:', mailErr);
      }
    }
  });

  // Auto-mark overdue invoices every day at 06:00 AM
  cron.schedule('0 6 * * *', async () => {
    try {
      const result = await query(
        `UPDATE invoices SET status = 'overdue', updated_at = CURRENT_TIMESTAMP
         WHERE status IN ('pending', 'partially_paid')
           AND due_date < date('now', 'localtime')
           AND payment_due > 0`
      );
      if (result.rowCount > 0) {
        logger.info(`⏰ [CRON] Marked ${result.rowCount} invoice(s) as overdue.`);
      }
    } catch (error) {
      logger.error('⏰ [CRON] Failed to update overdue invoices:', error);
      try {
        const adminResult = await query("SELECT email FROM users WHERE role = 'admin' LIMIT 1");
        if (adminResult.rows.length > 0 && adminResult.rows[0].email) {
          await sendEmail({
            to: adminResult.rows[0].email,
            subject: '🚨 CRON Warning: Overdue Invoices Failed',
            text: `The daily overdue invoices cron job failed.\n\nError details:\n${error.message}`
          });
        }
      } catch (e) {}
    }
  });
  
  // Process recurring expenses every day at 01:00 AM
  cron.schedule('0 1 * * *', async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const result = await query(
        `SELECT * FROM recurring_expenses 
         WHERE is_active = 1 AND next_run_date <= $1`,
        [today]
      );
      
      let processed = 0;
      for (const reqExp of result.rows) {
        try {
          await query('BEGIN TRANSACTION');
          // Insert expense
          await query(
            `INSERT INTO expenses (expense_date, category, description, amount, payment_method, vendor_id, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
            [today, reqExp.category, reqExp.title, reqExp.amount, reqExp.payment_method, reqExp.vendor_id, reqExp.created_by]
          );
          
          // Calculate next run date
          let nextDate = new Date(reqExp.next_run_date);
          if (reqExp.frequency === 'weekly') {
            nextDate.setDate(nextDate.getDate() + 7);
          } else if (reqExp.frequency === 'monthly') {
            nextDate.setMonth(nextDate.getMonth() + 1);
          } else if (reqExp.frequency === 'yearly') {
            nextDate.setFullYear(nextDate.getFullYear() + 1);
          }
          
          await query(
            'UPDATE recurring_expenses SET next_run_date = $1 WHERE id = $2',
            [nextDate.toISOString().split('T')[0], reqExp.id]
          );
          await query('COMMIT');
          processed++;
        } catch (txnErr) {
          await query('ROLLBACK');
          logger.error(`Failed to process recurring expense ID ${reqExp.id}:`, txnErr);
          throw txnErr; // Rethrow to trigger outer catch for email alert
        }
      }
      if (processed > 0) {
        logger.info(`⏰ [CRON] Processed ${processed} recurring expenses.`);
      }
    } catch (error) {
      logger.error('⏰ [CRON] Failed to process recurring expenses:', error);
      try {
        const adminResult = await query("SELECT email FROM users WHERE role = 'admin' LIMIT 1");
        if (adminResult.rows.length > 0 && adminResult.rows[0].email) {
          await sendEmail({
            to: adminResult.rows[0].email,
            subject: '🚨 CRON Warning: Recurring Expenses Failed',
            text: `The daily recurring expenses cron job failed.\n\nError details:\n${error.message}`
          });
        }
      } catch (e) {}
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Process recurring invoices every day at 9:00 AM (Phase 1)
  // ═══════════════════════════════════════════════════════════════════════════
  cron.schedule('0 9 * * *', async () => {
    logger.info('⏳ [CRON] Running recurring invoice generation...');
    try {
      const recurringService = require('../services/invoicing/recurringInvoices');
      const dueInvoices = await recurringService.getDueForGeneration();

      if (dueInvoices.length === 0) {
        logger.info('⏳ [CRON] No recurring invoices due for generation.');
        return;
      }

      let generated = 0;
      let errors = 0;

      for (const recurring of dueInvoices) {
        try {
          const result = await recurringService.generateInvoice(recurring.id);
          generated++;
          logger.info(`📄 [CRON] Generated invoice ${result.invoice_number} from recurring #${recurring.id} (${recurring.client_name})`);

          // Send email notification to client
          if (recurring.client_email) {
            try {
              await sendEmail({
                to: recurring.client_email,
                subject: `Invoice ${result.invoice_number} - ${recurring.client_name}`,
                text: `Dear ${recurring.client_name},\n\nA new invoice (${result.invoice_number}) has been generated for ₹${result.amount}.\nBilling period: ${result.billing_period.start} to ${result.billing_period.end}.\n\nPlease process the payment at your earliest convenience.\n\nRegards,\nSecurity Firm Management`,
              });
            } catch (emailErr) {
              logger.warn(`Email notification failed for recurring #${recurring.id}: ${emailErr.message}`);
            }
          }
        } catch (genErr) {
          errors++;
          logger.error(`⏳ [CRON] Failed to generate from recurring #${recurring.id}:`, genErr);
        }
      }

      logger.info(`✅ [CRON] Recurring invoice generation completed: ${generated} generated, ${errors} errors out of ${dueInvoices.length} due.`);
    } catch (error) {
      logger.error('⏳ [CRON] Failed to run recurring invoice generation:', error);
      try {
        const adminResult = await query("SELECT email FROM users WHERE role = 'admin' LIMIT 1");
        if (adminResult.rows.length > 0 && adminResult.rows[0].email) {
          await sendEmail({
            to: adminResult.rows[0].email,
            subject: '🚨 CRON: Recurring Invoice Generation Failed',
            text: `The recurring invoice generation cron job failed.\n\nError: ${error.message}\n\nPlease check server logs.`
          });
        }
      } catch (e) {}
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Send recurring invoice reminders every day at 8:00 AM (Phase 1)
  // ═══════════════════════════════════════════════════════════════════════════
  cron.schedule('0 8 * * *', async () => {
    try {
      const recurringService = require('../services/invoicing/recurringInvoices');
      const dueForReminder = await recurringService.getDueForReminder();

      for (const recurring of dueForReminder) {
        if (recurring.client_email) {
          try {
            await sendEmail({
              to: recurring.client_email,
              subject: `Upcoming Invoice Reminder - ${recurring.client_name}`,
              text: `Dear ${recurring.client_name},\n\nThis is a reminder that your next invoice will be generated on ${recurring.next_invoice_date}.\nMonthly rate: ₹${recurring.monthly_rate}\n\nRegards,\nSecurity Firm Management`,
            });
            logger.info(`📧 [CRON] Sent reminder to ${recurring.client_name} for invoice on ${recurring.next_invoice_date}`);
          } catch (emailErr) {
            logger.warn(`Reminder email failed for recurring #${recurring.id}: ${emailErr.message}`);
          }
        }
      }

      if (dueForReminder.length > 0) {
        logger.info(`📧 [CRON] Sent ${dueForReminder.length} renewal reminders.`);
      }
    } catch (error) {
      logger.error('⏳ [CRON] Failed to send recurring invoice reminders:', error);
    }
  });

  logger.info('⏰ Scheduled jobs initialized');
};

module.exports = { startScheduledJobs };
