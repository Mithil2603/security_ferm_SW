import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ShieldAlert, Lock, Mail, Loader2, Wifi } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNetworkSetup, setShowNetworkSetup] = useState(false);
  const [serverIP, setServerIP] = useState(localStorage.getItem('serverIP') || '');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      const errorMsg = typeof err === 'string' ? err : (err?.message || err?.error || err?.response?.data?.message || 'Login failed. Please check your credentials.');
      setError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        
        <div className="text-center mb-10 animate-slide-up">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-teal-500 shadow-lg shadow-teal-500/30 mb-6">
            <ShieldAlert className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-3xl font-bold text-white tracking-tight">SecurManage</h2>
          <p className="text-slate-400 mt-2">Enterprise Security Agency Platform</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl overflow-hidden animate-slide-up" style={{ animationDelay: '0.1s' }}>
          <div className="p-8">
            <h3 className="text-xl font-semibold text-slate-800 mb-6">Sign in to your account</h3>
            
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-lg flex items-start text-red-600 text-sm">
                <span className="block sm:inline">{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
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
                    className="block w-full pl-10 pr-3 py-2.5 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-shadow bg-slate-50 focus:bg-white"
                    placeholder="admin@securityfirm.com"
                  />
                </div>
              </div>

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
                    className="block w-full pl-10 pr-3 py-2.5 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-shadow bg-slate-50 focus:bg-white"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 transition-colors disabled:opacity-70"
              >
                {isSubmitting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  'Sign In'
                )}
              </button>
            </form>
          </div>
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
              <p className="text-sm text-slate-500 mb-4">
                If you are connecting to the main computer over WiFi, enter its IP address here. Leave blank for the main computer.
              </p>
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
