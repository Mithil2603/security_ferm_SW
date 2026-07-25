require('dotenv').config();
const { runStartupSecurityCheck } = require('./utils/startupSecurityCheck');
runStartupSecurityCheck();
const express = require('express');
const logger = require('./utils/logger');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createLogger } = require('./utils/secureLogger');
const cookieParser = require('cookie-parser');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware with Content Security Policy
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'http://localhost:*', 'http://127.0.0.1:*'],
        connectSrc: ["'self'", 'http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*'],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
  })
);

// CORS: Restrict origins to prevent CSRF attacks
if (process.env.NODE_ENV === 'production') {
  // In Electron: frontend and backend are in same process
  // Allow localhost only, reject cross-domain requests
  const allowedOrigins = [
    'http://localhost:5000',
    'http://127.0.0.1:5000',
  ];

  app.use(cors({
    origin: function(origin, callback) {
      // Allow non-browser requests (mobile apps, curl, etc.)
      if (!origin) {
        return callback(null, true);
      }

      // Check if origin is in whitelist
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Reject disallowed origins
      logger.warn(`⚠️  CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-master-passcode'],
    maxAge: 86400  // Cache CORS policy for 24 hours
  }));
} else {
  // Development: allow localhost and 127.0.0.1
  app.use(cors({
    origin: function(origin, callback) {
      if (!origin) return callback(null, true);
      if (origin.startsWith('http://localhost:') || 
          origin.startsWith('http://127.0.0.1:') ||
          origin.startsWith('http://[::1]:')) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-master-passcode']
  }));
}
app.use(cookieParser());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500
});

// Stricter limits for sensitive operations (Issue #13)
const strictLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 15               // Max 15 requests per minute
});

app.use('/api/payroll', strictLimiter);
app.use('/api/invoices', strictLimiter);
app.use('/api/bank-reconciliation', strictLimiter);
app.use('/api/', limiter);

// Serve static files (documents/uploads)
const path = require('path');
const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging — secure logger redacts sensitive fields (passwords, Aadhaar, bank details)
app.use(createLogger());

// Routes
const authRoutes = require('./routes/auth');
const employeesRoutes = require('./routes/employees');
const clientsRoutes = require('./routes/clients');
const attendanceRoutes = require('./routes/attendance');
const payrollRoutes = require('./routes/payroll');
const invoicesRoutes = require('./routes/invoices');
const expensesRoutes = require('./routes/expenses');
const settingsRoutes = require('./routes/settings');
const reportsRoutes = require('./routes/reports');
const dashboardRoutes = require('./routes/dashboard');
const ledgerRoutes = require('./routes/ledger');
const vendorsRoutes = require('./routes/vendors');
const { startBackupJob } = require('./utils/backupJob');
const { initCronJobs } = require('./services/cronService');

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api/vendors', vendorsRoutes);
app.use('/api/recurring-expenses', require('./routes/recurring_expenses'));
app.use('/api/errors', require('./routes/errors'));
app.use('/api/statements', require('./routes/statements'));
app.use('/api/pl-account', require('./routes/pl-account'));
app.use('/api/vouchers', require('./routes/vouchers'));
app.use('/api/bank-accounts', require('./routes/bank-accounts'));
app.use('/api/balance-sheet', require('./routes/balance-sheet'));
app.use('/api/bank-reconciliation', require('./routes/bank-reconciliation'));
app.use('/api/recurring-invoices', require('./routes/recurring-invoices'));
app.use('/api/salary-structures', require('./routes/salary-structures'));
app.use('/api/salary-slips', require('./routes/salary-slips'));
app.use('/api/tax', require('./routes/tax'));
app.use('/api/pf-gratuity', require('./routes/pf-gratuity'));
app.use('/api/gst', require('./routes/gst-compliance'));
app.use('/api/financial-reports', require('./routes/financial-reports'));
app.use('/api/workflows', require('./routes/workflows'));
app.use('/api/backups', require('./routes/backups'));
app.use('/api/audit-logs', require('./routes/audit-logs'));
app.use('/api/budgets', require('./routes/budgets'));
app.use('/api/license', require('./routes/license'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

const { startScheduledJobs } = require('./utils/scheduledJobs');

// Global error handler — never leak stack traces in production
const globalErrorHandler = require('./middleware/globalErrorHandler');
app.use(globalErrorHandler);

// Serve React frontend
app.use(express.static(path.join(__dirname, '..', 'frontend-dist')));

// Catch-all route for React SPA, except API routes
app.use((req, res) => {
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'Route not found' });
  }
  res.sendFile(path.join(__dirname, '..', 'frontend-dist', 'index.html'));
});

// Initialize scheduled cron jobs
startScheduledJobs();
startBackupJob();
initCronJobs();

app.listen(PORT, '127.0.0.1', () => {
  logger.info(`\n🚀 Security Firm API Server running on port ${PORT} (127.0.0.1)`);
  logger.info(`📊 Environment: ${process.env.NODE_ENV}`);
  logger.info(`🗄️  Database: SQLite @ ${process.env.DB_PATH || 'database.sqlite'}\n`);
});

module.exports = app;
