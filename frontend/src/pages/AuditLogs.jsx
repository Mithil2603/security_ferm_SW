import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { format } from 'date-fns';
import { ShieldAlert, Search, Filter, Server, ChevronLeft, ChevronRight, Activity } from 'lucide-react';
import Select from '../components/ui/Select';

export default function AuditLogs() {
  const { user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  
  const [filters, setFilters] = useState({
    action: '',
    table_name: ''
  });

  const fetchLogs = async (page = 1) => {
    try {
      setLoading(true);
      setError('');
      
      const params = new URLSearchParams({
        page: page,
        limit: pagination.limit
      });
      
      if (filters.action) params.append('action', filters.action);
      if (filters.table_name) params.append('table_name', filters.table_name);
      
      const res = await api.get(`/audit-logs?${params.toString()}`);
      if (res.data.success) {
        setLogs(res.data.data);
        setPagination(res.data.pagination);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(1);
  }, [filters]);

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.pages) {
      fetchLogs(newPage);
    }
  };

  const getActionColor = (action) => {
    switch (action) {
      case 'create': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'update': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'delete': return 'bg-red-100 text-red-700 border-red-200';
      case 'login': return 'bg-indigo-100 text-indigo-700 border-indigo-200';
      case 'logout': return 'bg-slate-100 text-slate-700 border-slate-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
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
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-700">Filter By:</span>
          </div>
          
          <Select 
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
          </Select>
          
          <Select 
            value={filters.table_name}
            onChange={(e) => setFilters({...filters, table_name: e.target.value})}
            className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            <option value="">All Entities</option>
            <option value="clients">Clients</option>
            <option value="employees">Employees</option>
            <option value="invoices">Invoices</option>
            <option value="payments">Payments</option>
            <option value="users">Users</option>
          </Select>
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
                      {format(new Date(log.created_at), 'dd MMM yyyy, HH:mm:ss')}
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
                      <div className="text-[10px] text-slate-400 font-mono">ID: {log.record_id || 'N/A'}</div>
                    </td>
                    <td className="px-6 py-3">
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
              Showing <span className="font-medium text-slate-700">{((pagination.page - 1) * pagination.limit) + 1}</span> to <span className="font-medium text-slate-700">{Math.min(pagination.page * pagination.limit, pagination.total)}</span> of <span className="font-medium text-slate-700">{pagination.total}</span> logs
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
