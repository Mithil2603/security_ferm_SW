const { initDB } = require('../src/database/connection');

// Try to bring up the test database. Integration suites need it and will fail
// on their own queries if it is missing. Pure unit tests (calculators, date
// math, etc.) must still be runnable without a local MySQL, so a connection
// failure here is reported loudly but not treated as fatal.
beforeAll(async () => {
  try {
    await initDB();
    global.__DB_AVAILABLE__ = true;
  } catch (err) {
    global.__DB_AVAILABLE__ = false;
    console.warn(
      `⚠️  Test database unavailable (${err.message}). ` +
      'DB-backed integration tests will fail; pure unit tests will still run.'
    );
  }
}, 30000);
