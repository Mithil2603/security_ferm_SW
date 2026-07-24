/**
 * src/middleware/validators.js
 * Joi validation schemas + middleware for Phase 4 Security Hardening.
 * Returns 422 Unprocessable Entity with field-level errors.
 */

const Joi = require('joi');

// ─── Reusable helpers ────────────────────────────────────────────────────────

const indianPhone = Joi.string()
  .pattern(/^(?:\+91[\-\s]?|91[\-\s]?)?[0-9]{10}$/)
  .messages({ 'string.pattern.base': 'Phone number must be a valid 10-digit Indian number, optionally starting with +91' });

const optionalEmail = Joi.string().email({ tlds: { allow: false } }).optional().allow('', null);

const positiveDecimal = Joi.number().positive().precision(2);

// ─── validate middleware factory ─────────────────────────────────────────────

/**
 * Returns an Express middleware that validates req.body against the given schema.
 * On failure → 422 with an array of field-level messages.
 */
function validate(schema) {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, {
      abortEarly: false,       // collect ALL errors, not just the first
      allowUnknown: true,      // ignore extra fields (don't strip them)
      stripUnknown: false,
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
      }));
      return res.status(422).json({
        success: false,
        message: 'Validation failed',
        errors: details,
      });
    }

    next();
  };
}

/**
 * Validates that a route parameter (default 'id') is a valid positive integer.
 */
function validateIdParam(paramName = 'id') {
  return (req, res, next) => {
    const val = req.params[paramName];
    if (val && !/^\d+$/.test(val)) {
      return res.status(400).json({
        success: false,
        message: `Invalid ${paramName}: must be a positive integer`
      });
    }
    next();
  };
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

// POST /api/clients
const createClientSchema = Joi.object({
  name: Joi.string().min(2).max(200).required().label('Client name'),
  address: Joi.string().min(5).max(500).required().label('Address'),
  city: Joi.string().min(2).max(100).required().label('City'),
  state: Joi.string().max(100).optional().allow('', null).label('State'),
  postal_code: Joi.string().max(20).optional().allow('', null)
    .label('Postal code'),
  email: optionalEmail.label('Email'),
  phone: indianPhone.optional().allow('', null).label('Phone'),
  contact_person: Joi.string().max(200).optional().allow('', null).label('Contact person'),
  gst_number: Joi.string()
    .max(50)
    .optional().allow('', null)
    .label('GST number'),
  monthly_rate: positiveDecimal.required().label('Monthly rate'),
  contract_start_date: Joi.date().iso().required().label('Contract start date'),
  contract_end_date: Joi.date().iso().min(Joi.ref('contract_start_date')).optional().allow('', null)
    .messages({ 'date.min': 'Contract end date must be after start date' })
    .label('Contract end date'),
  notes: Joi.string().max(2000).optional().allow('', null).label('Notes'),
});

// PUT /api/clients/:id
const updateClientSchema = Joi.object({
  name: Joi.string().min(2).max(200).optional().label('Client name'),
  address: Joi.string().min(5).max(500).optional().label('Address'),
  city: Joi.string().min(2).max(100).optional().label('City'),
  state: Joi.string().max(100).optional().allow('', null),
  postal_code: Joi.string().max(20).optional().allow('', null),
  email: optionalEmail,
  phone: indianPhone.optional().allow('', null),
  contact_person: Joi.string().max(200).optional().allow('', null),
  gst_number: Joi.string()
    .max(50)
    .optional().allow('', null),
  monthly_rate: positiveDecimal.optional(),
  contract_start_date: Joi.date().iso().optional(),
  contract_end_date: Joi.date().iso().optional().allow('', null),
  notes: Joi.string().max(2000).optional().allow('', null),
  is_active: Joi.alternatives().try(Joi.boolean(), Joi.number().valid(0, 1)).optional(),
});

// POST /api/employees
const createEmployeeSchema = Joi.object({
  full_name: Joi.string().min(2).max(200).required().label('Full name'),
  phone: indianPhone.required().label('Phone'),
  email: optionalEmail.label('Email'),
  date_of_birth: Joi.date().iso().max('now').optional().allow('', null)
    .messages({ 'date.max': 'Date of birth cannot be in the future' })
    .label('Date of birth'),
  address: Joi.string().max(500).optional().allow('', null).label('Address'),
  city: Joi.string().max(100).optional().allow('', null).label('City'),
  aadhar_number: Joi.string()
    .pattern(/^\d{12}$/)
    .optional().allow('', null)
    .messages({ 'string.pattern.base': 'Aadhar number must be exactly 12 digits' })
    .label('Aadhar number'),
  pan_number: Joi.string()
    .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
    .optional().allow('', null)
    .messages({ 'string.pattern.base': 'PAN number must be in the format ABCDE1234F (all uppercase)' })
    .label('PAN number'),
  bank_account_number: Joi.string()
    .max(50)
    .optional().allow('', null)
    .label('Bank account number'),
  bank_ifsc_code: Joi.string()
    .pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/)
    .optional().allow('', null)
    .messages({ 'string.pattern.base': 'Invalid IFSC code format (e.g., SBIN0001234)' })
    .label('IFSC code'),
  bank_name: Joi.string().max(200).optional().allow('', null).label('Bank name'),
  bank_account_holder_name: Joi.string().max(200).optional().allow('', null).label('Account holder name'),
  date_of_joining: Joi.date().iso().required().label('Date of joining'),
  designation: Joi.string().max(100).optional().allow('', null).label('Designation'),
  salary_structure_id: Joi.number().integer().positive().optional().allow(null).label('Salary structure'),
  assigned_client_id: Joi.number().integer().positive().optional().allow(null).label('Assigned client'),
  emergency_contact_name: Joi.string().max(200).optional().allow('', null).label('Emergency contact name'),
  emergency_contact_phone: indianPhone.optional().allow('', null).label('Emergency contact phone'),
  notes: Joi.string().max(2000).optional().allow('', null).label('Notes'),
});

