-- Migration 029: Employee attachments categorization & employee profile photo
ALTER TABLE employee_documents ADD COLUMN document_type VARCHAR(50) NOT NULL DEFAULT 'other';
ALTER TABLE employee_documents ADD COLUMN file_size INT NULL;
ALTER TABLE employee_documents ADD COLUMN mime_type VARCHAR(100) NULL;
ALTER TABLE employees ADD COLUMN photo_url VARCHAR(255) NULL;
CREATE INDEX idx_emp_docs_type ON employee_documents(employee_id, document_type);
