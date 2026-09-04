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
const PORT = process.env.PORT || 3000;

// Security middleware with Content Security Policy & Cross-Origin Resource Policy
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'http://localhost:*', 'http://127.0.0.1:*', 'http://10.*:*', 'http://192.168.*:*', 'http://172.*:*'],
        connectSrc: ["'self'", 'http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*', 'http://10.*:*', 'http://192.168.*:*', 'http://172.*:*', 'ws://10.*:*', 'ws://192.168.*:*'],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
  })
);

// CORS: Restrict origins to prevent CSRF attacks
// LAN-aware CORS — allows localhost AND all private LAN IP ranges
// This is required for browser-only client PCs on the same WiFi network
function isLanOrigin(origin) {
  if (!origin) return true; // non-browser (curl, mobile app)
  try {
    const url = new URL(origin);
    const host = url.hostname;
    // localhost variants
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    // LAN private ranges: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
    if (/^192\.168\./.test(host)) return true;
    if (/^10\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  } catch (_) {}
  return false;
}

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:3000'];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || isLanOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Blocked by CORS policy'));
      }
    },
    credentials: true,
  })
);
app.use(cookieParser());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
});
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth/login', strictLimiter);
app.use('/api/bank-reconciliation', strictLimiter);
app.use('/api/', limiter);

// Serve static files (documents/uploads) with cross-origin access
const path = require('path');
const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
}, express.static(uploadDir));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Global Request Timeout (15 seconds)
const timeout = require('connect-timeout');
app.use(timeout('15s'));

// Middleware to halt on timeout
function haltOnTimedout(req, res, next) {
  if (!req.timedout) next();
}
app.use(haltOnTimedout);

// Middleware to disable timeout for heavy routes
function extendTimeout(req, res, next) {
  if (req.clearTimeout) req.clearTimeout();
  next();
}

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
// Payroll and Invoices can be heavy, extend timeout
app.use('/api/payroll', extendTimeout, payrollRoutes);
app.use('/api/invoices', extendTimeout, invoicesRoutes);
app.use('/api/reports', extendTimeout, reportsRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api/account-ledger', require('./routes/account-ledger'));
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

let server;

// Initialize scheduled cron jobs and HTTP server only when not in test environment
if (process.env.NODE_ENV !== 'test') {
  startScheduledJobs();
  startBackupJob();
  initCronJobs();

  // ── Async startup: init MySQL pool, then start HTTP server ──────────
  const { initDB } = require('./database/connection');
  const os = require('os');

  function getLanIP() {
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
      for (const alias of iface) {
        if (alias.family === 'IPv4' && !alias.internal) {
          return alias.address;
        }
      }
    }
    return 'unknown';
  }

  function startHttpServer() {
    if (server) return;
    server = app.listen(PORT, '0.0.0.0', () => {
      const lanIP = getLanIP();
      process.env.SERVER_LAN_IP = lanIP;
      logger.info(`\n🚀 Security Firm Server running on port ${PORT}`);
      logger.info(`🖥️  Local:   http://localhost:${PORT}`);
      logger.info(`🌐 Network: http://${lanIP}:${PORT}  ← Share this with LAN users`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV}`);
      logger.info(`🗄️  Database: MySQL @ ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME}\n`);
    });
  }

  initDB()
    .then(() => {
      startHttpServer();
    })
    .catch(err => {
      logger.error('❌ Database connection error on startup:', err.message);
      logger.error('   Starting HTTP server in setup mode so user can configure database...');
      startHttpServer();
    });
}

// ── Graceful Shutdown ────────────────────────────────────────────────────────
const gracefulShutdown = async (signal) => {
  logger.info(`\n${signal} signal received: closing HTTP server`);
  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed.');
      try {
        const { pool } = require('./database/connection');
        if (pool) {
          await pool.end();
          logger.info('MySQL pool closed.');
        }
      } catch (err) {
        logger.error('Error closing MySQL pool:', err.message);
      }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
