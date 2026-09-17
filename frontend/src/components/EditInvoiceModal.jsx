import React, { useState, useEffect } from 'react';
import { X, FileEdit, Landmark, MapPin, Shield, Calendar, Plus, Trash2 } from 'lucide-react';
import api from '../services/api';

export default function EditInvoiceModal({ isOpen, onClose, onSuccess, invoice }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [bankAccounts, setBankAccounts] = useState([]);

  const [form, setForm] = useState({
    invoice_number: '',
    invoice_date: '',
    site_name: '',
    bank_account_id: '',
    particular: 'Security Guard',
    monthly_rate: '',
    rate_per_day: '',
    guards_count: 1,
    total_duty_days: '',
    amount_subtotal: '',
    discount_amount: '0',
    tax_type: 'none',
    is_rcm_applicable: false,
    due_date: '',
    notes: '',
    status: '',
    bill_items: []
  });

  const handleBillItemChange = (index, field, value) => {
    setForm(prev => {
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
    setForm(prev => {
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
    setForm(prev => {
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

  useEffect(() => {
    if (isOpen) {
      api.get('/bank-accounts')
        .then(res => {
          const accounts = res.data || [];
          setBankAccounts(accounts.filter(b => b.is_active));
        })
        .catch(err => console.error('Failed to load bank accounts', err));
    }
  }, [isOpen]);

  useEffect(() => {
    if (invoice) {
      const formatDate = (d) => d ? new Date(d).toISOString().split('T')[0] : '';
      let items = [];
      if (invoice.bill_items) {
        try {
          items = typeof invoice.bill_items === 'string' ? JSON.parse(invoice.bill_items) : invoice.bill_items;
        } catch(e) { items = []; }
      }
      if (!Array.isArray(items) || items.length === 0) {
        items = [{
          particular: invoice.particular || 'Security Guard',
          monthly_rate: invoice.monthly_rate || '',
          guards_count: invoice.guards_count || invoice.employee_count || 1,
          rate_per_day: invoice.rate_per_day || '',
          hsn_code: invoice.hsn_code || '998525',
          total_duty_days: invoice.total_duty_days || invoice.duty_days_worked || '',
          amount: invoice.amount_subtotal || ''
        }];
      }

      setForm({
        invoice_number: invoice.invoice_number || '',
        invoice_date: formatDate(invoice.invoice_date),
        site_name: invoice.site_name || '',
        bank_account_id: invoice.bank_account_id || '',
        particular: invoice.particular || 'Security Guard',
        monthly_rate: invoice.monthly_rate || '',
        rate_per_day: invoice.rate_per_day || '',
        guards_count: invoice.guards_count || invoice.employee_count || 1,
        total_duty_days: invoice.total_duty_days || invoice.duty_days_worked || '',
        amount_subtotal: invoice.amount_subtotal || '',
        discount_amount: invoice.discount_amount || '0',
        tax_type: invoice.tax_type || 'none',
        is_rcm_applicable: Boolean(invoice.is_rcm_applicable),
        due_date: formatDate(invoice.due_date),
        notes: invoice.notes || '',
        status: invoice.status || 'draft',
        bill_items: items
      });
    }
  }, [invoice]);

  if (!isOpen || !invoice) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        ...form,
        invoice_number: form.invoice_number.trim().toUpperCase(),
        amount_subtotal: parseFloat(form.amount_subtotal) || 0,
        discount_amount: parseFloat(form.discount_amount) || 0,
        monthly_rate: parseFloat(form.monthly_rate) || 0,
        rate_per_day: parseFloat(form.rate_per_day) || 0,
        guards_count: parseInt(form.guards_count) || 1,
        total_duty_days: parseInt(form.total_duty_days) || 0,
        bank_account_id: form.bank_account_id ? parseInt(form.bank_account_id) : null,
        bill_items: form.bill_items
      };
      await api.put(`/invoices/${invoice.id}`, payload);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to update invoice');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = "w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all text-sm";
  const labelCls = "block text-xs font-semibold text-slate-700 mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in overflow-hidden">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden animate-slide-up my-auto max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <FileEdit className="w-5 h-5 text-teal-600" /> Edit Bill: {invoice.invoice_number}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="p-6 overflow-y-auto flex-1 space-y-4">
            {error && <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">{error}</div>}

          {/* Top Info Bar */}
          <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-700 flex flex-wrap justify-between items-center gap-2 border border-slate-200">
            <div>
              <span className="font-bold text-slate-900">{invoice.client_name}</span>
              {invoice.client_gst && <span className="ml-2 text-slate-500">GST: {invoice.client_gst}</span>}
            </div>
            <div className="font-semibold text-slate-600">
              Current Status: <span className="uppercase text-teal-700">{form.status}</span>
            </div>
          </div>

          {/* Invoice Number & Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>INVOICE NO. (e.g. EES34) *</label>
              <input
                required
                type="text"
                value={form.invoice_number}
                onChange={e => setForm({ ...form, invoice_number: e.target.value.toUpperCase() })}
                className={`${inputCls} font-mono font-bold tracking-wider uppercase`}
                placeholder="EES34"
              />
              <p className="text-[11px] text-slate-400 mt-1">Constant prefix: EES followed by number</p>
            </div>
            <div>
              <label className={labelCls}>BILL DATE *</label>
              <input
                required
                type="date"
                value={form.invoice_date}
                onChange={e => setForm({ ...form, invoice_date: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>

          {/* Site Name & Bank Account */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>
                <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-slate-500" /> Site Name (on Bill)</span>
              </label>
              <input
                type="text"
                value={form.site_name}
                onChange={e => setForm({ ...form, site_name: e.target.value })}
                className={inputCls}
                placeholder="e.g. Masterpiece & Vadavi"
              />
            </div>
            <div>
              <label className={labelCls}>
                <span className="flex items-center gap-1"><Landmark className="w-3.5 h-3.5 text-slate-500" /> Payment Bank Account</span>
              </label>
              <select
                value={form.bank_account_id}
                onChange={e => setForm({ ...form, bank_account_id: e.target.value })}
                className={inputCls}
              >
                <option value="">Default (IndusInd Bank - 252528112019)</option>
                {bankAccounts.map(ba => (
                  <option key={ba.id} value={ba.id}>
                    {ba.bank_name || ba.account_name} ({ba.account_number})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Guard Categories & Bill Item Breakdown Table */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-teal-600" />
                  Bill Items & Guard Categories Breakdown
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Multi-category guard billing. Total Day × Rate = Amount.
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
                    <th className="p-2 min-w-[140px]">Particular</th>
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
                  {(form.bill_items && form.bill_items.length > 0
                    ? form.bill_items
                    : [{ particular: form.particular || 'Security Guard', monthly_rate: form.monthly_rate || '', guards_count: form.guards_count || 1, rate_per_day: form.rate_per_day || '', hsn_code: form.hsn_code || '998525', total_duty_days: form.total_duty_days || 31, amount: form.amount_subtotal || '' }]
                  ).map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80">
                      <td className="p-2 text-center font-bold text-slate-500">
                        {String(idx + 1).padStart(2, '0')}
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          list={`edit-particular-suggestions-${idx}`}
                          value={item.particular || ''}
                          onChange={(e) => handleBillItemChange(idx, 'particular', e.target.value)}
                          placeholder="e.g. Security Supervisor"
                          className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-teal-500 font-medium"
                        />
                        <datalist id={`edit-particular-suggestions-${idx}`}>
                          <option value="Security Supervisor" />
                          <option value="Security Guard" />
                          <option value="Security Lady Guard" />
                          <option value="Gunman" />
                          <option value="Bouncer" />
                          <option value="Head Guard" />
                          <option value="Extra Security Guard" />
                          <option value="Armed Guard" />
                          <option value="Event Security / Bouncer" />
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
                        {(form.bill_items || []).length > 1 && (
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
              <span className="text-[11px] text-teal-800 font-medium">
                💡 Adjust <em>Total Day</em> per category to reflect any absences.
              </span>
              <span className="font-bold text-slate-800">
                Total Calculated: <span className="text-teal-700 text-sm">₹{parseFloat(form.amount_subtotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </span>
            </div>
          </div>

          {/* Financial Amounts & Taxes */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Subtotal Amount (₹) *</label>
              <input
                required
                type="number"
                step="0.01"
                min="0"
                value={form.amount_subtotal}
                onChange={e => setForm({ ...form, amount_subtotal: e.target.value })}
                className={`${inputCls} font-bold`}
              />
            </div>
            <div>
              <label className={labelCls}>Tax Type</label>
              <select
                value={form.tax_type}
                onChange={e => setForm({ ...form, tax_type: e.target.value })}
                className={inputCls}
              >
                <option value="none">No Tax</option>
                <option value="cgst_sgst">CGST + SGST (18%)</option>
                <option value="igst">IGST (18%)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Discount (₹)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.discount_amount}
                onChange={e => setForm({ ...form, discount_amount: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>

          {/* Live Financial Summary */}
          {(() => {
            const sub = parseFloat(form.amount_subtotal) || 0;
            const disc = parseFloat(form.discount_amount) || 0;
            const taxable = Math.max(0, sub - disc);
            let tax = 0;
            if (form.tax_type === 'cgst_sgst' || form.tax_type === 'igst') {
              tax = taxable * 0.18;
            }
            const total = form.is_rcm_applicable ? taxable : (taxable + tax);
            const roundedTotal = Math.round(total);
            const roundOff = parseFloat((roundedTotal - total).toFixed(2));

            return (
              <div className="flex flex-wrap items-center justify-between text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <span className="text-slate-600">
                  Tax: <strong className="text-slate-800">{form.is_rcm_applicable ? '₹0 (RCM)' : `₹${tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}</strong>
                  {Math.abs(roundOff) > 0 && (
                    <span className="ml-3">
                      Round Off: <strong className="text-slate-800">{roundOff > 0 ? `+₹${roundOff.toFixed(2)}` : `-₹${Math.abs(roundOff).toFixed(2)}`}</strong>
                    </span>
                  )}
                </span>
                <span className="font-bold text-slate-800">
                  Billed Total: <span className="text-teal-700 text-sm">₹{roundedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </span>
              </div>
            );
          })()}

          {/* RCM Toggle & Due Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div className="flex items-center p-3 bg-amber-50 rounded-lg border border-amber-200">
              <input
                type="checkbox"
                id="edit_rcm"
                checked={form.is_rcm_applicable}
                onChange={e => setForm({ ...form, is_rcm_applicable: e.target.checked })}
                className="h-4 w-4 text-amber-600 focus:ring-amber-500 rounded border-amber-300 cursor-pointer"
              />
              <label htmlFor="edit_rcm" className="ml-2 block text-xs sm:text-sm font-bold text-amber-900 cursor-pointer">
                RCM BILL (Reverse Charge Mechanism - YES)
              </label>
            </div>
            <div>
              <label className={labelCls}>Payment Due Date</label>
              <input
                type="date"
                value={form.due_date}
                onChange={e => setForm({ ...form, due_date: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className={labelCls}>Notes / Remarks</label>
            <textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              rows="2"
              className={inputCls}
              placeholder="Optional notes or references..."
            />
          </div>

          </div>

          {/* Pinned Action Footer */}
          <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm font-bold text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-sm disabled:opacity-50 transition-all cursor-pointer"
            >
              {submitting ? 'Saving Changes...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
