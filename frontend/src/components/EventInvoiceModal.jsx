import React, { useState, useEffect } from 'react';
import { X, FileText, Calendar, ShieldCheck, CheckCircle2, UserCheck, UserPlus, Calculator, DollarSign } from 'lucide-react';
import { format, differenceInCalendarDays, parseISO } from 'date-fns';
import api from '../services/api';
import Toast from './Toast';
import { sanitizePhone, validatePhone } from '../utils/phoneValidation';

export default function EventInvoiceModal({ isOpen, onClose, onSuccess }) {
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  
  const [clientMode, setClientMode] = useState('existing'); // 'existing' | 'new'
  const [calcMode, setCalcMode] = useState('per_guard'); // 'per_guard' | 'lump_sum'
  const [existingClients, setExistingClients] = useState([]);
  const [loadingClients, setLoadingClients] = useState(false);

  const [form, setForm] = useState({
    client_id: '',
    client_name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: 'Gujarat',
    gst_number: '',
    invoice_date: todayStr,
    billing_period_start: todayStr,
    billing_period_end: todayStr,
    guards_count: 1,
    rate_per_guard: 500,
    days_worked: 1,
    fixed_amount: '',
    tax_type: 'none',
    is_rcm_applicable: false,
    notes: ''
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [totals, setTotals] = useState({ subtotal: 0, cgst: 0, sgst: 0, igst: 0, total: 0 });
  const [toast, setToast] = useState({ show: false, message: '', type: 'error' });

  const showToast = (message, type = 'error') => {
    setToast({ show: true, message, type });
  };

  // Fetch active clients when modal opens
  useEffect(() => {
    if (isOpen) {
      const nowStr = format(new Date(), 'yyyy-MM-dd');
      setForm(prev => ({
        ...prev,
        invoice_date: prev.invoice_date || nowStr,
        billing_period_start: prev.billing_period_start || nowStr,
        billing_period_end: prev.billing_period_end || nowStr
      }));

      const fetchClients = async () => {
        try {
          setLoadingClients(true);
          const res = await api.get('/clients?limit=200&is_active=true');
          const clientList = res.data || [];
          setExistingClients(clientList);
          if (clientList.length > 0) {
            setClientMode('existing');
          } else {
            setClientMode('new');
          }
        } catch (err) {
          console.error('Failed to load clients', err);
          setClientMode('new');
        } finally {
          setLoadingClients(false);
        }
      };
      fetchClients();
    }
  }, [isOpen]);

  // When client_id changes in existing mode, fill details
  const handleExistingClientChange = (clientId) => {
    const selected = existingClients.find(c => String(c.id) === String(clientId));
    if (selected) {
      setForm(prev => ({
        ...prev,
        client_id: selected.id,
        client_name: selected.name || '',
        phone: selected.phone || '',
        email: selected.email || '',
        address: selected.address || '',
        city: selected.city || '',
        state: selected.state || 'Gujarat',
        gst_number: selected.gst_number || ''
      }));
    } else {
      setForm(prev => ({
        ...prev,
        client_id: '',
        client_name: '',
        phone: '',
        email: '',
        address: '',
        city: '',
        state: 'Gujarat',
        gst_number: ''
      }));
    }
  };

  // Auto-calculate days worked when start/end dates change
  const handleDateRangeChange = (field, val) => {
    const nextStart = field === 'billing_period_start' ? val : form.billing_period_start;
    const nextEnd = field === 'billing_period_end' ? val : form.billing_period_end;

    let computedDays = form.days_worked;
    if (nextStart && nextEnd) {
      try {
        const diff = differenceInCalendarDays(parseISO(nextEnd), parseISO(nextStart)) + 1;
        if (diff > 0) {
          computedDays = diff;
        }
      } catch (e) {
        // ignore date parse issues
      }
    }

    setForm(prev => ({
      ...prev,
      [field]: val,
      days_worked: computedDays
    }));
  };

  // Calculate live preview
  useEffect(() => {
    let sub = 0;
    if (calcMode === 'lump_sum') {
      sub = parseFloat(form.fixed_amount) || 0;
    } else {
      sub = (parseFloat(form.guards_count) || 0) * (parseFloat(form.rate_per_guard) || 0) * (parseFloat(form.days_worked) || 0);
    }
    sub = parseFloat(sub.toFixed(2));

    let cgst = 0, sgst = 0, igst = 0;
    if (form.tax_type === 'cgst_sgst') {
      cgst = parseFloat((sub * 0.09).toFixed(2));
      sgst = parseFloat((sub * 0.09).toFixed(2));
    } else if (form.tax_type === 'igst') {
      igst = parseFloat((sub * 0.18).toFixed(2));
    }

    let total = sub;
    if (!form.is_rcm_applicable) {
      total += cgst + sgst + igst;
    }
    total = parseFloat(total.toFixed(2));

    setTotals({
      subtotal: sub,
      cgst,
      sgst,
      igst,
      total
    });
  }, [form, calcMode]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (clientMode === 'existing') {
      if (!form.client_id) {
        setError('Please select an existing client or switch to New Client.');
        showToast('Please select an existing client.', 'error');
        return;
      }
    } else {
      if (!form.client_name.trim()) {
        setError('Client name is required.');
        showToast('Client name is required.', 'error');
        return;
      }
      const phoneCheck = validatePhone(form.phone, 'Client Phone Number', true);
      if (!phoneCheck.valid) {
        setError(phoneCheck.error);
        showToast(phoneCheck.error, 'error');
        return;
      }
    }

    if (calcMode === 'lump_sum') {
      if (!form.fixed_amount || parseFloat(form.fixed_amount) <= 0) {
        setError('Please enter a valid fixed lump-sum amount.');
        showToast('Please enter a valid fixed lump-sum amount.', 'error');
        return;
      }
    } else {
      if (!form.guards_count || parseFloat(form.guards_count) <= 0) {
        setError('Please enter at least 1 guard.');
        showToast('Please enter at least 1 guard.', 'error');
        return;
      }
      if (!form.rate_per_guard || parseFloat(form.rate_per_guard) <= 0) {
        setError('Please enter a valid rate per guard.');
        showToast('Please enter a valid rate per guard.', 'error');
        return;
      }
      if (!form.days_worked || parseFloat(form.days_worked) <= 0) {
        setError('Please enter at least 1 day worked.');
        showToast('Please enter at least 1 day worked.', 'error');
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        invoice_date: form.invoice_date,
        billing_period_start: form.billing_period_start,
        billing_period_end: form.billing_period_end,
        event_date: form.billing_period_start,
        tax_type: form.tax_type,
        is_rcm_applicable: form.is_rcm_applicable,
        notes: form.notes,
        ...(clientMode === 'existing'
          ? { client_id: form.client_id }
          : {
              client_name: form.client_name,
              phone: form.phone,
              email: form.email,
              address: form.address,
              city: form.city,
              state: form.state,
              gst_number: form.gst_number
            }),
        ...(calcMode === 'lump_sum'
          ? { fixed_amount: parseFloat(form.fixed_amount), days_worked: form.days_worked || 1 }
          : {
              guards_count: parseInt(form.guards_count, 10),
              rate_per_guard: parseFloat(form.rate_per_guard),
              days_worked: parseInt(form.days_worked, 10)
            })
      };

      await api.post('/invoices/event', payload);
      onSuccess();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to generate event invoice';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm bg-white transition-colors";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8 animate-slide-up flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-amber-100 flex justify-between items-center bg-gradient-to-r from-amber-50 to-orange-50 rounded-t-2xl shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-amber-500 text-white rounded-lg shadow-sm">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Direct Event Invoice</h3>
                <p className="text-xs text-amber-800 font-medium">Full event payment — no monthly bifurcation or recurring generation</p>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-white/80 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          <form id="event-invoice-form" onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100 flex items-start gap-2">
                <X className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* 1. Client Selection */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-amber-600" />
                  1. Client Selection
                </h4>
                <div className="inline-flex rounded-lg border border-slate-200 p-1 bg-slate-50 self-start">
                  <button
                    type="button"
                    onClick={() => setClientMode('existing')}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                      clientMode === 'existing'
                        ? 'bg-white text-amber-700 shadow-xs border border-amber-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    Existing Client
                  </button>
                  <button
                    type="button"
                    onClick={() => setClientMode('new')}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                      clientMode === 'new'
                        ? 'bg-white text-amber-700 shadow-xs border border-amber-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    New Client
                  </button>
                </div>
              </div>

              {clientMode === 'existing' ? (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Select Client *</label>
                  <select
                    required
                    value={form.client_id}
                    onChange={(e) => handleExistingClientChange(e.target.value)}
                    className={inputCls}
                    disabled={loadingClients}
                  >
                    <option value="">-- Choose Existing Client --</option>
                    {existingClients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.client_type === 'event' ? '(Event Client)' : `(Regular - ₹${parseFloat(c.monthly_rate || 0).toLocaleString('en-IN')}/mo)`}
                      </option>
                    ))}
                  </select>
                  {form.client_id && (
                    <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-600 grid grid-cols-2 gap-2">
                      <div><span className="font-semibold text-slate-800">Phone:</span> {form.phone || 'N/A'}</div>
                      <div><span className="font-semibold text-slate-800">Email:</span> {form.email || 'N/A'}</div>
                      <div><span className="font-semibold text-slate-800">City / State:</span> {form.city || 'N/A'}, {form.state}</div>
                      <div><span className="font-semibold text-slate-800">GST:</span> {form.gst_number || 'None'}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Company / Individual Name *</label>
                    <input
                      required
                      type="text"
                      value={form.client_name}
                      onChange={e => setForm({ ...form, client_name: e.target.value })}
                      className={inputCls}
                      placeholder="e.g. Acme Diwali Exhibition"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number (10 Digits) *</label>
                    <input
                      required
                      type="tel"
                      maxLength="10"
                      value={form.phone}
                      onChange={e => setForm(prev => ({ ...prev, phone: sanitizePhone(e.target.value) }))}
                      className={inputCls}
                      placeholder="10-digit mobile number"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Email (Optional)</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={e => setForm({ ...form, email: e.target.value })}
                      className={inputCls}
                      placeholder="accounts@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">City</label>
                    <input
                      type="text"
                      value={form.city}
                      onChange={e => setForm({ ...form, city: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">State</label>
                    <input
                      type="text"
                      value={form.state}
                      onChange={e => setForm({ ...form, state: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">GST Number (Optional)</label>
                    <input
                      type="text"
                      value={form.gst_number}
                      onChange={e => setForm({ ...form, gst_number: e.target.value })}
                      className={inputCls}
                      placeholder="e.g. 24XXXXXXXXXX1Z5"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 2. Event Dates */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-100 pb-3">
                <Calendar className="w-4 h-4 text-amber-600" />
                2. Event Duration & Invoice Date
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Invoice Date *</label>
                  <input
                    required
                    type="date"
                    value={form.invoice_date}
                    onChange={e => setForm({ ...form, invoice_date: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Event Start Date *</label>
                  <input
                    required
                    type="date"
                    value={form.billing_period_start}
                    onChange={e => handleDateRangeChange('billing_period_start', e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Event End Date *</label>
                  <input
                    required
                    type="date"
                    value={form.billing_period_end}
                    onChange={e => handleDateRangeChange('billing_period_end', e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            {/* 3. Pricing Calculation Method */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Calculator className="w-4 h-4 text-amber-600" />
                  3. Pricing & Amount (Full Payment)
                </h4>
                <div className="inline-flex rounded-lg border border-slate-200 p-1 bg-slate-50 self-start">
                  <button
                    type="button"
                    onClick={() => setCalcMode('per_guard')}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                      calcMode === 'per_guard'
                        ? 'bg-white text-amber-700 shadow-xs border border-amber-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Calculator className="w-3.5 h-3.5" />
                    Guards × Rate × Days
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalcMode('lump_sum')}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                      calcMode === 'lump_sum'
                        ? 'bg-white text-amber-700 shadow-xs border border-amber-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    Fixed Lump-Sum
                  </button>
                </div>
              </div>

              {calcMode === 'per_guard' ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Guards Count *</label>
                    <input
                      required
                      type="number"
                      min="1"
                      value={form.guards_count}
                      onChange={e => setForm({ ...form, guards_count: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Rate / Guard / Day (₹) *</label>
                    <input
                      required
                      type="number"
                      min="1"
                      step="0.01"
                      value={form.rate_per_guard}
                      onChange={e => setForm({ ...form, rate_per_guard: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Event Days Worked *</label>
                    <input
                      required
                      type="number"
                      min="1"
                      value={form.days_worked}
                      onChange={e => setForm({ ...form, days_worked: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Total Lump-Sum Event Amount (₹) *</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 font-bold">₹</span>
                    <input
                      required
                      type="number"
                      min="1"
                      step="0.01"
                      value={form.fixed_amount}
                      onChange={e => setForm({ ...form, fixed_amount: e.target.value })}
                      className={`${inputCls} pl-8`}
                      placeholder="e.g. 50000"
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Direct flat charge for this entire event.</p>
                </div>
              )}
            </div>

            {/* 4. GST & Tax Configuration */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between border-b border-slate-100 pb-3">
                <span>4. Tax Configuration</span>
                <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded">Indian GST</span>
              </h4>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Apply GST to this invoice?</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${
                    form.tax_type === 'none' ? 'bg-amber-50 border-amber-500 ring-1 ring-amber-500' : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}>
                    <input
                      type="radio"
                      name="event_tax_type"
                      value="none"
                      checked={form.tax_type === 'none'}
                      onChange={e => setForm({ ...form, tax_type: e.target.value })}
                      className="text-amber-600 focus:ring-amber-500 h-4 w-4"
                    />
                    <div>
                      <span className="block text-sm font-semibold text-slate-800">No GST (0%)</span>
                      <span className="block text-xs text-slate-500">Unregistered / Exempt</span>
                    </div>
                  </label>

                  <label className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${
                    form.tax_type === 'cgst_sgst' ? 'bg-amber-50 border-amber-500 ring-1 ring-amber-500' : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}>
                    <input
                      type="radio"
                      name="event_tax_type"
                      value="cgst_sgst"
                      checked={form.tax_type === 'cgst_sgst'}
                      onChange={e => setForm({ ...form, tax_type: e.target.value })}
                      className="text-amber-600 focus:ring-amber-500 h-4 w-4"
                    />
                    <div>
                      <span className="block text-sm font-semibold text-slate-800">Intra-State (18%)</span>
                      <span className="block text-xs text-slate-500">CGST (9%) + SGST (9%)</span>
                    </div>
                  </label>

                  <label className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${
                    form.tax_type === 'igst' ? 'bg-amber-50 border-amber-500 ring-1 ring-amber-500' : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}>
                    <input
                      type="radio"
                      name="event_tax_type"
                      value="igst"
                      checked={form.tax_type === 'igst'}
                      onChange={e => setForm({ ...form, tax_type: e.target.value })}
                      className="text-amber-600 focus:ring-amber-500 h-4 w-4"
                    />
                    <div>
                      <span className="block text-sm font-semibold text-slate-800">Inter-State (18%)</span>
                      <span className="block text-xs text-slate-500">IGST (18% Total)</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex items-center p-3 bg-amber-50/60 rounded-lg border border-amber-200">
                <input
                  type="checkbox"
                  id="rcm_check_event"
                  checked={form.is_rcm_applicable}
                  onChange={e => setForm({ ...form, is_rcm_applicable: e.target.checked })}
                  className="h-4 w-4 text-amber-600 focus:ring-amber-500 rounded border-amber-300 cursor-pointer"
                />
                <label htmlFor="rcm_check_event" className="ml-2 block text-xs font-semibold text-amber-900 cursor-pointer">
                  Apply RCM (Reverse Charge Mechanism - GST payable directly by client to government)
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Additional Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  rows="2"
                  className={inputCls}
                  placeholder="Printed on the bottom of the event invoice..."
                />
              </div>
            </div>

            {/* Live Math Preview & Full Payment Notice */}
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-5 border border-amber-200 shadow-xs space-y-2">
              <div className="flex items-center justify-between pb-2 border-b border-amber-200">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900 uppercase tracking-wide">
                  <ShieldCheck className="w-4 h-4 text-amber-600" />
                  Full Event Payment Summary
                </div>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-200 text-amber-900">
                  No Monthly Bifurcation
                </span>
              </div>

              <div className="flex justify-between text-sm text-slate-700">
                <span>
                  {calcMode === 'lump_sum'
                    ? 'Flat Lump-Sum Amount:'
                    : `Base Amount (${form.guards_count || 0} guards × ₹${form.rate_per_guard || 0} × ${form.days_worked || 0} days):`}
                </span>
                <span className="font-semibold text-slate-900">₹{totals.subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>

              {form.tax_type === 'cgst_sgst' && (
                <>
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>CGST (9%):</span>
                    <span>₹{totals.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>SGST (9%):</span>
                    <span>₹{totals.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </>
              )}

              {form.tax_type === 'igst' && (
                <div className="flex justify-between text-xs text-slate-600">
                  <span>IGST (18%):</span>
                  <span>₹{totals.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              )}

              {form.is_rcm_applicable && (
                <div className="text-[11px] text-amber-700 italic pt-1">
                  * Note: Under RCM, GST is paid directly by the client. Total payable to you is ₹{totals.subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}.
                </div>
              )}

              <div className="flex justify-between font-extrabold text-base sm:text-lg text-slate-900 pt-2 border-t border-amber-200">
                <span>Total Invoice Amount:</span>
                <span className="text-amber-900">₹{totals.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </form>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="event-invoice-form"
            disabled={submitting}
            className="px-6 py-2.5 text-sm font-bold text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
          >
            {submitting ? 'Generating...' : 'Create & Save Event Invoice'}
          </button>
        </div>
      </div>
      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ show: false, message: '', type: 'error' })}
        />
      )}
    </div>
  );
}
