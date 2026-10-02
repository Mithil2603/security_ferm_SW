import { useAuth } from '../../context/AuthContext';
import { LogOut, Bell, AlertTriangle, XCircle, Info, ChevronRight, Menu } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import api from '../../services/api';

const severityConfig = {
  critical: { bg: 'bg-red-50',    border: 'border-red-200',   icon: XCircle,       iconColor: 'text-red-500',    badge: 'bg-red-500' },
  high:     { bg: 'bg-amber-50',  border: 'border-amber-200', icon: AlertTriangle, iconColor: 'text-amber-500',  badge: 'bg-amber-500' },
  medium:   { bg: 'bg-blue-50',   border: 'border-blue-200',  icon: Info,          iconColor: 'text-blue-500',   badge: 'bg-blue-400' },
  low:      { bg: 'bg-slate-50',  border: 'border-slate-200', icon: Info,          iconColor: 'text-slate-400',  badge: 'bg-slate-400' },
};

import { getServerBaseUrl } from '../../utils/apiUrl';

function getAgencyInitials(name) {
  if (!name || typeof name !== 'string') return 'SM';
  const trimmed = name.trim();
  if (!trimmed) return 'SM';

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  const capitals = trimmed.match(/[A-Z]/g);
  if (capitals && capitals.length >= 2) {
    return (capitals[0] + capitals[1]).toUpperCase();
  }

  return trimmed.slice(0, 2).toUpperCase();
}

