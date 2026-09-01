import { useState, useEffect } from 'react';
import { RefreshCw, Plus, Search, Pause, Play, Zap, Clock, X, Calendar, DollarSign, TrendingUp, History } from 'lucide-react';
import api from '../services/api';
import { format } from 'date-fns';
import { toast, confirmDialog } from '../context/ToastContext';
import Pagination from '../components/Pagination';
import TableSkeleton from '../components/TableSkeleton';

const FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

const STATUS_COLORS = {
  active: 'bg-emerald-500/20 text-emerald-400',
  paused: 'bg-amber-500/20 text-amber-400',
  expired: 'bg-gray-500/20 text-gray-400',
  cancelled: 'bg-red-500/20 text-red-400',
};

export default function RecurringInvoices() {
  const [recurringList, setRecurringList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedRecurring, setSelectedRecurring] = useState(null);
  const [history, setHistory] = useState([]);
  const [clients, setClients] = useState([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');

  const [form, setForm] = useState({
    client_id: '', monthly_rate: '', tax_type: 'cgst_sgst', discount_amount: '0',
    is_rcm_applicable: false, frequency: 'monthly', start_date: format(new Date(), 'yyyy-MM-dd'),
    end_date: '', auto_generate: true, reminder_days: '5', invoice_description: '', invoice_notes: '',
  });

  // ─── Data Fetching ──────────────────────────────────────────────────────────

  const fetchRecurring = async () => {
    try {
      setLoading(true);
      const statusParam = filterStatus ? `&status=${filterStatus}` : '';
      const response = await api.get(`/recurring-invoices?page=${page}&limit=20${statusParam}`);
      setRecurringList(response.data || []);
      if (response.pagination) setPagination(response.pagination);
    } catch (err) {
      console.error('Failed to fetch recurring invoices', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await api.get('/recurring-invoices/stats');
      setStats(response.data);
    } catch (err) {
      console.error('Failed to fetch stats', err);
    }
  };

  const fetchClients = async () => {
    try {
      const res = await api.get('/clients?limit=200');
      setClients((res.data || []).filter(c => c.is_active));
    } catch (err) {
      console.error('Failed to fetch clients', err);
    }
  };

  useEffect(() => { fetchRecurring(); fetchStats(); }, [page, filterStatus]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        client_id: parseInt(form.client_id),
        monthly_rate: parseFloat(form.monthly_rate),
        discount_amount: parseFloat(form.discount_amount || '0'),
        reminder_days: parseInt(form.reminder_days || '5'),
        end_date: form.end_date || null,
      };
      await api.post('/recurring-invoices', payload);
      setIsCreateOpen(false);
      fetchRecurring();
      fetchStats();
    } catch (err) {
      setError(err.message || 'Failed to create recurring invoice');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePause = async (id) => {
    try {
      await api.post(`/recurring-invoices/${id}/pause`);
      fetchRecurring();
      fetchStats();
    } catch (err) {
      alert(err.message || 'Failed to pause');
    }
  };

  const handleResume = async (id) => {
    try {
      await api.post(`/recurring-invoices/${id}/resume`);
      fetchRecurring();
      fetchStats();
    } catch (err) {
      alert(err.message || 'Failed to resume');
    }
  };

  const handleGenerateNow = async (id) => {
    const confirmed = await confirmDialog({
      title: 'Generate Invoice Now',
      message: 'Generate an invoice from this template now?',
      confirmText: 'Generate',
      variant: 'teal'
    });
    if (!confirmed) return;
    try {
      const res = await api.post(`/recurring-invoices/${id}/generate`);
      const resData = res.data || res;
      toast.success(`Invoice ${resData.invoice_number} generated for ₹${resData.amount}`);
      fetchRecurring();
      fetchStats();
    } catch (err) {
      toast.error(err.message || 'Failed to generate');
    }
  };

  const handleCancel = async (id) => {
    const confirmed = await confirmDialog({
      title: 'Cancel Recurring Invoice',
      message: 'Cancel this recurring invoice? This cannot be undone.',
      confirmText: 'Cancel Recurring',
      variant: 'danger'
    });
    if (!confirmed) return;
    try {
      await api.delete(`/recurring-invoices/${id}`);
      toast.success('Recurring invoice cancelled');
      fetchRecurring();
      fetchStats();
    } catch (err) {
      toast.error(err.message || 'Failed to cancel');
    }
  };

  const openHistory = async (recurring) => {
    setSelectedRecurring(recurring);
    try {
      const res = await api.get(`/recurring-invoices/${recurring.id}/history`);
      setHistory(res.data || []);
    } catch (err) {
      setHistory([]);
    }
    setIsHistoryOpen(true);
  };

  const openCreateModal = () => {
    fetchClients();
    setForm({
      client_id: '', monthly_rate: '', tax_type: 'cgst_sgst', discount_amount: '0',
      is_rcm_applicable: false, frequency: 'monthly', start_date: format(new Date(), 'yyyy-MM-dd'),
      end_date: '', auto_generate: true, reminder_days: '5', invoice_description: '', invoice_notes: '',
    });
    setError('');
    setIsCreateOpen(true);
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <RefreshCw className="w-6 h-6 text-blue-400" />
            Recurring Invoices
          </h1>
          <p className="text-gray-400 mt-1">Manage automated billing templates</p>
        </div>
        <button onClick={openCreateModal} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> New Recurring Invoice
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/20 rounded-lg"><RefreshCw className="w-5 h-5 text-emerald-400" /></div>
              <div>
                <p className="text-gray-400 text-sm">Active</p>
                <p className="text-xl font-bold text-white">{stats.active || 0}</p>
              </div>
            </div>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/20 rounded-lg"><Pause className="w-5 h-5 text-amber-400" /></div>
              <div>
                <p className="text-gray-400 text-sm">Paused</p>
                <p className="text-xl font-bold text-white">{stats.paused || 0}</p>
              </div>
            </div>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/20 rounded-lg"><DollarSign className="w-5 h-5 text-blue-400" /></div>
              <div>
                <p className="text-gray-400 text-sm">Monthly Recurring Revenue</p>
                <p className="text-xl font-bold text-white">₹{Number(stats.monthly_recurring_revenue || 0).toLocaleString('en-IN')}</p>
              </div>
            </div>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-lg"><Calendar className="w-5 h-5 text-purple-400" /></div>
              <div>
                <p className="text-gray-400 text-sm">Upcoming (7 days)</p>
                <p className="text-xl font-bold text-white">{stats.upcoming_invoices?.length || 0}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-3">
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm">
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {/* Table */}
      {loading ? <TableSkeleton /> : (
        <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700/50">
                  <th className="text-left p-4">Client</th>
                  <th className="text-left p-4">Rate</th>
                  <th className="text-left p-4">Frequency</th>
                  <th className="text-left p-4">Next Invoice</th>
                  <th className="text-left p-4">Status</th>
                  <th className="text-left p-4">Auto</th>
                  <th className="text-right p-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recurringList.length === 0 ? (
                  <tr><td colSpan="7" className="p-8 text-center text-gray-500">No recurring invoices found. Create one to get started.</td></tr>
                ) : recurringList.map(r => (
                  <tr key={r.id} className="border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors">
                    <td className="p-4">
                      <div className="font-medium text-white">{r.client_name}</div>
                      <div className="text-xs text-gray-500">{r.client_email}</div>
                    </td>
                    <td className="p-4 text-white font-medium">₹{Number(r.monthly_rate).toLocaleString('en-IN')}</td>
                    <td className="p-4">
                      <span className="bg-blue-500/20 text-blue-400 px-2 py-1 rounded text-xs font-medium capitalize">
                        {r.frequency}
                      </span>
                    </td>
                    <td className="p-4 text-gray-300">{r.next_invoice_date ? format(new Date(r.next_invoice_date), 'dd MMM yyyy') : '—'}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium capitalize ${STATUS_COLORS[r.status] || ''}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="p-4 text-gray-300">{r.auto_generate ? '✅' : '❌'}</td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1">
                        {r.status === 'active' && (
                          <>
                            <button onClick={() => handleGenerateNow(r.id)} title="Generate Now" className="p-1.5 rounded-lg hover:bg-blue-500/20 text-blue-400 transition-colors"><Zap className="w-4 h-4" /></button>
                            <button onClick={() => handlePause(r.id)} title="Pause" className="p-1.5 rounded-lg hover:bg-amber-500/20 text-amber-400 transition-colors"><Pause className="w-4 h-4" /></button>
                          </>
                        )}
                        {r.status === 'paused' && (
                          <button onClick={() => handleResume(r.id)} title="Resume" className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-emerald-400 transition-colors"><Play className="w-4 h-4" /></button>
                        )}
                        <button onClick={() => openHistory(r)} title="History" className="p-1.5 rounded-lg hover:bg-purple-500/20 text-purple-400 transition-colors"><History className="w-4 h-4" /></button>
                        {r.status !== 'cancelled' && (
                          <button onClick={() => handleCancel(r.id)} title="Cancel" className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 transition-colors"><X className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination && pagination.total > 20 && (
            <Pagination pagination={pagination} page={page} setPage={setPage} />
          )}
        </div>
      )}

      {/* ─── Create Modal ──────────────────────────────────────────────────────── */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-blue-400" /> New Recurring Invoice
              </h2>
              <button onClick={() => setIsCreateOpen(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg mb-4 text-sm">{error}</div>}

            <form onSubmit={handleCreate} className="space-y-4">
              {/* Client */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Client *</label>
                <select name="client_id" value={form.client_id} onChange={handleInputChange} required
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white">
                  <option value="">Select client...</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Rate & Frequency */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Monthly Rate (₹) *</label>
                  <input type="number" name="monthly_rate" value={form.monthly_rate} onChange={handleInputChange} required min="0" step="0.01"
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Frequency *</label>
                  <select name="frequency" value={form.frequency} onChange={handleInputChange}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white">
                    {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Start Date *</label>
                  <input type="date" name="start_date" value={form.start_date} onChange={handleInputChange} required
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">End Date (optional)</label>
                  <input type="date" name="end_date" value={form.end_date} onChange={handleInputChange}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" />
                </div>
              </div>

              {/* Tax */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Tax Type</label>
                  <select name="tax_type" value={form.tax_type} onChange={handleInputChange}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white">
                    <option value="none">No Tax</option>
                    <option value="cgst_sgst">CGST + SGST (18%)</option>
                    <option value="igst">IGST (18%)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Discount (₹)</label>
                  <input type="number" name="discount_amount" value={form.discount_amount} onChange={handleInputChange} min="0" step="0.01"
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" />
                </div>
              </div>

              {/* Options */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Reminder Days Before</label>
                  <input type="number" name="reminder_days" value={form.reminder_days} onChange={handleInputChange} min="0" max="30"
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" />
                </div>
                <div className="flex items-end gap-4 pb-2">
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input type="checkbox" name="auto_generate" checked={form.auto_generate} onChange={handleInputChange} className="rounded" />
                    Auto Generate
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input type="checkbox" name="is_rcm_applicable" checked={form.is_rcm_applicable} onChange={handleInputChange} className="rounded" />
                    RCM
                  </label>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Description</label>
                <textarea name="invoice_description" value={form.invoice_description} onChange={handleInputChange} rows="2"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white resize-none" placeholder="Security services for..." />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Notes</label>
                <textarea name="invoice_notes" value={form.invoice_notes} onChange={handleInputChange} rows="2"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white resize-none" placeholder="Payment terms, special conditions..." />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsCreateOpen(false)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg transition-colors">Cancel</button>
                <button type="submit" disabled={submitting} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white py-2 rounded-lg transition-colors">
                  {submitting ? 'Creating...' : 'Create Recurring Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── History Modal ─────────────────────────────────────────────────────── */}
      {isHistoryOpen && selectedRecurring && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <History className="w-5 h-5 text-purple-400" /> History — {selectedRecurring.client_name}
              </h2>
              <button onClick={() => setIsHistoryOpen(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            {history.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No generation history yet.</p>
            ) : (
              <div className="space-y-3">
                {history.map(h => (
                  <div key={h.id} className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                          h.action === 'INVOICE_GENERATED' ? 'bg-emerald-500/20 text-emerald-400' :
                          h.action === 'PAUSED' ? 'bg-amber-500/20 text-amber-400' :
                          h.action === 'RESUMED' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>{h.action}</span>
                        {h.invoice_number && <span className="text-white text-sm ml-2">{h.invoice_number}</span>}
                        {h.final_amount && <span className="text-gray-400 text-sm ml-2">₹{Number(h.final_amount).toLocaleString('en-IN')}</span>}
                      </div>
                      <span className="text-xs text-gray-500">{format(new Date(h.created_at), 'dd MMM yyyy HH:mm')}</span>
                    </div>
                    {h.details && <p className="text-xs text-gray-500 mt-1">{h.details}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
