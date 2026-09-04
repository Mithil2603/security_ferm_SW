const logger = require('../../utils/logger.js');

/**
 * Migration 024: Add client_type to clients table and relax monthly_rate constraint
 * - client_type: 'regular' (default) vs 'event' (one-time / ad-hoc services)
 * - monthly_rate constraint relaxed to >= 0 so event clients can have 0 monthly rate
 */
async function up(conn) {
  try {
    logger.info('     -> Checking client_type column in clients table...');
    const [cols] = await conn.execute("SHOW COLUMNS FROM clients LIKE 'client_type'");
    if (cols.length === 0) {
      logger.info('     -> Adding client_type column to clients table...');
      await conn.execute("ALTER TABLE clients ADD COLUMN client_type VARCHAR(20) DEFAULT 'regular'");
    }
  } catch (err) {
    logger.warn('Could not add client_type column in clients:', err.message);
  }

  try {
    logger.info('     -> Relaxing monthly_rate check constraint on clients table...');
    try {
      await conn.execute("ALTER TABLE clients DROP CHECK positive_rate");
    } catch (_) {}
    try {
      await conn.execute("ALTER TABLE clients DROP CHECK chk_client_rate");
    } catch (_) {}
    await conn.execute("ALTER TABLE clients ADD CONSTRAINT chk_client_rate CHECK (monthly_rate >= 0)");
  } catch (err) {
    logger.warn('Could not modify check constraint on clients:', err.message);
  }
}

module.exports = { up };