export default function Topbar({ sidebarOpen, setSidebarOpen, setMobileMenuOpen }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [agencySettings, setAgencySettings] = useState({ agency_name: 'SecurManage', agency_logo_url: '' });
  const [logoError, setLogoError] = useState(false);
  const dropdownRef = useRef(null);

  const toggleSidebar = () => {
    if (setSidebarOpen) {
      setSidebarOpen(prev => !prev);
    } else if (setMobileMenuOpen) {
      setMobileMenuOpen(prev => !prev);
    }
  };

  useEffect(() => {
    api.get('/reports/alerts').then(res => {
      if (res.success) setAlerts(res.alerts || []);
    }).catch(() => {});

    api.get('/settings/system/agency_settings')
      .then(res => {
        if (res?.data) {
          const parsed = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          if (parsed && typeof parsed === 'object') {
            setAgencySettings(prev => ({
              ...prev,
              ...parsed,
              agency_name: parsed.agency_name || parsed.company_name || prev.agency_name,
              agency_logo_url: parsed.agency_logo_url || prev.agency_logo_url
            }));
          }
        }
      })
      .catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setAlertsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = () => { logout(); navigate('/login'); };

  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const badgeCount    = alerts.length;

  return (
    <header className="flex items-center justify-between h-16 px-4 md:px-6 border-b border-slate-800 bg-slate-900 sticky top-0 z-30 shadow-sm">
      {/* Left: Menu Icon + Agency Profile Pic + Name of the Agency */}
      <div className="flex items-center gap-3.5">
        <button 
          className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 transition-colors border border-slate-700/80 shadow-2xs group cursor-pointer"
          onClick={toggleSidebar}
          title={sidebarOpen ? "Collapse Navigation" : "Expand Navigation"}
          type="button"
        >
          <Menu className="w-5 h-5 text-teal-400 group-hover:scale-105 transition-transform" />
        </button>

        <div 
          className="flex items-center gap-3 cursor-pointer select-none group" 
          onClick={() => navigate('/')}
          title={`${agencySettings.agency_name || 'SecurManage'} Dashboard`}
        >
          {agencySettings.agency_logo_url && !logoError ? (
            <img
              src={`${getServerBaseUrl()}${agencySettings.agency_logo_url}`}
              alt={agencySettings.agency_name || "Agency Logo"}
              onError={() => setLogoError(true)}
              className="h-9 w-auto max-h-9 max-w-[120px] object-contain shrink-0 group-hover:scale-105 transition-transform"
            />
          ) : (
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white font-extrabold text-xs tracking-wider shadow-sm shrink-0 group-hover:scale-105 transition-transform">
              {getAgencyInitials(agencySettings.agency_name)}
            </div>
          )}
          <span className="text-white font-extrabold text-base tracking-wide whitespace-nowrap">
            {agencySettings.agency_name || 'SecurManage'}
          </span>
        </div>
      </div>

      <div className="flex items-center space-x-4 md:space-x-6">
        {/* Alert Bell */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setAlertsOpen(!alertsOpen)}
            className="relative text-slate-300 hover:text-white transition-colors p-2 rounded-full hover:bg-slate-800"
          >
            <Bell className={`w-5 h-5 ${criticalCount > 0 ? 'animate-pulse text-rose-400' : ''}`} />
            {badgeCount > 0 && (
              <span className={`absolute -top-0.5 -right-0.5 w-5 h-5 flex items-center justify-center text-[10px] font-black text-white rounded-full shadow-md ${criticalCount > 0 ? 'bg-rose-500' : 'bg-amber-500'}`}>
                {badgeCount > 9 ? '9+' : badgeCount}
              </span>
            )}
          </button>

          {/* Dropdown Panel */}
          {alertsOpen && (
            <div className="absolute right-0 top-12 w-96 bg-white rounded-2xl shadow-2xl shadow-slate-900/15 border border-slate-200 overflow-hidden z-50 animate-fade-in">
              <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-slate-600" />
                  <span className="font-bold text-slate-800 text-sm">Smart Alerts</span>
                  {badgeCount > 0 && (
                    <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{badgeCount} active</span>
                  )}
                </div>
                <button onClick={() => setAlertsOpen(false)} className="text-slate-400 hover:text-slate-600 text-xs font-medium">
                  Dismiss
                </button>
              </div>

              <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-100">
                {alerts.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <span className="text-2xl">✅</span>
                    </div>
                    <p className="font-bold text-slate-700">All Clear!</p>
                    <p className="text-slate-400 text-sm mt-1">No alerts at this time.</p>
                  </div>
                ) : alerts.map((alert, i) => {
                  const cfg = severityConfig[alert.severity] || severityConfig.medium;
                  const Icon = cfg.icon;
                  return (
                    <div key={i} className={`px-4 py-3 ${cfg.bg} hover:brightness-95 transition-all`}>
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 flex-shrink-0`}>
                          <Icon className={`w-4 h-4 ${cfg.iconColor}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-slate-800 text-sm leading-snug">{alert.title}</p>
                          <p className="text-slate-500 text-xs mt-0.5 leading-relaxed">{alert.message}</p>
                          {alert.action && (
                            <Link
                              to={alert.action.path}
                              onClick={() => setAlertsOpen(false)}
                              className="inline-flex items-center gap-1 text-xs font-bold text-teal-600 hover:text-teal-800 mt-1.5 transition-colors"
                            >
                              {alert.action.label} <ChevronRight className="w-3 h-3" />
                            </Link>
                          )}
                        </div>
                        <span className={`flex-shrink-0 text-[10px] font-black uppercase px-2 py-0.5 rounded-full text-white ${cfg.badge} mt-0.5`}>
                          {alert.severity}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {alerts.length > 0 && (
                <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-center">
                  <Link to="/reports" onClick={() => setAlertsOpen(false)} className="text-xs font-bold text-teal-600 hover:text-teal-800">
                    View Full Analytics →
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center space-x-3 border-l border-slate-800 pl-6">
          <div className="flex flex-col text-right">
            <span className="text-sm font-semibold text-slate-200">{user?.full_name}</span>
            <span className="text-xs text-teal-400 uppercase tracking-wider font-medium">{user?.role}</span>
          </div>
          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-teal-500 to-emerald-400 flex items-center justify-center text-white font-bold shadow-md text-sm">
            {user?.full_name?.charAt(0) || 'U'}
          </div>
          <button
            onClick={handleLogout}
            className="ml-1 p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            title="Log out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
