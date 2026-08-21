(async () => {
// WARNING: Converted to MySQL
/**
 * Comprehensive Seed Script
 * - 50 Clients (housing societies & commercial buildings in Ahmedabad)
 * - 100 Employees (security guards)
 * - Attendance records (Jan 2026 – Jul 2026)
 * - Payroll records (Jan 2026 – Jun 2026)
 * - Invoices for every client every month (Jan – Jul 2026)
 * - Payments (partial & full) for older invoices
 * - Expenses across multiple categories
 * 
 * Run: node src/database/seed.js
 */

require('dotenv').config();
const { query, pool, initDB } = require('./connection');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

if (process.env.NODE_ENV === 'production') {
  console.error("❌ FATAL: Cannot run seed script in production! It will wipe all client data.");
  process.exit(1);
}

await initDB();


console.log('🌱 Starting comprehensive database seeding...\n');

// ─── Helpers ──────────────────────────────────────────────────────────
const crypto = require('crypto');

function secureRandomFloat() {
  return crypto.randomBytes(4).readUInt32LE(0) / 0x100000000;
}

function randomInt(min, max) { 
  return Math.floor(secureRandomFloat() * (max - min + 1)) + min; 
}
function randomFloat(min, max, decimals = 2) { 
  return parseFloat((secureRandomFloat() * (max - min) + min).toFixed(decimals)); 
}
function randomPick(arr) { 
  return arr[Math.floor(secureRandomFloat() * arr.length)]; 
}
function randomDate(start, end) {
  const d = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return d.toISOString().split('T')[0];
}
function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }

// ─── Data Arrays ─────────────────────────────────────────────────────
const firstNames = ['Rajesh', 'Sunil', 'Vijay', 'Anil', 'Mukesh', 'Dinesh', 'Ramesh', 'Mahesh', 'Pravin', 'Sanjay',
  'Hitesh', 'Nilesh', 'Bharat', 'Kiran', 'Ashok', 'Gopal', 'Mohan', 'Ravi', 'Deepak', 'Ajay',
  'Kishan', 'Manish', 'Nitin', 'Paresh', 'Yogesh', 'Harsh', 'Kamlesh', 'Jayesh', 'Suresh', 'Naresh',
  'Vikas', 'Rohit', 'Amit', 'Praful', 'Bhavin', 'Chirag', 'Divyesh', 'Gaurav', 'Hemant', 'Jignesh',
  'Kartik', 'Lalit', 'Mitul', 'Nandlal', 'Pankaj', 'Rakesh', 'Sandip', 'Tarun', 'Umesh', 'Vinod'];

const lastNames = ['Patel', 'Shah', 'Mehta', 'Desai', 'Joshi', 'Pandya', 'Trivedi', 'Parmar', 'Chauhan', 'Solanki',
  'Rathod', 'Thakor', 'Chaudhary', 'Yadav', 'Singh', 'Sharma', 'Kumar', 'Verma', 'Gupta', 'Thakur',
  'Makwana', 'Gohil', 'Jadeja', 'Vaghela', 'Darbar', 'Rabari', 'Bhatt', 'Dave', 'Raval', 'Barot'];

const areas = ['Bopal', 'Satellite', 'Prahlad Nagar', 'SG Highway', 'Bodakdev', 'Thaltej', 'Gota', 'South Bopal',
  'Shilaj', 'Ghuma', 'Sola', 'Science City', 'Chandkheda', 'New CG Road', 'Motera', 'Ranip',
  'Navrangpura', 'Ashram Road', 'Vastrapur', 'Ambawadi', 'Jodhpur', 'Memnagar', 'Naranpura',
  'Maninagar', 'Isanpur', 'Vatva', 'Naroda', 'Nikol', 'Vastral', 'Odhav'];

const societyPrefixes = ['Royal', 'Green', 'Sunrise', 'Shanti', 'Metro', 'Golden', 'Silver', 'Diamond', 'Pearl', 'Crystal',
  'Heritage', 'Prestige', 'Elite', 'Prime', 'Supreme', 'Grand', 'Saffron', 'Lotus', 'Maple', 'Cedar',
  'Orchid', 'Jasmine', 'Rose', 'Tulip', 'Amber', 'Ivory', 'Coral', 'Azure', 'Emerald', 'Ruby'];

const societySuffixes = ['Residency', 'Heights', 'Tower', 'Complex', 'Apartments', 'Villa', 'Park', 'Garden',
  'Avenue', 'Square', 'Enclave', 'Horizon', 'Skyline', 'Palace', 'Point'];

const cities = ['Ahmedabad'];
const states = ['Gujarat'];

const designations = ['Watchman', 'Senior Guard', 'Head Guard', 'Supervisor', 'Night Guard', 'Gate Guard'];

const expenseCategories = ['utilities', 'equipment', 'supplies', 'maintenance', 'transport', 'communication', 'salary_advance', 'miscellaneous'];
const expenseDescriptions = {
  salary_advance: ['Salary advance to guard', 'Festival advance', 'Emergency advance'],
  equipment: ['Torch batteries', 'Walkie talkie set', 'Rain coats', 'Uniform purchase', 'Shoes purchase', 'Batons'],
  maintenance: ['Patrol bike maintenance', 'Office AC repair', 'Plumbing repair', 'CCTV maintenance', 'Generator servicing'],
  communication: ['Internet bill', 'Phone bill', 'SIM card recharges'],
  supplies: ['Stationery purchase', 'Printer cartridge', 'Register books', 'ID card printing', 'Visitor pass booklets', 'Cleaning supplies'],
  miscellaneous: ['Tea & snacks for guards', 'Mobile recharge', 'Misc supplies', 'Emergency expenses'],
  utilities: ['Electricity bill - office', 'Water bill', 'Office maintenance'],
  transport: ['Guard transport allowance', 'Cab charges', 'Bus pass for guards', 'Fuel reimbursement']
};

const paymentMethods = ['cash', 'cheque', 'bank_transfer', 'upi', 'card'];

// ─── 1. CLEAR EXISTING DATA ──────────────────────────────────────────
console.log('🗑️  Clearing existing seed data...');
await query('SET FOREIGN_KEY_CHECKS = 0');
await query('TRUNCATE TABLE payments');
await query('TRUNCATE TABLE attendance');
await query('TRUNCATE TABLE payroll');
await query('TRUNCATE TABLE expenses');
await query('TRUNCATE TABLE invoices');
await query('DELETE FROM employees WHERE employee_id != "EMP-001"');
await query('TRUNCATE TABLE clients');
await query('TRUNCATE TABLE invoice_counters');
await query('TRUNCATE TABLE users');
await query('SET FOREIGN_KEY_CHECKS = 1');

console.log('👤 Creating default admin users...');
const adminPassword = await bcrypt.hash('admin123', 10);
await query(
  `INSERT INTO users (id, full_name, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, ?)`,
  [1, 'Admin', 'admin@example.com', adminPassword, 'admin', 1]
);
await query(
  `INSERT INTO users (full_name, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, 1)`,
  ['Admin User', 'admin@test.com', adminPassword, 'admin']
);

// ─── 2. ENSURE SALARY STRUCTURES EXIST ───────────────────────────────
console.log('💰 Ensuring salary structures...');
const existingStructures = (await query('SELECT COUNT(*) as c FROM salary_structures')).rows[0];
if (existingStructures.c === 0) {
  await query(`
    INSERT INTO salary_structures (name, base_salary, dearness_allowance, house_rent_allowance, pf_percentage) VALUES
    ('Basic Watchman - Grade A', 18000, 2000, 1500, 12.0),
    ('Senior Watchman - Grade B', 22000, 2500, 2000, 12.0),
    ('Head Guard - Grade C', 28000, 3000, 2500, 12.0),
    ('Supervisor - Grade D', 35000, 4000, 3000, 12.0);
  `);
}
const salaryStructures = (await query('SELECT id, base_salary, dearness_allowance, house_rent_allowance, other_allowances, pf_percentage FROM salary_structures WHERE is_active = 1')).rows;

// ─── 3. INSERT 50 CLIENTS ────────────────────────────────────────────
console.log('🏢 Creating 20 clients...');
const insertClient = `
  INSERT INTO clients (name, address, city, state, postal_code, email, phone, contact_person, gst_number, 
    contract_start_date, monthly_rate, billing_cycle, is_active, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
`;

const usedNames = new Set();
const clientIds = [];

async function insertClientsTransaction() {
  await query('START TRANSACTION');
  try {
    
  for (let i = 0; i < 20; i++) {
    let name;
    do {
      name = `${randomPick(societyPrefixes)} ${randomPick(societySuffixes)}`;
    } while (usedNames.has(name));
    usedNames.add(name);

    const area = randomPick(areas);
    const address = `${randomInt(1, 200)}, ${area}`;
    const postalCode = `38${randomInt(1000, 9999).toString().padStart(4, '0').slice(0, 4)}`;
    const contactPerson = `${randomPick(firstNames)} ${randomPick(lastNames)}`;
    const phone = `9${randomInt(700000000, 999999999)}`;
    const email = `${name.toLowerCase().replace(/\s+/g, '.')}@gmail.com`;
    const gst = Math.random() > 0.4 ? `24${randomPick(['AABCT', 'AADCS', 'AAGCM', 'AAHCP', 'AALCK'])}${randomInt(1000, 9999)}${randomPick(['A', 'B', 'C'])}1Z${randomInt(1, 9)}` : null;
    const contractStart = randomDate(new Date('2024-06-01'), new Date('2025-12-01'));
    const monthlyRate = randomInt(20, 120) * 1000; // 20k to 120k
    const billingCycle = randomPick([1, 1, 1, 2, 3]); // mostly monthly

    const info = await query(insertClient, [name, address, 'Ahmedabad', 'Gujarat', postalCode, email, phone, contactPerson, gst, contractStart, monthlyRate, billingCycle]);
    clientIds.push(info.insertId);
  }

    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
}
await insertClientsTransaction();
console.log(`   ✅ ${clientIds.length} clients created`);

// ─── 4. INSERT 100 EMPLOYEES ─────────────────────────────────────────
console.log('👷 Creating 20 employees...');
const insertEmployee = `
  INSERT INTO employees (employee_id, full_name, phone, email, date_of_birth, address, city, 
    aadhar_number, pan_number, bank_account_number, bank_ifsc_code, bank_name, bank_account_holder_name,
    date_of_joining, designation, salary_structure_id, assigned_client_id, 
    emergency_contact_name, emergency_contact_phone, is_active)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
`;

const employeeIds = [];
async function insertEmployeesTransaction() {
  await query('START TRANSACTION');
  try {
    
  for (let i = 0; i < 20; i++) {
    const empNum = (i + 1).toString().padStart(3, '0');
    const empId = `EMP-${empNum}`;
    const firstName = randomPick(firstNames);
    const lastName = randomPick(lastNames);
    const fullName = `${firstName} ${lastName}`;
    const phone = `9${randomInt(700000000, 999999999)}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randomInt(1, 99)}@gmail.com`;
    const dob = randomDate(new Date('1975-01-01'), new Date('2002-12-31'));
    const address = `${randomInt(1, 500)}, ${randomPick(areas)}, Ahmedabad`;
    const aadhar = `${randomInt(1000, 9999)}${randomInt(1000, 9999)}${randomInt(1000, 9999)}`;
    const pan = `${randomPick(['A','B','C','D','E'])}${randomPick(['A','B','C','D','E'])}${randomPick(['P','R','S','T'])}${randomPick(['P','S','K','M'])}${randomInt(1000, 9999)}${randomPick(['A','B','C','D','E','F','G','H','J','K'])}`;
    const bankAcc = `${randomInt(10000000, 99999999)}${randomInt(1000, 9999)}`;
    const ifsc = `${randomPick(['SBIN', 'HDFC', 'ICIC', 'BARB', 'PUNB', 'BKID', 'UTIB'])}0${randomInt(100000, 999999)}`;
    const bankName = randomPick(['State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Bank of Baroda', 'Punjab National Bank', 'Bank of India', 'Axis Bank', 'Kotak Mahindra Bank']);
    const joiningDate = randomDate(new Date('2023-01-01'), new Date('2026-01-01'));
    const designation = i < 5 ? 'Supervisor' : i < 15 ? 'Head Guard' : i < 35 ? 'Senior Guard' : randomPick(['Watchman', 'Night Guard', 'Gate Guard']);
    
    // Match salary structure to designation
    let ssId;
    if (designation === 'Supervisor') ssId = salaryStructures.find(s => s.base_salary >= 35000)?.id || salaryStructures[salaryStructures.length - 1].id;
    else if (designation === 'Head Guard') ssId = salaryStructures.find(s => s.base_salary >= 28000 && s.base_salary < 35000)?.id || salaryStructures[2]?.id || salaryStructures[0].id;
    else if (designation === 'Senior Guard') ssId = salaryStructures.find(s => s.base_salary >= 22000 && s.base_salary < 28000)?.id || salaryStructures[1]?.id || salaryStructures[0].id;
    else ssId = salaryStructures[0].id;

    const assignedClient = randomPick(clientIds);
    const emergName = `${randomPick(firstNames)} ${lastName}`;
    const emergPhone = `9${randomInt(700000000, 999999999)}`;

    try {
      const info = await query(insertEmployee, [empId, fullName, phone, email, dob, address, 'Ahmedabad',
        aadhar, pan, bankAcc, ifsc, bankName, fullName,
        joiningDate, designation, ssId, assignedClient, emergName, emergPhone]);
      employeeIds.push(info.insertId);
    } catch (e) {
      // skip duplicates
    }
  }

    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
}
await insertEmployeesTransaction();
console.log(`   ✅ ${employeeIds.length} employees created`);

// ─── 5. ATTENDANCE RECORDS (Jan 2026 – Jul 2026) ────────────────────
console.log('📋 Creating attendance records (Jan–Jul 2026)...');
const insertAttendance = `
  INSERT IGNORE INTO attendance (employee_id, client_id, attendance_date, check_in_time, check_out_time, hours_worked, status, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1)
`;

// Get employee details with their assigned clients
const employees = (await query('SELECT id, assigned_client_id, date_of_joining FROM employees WHERE is_active = 1')).rows;

let totalAttendance = 0;
const months = [
  { year: 2026, month: 1 }, { year: 2026, month: 2 }, { year: 2026, month: 3 },
  { year: 2026, month: 4 }, { year: 2026, month: 5 }, { year: 2026, month: 6 },
  { year: 2026, month: 7 }
];

async function insertAttendanceTransaction() {
  let batch = [];
  async function flushBatch() {
    if (batch.length === 0) return;
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values = batch.flat();
    await query(`INSERT IGNORE INTO attendance (employee_id, client_id, attendance_date, check_in_time, check_out_time, hours_worked, status) VALUES ${placeholders}`, values);
    totalAttendance += batch.length;
    batch = [];
  }

  for (const { year, month } of months) {
    const days = daysInMonth(year, month);
    const today = new Date();
    
    for (const emp of employees) {
      const joinDate = new Date(emp.date_of_joining);
      
      // Skip if employee hasn't joined yet
      if (joinDate > new Date(year, month - 1, days)) continue;
      
      for (let day = 1; day <= days; day++) {
        const dateObj = new Date(year, month - 1, day);
        // Don't create future attendance
        if (dateObj > today) continue;
        // Skip if before joining
        if (dateObj < joinDate) continue;
        
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        // Determine status (realistic distribution)
        const rand = Math.random();
        let status, checkIn, checkOut, hours;
        
        if (rand < 0.82) { // 82% present
          status = 'present';
          const shift = Math.random() > 0.5 ? { in: '08:00', out: '20:00', h: 12 } : { in: '20:00', out: '08:00', h: 12 };
          checkIn = shift.in;
          checkOut = shift.out;
          hours = shift.h;
        } else if (rand < 0.88) { // 6% absent
          status = 'absent';
          checkIn = null; checkOut = null; hours = 0;
        } else if (rand < 0.93) { // 5% leave
          status = 'leave';
          checkIn = null; checkOut = null; hours = 0;
        } else if (rand < 0.97) { // 4% half day
          status = 'half_day';
          checkIn = '08:00'; checkOut = '14:00'; hours = 6;
        } else { // 3% holiday
          status = 'holiday';
          checkIn = null; checkOut = null; hours = 0;
        }
        
        batch.push([emp.id, emp.assigned_client_id, dateStr, checkIn, checkOut, hours, status]);
        if (batch.length >= 200) {
          await flushBatch();
        }
      }
    }
    await flushBatch();
    console.log(`   📅 ${year}-${String(month).padStart(2, '0')}: attendance generated`);
  }
}
await insertAttendanceTransaction();
console.log(`   ✅ ${totalAttendance} attendance records created`);

// ─── 6. PAYROLL RECORDS (Jan – Jun 2026) ─────────────────────────────
console.log('💵 Creating payroll records (Jan–Jun 2026)...');
const insertPayroll = `
  INSERT INTO payroll (employee_id, payroll_month, days_in_month, days_worked, days_absent, days_leave,
    base_salary, da_amount, hra_amount, other_allowances, gross_salary,
    pf_deduction, esi_deduction, tax_deduction, other_deductions, total_deductions, net_salary,
    payment_status, payment_date, payment_method, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
`;

const salaryMap = {};
for (const ss of salaryStructures) {
  salaryMap[ss.id] = ss;
}

const empDetails = (await query('SELECT id, salary_structure_id, date_of_joining FROM employees WHERE is_active = 1')).rows;
let totalPayroll = 0;

const payrollMonths = [
  { year: 2026, month: 1 }, { year: 2026, month: 2 }, { year: 2026, month: 3 },
  { year: 2026, month: 4 }, { year: 2026, month: 5 }, { year: 2026, month: 6 }
];

async function insertPayrollTransaction() {
  for (const { year, month } of payrollMonths) {
    const dim = daysInMonth(year, month);
    const payrollMonth = `${year}-${String(month).padStart(2, '0')}-01`;
    
    for (const emp of empDetails) {
      const joinDate = new Date(emp.date_of_joining);
      if (joinDate > new Date(year, month - 1, dim)) continue;
      
      const ss = salaryMap[emp.salary_structure_id];
      if (!ss) continue;
      
      // Get actual attendance counts
      const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const monthEnd = `${year}-${String(month).padStart(2, '0')}-${dim}`;
      
      const attCounts = (await query(`
        SELECT 
          SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
          SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
          SUM(CASE WHEN status = 'leave' THEN 1 ELSE 0 END) as leaves,
          SUM(CASE WHEN status = 'half_day' THEN 0.5 ELSE 0 END) as half_days,
          COUNT(*) as total
        FROM attendance 
        WHERE employee_id = ? AND attendance_date >= ? AND attendance_date <= ?
      `, [emp.id, monthStart, monthEnd])).rows[0];
      
      const daysWorked = (attCounts?.present || 0) + (attCounts?.half_days || 0);
      const daysAbsent = attCounts?.absent || 0;
      const daysLeave = attCounts?.leaves || 0;
      
      if (daysWorked === 0) continue;
      
      const ratio = daysWorked / dim;
      const baseSalary = parseFloat((ss.base_salary * ratio).toFixed(2));
      const da = parseFloat(((ss.dearness_allowance || 0) * ratio).toFixed(2));
      const hra = parseFloat(((ss.house_rent_allowance || 0) * ratio).toFixed(2));
      const otherAllow = parseFloat(((ss.other_allowances || 0) * ratio).toFixed(2));
      const grossSalary = parseFloat((baseSalary + da + hra + otherAllow).toFixed(2));
      
      const pfDeduction = parseFloat((baseSalary * (ss.pf_percentage || 12) / 100).toFixed(2));
      const esiDeduction = grossSalary <= 21000 ? parseFloat((grossSalary * 0.0075).toFixed(2)) : 0;
      const taxDeduction = 0;
      const otherDeductions = 0;
      const totalDeductions = parseFloat((pfDeduction + esiDeduction + taxDeduction + otherDeductions).toFixed(2));
      const netSalary = parseFloat((grossSalary - totalDeductions).toFixed(2));
      
      // Older months are paid, recent months pending
      const isPaid = month <= 5;
      const paymentStatus = isPaid ? 'paid' : 'pending';
      const paymentDate = isPaid ? `${year}-${String(month).padStart(2, '0')}-${randomInt(1, 7).toString().padStart(2, '0')}` : null;
      const paymentMethod = isPaid ? randomPick(['bank_transfer', 'bank_transfer', 'bank_transfer', 'upi', 'cash']) : null;
      
      try {
        await query(insertPayroll, [emp.id, payrollMonth, dim, daysWorked, daysAbsent, daysLeave,
          baseSalary, da, hra, otherAllow, grossSalary,
          pfDeduction, esiDeduction, taxDeduction, otherDeductions, totalDeductions, netSalary,
          paymentStatus, paymentDate, paymentMethod]);
        totalPayroll++;
      } catch (e) { /* skip duplicates */ }
    }
    console.log(`   💵 ${year}-${String(month).padStart(2, '0')}: payroll generated`);
  }
}
await insertPayrollTransaction();
console.log(`   ✅ ${totalPayroll} payroll records created`);

// ─── 7. INVOICES (Jan – Jul 2026) ───────────────────────────────────
console.log('📄 Creating invoices (Jan–Jul 2026)...');
const insertInvoice = `
  INSERT INTO invoices (invoice_number, client_id, invoice_date, due_date, 
    billing_period_start, billing_period_end,
    amount_subtotal, tax_rate, tax_amount, total_amount, discount_amount, final_amount,
    status, payment_received, payment_due,
    tax_type, cgst_amount, sgst_amount, igst_amount, is_rcm_applicable,
    duty_days_worked, notes, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
`;

const insertPayment = `
  INSERT INTO payments (invoice_id, payment_date, amount_paid, payment_method, transaction_reference, created_by)
  VALUES (?, ?, ?, ?, ?, 1)
`;

const allClients = (await query('SELECT id, monthly_rate, name FROM clients')).rows;
let totalInvoices = 0;
let totalPayments = 0;
let invoiceSeq = 0;

const invoiceMonths = [
  { year: 2026, month: 1 }, { year: 2026, month: 2 }, { year: 2026, month: 3 },
  { year: 2026, month: 4 }, { year: 2026, month: 5 }, { year: 2026, month: 6 },
  { year: 2026, month: 7 }
];

async function insertInvoicesTransaction() {
  for (const { year, month } of invoiceMonths) {
    const dim = daysInMonth(year, month);
    const shortYear = year.toString().slice(-2);
    const padMonth = String(month).padStart(2, '0');
    const invoiceDate = `${year}-${padMonth}-01`;
    const dueDate = `${year}-${padMonth}-${Math.min(dim, 30).toString().padStart(2, '0')}`;
    const billingStart = `${year}-${padMonth}-01`;
    const billingEnd = `${year}-${padMonth}-${dim.toString().padStart(2, '0')}`;
    
    for (const client of allClients) {
      invoiceSeq++;
      const invoiceNumber = `INV-${shortYear}${padMonth}-${invoiceSeq.toString().padStart(4, '0')}`;
      
      const subtotal = client.monthly_rate;
      const taxType = Math.random() > 0.3 ? 'cgst_sgst' : 'none';
      let cgst = 0, sgst = 0, igst = 0, taxAmount = 0;
      
      if (taxType === 'cgst_sgst') {
        cgst = parseFloat((subtotal * 0.09).toFixed(2));
        sgst = parseFloat((subtotal * 0.09).toFixed(2));
        taxAmount = cgst + sgst;
      }
      
      const totalAmount = parseFloat((subtotal + taxAmount).toFixed(2));
      const discount = Math.random() > 0.9 ? randomInt(500, 2000) : 0;
      const finalAmount = parseFloat((totalAmount - discount).toFixed(2));
      
      // Status based on month
      let status, paymentReceived;
      if (month <= 3) {
        // Jan-Mar: mostly paid
        status = 'paid';
        paymentReceived = finalAmount;
      } else if (month <= 5) {
        // Apr-May: mix of paid, partially paid, overdue
        const r = Math.random();
        if (r < 0.5) { status = 'paid'; paymentReceived = finalAmount; }
        else if (r < 0.75) { status = 'partially_paid'; paymentReceived = parseFloat((finalAmount * randomFloat(0.3, 0.7)).toFixed(2)); }
        else { status = 'overdue'; paymentReceived = 0; }
      } else if (month === 6) {
        // Jun: mostly sent or overdue
        const r = Math.random();
        if (r < 0.3) { status = 'paid'; paymentReceived = finalAmount; }
        else if (r < 0.5) { status = 'partially_paid'; paymentReceived = parseFloat((finalAmount * randomFloat(0.2, 0.5)).toFixed(2)); }
        else if (r < 0.8) { status = 'sent'; paymentReceived = 0; }
        else { status = 'overdue'; paymentReceived = 0; }
      } else {
        // Jul: all draft
        status = 'draft';
        paymentReceived = 0;
      }
      
      const paymentDue = parseFloat((finalAmount - paymentReceived).toFixed(2));
      const dutyDays = dim;
      const isRcm = Math.random() > 0.7 ? 1 : 0;
      
      try {
        const info = await query(insertInvoice, [invoiceNumber, client.id, invoiceDate, dueDate,
          billingStart, billingEnd,
          subtotal, taxType === 'none' ? 0 : 18, taxAmount, totalAmount, discount, finalAmount,
          status, paymentReceived, paymentDue,
          taxType, cgst, sgst, igst, isRcm,
          dutyDays, null]);
        totalInvoices++;
        
        // Create payment records for paid/partially_paid invoices
        if (paymentReceived > 0 && info.insertId) {
          const payDate = `${year}-${padMonth}-${randomInt(5, Math.min(dim, 28)).toString().padStart(2, '0')}`;
          const method = randomPick(['bank_transfer', 'bank_transfer', 'cheque', 'upi']);
          const txnRef = method === 'bank_transfer' ? `TXN${randomInt(100000, 999999)}` : 
                         method === 'cheque' ? `CHQ${randomInt(100000, 999999)}` : 
                         `UPI${randomInt(100000, 999999)}`;
          await query(insertPayment, [info.insertId, payDate, paymentReceived, method, txnRef]);
          totalPayments++;
        }
      } catch (e) { /* skip duplicates */ }
    }
    console.log(`   📄 ${year}-${String(month).padStart(2, '0')}: ${allClients.length} invoices generated`);
  }
}
await insertInvoicesTransaction();

// Update the invoice_counters table with the last sequence
await query(`INSERT INTO invoice_counters (fiscal_year, last_number, updated_at) VALUES ('2026-27', ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE last_number = VALUES(last_number), updated_at = CURRENT_TIMESTAMP`, [invoiceSeq]);

console.log(`   ✅ ${totalInvoices} invoices created`);
console.log(`   ✅ ${totalPayments} payment records created`);

// ─── 8. EXPENSES (Jan – Jul 2026) ───────────────────────────────────
console.log('💸 Creating expense records...');
let totalExpenses = 0;
async function insertExpenses() {
  const batch = [];
  for (const { year, month } of months) {
    const dim = daysInMonth(year, month);
    const numExpenses = randomInt(15, 25);
    
    for (let i = 0; i < numExpenses; i++) {
      const day = randomInt(1, Math.min(dim, 28));
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const category = randomPick(expenseCategories);
      const description = randomPick(expenseDescriptions[category] || ['General office expense']);
      const amount = randomInt(300, 15000);
      const method = randomPick(['cash', 'bank_transfer', 'upi', 'card']);
      const vendor = randomPick(['Local Supplier', 'Amazon', 'Gujarat Uniforms', 'Petrol Pump', 'Stationery World', null]);
      const receipt = Math.random() > 0.3 ? `RCP-${randomInt(10000, 99999)}` : null;
      const status = month <= 5 ? randomPick(['approved', 'paid', 'paid']) : 
                     month === 6 ? randomPick(['approved', 'pending', 'paid']) : 'pending';
      
      batch.push([dateStr, category, description, amount, method, vendor, receipt, status, null]);
    }
  }

  if (batch.length > 0) {
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, 1)').join(', ');
    const values = batch.flat();
    await query(`INSERT INTO expenses (expense_date, category, description, amount, payment_method, vendor_name, receipt_number, status, notes, created_by) VALUES ${placeholders}`, values);
    totalExpenses += batch.length;
  }
}
await insertExpenses();
console.log(`   ✅ ${totalExpenses} expense records created`);

// ─── SUMMARY ─────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════');
console.log('   🌱 SEEDING COMPLETE!');
console.log('════════════════════════════════════════');
console.log(`   🏢 Clients:      ${clientIds.length}`);
console.log(`   👷 Employees:    ${employeeIds.length}`);
console.log(`   📋 Attendance:   ${totalAttendance}`);
console.log(`   💵 Payroll:      ${totalPayroll}`);
console.log(`   📄 Invoices:     ${totalInvoices}`);
console.log(`   💳 Payments:     ${totalPayments}`);
console.log(`   💸 Expenses:     ${totalExpenses}`);
console.log('════════════════════════════════════════\n');

// Finished
process.exit(0);

console.log('✅ Seed complete');
process.exit(0);
})();
