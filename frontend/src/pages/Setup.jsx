import { useState, useEffect } from 'react';
import api from '../services/api';
import { 
  Lock, Mail, User, Check, AlertCircle, 
  Database, Loader, PackageOpen
} from 'lucide-react';

export default function Setup({ onSetupComplete }) {
  // State Management
  const [step, setStep] = useState(1); // 1: Welcome, 2: Create Admin
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [setupProgress, setSetupProgress] = useState('');
  const [setupComplete, setSetupComplete] = useState(false);
  
  // Form Data
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    fullName: '',
    confirm_password: ''
  });

  // Test data checkbox
  const [seedTestData, setSeedTestData] = useState(false);

  // Form Validation
  const [formErrors, setFormErrors] = useState({});

  // Validation Functions
  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateForm = () => {
    const errors = {};

    if (!formData.fullName.trim()) {
      errors.fullName = 'Full name is required';
    }

    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!validateEmail(formData.email)) {
      errors.email = 'Invalid email format';
    }

    if (!formData.password) {
      errors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    }

    if (formData.password !== formData.confirm_password) {
      errors.confirm_password = 'Passwords do not match';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit Handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setError(null);
    setLoading(true);
    setSetupProgress('Creating admin account...');

    try {
      const response = await api.post('/auth/setup-init', {
        email: formData.email.toLowerCase().trim(),
        password: formData.password,
        full_name: formData.fullName.trim(),
        seed_test_data: seedTestData
      });

      // Setup complete
      setSetupComplete(true);
      setSetupProgress(seedTestData 
        ? 'Setup complete! Test data loaded. Redirecting...' 
        : 'Setup complete! Redirecting...'
      );
      
      // Reload the app after 2 seconds to re-trigger the setup check in App.jsx
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (err) {
      const msg = err?.message || err?.response?.data?.message || 'Failed to create admin account';
      setError(msg);
      setSetupProgress('');
    } finally {
      setLoading(false);
    }
  };

  // Step 1: Welcome Screen
  if (step === 1) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden animate-slide-up">
            {/* Header */}
            <div className="bg-gradient-to-r from-teal-600 to-teal-700 px-8 py-12 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/20 mb-4">
                <Database className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-white mb-2">Welcome!</h1>
              <p className="text-teal-100">Let's set up SecurManage</p>
            </div>

            {/* Content */}
            <div className="p-8">
              <div className="space-y-4 mb-8">
                {/* Ready Items */}
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full bg-green-100">
                    <Check className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">Database Ready</p>
                    <p className="text-sm text-slate-600">Your database has been initialized automatically</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full bg-green-100">
                    <Check className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">Server Running</p>
                    <p className="text-sm text-slate-600">Backend services are active and ready</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 flex items-center justify-center h-6 w-6 rounded-full bg-green-100">
                    <Check className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">Ready to Configure</p>
                    <p className="text-sm text-slate-600">Create your administrator account next</p>
                  </div>
                </div>
              </div>

              {/* Info Box */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <p className="text-sm text-blue-900">
                  <span className="font-semibold">📋 Next Step:</span> Create an administrator account to login to SecurManage.
                </p>
              </div>

              {/* Button */}
              <button
                onClick={() => setStep(2)}
                className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors shadow-md"
              >
                Create Admin Account
              </button>

              {/* Footer */}
              <p className="text-xs text-slate-500 text-center mt-4">
                Estimated time: 1 minute
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Step 2: Create Admin Account
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden animate-slide-up">
          {/* Header */}
          <div className="bg-gradient-to-r from-teal-600 to-teal-700 px-8 py-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/20 mb-3">
              <User className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">Create Admin Account</h1>
            <p className="text-teal-100 text-sm mt-1">This will be your login account</p>
          </div>

          {/* Content */}
          <div className="p-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Error Message */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              {/* Success Message */}
              {setupComplete && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex gap-3">
                  <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-green-700">Setup Complete!</p>
                    <p className="text-sm text-green-600">Redirecting to login...</p>
                  </div>
                </div>
              )}

              {/* Progress Message */}
              {setupProgress && !setupComplete && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
                  <Loader className="w-5 h-5 text-blue-600 flex-shrink-0 animate-spin" />
                  <p className="text-sm text-blue-700">{setupProgress}</p>
                </div>
              )}

              {/* Full Name Field */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => {
                    setFormData({...formData, fullName: e.target.value});
                    if (formErrors.fullName) {
                      setFormErrors({...formErrors, fullName: ''});
                    }
                  }}
                  placeholder="Your Name"
                  className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all ${
                    formErrors.fullName ? 'border-red-300 bg-red-50' : 'border-slate-300'
                  }`}
                  disabled={loading || setupComplete}
                />
                {formErrors.fullName && (
                  <p className="text-xs text-red-600 mt-1">{formErrors.fullName}</p>
                )}
              </div>

              {/* Email Field */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    Email Address
                  </div>
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => {
                    setFormData({...formData, email: e.target.value});
                    if (formErrors.email) {
                      setFormErrors({...formErrors, email: ''});
                    }
                  }}
                  placeholder="admin@company.com"
                  className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all ${
                    formErrors.email ? 'border-red-300 bg-red-50' : 'border-slate-300'
                  }`}
                  disabled={loading || setupComplete}
                />
                {formErrors.email && (
                  <p className="text-xs text-red-600 mt-1">{formErrors.email}</p>
                )}
              </div>

              {/* Password Field */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    Password
                  </div>
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => {
                    setFormData({...formData, password: e.target.value});
                    if (formErrors.password) {
                      setFormErrors({...formErrors, password: ''});
                    }
                  }}
                  placeholder="••••••••"
                  className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all ${
                    formErrors.password ? 'border-red-300 bg-red-50' : 'border-slate-300'
                  }`}
                  disabled={loading || setupComplete}
                />
                {formErrors.password && (
                  <p className="text-xs text-red-600 mt-1">{formErrors.password}</p>
                )}
                <p className="text-xs text-slate-500 mt-1">At least 6 characters</p>
              </div>

              {/* Confirm Password Field */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={formData.confirm_password}
                  onChange={(e) => {
                    setFormData({...formData, confirm_password: e.target.value});
                    if (formErrors.confirm_password) {
                      setFormErrors({...formErrors, confirm_password: ''});
                    }
                  }}
                  placeholder="••••••••"
                  className={`w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all ${
                    formErrors.confirm_password ? 'border-red-300 bg-red-50' : 'border-slate-300'
                  }`}
                  disabled={loading || setupComplete}
                />
                {formErrors.confirm_password && (
                  <p className="text-xs text-red-600 mt-1">{formErrors.confirm_password}</p>
                )}
              </div>

              {/* Test Data Checkbox */}
              <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={seedTestData}
                    onChange={(e) => setSeedTestData(e.target.checked)}
                    disabled={loading || setupComplete}
                    className="mt-1 w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <PackageOpen className="w-4 h-4 text-slate-600" />
                      <span className="text-sm font-medium text-slate-700">Load sample data</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Add 20 sample clients with test data for demo purposes. You can delete them later from the Clients page.
                    </p>
                  </div>
                </label>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading || setupComplete}
                className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-slate-400 text-white font-semibold py-3 px-4 rounded-lg transition-colors mt-2 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Creating Account...
                  </>
                ) : setupComplete ? (
                  <>
                    <Check className="w-4 h-4" />
                    Complete!
                  </>
                ) : (
                  'Create Admin Account'
                )}
              </button>
            </form>

            {/* Info Box */}
            <div className="bg-slate-50 rounded-lg p-4 text-xs text-slate-600 mt-6 border border-slate-200">
              <p className="font-semibold text-slate-700 mb-2">💡 Tip:</p>
              <p className="mb-2">You'll use this email and password to login to SecurManage.</p>
              <p className="text-slate-500">Keep them safe and secure!</p>
            </div>

            {/* Back Button */}
            <button
              onClick={() => setStep(1)}
              disabled={loading || setupComplete}
              className="w-full mt-4 text-slate-600 hover:text-slate-800 font-medium text-sm py-2 disabled:opacity-50"
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
