const Database = require('better-sqlite3');
const db = new Database(process.env.APPDATA + '/secuirty-agency-software/database.sqlite');
console.log('USERS:', JSON.stringify(db.prepare('SELECT * FROM users').all()));
