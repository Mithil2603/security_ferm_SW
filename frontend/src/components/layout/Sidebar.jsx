import { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
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
  ClipboardList,
  Shield,
  Zap,
  Activity,
  HelpCircle,
  X,
  Target,
  Truck,
  Building2,
  CreditCard,
  ChevronDown
} from 'lucide-react';
import classNames from 'classnames';

// Flat, standalone entries that sit above/below the collapsible groups.
const topItems = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard, roles: ['admin', 'manager', 'accountant', 'employee'] },
];

const bottomItems = [
  { name: 'Help', path: '/help', icon: HelpCircle, roles: ['admin', 'manager', 'accountant', 'employee'] },
];

// Everything else, grouped so the sidebar reads as a handful of categories
// instead of one long undifferentiated list — each group collapses/expands
// independently, and the group containing the current page auto-expands.
const navGroups = [
  {
    key: 'hr',
    label: 'HR & Workforce',
    icon: UserSquare2,
    children: [
      { name: 'Employees', path: '/employees', icon: UserSquare2, roles: ['admin', 'manager'], permission: 'manage_employees' },
      { name: 'Attendance', path: '/attendance', icon: CalendarCheck, roles: ['admin', 'manager', 'accountant'], permission: 'manage_employees' },
      { name: 'Payroll', path: '/payroll', icon: Banknote, roles: ['admin', 'accountant'], permission: 'manage_payroll' },
      { name: 'Employee Ledger', path: '/ledger', icon: Banknote, roles: ['admin', 'accountant', 'manager'], permission: 'manage_payroll' },
      { name: 'PF & Gratuity', path: '/pf-gratuity', icon: Shield, roles: ['admin', 'accountant'], permission: 'manage_payroll' },
    ],
  },
  {
    key: 'clients',
    label: 'Clients & Billing',
    icon: Users,
    children: [
      { name: 'Clients', path: '/clients', icon: Users, roles: ['admin', 'manager'], permission: 'manage_invoices' },
      { name: 'Invoicing', path: '/invoices', icon: FileText, roles: ['admin', 'accountant'], permission: 'manage_invoices' },
      { name: 'Party Ledger', path: '/party-ledger', icon: BookOpen, roles: ['admin', 'accountant', 'manager'], permission: ['manage_invoices', 'view_reports'] },
    ],
  },
  {
    key: 'vendors',
    label: 'Vendors & Expenses',
    icon: Building2,
    children: [
      { name: 'Vendors', path: '/vendors', icon: Building2, roles: ['admin', 'accountant', 'manager'], permission: 'manage_expenses' },
      { name: 'Purchase Bills', path: '/purchase-orders', icon: ClipboardList, roles: ['admin', 'accountant', 'manager'], permission: 'manage_expenses' },
      { name: 'Vendor Ledger', path: '/vendor-ledger', icon: Truck, roles: ['admin', 'accountant', 'manager'], permission: ['manage_expenses', 'view_reports'] },
      { name: 'Expenses', path: '/expenses', icon: Receipt, roles: ['admin', 'accountant', 'manager'], permission: 'manage_expenses' },
    ],
  },
  {
    key: 'banking',
    label: 'Banking & Accounts',
    icon: Landmark,
    children: [
      { name: 'Bank & Payments', path: '/payments', icon: CreditCard, roles: ['admin', 'accountant', 'manager'], permission: ['manage_invoices', 'manage_expenses', 'manage_payroll', 'manage_vouchers'] },
      { name: 'Vouchers', path: '/vouchers', icon: BookOpen, roles: ['admin', 'accountant'], permission: ['view_vouchers', 'create_vouchers', 'edit_vouchers', 'delete_vouchers', 'approve_vouchers', 'manage_vouchers'] },
      { name: 'Bank Reconciliation', path: '/bank-reconciliation', icon: Landmark, roles: ['admin', 'accountant'], permission: 'manage_bank_reconciliation' },
    ],
  },
  {
    key: 'reports',
    label: 'Reports & Compliance',
    icon: PieChart,
    children: [
      { name: 'Reports', path: '/reports', icon: PieChart, roles: ['admin', 'manager', 'accountant'], permission: 'view_reports' },
      { name: 'Tax Reports', path: '/tax-reports', icon: Receipt, roles: ['admin', 'manager', 'accountant'], permission: 'view_reports' },
      { name: 'GST Compliance', path: '/gst-compliance', icon: FileText, roles: ['admin', 'accountant'], permission: 'manage_payroll' },
      { name: 'Financial Reports', path: '/financial-reports', icon: BarChart3, roles: ['admin', 'accountant'], permission: 'view_reports' },
      { name: 'P&L Account', path: '/pl-account', icon: Wallet, roles: ['admin'], permission: 'view_pl_account' },
      { name: 'Balance Sheet', path: '/balance-sheet', icon: BarChart3, roles: ['admin', 'accountant'], permission: 'view_balance_sheet' },
      { name: 'Budgets vs Actuals', path: '/budgets', icon: Target, roles: ['admin', 'accountant'], permission: 'manage_budgets' },
      { name: 'Statement Archive', path: '/statements', icon: Archive, roles: ['admin', 'manager', 'accountant'], permission: 'view_reports' },
    ],
  },
  {
    key: 'system',
    label: 'System',
    icon: Settings,
    children: [
      { name: 'Workflows', path: '/workflows', icon: Zap, roles: ['admin'] },
      { name: 'Audit Logs', path: '/audit-logs', icon: Activity, roles: ['admin'], permission: 'manage_settings' },
      { name: 'Settings', path: '/settings', icon: Settings, roles: ['admin'], permission: 'manage_settings' },
    ],
  },
];