// PUT /api/employees/:id
const updateEmployeeSchema = createEmployeeSchema.fork(
  ['full_name', 'phone', 'date_of_joining'],
  (schema) => schema.optional()
).append({
  is_active: Joi.alternatives().try(Joi.boolean(), Joi.number().valid(0, 1)).optional(),
});

// POST /api/invoices
const createInvoiceSchema = Joi.object({
  client_id: Joi.number().integer().positive().required().label('Client'),
  invoice_date: Joi.date().iso().optional().allow('', null).label('Invoice date'),
  billing_period_start: Joi.date().iso().required().label('Billing period start'),
  billing_period_end: Joi.date().iso().min(Joi.ref('billing_period_start')).required()
    .messages({ 'date.min': 'Billing period end must be on or after start date' })
    .label('Billing period end'),
  tax_type: Joi.string().valid('none', 'cgst_sgst', 'igst').optional().allow('', null).label('Tax type'),
  is_rcm_applicable: Joi.boolean().optional().label('Is RCM applicable'),
  tax_rate: Joi.number().min(0).max(100).optional().label('Tax rate (%)'),
  discount_amount: Joi.number().min(0).optional().allow(null, '').label('Discount amount'),
  notes: Joi.string().max(2000).optional().allow('', null).label('Notes'),
});

// POST /api/payroll/calculate (generate payroll)
const generatePayrollSchema = Joi.object({
  entries: Joi.array().items(
    Joi.object({
      employee_id: Joi.number().integer().positive().required(),
      days_worked: Joi.number().min(0).max(62).required()
    })
  ).required(),
  month: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required()
    .messages({ 'string.pattern.base': 'Month must be in YYYY-MM-DD format (use first day of the month)' })
    .label('Payroll month'),
});

// POST /api/invoices/:id/payment
const recordPaymentSchema = Joi.object({
  amount_paid: positiveDecimal.required().label('Amount paid'),
  tds_deducted: Joi.number().min(0).optional().allow(null, '').default(0).label('TDS Deducted'),
  payment_date: Joi.date().iso().optional().allow('', null).label('Payment date'),
  payment_method: Joi.string()
    .valid('cash', 'bank_transfer', 'cheque', 'upi', 'online', 'card')
    .required()
    .messages({ 'any.only': 'Payment method must be one of: cash, bank_transfer, cheque, upi, online, card' })
    .label('Payment method'),
  transaction_reference: Joi.string().max(200).optional().allow('', null).label('Transaction reference'),
  notes: Joi.string().max(1000).optional().allow('', null).label('Notes'),
});

// POST /api/expenses
const createExpenseSchema = Joi.object({
  expense_date: Joi.date().iso().required().label('Expense date'),
  category: Joi.string()
    .min(1).max(100)
    .required()
    .label('Category'),
  description: Joi.string().min(3).max(500).required().label('Description'),
  amount: positiveDecimal.required().label('Amount'),
  payment_method: Joi.string()
    .valid('cash', 'bank_transfer', 'cheque', 'upi', 'online', 'other')
    .required()
    .label('Payment method'),
  vendor_id: Joi.number().integer().optional().allow(null, '').label('Vendor ID'),
  receipt_number: Joi.string().max(100).optional().allow('', null).label('Receipt number'),
  invoice_reference: Joi.string().max(200).optional().allow('', null).label('Invoice reference'),
  notes: Joi.string().max(2000).optional().allow('', null).label('Notes'),
});

// POST /api/attendance
const markAttendanceSchema = Joi.object({
  employee_id: Joi.number().integer().positive().required().label('Employee ID'),
  client_id: Joi.number().integer().positive().optional().allow(null, '').label('Client ID'),
  attendance_date: Joi.date().iso().max('now').required().label('Attendance date'),
  check_in_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional().allow(null, '').label('Check-in time (HH:MM)'),
  check_out_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional().allow(null, '').label('Check-out time (HH:MM)'),
  status: Joi.string().valid('present', 'absent', 'leave', 'holiday', 'half_day').optional().default('present').label('Status'),
  notes: Joi.string().max(1000).optional().allow(null, '').label('Notes')
});

// POST /api/attendance/bulk
const bulkAttendanceSchema = Joi.object({
  records: Joi.array().items(markAttendanceSchema).min(1).required().label('Attendance records')
});

// POST /api/auth/login
const loginSchema = Joi.object({
  email: Joi.string().email({ tlds: { allow: false } }).required().label('Email'),
  password: Joi.string().min(6).max(200).required().label('Password'),
});

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  validate,
  validateIdParam,
  schemas: {
    createClient: createClientSchema,
    updateClient: updateClientSchema,
    createEmployee: createEmployeeSchema,
    updateEmployee: updateEmployeeSchema,
    createInvoice: createInvoiceSchema,
    generatePayroll: generatePayrollSchema,
    recordPayment: recordPaymentSchema,
    createExpense: createExpenseSchema,
    markAttendance: markAttendanceSchema,
    bulkAttendance: bulkAttendanceSchema,
    login: loginSchema,
  },
};
