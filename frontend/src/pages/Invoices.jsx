import { useState, useEffect } from 'react';
import { FileText, Plus, Search, Download, CreditCard, Clock, X, Mail, Trash2, Zap, Edit, Shield, Users, CheckCircle2, AlertTriangle, Eye, XCircle } from 'lucide-react';
import api from '../services/api';
import { format } from 'date-fns';
import Pagination from '../components/Pagination';
import TableSkeleton from '../components/TableSkeleton';
import EventInvoiceModal from '../components/EventInvoiceModal';
import EditInvoiceModal from '../components/EditInvoiceModal';
import BillViewModal from '../components/BillViewModal';
import { getApiBaseUrl } from '../utils/apiUrl';
import { toast, confirmDialog } from '../context/ToastContext';

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEventOpen, setIsEventOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [viewingInvoice, setViewingInvoice] = useState(null);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [clients, setClients] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);

  const [attendanceSummary, setAttendanceSummary] = useState(null);
  const [fetchingAttendance, setFetchingAttendance] = useState(false);

  const [invoiceForm, setInvoiceForm] = useState({
    invoice_number: '', client_id: '', billing_period_start: '', billing_period_end: '',
    site_name: '', bank_account_id: '', particular: 'Security Guard',
    tax_type: 'none', is_rcm_applicable: false, discount_amount: '0', notes: '',
    absent_guard_days: 0, absence_deduction: 0,
    bill_items: []
  });

  const handleBillItemChange = (index, field, value) => {
    setInvoiceForm(prev => {
      const updated = [...(prev.bill_items || [])];
      const row = { ...updated[index], [field]: value };

      if (field === 'monthly_rate') {
        const m = parseFloat(value);
        if (m > 0) {
          const daily = parseFloat((m / 31).toFixed(2));
          row.rate_per_day = daily;
          if (row.total_duty_days) {
            row.amount = parseFloat((daily * (parseInt(row.total_duty_days) || 0)).toFixed(2));
          }
        }
      } else if (field === 'rate_per_day' || field === 'total_duty_days') {
        const r = parseFloat(field === 'rate_per_day' ? value : row.rate_per_day) || 0;
        const d = parseInt(field === 'total_duty_days' ? value : row.total_duty_days) || 0;
        if (r > 0 && d > 0) {
          row.amount = parseFloat((r * d).toFixed(2));
        }
      } else if (field === 'guards_count') {
        const cnt = parseInt(value) || 1;
        row.total_duty_days = cnt * 31;
        const r = parseFloat(row.rate_per_day) || 0;
        if (r > 0) {
          row.amount = parseFloat((r * row.total_duty_days).toFixed(2));
        }
      }

      updated[index] = row;
      const totalAmt = updated.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
      const totalGuards = updated.reduce((s, it) => s + (parseInt(it.guards_count) || 0), 0);
      const totalDays = updated.reduce((s, it) => s + (parseInt(it.total_duty_days) || 0), 0);

      return {
        ...prev,
        bill_items: updated,
        amount_subtotal: totalAmt > 0 ? totalAmt.toFixed(2) : prev.amount_subtotal,
        guards_count: totalGuards || prev.guards_count,
        total_duty_days: totalDays || prev.total_duty_days
      };
    });
  };

  const handleAddBillItem = () => {
    setInvoiceForm(prev => {
      const current = prev.bill_items || [];
      const updated = [
        ...current,
        {
          particular: 'Security Guard',
          monthly_rate: '',
          guards_count: 1,
          rate_per_day: '',
          hsn_code: '998525',
          total_duty_days: 31,
          amount: ''
        }
      ];
      return { ...prev, bill_items: updated };
    });
  };

  const handleRemoveBillItem = (index) => {
    setInvoiceForm(prev => {
      const current = prev.bill_items || [];
      if (current.length <= 1) return prev;
      const updated = current.filter((_, i) => i !== index);
      const totalAmt = updated.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
      return {
        ...prev,
        bill_items: updated,
        amount_subtotal: totalAmt > 0 ? totalAmt.toFixed(2) : prev.amount_subtotal
      };
    });
  };

  const [paymentForm, setPaymentForm] = useState({
    amount_paid: '', tds_deducted: '0', payment_method: 'bank_transfer', payment_date: format(new Date(), 'yyyy-MM-dd'),
    transaction_reference: '', notes: ''
  });

  const fetchAttendanceSummary = async (clientId, startDate, endDate) => {
    if (!clientId || !startDate || !endDate) {
      setAttendanceSummary(null);
      return;
    }
    try {
      setFetchingAttendance(true);
      const res = await api.get(`/clients/${clientId}/attendance-summary?start_date=${startDate}&end_date=${endDate}`);
      const summary = res.data;
      if (summary) {
        setAttendanceSummary(summary);
        setInvoiceForm(prev => {
          let baseSubtotal = 0;
          if (Array.isArray(prev.bill_items) && prev.bill_items.length > 0) {
            baseSubtotal = prev.bill_items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
          }
          if (baseSubtotal <= 0 && prev.amount_subtotal !== '' && !isNaN(parseFloat(prev.amount_subtotal)) && parseFloat(prev.amount_subtotal) > 0) {
            baseSubtotal = parseFloat(prev.amount_subtotal);
          }
          if (baseSubtotal <= 0) {
            baseSubtotal = parseFloat(summary.total_contracted_amount) || parseFloat(summary.net_billable_amount) || 0;
          }

          const absentDays = parseFloat(summary.absent_guard_days) || 0;
          const absenceDed = parseFloat(summary.absence_deduction) || 0;

          // Only deduct if there are actual recorded absent days
          const finalSub = absentDays > 0 ? Math.max(0, baseSubtotal - absenceDed) : baseSubtotal;

          return {
            ...prev,
            amount_subtotal: finalSub > 0 ? finalSub.toFixed(2) : (baseSubtotal > 0 ? baseSubtotal.toFixed(2) : prev.amount_subtotal),
            absent_guard_days: absentDays,
            absence_deduction: absenceDed
          };
        });
      }
    } catch (err) {
      console.error('Failed to fetch attendance summary', err);
      setAttendanceSummary(null);
    } finally {
      setFetchingAttendance(false);
    }
  };

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

  const fetchBankAccounts = async () => {
    try {
      const res = await api.get('/bank-accounts');
      const all = res.data || [];
      const active = all.filter(b => b.is_active);
      setBankAccounts(active);
      return active;
    } catch (err) {
      console.error('Failed to fetch bank accounts', err);
      return [];
    }
  };

  useEffect(() => {
    fetchInvoices();
    fetchClients();
    fetchBankAccounts();
  }, [page]);

  const fetchClients = async () => {
    try {
      const res = await api.get('/clients?limit=200');
      const all = res.data || [];
      setClients(all.filter(c => c.is_active));
      return all.filter(c => c.is_active);
    } catch (err) {
      console.error('Failed to fetch clients', err);
      return [];
    }
  };

  const openCreateModal = async () => {
    await fetchClients();
    const accounts = await fetchBankAccounts();
    const indusind = accounts.find(b => b.bank_name?.toLowerCase().includes('indusind'));
    const defaultBankId = indusind ? indusind.id : (accounts[0]?.id || '');
    const now = new Date();
    const startOfMonth = format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
    const endOfMonth = format(new Date(now.getFullYear(), now.getMonth() + 1, 0), 'yyyy-MM-dd');
    const todayStr = format(now, 'yyyy-MM-dd');

    setAttendanceSummary(null);
    setInvoiceForm({
      invoice_number: 'EES',
      client_id: '',
      site_name: '',
      bank_account_id: defaultBankId,
      particular: 'Security Guard',
      hsn_code: '998525',
      invoice_type: 'regular',
      invoice_date: todayStr,
      billing_period_start: startOfMonth,
      billing_period_end: endOfMonth,
      amount_subtotal: '',
      monthly_rate: '',
      rate_per_day: '',
      guards_count: '',
      total_duty_days: '',
      tax_type: 'none',
      is_rcm_applicable: false,
      discount_amount: '0',
      notes: '',
      fixed_amount: '',
      duty_days_worked: '',
      absent_guard_days: 0,
      absence_deduction: 0,
      bill_items: []
    });
    setError('');
    setIsCreateOpen(true);
  };

  const setMonthPreset = (offsetMonths = 0) => {
    const d = new Date();
    d.setMonth(d.getMonth() + offsetMonths);
    const start = format(new Date(d.getFullYear(), d.getMonth(), 1), 'yyyy-MM-dd');
    const end = format(new Date(d.getFullYear(), d.getMonth() + 1, 0), 'yyyy-MM-dd');
    setInvoiceForm(prev => {
      const next = {
        ...prev,
        billing_period_start: start,
        billing_period_end: end
      };
      if (next.invoice_type === 'regular' && next.client_id) {
        fetchAttendanceSummary(next.client_id, start, end);
      }
      return next;
    });
  };

  const handleCreateInvoice = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        ...invoiceForm,
        discount_amount: parseFloat(invoiceForm.discount_amount) || 0,
        absent_guard_days: parseFloat(invoiceForm.absent_guard_days) || 0,
        absence_deduction: parseFloat(invoiceForm.absence_deduction) || 0
      };
      if (Array.isArray(invoiceForm.bill_items) && invoiceForm.bill_items.length > 0) {
        payload.bill_items = invoiceForm.bill_items;
      }
      if (invoiceForm.invoice_number && invoiceForm.invoice_number.trim()) {
        payload.invoice_number = invoiceForm.invoice_number.trim().toUpperCase();
      }
      if (invoiceForm.bank_account_id) {
        payload.bank_account_id = parseInt(invoiceForm.bank_account_id, 10);
      }
      if (invoiceForm.guards_count) {
        payload.guards_count = parseInt(invoiceForm.guards_count, 10);
      }
      if (invoiceForm.rate_per_day) {
        payload.rate_per_day = parseFloat(invoiceForm.rate_per_day);
      }
      if (invoiceForm.monthly_rate) {
        payload.monthly_rate = parseFloat(invoiceForm.monthly_rate);
      }
      if (invoiceForm.total_duty_days) {
        payload.total_duty_days = parseInt(invoiceForm.total_duty_days, 10);
      }
      if (invoiceForm.amount_subtotal !== '' && !isNaN(parseFloat(invoiceForm.amount_subtotal))) {
        payload.amount_subtotal = parseFloat(invoiceForm.amount_subtotal);
      }
      if (invoiceForm.invoice_type === 'event') {
        payload.is_ad_hoc = 1;
        if (invoiceForm.fixed_amount) {
          payload.fixed_amount = parseFloat(invoiceForm.fixed_amount);
        }
        if (invoiceForm.rate_per_guard) payload.rate_per_guard = parseFloat(invoiceForm.rate_per_guard);
        if (invoiceForm.duty_days_worked) payload.duty_days_worked = parseInt(invoiceForm.duty_days_worked, 10);
      }
      await api.post('/invoices', payload);
      toast.success('Single bill generated successfully');
      setIsCreateOpen(false);
      fetchInvoices();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to create invoice');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelInvoice = async (inv) => {
    const confirmed = await confirmDialog({
      title: 'Cancel Invoice',
      message: `Are you sure you want to cancel invoice ${inv.invoice_number}? This will mark it as cancelled with zero balance due.`,
      confirmText: 'Cancel Invoice',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      setLoading(true);
      await api.post(`/invoices/${inv.id}/cancel`);
      toast.success(`Invoice ${inv.invoice_number} cancelled successfully`);
      fetchInvoices();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to cancel invoice');
      setLoading(false);
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
    const remaining = Math.max(0, parseFloat(inv.final_amount) - parseFloat(inv.payment_received || 0) - parseFloat(inv.tds_deducted || 0));
    const remVal = remaining > 0 ? (Math.round(remaining * 100) / 100) : '';
    setPaymentForm({
      amount: remVal,
      amount_paid: remVal,
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
      const paidVal = paymentForm.amount_paid !== undefined && paymentForm.amount_paid !== '' 
        ? parseFloat(paymentForm.amount_paid) 
        : parseFloat(paymentForm.amount || 0);
      await api.post(`/invoices/${selectedInvoice.id}/payment`, {
        ...paymentForm,
        amount_paid: paidVal,
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
            title="Generate a manual single bill for a client"
            className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Generate Single Bill
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
                        <button
                          type="button"
                          onClick={() => { setViewingInvoice(inv); setIsViewOpen(true); }}
                          className="hover:text-teal-600 hover:underline font-bold text-left cursor-pointer transition-colors"
                          title="Click to view full bill format"
                        >
                          {inv.invoice_number}
                        </button>
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
                      {inv.site_name && (
                        <div className="text-[11px] text-slate-500 mt-0.5 font-normal">Site: {inv.site_name}</div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-800">{inv.client_name}</div>
                      {inv.notes && inv.notes.includes('Deduction:') && (
                        <div className="text-[11px] text-amber-700 font-medium mt-0.5">
                          {inv.notes.substring(inv.notes.indexOf('[Guards:'), inv.notes.indexOf(']') + 1)}
                        </div>
                      )}
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
                          inv.status === 'cancelled' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                          'bg-slate-50 text-slate-700 border-slate-200'}`}>
                        {inv.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => { setViewingInvoice(inv); setIsViewOpen(true); }}
                          className="p-1.5 text-slate-500 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors" title="View Bill Format">
                          <Eye className="w-4 h-4" />
                        </button>
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
                        {inv.status !== 'cancelled' && (
                          <button onClick={() => handleCancelInvoice(inv)}
                            className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Cancel Invoice">
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in overflow-hidden">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden animate-slide-up my-auto max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <FileText className="w-5 h-5 text-teal-600" />
                Generate Single Bill
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 ml-1">
                  {invoiceForm.invoice_type === 'event' ? 'Event / Ad-Hoc' : 'Regular Contract'}
                </span>
              </h3>
              <button onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateInvoice} className="flex-1 flex flex-col overflow-hidden min-h-0">
              <div className="p-6 overflow-y-auto flex-1 space-y-4">
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
                    const isEvent = selected?.client_type === 'event';
                    
                    let items = [];
                    if (selected?.guard_categories) {
                      try {
                        const cats = typeof selected.guard_categories === 'string' ? JSON.parse(selected.guard_categories) : selected.guard_categories;
                        if (Array.isArray(cats) && cats.length > 0) {
                          items = cats.map(c => {
                            const cnt = parseInt(c.guards_count) || 1;
                            const mRate = parseFloat(c.monthly_rate) || 0;
                            const dRate = parseFloat(c.rate_per_day) || (mRate > 0 ? parseFloat((mRate / 31).toFixed(2)) : 0);
                            const dutyDays = cnt * 31;
                            const amt = dRate > 0 ? parseFloat((dRate * dutyDays).toFixed(2)) : mRate;
                            return {
                              particular: c.role || 'Security Guard',
                              monthly_rate: mRate || '',
                              guards_count: cnt,
                              rate_per_day: dRate || '',
                              hsn_code: c.hsn_code || '998525',
                              total_duty_days: dutyDays,
                              amount: amt || ''
                            };
                          });
                        }
                      } catch (_) {}
                    }

                    const guardsCount = selected?.employee_count || 1;
                    const mRate = selected?.monthly_rate || '';
                    const dRate = selected?.rate_per_day || (mRate ? (parseFloat(mRate) / 31).toFixed(2) : '');
                    const dutyDays = guardsCount * 31;

                    if (items.length === 0) {
                      items = [{
                        particular: 'Security Guard',
                        monthly_rate: mRate || '',
                        guards_count: guardsCount,
                        rate_per_day: dRate || '',
                        hsn_code: '998525',
                        total_duty_days: dutyDays,
                        amount: selected?.monthly_rate !== undefined ? selected.monthly_rate : ''
                      }];
                    }

                    const itemsSubtotal = items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);

                    setInvoiceForm(prev => ({
                      ...prev,
                      client_id: cid,
                      site_name: prev.site_name || selected?.site_name || selected?.name || '',
                      guards_count: items.reduce((s, it) => s + (parseInt(it.guards_count) || 0), 0) || guardsCount,
                      monthly_rate: mRate,
                      rate_per_day: dRate,
                      total_duty_days: items.reduce((s, it) => s + (parseInt(it.total_duty_days) || 0), 0) || dutyDays,
                      bill_items: items,
                      amount_subtotal: itemsSubtotal > 0 ? itemsSubtotal.toFixed(2) : (selected?.monthly_rate !== undefined ? selected.monthly_rate : prev.amount_subtotal),
                      ...(isEvent ? { invoice_type: 'event' } : {})
                    }));
                    if (!isEvent && cid && invoiceForm.billing_period_start && invoiceForm.billing_period_end) {
                      fetchAttendanceSummary(cid, invoiceForm.billing_period_start, invoiceForm.billing_period_end);
                    } else {
                      setAttendanceSummary(null);
                    }
                  }} 
                  className={inputCls}
                >
                  <option value="">-- Select Client --</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.client_type === 'event' ? '(Event Client)' : `(${c.employee_count || 1} Guards • ₹${parseFloat(c.monthly_rate).toLocaleString('en-IN')}/mo)`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Invoice No. * <span className="text-xs text-slate-400 font-normal">(e.g. EES34)</span>
                  </label>
                  <input 
                    required 
                    type="text" 
                    placeholder="EES34"
                    value={invoiceForm.invoice_number} 
                    onChange={(e) => setInvoiceForm(prev => ({ ...prev, invoice_number: e.target.value.toUpperCase() }))} 
                    className={inputCls} 
                  />
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Prefix 'EES' followed by number. Auto-increment is stopped for manual bill entry.
                  </span>
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
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Site Name *</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Masterpiece & Vadavi"
                    value={invoiceForm.site_name} 
                    onChange={(e) => setInvoiceForm(prev => ({ ...prev, site_name: e.target.value }))} 
                    className={inputCls} 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Payment Bank Account *</label>
                  <select
                    value={invoiceForm.bank_account_id}
                    onChange={(e) => setInvoiceForm(prev => ({ ...prev, bank_account_id: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">-- Default Firm Bank --</option>
                    {bankAccounts.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.bank_name} - {b.account_number}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {invoiceForm.invoice_type === 'event' ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Particular</label>
                    <input 
                      type="text" 
                      placeholder="Security Guard"
                      value={invoiceForm.particular} 
                      onChange={(e) => setInvoiceForm(prev => ({ ...prev, particular: e.target.value }))} 
                      className={inputCls} 
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">HSN Code</label>
                    <input 
                      type="text" 
                      placeholder="998525"
                      value={invoiceForm.hsn_code} 
                      onChange={(e) => setInvoiceForm(prev => ({ ...prev, hsn_code: e.target.value }))} 
                      className={inputCls} 
                    />
                  </div>
                </div>
              ) : (
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-teal-600" />
                        Guard Categories & Bill Item Breakdown
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Bifurcation matching the bill format (Supervisor, Guard, Lady Guard, etc.). Total Day × Rate = Amount.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddBillItem}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Category Row
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border border-slate-200 rounded-lg bg-white overflow-hidden">
                      <thead className="bg-slate-100 text-slate-700 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200">
                        <tr>
                          <th className="p-2 text-center w-10">No.</th>
                          <th className="p-2 min-w-[150px]">Particular</th>
                          <th className="p-2 text-center min-w-[100px]">Per Day Rate (₹)</th>
                          <th className="p-2 text-center w-16">No. of</th>
                          <th className="p-2 text-center min-w-[90px]">Rate (Daily ₹)</th>
                          <th className="p-2 text-center w-20">HSN</th>
                          <th className="p-2 text-center min-w-[85px]">Total Day</th>
                          <th className="p-2 text-right min-w-[100px]">Amount (₹)</th>
                          <th className="p-2 text-center w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(invoiceForm.bill_items && invoiceForm.bill_items.length > 0
                          ? invoiceForm.bill_items
                          : [{ particular: invoiceForm.particular || 'Security Guard', monthly_rate: invoiceForm.monthly_rate || '', guards_count: invoiceForm.guards_count || 1, rate_per_day: invoiceForm.rate_per_day || '', hsn_code: invoiceForm.hsn_code || '998525', total_duty_days: invoiceForm.total_duty_days || 31, amount: invoiceForm.amount_subtotal || '' }]
                        ).map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/80">
                            <td className="p-2 text-center font-bold text-slate-500">
                              {String(idx + 1).padStart(2, '0')}
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                list={`particular-suggestions-${idx}`}
                                value={item.particular || ''}
                                onChange={(e) => handleBillItemChange(idx, 'particular', e.target.value)}
                                placeholder="e.g. Security Supervisor"
                                className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-teal-500 font-medium"
                              />
                              <datalist id={`particular-suggestions-${idx}`}>
                                <option value="Security Supervisor" />
                                <option value="Security Guard" />
                                <option value="Security Lady Guard" />
                                <option value="Gunman" />
                                <option value="Bouncer" />
                                <option value="Head Guard" />
                              </datalist>
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.monthly_rate || ''}
                                onChange={(e) => handleBillItemChange(idx, 'monthly_rate', e.target.value)}
                                placeholder="23000"
                                title="Monthly rate (Per Day Rate column)"
                                className="w-full px-2 py-1 text-xs text-center border border-slate-200 rounded focus:ring-1 focus:ring-teal-500"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min="1"
                                value={item.guards_count || ''}
                                onChange={(e) => handleBillItemChange(idx, 'guards_count', e.target.value)}
                                placeholder="1"
                                className="w-full px-1.5 py-1 text-xs text-center border border-slate-200 rounded focus:ring-1 focus:ring-teal-500 font-semibold"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.rate_per_day || ''}
                                onChange={(e) => handleBillItemChange(idx, 'rate_per_day', e.target.value)}
                                placeholder="742.00"
                                className="w-full px-2 py-1 text-xs text-center border border-slate-200 rounded focus:ring-1 focus:ring-teal-500"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={item.hsn_code || '998525'}
                                onChange={(e) => handleBillItemChange(idx, 'hsn_code', e.target.value)}
                                className="w-full px-1.5 py-1 text-xs text-center border border-slate-200 rounded focus:ring-1 focus:ring-teal-500"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min="0"
                                value={item.total_duty_days ?? ''}
                                onChange={(e) => handleBillItemChange(idx, 'total_duty_days', e.target.value)}
                                placeholder="31"
                                title="Net duty days worked (lower this for absences e.g. 58 instead of 62)"
                                className="w-full px-2 py-1 text-xs text-center border border-slate-200 rounded focus:ring-1 focus:ring-teal-500 font-bold text-slate-800"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.amount || ''}
                                onChange={(e) => handleBillItemChange(idx, 'amount', e.target.value)}
                                placeholder="0.00"
                                className="w-full px-2 py-1 text-xs text-right border border-slate-200 rounded focus:ring-1 focus:ring-teal-500 font-bold text-slate-900"
                              />
                            </td>
                            <td className="p-2 text-center">
                              {(invoiceForm.bill_items || []).length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveBillItem(idx)}
                                  className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                                  title="Delete row"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center justify-between text-xs text-slate-600 bg-white p-2.5 rounded-lg border border-slate-200">
                    <span className="flex items-center gap-1 text-[11px] text-teal-800 font-medium">
                      💡 <strong>Absences:</strong> Adjust <em>Total Day</em> per category (e.g. 58 days instead of 62). Row amount automatically recalculates!
                    </span>
                    <span className="font-bold text-slate-800">
                      Total Calculated: <span className="text-teal-700 text-sm">₹{parseFloat(invoiceForm.amount_subtotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </span>
                  </div>
                </div>
              )}

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
                      onChange={(e) => {
                        const start = e.target.value;
                        setInvoiceForm(prev => ({ ...prev, billing_period_start: start }));
                        if (invoiceForm.invoice_type === 'regular' && invoiceForm.client_id && invoiceForm.billing_period_end) {
                          fetchAttendanceSummary(invoiceForm.client_id, start, invoiceForm.billing_period_end);
                        }
                      }} 
                      className={inputCls} 
                    />
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-500 mb-0.5 block">End Date</span>
                    <input 
                      required 
                      type="date" 
                      value={invoiceForm.billing_period_end || ''} 
                      onChange={(e) => {
                        const end = e.target.value;
                        setInvoiceForm(prev => ({ ...prev, billing_period_end: end }));
                        if (invoiceForm.invoice_type === 'regular' && invoiceForm.client_id && invoiceForm.billing_period_start) {
                          fetchAttendanceSummary(invoiceForm.client_id, invoiceForm.billing_period_start, end);
                        }
                      }} 
                      className={inputCls} 
                    />
                  </div>
                </div>
              </div>

              {/* Guard Attendance & Absence Deductions Card */}
              {invoiceForm.invoice_type === 'regular' && invoiceForm.client_id && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold text-xs text-slate-800 uppercase tracking-wide">
                      <Shield className="w-4 h-4 text-teal-600" />
                      Guard Attendance & Absence Deductions
                    </div>
                    {fetchingAttendance ? (
                      <span className="text-[11px] text-teal-600 font-medium animate-pulse">Calculating attendance...</span>
                    ) : attendanceSummary ? (
                      <span className="text-[11px] font-semibold text-slate-600">
                        {attendanceSummary.guards_count || attendanceSummary.employee_count || 1} Guard{(attendanceSummary.guards_count || attendanceSummary.employee_count || 1) > 1 ? 's' : ''} deployed
                      </span>
                    ) : null}
                  </div>

                  {attendanceSummary && (
                    <>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="p-2 bg-white rounded-lg border border-slate-200">
                          <div className="text-slate-500 text-[10px]">Contracted</div>
                          <div className="font-bold text-slate-800">{attendanceSummary.contracted_guard_days} days</div>
                        </div>
                        <div className="p-2 bg-emerald-50/60 rounded-lg border border-emerald-200 text-emerald-800">
                          <div className="text-emerald-600 text-[10px]">Present</div>
                          <div className="font-bold">{attendanceSummary.present_guard_days} days</div>
                        </div>
                        <div className={`p-2 rounded-lg border text-xs ${attendanceSummary.absent_guard_days > 0 ? 'bg-amber-50 border-amber-300 text-amber-900 font-bold' : 'bg-white border-slate-200 text-slate-600'}`}>
                          <div className="text-[10px] text-slate-500">Absent</div>
                          <div className="font-bold">{attendanceSummary.absent_guard_days} days</div>
                        </div>
                      </div>

                      {attendanceSummary.absent_guard_days > 0 ? (
                        <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-900 space-y-1">
                          <div className="flex justify-between items-center font-bold">
                            <span className="flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                              Absence Deduction Applied:
                            </span>
                            <span className="text-red-700 font-bold">
                              - ₹{parseFloat(attendanceSummary.absence_deduction || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="text-[11px] text-amber-800">
                            {attendanceSummary.absent_guard_days} absent guard-days × ₹{parseFloat(attendanceSummary.rate_per_day_per_guard || 0).toLocaleString('en-IN')}/day/guard deducted from contracted ₹{parseFloat(attendanceSummary.total_contracted_amount || 0).toLocaleString('en-IN')}.
                          </div>
                        </div>
                      ) : (
                        <div className="p-2 bg-emerald-50 rounded-lg border border-emerald-200 text-xs text-emerald-800 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>
                            {attendanceSummary.has_records 
                              ? '100% Attendance for all assigned guards. No absence deductions applied.' 
                              : 'Full monthly contract active (0 absent days). No absence deductions recorded.'}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Regular Single Bill Amount */}
              {invoiceForm.invoice_type === 'regular' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-slate-700">Bill Amount / Subtotal (₹) *</label>
                    {invoiceForm.client_id && (() => {
                      const cl = clients.find(c => String(c.id) === String(invoiceForm.client_id));
                      const defaultAmt = invoiceForm.bill_items?.length > 0 
                        ? invoiceForm.bill_items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0).toFixed(2) 
                        : cl?.monthly_rate;
                      return defaultAmt ? (
                        <button
                          type="button"
                          onClick={() => setInvoiceForm(prev => ({ 
                            ...prev, 
                            amount_subtotal: defaultAmt,
                            absent_guard_days: 0,
                            absence_deduction: 0 
                          }))}
                          className="text-[11px] font-semibold text-teal-600 hover:text-teal-700 underline"
                        >
                          Reset to Contract Rate (₹{parseFloat(defaultAmt).toLocaleString('en-IN')})
                        </button>
                      ) : null;
                    })()}
                  </div>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 50000"
                    value={invoiceForm.amount_subtotal}
                    onChange={(e) => setInvoiceForm(prev => ({ ...prev, amount_subtotal: e.target.value }))}
                    className={inputCls}
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Default is client contract rate. You can manually adjust or enter any custom amount for this single bill.
                  </p>
                </div>
              )}

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
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tax Configuration">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={invoiceForm.tax_type === 'none'}
                    onClick={() => setInvoiceForm(prev => ({ ...prev, tax_type: 'none' }))}
                    className={`flex flex-col p-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                      invoiceForm.tax_type === 'none' 
                        ? 'bg-teal-50 border-teal-500 ring-1 ring-teal-500 text-teal-900' 
                        : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span className="text-xs font-bold text-slate-800">No GST</span>
                    <span className="text-[10px] text-slate-500">0%</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={invoiceForm.tax_type === 'cgst_sgst'}
                    onClick={() => setInvoiceForm(prev => ({ ...prev, tax_type: 'cgst_sgst' }))}
                    className={`flex flex-col p-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                      invoiceForm.tax_type === 'cgst_sgst' 
                        ? 'bg-teal-50 border-teal-500 ring-1 ring-teal-500 text-teal-900' 
                        : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span className="text-xs font-bold text-slate-800">Intra-State</span>
                    <span className="text-[10px] text-slate-500">9% CGST + 9% SGST</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={invoiceForm.tax_type === 'igst'}
                    onClick={() => setInvoiceForm(prev => ({ ...prev, tax_type: 'igst' }))}
                    className={`flex flex-col p-2.5 rounded-lg border text-center transition-all cursor-pointer ${
                      invoiceForm.tax_type === 'igst' 
                        ? 'bg-teal-50 border-teal-500 ring-1 ring-teal-500 text-teal-900' 
                        : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span className="text-xs font-bold text-slate-800">Inter-State</span>
                    <span className="text-[10px] text-slate-500">18% IGST</span>
                  </button>
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
                  baseAmount = (invoiceForm.amount_subtotal !== '' && !isNaN(parseFloat(invoiceForm.amount_subtotal)))
                    ? parseFloat(invoiceForm.amount_subtotal)
                    : parseFloat(selectedClient?.monthly_rate || 0);
                }

                const disc = parseFloat(invoiceForm.discount_amount || 0);
                const taxable = Math.max(0, baseAmount - disc);
                let tax = 0;
                if (invoiceForm.tax_type === 'cgst_sgst' || invoiceForm.tax_type === 'igst') {
                  tax = taxable * 0.18;
                }
                const total = invoiceForm.is_rcm_applicable ? taxable : (taxable + tax);
                const roundedTotal = Math.round(total);
                const roundOff = parseFloat((roundedTotal - total).toFixed(2));

                return (
                  <div className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${isEvent ? 'bg-amber-50/70 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex justify-between items-center pb-1 border-b border-slate-200/80">
                      <span className="font-bold text-slate-800">
                        {isEvent ? '⚡ Full Event Payment:' : 'Bill Subtotal Amount:'}
                      </span>
                      <span className="font-bold text-slate-900">
                        ₹{baseAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        {isEvent && <span className="ml-1 text-[10px] text-amber-800 bg-amber-200 px-1 py-0.5 rounded font-normal">No Proration</span>}
                      </span>
                    </div>
                    {!isEvent && attendanceSummary?.absent_guard_days > 0 && (
                      <div className="flex justify-between text-amber-800">
                        <span>Absence Deduction ({attendanceSummary.absent_guard_days} guard-days):</span>
                        <span className="font-semibold">- ₹{parseFloat(attendanceSummary.absence_deduction || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
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
                    {Math.abs(roundOff) > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <span>Round Off:</span>
                        <span className="font-semibold text-slate-800">
                          {roundOff > 0 ? `+₹${roundOff.toFixed(2)}` : `-₹${Math.abs(roundOff).toFixed(2)}`}
                        </span>
                      </div>
                    )}
                    <div className={`flex justify-between text-sm font-bold pt-1.5 border-t border-slate-200 ${isEvent ? 'text-amber-900' : 'text-teal-800'}`}>
                      <span>Billed Total:</span>
                      <span>₹{roundedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
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

              </div>

              {/* Pinned Action Footer (Always visible at bottom of modal, never scrolls off) */}
              <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex justify-end gap-3 shrink-0">
                <button type="button" onClick={() => setIsCreateOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer">Cancel</button>
                <button type="submit" disabled={submitting} className="px-5 py-2 text-sm font-bold text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-md disabled:opacity-50 transition-all cursor-pointer">
                  {submitting ? 'Generating...' : 'Generate Single Bill'}
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

      {/* Bill View / Print Modal */}
      <BillViewModal
        isOpen={isViewOpen}
        onClose={() => {
          setIsViewOpen(false);
          setViewingInvoice(null);
        }}
        invoice={viewingInvoice}
        onEdit={(inv) => {
          setIsViewOpen(false);
          setSelectedInvoice(inv);
          setIsEditOpen(true);
        }}
        onCancelled={() => {
          fetchInvoices();
        }}
      />
    </div>
  );
}
