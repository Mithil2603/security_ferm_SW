import { useState, useEffect } from 'react';
import { Receipt, Plus, CheckCircle, XCircle, Trash2, X } from 'lucide-react';
import api from '../services/api';
import { getServerBaseUrl } from '../utils/apiUrl';
import { format } from 'date-fns';
import Pagination from '../components/Pagination';
import TableSkeleton from '../components/TableSkeleton';

// Categories are now fetched dynamically from the database

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
];

const emptyForm = {
  expense_date: format(new Date(), 'yyyy-MM-dd'),
  category: '',
  description: '',
  amount: '',
  payment_method: 'cash',
  vendor_id: '',
  receipt_number: '',
  notes: ''
};

export default function Expenses() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [receiptFile, setReceiptFile] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [categories, setCategories] = useState([]);
  const [vendors, setVendors] = useState([]);
  
  // Payment Modal State
  const [payModalExpense, setPayModalExpense] = useState(null);
  const [payFormData, setPayFormData] = useState({ amount: '', payment_method: 'bank_transfer', payment_date: format(new Date(), 'yyyy-MM-dd'), reference_number: '', notes: '' });

  // Reject Modal State
  const [rejectModal, setRejectModal] = useState({ open: false, id: null, reason: '' });
  const [rejecting, setRejecting] = useState(false);
  const [paying, setPaying] = useState(false);

  const fetchCategories = async () => {
    try {
      const res = await api.get('/expenses/categories');
      setCategories(res.data || []);
    } catch (err) {
      console.error('Failed to fetch categories', err);
    }
  };

  const fetchVendors = async () => {
    try {
      const res = await api.get('/vendors');
      setVendors(res.data || []);
    } catch (err) {
      console.error('Failed to fetch vendors', err);
    }
  };

  const fetchExpenses = async () => {
    try {
      setLoading(true);
      const url = statusFilter ? `/expenses?status=${statusFilter}&page=${page}&limit=20` : `/expenses?page=${page}&limit=20`;
      const response = await api.get(url);
      setExpenses(response.data || []);
      if (response.pagination) setPagination(response.pagination);
    } catch (err) {
      console.error('Failed to fetch expenses', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { 
    fetchExpenses(); 
    fetchCategories();
    fetchVendors();
  }, [statusFilter, page]);

  useEffect(() => { setPage(1); }, [statusFilter]);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const openCreateModal = () => {
    setFormData({ ...emptyForm });
    setReceiptFile(null);
    setError('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const data = new FormData();
      Object.keys(formData).forEach(key => {
        if (formData[key] !== null && formData[key] !== undefined) {
          data.append(key, formData[key]);
        }
      });
      if (receiptFile) data.append('receipt_file', receiptFile);

      // Using raw axios for FormData to prevent Content-Type being strictly JSON in our interceptor
      // Wait, axios automatically sets correct Content-Type for FormData, but our interceptor forces JSON.
      // We will override headers.
      await api.post('/expenses', data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setIsModalOpen(false);
      fetchExpenses();
    } catch (err) {
      setError(err.message || 'Failed to record expense');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (id) => {
    if (!window.confirm("Are you sure you want to approve this expense?")) return;
    try {
      await api.put(`/expenses/${id}/approve`, { approval_notes: '' });
      fetchExpenses();
    } catch (err) {
      console.error('Failed to approve expense', err);
    }
  };

  const handleReject = (id) => {
    setRejectModal({ open: true, id, reason: '' });
  };

  const handleRejectSubmit = async (e) => {
    e.preventDefault();
    if (!rejectModal.id) return;
    setRejecting(true);
    try {
      await api.put(`/expenses/${rejectModal.id}/reject`, { approval_notes: rejectModal.reason || '' });
      setRejectModal({ open: false, id: null, reason: '' });
      fetchExpenses();
    } catch (err) {
      console.error('Failed to reject expense', err);
      alert(err.message || 'Failed to reject expense');
    } finally {
      setRejecting(false);
    }
  };

  const handlePaySubmit = async (e) => {
    e.preventDefault();
    setPaying(true);
    try {
      await api.post(`/expenses/${payModalExpense.id}/pay`, payFormData);
      setPayModalExpense(null);
      fetchExpenses();
    } catch (err) {
      alert(err.message || 'Failed to record payment');
    } finally {
      setPaying(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this expense permanently?")) return;
    try {
      await api.delete(`/expenses/${id}`);
      fetchExpenses();
    } catch (err) {
      console.error('Failed to delete expense', err);
      alert('Failed to delete expense');
    }
  };

  const inputCls = "w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Receipt className="w-6 h-6 text-teal-600" />
            Expenses Management
          </h1>
          <p className="text-slate-500 text-sm mt-1">Track company expenditures and manage approvals.</p>
        </div>
        <button onClick={openCreateModal}
          className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Record Expense
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-4">
          <div className="flex gap-2 flex-wrap">
            {['', 'pending', 'approved', 'rejected'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${statusFilter === s ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-semibold">Date</th>
                <th className="px-6 py-4 font-semibold">Category</th>
                <th className="px-6 py-4 font-semibold">Description</th>
                <th className="px-6 py-4 font-semibold text-right">Amount / Bal</th>
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
              ) : expenses.length === 0 ? (
                <tr><td colSpan="6" className="px-6 py-12 text-center text-slate-500">
                  <div className="flex justify-center mb-3"><Receipt className="w-10 h-10 text-slate-300" /></div>
                  <p className="font-medium text-slate-600 mb-1">No expenses recorded</p>
                  <p className="text-xs">Click "Record Expense" to add one.</p>
                </td></tr>
              ) : (
                expenses.map((expense) => (
                  <tr key={expense.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-slate-600 font-medium">
                      {format(new Date(expense.expense_date), 'MMM dd, yyyy')}
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 uppercase tracking-wide">
                        {expense.category.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-800">{expense.description}</div>
                      {expense.vendor_name && <div className="text-slate-500 text-xs mt-0.5">Vendor: {expense.vendor_name}</div>}
                      <div className="text-slate-400 text-xs mt-0.5 flex gap-2 items-center">
                        <span>By {expense.created_by_name}</span>
                        {expense.receipt_url && (
                          <a 
                            href={`${getServerBaseUrl()}${expense.receipt_url}`} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="text-teal-600 hover:underline flex items-center gap-1 ml-2"
                          >
                            <Receipt className="w-3 h-3" /> View Receipt
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="font-bold text-slate-900">₹{parseFloat(expense.amount).toLocaleString('en-IN')}</div>
                      {expense.amount_paid > 0 && (
                        <div className="text-xs text-emerald-600 mt-1">Paid: ₹{parseFloat(expense.amount_paid).toLocaleString('en-IN')}</div>
                      )}
                      {(expense.amount - (expense.amount_paid || 0)) > 0 && expense.status !== 'rejected' && (
                        <div className="text-xs text-amber-600">Bal: ₹{parseFloat(expense.amount - (expense.amount_paid || 0)).toLocaleString('en-IN')}</div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium capitalize border
                        ${expense.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          expense.status === 'rejected' ? 'bg-red-50 text-red-700 border-red-200' :
                          expense.status === 'paid' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                          'bg-amber-50 text-amber-700 border-amber-200'}`}>
                        {expense.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 flex-wrap">
                        {expense.status !== 'rejected' && expense.status !== 'paid' && (
                          <button 
                            onClick={() => {
                              setPayModalExpense(expense);
                              setPayFormData({ ...payFormData, amount: expense.amount - (expense.amount_paid || 0) });
                            }}
                            className="px-2 py-1 bg-teal-50 text-teal-700 text-xs font-medium border border-teal-200 hover:bg-teal-100 rounded transition-colors"
                          >
                            Pay
                          </button>
                        )}
                        {expense.status === 'pending' && (
                          <>
                            <button onClick={() => handleApprove(expense.id)}
                              className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Approve">
                              <CheckCircle className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleReject(expense.id)}
                              className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Reject">
                              <XCircle className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {(expense.status === 'pending' || expense.status === 'rejected') && (
                          <button onClick={() => handleDelete(expense.id)}
                            className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
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

      {/* Add Expense Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-slide-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-teal-600" /> Record Expense
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6">
              {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Date *</label>
                    <input required type="date" name="expense_date" value={formData.expense_date} onChange={handleInputChange} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
                    <select required name="category" value={formData.category} onChange={handleInputChange} className={inputCls}>
                      <option value="">-- Select Category --</option>
                      {categories.map(c => <option key={c.id} value={c.name}>{c.name.replace('_', ' ').toUpperCase()}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description *</label>
                  <input required type="text" name="description" value={formData.description} onChange={handleInputChange} className={inputCls} placeholder="What was this expense for?" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₹) *</label>
                    <input required type="number" min="0.01" step="0.01" name="amount" value={formData.amount} onChange={handleInputChange} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method *</label>
                    <select required name="payment_method" value={formData.payment_method} onChange={handleInputChange} className={inputCls}>
                      {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Vendor</label>
                    <select name="vendor_id" value={formData.vendor_id} onChange={handleInputChange} className={inputCls}>
                      <option value="">-- No Vendor --</option>
                      {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Receipt Number</label>
                    <input type="text" name="receipt_number" value={formData.receipt_number} onChange={handleInputChange} className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Receipt Attachment</label>
                  <input type="file" accept="image/*,.pdf" onChange={e => setReceiptFile(e.target.files[0])} className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                  <textarea name="notes" value={formData.notes} onChange={handleInputChange} rows="2" className={inputCls} />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-slate-100">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-sm disabled:opacity-50">
                  {submitting ? 'Saving...' : 'Record Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {payModalExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800">Record Payment</h3>
              <button onClick={() => setPayModalExpense(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handlePaySubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₹) *</label>
                <input required type="number" min="0.01" step="0.01" value={payFormData.amount} onChange={e => setPayFormData({...payFormData, amount: e.target.value})} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method *</label>
                  <select required value={payFormData.payment_method} onChange={e => setPayFormData({...payFormData, payment_method: e.target.value})} className={inputCls}>
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Date *</label>
                  <input required type="date" value={payFormData.payment_date} onChange={e => setPayFormData({...payFormData, payment_date: e.target.value})} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reference Number</label>
                <input type="text" value={payFormData.reference_number} onChange={e => setPayFormData({...payFormData, reference_number: e.target.value})} className={inputCls} placeholder="e.g. UTR / Cheque No" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea rows="2" value={payFormData.notes} onChange={e => setPayFormData({...payFormData, notes: e.target.value})} className={inputCls}></textarea>
              </div>
              <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-slate-100">
                <button type="button" onClick={() => setPayModalExpense(null)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={paying} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50">
                  {paying ? 'Saving...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {rejectModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-rose-50">
              <h3 className="text-lg font-bold text-rose-800">Reject Expense</h3>
              <button type="button" onClick={() => setRejectModal({ open: false, id: null, reason: '' })} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleRejectSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Rejection Reason (Optional)</label>
                <textarea
                  rows="3"
                  value={rejectModal.reason}
                  onChange={e => setRejectModal({ ...rejectModal, reason: e.target.value })}
                  className={inputCls}
                  placeholder="Enter reason for rejecting this expense..."
                  autoFocus
                ></textarea>
              </div>
              <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-slate-100">
                <button type="button" onClick={() => setRejectModal({ open: false, id: null, reason: '' })} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={rejecting} className="px-4 py-2 text-sm font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50">
                  {rejecting ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
