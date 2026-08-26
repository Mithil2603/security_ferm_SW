# 🛡️ Security Firm Management Software

A full-featured desktop ERP application built for private security agencies. Manages employees, clients, payroll, invoicing, attendance, GST compliance, financial reports, and more — all running locally on the firm's own hardware.

> **Built with:** Electron · Node.js · Express · React · MySQL · Vite

---

## ✨ Features

| Module | Description |
|---|---|
| 👥 **Employees** | Full employee lifecycle, documents, salary structures |
| 🕐 **Attendance** | Daily & bulk marking, shift tracking |
| 💰 **Payroll** | Auto-generate slips, approve & pay, PF/ESI/TDS/Gratuity |
| 🧾 **Invoices** | GST invoicing (CGST/SGST/IGST), recurring, PDF export |
| 📋 **Clients** | Client profiles, billing history, statement export |
| 🏪 **Vendors** | Vendor payments and statement tracking |
| 💳 **Vouchers** | Payment/Receipt/Journal/Contra vouchers |
| 🏦 **Bank Reconciliation** | Match bank entries against recorded transactions |
| 📊 **Reports** | P&L, Balance Sheet, TDS, GST bifurcation, expense summary |
| 🔒 **Audit Logs** | All actions logged with user, timestamp, IP |
| 🌐 **LAN Multi-user** | Admin runs app, team accesses via browser on same WiFi |
| 🔑 **License System** | Hardware-locked licensing via License Manager server |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────┐
│           Electron Shell            │  ← Desktop wrapper (main.js)
│  ┌───────────────────────────────┐  │
│  │     Express API Server        │  │  ← src/index.js  (port 3000)
│  │     (Node.js + MySQL)         │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │     React Frontend (Vite)     │  │  ← frontend/src/
│  │     Served from frontend-dist │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
         ↕ LAN access via browser
    http://<server-ip>:3000
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- MySQL 8.0+
- Windows 10/11 (primary target; Electron build)

### Development Setup

```bash
# 1. Clone the repo
git clone https://github.com/het1621/security_ferm_SW.git
cd security_ferm_SW

# 2. Install backend dependencies
npm install

# 3. Install frontend dependencies
npm install --prefix frontend

# 4. Set up environment variables
cp .env.example .env
# Edit .env with your MySQL credentials

# 5. Run database migrations
node src/database/migrationRunner.js

# 6. Start backend (port 3000)
npm run server

# 7. Start frontend (port 5173)
npm run dev:frontend

# Or start both together
npm run dev
```

### Build Electron App (Windows)

```bash
# Build the frontend first
npm run build:frontend

# Package as Electron app
npm run build
```

---

## 📁 Project Structure

```
security_ferm_SW/
├── main.js                  # Electron entry point
├── preload.js               # Electron preload bridge
├── src/
│   ├── index.js             # Express server entry
│   ├── routes/              # API route handlers (one file per module)
│   ├── services/            # Business logic (payroll, GST, invoicing, ...)
│   ├── middleware/          # Auth, audit, error handling
│   ├── utils/               # Logger, PDF generator, email, scheduler
│   └── database/
│       ├── connection.js    # MySQL connection pool
│       ├── schema.sql       # Full database schema
│       ├── migrations/      # Incremental SQL/JS migrations
│       └── seed.js          # Development seed data
├── frontend/
│   ├── src/
│   │   ├── pages/           # One component per app page
│   │   ├── components/      # Shared UI components
│   │   ├── services/        # Axios API client
│   │   ├── context/         # React auth context
│   │   └── utils/           # API URL resolver, error logger
│   └── vite.config.js
├── tests/                   # Jest test suites
├── scripts/                 # DB setup, build, and dev utilities
└── docs/                    # Developer documentation
```

---

## 🔧 Key Scripts

```bash
npm run dev              # Start backend + frontend in dev mode
npm run server           # Backend only (nodemon)
npm run dev:frontend     # Frontend only (Vite)
npm run build:frontend   # Build React app into frontend-dist/
npm run build            # Package Electron app
npm test                 # Run Jest test suite
```

---

## 🌐 LAN Multi-User Access

The app supports browser-based access from other PCs on the same network:

1. Run the Electron app on the main/server PC
2. Other team members open `http://<server-ip>:3000` in their browser
3. The server IP is shown in the app's Settings → Team Members section
4. Admin creates team member accounts via Settings → Users

---

## 🔒 Security

- JWT authentication with refresh token rotation
- bcrypt password hashing (12 rounds)
- Role-based access control (`admin`, `manager`, `accountant`, `viewer`)
- Rate limiting on all API routes
- Helmet.js CSP headers
- All sensitive fields redacted in server logs
- Audit trail for every data-modifying action

---

## 📄 License

Proprietary — All rights reserved. This software is licensed, not sold.

---

## 🤝 Contributing

This is a private project. For access or collaboration, contact the repository owner.
