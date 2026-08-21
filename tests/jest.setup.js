const { initDB } = require('../src/database/connection');

beforeAll(async () => {
  try {
    await initDB();
  } catch (err) {
    console.error('❌ Failed to initialize test database:', err.message);
    throw err;
  }
}, 30000);
