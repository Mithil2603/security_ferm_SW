const { adaptSqlForMySQL } = require('./src/database/connection.js');
const q = `SELECT
         COALESCE(SUM(p.net_salary), 0) AS payroll,
         COALESCE((SELECT SUM(payment_received) FROM invoices
                   WHERE invoice_date >= date('now', 'localtime', '-30 days')), 0) AS revenue
       FROM payroll p
       WHERE p.payroll_month >= date('now', 'localtime', 'start of month', '-30 days')
         AND p.payroll_month <= date('now', 'localtime', 'start of month')`;
console.log(adaptSqlForMySQL(q));
