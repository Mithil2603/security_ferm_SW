/**
 * src/services/workflows/workflowEngine.js
 * 
 * Workflow Engine: trigger > condition > action rule execution.
 * Handles:
 *  - Rule evaluation with JSON condition matching
 *  - Auto-approval for expenses/payroll below thresholds
 *  - Invoice overdue reminder escalation (15/30/45 days)
 *  - Smart notification generation
 *  - Execution logging for audit trail
 */

const { query } = require('../../database/connection');
const logger = require('../../utils/logger');

class WorkflowEngine {

  // ═══════════════════════════════════════════════════════════════════════════
  // Condition Evaluation (pure logic, no DB)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Evaluate a condition against entity data.
   * @param {Object} condition - { field, operator, value }
   * @param {Object} entityData - The data to evaluate against
   * @returns {boolean}
   */
  evaluateCondition(condition, entityData) {
    if (!condition || !condition.field) return true; // No condition = always true

    const fieldValue = entityData[condition.field];
    const targetValue = condition.value;

    switch (condition.operator) {
      case '==': case 'equals': return fieldValue == targetValue;
      case '!=': case 'not_equals': return fieldValue != targetValue;
      case '>': case 'gt': return Number(fieldValue) > Number(targetValue);
      case '>=': case 'gte': return Number(fieldValue) >= Number(targetValue);
      case '<': case 'lt': return Number(fieldValue) < Number(targetValue);
      case '<=': case 'lte': return Number(fieldValue) <= Number(targetValue);
      case 'contains': return String(fieldValue).toLowerCase().includes(String(targetValue).toLowerCase());
      case 'in': return Array.isArray(targetValue) ? targetValue.includes(fieldValue) : false;
      default: return false;
    }
  }

  /**
   * Determine reminder type based on days overdue.
   */
  getEscalationLevel(daysOverdue) {
    if (daysOverdue >= 45) return { level: 4, type: 'final', message: 'FINAL NOTICE: Payment critically overdue.' };
    if (daysOverdue >= 30) return { level: 3, type: 'urgent', message: 'URGENT: Payment significantly overdue. Immediate action required.' };
    if (daysOverdue >= 15) return { level: 2, type: 'firm', message: 'Payment reminder: Invoice is past due. Please arrange payment.' };
    return { level: 1, type: 'gentle', message: 'Friendly reminder: Invoice payment is due.' };
  }

