import React from 'react';
import axios from 'axios';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { getApiBaseUrl } from '../utils/apiUrl';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    const baseURL = getApiBaseUrl();

    try {
      axios.post(`${baseURL}/errors`, {
        error_type: 'React Error Boundary',
        error_message: error.message || error.toString(),
        stack_trace: errorInfo.componentStack || error.stack,
        endpoint: window.location.pathname,
        method: 'FRONTEND',
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': localStorage.getItem('token') ? `Bearer ${localStorage.getItem('token')}` : undefined
        }
      }).catch(() => {});
    } catch (e) {
      // ignore
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-2">Something went wrong</h1>
            <p className="text-slate-500 mb-8">
              We've encountered an unexpected error. Our development team has been notified automatically.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => window.location.reload()}
                className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 px-4 rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-5 h-5" />
                Reload Page
              </button>

              <button
                type="button"
                onClick={() => {
                  if (window.electronAPI && window.electronAPI.openLogFolder) {
                    window.electronAPI.openLogFolder();
                  } else {
                    alert('Log files are stored in your AppData / logs directory.');
                  }
                }}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2.5 px-4 rounded-xl text-sm transition-colors flex items-center justify-center gap-2 border border-slate-300"
              >
                📂 Open Log Folder
              </button>
            </div>

            <div className="mt-6 text-left bg-slate-900 text-slate-100 p-4 rounded-lg overflow-auto max-h-48 text-xs font-mono border border-slate-700">
              <div className="text-red-400 font-bold mb-1">Error Trace:</div>
              <div>{this.state.error ? (this.state.error.stack || this.state.error.toString()) : 'No trace available.'}</div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
