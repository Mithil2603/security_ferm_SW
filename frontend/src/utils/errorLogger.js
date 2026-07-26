/**
 * Client-side error logger for SecurManage
 * Logs login and auth errors for debugging
 */

class ErrorLogger {
  constructor() {
    this.logs = [];
    this.maxLogs = 50; // Keep last 50 errors
  }

  log(errorInfo) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...errorInfo
    };

    this.logs.push(logEntry);
    
    // Keep only recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.group(`🔴 Error Logged: ${errorInfo.code}`);
      console.log('Full Details:', logEntry);
      console.groupEnd();
    }

    // Optional: Send to server for monitoring
    this.sendToServer(logEntry);
  }

  sendToServer(logEntry) {
    // Only in production, and only send critical errors
    if (process.env.NODE_ENV === 'production' && 
        ['SERVER_ERROR', 'NETWORK_ERROR', 'UNKNOWN_ERROR'].includes(logEntry.type)) {
      
      // Non-blocking send
      fetch('/api/logs/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logEntry)
      }).catch(() => {
        // Silently fail if logging endpoint doesn't exist
      });
    }
  }

  getAll() {
    return this.logs;
  }

  clear() {
    this.logs = [];
  }

  export() {
    return JSON.stringify(this.logs, null, 2);
  }
}

export default new ErrorLogger();
