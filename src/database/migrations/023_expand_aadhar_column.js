const logger = require('../../utils/logger.js');

/**
 * Migration 023: Expand employees.aadhar_number column to VARCHAR(20)
 * to safely store both raw 12-digit and hyphenated 14-character (1234-1234-1234) numbers.
 */
async function up(conn) {
  try {
    logger.info('     -> Expanding employees.aadhar_number column to VARCHAR(20)...');
    await conn.execute('ALTER TABLE employees MODIFY COLUMN aadhar_number VARCHAR(20) NULL');
  } catch (err) {
    logger.warn('Could not alter aadhar_number column in employees:', err.message);
  }
}

module.exports = { up };
