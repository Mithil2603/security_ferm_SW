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
import { getApiBaseUrl } from './utils/apiUrl';

function App() {
  const [licenseStatus, setLicenseStatus] = useState('checking'); // 'checking' | 'unlicensed' | 'licensed'
  const [setupStatus, setSetupStatus] = useState('checking'); // 'checking' | 'needs-setup' | 'complete'

  useEffect(() => {
    checkLicense();
  }, []);

  const checkLicense = async () => {
    try {
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/license/status`);
      const data = await response.json();
      
      if (data.success && data.licensed) {
        setLicenseStatus('licensed');
        // After license is confirmed, check setup status
        checkSetupStatus();
      } else {
        setLicenseStatus('unlicensed');
      }
    } catch (err) {
      // If server isn't ready yet, retry after a short delay
      setTimeout(() => {
        checkLicense();
      }, 1500);
    }
  };

  const checkSetupStatus = async () => {
    try {
      const baseUrl = getApiBaseUrl();
      const response = await fetch(`${baseUrl}/auth/setup-status`);
      const data = await response.json();
      
      if (data.success && data.setupComplete) {
        setSetupStatus('complete');
      } else {
        setSetupStatus('needs-setup');
      }
    } catch (err) {
      // If setup-status check fails, assume setup is complete (safe fallback for existing installs)
      console.warn('Setup status check failed, assuming complete:', err.message);
      setSetupStatus('complete');
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

  // Show Setup Wizard if first-time install (no admin exists)
  if (setupStatus === 'needs-setup') {
    return <Setup />;
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

