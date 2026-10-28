const { query } = require('../database/connection');
const logger = require('../utils/logger');

/**
 * Logs an action to the audit_logs table.
 * 
 * @param {Object} req - Express request object (used to extract user and IP)
 * @param {string} tableName - The entity/table being modified (e.g. 'clients', 'employees', 'invoices')
 * @param {number|string} recordId - The ID of the record being modified
 * @param {string} action - 'create', 'update', 'delete', 'login', 'logout'
 * @param {string} description - Human readable description of the action
 * @param {Object} [oldValues=null] - The old state of the record (for updates/deletes)
 * @param {Object} [newValues=null] - The new state of the record (for creates/updates)
 */
async function logAudit(req, tableName, recordId, action, description, oldValues = null, newValues = null) {
  try {
    const userId = req.user ? req.user.userId : null;
    const companyId = req.user?.companyId || null;
    const clientIp = req.ip || req.connection?.remoteAddress || null;

    await query(
      `INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, user_id, ip_address, description, company_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tableName,
        recordId,
        action,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        userId,
        clientIp,
        description,
        companyId
      ]
    );
  } catch (error) {
    // We don't want audit logging failures to break the main application flow,
    // so we catch and log it locally.
    logger.error('Failed to write audit log:', error);
  }
}

/**
 * Express middleware to automatically log request details (optional, usually we call logAudit directly in controllers)
 */
function auditMiddleware(tableName, actionBuilder) {
  return async (req, res, next) => {
    // Intercept response to get the newly created record ID if applicable
    const originalSend = res.send;
    res.send = function (body) {
      res.send = originalSend;
      
      try {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const parsedBody = JSON.parse(body);
          const actionDetails = actionBuilder(req, parsedBody);
          if (actionDetails) {
            logAudit(
              req,
              tableName,
              actionDetails.recordId,
              actionDetails.action,
              actionDetails.description,
              actionDetails.oldValues,
              actionDetails.newValues
            );
          }
        }
      } catch (e) {
        // Ignore JSON parse errors or builder errors
      }
      
      return res.send(body);
    };
    next();
  };
}

module.exports = {
  logAudit,
  auditMiddleware
};
