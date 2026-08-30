const winston = require('winston');
const path = require('path');
const fs = require('fs');

const isDev = process.env.NODE_ENV !== 'production';
const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

// Ensure log directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const DailyRotateFile = require('winston-daily-rotate-file');

const errorTransport = new DailyRotateFile({
  filename: path.join(logDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
  level: 'error'
});

const combinedTransport = new DailyRotateFile({
  filename: path.join(logDir, 'combined-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d'
});

// Direct fixed-name log files for quick inspection
const directErrorTransport = new winston.transports.File({
  filename: path.join(logDir, 'latest-error.log'),
  level: 'error',
  maxsize: 10 * 1024 * 1024,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ level, message, timestamp, stack }) => {
      return `[${timestamp}] [${level.toUpperCase()}]: ${stack || message}`;
    })
  )
});

const directCombinedTransport = new winston.transports.File({
  filename: path.join(logDir, 'app.log'),
  maxsize: 10 * 1024 * 1024,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ level, message, timestamp, stack }) => {
      return `[${timestamp}] [${level.toUpperCase()}]: ${stack || message}`;
    })
  )
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'security-firm-api' },
  transports: [
    errorTransport,
    combinedTransport,
    directErrorTransport,
    directCombinedTransport,
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, stack }) => {
          if (stack) {
            return `${timestamp} ${level}: ${message}\n${stack}`;
          }
          return `${timestamp} ${level}: ${message}`;
        })
      )
    })
  ],
});

// Also log unhandled rejections to logger
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at: ' + promise + ' reason: ' + (reason?.stack || reason));
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception thrown: ' + (err?.stack || err));
});

module.exports = logger;
