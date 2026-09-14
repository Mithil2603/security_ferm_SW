# Security Firm Management Software
## Comprehensive Product Presentation — Version 1.2.2

> **Prepared for:** Eagle Eye Security Service  
> **Prepared by:** Development Team  
> **Date:** July 2026  
> **Platform:** Windows Desktop Application (.exe)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Login & Authentication](#1-login--authentication)
3. [Dashboard — Command Center](#2-dashboard--command-center)
4. [Employee Management](#3-employee-management)
5. [Client Management](#4-client-management)
6. [Attendance Tracking](#5-attendance-tracking)
7. [Invoice Management](#6-invoice-management)
8. [Payroll Processing](#7-payroll-processing)
9. [Expense Tracking](#8-expense-tracking)
10. [Employee Ledger](#9-employee-ledger)
11. [Analytics & Reports](#10-analytics--reports)
12. [Profit & Loss Account](#11-profit--loss-account)
13. [Vendor Statements](#12-vendor-statements)
14. [Tax Reports & Compliance](#13-tax-reports--compliance)
15. [Statement Archive](#14-statement-archive)
16. [⭐ Balance Sheet — NEW](#15-balance-sheet--new-in-v122)
17. [⭐ Voucher System — NEW](#16-voucher-system--new-in-v122)
18. [⭐ Bank Reconciliation — NEW](#17-bank-reconciliation--new-in-v122)
19. [Settings & Administration](#18-settings--administration)
20. [Developer Console](#19-developer-console--error-monitoring)
21. [Security Architecture](#security-architecture)
22. [PDF Generation & Branding](#pdf-generation--dynamic-branding)
23. [Team Access Control](#team-access-control)

---

## What's New in Version 1.2.2

> [!IMPORTANT]
> Version 1.2.2 introduces **three major financial modules** that transform SecurManage from a billing & attendance tool into a **complete Enterprise Resource Planning (ERP) system** with full double-entry accounting capabilities.

| New Feature | What It Enables |
|-------------|----------------|
| **⭐ Balance Sheet** | Real-time Statement of Assets & Liabilities — instant financial health snapshot |
| **⭐ Voucher System (8 Types)** | Professional double-entry accounting with Cash, Bank, Journal, Contra, Debit & Credit Notes |
| **⭐ Bank Reconciliation** | Match software records against bank statements to verify every rupee |

### Why These Features Matter
- **Eliminate External Accounting Software** — No more paying for separate accounting software
- **Loan-Ready Reports** — Generate a Balance Sheet instantly when a bank asks for one
- **CA-Compliant** — Your Chartered Accountant can audit directly from the software
- **Fraud Protection** — Bank Reconciliation catches data-entry mistakes and internal fraud
- **Complete Audit Trail** — Every voucher records who created it, who approved it, and when

---

## Executive Summary

The **Security Firm Management Software** is a complete, end-to-end enterprise platform purpose-built for security agencies in India. It replaces fragmented Excel sheets, WhatsApp coordination, and manual ledger books with a single, beautiful, offline-capable desktop application.

### Key Highlights
| Feature | Benefit |
|---------|---------|
| **100% Offline** | Works without internet — all data stored locally on your PC |
| **Single .exe Installer** | No complex setup — one click to install |
| **GST-Compliant Invoicing** | Professional invoices with CGST/SGST breakdown |
| **Automated Payroll** | One-click salary generation for all guards |
| **Real-Time P&L** | Know your profit margin at any moment |
| **⭐ Balance Sheet** | Instant financial health snapshot with assets & liabilities |
| **⭐ Double-Entry Accounting** | 8 voucher types for complete, professional bookkeeping |
| **⭐ Bank Reconciliation** | Match your books against bank statements |
| **Role-Based Access** | Admin, Manager, and Staff roles with granular permissions |
| **PDF Exports** | Branded invoices, payslips, and reports with your agency logo |
| **Auto-Update** | Software updates itself silently in the background |

---

## 1. Login & Authentication

![Login Page — Secure entry point with company branding](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/login_page_1783440593117.png)

### What You See Above
The login screen is the first thing your team sees. It features a **clean, professional design** with your company identity.

### Features at a Glance
- **🔐 Secure JWT Authentication** — Every session is protected with industry-standard JSON Web Tokens that expire after 24 hours
- **🔑 Password Recovery** — "Forgot Password?" flow sends a reset link via email (SMTP-configured)
- **🛡️ Brute-Force Protection** — Rate-limited to 500 requests per 15-minute window to prevent unauthorized access attempts
- **👤 Role-Based Login** — The system automatically redirects Admins, Managers, and Staff to their appropriate dashboards
- **🔒 Bcrypt Hashing** — Passwords are never stored in plain text; they are hashed with 12 rounds of bcrypt

### How It Works
1. **Employee opens the app** → Sees this login screen
2. **Enters email and password** → System validates credentials
3. **On success** → Redirected to Dashboard with role-appropriate features visible
4. **On failure** → Clear error message shown, no account lockout (configurable)

---

## 2. Dashboard — Command Center

![Dashboard — Real-time business overview with KPIs and alerts](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/dashboard_page_1783440740517.png)

### What You See Above
The Dashboard is the **nerve center** of your operation. At a single glance, you can assess the health of your entire security business.

### Feature Breakdown

#### 📊 KPI Cards (Top Row)
| Card | What It Shows | Example |
|------|--------------|---------|
| **Total Guards** | Active employees currently on your roster | "42 guards active" |
| **Active Clients** | Number of client contracts currently running | "18 clients" |
| **Monthly Revenue** | Total invoiced amount for the current month | "₹12,45,000" |
| **Pending Payroll** | Outstanding salary payments not yet processed | "₹3,20,000" |

#### 📈 Revenue vs Payroll Chart
- **Visual comparison** of money coming in (revenue) vs money going out (payroll)
- **Trend over 60 days** so you can spot seasonal patterns
- Helps answer: *"Are we profitable this month?"*

#### 🔔 Smart Alerts Panel
The dashboard proactively warns you about:
- **Overdue invoices** — Clients who haven't paid past the due date
- **Expiring contracts** — Client contracts ending in the next 60 days
- **Pending payroll** — Guards whose salaries haven't been processed yet

---

## 3. Employee Management

![Employees — Complete guard roster with personal and banking details](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/employees_page_1783440775586.png)

### What You See Above
A comprehensive guard management system with **every detail** of your workforce at your fingertips.

### Features in Detail

#### 👥 Guard Roster Table
Every row in this table represents one security guard. The columns show:
| Column | Data | Purpose |
|--------|------|---------|
| **Name** | Full name of the guard | Quick identification |
| **Phone** | Mobile number | One-tap contact |
| **Aadhaar** | Masked Aadhaar number (last 4 digits shown) | Compliance & verification |
| **Bank Account** | Account number for salary deposits | Payroll processing |
| **Salary Structure** | Assigned pay scale (e.g., "Basic Guard ₹10,000") | Automatic salary calculation |
| **Status** | Active / Inactive toggle | Workforce management |

#### ➕ Add New Guard
Click the **"+ New Guard"** button to open a form with fields for:
- Personal details (Name, Phone, Email, Date of Birth)
- Identity documents (Aadhaar, PAN, Address)
- Banking details (Bank Name, Account Number, IFSC)
- Salary structure assignment (dropdown of pre-configured pay scales)
- Document uploads (photo, ID proofs)

#### 📄 Document Management
- Upload **Aadhaar card**, **PAN card**, **police verification**, and **photos**
- Documents stored securely in an external folder (survives software updates)
- Download anytime for audits or compliance

#### 🔍 Search & Filter
- **Real-time search** across name, phone, or Aadhaar
- **Filter by status** (Active / Inactive)
- **Sort by** any column (name, date joined, salary)

---

## 4. Client Management

![Clients — Client portfolio with contract and deployment tracking](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/clients_page_1783440809734.png)

### What You See Above
Your complete client portfolio — every contract, every site, every payment tracked in one place.

### Features in Detail

#### 🏢 Client Cards / Table View
Each client entry shows:
| Field | Description | Example |
|-------|------------|---------|
| **Company Name** | Client's registered business name | "Shivalik Business Hub" |
| **Contact Person** | Primary point of contact | "Mr. Rajesh Patel" |
| **Phone / Email** | Communication details | "9876543210" |
| **Monthly Rate** | Contracted billing amount per month | "₹1,25,000" |
| **Contract Start/End** | Duration of the security contract | "01-Apr-2026 to 31-Mar-2027" |
| **Guards Assigned** | Number of guards deployed at this site | "8 guards" |
| **Status** | Active / Inactive | Active ✅ |

#### 📝 Contract Management
- **Contract expiry warnings** appear on the Dashboard when a contract is ending within 60 days
- **Monthly rate** is automatically used when generating invoices
- Track **multiple sites** under one client

#### 🔄 Guard Assignment
- Assign specific guards to specific clients
- The system tracks which guard is deployed where
- Helps with attendance marking by client site

---

## 5. Attendance Tracking

![Attendance — Calendar-based daily tracking with bulk marking](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/attendance_page_1783440839333.png)

### What You See Above
A **calendar-based** attendance system that tracks every guard's presence across every client site, every single day.

### Features in Detail

#### 📅 Calendar View
- **Month-at-a-glance** showing all days with attendance status
- Color-coded: **Green** = Present, **Red** = Absent, **Yellow** = Half-Day
- Click any date to mark or edit attendance

#### ✅ Bulk Attendance Marking
- Select multiple guards and mark them all as "Present" in one click
- Perfect for sites where 5-10 guards arrive together
- Saves 30+ minutes of manual entry daily

#### 📊 Attendance Summary
| Metric | Description |
|--------|------------|
| **Total Days** | Working days in the selected month |
| **Present Days** | Days the guard was on duty |
| **Absent Days** | Days missed |
| **Half Days** | Partial attendance |
| **Overtime Hours** | Extra hours worked beyond shift |

#### 📥 CSV Import
- Upload attendance from **Excel/CSV files** in bulk
- Format: Guard Name, Date, Status (P/A/HD)
- Ideal for importing data from biometric systems

#### 🔗 Payroll Integration
- Attendance data **automatically feeds** into payroll calculations
- Per-day salary = Monthly salary ÷ Total working days
- Absent days are **automatically deducted** from the payslip

---

## 6. Invoice Management

![Invoices — GST-compliant invoicing with payment tracking](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/invoices_page_1783440870602.png)

### What You See Above
A professional, GST-compliant invoicing system that generates **court-ready** tax invoices at the click of a button.

### Features in Detail

#### 📋 Invoice Table
Each invoice row shows:
| Column | Data | Example |
|--------|------|---------|
| **Invoice #** | Auto-generated sequential number | "INV-2026-0042" |
| **Client** | The billed client | "Shivalik Business Hub" |
| **Period** | Service period covered | "Jun 2026" |
| **Amount** | Total billed amount (incl. tax) | "₹1,47,500" |
| **Tax** | CGST + SGST breakdown | "₹11,250 + ₹11,250" |
| **Payment Status** | Paid / Partial / Unpaid | "Partial ₹1,00,000" |
| **Due Date** | Payment deadline | "15-Jul-2026" |

#### 🧾 GST-Compliant Invoice Generation
When you click **"Generate Invoice"**, the system:
1. Pulls the client's **monthly rate** from their contract
2. Calculates **CGST (9%)** and **SGST (9%)** automatically
3. Converts the total amount to **words in English** (e.g., "One Lakh Forty-Seven Thousand Five Hundred Only")
4. Embeds your **agency logo**, address, GST number, and PAN
5. Generates a **professional PDF** ready for printing or emailing

#### 💰 Payment Tracking
- Record **partial payments** against any invoice
- Track **payment due** vs **payment received**
- Overdue invoices appear as **alerts on the Dashboard**

#### 📤 PDF Export with Dynamic Branding
- Your **agency logo** appears on every invoice
- Company name, address, GST, PAN — all pulled from Settings
- HSN Code (998525 for security services) auto-populated
- Jurisdiction city for legal terms

---

## 7. Payroll Processing

![Payroll — Automated salary generation with attendance integration](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/payroll_page_1783440910397.png)

### What You See Above
**One-click payroll generation** for your entire workforce — automatically calculates salary based on attendance, deductions, and allowances.

### Features in Detail

#### 💵 Salary Calculation Engine
The system uses this formula:
```
Gross Salary = (Base Salary ÷ Total Working Days) × Present Days
                + Overtime Allowance
                + Other Allowances (HRA, DA, etc.)

Deductions   = PF + ESI + TDS + Advances + Other Deductions

Net Salary   = Gross Salary − Deductions
```

#### 📊 Payroll Table Columns
| Column | What It Shows |
|--------|--------------|
| **Employee Name** | Guard's full name |
| **Month** | Payroll period (e.g., "June 2026") |
| **Present Days** | Days worked (from attendance module) |
| **Gross Salary** | Total earnings before deductions |
| **PF** | Provident Fund contribution |
| **ESI** | Employee State Insurance |
| **TDS** | Tax Deducted at Source |
| **Advance** | Any salary advance taken |
| **Net Salary** | Final take-home pay |
| **Status** | Pending / Paid |

#### 🖨️ Payslip PDF Generation
- Click on any employee's row → **Download Payslip**
- Professional payslip with **agency logo**, earnings breakdown, and deductions
- Can be **emailed directly** to guards

#### ⚡ Bulk Payroll Generation
- Click **"Generate Payroll"** → Select month
- System automatically processes **all active guards** at once
- Cross-references attendance data for accuracy

---

## 8. Expense Tracking

![Expenses — Category-wise expense tracking with receipt uploads](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/expenses_page_1783440942527.png)

### What You See Above
Track every rupee your agency spends — from office rent to uniform purchases to vehicle maintenance.

### Features in Detail

#### 📂 Expense Categories
Pre-configured categories include:
| Category | Example Expenses |
|----------|-----------------|
| **Salaries & Wages** | Guard salaries, supervisor wages |
| **Office Rent** | Monthly office space rental |
| **Utilities** | Electricity, water, internet |
| **Transport** | Fuel, vehicle maintenance |
| **Uniforms & Equipment** | Shoes, belts, radios, flashlights |
| **Training** | Guard training programs |
| **Insurance** | Business liability, guard insurance |
| **Miscellaneous** | Stationery, refreshments |

#### 📎 Receipt Uploads
- Attach scanned receipts or photos of bills
- Stored securely alongside the expense record
- Download receipts anytime for tax audits

#### 📊 Expense Analytics
- **Monthly total** spending at a glance
- **Category-wise breakdown** to identify where money goes
- **Date range filtering** for specific period analysis

#### 🔄 Recurring Expenses
- Set up **recurring monthly expenses** (like office rent)
- System auto-creates expense entries each month
- Never forget a regular payment

---

## 9. Employee Ledger

![Ledger — Complete financial history per employee with running balance](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/ledger_page_1783440986970.png)

### What You See Above
A **complete financial history** for each employee — every credit, debit, advance, and settlement in chronological order.

### Features in Detail

#### 📒 Per-Employee Financial Record
| Transaction Type | Debit/Credit | Example |
|-----------------|-------------|---------|
| **Salary Payment** | Credit | "+₹10,000 (June salary)" |
| **Advance Given** | Debit | "−₹2,000 (personal advance)" |
| **Advance Recovery** | Credit | "+₹500 (recovered from salary)" |
| **Bonus** | Credit | "+₹1,000 (Diwali bonus)" |
| **Deduction** | Debit | "−₹300 (uniform damage)" |

#### 📊 Running Balance
- See each guard's **net balance** at any point in time
- Know instantly if a guard owes the company money or vice versa
- Perfect for managing **salary advances** and **recoveries**

#### 🔍 Detailed Transaction History
- Every entry timestamped and linked to source (payroll, manual entry, advance)
- Full **audit trail** — who created the entry and when
- Export to Excel for external accounting

---

## 10. Analytics & Reports

![Reports — Interactive charts with drill-down analytics](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/reports_page_1783441012346.png)

### What You See Above
A powerful analytics dashboard with **interactive charts** and drill-down capabilities for deep business insights.

### Features in Detail

#### 📈 Revenue Analytics
- **Monthly revenue trend** — Line chart showing revenue over time
- **Client-wise revenue distribution** — Pie chart showing which clients contribute most
- **Revenue vs Target** — Track against business goals

#### 💰 Collection Efficiency
| Metric | What It Tells You |
|--------|------------------|
| **Billed Amount** | Total invoiced to clients |
| **Collected Amount** | Actual money received |
| **Collection %** | Efficiency of payment recovery |
| **Outstanding** | Money still owed by clients |

#### 👥 Workforce Analytics
- **Guard deployment ratio** — Guards per client
- **Attendance trends** — Monthly attendance percentages
- **Attrition tracking** — Guard turnover rate

#### 📊 Interactive Charts
- **Click on any chart element** to drill down into details
- **Expandable charts** — Click to see full-screen version
- **Date range selectors** — Analyze any time period

#### 📥 Export Options
- **Excel export** for all reports
- **PDF export** for professional sharing
- **Print-ready** formatting

---

## 11. Profit & Loss Account

![P&L Account — Real-time profit and loss with revenue and expense breakdown](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/pl_account_page_final_1783441169362.png)

### What You See Above
A **real-time Profit & Loss statement** that automatically compiles all your revenue and expenses into a clear financial picture.

### Features in Detail

#### 📊 Revenue Section
| Source | Description |
|--------|------------|
| **Client Invoices** | Total billed amount from all clients |
| **Payment Received** | Actual cash collected |
| **Outstanding** | Amounts still pending |

#### 💸 Expense Section
| Category | Auto-Calculated From |
|----------|---------------------|
| **Guard Salaries** | Payroll module |
| **Office Expenses** | Expense tracker |
| **Transport** | Expense tracker |
| **Utilities** | Expense tracker |
| **Other Expenses** | All remaining categories |

#### 📈 Bottom Line
```
Net Profit = Total Revenue − Total Expenses
Margin %   = (Net Profit ÷ Total Revenue) × 100
```

- Shows **monthly** and **yearly** P&L
- **Filter by date range** for any period
- Real-time updates as invoices and expenses are entered

> [!TIP]
> **Example:** If you billed ₹15,00,000 in June and your total expenses (salaries + operations) were ₹11,00,000, the P&L shows: **Net Profit = ₹4,00,000 (26.7% margin)**

---

## 12. Vendor Statements

![Vendor Statements — Vendor payment tracking and management](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/vendor_statements_page_1783441679566.png)

### What You See Above
Manage your agency's **vendor relationships** — track payments to uniform suppliers, equipment vendors, and service providers.

### Features in Detail

#### 🏪 Vendor Registry
- Add vendors with full details (Name, Contact, GST, Bank Details)
- Track **credit terms** and **payment cycles**
- Categorize vendors (Uniforms, Equipment, Services, etc.)

#### 💳 Payment Tracking
| Field | Description |
|-------|------------|
| **Vendor Name** | Supplier company name |
| **Invoice Number** | Vendor's bill number |
| **Amount** | Bill amount |
| **Payment Date** | When payment was made |
| **Status** | Paid / Pending / Overdue |

#### 📊 Vendor Analytics
- **Total spending per vendor** over time
- **Outstanding payments** summary
- Feeds into the **P&L Account** automatically

---

## 13. Tax Reports & Compliance

![Tax Reports — GST-ready tax summaries for quarterly filing](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/tax_reports_page_1783441599074.png)

### What You See Above
**GST-ready** tax reports that simplify your quarterly filing. All tax data is automatically compiled from your invoices.

### Features in Detail

#### 📑 GST Summary Report
| Report | What It Shows |
|--------|--------------|
| **GSTR-1 Data** | Outward supply details (all invoices issued) |
| **CGST Collected** | Central GST amount collected from clients |
| **SGST Collected** | State GST amount collected from clients |
| **Total Tax Liability** | Combined tax obligation for the period |

#### 🗓️ Period Selection
- **Monthly** — For regular tracking
- **Quarterly** — For GST filing (Q1, Q2, Q3, Q4)
- **Yearly** — For annual returns

#### 📊 TDS Tracking
- Track **TDS deducted** from guard salaries
- **Form 16** data preparation
- PAN-wise TDS summary

---

## 14. Statement Archive

![Statement Archive — Permanent record of all financial statements](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/statement_archive_page_1783441617739.png)

### What You See Above
A **permanent, immutable archive** of every financial statement ever generated — invoices, payslips, vendor statements, and reports.

### Features in Detail

#### 📦 What Gets Archived
| Statement Type | When It's Saved |
|---------------|----------------|
| **Invoices** | When a new invoice is generated |
| **Payslips** | When payroll is processed |
| **Vendor Statements** | When vendor payments are recorded |
| **P&L Reports** | On-demand snapshot saving |

#### 🔍 Search & Retrieve
- Search by **statement number**, **date range**, or **type**
- **Instant download** of any historical statement
- **View inline** without downloading

#### 🔒 Immutability
- Once archived, statements **cannot be modified**
- Provides **audit trail** for tax authorities
- Legal protection against disputes

---

## 15. Balance Sheet — ⭐ NEW in v1.2.2

![Balance Sheet — Real-time Statement of Assets & Liabilities](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/balance_sheet_page_reloaded_1783621776214.png)

### What You See Above
A **real-time Balance Sheet** — the most important financial document any business can produce. It shows a complete snapshot of your agency's financial position at any given moment.

> [!IMPORTANT]
> The Balance Sheet is the document that **banks require** when you apply for a business loan. It is also the **primary document** your Chartered Accountant needs for annual tax filing. With SecurManage, you can generate it in **one click** instead of paying your CA to compile it manually.

### Features in Detail

#### 📊 Statement of Assets & Liabilities
The Balance Sheet is divided into two halves that must always be equal:

| LEFT SIDE — Liabilities | RIGHT SIDE — Assets |
|------------------------|---------------------|
| **Capital & Reserves** — Owner's equity and retained profits | **Fixed Assets** — Equipment, vehicles, computers |
| **Current Liabilities** — Money owed to vendors, pending salaries | **Current Assets** — Cash in bank, money owed by clients |
| **Accounts Payable** — Outstanding vendor payments | **Accounts Receivable** — Unpaid client invoices |
| | **Bank Balances** — Real-time balances across all bank accounts |

#### 🔢 How the Numbers are Calculated
Everything is **automatically compiled** from the modules you already use:

| Data Source | Feeds Into |
|------------|-----------|
| **Invoices** → Unpaid amounts | Accounts Receivable (Asset) |
| **Vendor Payments** → Outstanding bills | Accounts Payable (Liability) |
| **Payroll** → Pending salaries | Current Liabilities |
| **Bank Accounts** → Account balances | Cash & Bank Balances (Asset) |
| **Vouchers** → All financial transactions | Capital, Reserves, and Adjustments |
| **P&L Statement** → Net Profit/Loss | Retained Earnings (Capital) |

#### 📅 Date Selection
- Generate a Balance Sheet **as of any date**
- Compare **current year vs previous year**
- Track how your financial position has **evolved over time**

#### 📥 Export
- **PDF export** with agency branding for bank submissions
- **Excel export** for CA and auditor access
- Print-ready formatting

> [!TIP]
> **Real-World Example:** Your agency has ₹2,00,000 in the HDFC account, ₹1,50,000 in SBI, ₹3,00,000 owed by clients (receivables), and ₹80,000 pending to vendors (payables). The Balance Sheet compiles all of this into a single, professional document that proves your agency's net worth is ₹5,70,000.

---

## 16. Voucher System — ⭐ NEW in v1.2.2

![Vouchers — Complete double-entry accounting with 8 voucher types](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/vouchers_page_1783621462915.png)

### What You See Above
A **professional, double-entry accounting system** with 8 specialized voucher types — the backbone of accurate financial recording in any business.

> [!IMPORTANT]
> The Voucher System is the **engine** that makes the Balance Sheet accurate. Without it, transactions like cash deposits, salary advances, or owner investments cannot be properly recorded. Every voucher follows the fundamental accounting equation: **Assets = Liabilities + Capital**.

### Features in Detail

#### 📋 The 8 Voucher Types Explained
Every financial transaction in your agency falls into one of these categories:

| Voucher Type | When To Use It | Real-World Example |
|-------------|---------------|-------------------|
| **💵 Cash Payment** | When you pay someone in cash | Paying ₹1,500 to a stationery shop for office supplies |
| **💵 Cash Receipt** | When you receive cash from someone | A client pays ₹45,000 security charges in cash |
| **🏦 Bank Payment** | When you make a payment via bank transfer/cheque | Transferring ₹12,500 to a uniform vendor via NEFT |
| **🏦 Bank Receipt** | When money is deposited into your bank account | Client transfers ₹55,000 invoice payment to your HDFC account |
| **📒 Journal Entry** | For non-cash adjustments and corrections | Recording ₹2,000 depreciation on office computers |
| **🔄 Contra** | When money moves between your own accounts | Depositing ₹10,000 cash into your bank account |
| **📝 Debit Note** | When you need to increase a client's bill | Client owes ₹5,000 extra for additional guard days |
| **📝 Credit Note** | When you need to reduce a client's bill | Giving ₹3,000 discount for service interruption |

#### 🔒 Approval Workflow
Every voucher goes through a controlled lifecycle:

```
Draft → Pending Approval → Posted (Approved) → Cannot be Modified
                               ↓
                          Cancelled (with reason recorded)
```

- **Draft** — Created but not yet submitted
- **Pending Approval** — Submitted by accountant, waiting for admin/manager approval
- **Posted** — Approved and permanently recorded in the books
- **Cancelled** — Voided with a mandatory reason (maintains audit trail)

#### 📊 Voucher Dashboard Summary
At the top of the Vouchers page, you see real-time totals:
| Metric | What It Shows |
|--------|--------------|
| **Total Vouchers** | Number of vouchers created in the period |
| **Posted Amount** | Total value of approved transactions |
| **Pending Amount** | Value of vouchers awaiting approval |
| **Draft Amount** | Value of vouchers still being prepared |

#### 🔗 Automatic Numbering
- Each voucher type has its own **sequential counter**
- Format: `BR-2627-001` (Bank Receipt, FY 2026-27, Sequence 1)
- **Financial year aware** — counters reset at the start of each April

#### 🔍 Powerful Filters
- Filter by **voucher type**, **status**, **date range**, or **party**
- Sort by date, amount, or voucher number
- **Search by narration** — find any transaction by description

> [!TIP]
> **Real-World Scenario:** Your agency owner puts ₹2,00,000 of personal money into the business bank account. Without the Voucher system, this money would "appear from nowhere" and confuse your books. With a **Bank Receipt** voucher marked as party type "Other" with narration "Owner Capital Contribution", the Balance Sheet correctly shows it as increased Capital, and the bank balance updates accurately.

---

## 17. Bank Reconciliation — ⭐ NEW in v1.2.2

![Bank Reconciliation — Match software records against bank statements](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/bank_reconciliation_page_1783621645374.png)

### What You See Above
A **bank reconciliation tool** that ensures your software's records match your actual bank statement — the ultimate accuracy check for your finances.

> [!IMPORTANT]
> Bank Reconciliation is the **proof of truth** in accounting. When your Balance Sheet says you have ₹5,00,000 in the bank, Bank Reconciliation **verifies** that this number matches reality by checking against your HDFC or SBI bank statement. Without it, errors go undetected and you cannot trust your own books.

### Features in Detail

#### 🏦 Multi-Account Support
- Reconcile **each bank account separately** (HDFC, SBI, Cash-in-Hand)
- Select any account from the dropdown to see its transactions
- Each account shows its own **running balance**

#### ✅ Reconciliation Workflow
The process is simple and intuitive:

1. **Download** your monthly bank statement PDF from HDFC/SBI
2. **Open** the Bank Reconciliation page in SecurManage
3. **Select** the bank account (e.g., "HDFC Current A/c")
4. **Compare** each voucher against the bank statement line-by-line
5. **Check the box** next to each transaction that matches
6. **Click "Reconcile Selected"** to permanently mark them as verified

#### 📊 Reconciliation Status
Each transaction shows one of these statuses:

| Status | Meaning | Color |
|--------|---------|-------|
| **✅ Reconciled** | Matches the bank statement — verified | Green |
| **⏳ Unreconciled** | In software but not yet verified against bank statement | Yellow |
| **⚠️ Discrepancy** | Amount in software differs from bank statement | Red |

#### 🔍 Why Transactions Don't Match (Common Scenarios)

| Scenario | What Happens |
|----------|-------------|
| **Cheque not yet cleared** | You recorded a Bank Receipt voucher for ₹45,000 on July 1, but the cheque clears in the bank on July 5. Until July 5, it appears as "Unreconciled". |
| **Bank charges** | The bank deducted ₹500 in maintenance fees. This appears in the bank statement but not in your software. You create a Bank Payment voucher and then reconcile it. |
| **Data entry error** | You typed ₹54,000 instead of ₹45,000. Reconciliation reveals the ₹9,000 discrepancy so you can correct it. |
| **Unauthorized transaction** | A transaction appears in the bank statement that nobody in your office created. Immediate red flag for investigation. |

#### 📊 Reconciliation Summary
At the top of each account's reconciliation view:
| Metric | Description |
|--------|------------|
| **Book Balance** | Balance according to your software |
| **Bank Balance** | Balance according to the bank statement |
| **Difference** | Any mismatch between the two |
| **Unreconciled Items** | Count of transactions still pending verification |

#### 📅 Date Range Filter
- Reconcile by **month**, **quarter**, or **custom date range**
- **Show/Hide reconciled** transactions to focus on pending items

> [!TIP]
> **Monthly Best Practice:** At the end of every month, have your accountant spend 15-20 minutes reconciling each bank account. This one habit catches 100% of data entry errors and provides complete peace of mind that your Balance Sheet is accurate.

---

## 18. Settings & Administration

![Settings — Central configuration for agency profile, salary structures, and team management](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/settings_page_1783441198029.png)

### What You See Above
The central control panel for **configuring every aspect** of your agency software.

### Features in Detail

#### 🏢 Agency Profile
| Setting | Description | Example |
|---------|------------|---------|
| **Agency Name** | Your company name (appears on all PDFs) | "Eagle Eye Security Service" |
| **Address** | Office address for invoices | "418, Shivalik Satyamev, Bopal..." |
| **Phone** | Contact number | "8320932214" |
| **Email** | Business email | "info@egleeyesecuritygroup.in" |
| **GST Number** | GSTIN for tax compliance | "24AVYPP2011K1ZB" |
| **PAN Number** | Business PAN | "AVYPP2011K" |
| **Agency Logo** | Upload your logo for branding | Dynamic logo upload feature |

#### 💰 Salary Structures
- Create **multiple pay scales** (Basic Guard, Senior Guard, Supervisor, etc.)
- Define **Base Salary**, **HRA**, **DA**, **Conveyance** for each structure
- Assign structures to guards during onboarding

#### 👥 Team Management (User Access Control)
Manage who can access what in the software:

| Permission | Controls Access To |
|-----------|-------------------|
| **Manage Employees** | Add/edit/delete guard records |
| **Manage Clients** | Client contracts and details |
| **Manage Attendance** | Mark/edit attendance |
| **Manage Invoices** | Generate and edit invoices |
| **Manage Payroll** | Process salaries |
| **Manage Expenses** | Track company expenses |
| **Manage Vouchers** | Create and manage accounting vouchers |
| **View Reports** | Access analytics dashboard |
| **View P&L Account** | See profit/loss statements |
| **View Balance Sheet** | See financial position |
| **View Dev Errors** | Access developer error console |
| **Manage Settings** | Modify system configuration |

#### 📧 Email Configuration (SMTP)
- Configure **outgoing email** for password resets and notifications
- Supports Gmail, Outlook, or any SMTP server
- Test email functionality from Settings

---

## 19. Developer Console & Error Monitoring

![Developer Console — Hidden error monitoring with real-time tracking](C:/Users/ratan/.gemini/antigravity-ide/brain/5093639a-844a-4c48-91d8-f2d04448d5fd/developer_console_final_1783441709566.png)

### What You See Above
A **hidden, developer-only** error monitoring dashboard — a Matrix-style console that silently captures every application error in the background.

### Features in Detail

#### 🛡️ How It Works
1. **Global Error Interceptors** are embedded in the backend
2. Every API error, database failure, or unhandled exception is **automatically captured**
3. Errors are stored in the database with full context (URL, method, stack trace)
4. **Zero impact on user experience** — guards and managers never see this page

#### 📊 Error Dashboard
| Information Captured | Example |
|---------------------|---------|
| **Error Message** | "Cannot read property 'id' of undefined" |
| **HTTP Method** | POST |
| **URL Path** | /api/payroll/generate |
| **Stack Trace** | Full technical details for debugging |
| **Timestamp** | "2026-07-07 14:32:18" |
| **User** | Which user triggered the error |
| **Status** | Open / Resolved |

#### 🔧 Error Resolution
- Click **"Resolve"** to mark an error as fixed
- Add **notes** for what caused the error and how it was fixed
- Track **error frequency** to identify recurring issues

> [!IMPORTANT]
> This page is **not visible** in the normal navigation sidebar. It's accessed via a special route (`/developer`) — only the agency admin or developer should know this URL.

---

## Security Architecture

The software implements **enterprise-grade security** suitable for handling sensitive employee and financial data.

### 🔐 Authentication & Authorization
| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Password Storage** | bcrypt (12 rounds) | Passwords are cryptographically hashed — impossible to reverse |
| **Session Tokens** | JWT (24-hour expiry) | Stateless authentication with automatic expiry |
| **Secret Management** | Auto-generated 128-char key | Unique secret per installation — stored outside the app |
| **Rate Limiting** | 500 req/15 min | Prevents brute-force and DDoS attacks |

### 🛡️ Data Protection
| Feature | How It Works |
|---------|-------------|
| **Input Validation** | All inputs validated with Joi schemas before processing |
| **SQL Injection Prevention** | Parameterized queries throughout — no raw string concatenation |
| **XSS Protection** | Helmet.js security headers on all responses |
| **Sensitive Data Masking** | Aadhaar, passwords, bank details redacted from all logs |
| **CORS Policy** | Only localhost allowed in production (Electron) |

### 💾 Database Security
- **SQLite** — Self-contained, serverless, zero-configuration
- **Database file** stored in user's AppData folder (not inside the app)
- **Survives updates** — Replacing the `.exe` never touches the database
- **Automatic migrations** — Schema updates applied on startup (supports both SQL and JavaScript migrations)

---

## PDF Generation & Dynamic Branding

Every PDF generated by the system is **professionally formatted** with your agency's branding.

### 📄 Invoice PDFs Include
- ✅ **Agency Logo** (dynamically uploaded from Settings)
- ✅ **Full Header** (Company Name, Address, Phone, Email)
- ✅ **GST & PAN Numbers**
- ✅ **Client Details** (Name, Address, GST)
- ✅ **Line Items** with HSN Code (998525)
- ✅ **CGST + SGST Breakdown**
- ✅ **Amount in Words** (auto-converted)
- ✅ **Terms & Conditions**
- ✅ **Jurisdiction Clause**

### 📄 Payslip PDFs Include
- ✅ **Agency Logo**
- ✅ **Employee Details** (Name, Designation, Month)
- ✅ **Earnings Breakdown** (Basic, HRA, DA, Allowances)
- ✅ **Deductions Breakdown** (PF, ESI, TDS, Advances)
- ✅ **Net Pay** in bold with amount in words

---

## Team Access Control

The granular permission system ensures **each team member only sees what they need**.

### Example Scenarios

#### Scenario 1: Office Manager
> *"I want my office manager to handle attendance and payroll but NOT see profit reports."*

**Solution:** Create user with permissions:
- ✅ Manage Attendance
- ✅ Manage Payroll  
- ✅ Manage Employees
- ❌ View Reports
- ❌ View P&L Account
- ❌ View Balance Sheet
- ❌ Manage Vouchers
- ❌ Manage Settings

#### Scenario 2: Accountant
> *"My accountant should handle all financial data and vouchers."*

**Solution:** Create user with permissions:
- ✅ Manage Invoices
- ✅ Manage Expenses
- ✅ Manage Vouchers
- ✅ View Reports
- ✅ View P&L Account
- ✅ View Balance Sheet
- ❌ Manage Employees
- ❌ Manage Attendance

#### Scenario 3: Site Supervisor
> *"My site supervisor should only mark attendance."*

**Solution:** Create user with permissions:
- ✅ Manage Attendance
- ❌ Everything else

---

## Software Delivery & Updates

### 📦 Installation
- **Single `.exe` installer** — Double-click to install
- **No dependencies** — Everything bundled (Node.js, Express, SQLite, React)
- **Desktop shortcut** created automatically
- **Start Menu entry** for easy access

### 🔄 Auto-Update System
- Software checks for updates **automatically** on startup
- Downloads in the **background** without interrupting work
- Installs when the user **closes the app**
- **Zero downtime** — No manual steps required

### 💾 Data Safety
- Database stored at: `C:\Users\[Username]\AppData\Roaming\Security Firm Management\`
- **Updates never touch the database** — Your data is always safe
- **Uploaded files** (logos, receipts) stored in the same safe folder
- **Automatic schema migrations** — New features seamlessly upgrade your existing data

---

> [!NOTE]
> **Version 1.2.2** includes all features described in this document.  
> Built and tested for **Windows 10/11 (64-bit)**.  
> Installer size: ~85 MB | Installed size: ~250 MB

---

## Version History

| Version | Date | Key Additions |
|---------|------|--------------|
| **v1.0.0** | June 2026 | Core platform: Guards, Clients, Attendance, Invoices, Payroll, Expenses |
| **v1.1.0** | July 2026 | P&L Account, Vendor Management, Tax Reports, Statement Archive, Team Permissions, Developer Console |
| **v1.2.2** | July 2026 | ⭐ Balance Sheet, ⭐ Voucher System (8 types), ⭐ Bank Reconciliation, Bank Accounts, Migration System Upgrade |

---

*© 2026 Security Firm Management Software. All rights reserved.*
