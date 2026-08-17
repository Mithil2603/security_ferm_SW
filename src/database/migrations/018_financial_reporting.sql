-- Migration 018: Advanced Financial Reporting
-- Phase 6 of ERP Implementation Plan
-- Adds budgets table, budget line items, and financial snapshots
-- for variance analysis and cash flow statement generation.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Budgets
-- ═══════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS budgets;
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(100) NOT NULL,
  financial_year VARCHAR(9) NOT NULL,
  budget_type VARCHAR(20) DEFAULT 'annual' CHECK (
    budget_type IN ('annual', 'quarterly', 'monthly')
  ),
  total_revenue_budget DECIMAL(14,2) DEFAULT 0,
  total_expense_budget DECIMAL(14,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'active', 'closed')),
  approved_by INTEGER,
  approved_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Budget Line Items
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS budget_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_id INTEGER NOT NULL,
  category VARCHAR(50) NOT NULL,
  sub_category VARCHAR(100),
  item_type VARCHAR(10) NOT NULL CHECK (item_type IN ('revenue', 'expense')),
  
  -- Monthly breakdown (April to March)
  apr DECIMAL(12,2) DEFAULT 0,
  may DECIMAL(12,2) DEFAULT 0,
  jun DECIMAL(12,2) DEFAULT 0,
  jul DECIMAL(12,2) DEFAULT 0,
  aug DECIMAL(12,2) DEFAULT 0,
  sep DECIMAL(12,2) DEFAULT 0,
  oct DECIMAL(12,2) DEFAULT 0,
  nov DECIMAL(12,2) DEFAULT 0,
  dec_val DECIMAL(12,2) DEFAULT 0,
  jan DECIMAL(12,2) DEFAULT 0,
  feb DECIMAL(12,2) DEFAULT 0,
  mar DECIMAL(12,2) DEFAULT 0,
  
  annual_total DECIMAL(14,2) DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Financial Snapshots (monthly KPIs)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS financial_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_month VARCHAR(7) NOT NULL,
  financial_year VARCHAR(9) NOT NULL,
  
  -- Revenue
  total_revenue DECIMAL(14,2) DEFAULT 0,
  invoiced_amount DECIMAL(14,2) DEFAULT 0,
  collected_amount DECIMAL(14,2) DEFAULT 0,
  
  -- Expenses
  total_expenses DECIMAL(14,2) DEFAULT 0,
  payroll_expense DECIMAL(14,2) DEFAULT 0,
  operational_expense DECIMAL(14,2) DEFAULT 0,
  
  -- Profitability
  gross_profit DECIMAL(14,2) DEFAULT 0,
  net_profit DECIMAL(14,2) DEFAULT 0,
  gross_margin DECIMAL(6,2) DEFAULT 0,
  net_margin DECIMAL(6,2) DEFAULT 0,
  
  -- Liquidity
  accounts_receivable DECIMAL(14,2) DEFAULT 0,
  accounts_payable DECIMAL(14,2) DEFAULT 0,
  cash_balance DECIMAL(14,2) DEFAULT 0,
  
  -- KPIs
  dso DECIMAL(6,1) DEFAULT 0,
  current_ratio DECIMAL(6,2) DEFAULT 0,
  employee_count INTEGER DEFAULT 0,
  revenue_per_employee DECIMAL(12,2) DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(snapshot_month)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Report Schedules (auto-generate reports)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS report_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_type VARCHAR(30) NOT NULL CHECK (report_type IN (
    'cash_flow', 'variance', 'kpi_dashboard', 'pl_summary', 'balance_sheet'
  )),
  frequency VARCHAR(10) DEFAULT 'monthly' CHECK (frequency IN ('weekly', 'monthly', 'quarterly')),
  is_active BOOLEAN DEFAULT 1,
  last_run TIMESTAMP,
  next_run TIMESTAMP,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Indexes
-- ═══════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_budget_fy ON budgets(financial_year);
CREATE INDEX IF NOT EXISTS idx_budget_items_budget ON budget_items(budget_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_month ON financial_snapshots(snapshot_month);
