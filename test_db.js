const { app } = require('electron');
const Database = require('better-sqlite3');

app.whenReady().then(() => {
  const db = new Database('database.sqlite');
  console.log('RESULT:', JSON.stringify(db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').all('admin')));
  app.quit();
});
