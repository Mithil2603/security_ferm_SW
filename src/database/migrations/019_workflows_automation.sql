-- Migration 019: Workflows and Automation
-- Phase 7 of ERP Implementation Plan
-- Adds workflow rules, notification system, auto-approval rules,
-- and reminder escalation tracking.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Workflow Rules (trigger > condition > action engine)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workflow_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  
  -- Trigger
  trigger_entity VARCHAR(30) NOT NULL CHECK (trigger_entity IN (
    'invoice', 'expense', 'payroll', 'attendance', 'employee', 'pf', 'gst'
  )),
  trigger_event VARCHAR(30) NOT NULL CHECK (trigger_event IN (
    'created', 'updated', 'status_changed', 'overdue', 'approaching_due',
    'amount_exceeded', 'monthly_cycle', 'approval_required'
  )),
  
  -- Condition (JSON: field, operator, value)
  condition_json TEXT,
  
  -- Action
  action_type VARCHAR(30) NOT NULL CHECK (action_type IN (
    'send_notification', 'auto_approve', 'escalate', 'create_reminder',
    'update_status', 'send_email', 'generate_report'
  )),
  action_config TEXT,
  
  priority INTEGER DEFAULT 5,
  is_active BOOLEAN DEFAULT 1,
  created_by INTEGER,
  
  execution_count INTEGER DEFAULT 0,
  last_executed TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Notifications
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(20) DEFAULT 'info' CHECK (type IN (
    'info', 'warning', 'error', 'success', 'reminder', 'alert'
  )),
  category VARCHAR(30) CHECK (category IN (
    'invoice', 'expense', 'payroll', 'attendance', 'budget', 'system', 'approval'
  )),
  
  entity_type VARCHAR(30),
  entity_id INTEGER,
  
  is_read BOOLEAN DEFAULT 0,
  read_at TIMESTAMP,
  
  action_url VARCHAR(200),
  
  workflow_rule_id INTEGER,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (workflow_rule_id) REFERENCES workflow_rules(id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Reminder Escalations (invoice payment follow-ups)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS reminder_escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  
  escalation_level INTEGER DEFAULT 1 CHECK (escalation_level BETWEEN 1 AND 4),
  days_overdue INTEGER NOT NULL,
  
  reminder_type VARCHAR(20) DEFAULT 'gentle' CHECK (reminder_type IN (
    'gentle', 'firm', 'urgent', 'final'
  )),
  
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sent_to VARCHAR(200),
  channel VARCHAR(10) DEFAULT 'system' CHECK (channel IN ('system', 'email', 'sms')),
  
  response_received BOOLEAN DEFAULT 0,
  response_date DATE,
  response_notes TEXT,
  
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Auto-Approval Rules
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS auto_approval_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(100) NOT NULL,
  
  entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN (
    'expense', 'invoice', 'payroll', 'pf_loan', 'gratuity_payout'
  )),
  
  -- Conditions
  max_amount DECIMAL(12,2),
  category_match VARCHAR(100),
  requires_budget_check BOOLEAN DEFAULT 0,
  
  -- Who can auto-approve
  applicable_roles TEXT DEFAULT ('admin'),
  
  is_active BOOLEAN DEFAULT 1,
  approval_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Workflow Execution Log
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workflow_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_rule_id INTEGER NOT NULL,
  
  trigger_data TEXT,
  condition_result BOOLEAN,
  action_result TEXT,
  
  status VARCHAR(10) DEFAULT 'success' CHECK (status IN ('success', 'failed', 'skipped')),
  error_message TEXT,
  execution_time_ms INTEGER,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (workflow_rule_id) REFERENCES workflow_rules(id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Indexes
-- ═══════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notif_entity ON notifications(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_reminder_invoice ON reminder_escalations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_workflow_trigger ON workflow_rules(trigger_entity, trigger_event);
CREATE INDEX IF NOT EXISTS idx_workflow_log ON workflow_logs(workflow_rule_id, created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Seed Default Workflow Rules
-- ═══════════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO workflow_rules (name, trigger_entity, trigger_event, condition_json, action_type, action_config, priority) VALUES
  ('Invoice Overdue 15 Days', 'invoice', 'overdue',
   '{"field":"days_overdue","operator":">=","value":15}',
   'create_reminder', '{"reminder_type":"gentle","message":"Payment reminder: Invoice is 15 days overdue"}', 1),
  ('Invoice Overdue 30 Days', 'invoice', 'overdue',
   '{"field":"days_overdue","operator":">=","value":30}',
   'create_reminder', '{"reminder_type":"firm","message":"Payment overdue: Invoice is 30 days past due. Please arrange payment immediately."}', 2),
  ('Invoice Overdue 45 Days', 'invoice', 'overdue',
   '{"field":"days_overdue","operator":">=","value":45}',
   'escalate', '{"reminder_type":"urgent","message":"URGENT: Invoice is 45+ days overdue. Escalating to management."}', 3),
  ('Auto-Approve Small Expenses', 'expense', 'approval_required',
   '{"field":"amount","operator":"<","value":5000}',
   'auto_approve', '{"status":"approved","note":"Auto-approved: amount below ₹5,000 threshold"}', 5),
  ('Budget Overspend Alert', 'expense', 'amount_exceeded',
   '{"field":"category_budget_utilization","operator":">","value":90}',
   'send_notification', '{"type":"warning","title":"Budget Alert","message":"Category spending has exceeded 90% of budget"}', 4);

-- Seed Default Auto-Approval Rules
INSERT OR IGNORE INTO auto_approval_rules (name, entity_type, max_amount, is_active) VALUES
  ('Small Expenses Auto-Approve', 'expense', 5000, 1),
  ('Standard Payroll Auto-Approve', 'payroll', NULL, 1),
  ('Recurring Invoice Auto-Approve', 'invoice', NULL, 1);
