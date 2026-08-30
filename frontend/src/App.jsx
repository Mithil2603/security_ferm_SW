import { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
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
      if (window.electronAPI && window.electronAPI.saveDbConfig) {
        await window.electronAPI.saveDbConfig(dbConfig);
        setConfigMsg('Settings saved! Retrying connection...');
        setTimeout(() => {
          setSetupStatus('checking');
          checkSetupStatus();
        }, 1000);
      } else {
        setConfigMsg('Saved settings. Please click Retry Connection.');
      }
    } catch (err) {
      setConfigMsg('Failed to save settings: ' + err.message);
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
                className="px-6 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg transition-colors shadow-md w-full"
              >
                Retry Connection
              </button>
              <button
                onClick={() => setShowDbConfig(true)}
                className="px-6 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium rounded-lg transition-colors text-sm w-full"
              >
                Configure MySQL Credentials
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.electronAPI && window.electronAPI.openLogFolder) {
                    window.electronAPI.openLogFolder();
                  }
                }}
                className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 font-medium rounded-lg transition-colors text-xs w-full border border-slate-700"
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
              {configMsg && <div className="text-xs text-teal-400 mt-2">{configMsg}</div>}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowDbConfig(false)} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-xs w-1/2 font-medium">Cancel</button>
                <button type="submit" disabled={isSavingConfig} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs w-1/2 font-medium">{isSavingConfig ? 'Saving...' : 'Save & Connect'}</button>
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
            <Route path="/clients" element={<Clients />} />
            <Route path="/employees" element={<Employees />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/payroll" element={<Payroll />} />
            <Route path="/ledger" element={<Ledger />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/vendor-statements" element={<VendorStatements />} />
            <Route path="/budgets" element={<Budgets />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/tax-reports" element={<TaxReports />} />
            <Route path="/tax-calculator" element={<TaxCalculator />} />
            <Route path="/pf-gratuity" element={<PFGratuity />} />
            <Route path="/gst-compliance" element={<GSTCompliance />} />
            <Route path="/financial-reports" element={<FinancialReports />} />
            <Route path="/workflows" element={<Workflows />} />
            <Route path="/statements" element={<StatementArchive />} />
            <Route path="/pl-account" element={<PLAccount />} />
            <Route path="/vouchers" element={<Vouchers />} />
            <Route path="/balance-sheet" element={<BalanceSheet />} />
            <Route path="/bank-reconciliation" element={<BankReconciliation />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/audit-logs" element={<AuditLogs />} />
            <Route path="/help" element={<HelpDocumentation />} />
          </Route>
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;

