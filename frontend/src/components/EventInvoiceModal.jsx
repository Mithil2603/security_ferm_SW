import React, { useState, useEffect } from 'react';
import { X, FileText, Calendar, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import api from '../services/api';

export default function EventInvoiceModal({ isOpen, onClose, onSuccess }) {
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [form, setForm] = useState({
    client_name: '', phone: '', email: '', address: '', city: '', state: 'Gujarat', gst_number: '',
    invoice_date: todayStr, event_date: todayStr,
    guards_count: 1, rate_per_guard: 500, days_worked: 1,
    tax_type: 'none', is_rcm_applicable: false, notes: ''
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [totals, setTotals] = useState({ subtotal: 0, cgst: 0, sgst: 0, igst: 0, total: 0 });

  useEffect(() => {
    if (isOpen) {
      const nowStr = format(new Date(), 'yyyy-MM-dd');
      setForm(prev => ({
        ...prev,
        invoice_date: prev.invoice_date || nowStr,
        event_date: prev.event_date || nowStr
      }));
    }
  }, [isOpen]);

  useEffect(() => {
    // Calculate live preview of math
    const sub = (parseFloat(form.guards_count) || 0) * (parseFloat(form.rate_per_guard) || 0) * (parseFloat(form.days_worked) || 0);
    let cgst = 0, sgst = 0, igst = 0;
    
    if (form.tax_type === 'cgst_sgst') {
      cgst = sub * 0.09;
      sgst = sub * 0.09;
    } else if (form.tax_type === 'igst') {
      igst = sub * 0.18;
    }
    
    let total = sub;
    if (!form.is_rcm_applicable) {
      total += cgst + sgst + igst;
    }

    setTotals({
      subtotal: sub,
      cgst, sgst, igst,
      total
    });
  }, [form]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/invoices/event', form);
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to generate event invoice');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm bg-white transition-colors";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8 animate-slide-up flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-2xl shrink-0">
          <div>
            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <FileText className="w-5 h-5 text-teal-600" /> 
              Direct Event Invoice
            </h3>
            <p className="text-xs text-slate-500 mt-1">Generate a one-time bill for ad-hoc services. New clients are automatically saved.</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          <form id="event-invoice-form" onSubmit={handleSubmit} className="space-y-6">
            {error && <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100 flex items-start gap-2"><X className="w-4 h-4 mt-0.5 shrink-0" /> {error}</div>}
            
            {/* 1. Client Details & Invoice Date Section */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <h4 className="text-sm font-semibold text-slate-800 mb-4 uppercase tracking-wider">1. Client Information & Invoice Date</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Company / Individual Name *</label>
                  <input required type="text" value={form.client_name} onChange={e => setForm({...form, client_name: e.target.value})} className={inputCls} placeholder="e.g. Acme Corp Events" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number *</label>
                  <input required type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className={inputCls} placeholder="10-digit number" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email (Optional)</label>
                  <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Invoice Date *</label>
                  <input required type="date" value={form.invoice_date} onChange={e => setForm({...form, invoice_date: e.target.value})} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Event / Service Date *</label>
                  <input required type="date" value={form.event_date} onChange={e => setForm({...form, event_date: e.target.value})} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">City</label>
                  <input type="text" value={form.city} onChange={e => setForm({...form, city: e.target.value})} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">State</label>
                  <input type="text" value={form.state} onChange={e => setForm({...form, state: e.target.value})} className={inputCls} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">GST Number (Optional)</label>
                  <input type="text" value={form.gst_number} onChange={e => setForm({...form, gst_number: e.target.value})} className={inputCls} placeholder="e.g. 24XXXXXXXXXX1Z5" />
                </div>
              </div>
            </div>

            {/* 2. Service Math Section */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <h4 className="text-sm font-semibold text-slate-800 mb-4 uppercase tracking-wider">2. Service Details</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">No. of Guards *</label>
                  <input required type="number" min="1" value={form.guards_count} onChange={e => setForm({...form, guards_count: e.target.value})} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Rate / Guard / Day (₹) *</label>
                  <input required type="number" min="1" step="0.01" value={form.rate_per_guard} onChange={e => setForm({...form, rate_per_guard: e.target.value})} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Days Worked *</label>
                  <input required type="number" min="1" value={form.days_worked} onChange={e => setForm({...form, days_worked: e.target.value})} className={inputCls} />
                </div>
              </div>
            </div>

            {/* 3. GST & Tax Configuration */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <h4 className="text-sm font-semibold text-slate-800 mb-4 uppercase tracking-wider flex justify-between items-center">
                3. Tax Configuration
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded">Indian GST</span>
              </h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Apply GST to this invoice?</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${
                      form.tax_type === 'none' ? 'bg-teal-50 border-teal-500 ring-1 ring-teal-500' : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}>
                      <input type="radio" name="event_tax_type" value="none" checked={form.tax_type === 'none'} onChange={e => setForm({...form, tax_type: e.target.value})} className="text-teal-600 focus:ring-teal-500 h-4 w-4" />
                      <div>
                        <span className="block text-sm font-semibold text-slate-800">No GST (0%)</span>
                        <span className="block text-xs text-slate-500">Unregistered / Exempt</span>
                      </div>
                    </label>

                    <label className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${
                      form.tax_type === 'cgst_sgst' ? 'bg-teal-50 border-teal-500 ring-1 ring-teal-500' : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}>
                      <input type="radio" name="event_tax_type" value="cgst_sgst" checked={form.tax_type === 'cgst_sgst'} onChange={e => setForm({...form, tax_type: e.target.value})} className="text-teal-600 focus:ring-teal-500 h-4 w-4" />
                      <div>
                        <span className="block text-sm font-semibold text-slate-800">Intra-State (18%)</span>
                        <span className="block text-xs text-slate-500">CGST (9%) + SGST (9%)</span>
                      </div>
                    </label>

                    <label className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${
                      form.tax_type === 'igst' ? 'bg-teal-50 border-teal-500 ring-1 ring-teal-500' : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}>
                      <input type="radio" name="event_tax_type" value="igst" checked={form.tax_type === 'igst'} onChange={e => setForm({...form, tax_type: e.target.value})} className="text-teal-600 focus:ring-teal-500 h-4 w-4" />
                      <div>
                        <span className="block text-sm font-semibold text-slate-800">Inter-State (18%)</span>
                        <span className="block text-xs text-slate-500">IGST (18% Total)</span>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="flex items-center p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <input type="checkbox" id="rcm_check" checked={form.is_rcm_applicable} onChange={e => setForm({...form, is_rcm_applicable: e.target.checked})} className="h-4 w-4 text-amber-600 focus:ring-amber-500 rounded border-amber-300 cursor-pointer" />
                  <label htmlFor="rcm_check" className="ml-2 block text-sm font-semibold text-amber-900 cursor-pointer">
                    Apply RCM (Reverse Charge Mechanism - Tax payable by recipient)
                  </label>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Additional Notes</label>
                  <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows="2" className={inputCls} placeholder="Printed on the bottom of the invoice..." />
                </div>
              </div>
            </div>

            {/* Live Math Preview */}
            <div className="bg-teal-50 rounded-xl p-4 border border-teal-100">
              <div className="flex justify-between text-sm text-teal-800 mb-1">
                <span>Subtotal ({form.guards_count || 0} guards × ₹{form.rate_per_guard || 0} × {form.days_worked || 0} days):</span>
                <span className="font-semibold">₹{totals.subtotal.toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
              </div>
              {form.tax_type === 'cgst_sgst' && (
                <>
                  <div className="flex justify-between text-sm text-teal-800 mb-1">
                    <span>CGST (9%):</span>
                    <span>₹{totals.cgst.toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
                  </div>
                  <div className="flex justify-between text-sm text-teal-800 mb-1">
                    <span>SGST (9%):</span>
                    <span>₹{totals.sgst.toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
                  </div>
                </>
              )}
              {form.tax_type === 'igst' && (
                <div className="flex justify-between text-sm text-teal-800 mb-1">
                  <span>IGST (18%):</span>
                  <span>₹{totals.igst.toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
                </div>
              )}
              {form.is_rcm_applicable && (
                <div className="text-xs text-amber-700 italic mt-1">
                  * Note: Under RCM, GST is paid directly by client to government. Total billed amount is ₹{totals.subtotal.toLocaleString('en-IN', {minimumFractionDigits: 2})}.
                </div>
              )}
              <div className="flex justify-between font-bold text-lg text-teal-900 mt-2 pt-2 border-t border-teal-200">
                <span>Total Invoice Amount:</span>
                <span>₹{totals.total.toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
              </div>
            </div>

          </form>
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl shrink-0">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors">Cancel</button>
          <button type="submit" form="event-invoice-form" disabled={submitting} className="px-6 py-2.5 text-sm font-bold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors shadow-md disabled:opacity-50 flex items-center gap-2">
            {submitting ? 'Generating...' : 'Create & Save Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}
