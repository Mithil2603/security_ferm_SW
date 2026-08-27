import { useState, useEffect } from 'react';
import { Archive, FileText, Building2, IndianRupee, Users, Receipt, Search, Download, Eye, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../services/api';
import { getApiBaseUrl } from '../utils/apiUrl';
import * as XLSX from 'xlsx';
import StatementViewerModal from '../components/StatementViewerModal';

const DOMAINS = [
  { key: 'all', label: 'All', icon: <Archive className="w-4 h-4" />, color: 'text-slate-600 bg-slate-100 border-slate-200' },
  { key: 'invoice', label: 'Invoices', icon: <FileText className="w-4 h-4" />, color: 'text-blue-600 bg-blue-50 border-blue-200' },
  { key: 'vendor', label: 'Vendor', icon: <Building2 className="w-4 h-4" />, color: 'text-amber-600 bg-amber-50 border-amber-200' },
  { key: 'gst', label: 'GST', icon: <IndianRupee className="w-4 h-4" />, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  { key: 'tds', label: 'TDS', icon: <Receipt className="w-4 h-4" />, color: 'text-purple-600 bg-purple-50 border-purple-200' },
  { key: 'payroll', label: 'Payroll', icon: <Users className="w-4 h-4" />, color: 'text-teal-600 bg-teal-50 border-teal-200' },
];

const domainBadgeColors = {
  invoice: 'bg-blue-100 text-blue-700',
  vendor: 'bg-amber-100 text-amber-700',
  gst: 'bg-emerald-100 text-emerald-700',
  tds: 'bg-purple-100 text-purple-700',
  payroll: 'bg-teal-100 text-teal-700',
};

function formatCurrency(val) {
  return `₹${parseFloat(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

function formatDate(d) {
  if (!d) return '-';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

export default function StatementArchive() {
  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeDomain, setActiveDomain] = useState('all');
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState({
    from_date: `${new Date().getFullYear()}-01-01`,
    to_date: new Date().toISOString().split('T')[0]
  });
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [domainCounts, setDomainCounts] = useState({});
  const [viewerModal, setViewerModal] = useState({ isOpen: false, statement: null });
  const [error, setError] = useState(null);
  const [archiving, setArchiving] = useState(null);

  const fetchStatements = async (page = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (activeDomain !== 'all') params.append('domain', activeDomain);
      if (dateRange.from_date) params.append('from_date', dateRange.from_date);
      if (dateRange.to_date) params.append('to_date', dateRange.to_date);
      if (search) params.append('search', search);
      params.append('page', page);
      params.append('limit', 20);

      const res = await api.get(`/statements?${params.toString()}`);
      setStatements(res.data || []);
      if (res.pagination) setPagination(res.pagination);
    } catch (err) {
      console.error('Failed to fetch statements', err);
      setError('Failed to load statements. Check server connection.');
      setStatements([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchDomainCounts = async () => {
    try {
      const res = await api.get('/statements/domain-counts');
      setDomainCounts(res.data || {});
    } catch (err) {
      console.error('Failed to fetch domain counts', err);
    }
  };

  useEffect(() => {
    const debounce = setTimeout(() => {
      fetchStatements();
    }, 300);
    return () => clearTimeout(debounce);
  }, [activeDomain, dateRange.from_date, dateRange.to_date, search]);

  useEffect(() => {
    fetchDomainCounts();
  }, []);

  const handleView = async (stmt) => {
    try {
      const res = await api.get(`/statements/${stmt.id}`);
      setViewerModal({ isOpen: true, statement: res.data });
    } catch (err) {
      console.error('Failed to fetch statement details', err);
      setError('Failed to load statement details. Please try again.');
    }
  };

  const handleDelete = async (stmt) => {
    if (!window.confirm(`Archive this statement "${stmt.statement_number}"? It will be hidden from the list.`)) return;
    try {
      setArchiving(stmt.id);
      await api.delete(`/statements/${stmt.id}`);
      fetchStatements(pagination.page);
      fetchDomainCounts();
    } catch (err) {
      alert('Failed to archive statement');
    } finally {
      setArchiving(null);
    }
  };

  const handleExportAll = async () => {
    try {
      const params = new URLSearchParams();
      if (activeDomain !== 'all') params.append('domain', activeDomain);
      if (dateRange.from_date) params.append('from_date', dateRange.from_date);
      if (dateRange.to_date) params.append('to_date', dateRange.to_date);
      
      const res = await api.get(`/statements/export?${params.toString()}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data || res]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Statement_Archive_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    } catch (err) {
      console.error('Export failed', err);
    }
  };

  const totalCount = Object.values(domainCounts).reduce((s, c) => s + parseInt(c || 0), 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Archive className="w-6 h-6 text-teal-600" />
            Statement Archive
          </h1>
          <p className="text-slate-500 text-sm mt-1">Permanent record of all financial statements — invoices, vendor, GST, TDS, and payroll.</p>
        </div>
        <button onClick={handleExportAll}
          className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-sm">
          <Download className="w-4 h-4" /> Export All
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 flex justify-between items-center text-sm">
          <span>⚠ {error}</span>
          <div className="flex gap-4">
            <button onClick={() => { setError(null); fetchStatements(); }} className="font-medium hover:underline">Retry</button>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* Domain Tabs */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-2">
        <div className="flex gap-2 overflow-x-auto">
          {DOMAINS.map(d => {
            const count = d.key === 'all' ? totalCount : (domainCounts[d.key] || 0);
            const isActive = activeDomain === d.key;
            return (
              <button key={d.key}
                onClick={() => { setActiveDomain(d.key); setPagination(p => ({ ...p, page: 1 })); }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap border ${
                  isActive
                    ? `${d.color} shadow-sm`
                    : 'text-slate-500 bg-white border-transparent hover:bg-slate-50 hover:border-slate-200'
                }`}>
                {d.icon}
                {d.label}
                {count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${isActive ? 'bg-white/60' : 'bg-slate-100'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by statement number, title, or party name..."
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-2">
            <input type="date" value={dateRange.from_date}
              onChange={e => setDateRange(prev => ({ ...prev, from_date: e.target.value }))}
              className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500" />
            <span className="text-slate-400 font-medium text-sm">to</span>
            <input type="date" value={dateRange.to_date}
              onChange={e => setDateRange(prev => ({ ...prev, to_date: e.target.value }))}
              className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500" />
          </div>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-semibold">Statement</th>
                <th className="px-6 py-4 font-semibold">Domain</th>
                <th className="px-6 py-4 font-semibold">Party</th>
                <th className="px-6 py-4 font-semibold text-right">Amount</th>
                <th className="px-6 py-4 font-semibold text-right">Tax</th>
                <th className="px-6 py-4 font-semibold">Date</th>
                <th className="px-6 py-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan="7" className="px-6 py-4"><div className="h-5 bg-slate-100 rounded animate-pulse" /></td></tr>
                ))
              ) : statements.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-16 text-center text-slate-500">
                    <Archive className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p className="font-medium text-slate-600 mb-1">No statements found</p>
                    <p className="text-xs">Statements are automatically created when you process invoices, payments, payroll, or expenses.</p>
                  </td>
                </tr>
              ) : (
                statements.map(stmt => (
                  <tr key={stmt.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900 text-sm">{stmt.statement_number}</div>
                      <div className="text-xs text-slate-500 mt-0.5 max-w-[250px] truncate">{stmt.title}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium capitalize ${domainBadgeColors[stmt.domain] || 'bg-slate-100 text-slate-700'}`}>
                        {stmt.domain}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-slate-700 font-medium">{stmt.party_name || '-'}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-sm font-bold text-slate-900">{formatCurrency(stmt.total_amount)}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-sm text-slate-600">
                        {parseFloat(stmt.tax_amount) > 0 ? formatCurrency(stmt.tax_amount) : '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-slate-600">{formatDate(stmt.generated_at)}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => handleView(stmt)}
                          className="p-2 text-slate-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors" title="View Statement">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(stmt)} disabled={archiving === stmt.id}
                          className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50" title="Archive">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/50">
            <p className="text-sm text-slate-500">
              Showing {((pagination.page - 1) * pagination.limit) + 1} - {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
            </p>
            <div className="flex gap-1">
              <button
                disabled={pagination.page <= 1}
                onClick={() => { setPagination(p => ({ ...p, page: p.page - 1 })); fetchStatements(pagination.page - 1); }}
                className="p-2 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => { setPagination(p => ({ ...p, page: p.page + 1 })); fetchStatements(pagination.page + 1); }}
                className="p-2 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Statement Viewer Modal */}
      <StatementViewerModal
        isOpen={viewerModal.isOpen}
        statement={viewerModal.statement}
        onClose={() => setViewerModal({ isOpen: false, statement: null })}
      />
    </div>
  );
}
