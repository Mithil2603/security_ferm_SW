-- Migration 033: Upgrade Vendor Management & Add Vendor Documents
-- Aligns with Vendor Management Software Blueprint

-- 1. Add new columns to vendors
ALTER TABLE vendors
  ADD COLUMN vendor_code VARCHAR(50) NULL AFTER id,
  ADD COLUMN legal_name VARCHAR(255) NULL AFTER vendor_code,
  ADD COLUMN display_name VARCHAR(255) NULL AFTER legal_name,
  ADD COLUMN tax_id VARCHAR(100) NULL AFTER display_name,
  ADD COLUMN currency VARCHAR(3) DEFAULT 'INR' AFTER tax_id,
  ADD COLUMN bank_name VARCHAR(150) NULL,
  ADD COLUMN bank_account_no VARCHAR(100) NULL,
  ADD COLUMN bank_routing_code VARCHAR(50) NULL,
  ADD COLUMN default_account_id INT NULL;

-- 2. Populate fallback data for existing vendors
UPDATE vendors 
SET 
  legal_name = COALESCE(legal_name, name),
  display_name = COALESCE(display_name, name),
  vendor_code = COALESCE(vendor_code, CONCAT('VND-', LPAD(id, 3, '0')))
WHERE legal_name IS NULL OR vendor_code IS NULL;

-- 3. Indexes for fast lookup
CREATE UNIQUE INDEX uq_vendors_code ON vendors(vendor_code);
CREATE INDEX idx_vendors_tax_id ON vendors(tax_id);

-- 4. Create vendor_documents table for compliance & audit tracking
CREATE TABLE IF NOT EXISTS vendor_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vendor_id INT NOT NULL,
  document_type VARCHAR(100) NOT NULL,
  file_url TEXT NOT NULL,
  file_name VARCHAR(255) NULL,
  file_size INT NULL,
  mime_type VARCHAR(100) NULL,
  expiry_date DATE NULL,
  status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
  rejection_reason TEXT NULL,
  verified_by INT NULL,
  verified_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_vendor_docs_vendor ON vendor_documents(vendor_id);
CREATE INDEX idx_vendor_docs_status ON vendor_documents(status);
CREATE INDEX idx_vendor_docs_expiry ON vendor_documents(expiry_date);
