import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

import ErrorBoundary from './components/ErrorBoundary.jsx'

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
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
