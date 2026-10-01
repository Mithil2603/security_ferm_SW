import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, Plus, Search, X, Trash2, CheckCircle2, Ban, Eye, ArrowRightCircle } from 'lucide-react';
import api from '../services/api';
import { toast, confirmDialog } from '../context/ToastContext';
import Pagination from '../components/Pagination';

const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm bg-white text-slate-800 transition-all";

const emptyItem = { description: '', hsn_code: '', quantity: '1', unit_price: '' };
const emptyForm = { vendor_id: '', po_date: new Date().toISOString().split('T')[0], tax_type: 'none', tax_rate: '18', is_rcm_applicable: false, tds_rate: '', notes: '', items: [{ ...emptyItem }] };

const STATUS_STYLES = {
  draft: 'bg-slate-100 text-slate-600',
  billed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-rose-100 text-rose-600',
};

export default function PurchaseOrders() {
  const [pos, setPos] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [vendors, setVendors] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const [viewPo, setViewPo] = useState(null);
  const [convertModal, setConvertModal] = useState({ open: false, po: null, expense_date: '', payment_method: 'bank_transfer' });
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    api.get('/vendors').then(res => setVendors(res.data || [])).catch(() => setVendors([]));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const fetchPOs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      params.set('page', page);
      params.set('limit', '20');
      const res = await api.get(`/purchase-orders?${params.toString()}`);
      setPos(res.data || []);
      if (res.pagination) setPagination(res.pagination);
    } catch (err) {
      console.error('Failed to load purchase orders', err);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => { fetchPOs(); }, [fetchPOs]);

  // ─── Item row helpers ──────────────────────────────────────────────────────
  const updateItem = (idx, field, value) => {
    setForm(f => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [field]: value };
      return { ...f, items };
    });
  };
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { ...emptyItem }] }));
  const removeItem = (idx) => setForm(f => ({ ...f, items: f.items.length <= 1 ? f.items : f.items.filter((_, i) => i !== idx) }));

  const subtotal = form.items.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0), 0);
  const gstRate = form.tax_type !== 'none' ? (parseFloat(form.tax_rate) || 0) : 0;
  const gstAmount = subtotal * (gstRate / 100);
  const total = subtotal + gstAmount;

  const resetForm = () => { setForm(emptyForm); setShowForm(false); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.vendor_id) { toast.error('Please select a vendor'); return; }
    if (form.items.some(it => !it.description || !(parseFloat(it.quantity) > 0) || it.unit_price === '')) {
      toast.error('Every line item needs an item name, a positive quantity, and a unit price');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/purchase-orders', {
        ...form,
        is_rcm_applicable: form.is_rcm_applicable,
        tax_rate: form.tax_type !== 'none' ? form.tax_rate : 0,
      });
      toast.success('Purchase order created');
      resetForm();
      fetchPOs();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to create purchase order');
    } finally {
      setSubmitting(false);
    }
  };

  const openView = async (po) => {
    try {
      const res = await api.get(`/purchase-orders/${po.id}`);
      setViewPo(res.data);
    } catch {
      toast.error('Failed to load purchase order details');
    }
  };

  const openConvert = (po) => {
    setConvertModal({ open: true, po, expense_date: new Date().toISOString().split('T')[0], payment_method: 'bank_transfer' });
  };

  const handleConvert = async (e) => {
    e.preventDefault();
    setConverting(true);
    try {
      await api.post(`/purchase-orders/${convertModal.po.id}/convert-to-bill`, {
        expense_date: convertModal.expense_date,
        payment_method: convertModal.payment_method,
      });
      toast.success('Converted to a bill — it now appears in Bank & Payments → Vendor Payments');
      setConvertModal({ open: false, po: null, expense_date: '', payment_method: 'bank_transfer' });
      fetchPOs();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to convert to a bill');
    } finally {
      setConverting(false);
    }
  };

  const handleCancel = async (po) => {
    const confirmed = await confirmDialog({
      title: 'Cancel Purchase Order',
      message: `Cancel ${po.po_number}? This cannot be undone.`,
      confirmText: 'Cancel PO',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.post(`/purchase-orders/${po.id}/cancel`);
      toast.success('Purchase order cancelled');
      fetchPOs();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to cancel');
    }
  };

  const handleDelete = async (po) => {
    const confirmed = await confirmDialog({
      title: 'Delete Purchase Order',
      message: `Permanently delete ${po.po_number}? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.delete(`/purchase-orders/${po.id}`);
      toast.success('Purchase order deleted');
      fetchPOs();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to delete');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <ClipboardList className="w-8 h-8 text-teal-600 p-1.5 bg-teal-100 rounded-lg" />
            Vendor Purchase Orders
          </h1>
          <p className="text-slate-500 mt-1">Itemize what's being ordered from a vendor before the bill arrives — convert to a bill once it does.</p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-medium shadow-sm transition-colors"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancel' : 'New Purchase Order'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Vendor *</label>
              <select required value={form.vendor_id} onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value }))} className={inputCls}>
                <option value="">-- Select Vendor --</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">PO Date *</label>
              <input required type="date" value={form.po_date} onChange={e => setForm(f => ({ ...f, po_date: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Reference / Notes</label>
              <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inputCls} placeholder="Optional" />
            </div>
          </div>

          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs font-bold text-slate-500 uppercase">
                <tr>
                  <th className="p-2 text-left">Item</th>
                  <th className="p-2 text-left w-24">HSN</th>
                  <th className="p-2 text-right w-24">Qty</th>
                  <th className="p-2 text-right w-32">Unit Price (₹)</th>
                  <th className="p-2 text-right w-32">Amount (₹)</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {form.items.map((it, idx) => (
                  <tr key={idx}>
                    <td className="p-2">
                      <input type="text" value={it.description} onChange={e => updateItem(idx, 'description', e.target.value)} placeholder="e.g. Security Uniforms" className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm" />
                    </td>
                    <td className="p-2">
                      <input type="text" value={it.hsn_code} onChange={e => updateItem(idx, 'hsn_code', e.target.value)} className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm" />
                    </td>
                    <td className="p-2">
                      <input type="number" min="0.01" step="0.01" value={it.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm text-right" />
                    </td>
                    <td className="p-2">
                      <input type="number" min="0" step="0.01" value={it.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)} className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm text-right" />
                    </td>
                    <td className="p-2 text-right font-medium text-slate-700">
                      ₹{((parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-2 text-center">
                      <button type="button" onClick={() => removeItem(idx)} className="text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" onClick={addItem} className="w-full py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50 border-t border-slate-200 flex items-center justify-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Add Item
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">GST</label>
              <select value={form.tax_type} onChange={e => setForm(f => ({ ...f, tax_type: e.target.value }))} className={inputCls}>
                <option value="none">None</option>
                <option value="cgst_sgst">CGST + SGST</option>
                <option value="igst">IGST</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">GST Rate (%)</label>
              <input type="number" min="0" max="100" step="0.1" value={form.tax_rate} onChange={e => setForm(f => ({ ...f, tax_rate: e.target.value }))} disabled={form.tax_type === 'none'} className={`${inputCls} disabled:opacity-50`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1" title="Not a PO-time tax event — TDS applies when the bill is booked/paid. Captured here for planning and carried through to the bill on conversion.">Expected TDS Rate (%)</label>
              <input type="number" min="0" max="30" step="0.1" value={form.tds_rate} onChange={e => setForm(f => ({ ...f, tds_rate: e.target.value }))} placeholder="Optional" className={inputCls} />
            </div>
            <label className="flex items-center gap-2 pb-2">
              <input type="checkbox" checked={form.is_rcm_applicable} onChange={e => setForm(f => ({ ...f, is_rcm_applicable: e.target.checked }))} />
              <span className="text-xs font-medium text-slate-700">RCM Applicable</span>
            </label>
            <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-0.5">
              <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between text-slate-500"><span>GST</span><span>₹{gstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between font-bold text-slate-800 border-t border-slate-200 pt-1"><span>Total</span><span>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={resetForm} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={submitting} className="px-5 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-sm disabled:opacity-50">
              {submitting ? 'Creating...' : 'Create Purchase Order'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Search by PO number or vendor..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">PO Number</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Vendor</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Date</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase">Items</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Total</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase">Status</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
              ) : pos.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No purchase orders yet</td></tr>
              ) : pos.map(po => (
                <tr key={po.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-mono text-slate-700">{po.po_number}</td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-800">{po.vendor_name}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{po.po_date}</td>
                  <td className="px-4 py-3 text-sm text-slate-500 text-center">{po.item_count}</td>
                  <td className="px-4 py-3 text-sm font-bold text-slate-800 text-right">₹{parseFloat(po.total_amount).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES[po.status] || 'bg-slate-100 text-slate-600'}`}>{po.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openView(po)} title="View" className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg"><Eye className="w-4 h-4" /></button>
                      {po.status === 'draft' && (
                        <>
                          <button onClick={() => openConvert(po)} title="Convert to Bill" className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg"><ArrowRightCircle className="w-4 h-4" /></button>
                          <button onClick={() => handleCancel(po)} title="Cancel" className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg"><Ban className="w-4 h-4" /></button>
                          <button onClick={() => handleDelete(po)} title="Delete" className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                        </>
                      )}
                      {po.status === 'billed' && (
                        <span className="text-xs text-emerald-600 flex items-center gap-1 pr-1"><CheckCircle2 className="w-3.5 h-3.5" /> Billed</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-200">
          <Pagination pagination={pagination} onPageChange={setPage} />
        </div>
      </div>

      {/* View Modal */}
      {viewPo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800">{viewPo.po_number} — {viewPo.vendor_name}</h3>
              <button onClick={() => setViewPo(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-4 gap-3 text-sm">
                <div><span className="text-slate-400 block text-xs">Date</span>{viewPo.po_date}</div>
                <div><span className="text-slate-400 block text-xs">Status</span><span className="capitalize">{viewPo.status}</span></div>
                <div><span className="text-slate-400 block text-xs">Vendor GSTIN</span>{viewPo.vendor_gstin || 'N/A'}</div>
                <div><span className="text-slate-400 block text-xs">Expected TDS</span>{parseFloat(viewPo.tds_rate) > 0 ? `${viewPo.tds_rate}%` : 'None'}</div>
              </div>
              <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                  <tr><th className="p-2 text-left">Item</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Rate</th><th className="p-2 text-right">Amount</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {viewPo.items?.map(it => (
                    <tr key={it.id}>
                      <td className="p-2">{it.description}</td>
                      <td className="p-2 text-right">{it.quantity}</td>
                      <td className="p-2 text-right">₹{parseFloat(it.unit_price).toLocaleString('en-IN')}</td>
                      <td className="p-2 text-right">₹{parseFloat(it.amount).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-0.5 max-w-xs ml-auto">
                <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>₹{parseFloat(viewPo.subtotal).toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between text-slate-500"><span>CGST</span><span>₹{parseFloat(viewPo.cgst_amount).toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between text-slate-500"><span>SGST</span><span>₹{parseFloat(viewPo.sgst_amount).toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between text-slate-500"><span>IGST</span><span>₹{parseFloat(viewPo.igst_amount).toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between font-bold text-slate-800 border-t border-slate-200 pt-1"><span>Total</span><span>₹{parseFloat(viewPo.total_amount).toLocaleString('en-IN')}</span></div>
              </div>
              {viewPo.notes && <p className="text-xs text-slate-400">Notes: {viewPo.notes}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Convert-to-Bill Modal */}
      {convertModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-emerald-50">
              <h3 className="text-lg font-bold text-emerald-800">Convert {convertModal.po?.po_number} to a Bill</h3>
              <button onClick={() => setConvertModal({ ...convertModal, open: false })} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleConvert} className="p-6 space-y-4">
              <p className="text-xs text-slate-500">This creates a real vendor bill (expense) for ₹{parseFloat(convertModal.po?.total_amount || 0).toLocaleString('en-IN')}, ready to pay from Bank & Payments → Vendor Payments.</p>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Bill Date</label>
                <input type="date" value={convertModal.expense_date} onChange={e => setConvertModal(m => ({ ...m, expense_date: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Default Payment Method</label>
                <select value={convertModal.payment_method} onChange={e => setConvertModal(m => ({ ...m, payment_method: e.target.value }))} className={inputCls}>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                  <option value="upi">UPI</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setConvertModal({ ...convertModal, open: false })} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={converting} className="px-5 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 shadow-sm disabled:opacity-50">
                  {converting ? 'Converting...' : 'Convert to Bill'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
