import { useState, useEffect } from 'react';
import { FileText, Plus, Search, Download, CreditCard, Clock, X, Mail, Trash2, Zap, Edit } from 'lucide-react';
import api from '../services/api';
import { format } from 'date-fns';
import Pagination from '../components/Pagination';
import TableSkeleton from '../components/TableSkeleton';
import EventInvoiceModal from '../components/EventInvoiceModal';
import EditInvoiceModal from '../components/EditInvoiceModal';
import { getApiBaseUrl } from '../utils/apiUrl';
import { toast, confirmDialog } from '../context/ToastContext';

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEventOpen, setIsEventOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [clients, setClients] = useState([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);

  const [invoiceForm, setInvoiceForm] = useState({
    client_id: '', billing_period_start: '', billing_period_end: '',
    tax_type: 'none', is_rcm_applicable: false, discount_amount: '0', notes: ''
  });

  const [paymentForm, setPaymentForm] = useState({
    amount_paid: '', tds_deducted: '0', payment_method: 'bank_transfer', payment_date: format(new Date(), 'yyyy-MM-dd'),
    transaction_reference: '', notes: ''
  });

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/invoices?page=${page}&limit=20`);
      setInvoices(response.data || []);
      if (response.pagination) setPagination(response.pagination);
    } catch (err) {
      console.error('Failed to fetch invoices', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
    fetchClients();
  }, [page]);

  const fetchClients = async () => {
    try {
      const res = await api.get('/clients?limit=200');
      const all = res.data || [];
      setClients(all.filter(c => c.is_active));
    } catch (err) {
      console.error('Failed to fetch clients', err);
    }
  };

  const openCreateModal = async () => {
    await fetchClients();
    const now = new Date();
    const startOfMonth = format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
    const endOfMonth = format(new Date(now.getFullYear(), now.getMonth() + 1, 0), 'yyyy-MM-dd');
    const todayStr = format(now, 'yyyy-MM-dd');

    setInvoiceForm({
      client_id: '',
      invoice_type: 'regular',
      invoice_date: todayStr,
      billing_period_start: startOfMonth,
      billing_period_end: endOfMonth,
      tax_type: 'cgst_sgst',
      is_rcm_applicable: false,
      discount_amount: '0',
      notes: '',
      fixed_amount: '',
      guards_count: '',
      rate_per_guard: '',
      duty_days_worked: ''
    });
    setError('');
    setIsCreateOpen(true);
  };

  const setMonthPreset = (offsetMonths = 0) => {
    const d = new Date();
    d.setMonth(d.getMonth() + offsetMonths);
    const start = format(new Date(d.getFullYear(), d.getMonth(), 1), 'yyyy-MM-dd');
    const end = format(new Date(d.getFullYear(), d.getMonth() + 1, 0), 'yyyy-MM-dd');
    setInvoiceForm(prev => ({
      ...prev,
      billing_period_start: start,
      billing_period_end: end
    }));
  };

  const handleCreateInvoice = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        ...invoiceForm,
        discount_amount: parseFloat(invoiceForm.discount_amount) || 0,
      };
      if (invoiceForm.invoice_type === 'event') {
        payload.is_ad_hoc = 1;
        if (invoiceForm.fixed_amount) {
          payload.fixed_amount = parseFloat(invoiceForm.fixed_amount);
        }
        if (invoiceForm.guards_count) payload.guards_count = parseInt(invoiceForm.guards_count, 10);
        if (invoiceForm.rate_per_guard) payload.rate_per_guard = parseFloat(invoiceForm.rate_per_guard);
        if (invoiceForm.duty_days_worked) payload.duty_days_worked = parseInt(invoiceForm.duty_days_worked, 10);
      }
      await api.post('/invoices', payload);
      setIsCreateOpen(false);
      fetchInvoices();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to create invoice');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAutoGenerate = async () => {
    setSubmitting(true);
    try {
      const now = new Date();
      const startOfMonth = format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
      const endOfMonth = format(new Date(now.getFullYear(), now.getMonth() + 1, 0), 'yyyy-MM-dd');
      
      const res = await api.get('/clients?limit=200');
      // Only generate monthly invoices for regular active clients (exclude event clients)
      const activeClients = (res.data || []).filter(c => c.is_active && (!c.client_type || c.client_type === 'regular'));
      
      let created = 0;
      let skipped = 0;
      for (const client of activeClients) {
        try {
          await api.post('/invoices', {
            client_id: client.id,
            billing_period_start: startOfMonth,
            billing_period_end: endOfMonth,
            tax_rate: 18,
            discount_amount: 0,
          });
          created++;
        } catch (err) {
          if (err.response?.status === 409 || err.message?.includes('already exists') || err.response?.data?.message?.includes('already exists')) {
            skipped++;
          }
          // Skip other clients that fail
        }
      }
      toast.success(`Generated ${created} new invoices.${skipped > 0 ? ` Skipped ${skipped} already billed.` : ''}`);
      fetchInvoices();
    } catch (err) {
      toast.error('Failed to auto-generate invoices');
    } finally {
      setSubmitting(false);
    }
  };

  const openPaymentModal = (inv) => {
    setSelectedInvoice(inv);
    const remaining = parseFloat(inv.final_amount) - parseFloat(inv.payment_received || 0) - parseFloat(inv.tds_deducted || 0);
    setPaymentForm({
      amount: remaining > 0 ? remaining : '',
      payment_date: format(new Date(), 'yyyy-MM-dd'),
      payment_method: 'bank_transfer',
      reference_number: '',
      tds_deducted: 0,
      notes: ''
    });
    setIsPaymentOpen(true);
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post(`/invoices/${selectedInvoice.id}/payment`, {
        ...paymentForm,
        amount_paid: parseFloat(paymentForm.amount_paid),
      });
      setIsPaymentOpen(false);
      setSelectedInvoice(null);
      fetchInvoices();
    } catch (err) {
      setError(err.message || 'Failed to record payment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteInvoice = async (inv) => {
    const confirmed = await confirmDialog({
      title: 'Delete Invoice',
      message: `Are you sure you want to completely delete invoice ${inv.invoice_number}? This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      setLoading(true);
      await api.delete(`/invoices/${inv.id}`);
      toast.success(`Invoice ${inv.invoice_number} deleted successfully`);
      fetchInvoices();
    } catch (err) {
      toast.error(err.message || 'Failed to delete invoice');
      setLoading(false);
    }
  };

  const handleEmailInvoice = async (inv) => {
    const confirmed = await confirmDialog({
      title: 'Email Invoice',
      message: `Are you sure you want to email invoice ${inv.invoice_number} to ${inv.client_name}?`,
      confirmText: 'Send Email',
      variant: 'teal'
    });
    if (!confirmed) return;
    
    try {
      setLoading(true);
      const res = await api.post(`/invoices/${inv.id}/email`);
      toast.success(res.message || 'Invoice emailed successfully!');
      fetchInvoices();
    } catch (err) {
      toast.error(err.message || 'Failed to email invoice. Please ensure the client has an email address and SMTP is configured.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPDF = async (inv) => {
    try {
      toast.info('Preparing invoice PDF...');
      const res = await api.get(`/invoices/${inv.id}/pdf`, {
        responseType: 'blob'
      });
      const blob = new Blob([res], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Invoice-${inv.invoice_number}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success(`Invoice ${inv.invoice_number} downloaded`);
    } catch (err) {
      console.error('Download error:', err);
      // Fallback: window.open
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      if (token) {
        window.open(`${getApiBaseUrl()}/invoices/${inv.id}/pdf?token=${token}`, '_blank');
      } else {
        toast.error('Failed to download invoice PDF');
      }
    }
  };

  const inputCls = "w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-teal-600" />
            Invoices & Billing
          </h1>
          <p className="text-slate-500 text-sm mt-1">Manage client billing, tax calculations, and payments.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setIsEventOpen(true)}
            className="bg-amber-100 hover:bg-amber-200 text-amber-800 px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-amber-300 flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Event Invoice
          </button>
          <button onClick={handleAutoGenerate} disabled={submitting}
            className="bg-slate-100 hover:bg-slate-200 text-slate-800 px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-slate-300 disabled:opacity-50">
            Auto-Generate Monthly
          </button>
          <button onClick={openCreateModal}
            className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Monthly Invoice
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-semibold">Invoice Details</th>
                <th className="px-6 py-4 font-semibold">Client</th>
                <th className="px-6 py-4 font-semibold">Billing Period</th>
                <th className="px-6 py-4 font-semibold text-right">Amount</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="6">
                    <TableSkeleton columns={6} rows={10} />
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan="6" className="px-6 py-12 text-center text-slate-500">
                  <div className="flex justify-center mb-3"><FileText className="w-10 h-10 text-slate-300" /></div>
                  <p className="font-medium text-slate-600 mb-1">No invoices found</p>
                  <p className="text-xs">Click "Create Invoice" or "Auto-Generate Monthly" to get started.</p>
                </td></tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900 flex items-center gap-2">
                        {inv.invoice_number}
                        {inv.is_ad_hoc ? (
                          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                            Event
                          </span>
                        ) : (
                          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">
                            Monthly
                          </span>
                        )}
                      </div>
                      <div className="text-slate-500 text-xs mt-0.5">Date: {format(new Date(inv.invoice_date), 'MMM dd, yyyy')}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-800">{inv.client_name}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-600 text-xs">
                      {format(new Date(inv.billing_period_start), 'MMM dd')} - {format(new Date(inv.billing_period_end), 'MMM dd, yyyy')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="font-bold text-slate-900">₹{parseFloat(inv.final_amount).toLocaleString('en-IN')}</div>
                      {parseFloat(inv.payment_due) > 0 && (
                        <div className="text-red-500 text-xs mt-0.5 font-medium">Due: ₹{parseFloat(inv.payment_due).toLocaleString('en-IN')}</div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium capitalize border
                        ${inv.status === 'paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          inv.status === 'overdue' ? 'bg-red-50 text-red-700 border-red-200' :
                          inv.status === 'sent' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                          inv.status === 'partially_paid' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          'bg-slate-50 text-slate-700 border-slate-200'}`}>
                        {inv.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => handleDownloadPDF(inv)}
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Download PDF">
                          <Download className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleEmailInvoice(inv)}
                          className="p-1.5 text-slate-500 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors" title="Email Invoice">
                          <Mail className="w-4 h-4" />
                        </button>
                        <button onClick={() => { setSelectedInvoice(inv); setIsEditOpen(true); }}
                          className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="Edit Invoice">
                          <Edit className="w-4 h-4" />
                        </button>
                        {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                          <button onClick={() => openPaymentModal(inv)}
                            className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Record Payment">
                            <CreditCard className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => handleDeleteInvoice(inv)}
                          className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete Invoice">
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
        <Pagination pagination={pagination} onPageChange={setPage} />
      </div>

      {/* Create Invoice Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-slide-up my-6 max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <FileText className="w-5 h-5 text-teal-600" />
                {invoiceForm.invoice_type === 'event' ? 'Create Event Invoice' : 'Create Monthly Invoice'}
              </h3>
              <button onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateInvoice} className="p-6 overflow-y-auto flex-1 space-y-4">
              {error && <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">{error}</div>}
              
              {/* Type Switcher */}
              <div className="flex rounded-lg border border-slate-200 p-1 bg-slate-100">
                <button
                  type="button"
                  onClick={() => setInvoiceForm(prev => ({ ...prev, invoice_type: 'regular' }))}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                    invoiceForm.invoice_type === 'regular'
                      ? 'bg-white text-teal-700 shadow-xs border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Regular (Monthly Contract)
                </button>
                <button
                  type="button"
                  onClick={() => setInvoiceForm(prev => ({ ...prev, invoice_type: 'event' }))}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                    invoiceForm.invoice_type === 'event'
                      ? 'bg-amber-500 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Event (Full Payment)
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Client *</label>
                <select 
                  required 
                  name="client_id" 
                  value={invoiceForm.client_id} 
                  onChange={(e) => {
                    const cid = e.target.value;
                    const selected = clients.find(c => String(c.id) === String(cid));
                    setInvoiceForm(prev => ({
                      ...prev,
                      client_id: cid,
                      ...(selected?.client_type === 'event' ? { invoice_type: 'event' } : {})
                    }));
                  }} 
                  className={inputCls}
                >
                  <option value="">-- Select Client --</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.client_type === 'event' ? '(Event Client)' : `(₹${parseFloat(c.monthly_rate).toLocaleString('en-IN')}/mo)`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Invoice Date *</label>
                <input 
                  required 
                  type="date" 
                  value={invoiceForm.invoice_date || ''} 
                  onChange={(e) => setInvoiceForm(prev => ({ ...prev, invoice_date: e.target.value }))} 
                  className={inputCls} 
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-slate-700">
                    {invoiceForm.invoice_type === 'event' ? 'Event Duration *' : 'Billing Period *'}
                  </label>
                  {invoiceForm.invoice_type !== 'event' && (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => setMonthPreset(0)} className="text-[11px] font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 px-2 py-0.5 rounded transition-colors">This Month</button>
                      <button type="button" onClick={() => setMonthPreset(-1)} className="text-[11px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded transition-colors">Last Month</button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[11px] text-slate-500 mb-0.5 block">Start Date</span>
                    <input 
                      required 
                      type="date" 
                      value={invoiceForm.billing_period_start || ''} 
                      onChange={(e) => setInvoiceForm(prev => ({ ...prev, billing_period_start: e.target.value }))} 
                      className={inputCls} 
                    />
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500 mb-0.5 block">End Date</span>
                    <input 
                      required 
                      type="date" 
                      value={invoiceForm.billing_period_end || ''} 
                      onChange={(e) => setInvoiceForm(prev => ({ ...prev, billing_period_end: e.target.value }))} 
                      className={inputCls} 
                    />
                  </div>
                </div>
              </div>

              {/* Event-specific Pricing */}
              {invoiceForm.invoice_type === 'event' && (
                <div className="bg-amber-50/70 p-3.5 rounded-xl border border-amber-200 space-y-3">
                  <div className="text-xs font-bold text-amber-900 uppercase tracking-wide">
                    Event Pricing (Full Payment - No Proration)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Fixed Lump-Sum Amount (₹)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="e.g. 50000"
                        value={invoiceForm.fixed_amount || ''}
                        onChange={e => setInvoiceForm(prev => ({ ...prev, fixed_amount: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Or Days Worked</label>
                      <input
                        type="number"
                        min="1"
                        placeholder="e.g. 10"
                        value={invoiceForm.duty_days_worked || ''}
                        onChange={e => setInvoiceForm(prev => ({ ...prev, duty_days_worked: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                  </div>
                  {(!invoiceForm.fixed_amount || parseFloat(invoiceForm.fixed_amount) <= 0) && (
                    <div className="grid grid-cols-2 gap-3 pt-1 border-t border-amber-200/60">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Guards Count</label>
                        <input
                          type="number"
                          min="1"
                          placeholder="e.g. 2"
                          value={invoiceForm.guards_count || ''}
                          onChange={e => setInvoiceForm(prev => ({ ...prev, guards_count: e.target.value }))}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Rate / Guard / Day (₹)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="e.g. 500"
                          value={invoiceForm.rate_per_guard || ''}
                          onChange={e => setInvoiceForm(prev => ({ ...prev, rate_per_guard: e.target.value }))}
                          className={inputCls}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tax Configuration */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Tax Configuration</label>
                <div className="grid grid-cols-3 gap-2">
                  <label className={`flex flex-col p-2.5 rounded-lg border text-center cursor-pointer transition-all ${
                    invoiceForm.tax_type === 'none' ? 'bg-teal-50 border-teal-500 ring-1 ring-teal-500' : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}>
                    <input type="radio" name="monthly_tax_type" value="none" checked={invoiceForm.tax_type === 'none'} onChange={e => setInvoiceForm(prev => ({...prev, tax_type: e.target.value}))} className="sr-only" />
                    <span className="text-xs font-bold text-slate-800">No GST</span>
                    <span className="text-[10px] text-slate-500">0%</span>
                  </label>
                  <label className={`flex flex-col p-2.5 rounded-lg border text-center cursor-pointer transition-all ${
                    invoiceForm.tax_type === 'cgst_sgst' ? 'bg-teal-50 border-teal-500 ring-1 ring-teal-500' : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}>
                    <input type="radio" name="monthly_tax_type" value="cgst_sgst" checked={invoiceForm.tax_type === 'cgst_sgst'} onChange={e => setInvoiceForm(prev => ({...prev, tax_type: e.target.value}))} className="sr-only" />
                    <span className="text-xs font-bold text-slate-800">Intra-State</span>
                    <span className="text-[10px] text-slate-500">9% CGST + 9% SGST</span>
                  </label>
                  <label className={`flex flex-col p-2.5 rounded-lg border text-center cursor-pointer transition-all ${
                    invoiceForm.tax_type === 'igst' ? 'bg-teal-50 border-teal-500 ring-1 ring-teal-500' : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}>
                    <input type="radio" name="monthly_tax_type" value="igst" checked={invoiceForm.tax_type === 'igst'} onChange={e => setInvoiceForm(prev => ({...prev, tax_type: e.target.value}))} className="sr-only" />
                    <span className="text-xs font-bold text-slate-800">Inter-State</span>
                    <span className="text-[10px] text-slate-500">18% IGST</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Discount (₹)</label>
                <input 
                  type="number" 
                  min="0" 
                  step="0.01" 
                  value={invoiceForm.discount_amount} 
                  onChange={(e) => setInvoiceForm(prev => ({ ...prev, discount_amount: e.target.value }))} 
                  className={inputCls} 
                />
              </div>

              <div className="flex items-center p-3 bg-amber-50 rounded-lg border border-amber-200">
                <input 
                  type="checkbox" 
                  id="monthly_rcm" 
                  checked={invoiceForm.is_rcm_applicable} 
                  onChange={e => setInvoiceForm(prev => ({...prev, is_rcm_applicable: e.target.checked}))} 
                  className="h-4 w-4 text-amber-600 focus:ring-amber-500 rounded border-amber-300 cursor-pointer" 
                />
                <label htmlFor="monthly_rcm" className="ml-2 block text-xs font-semibold text-amber-900 cursor-pointer">
                  Apply RCM (Reverse Charge Mechanism - GST paid by client)
                </label>
              </div>

              {/* Live Preview Summary */}
              {invoiceForm.client_id && (() => {
                const selectedClient = clients.find(c => String(c.id) === String(invoiceForm.client_id));
                const isEvent = invoiceForm.invoice_type === 'event';
                
                let baseAmount = 0;
                if (isEvent) {
                  if (invoiceForm.fixed_amount && parseFloat(invoiceForm.fixed_amount) > 0) {
                    baseAmount = parseFloat(invoiceForm.fixed_amount);
                  } else if (invoiceForm.guards_count && invoiceForm.rate_per_guard && invoiceForm.duty_days_worked) {
                    baseAmount = parseFloat(invoiceForm.guards_count) * parseFloat(invoiceForm.rate_per_guard) * parseFloat(invoiceForm.duty_days_worked);
                  } else {
                    baseAmount = parseFloat(selectedClient?.monthly_rate || 0);
                  }
                } else {
                  baseAmount = parseFloat(selectedClient?.monthly_rate || 0);
                }

                const disc = parseFloat(invoiceForm.discount_amount || 0);
                const taxable = Math.max(0, baseAmount - disc);
                let tax = 0;
                if (invoiceForm.tax_type === 'cgst_sgst' || invoiceForm.tax_type === 'igst') {
                  tax = taxable * 0.18;
                }
                const total = invoiceForm.is_rcm_applicable ? taxable : (taxable + tax);

                return (
                  <div className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${isEvent ? 'bg-amber-50/70 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex justify-between items-center pb-1 border-b border-slate-200/80">
                      <span className="font-bold text-slate-800">
                        {isEvent ? '⚡ Full Event Payment:' : 'Contract Monthly Rate:'}
                      </span>
                      <span className="font-bold text-slate-900">
                        ₹{baseAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        {isEvent && <span className="ml-1 text-[10px] text-amber-800 bg-amber-200 px-1 py-0.5 rounded font-normal">No Proration</span>}
                      </span>
                    </div>
                    {disc > 0 && (
                      <div className="flex justify-between text-amber-700">
                        <span>Discount:</span>
                        <span className="font-semibold">- ₹{disc.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-600">
                      <span>Tax ({invoiceForm.tax_type === 'cgst_sgst' ? '18% CGST+SGST' : invoiceForm.tax_type === 'igst' ? '18% IGST' : '0%'}):</span>
                      <span className="font-semibold text-slate-800">{invoiceForm.is_rcm_applicable ? '₹0 (RCM)' : `₹${tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}</span>
                    </div>
                    <div className={`flex justify-between text-sm font-bold pt-1.5 border-t border-slate-200 ${isEvent ? 'text-amber-900' : 'text-teal-800'}`}>
                      <span>Billed Total:</span>
                      <span>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea 
                  value={invoiceForm.notes} 
                  onChange={(e) => setInvoiceForm(prev => ({ ...prev, notes: e.target.value }))} 
                  rows="2" 
                  className={inputCls} 
                  placeholder="Optional notes..." 
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setIsCreateOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="px-5 py-2 text-sm font-bold text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-md disabled:opacity-50">
                  {submitting ? 'Creating...' : 'Create Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {isPaymentOpen && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          {/* ... existing payment modal ... */}
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-teal-600" /> Record Payment
              </h3>
              <button onClick={() => setIsPaymentOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleRecordPayment} className="p-6">
              {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}
              <div className="mb-4 p-3 bg-slate-50 rounded-lg text-sm">
                <p className="font-medium text-slate-800">{selectedInvoice.invoice_number} — {selectedInvoice.client_name}</p>
                <p className="text-slate-500 mt-1">Total: ₹{parseFloat(selectedInvoice.final_amount).toLocaleString('en-IN')} | Received: ₹{parseFloat(selectedInvoice.payment_received || 0).toLocaleString('en-IN')}</p>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Amount Received *</label>
                    <input required type="number" min="0.01" step="0.01" value={paymentForm.amount_paid} onChange={(e) => setPaymentForm({ ...paymentForm, amount_paid: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">TDS Deducted (₹)</label>
                    <input type="number" min="0" step="0.01" value={paymentForm.tds_deducted} onChange={(e) => setPaymentForm({ ...paymentForm, tds_deducted: e.target.value })} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Method *</label>
                    <select required value={paymentForm.payment_method} onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })} className={inputCls}>
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="upi">UPI</option>
                      <option value="cash">Cash</option>
                      <option value="cheque">Cheque</option>
                      <option value="card">Card</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                    <input type="date" value={paymentForm.payment_date} onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })} className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Transaction Reference</label>
                  <input type="text" value={paymentForm.transaction_reference} onChange={(e) => setPaymentForm({ ...paymentForm, transaction_reference: e.target.value })} className={inputCls} />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-slate-100">
                <button type="button" onClick={() => setIsPaymentOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 shadow-sm disabled:opacity-50">
                  {submitting ? 'Recording...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ad-Hoc Event Invoice Modal */}
      <EventInvoiceModal 
        isOpen={isEventOpen} 
        onClose={() => setIsEventOpen(false)} 
        onSuccess={() => {
          setIsEventOpen(false);
          fetchInvoices();
        }} 
      />

      {/* Edit Invoice Modal */}
      <EditInvoiceModal 
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        invoice={selectedInvoice}
        onSuccess={() => {
          setIsEditOpen(false);
          fetchInvoices();
        }}
      />
    </div>
  );
}
