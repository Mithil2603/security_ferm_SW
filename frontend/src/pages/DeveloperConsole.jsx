import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { ShieldAlert, AlertTriangle, AlertCircle, Info, RefreshCw, CheckCircle, Trash2, Search, X } from 'lucide-react';
import { format } from 'date-fns';

const DeveloperConsole = () => {
  const { user } = useAuth();
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({
    severity: 'all',
    category: 'all',
    is_resolved: 'unresolved',
    search: ''
  });
  const [stats, setStats] = useState({
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0
  });
  const [selectedError, setSelectedError] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  const [resolvingId, setResolvingId] = useState(null);



  const fetchStats = async () => {
    try {
      const response = await api.get('/errors/stats');
      if (response.data.success) {
        setStats(response.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const fetchErrors = useCallback(async (page = 1, isAutoRefresh = false, signal = undefined) => {
    try {
      if (!isAutoRefresh) setLoading(true);
      const params = new URLSearchParams({
        is_resolved: filter.is_resolved === 'all' ? '' : filter.is_resolved,
        page,
        limit: pagination.limit
      });

      if (filter.severity !== 'all') params.append('severity', filter.severity);
      if (filter.category !== 'all') params.append('category', filter.category);
      if (filter.search) params.append('search', filter.search);

      const response = await api.get(`/errors?${params}`, { signal });

      if (response.data.success) {
        setErrors(response.data.data);
        setPagination(response.data.pagination);
      }
    } catch (error) {
      if (error.name === 'CanceledError' || error.message === 'canceled') return;
      console.error('Failed to fetch errors:', error);
    } finally {
      setLoading(false);
    }
  }, [filter, pagination.limit]);

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchErrors(1, false, controller.signal);
    return () => controller.abort();
  }, [filter, fetchErrors]);

  // Polling with visibility check
  useEffect(() => {
    let intervalId;
    
    const startPolling = () => {
      intervalId = setInterval(() => {
        if (!document.hidden && filter.search === '') {
          fetchErrors(pagination.page, true);
          fetchStats();
        }
      }, 30000); // DC-H5: 30s interval
    };

    startPolling();

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearInterval(intervalId);
      } else {
        fetchErrors(pagination.page, true);
        fetchStats();
        startPolling();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchErrors, pagination.page, filter.search]);

  const resolveError = async (errorId) => {
    if (!window.confirm('Mark this error as resolved?')) return;
    
    try {
      setResolvingId(errorId);
      await api.patch(`/errors/${errorId}/resolve`, {});
      fetchErrors(pagination.page);
      fetchStats();
      if (selectedError && selectedError.id === errorId) {
        setSelectedError(prev => ({ ...prev, is_resolved: 1 }));
      }
    } catch (error) {
      console.error('Failed to resolve error:', error);
      alert('Failed to resolve error. Please try again.');
    } finally {
      setResolvingId(null);
    }
  };

  const clearResolved = async () => {
    if (!window.confirm('Are you sure you want to permanently delete all resolved errors? This action cannot be undone.')) return;
    
    try {
      await api.delete('/errors/clear-resolved?confirm=true');
      fetchErrors(pagination.page);
      fetchStats();
      alert('Resolved errors cleared successfully.');
    } catch (error) {
      console.error('Failed to clear resolved errors:', error);
      alert('Failed to clear resolved errors.');
    }
  };

  const getSeverityStyles = (severity) => {
    switch (severity) {
      case 'critical': return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200', icon: <AlertTriangle className="w-4 h-4" /> };
      case 'high': return { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200', icon: <AlertCircle className="w-4 h-4" /> };
      case 'medium': return { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200', icon: <ShieldAlert className="w-4 h-4" /> };
      case 'low': return { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200', icon: <Info className="w-4 h-4" /> };
      default: return { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200', icon: <Info className="w-4 h-4" /> };
    }
  };

  const formatDate = (date) => {
    try {
      if (!date) return 'N/A';
      return format(new Date(date), 'dd MMM yyyy, HH:mm:ss');
    } catch {
      return 'Invalid date';
    }
  };

  // Safe parsing for additional_data
  const parseAdditionalData = (data) => {
    if (!data) return null;
    try {
      const parsed = JSON.parse(data);
      return typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : parsed;
    } catch {
      return data;
    }
  };

  // DC-L3: Access guard
  if (!user || (user.role !== 'admin' && !(user.permissions && user.permissions.includes('view_dev_errors')))) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-slate-800">Access Denied</h2>
        <p className="text-slate-500 mt-2">You do not have permission to view the developer console.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in font-mono">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2 font-sans">
            <ShieldAlert className="w-6 h-6 text-red-600" />
            Developer Console - Error Tracking
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-sans">Monitor and resolve system-level errors and exceptions.</p>
        </div>
        <div className="flex items-center gap-3">
          {loading && <span className="text-indigo-600 text-sm flex items-center gap-1 font-sans"><RefreshCw className="w-4 h-4 animate-spin" /> Refreshing...</span>}
          <button 
            onClick={clearResolved}
            className="flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-4 py-2 rounded-lg font-medium transition-colors text-sm font-sans"
          >
            <Trash2 className="w-4 h-4" /> Clear Resolved
          </button>
        </div>
      </div>

      {/* Stats Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-center">
          <h3 className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2 font-sans">Total Unresolved</h3>
          <p className="text-3xl font-black text-slate-800">{stats.total}</p>
        </div>
        <div className="bg-red-50 p-4 rounded-xl border border-red-100 text-center">
          <h3 className="text-red-600 text-xs font-bold uppercase tracking-wider mb-2 font-sans">Critical</h3>
          <p className="text-3xl font-black text-red-700">{stats.critical}</p>
        </div>
        <div className="bg-orange-50 p-4 rounded-xl border border-orange-100 text-center">
          <h3 className="text-orange-600 text-xs font-bold uppercase tracking-wider mb-2 font-sans">High</h3>
          <p className="text-3xl font-black text-orange-700">{stats.high}</p>
        </div>
        <div className="bg-amber-50 p-4 rounded-xl border border-amber-100 text-center">
          <h3 className="text-amber-600 text-xs font-bold uppercase tracking-wider mb-2 font-sans">Medium</h3>
          <p className="text-3xl font-black text-amber-700">{stats.medium}</p>
        </div>
        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-center">
          <h3 className="text-blue-600 text-xs font-bold uppercase tracking-wider mb-2 font-sans">Low</h3>
          <p className="text-3xl font-black text-blue-700">{stats.low}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-4 items-center">
        <select 
          value={filter.severity}
          onChange={(e) => setFilter({...filter, severity: e.target.value})}
          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none font-sans"
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <select 
          value={filter.is_resolved}
          onChange={(e) => setFilter({...filter, is_resolved: e.target.value})}
          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none font-sans"
        >
          <option value="unresolved">Unresolved</option>
          <option value="resolved">Resolved</option>
          <option value="all">All Statuses</option>
        </select>
        
        <select 
          value={filter.category}
          onChange={(e) => setFilter({...filter, category: e.target.value})}
          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none font-sans"
        >
          <option value="all">All Categories</option>
          <option value="FRONTEND">Frontend</option>
          <option value="API">API</option>
          <option value="DATABASE">Database</option>
          <option value="AUTH">Authentication</option>
          <option value="SECURITY">Security</option>
          <option value="EXTERNAL_SERVICE">External Service</option>
          <option value="SYSTEM">System</option>
        </select>

        <div className="relative flex-1 min-w-[250px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input 
            type="text"
            placeholder="Search messages, endpoints, or features..."
            value={filter.search}
            onChange={(e) => setFilter({...filter, search: e.target.value})}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none font-sans"
          />
        </div>
      </div>

      {/* Errors Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-200 font-sans">
              <tr>
                <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-xs">Severity</th>
                <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-xs">Message</th>
                <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-xs">Endpoint/Feature</th>
                <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-xs">Time</th>
                <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-xs">Status</th>
                <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-xs text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {errors.length === 0 && !loading ? (
                <tr><td colSpan="6" className="px-6 py-12 text-center text-slate-500 font-sans">No matching errors found.</td></tr>
              ) : (
                errors.map(error => {
                  const styles = getSeverityStyles(error.severity);
                  return (
                    <tr key={error.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border uppercase tracking-wider ${styles.bg} ${styles.text} ${styles.border}`}>
                          {styles.icon}
                          {error.severity}
                        </span>
                      </td>
                      <td className="px-6 py-4 max-w-[300px]">
                        <button 
                          onClick={() => setSelectedError(error)}
                          className="text-indigo-600 hover:text-indigo-800 text-left hover:underline truncate w-full font-medium"
                          title={error.error_message}
                        >
                          {(error.error_message || '').substring(0, 80) || '(no message)'}
                          {(error.error_message?.length > 80) ? '...' : ''}
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        {error.endpoint ? (
                          <div className="text-slate-600 truncate max-w-[200px]" title={error.endpoint}>{error.endpoint}</div>
                        ) : (
                          <div className="text-slate-500 italic font-sans">{error.feature || 'N/A'}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">
                        {formatDate(error.created_at)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {error.is_resolved ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 font-medium text-xs font-sans bg-emerald-50 px-2 py-1 rounded border border-emerald-100"><CheckCircle className="w-3.5 h-3.5" /> Resolved</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-500 font-medium text-xs font-sans bg-red-50 px-2 py-1 rounded border border-red-100"><AlertCircle className="w-3.5 h-3.5" /> Active</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <button 
                          onClick={() => resolveError(error.id)}
                          disabled={error.is_resolved || resolvingId === error.id}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-sans inline-flex items-center justify-center min-w-[80px]"
                        >
                          {resolvingId === error.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Resolve'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Controls */}
        {pagination.pages > 1 && (
          <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center bg-slate-50 font-sans">
            <span className="text-sm text-slate-500">
              Showing {Math.max(1, (pagination.page - 1) * pagination.limit + 1)} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} errors
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => fetchErrors(pagination.page - 1)}
                disabled={pagination.page === 1}
                className="px-3 py-1 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50 text-sm"
              >
                Previous
              </button>
              <button
                onClick={() => fetchErrors(pagination.page + 1)}
                disabled={pagination.page === pagination.pages}
                className="px-3 py-1 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50 text-sm"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Error Detail Modal */}
      {selectedError && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-sans" onClick={() => setSelectedError(null)}>
          <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl border border-slate-200" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex justify-between items-center p-6 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                {getSeverityStyles(selectedError.severity).icon}
                Error Details
              </h2>
              <button onClick={() => setSelectedError(null)} className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-full hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-6">
              
              <div className="bg-red-50 text-red-800 p-4 rounded-xl border border-red-100 font-mono text-sm break-words">
                {selectedError.error_message || '(No error message provided)'}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-sm">
                <div><span className="text-slate-500 block mb-1">Type</span><span className="font-semibold text-slate-800">{selectedError.error_type || 'Unknown'}</span></div>
                <div><span className="text-slate-500 block mb-1">Status</span>
                  {selectedError.is_resolved 
                    ? <span className="text-emerald-600 font-semibold flex items-center gap-1"><CheckCircle className="w-4 h-4"/> Resolved at {formatDate(selectedError.resolved_at)}</span>
                    : <span className="text-red-600 font-semibold flex items-center gap-1"><AlertCircle className="w-4 h-4"/> Unresolved</span>
                  }
                </div>
                <div><span className="text-slate-500 block mb-1">Endpoint</span><span className="font-mono bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{selectedError.method} {selectedError.endpoint || 'N/A'}</span></div>
                <div><span className="text-slate-500 block mb-1">Feature</span><span className="font-medium text-slate-800">{selectedError.feature || 'N/A'}</span></div>
                <div><span className="text-slate-500 block mb-1">Occurred At</span><span className="font-medium text-slate-800">{formatDate(selectedError.created_at)}</span></div>
                <div><span className="text-slate-500 block mb-1">Client IP</span><span className="font-mono text-slate-600">{selectedError.client_ip || 'N/A'}</span></div>
                <div><span className="text-slate-500 block mb-1">User</span><span className="font-medium text-slate-800">{selectedError.user_name || 'Anonymous/System'}</span></div>
              </div>

              {selectedError.stack_trace && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Stack Trace</h4>
                    {window.location.hostname !== 'localhost' && <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">WARNING: DO NOT EXPOSE IN PRODUCTION</span>}
                  </div>
                  <div className="bg-slate-900 text-slate-300 p-4 rounded-xl overflow-x-auto border border-slate-700 shadow-inner max-h-[300px] overflow-y-auto">
                    <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all">{selectedError.stack_trace}</pre>
                  </div>
                </div>
              )}

              {selectedError.additional_data && (
                <div>
                  <h4 className="text-sm font-bold text-slate-700 mb-2 uppercase tracking-wide">Additional Data</h4>
                  <div className="bg-slate-50 text-slate-700 p-4 rounded-xl overflow-x-auto border border-slate-200">
                    <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words">
                      {parseAdditionalData(selectedError.additional_data)}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-end gap-3">
              <button 
                onClick={() => setSelectedError(null)}
                className="px-5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
              >
                Close
              </button>
              <button 
                onClick={() => resolveError(selectedError.id)}
                disabled={selectedError.is_resolved || resolvingId === selectedError.id}
                className="px-5 py-2.5 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {resolvingId === selectedError.id && <RefreshCw className="w-4 h-4 animate-spin" />}
                {selectedError.is_resolved ? 'Already Resolved' : 'Mark as Resolved'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeveloperConsole;
