/**
 * Frontend Error Interceptor
 * Catches all errors on frontend and sends to backend logging
 */

import axios from 'axios';

const API_BASE = 'http://localhost:3000';

class ErrorInterceptor {
  constructor() {
    this.setupGlobalErrorHandler();
    this.setupAxiosInterceptor();
    this.setupUnhandledRejectionHandler();
  }

  // Catch synchronous errors
  setupGlobalErrorHandler() {
    window.addEventListener('error', (event) => {
      this.logFrontendError({
        error_type: 'UncaughtError',
        error_message: event.message || 'Unknown error',
        stack_trace: event.error?.stack,
        endpoint: window.location.pathname,
        method: 'frontend',
        additional_data: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        }
      });
    });
  }

  // Catch unhandled promise rejections
  setupUnhandledRejectionHandler() {
    window.addEventListener('unhandledrejection', (event) => {
      this.logFrontendError({
        error_type: 'UnhandledPromiseRejection',
        error_message: event.reason?.message || 'Unhandled promise rejection',
        stack_trace: event.reason?.stack,
        endpoint: window.location.pathname,
        method: 'frontend',
        additional_data: {
          reason: event.reason?.toString()
        }
      });
    });
  }

  // Intercept axios errors
  setupAxiosInterceptor() {
    axios.interceptors.response.use(
      (response) => response,
      (error) => {
        // Prevent infinite loop: Don't log errors that occur while trying to log an error
        if (!error.config?.url?.includes('/api/errors')) {
          this.logFrontendError({
            error_type: 'APIError',
            error_message: error.message || 'API call failed',
            stack_trace: error.stack,
            endpoint: error.config?.url,
            method: error.config?.method?.toUpperCase(),
            additional_data: {
              status_code: error.response?.status,
              status_text: error.response?.statusText,
              response_data: error.response?.data
            }
          });
        }

        return Promise.reject(error);
      }
    );
  }

  // Send error to backend
  async logFrontendError(errorData) {
    try {
      const token = localStorage.getItem('token');
      
      await axios.post(`${API_BASE}/api/errors`, errorData, {
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json'
        }
      });
    } catch (err) {
      // Fallback: log to browser console if backend logging fails
      console.error('[ErrorInterceptor] Failed to log error:', err);
      console.error('[OriginalError]', errorData);
    }
  }
}

// Initialize on app load
export const errorInterceptor = new ErrorInterceptor();