  /**
   * Check if an expense qualifies for auto-approval.
   */
  checkAutoApproval(entityType, data) {
    if (entityType === 'expense' && data.amount < 5000) {
      return { approved: true, reason: 'Auto-approved: amount below ₹5,000 threshold' };
    }
    if (entityType === 'payroll' && data.status === 'generated') {
      return { approved: true, reason: 'Auto-approved: standard payroll run' };
    }
    return { approved: false, reason: null };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Rule CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  async getRules(filters = {}) {
    const { trigger_entity, is_active = 1 } = filters;
    let conditions = ['is_active = $1'];
    let params = [is_active];
    let pc = 2;
    if (trigger_entity) { conditions.push(`trigger_entity = $${pc}`); params.push(trigger_entity); pc++; }

    const result = await query(
      `SELECT * FROM workflow_rules WHERE ${conditions.join(' AND ')} ORDER BY priority, name`,
      params
    );
    return result.rows;
  }

  async getRule(id) {
    const result = await query(`SELECT * FROM workflow_rules WHERE id = $1`, [id]);
    return result.rows[0] || null;
  }

  async createRule(data) {
    await query(
      `INSERT INTO workflow_rules (name, description, trigger_entity, trigger_event,
       condition_json, action_type, action_config, priority, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [data.name, data.description || null, data.trigger_entity, data.trigger_event,
       JSON.stringify(data.condition || {}), data.action_type,
       JSON.stringify(data.action_config || {}), data.priority || 5, data.created_by || null]
    );
    const result = await query(`SELECT * FROM workflow_rules ORDER BY id DESC LIMIT 1`);
    return result.rows[0];
  }

  async updateRule(id, data) {
    const fields = [];
    const params = [];
    let pc = 1;
    for (const key of ['name', 'description', 'trigger_entity', 'trigger_event', 'action_type', 'priority', 'is_active']) {
      if (data[key] !== undefined) { fields.push(`${key} = $${pc}`); params.push(data[key]); pc++; }
    }
    if (data.condition !== undefined) { fields.push(`condition_json = $${pc}`); params.push(JSON.stringify(data.condition)); pc++; }
    if (data.action_config !== undefined) { fields.push(`action_config = $${pc}`); params.push(JSON.stringify(data.action_config)); pc++; }
    if (fields.length === 0) return this.getRule(id);
    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    await query(`UPDATE workflow_rules SET ${fields.join(', ')} WHERE id = $${pc}`, params);
    return this.getRule(id);
  }

  async deleteRule(id) {
    await query(`UPDATE workflow_rules SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Rule Execution
  // ═══════════════════════════════════════════════════════════════════════════

  async executeRulesForEvent(triggerEntity, triggerEvent, entityData) {
    const startTime = Date.now();
    const rules = await this.getRules({ trigger_entity: triggerEntity });
    const results = [];

    for (const rule of rules) {
      if (rule.trigger_event !== triggerEvent) continue;

      let condition = {};
      try { condition = JSON.parse(rule.condition_json || '{}'); } catch {}

      const conditionResult = this.evaluateCondition(condition, entityData);

      if (!conditionResult) {
        await this._logExecution(rule.id, entityData, false, 'Condition not met', 'skipped');
        results.push({ rule: rule.name, status: 'skipped' });
        continue;
      }

      try {
        let actionConfig = {};
        try { actionConfig = JSON.parse(rule.action_config || '{}'); } catch {}

        const actionResult = await this._executeAction(rule.action_type, actionConfig, entityData);

        await query(
          `UPDATE workflow_rules SET execution_count = execution_count + 1,
           last_executed = CURRENT_TIMESTAMP WHERE id = $1`, [rule.id]
        );
        await this._logExecution(rule.id, entityData, true, JSON.stringify(actionResult), 'success');
        results.push({ rule: rule.name, status: 'executed', result: actionResult });
      } catch (err) {
        await this._logExecution(rule.id, entityData, true, err.message, 'failed');
        results.push({ rule: rule.name, status: 'failed', error: err.message });
      }
    }

    return { executed: results.filter(r => r.status === 'executed').length, total: results.length, results };
  }

  async _executeAction(actionType, config, entityData) {
    switch (actionType) {
      case 'send_notification':
        return this._createNotification(config, entityData);
      case 'auto_approve':
        return { action: 'auto_approve', ...config };
      case 'create_reminder':
        return this._createReminder(config, entityData);
      case 'escalate':
        return this._createNotification({ ...config, type: 'alert' }, entityData);
      case 'update_status':
        return { action: 'update_status', ...config };
      default:
        return { action: actionType, config };
    }
  }

  async _createNotification(config, entityData) {
    await query(
      `INSERT INTO notifications (user_id, title, message, type, category, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entityData.user_id || null, config.title || 'Workflow Alert',
       config.message || 'Action required', config.type || 'info',
       entityData.entity_type || null, entityData.entity_type || null,
       entityData.entity_id || null]
    );
    return { action: 'notification_sent', title: config.title };
  }

  async _createReminder(config, entityData) {
    if (entityData.invoice_id) {
      await query(
        `INSERT INTO reminder_escalations (invoice_id, escalation_level, days_overdue,
         reminder_type, sent_to) VALUES ($1, $2, $3, $4, $5)`,
        [entityData.invoice_id, entityData.escalation_level || 1,
         entityData.days_overdue || 0, config.reminder_type || 'gentle',
         entityData.client_email || null]
      );
    }
    return { action: 'reminder_created', type: config.reminder_type };
  }

  async _logExecution(ruleId, triggerData, conditionResult, actionResult, status) {
    await query(
      `INSERT INTO workflow_logs (workflow_rule_id, trigger_data, condition_result, action_result, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [ruleId, JSON.stringify(triggerData).substring(0, 1000), conditionResult ? 1 : 0, actionResult, status]
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Notifications
  // ═══════════════════════════════════════════════════════════════════════════

  async getNotifications(userId, filters = {}) {
    const { is_read, page = 1, limit = 50 } = filters;
    let conditions = ['user_id = $1 OR user_id IS NULL'];
    let params = [userId];
    let pc = 2;
    if (is_read !== undefined) { conditions.push(`is_read = $${pc}`); params.push(is_read); pc++; }

    const p = parseInt(page) || 1;
    const l = parseInt(limit) || 50;
    const offset = (p - 1) * l;
    const result = await query(
      `SELECT * FROM notifications WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC LIMIT $${pc} OFFSET $${pc + 1}`,
      [...params, l, offset]
    );

    const unreadCount = await query(
      `SELECT COUNT(*) as count FROM notifications WHERE (user_id = $1 OR user_id IS NULL) AND is_read = 0`,
      [userId]
    );

    return { data: result.rows, unread_count: parseInt(unreadCount.rows[0].count) };
  }

  async markRead(notificationId) {
    await query(
      `UPDATE notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [notificationId]
    );
  }

  async markAllRead(userId) {
    await query(
      `UPDATE notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP
       WHERE (user_id = $1 OR user_id IS NULL) AND is_read = 0`,
      [userId]
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Invoice Overdue Scanner
  // ═══════════════════════════════════════════════════════════════════════════

  async scanOverdueInvoices() {
    const overdueInvoices = await query(
      `SELECT i.*, c.company_name, c.email as client_email,
              julianday('now') - julianday(i.due_date) as days_overdue
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       WHERE i.status IN ('sent', 'partially_paid', 'overdue')
         AND i.due_date < date('now')
       ORDER BY i.due_date ASC`
    );

    let reminders = 0;
    for (const inv of overdueInvoices.rows) {
      const daysOverdue = Math.floor(inv.days_overdue);
      const escalation = this.getEscalationLevel(daysOverdue);

      // Check if reminder already sent at this level
      const existing = await query(
        `SELECT id FROM reminder_escalations WHERE invoice_id = $1 AND escalation_level = $2`,
        [inv.id, escalation.level]
      );
      if (existing.rows.length > 0) continue;

      await this.executeRulesForEvent('invoice', 'overdue', {
        invoice_id: inv.id, entity_type: 'invoice', entity_id: inv.id,
        days_overdue: daysOverdue, amount: inv.payment_due,
        client_name: inv.company_name, client_email: inv.client_email,
        escalation_level: escalation.level,
      });
      reminders++;
    }

    return { scanned: overdueInvoices.rows.length, reminders_created: reminders };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Auto-Approval Rules
  // ═══════════════════════════════════════════════════════════════════════════

  async getAutoApprovalRules() {
    const result = await query(`SELECT * FROM auto_approval_rules WHERE is_active = 1 ORDER BY entity_type`);
    return result.rows;
  }

  async createAutoApprovalRule(data) {
    await query(
      `INSERT INTO auto_approval_rules (name, entity_type, max_amount, category_match,
       requires_budget_check, applicable_roles)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [data.name, data.entity_type, data.max_amount || null,
       data.category_match || null, data.requires_budget_check ? 1 : 0,
       data.applicable_roles || 'admin']
    );
    return this.getAutoApprovalRules();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Workflow Logs
  // ═══════════════════════════════════════════════════════════════════════════

  async getLogs(filters = {}) {
    const { rule_id, status, page = 1, limit = 50 } = filters;
    let conditions = [];
    let params = [];
    let pc = 1;
    if (rule_id) { conditions.push(`wl.workflow_rule_id = $${pc}`); params.push(rule_id); pc++; }
    if (status) { conditions.push(`wl.status = $${pc}`); params.push(status); pc++; }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const p = parseInt(page) || 1;
    const l = parseInt(limit) || 50;
    const offset = (p - 1) * l;

    const result = await query(
      `SELECT wl.*, wr.name as rule_name
       FROM workflow_logs wl
       JOIN workflow_rules wr ON wl.workflow_rule_id = wr.id
       ${where}
       ORDER BY wl.created_at DESC
       LIMIT $${pc} OFFSET $${pc + 1}`,
      [...params, l, offset]
    );
    return result.rows;
  }
}

module.exports = new WorkflowEngine();