export default function Sidebar({ sidebarOpen, setSidebarOpen, mobileMenuOpen, setMobileMenuOpen }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isDrawerOpen = Boolean(sidebarOpen ?? mobileMenuOpen);
  const drawerRef = useRef(null);
  const openTimerRef = useRef(null);
  const closeTimerRef = useRef(null);

  const closeSidebar = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (setSidebarOpen) setSidebarOpen(false);
    if (setMobileMenuOpen) setMobileMenuOpen(false);
  };

  const handleMouseEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (!isDrawerOpen) {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      openTimerRef.current = setTimeout(() => {
        if (setSidebarOpen) setSidebarOpen(true);
        if (setMobileMenuOpen) setMobileMenuOpen(true);
      }, 70);
    }
  };

  const handleMouseLeave = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeSidebar();
    }, 200);
  };

  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const openGroupDrawer = (groupKey) => {
    setOpenGroup(groupKey);
    if (setSidebarOpen) setSidebarOpen(true);
    if (setMobileMenuOpen) setMobileMenuOpen(true);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isDrawerOpen) {
        closeSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawerOpen]);

  // Close when clicking outside drawer on desktop
  useEffect(() => {
    if (!isDrawerOpen) return;
    const handleOutsideClick = (e) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target)) {
        if (e.target.closest('button[title*="Navigation"]')) return;
        closeSidebar();
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isDrawerOpen]);

  const userPerms = Array.isArray(user?.permissions)
    ? user.permissions
    : (typeof user?.permissions === 'string' ? (() => { try { return JSON.parse(user.permissions); } catch (_) { return []; } })() : []);

  const hasAccess = (item) => {
    if (!user) return false;
    if (user.role === 'admin' || userPerms.includes('*')) return true;

    // If item requires a specific permission, user must have that permission
    if (item.permission) {
      if (Array.isArray(item.permission)) {
        return item.permission.some(p => userPerms.includes(p));
      }
      return userPerms.includes(item.permission);
    }

    // Otherwise, check role default
    if (item.roles) {
      return item.roles.includes(user.role);
    }

    return false;
  };

  const filteredTop = topItems.filter(hasAccess);
  const filteredBottom = bottomItems.filter(hasAccess);
  const filteredGroups = navGroups
    .map(g => ({ ...g, children: g.children.filter(hasAccess) }))
    .filter(g => g.children.length > 0);

  // Accordion behavior: only one group open at a time. Navigating to a page
  // opens whichever group contains it (and closes whatever else was open);
  // manually clicking a group's own header toggles it independently of the
  // route, so the group you're currently in can still be collapsed on
  // purpose without snapping back open until you actually navigate again.
  const activeGroupKey = navGroups.find(g => g.children.some(c => c.path === location.pathname))?.key || null;
  const [openGroup, setOpenGroup] = useState(activeGroupKey);

  useEffect(() => {
    setOpenGroup(activeGroupKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const toggleGroup = (key) => {
    setOpenGroup(prev => (prev === key ? null : key));
  };

  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then(v => setAppVersion(v));
    }
  }, []);

  return (
    <>
      {/* Overlay Backdrop - on mobile only */}
      {isDrawerOpen && (
        <div
          className="fixed top-16 inset-x-0 bottom-0 z-40 bg-slate-950/50 backdrop-blur-xs animate-fade-in transition-opacity cursor-pointer md:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Unified Expanding/Collapsing Sidebar */}
      <aside 
        ref={drawerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={classNames(
          "fixed top-16 left-0 bottom-0 z-50 bg-slate-900 border-r border-slate-800 flex flex-col justify-between transition-all duration-300 ease-in-out select-none overflow-x-hidden",
          isDrawerOpen 
            ? "w-72 shadow-2xl shadow-black/50 pointer-events-auto" 
            : "w-0 md:w-16 shadow-none md:shadow-xs pointer-events-none md:pointer-events-auto"
        )}
      >
        <div className="flex flex-col flex-1 min-h-0">
          <nav className={classNames(
            "flex-1 min-h-0 py-3 space-y-1.5 px-3",
            isDrawerOpen ? "overflow-y-auto sidebar-scroll" : "overflow-hidden"
          )}>
            {/* Top standalone items (Dashboard) */}
            {filteredTop.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <NavLink
                  key={item.name}
                  to={item.path}
                  onClick={closeSidebar}
                  title={!isDrawerOpen ? item.name : undefined}
                  className={classNames(
                    'flex items-center h-10 w-full rounded-xl transition-colors duration-200 select-none group cursor-pointer',
                    isActive 
                      ? 'bg-teal-500/15 text-teal-400 font-semibold' 
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  )}
                >
                  <div className="w-10 h-10 flex items-center justify-center shrink-0">
                    <Icon className="h-4.5 w-4.5 transition-colors" />
                  </div>
                  <span className={classNames(
                    "ml-1 text-sm font-medium truncate whitespace-nowrap transition-opacity duration-200",
                    isDrawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                  )}>
                    {item.name}
                  </span>
                </NavLink>
              );
            })}

            {/* Divider */}
            {filteredGroups.length > 0 && (
              <div className="w-full border-t border-slate-800/80 my-2" />
            )}

            {/* Nav Groups */}
            {filteredGroups.map(group => {
              const GroupIcon = group.icon;
              const hasActiveChild = group.children.some(c => c.path === location.pathname);
              const isGroupOpen = openGroup === group.key;

              return (
                <div key={group.key} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isDrawerOpen) {
                        openGroupDrawer(group.key);
                      } else {
                        toggleGroup(group.key);
                      }
                    }}
                    title={!isDrawerOpen ? group.label : undefined}
                    className={classNames(
                      'flex items-center h-10 w-full rounded-xl transition-colors duration-200 select-none group cursor-pointer',
                      hasActiveChild || (isDrawerOpen && isGroupOpen)
                        ? 'bg-teal-500/15 text-teal-400 font-semibold'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    )}
                  >
                    <div className="w-10 h-10 flex items-center justify-center shrink-0">
                      <GroupIcon className="h-4.5 w-4.5 transition-colors" />
                    </div>
                    <span className={classNames(
                      "ml-1 text-xs font-bold uppercase tracking-wider truncate whitespace-nowrap transition-opacity duration-200",
                      isDrawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                    )}>
                      {group.label}
                    </span>
                    <ChevronDown className={classNames(
                      "ml-auto mr-1 h-4 w-4 shrink-0 transition-all duration-200",
                      isDrawerOpen ? "opacity-100" : "opacity-0 pointer-events-none",
                      isGroupOpen ? "rotate-180" : ""
                    )} />
                  </button>

                  {/* Accordion Sub-items */}
                  <div className={classNames(
                    "overflow-hidden transition-all duration-200 space-y-1",
                    isDrawerOpen && isGroupOpen ? "max-h-96 opacity-100 my-1" : "max-h-0 opacity-0 pointer-events-none"
                  )}>
                    {group.children.map(child => {
                      const ChildIcon = child.icon;
                      const isChildActive = location.pathname === child.path;
                      return (
                        <NavLink
                          key={child.name}
                          to={child.path}
                          onClick={closeSidebar}
                          className={classNames(
                            'flex items-center h-8 pl-9 pr-2.5 rounded-lg text-xs font-medium transition-colors select-none whitespace-nowrap group',
                            isChildActive
                              ? 'bg-teal-500/15 text-teal-400 font-semibold border-r-2 border-teal-500'
                              : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
                          )}
                        >
                          <ChildIcon className="h-4 w-4 shrink-0 mr-2.5 transition-colors" />
                          <span className="truncate">{child.name}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* Bottom links (Help) */}
          <div className="shrink-0 px-3 py-3 border-t border-slate-800/80 space-y-1.5">
            {filteredBottom.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <NavLink
                  key={item.name}
                  to={item.path}
                  onClick={closeSidebar}
                  title={!isDrawerOpen ? item.name : undefined}
                  className={classNames(
                    'flex items-center h-10 w-full rounded-xl transition-colors duration-200 select-none group cursor-pointer',
                    isActive 
                      ? 'bg-teal-500/15 text-teal-400 font-semibold' 
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  )}
                >
                  <div className="w-10 h-10 flex items-center justify-center shrink-0">
                    <Icon className="h-4.5 w-4.5 transition-colors" />
                  </div>
                  <span className={classNames(
                    "ml-1 text-sm font-medium truncate whitespace-nowrap transition-opacity duration-200",
                    isDrawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                  )}>
                    {item.name}
                  </span>
                </NavLink>
              );
            })}

            {appVersion && (
              <div className="pt-1.5 text-center overflow-hidden">
                <p className="text-[10px] text-slate-500 font-mono whitespace-nowrap">
                  {isDrawerOpen ? `SecurManage v${appVersion}` : `v${appVersion}`}
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
