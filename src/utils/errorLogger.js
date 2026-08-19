const logger = require('./logger.js');
/**
 * Centralized Error Logger
 * 
 * Logs every caught error from route handlers into the error_logs table
 * so they appear in the Developer Console. Fire-and-forget — never throws.
 */
const { query } = require('../database/connection');

const ERROR_SEVERITY = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' };
const ERROR_CATEGORY = { BACKUP: 'BACKUP', SYSTEM: 'SYSTEM', PAYROLL: 'PAYROLL', AUTH: 'AUTH', DEFAULT: 'DEFAULT' };

async function logError(error, req, context = {}) {
  try {
    const user_id = req?.user?.userId || null;
    const client_ip = req?.ip || req?.connection?.remoteAddress || null;
    const endpoint = req?.originalUrl || req?.url || context.endpoint || null;
    const method = req?.method || context.method || null;

    // Build a descriptive error_type from context
    const error_type = context.error_type || error?.name || 'ServerError';
    const error_message = context.error_message || error?.message || 'Unknown error';

    // Include route-specific context in additional_data
    const additional_data = {
      route: context.route || null,
      feature: context.feature || null,
      params: req?.params || null,
      query_params: req?.query || null,
      ...context.extra
    };

    await query(
      `INSERT INTO error_logs (error_type, error_message, stack_trace, endpoint, method, user_id, client_ip, additional_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        error_type,
        error_message,
        error?.stack || null,
        endpoint,
        method,
        user_id,
        client_ip,
        JSON.stringify(additional_data)
      ]
    );
  } catch (dbErr) {
    // Never throw — just logger.error as last resort
    logger.error('[ErrorLogger] Failed to write to error_logs:', dbErr.message);
  }
}

module.exports = { logError, ERROR_SEVERITY, ERROR_CATEGORY };
