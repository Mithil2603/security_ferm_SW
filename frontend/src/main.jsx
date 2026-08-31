import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

import ErrorBoundary from './components/ErrorBoundary.jsx'
import { ToastProvider } from './context/ToastContext.jsx'

// Electron does not support window.prompt by default; prevent UnhandledRejections
if (typeof window !== 'undefined') {
  try {
    const originalPrompt = window.prompt;
    window.prompt = function (message, defaultValue) {
      try {
        if (typeof originalPrompt === 'function') {
          return originalPrompt(message, defaultValue);
        }
      } catch (e) {
        console.warn('window.prompt not supported in this environment:', e);
      }
      return defaultValue !== undefined ? String(defaultValue) : null;
    };
  } catch (e) {
    console.warn('Could not polyfill window.prompt:', e);
  }

  // Globally open the native calendar popup when clicking anywhere inside a date/month input
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (target && (target.type === 'date' || target.type === 'month' || target.type === 'time' || target.type === 'datetime-local')) {
      try {
        if (typeof target.showPicker === 'function') {
          target.showPicker();
        }
      } catch (_) {}
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
