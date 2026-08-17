const mysql = require('mysql2/promise');
async function test() {
  const c = await mysql.createConnection({host:'127.0.0.1',port:3306,user:'root',password:'',database:'security_firm_db'});
  try {
    await c.query("CREATE TABLE t2 (a TEXT DEFAULT ('[]'))");
    console.log('CREATED');
  } catch(e) {
    console.error('ERROR:', e.errno, e.message);
  }
  await c.end();
}
test();
