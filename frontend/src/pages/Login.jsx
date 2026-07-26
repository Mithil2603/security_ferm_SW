import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ShieldAlert, Lock, Mail, Loader2, Wifi, ChevronDown, AlertCircle, Info, AlertTriangle } from 'lucide-react';

// Error type color mapping
const ERROR_COLOR_MAP = {
  AUTH_ERROR: 'red',
  VALIDATION_ERROR: 'amber',
  RATE_LIMIT_ERROR: 'red',
  SERVER_ERROR: 'red',
  NETWORK_ERROR: 'orange',
  UNKNOWN_ERROR: 'gray'
};

// Error messages with suggested actions
const ERROR_MESSAGES = {
  INVALID_CREDENTIALS: {
    message: 'Invalid email or password',
    action: 'Please check your email and password and try again',
    icon: AlertCircle
  },
  USER_INACTIVE: {
    message: 'Account is inactive',
    action: 'Your account has been deactivated. Contact your administrator',
    icon: AlertTriangle
  },
  USER_NOT_FOUND: {
    message: 'No account found with this email',
    action: 'Check your email address or contact your administrator to create an account',
    icon: AlertCircle
  },
  MISSING_FIELDS: {
    message: 'Missing required fields',
    action: 'Please enter both email and password',
    icon: AlertCircle
  },
  TOO_MANY_ATTEMPTS: {
    message: 'Too many login attempts',
    action: 'Your account has been temporarily locked. Try again after 15 minutes',
    icon: AlertTriangle
  },
  DATABASE_ERROR: {
    message: 'Database connection error',
    action: 'The server is experiencing database issues. Try again in a few moments',
    icon: AlertTriangle
  },
  CONNECTION_REFUSED: {
    message: 'Cannot connect to server',
    action: 'Check your network connection or configure the server IP in Network Setup',
    icon: AlertTriangle
  },
  TIMEOUT: {
    message: 'Connection timeout',
    action: 'The server is taking too long to respond. Check your connection and try again',
    icon: AlertTriangle
  },
  INTERNAL_SERVER_ERROR: {
    message: 'Server error occurred',
    action: 'A server error occurred. Please try again or contact support',
    icon: AlertTriangle
  }
};

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNetworkSetup, setShowNetworkSetup] = useState(false);
  const [serverIP, setServerIP] = useState(localStorage.getItem('serverIP') || '');
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  // Categorize and structure errors
  const categorizeError = (err) => {
    // Network errors
    if (!err) {
      return {
        code: 'UNKNOWN_ERROR',
        type: 'UNKNOWN_ERROR',
        message: 'An unknown error occurred',
        details: 'No error information available',
        statusCode: 0,
        action: 'Try refreshing the page or restarting the application',
        retryable: true,
        timestamp: new Date().toISOString()
      };
    }

    if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      return {
        code: 'CONNECTION_REFUSED',
        type: 'NETWORK_ERROR',
        message: 'Cannot connect to server',
        details: `Connection refused at ${serverIP || 'localhost:5000'}. Is the server running?`,
        statusCode: 0,
        action: 'Check if the SecurManage server is running. Click "Network Setup" to configure the correct server IP',
        retryable: true,
        timestamp: new Date().toISOString()
      };
    }

    if (err.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND')) {
      return {
        code: 'DNS_RESOLUTION_FAILED',
        type: 'NETWORK_ERROR',
        message: 'Cannot resolve server address',
        details: `DNS resolution failed for ${serverIP || 'localhost'}`,
        statusCode: 0,
        action: 'Check your network connection and server IP configuration in Network Setup',
        retryable: true,
        timestamp: new Date().toISOString()
      };
    }

    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      return {
        code: 'TIMEOUT',
        type: 'NETWORK_ERROR',
        message: 'Connection timeout',
        details: 'The request took too long to complete',
        statusCode: 0,
        action: 'Check your network connection and try again',
        retryable: true,
        timestamp: new Date().toISOString()
      };
    }

    if (err.message === 'Network Error' || err.code === 'ERR_NETWORK') {
      return {
        code: 'NO_INTERNET',
        type: 'NETWORK_ERROR',
        message: 'Network connection error',
        details: 'Check your internet connection',
        statusCode: 0,
        action: 'Verify your network connection is working properly',
        retryable: true,
        timestamp: new Date().toISOString()
      };
    }

    // HTTP status code errors
    const statusCode = err.status || err.response?.status || 0;
    const responseData = err.response?.data || {};

    // 401 - Authentication errors
    if (statusCode === 401) {
      const backendCode = responseData.errorCode || 'INVALID_CREDENTIALS';
      return {
        code: backendCode,
        type: 'AUTH_ERROR',
        message: responseData.message || 'Authentication failed',
        details: `Status: 401 Unauthorized. Code: ${backendCode}`,
        statusCode: 401,
        action: 'Check your email and password',
        retryable: true,
        timestamp: new Date().toISOString()
      };
    }

    // 400 - Validation errors
    if (statusCode === 400) {
      return {
        code: 'VALIDATION_ERROR',
        type: 'VALIDATION_ERROR',
        message: responseData.message || 'Invalid input',
        details: `Status: 400 Bad Request. ${responseData.details || ''}`,
        statusCode: 400,
        action: 'Check that all fields are filled in correctly',
        retryable: false,
        timestamp: new Date().toISOString()
      };
    }

    // 429 - Rate limit
    if (statusCode === 429) {
      return {
        code: 'TOO_MANY_ATTEMPTS',
        type: 'RATE_LIMIT_ERROR',
        message: 'Too many login attempts',
        details: 'You have exceeded the maximum number of login attempts',
        statusCode: 429,
        action: 'Please wait 15 minutes before trying again',
        retryable: false,
        timestamp: new Date().toISOString()
      };
    }

    // 500 - Server errors
    if (statusCode === 500) {
      const errorType = responseData.errorCode || 'INTERNAL_SERVER_ERROR';
      return {
        code: errorType,
        type: 'SERVER_ERROR',
        message: 'Server error',
        details: `Status: 500. Type: ${errorType}. Message: ${responseData.message || 'Internal server error'}`,
        statusCode: 500,
        action: 'The server is experiencing issues. Please try again in a few moments',
        retryable: true,
        timestamp: new Date().toISOString()
      };
    }

    // Generic HTTP errors
    if (statusCode >= 400 && statusCode < 500) {
      return {
        code: 'HTTP_CLIENT_ERROR',
        type: 'UNKNOWN_ERROR',
        message: responseData.message || 'Request error',
        details: `HTTP ${statusCode}. ${responseData.details || ''}`,
        statusCode: statusCode,
        action: 'An error occurred while processing your request',
        retryable: true,
        timestamp: new Date().toISOString()
      };
    }

    if (statusCode >= 500) {
      return {
        code: 'HTTP_SERVER_ERROR',
        type: 'SERVER_ERROR',
        message: 'Server error',
        details: `HTTP ${statusCode}. ${responseData.message || 'Server error'}`,
        statusCode: statusCode,
        action: 'The server is experiencing issues. Please try again later',
        retryable: true,
        timestamp: new Date().toISOString()
      };
    }

    // Fallback for unknown errors
    return {
      code: 'UNKNOWN_ERROR',
      type: 'UNKNOWN_ERROR',
      message: typeof err === 'string' ? err : (err?.message || 'An unknown error occurred'),
      details: JSON.stringify(err, Object.getOwnPropertyNames(err)),
      statusCode: 0,
      action: 'Try refreshing the page or restarting the application',
      retryable: true,
      timestamp: new Date().toISOString()
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setShowErrorDetails(false);
    setIsSubmitting(true);

    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      const categorizedError = categorizeError(err);
      setError(categorizedError);
      
      // Log error for debugging (only in development)
      if (process.env.NODE_ENV === 'development') {
        console.error('Login Error Details:', categorizedError);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Determine color scheme based on error type
  const errorColor = error ? ERROR_COLOR_MAP[error.type] : 'red';
  const colorClasses = {
    red: {
      bg: 'bg-red-50',
      border: 'border-red-100',
      text: 'text-red-700',
      icon: 'text-red-500'
    },
    amber: {
      bg: 'bg-amber-50',
      border: 'border-amber-100',
      text: 'text-amber-700',
      icon: 'text-amber-500'
    },
    orange: {
      bg: 'bg-orange-50',
      border: 'border-orange-100',
      text: 'text-orange-700',
      icon: 'text-orange-500'
    },
    gray: {
      bg: 'bg-gray-50',
      border: 'border-gray-100',
      text: 'text-gray-700',
      icon: 'text-gray-500'
    }
  };

  const currentColorClasses = colorClasses[errorColor];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Logo Section */}
        <div className="text-center mb-10 animate-slide-up">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-teal-500 shadow-lg shadow-teal-500/30 mb-6">
            <ShieldAlert className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-3xl font-bold text-white tracking-tight">SecurManage</h2>
          <p className="text-slate-400 mt-2">Enterprise Security Agency Platform</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden animate-slide-up" style={{ animationDelay: '0.1s' }}>
          <div className="p-8">
            <h3 className="text-xl font-semibold text-slate-800 mb-6">Sign in to your account</h3>
            
            {/* Error Display Section */}
            {error && (
              <div className={`mb-6 ${currentColorClasses.bg} border ${currentColorClasses.border} rounded-lg overflow-hidden`}>
                {/* Error Header */}
                <div
                  className="p-4 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => setShowErrorDetails(!showErrorDetails)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      {error.code === 'INVALID_CREDENTIALS' && <AlertCircle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${currentColorClasses.icon}`} />}
                      {error.code === 'TOO_MANY_ATTEMPTS' && <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${currentColorClasses.icon}`} />}
                      {error.code === 'CONNECTION_REFUSED' && <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${currentColorClasses.icon}`} />}
                      {!['INVALID_CREDENTIALS', 'TOO_MANY_ATTEMPTS', 'CONNECTION_REFUSED'].includes(error.code) && <Info className={`w-5 h-5 flex-shrink-0 mt-0.5 ${currentColorClasses.icon}`} />}
                      <div>
                        <p className={`font-semibold text-sm ${currentColorClasses.text}`}>
                          {error.message}
                        </p>
                        <p className={`text-xs mt-1 ${currentColorClasses.text} opacity-80`}>
                          {error.action}
                        </p>
                      </div>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 flex-shrink-0 mt-0.5 transition-transform ${currentColorClasses.icon} ${showErrorDetails ? 'rotate-180' : ''}`}
                    />
                  </div>
                </div>

                {/* Error Details (Expandable) */}
                {showErrorDetails && (
                  <div className={`border-t ${currentColorClasses.border} px-4 py-3 bg-opacity-50`}>
                    <div className="text-xs space-y-1 font-mono">
                      <div><span className="font-semibold">Error Code:</span> {error.code}</div>
                      <div><span className="font-semibold">Type:</span> {error.type}</div>
                      <div><span className="font-semibold">Status:</span> {error.statusCode || 'N/A'}</div>
                      <div><span className="font-semibold">Details:</span> {error.details}</div>
                      <div><span className="font-semibold">Time:</span> {new Date(error.timestamp).toLocaleString()}</div>
                      {error.retryable && (
                        <div><span className="font-semibold">Retryable:</span> Yes, you can try again</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Network Setup Quick Link */}
                {['CONNECTION_REFUSED', 'DNS_RESOLUTION_FAILED', 'NO_INTERNET'].includes(error.code) && (
                  <div className={`border-t ${currentColorClasses.border} px-4 py-2 bg-opacity-50`}>
                    <button
                      onClick={() => setShowNetworkSetup(true)}
                      className={`text-xs font-semibold flex items-center gap-1 ${currentColorClasses.text} hover:underline`}
                    >
                      <Wifi className="w-3 h-3" />
                      Open Network Setup
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email Input */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Email address</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isSubmitting}
                    className="block w-full pl-10 pr-3 py-2.5 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-shadow bg-slate-50 focus:bg-white disabled:bg-slate-100 disabled:cursor-not-allowed"
                    placeholder="admin@securityfirm.com"
                  />
                </div>
              </div>

              {/* Password Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-slate-700">Password</label>
                  <Link to="/forgot-password" className="text-sm font-medium text-teal-600 hover:text-teal-500 transition-colors">Forgot password?</Link>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isSubmitting}
                    className="block w-full pl-10 pr-3 py-2.5 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-shadow bg-slate-50 focus:bg-white disabled:bg-slate-100 disabled:cursor-not-allowed"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  'Sign In'
                )}
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="px-8 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
            <p className="text-xs text-slate-500">Secure AES-256 Encrypted Connection</p>
            <button 
              onClick={() => setShowNetworkSetup(true)}
              className="text-xs flex items-center text-slate-500 hover:text-teal-600 transition-colors"
            >
              <Wifi className="w-3 h-3 mr-1" />
              Network Setup
            </button>
          </div>
        </div>

        {/* Network Setup Modal */}
        {showNetworkSetup && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 animate-slide-up">
              <h3 className="text-lg font-bold text-slate-800 mb-2">Network Server Setup</h3>
              <p className="text-sm text-slate-600 mb-4">
                Configure your SecurManage server connection. If you're connecting over WiFi, enter the main computer's IP address.
              </p>
              
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-4">
                <p className="text-xs text-blue-700">
                  <span className="font-semibold">Tip:</span> Leave blank if connecting to the same computer. For network connections, use the server's IP address (e.g., 192.168.1.100)
                </p>
              </div>

              <input
                type="text"
                placeholder="e.g. 192.168.1.100"
                value={serverIP}
                onChange={(e) => setServerIP(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:outline-none mb-4"
              />
              
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowNetworkSetup(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (serverIP) {
                      localStorage.setItem('serverIP', serverIP);
                    } else {
                      localStorage.removeItem('serverIP');
                    }
                    setShowNetworkSetup(false);
                    window.location.reload(); // Reload to re-initialize axios instance
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700"
                >
                  Save & Connect
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
