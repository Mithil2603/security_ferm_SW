const logger = require('./logger.js');
const { query } = require('../database/connection');

/**
 * Save a statement snapshot to the saved_statements table.
 * Called after every financial transaction to create a permanent archive.
 */
async function saveStatement({
  domain,
  statement_number,
  title,
  reference_id = null,
  reference_type = null,
  statement_data,
  pdf_path = null,
  total_amount = 0,
  tax_amount = 0,
  period_from = null,
  period_to = null,
  party_name = null,
  party_id = null,
  generated_by = null,
  company_id = null
}) {
  try {
    const dataStr = typeof statement_data === 'string'
      ? statement_data
      : JSON.stringify(statement_data);

    const result = await query(
      `INSERT INTO saved_statements
        (domain, statement_number, title, reference_id, reference_type,
         statement_data, pdf_path, total_amount, tax_amount,
         period_from, period_to, party_name, party_id, generated_by, company_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        domain, statement_number, title, reference_id, reference_type,
        dataStr, pdf_path, total_amount, tax_amount,
        period_from, period_to, party_name, party_id, generated_by, company_id
      ]
    );

    return result.rows[0]?.id || null;
  } catch (error) {
    // Log but don't throw — statement saving should never break the main transaction
    logger.error(`[StatementSaver] Failed to save ${domain} statement "${statement_number}":`, error.message);
    return null;
  }
}

module.exports = { saveStatement };
