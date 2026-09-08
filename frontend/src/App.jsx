import { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/layout/Layout';
import './services/errorInterceptor'; // Import to initialize
import LicenseActivation from './pages/LicenseActivation';
import Setup from './pages/Setup';

// Pages
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import Employees from './pages/Employees';
import Attendance from './pages/Attendance';
import Invoices from './pages/Invoices';
import Payroll from './pages/Payroll';
import Ledger from './pages/Ledger';
import AccountLedger from './pages/AccountLedger';
import Expenses from './pages/Expenses';
import VendorStatements from './pages/VendorStatements';
import Reports from './pages/Reports';
import TaxReports from './pages/TaxReports';
import Settings from './pages/Settings';
import StatementArchive from './pages/StatementArchive';
import PLAccount from './pages/PLAccount';
import Vouchers from './pages/Vouchers';
import BalanceSheet from './pages/BalanceSheet';
import Budgets from './pages/Budgets';
import BankReconciliation from './pages/BankReconciliation';
import TaxCalculator from './pages/TaxCalculator';
import PFGratuity from './pages/PFGratuity';
import GSTCompliance from './pages/GSTCompliance';
import FinancialReports from './pages/FinancialReports';
import Workflows from './pages/Workflows';
import DeveloperConsole from './pages/DeveloperConsole';
import AuditLogs from './pages/AuditLogs';
import HelpDocumentation from './pages/HelpDocumentation';
import SketchbookOfUsPreview from './pages/SketchbookOfUsPreview';
import { getApiBaseUrl } from './utils/apiUrl';

function ProtectedRoute({ children, permission, role }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-64 w-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-teal-500"></div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin') return children;

  const userPerms = Array.isArray(user.permissions)
    ? user.permissions
    : (typeof user.permissions === 'string' ? (() => { try { return JSON.parse(user.permissions); } catch (_) { return []; } })() : []);

  if (userPerms.includes('*')) return children;

  if (permission) {
    const required = Array.isArray(permission) ? permission : [permission];
    const hasAny = required.some(p => userPerms.includes(p));
    if (!hasAny) {
      return <Navigate to="/" replace />;
    }
  }
  if (role && user.role !== role) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function App() {
  const [licenseStatus, setLicenseStatus] = useState('checking'); // 'checking' | 'unlicensed' | 'licensed'
  const [setupStatus, setSetupStatus] = useState('checking'); // 'checking' | 'needs-setup' | 'complete'
  const [showDbConfig, setShowDbConfig] = useState(false);
  const [dbConfig, setDbConfig] = useState({
    host: '127.0.0.1',
    port: '3306',
    user: 'root',
    password: '',
    database: 'security_firm_db'
  });
  const [configMsg, setConfigMsg] = useState('');
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  useEffect(() => {
    checkLicense();
  }, []);

  const checkLicense = async () => {
    setLicenseStatus('licensed');
    checkSetupStatus();
  };

  const checkSetupStatus = async () => {
    try {
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/auth/setup-status`);
      const data = await response.json();
      
      if (data.success && data.setupComplete) {
        setSetupStatus('complete');
      } else if (data.success && !data.setupComplete) {
        setSetupStatus('needs-setup');
      } else {
        setSetupStatus('error');
      }
    } catch (err) {
      console.warn('Setup status check failed:', err.message);
      setSetupStatus('error');
    }
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setConfigMsg('');
    try {
      let success = false;
      let errorMsg = '';

      // 1. Try Electron IPC if available
      if (window.electronAPI && window.electronAPI.saveDbConfig) {
        try {
          const ipcRes = await window.electronAPI.saveDbConfig(dbConfig);
          if (ipcRes && ipcRes.success) {
            success = true;
          } else if (ipcRes && ipcRes.error) {
            errorMsg = ipcRes.error;
          }
        } catch (ipcErr) {
          errorMsg = ipcErr.message;
        }
      }

      // 2. Also call backend HTTP API endpoint to ensure Express server & root .env are updated
      try {
        const baseUrl = getApiBaseUrl();
        const res = await fetch(`${baseUrl}/auth/configure-db`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dbConfig)
        });
        const data = await res.json();
        if (data && data.success) {
          success = true;
        } else if (data && data.message) {
          if (!success) errorMsg = data.message;
        }
      } catch (fetchErr) {
        if (!success && !errorMsg) {
          errorMsg = fetchErr.message;
        }
      }

      if (success) {
        setConfigMsg('✅ Connected to MySQL successfully! Initializing...');
        setTimeout(() => {
          setSetupStatus('checking');
          checkSetupStatus();
        }, 1000);
      } else {
        setConfigMsg('❌ ' + (errorMsg || 'Could not connect with provided credentials.'));
      }
    } catch (err) {
      setConfigMsg('❌ ' + err.message);
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Show a loading spinner while checking license
  if (licenseStatus === 'checking') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400 text-sm">Verifying license...</p>
        </div>
      </div>
    );
  }

  // Show license activation screen if not licensed
  if (licenseStatus === 'unlicensed') {
    return (
      <LicenseActivation
        onActivated={() => {
          setLicenseStatus('licensed');
          checkSetupStatus();
        }}
      />
    );
  }

  // Show loading spinner while checking setup status
  if (setupStatus === 'checking') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400 text-sm">Initializing...</p>
        </div>
      </div>
    );
  }

  // Show retryable error state if setup check failed
  if (setupStatus === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="text-center text-white max-w-md w-full bg-slate-800/80 p-8 rounded-2xl border border-slate-700 shadow-xl">
          <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto mb-4 font-bold text-xl">
            !
          </div>
          <h3 className="text-xl font-bold mb-2">Connection Error</h3>
          <p className="text-slate-400 text-sm mb-6">
            Could not reach the database. Ensure MySQL is running on your computer.
          </p>

          {!showDbConfig ? (
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  setSetupStatus('checking');
                  checkSetupStatus();
                }}
                className="px-6 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg transition-colors shadow-md w-full cursor-pointer"
              >
                Retry Connection
              </button>
              <button
                onClick={() => setShowDbConfig(true)}
                className="px-6 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium rounded-lg transition-colors text-sm w-full cursor-pointer"
              >
                Configure MySQL Credentials
              </button>
              <button
                type="button"
                onClick={async () => {
                  let opened = false;
                  if (window.electronAPI && window.electronAPI.openLogFolder) {
                    try {
                      const res = await window.electronAPI.openLogFolder();
                      if (res && res.success) opened = true;
                    } catch (_) {}
                  }
                  if (!opened) {
                    try {
                      const baseUrl = getApiBaseUrl();
                      await fetch(`${baseUrl}/auth/open-log-folder`, { method: 'POST' });
                    } catch (err) {
                      console.error('Failed to open log folder:', err);
                    }
                  }
                }}
                className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 font-medium rounded-lg transition-colors text-xs w-full border border-slate-700 cursor-pointer"
              >
                📂 Open Log Folder
              </button>
            </div>
          ) : (
            <form onSubmit={handleSaveConfig} className="text-left space-y-3 mt-4 bg-slate-900/60 p-4 rounded-xl border border-slate-700">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">MySQL Host</label>
                <input type="text" value={dbConfig.host} onChange={e => setDbConfig({...dbConfig, host: e.target.value})} className="w-full px-3 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-teal-500" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">User</label>
                  <input type="text" value={dbConfig.user} onChange={e => setDbConfig({...dbConfig, user: e.target.value})} className="w-full px-3 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-teal-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Port</label>
                  <input type="text" value={dbConfig.port} onChange={e => setDbConfig({...dbConfig, port: e.target.value})} className="w-full px-3 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-teal-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">MySQL Password</label>
                <input type="password" value={dbConfig.password} onChange={e => setDbConfig({...dbConfig, password: e.target.value})} placeholder="Enter MySQL Password" className="w-full px-3 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-teal-500" />
              </div>
              {configMsg && (
                <div className={`text-xs p-2.5 rounded ${configMsg.startsWith('✅') ? 'text-teal-300 bg-teal-900/40 border border-teal-700/60' : 'text-rose-300 bg-rose-900/40 border border-rose-700/60'} mt-2 break-words`}>
                  {configMsg}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => { setShowDbConfig(false); setConfigMsg(''); }} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-xs w-1/2 font-medium cursor-pointer">Cancel</button>
                <button type="submit" disabled={isSavingConfig} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs w-1/2 font-medium disabled:opacity-50 cursor-pointer">{isSavingConfig ? 'Testing & Saving...' : 'Save & Connect'}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  // Show Setup Wizard if first-time install (no admin exists)
  if (setupStatus === 'needs-setup') {
    return <Setup onSetupComplete={() => setSetupStatus('complete')} />;
  }

  // Licensed & setup complete — show the full app
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:token" element={<ResetPassword />} />
          <Route path="/developer" element={<DeveloperConsole />} />
          <Route path="/sketchbook" element={<SketchbookOfUsPreview />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/clients" element={<ProtectedRoute permission="manage_invoices"><Clients /></ProtectedRoute>} />
            <Route path="/employees" element={<ProtectedRoute permission="manage_employees"><Employees /></ProtectedRoute>} />
            <Route path="/attendance" element={<ProtectedRoute permission={['manage_employees', 'manage_payroll']}><Attendance /></ProtectedRoute>} />
            <Route path="/invoices" element={<ProtectedRoute permission="manage_invoices"><Invoices /></ProtectedRoute>} />
            <Route path="/payroll" element={<ProtectedRoute permission="manage_payroll"><Payroll /></ProtectedRoute>} />
            <Route path="/ledger" element={<ProtectedRoute permission="manage_payroll"><Ledger /></ProtectedRoute>} />
            <Route path="/account-ledger" element={<ProtectedRoute permission="view_reports"><AccountLedger /></ProtectedRoute>} />
            <Route path="/party-ledger" element={<Navigate to="/account-ledger" replace />} />
            <Route path="/expenses" element={<ProtectedRoute permission="manage_expenses"><Expenses /></ProtectedRoute>} />
            <Route path="/vendor-statements" element={<ProtectedRoute permission="manage_expenses"><VendorStatements /></ProtectedRoute>} />
            <Route path="/vendor-ledger" element={<Navigate to="/vendor-statements" replace />} />
            <Route path="/budgets" element={<ProtectedRoute permission="manage_budgets"><Budgets /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute permission="view_reports"><Reports /></ProtectedRoute>} />
            <Route path="/tax-reports" element={<ProtectedRoute permission="view_reports"><TaxReports /></ProtectedRoute>} />
            <Route path="/tax-calculator" element={<Navigate to="/tax-reports" replace />} />
            <Route path="/pf-gratuity" element={<ProtectedRoute permission="manage_payroll"><PFGratuity /></ProtectedRoute>} />
            <Route path="/gst-compliance" element={<ProtectedRoute permission="manage_payroll"><GSTCompliance /></ProtectedRoute>} />
            <Route path="/financial-reports" element={<ProtectedRoute permission="view_reports"><FinancialReports /></ProtectedRoute>} />
            <Route path="/workflows" element={<ProtectedRoute role="admin"><Workflows /></ProtectedRoute>} />
            <Route path="/statements" element={<ProtectedRoute permission="view_reports"><StatementArchive /></ProtectedRoute>} />
            <Route path="/pl-account" element={<ProtectedRoute permission="view_pl_account"><PLAccount /></ProtectedRoute>} />
            <Route path="/vouchers" element={<ProtectedRoute permission={['view_vouchers', 'create_vouchers', 'edit_vouchers', 'delete_vouchers', 'approve_vouchers', 'manage_vouchers']}><Vouchers /></ProtectedRoute>} />
            <Route path="/balance-sheet" element={<ProtectedRoute permission="view_balance_sheet"><BalanceSheet /></ProtectedRoute>} />
            <Route path="/bank-reconciliation" element={<ProtectedRoute permission="manage_bank_reconciliation"><BankReconciliation /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute permission="manage_settings"><Settings /></ProtectedRoute>} />
            <Route path="/audit-logs" element={<ProtectedRoute permission="manage_settings"><AuditLogs /></ProtectedRoute>} />
            <Route path="/help" element={<HelpDocumentation />} />
          </Route>
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;

