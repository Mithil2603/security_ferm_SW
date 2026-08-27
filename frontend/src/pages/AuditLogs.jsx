import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { format } from 'date-fns';
import { ShieldAlert, Filter, Server, ChevronLeft, ChevronRight, Activity, Download } from 'lucide-react';
import { Link } from 'react-router-dom';

const LIMIT = 50;

const ACTION_COLORS = {
  create: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  update: 'bg-blue-100 text-blue-700 border-blue-200',
  delete: 'bg-red-100 text-red-700 border-red-200',
  login: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  logout: 'bg-slate-100 text-slate-700 border-slate-200',
  export: 'bg-purple-100 text-purple-700 border-purple-200',
  view: 'bg-teal-100 text-teal-700 border-teal-200',
};
const getActionColor = (action) => ACTION_COLORS[action] || 'bg-gray-100 text-gray-700 border-gray-200';

export default function AuditLogs() {
  const { user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: LIMIT, total: 0, pages: 0 });
  const [metaTables, setMetaTables] = useState([]);
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const [filters, setFilters] = useState({
    action: '',
    table_name: '',
    date_from: thirtyDaysAgo.toISOString().split('T')[0],
    date_to: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    api.get('/audit-logs/meta').then(r => {
      if (r.data.success) setMetaTables(r.data.data);
    }).catch(() => {});
  }, []);

  const fetchLogs = async (page = 1, signal) => {
    try {
      setLoading(true);
      setError('');
      setPagination(p => ({ ...p, page }));
      
      const params = new URLSearchParams({
        page: page,
        limit: LIMIT
      });
      
      if (filters.action) params.append('action', filters.action);
      if (filters.table_name) params.append('table_name', filters.table_name);
      if (filters.date_from) params.append('date_from', filters.date_from);
      if (filters.date_to) params.append('date_to', filters.date_to);
      
      const res = await api.get(`/audit-logs?${params.toString()}`, { signal });
      if (res.data.success) {
        setLogs(res.data.data);
        setPagination(res.data.pagination);
      }
    } catch (err) {
      if (err.name === 'CanceledError' || err.message === 'canceled') return;
      setError(err.response?.data?.message || err.message || 'Failed to fetch audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchLogs(1, controller.signal);
    return () => controller.abort();
  }, [filters]);

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.pages) {
      fetchLogs(newPage);
    }
  };

  const safeFormat = (d) => {
    try {
      if (!d) return 'N/A';
      return format(new Date(d), 'dd MMM yyyy, HH:mm:ss');
    } catch {
      return 'Invalid date';
    }
  };

  const handleExport = async () => {
    try {
      const params = new URLSearchParams(filters);
      const res = await api.get(`/audit-logs/export?${params.toString()}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'audit_logs.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError('Failed to export logs');
    }
  };

  if (user?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-slate-800">Access Denied</h2>
        <p className="text-slate-500 mt-2">You do not have permission to view system audit logs.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Activity className="w-6 h-6 text-indigo-600" />
            System Audit Logs
          </h1>
          <p className="text-slate-500 text-sm mt-1">Track all critical actions and changes across the application.</p>
        </div>
        <button onClick={handleExport} className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-700">Filter By:</span>
          </div>
          
          <select 
            value={filters.action}
            onChange={(e) => setFilters({...filters, action: e.target.value})}
            className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            <option value="">All Actions</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
            <option value="login">Login</option>
            <option value="logout">Logout</option>
            <option value="export">Export</option>
            <option value="view">View</option>
          </select>
          
          <select 
            value={filters.table_name}
            onChange={(e) => setFilters({...filters, table_name: e.target.value})}
            className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            <option value="">All Entities</option>
            {metaTables.length > 0 ? (
              metaTables.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)
            ) : (
              <>
                <option value="clients">Clients</option>
                <option value="employees">Employees</option>
                <option value="invoices">Invoices</option>
                <option value="payments">Payments</option>
                <option value="users">Users</option>
              </>
            )}
          </select>

          <input 
            type="date"
            value={filters.date_from}
            onChange={(e) => setFilters({...filters, date_from: e.target.value})}
            className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          <span className="text-slate-400">to</span>
          <input 
            type="date"
            value={filters.date_to}
            onChange={(e) => setFilters({...filters, date_to: e.target.value})}
            className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>

        {/* Error State */}
        {error && (
          <div className="m-4 p-4 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm flex items-start gap-2">
            <ShieldAlert className="w-5 h-5 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Data Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 text-left font-bold text-slate-500 uppercase tracking-wide text-xs">Timestamp</th>
                <th className="px-6 py-3 text-left font-bold text-slate-500 uppercase tracking-wide text-xs">User</th>
                <th className="px-6 py-3 text-left font-bold text-slate-500 uppercase tracking-wide text-xs">Action</th>
                <th className="px-6 py-3 text-left font-bold text-slate-500 uppercase tracking-wide text-xs">Entity</th>
                <th className="px-6 py-3 text-left font-bold text-slate-500 uppercase tracking-wide text-xs">Description</th>
                <th className="px-6 py-3 text-left font-bold text-slate-500 uppercase tracking-wide text-xs">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="6" className="px-6 py-12 text-center text-slate-500">
                    <div className="flex justify-center mb-2">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500"></div>
                    </div>
                    Loading audit trail...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-12 text-center text-slate-500">
                    <Server className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p className="font-medium text-slate-600">No logs found</p>
                    <p className="text-xs">Adjust your filters to see results.</p>
                  </td>
                </tr>
              ) : (
                logs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3 whitespace-nowrap text-xs text-slate-500 font-mono">
                      {safeFormat(log.created_at)}
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap">
                      <div className="font-medium text-slate-800">{log.user_name || 'System'}</div>
                      <div className="text-xs text-slate-500">{log.user_email || ''}</div>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${getActionColor(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap">
                      <div className="font-medium text-slate-700 capitalize">{log.table_name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {log.record_id ? (
                          <Link to={`/${log.table_name.replace('_', '-')}/${log.record_id}`} className="hover:text-indigo-500 hover:underline">
                            ID: {log.record_id}
                          </Link>
                        ) : 'ID: N/A'}
                      </div>
                    </td>
                    <td className="px-6 py-3" title={log.description}>
                      <p className="text-slate-600 truncate max-w-md">{log.description}</p>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-xs text-slate-400 font-mono">
                      {log.ip_address || 'N/A'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && logs.length > 0 && (
          <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-slate-50">
            <p className="text-sm text-slate-500">
              Showing <span className="font-medium text-slate-700">{Math.max(1, ((pagination.page - 1) * pagination.limit) + 1)}</span> to <span className="font-medium text-slate-700">{Math.min(pagination.page * pagination.limit, pagination.total)}</span> of <span className="font-medium text-slate-700">{pagination.total}</span> logs
            </p>
            <div className="flex gap-2">
              <button 
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page === 1}
                className="p-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button 
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page === pagination.pages}
                className="p-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
