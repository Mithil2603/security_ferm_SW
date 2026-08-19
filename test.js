const { adaptSqlForMySQL } = require('./src/database/connection.js');
console.log('5. ', adaptSqlForMySQL("date($2)"));
console.log('6. ', adaptSqlForMySQL("date(payroll_month, 'start of month')"));
console.log('7. ', adaptSqlForMySQL("date(payroll_month, 'start of month', '+1 month', '-1 day')"));
console.log('8. ', adaptSqlForMySQL("date($1, 'start of month')"));
