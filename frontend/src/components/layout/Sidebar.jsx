import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { 
  LayoutDashboard, 
  Users, 
  UserSquare2, 
  CalendarCheck, 
  FileText, 
  Banknote, 
  Receipt,
  PieChart,
  Settings,
  Archive,
  Wallet,
  BookOpen,
  BarChart3,
  Landmark,
  RefreshCw,
  Layers,
  ClipboardCheck,
  Calculator,
  Shield,
  Zap,
  Activity,
  HelpCircle,
  X,
  Target
} from 'lucide-react';
import classNames from 'classnames';

const navItems = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard, roles: ['admin', 'manager', 'accountant', 'employee'] },
  { name: 'Clients', path: '/clients', icon: Users, roles: ['admin', 'manager'] },
  { name: 'Employees', path: '/employees', icon: UserSquare2, roles: ['admin', 'manager'] },
  { name: 'Invoicing', path: '/invoices', icon: FileText, roles: ['admin', 'accountant'] },
  { name: 'Payroll', path: '/payroll', icon: Banknote, roles: ['admin', 'accountant'] },
  { name: 'Employee Ledger', path: '/ledger', icon: Banknote, roles: ['admin', 'accountant', 'manager'] },
  { name: 'Expenses', path: '/expenses', icon: Receipt, roles: ['admin', 'accountant', 'manager'] },
  { name: 'Vendor Ledger', path: '/vendor-statements', icon: FileText, roles: ['admin', 'accountant', 'manager'] },
  { name: 'Reports', path: '/reports', icon: PieChart, roles: ['admin', 'manager', 'accountant'] },
  { name: 'Tax Reports', path: '/tax-reports', icon: Receipt, roles: ['admin', 'manager', 'accountant'] },
  { name: 'PF & Gratuity', path: '/pf-gratuity', icon: Shield, roles: ['admin', 'accountant'] },
  { name: 'GST Compliance', path: '/gst-compliance', icon: FileText, roles: ['admin', 'accountant'] },
  { name: 'Financial Reports', path: '/financial-reports', icon: BarChart3, roles: ['admin', 'accountant'] },
  { name: 'Workflows', path: '/workflows', icon: Zap, roles: ['admin'] },
  { name: 'Statement Archive', path: '/statements', icon: Archive, roles: ['admin', 'manager', 'accountant'] },
  { name: 'P&L Account', path: '/pl-account', icon: Wallet, roles: ['admin'] },
  { name: 'Balance Sheet', path: '/balance-sheet', icon: BarChart3, roles: ['admin', 'accountant'] },
  { name: 'Vouchers', path: '/vouchers', icon: BookOpen, roles: ['admin', 'accountant'] },
  { name: 'Bank Reconciliation', path: '/bank-reconciliation', icon: Landmark, roles: ['admin', 'accountant'] },
  { name: 'Budgets vs Actuals', path: '/budgets', icon: Target, roles: ['admin', 'accountant'] },
  { name: 'divider' },
  { name: 'Audit Logs', path: '/audit-logs', icon: Activity, roles: ['admin'] },
  { name: 'Settings', path: '/settings', icon: Settings, roles: ['admin'] },
  { name: 'Help', path: '/help', icon: HelpCircle, roles: ['admin', 'manager', 'accountant', 'employee'] },
];

export default function Sidebar({ mobileMenuOpen, setMobileMenuOpen }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const filteredNav = navItems.filter(item => item.name === 'divider' || item.roles.includes(user?.role));

  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then(v => setAppVersion(v));
    }
  }, []);

  return (
    <>
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 z-40 bg-slate-900/80 backdrop-blur-sm md:hidden animate-fade-in"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar container */}
      <div className={classNames(
        "fixed inset-y-0 left-0 z-50 w-64 h-full bg-slate-900 border-r border-slate-800 flex flex-col transition-transform duration-300 ease-in-out md:relative md:translate-x-0",
        mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex items-center justify-between h-16 bg-slate-950 px-4 shadow-sm">
          <div className="flex items-center space-x-3">
            <div 
              className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center shadow-lg shadow-teal-500/20 cursor-pointer"
              onDoubleClick={() => {
                setMobileMenuOpen(false);
                navigate('/developer');
              }}
              title="SecurManage"
            >
              <span className="text-white font-bold text-xl leading-none select-none">S</span>
            </div>
            <span className="text-white font-bold text-lg tracking-wide uppercase">SecurManage</span>
          </div>
          <button 
            className="md:hidden text-slate-400 hover:text-white"
            onClick={() => setMobileMenuOpen(false)}
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex flex-col flex-1 overflow-y-auto">
          <nav className="flex-1 px-3 py-6 space-y-1">
            {filteredNav.map((item, idx) => {
              if (item.name === 'divider') {
                return <hr key={`div-${idx}`} className="my-3 border-slate-700/50" />;
              }
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.name}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) => classNames(
                    isActive ? 'bg-teal-500/10 text-teal-400 border-r-2 border-teal-500' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                    'group flex items-center px-3 py-2.5 text-sm font-medium rounded-l-lg transition-all duration-200 ease-in-out'
                  )}
                >
                  <Icon className={classNames('mr-3 flex-shrink-0 h-5 w-5 transition-colors')} aria-hidden="true" />
                  {item.name}
                </NavLink>
              );
            })}
          </nav>
          {appVersion && (
            <div className="px-4 py-3 border-t border-slate-800">
              <p className="text-xs text-slate-500 text-center">v{appVersion}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
