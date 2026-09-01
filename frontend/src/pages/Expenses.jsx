import { useState, useEffect } from 'react';
import { Receipt, Plus, CheckCircle, XCircle, Trash2, X, Download, Eye, ExternalLink, Building, Image as ImageIcon, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { getServerBaseUrl } from '../utils/apiUrl';
import { format } from 'date-fns';
import { toast, confirmDialog } from '../context/ToastContext';
import Pagination from '../components/Pagination';
import TableSkeleton from '../components/TableSkeleton';

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
  
  // Quick Add Vendor State
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [vendorForm, setVendorForm] = useState({ name: '', contact_info: '', payment_terms_days: '0' });
  const [creatingVendor, setCreatingVendor] = useState(false);
  const [vendorError, setVendorError] = useState('');

  // Receipt Preview & Download Modal State
  const [selectedReceipt, setSelectedReceipt] = useState(null);

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
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const openCreateModal = () => {
    setFormData({ ...emptyForm, expense_date: format(new Date(), 'yyyy-MM-dd') });
    setReceiptFile(null);
    setError('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Field validations
    if (!formData.expense_date) {
      const msg = 'Please select the expense date';
      setError(msg);
      toast.warning(msg);
      return;
    }
    if (!formData.category) {
      const msg = 'Please select an expense category';
      setError(msg);
      toast.warning(msg);
      return;
    }
    if (!formData.description || formData.description.trim().length < 3) {
      const msg = 'Please provide a clear description (at least 3 characters)';
      setError(msg);
      toast.warning(msg);
      return;
    }
    const amt = parseFloat(formData.amount);
    if (isNaN(amt) || amt <= 0) {
      const msg = 'Please enter a valid amount greater than zero';
      setError(msg);
      toast.warning(msg);
      return;
    }

    if (receiptFile) {
      // Validate receipt size (max 10MB)
      if (receiptFile.size > 10 * 1024 * 1024) {
        const msg = 'Receipt file size exceeds 10MB limit. Please choose a smaller file.';
        setError(msg);
        toast.error(msg);
        return;
      }
      // Validate file extension
      const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.gif'];
      const fileExt = '.' + (receiptFile.name.split('.').pop() || '').toLowerCase();
      if (!validExtensions.includes(fileExt)) {
        const msg = 'Invalid receipt format. Only JPG, PNG, WEBP, and PDF files are allowed.';
        setError(msg);
        toast.error(msg);
        return;
      }
    }

    setSubmitting(true);
    try {
      const data = new FormData();
      Object.keys(formData).forEach(key => {
        if (formData[key] !== null && formData[key] !== undefined) {
          if (key === 'vendor_id') {
            if (formData[key] && parseInt(formData[key]) > 0) {
              data.append(key, formData[key]);
            }
          } else {
            data.append(key, formData[key]);
          }
        }
      });
      if (receiptFile) data.append('receipt_file', receiptFile);

      await api.post('/expenses', data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      toast.success('Expense recorded successfully!');
      setIsModalOpen(false);
      setFormData({ ...emptyForm, expense_date: format(new Date(), 'yyyy-MM-dd') });
      setReceiptFile(null);
      fetchExpenses();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to record expense';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateVendor = async (e) => {
    e.preventDefault();
    if (!vendorForm.name.trim()) {
      setVendorError('Vendor name is required');
      return;
    }
    setVendorError('');
    setCreatingVendor(true);
    try {
      const res = await api.post('/vendors', {
        name: vendorForm.name.trim(),
        contact_info: vendorForm.contact_info,
        payment_terms_days: parseInt(vendorForm.payment_terms_days) || 0
      });
      const newVendor = res.data;
      await fetchVendors();
      if (newVendor && newVendor.id) {
        setFormData(prev => ({ ...prev, vendor_id: newVendor.id }));
      }
      setIsVendorModalOpen(false);
      setVendorForm({ name: '', contact_info: '', payment_terms_days: '0' });
    } catch (err) {
      setVendorError(err.response?.data?.message || err.message || 'Failed to create vendor');
    } finally {
      setCreatingVendor(false);
    }
  };

  const handleDownloadReceipt = async (receiptUrl, filename = 'expense-receipt') => {
    try {
      const fullUrl = `${getServerBaseUrl()}${receiptUrl}`;
      const res = await fetch(fullUrl);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = receiptUrl.split('.').pop() || 'png';
      a.download = `${filename}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      // fallback
      window.open(`${getServerBaseUrl()}${receiptUrl}`, '_blank');
    }
  };

  const handleApprove = async (id) => {
    const confirmed = await confirmDialog({
      title: 'Approve Expense',
      message: 'Are you sure you want to approve this expense?',
      confirmText: 'Approve',
      variant: 'teal'
    });
    if (!confirmed) return;
    try {
      await api.put(`/expenses/${id}/approve`, { approval_notes: '' });
      toast.success('Expense approved successfully!');
      fetchExpenses();
    } catch (err) {
      console.error('Failed to approve expense', err);
      toast.error(err.response?.data?.message || err.message || 'Failed to approve expense');
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
      toast.success('Expense rejected');
      fetchExpenses();
    } catch (err) {
      console.error('Failed to reject expense', err);
      toast.error(err.response?.data?.message || err.message || 'Failed to reject expense');
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
      toast.success('Payment recorded successfully!');
      fetchExpenses();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to record payment');
    } finally {
      setPaying(false);
    }
  };

  const handleDelete = async (id) => {
    const confirmed = await confirmDialog({
      title: 'Delete Expense',
      message: 'Are you sure you want to delete this expense permanently?',
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;
    try {
      await api.delete(`/expenses/${id}`);
      toast.success('Expense deleted permanently');
      fetchExpenses();
    } catch (err) {
      console.error('Failed to delete expense', err);
      toast.error(err.response?.data?.message || err.message || 'Failed to delete expense');
    }
  };

  const inputCls = "w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm bg-white text-slate-800 transition-all";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Receipt className="w-6 h-6 text-teal-600" />
            Expenses Management
          </h1>
          <p className="text-slate-500 text-sm mt-1">Track company expenditures, receipts, and vendor payouts.</p>
        </div>
        <div className="flex gap-2.5">
          <Link
            to="/vendor-ledger"
            className="bg-white hover:bg-slate-50 text-slate-700 font-medium px-3.5 py-2 rounded-lg border border-slate-300 text-sm transition-colors shadow-sm flex items-center gap-2"
          >
            <Building className="w-4 h-4 text-slate-500" />
            Vendor Ledger
          </Link>
          <button 
            onClick={openCreateModal}
            className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors shadow-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Record Expense
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex gap-2 flex-wrap">
            {['', 'pending', 'approved', 'rejected'].map(s => (
              <button 
                key={s} 
                onClick={() => setStatusFilter(s)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  statusFilter === s 
                    ? 'bg-teal-600 text-white border-teal-600 shadow-sm' 
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All Expenses'}
              </button>
            ))}
          </div>
          {pagination && (
            <div className="text-xs text-slate-500">
              Total Records: <span className="font-bold text-slate-800">{pagination.total || 0}</span>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-semibold">Date</th>
                <th className="px-6 py-4 font-semibold">Category</th>
                <th className="px-6 py-4 font-semibold">Description / Vendor</th>
                <th className="px-4 py-4 font-semibold text-center">Receipt</th>
                <th className="px-6 py-4 font-semibold text-right">Amount / Bal</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="7">
                    <TableSkeleton columns={7} rows={10} />
                  </td>
                </tr>
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-slate-500">
                    <div className="flex justify-center mb-3"><Receipt className="w-10 h-10 text-slate-300" /></div>
                    <p className="font-medium text-slate-600 mb-1">No expenses recorded</p>
                    <p className="text-xs">Click "Record Expense" to add one.</p>
                  </td>
                </tr>
              ) : (
                expenses.map((expense) => (
                  <tr key={expense.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-slate-700 font-semibold whitespace-nowrap">
                      {format(new Date(expense.expense_date), 'MMM dd, yyyy')}
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 uppercase tracking-wide">
                        {expense.category.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-800">{expense.description}</div>
                      {expense.vendor_name && (
                        <div className="text-slate-500 text-xs mt-0.5 flex items-center gap-1">
                          <Building className="w-3 h-3 text-slate-400" />
                          <span>Vendor: <strong className="text-slate-700">{expense.vendor_name}</strong></span>
                        </div>
                      )}
                      <div className="text-slate-400 text-xs mt-0.5">By {expense.created_by_name || 'Staff'}</div>
                    </td>
                    
                    {/* Dedicated Receipt Thumbnail / View Column */}
                    <td className="px-4 py-4 text-center">
                      {expense.receipt_url ? (
                        <button
                          type="button"
                          onClick={() => setSelectedReceipt(expense)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded-lg text-xs font-semibold transition-colors shadow-sm group"
                          title="View and download receipt"
                        >
                          {expense.receipt_url.match(/\.(jpg|jpeg|png|webp)$/i) ? (
                            <ImageIcon className="w-3.5 h-3.5 text-teal-600" />
                          ) : (
                            <FileText className="w-3.5 h-3.5 text-teal-600" />
                          )}
                          <span>View Receipt</span>
                        </button>
                      ) : (
                        <span className="text-xs text-slate-300 font-normal">No receipt</span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-right">
                      <div className="font-bold text-slate-900">₹{parseFloat(expense.amount).toLocaleString('en-IN')}</div>
                      {expense.amount_paid > 0 && (
                        <div className="text-xs text-emerald-600 mt-0.5">Paid: ₹{parseFloat(expense.amount_paid).toLocaleString('en-IN')}</div>
                      )}
                      {(expense.amount - (expense.amount_paid || 0)) > 0 && expense.status !== 'rejected' && (
                        <div className="text-xs text-amber-600 font-medium">Bal: ₹{parseFloat(expense.amount - (expense.amount_paid || 0)).toLocaleString('en-IN')}</div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold capitalize border
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
                              setPayFormData({ 
                                amount: expense.amount - (expense.amount_paid || 0),
                                payment_method: 'bank_transfer',
                                payment_date: format(new Date(), 'yyyy-MM-dd'),
                                reference_number: '',
                                notes: ''
                              });
                            }}
                            className="px-2.5 py-1 bg-teal-50 text-teal-700 text-xs font-bold border border-teal-200 hover:bg-teal-100 rounded-lg transition-colors"
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

      {/* ─── Receipt Preview & Download Modal ────────────────────────────────────── */}
      {selectedReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-slide-up border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-teal-600" />
                <h3 className="text-base font-bold text-slate-800">
                  Expense Receipt — ₹{parseFloat(selectedReceipt.amount).toLocaleString('en-IN')}
                </h3>
              </div>
              <button 
                onClick={() => setSelectedReceipt(null)} 
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 flex flex-col items-center justify-center bg-slate-50/50 min-h-[300px]">
              {selectedReceipt.receipt_url.match(/\.(jpg|jpeg|png|webp|gif)$/i) ? (
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white p-2 max-w-full">
                  <img 
                    src={`${getServerBaseUrl()}${selectedReceipt.receipt_url}`} 
                    alt="Receipt" 
                    className="max-h-[60vh] max-w-full object-contain mx-auto rounded-lg"
                  />
                </div>
              ) : (
                <div className="w-full h-[60vh] border border-slate-200 rounded-xl overflow-hidden bg-white">
                  <iframe 
                    src={`${getServerBaseUrl()}${selectedReceipt.receipt_url}`} 
                    title="PDF Receipt" 
                    className="w-full h-full"
                  />
                </div>
              )}

              <div className="mt-4 w-full bg-white p-3.5 rounded-xl border border-slate-200 text-xs grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-600">
                <div>
                  <span className="block text-slate-400">Date:</span>
                  <span className="font-semibold text-slate-800">{selectedReceipt.expense_date}</span>
                </div>
                <div>
                  <span className="block text-slate-400">Category:</span>
                  <span className="font-semibold text-slate-800">{selectedReceipt.category}</span>
                </div>
                <div>
                  <span className="block text-slate-400">Vendor:</span>
                  <span className="font-semibold text-slate-800">{selectedReceipt.vendor_name || 'N/A'}</span>
                </div>
                <div>
                  <span className="block text-slate-400">Receipt #:</span>
                  <span className="font-semibold text-slate-800">{selectedReceipt.receipt_number || 'N/A'}</span>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-white flex justify-between items-center shrink-0">
              <a 
                href={`${getServerBaseUrl()}${selectedReceipt.receipt_url}`} 
                target="_blank" 
                rel="noreferrer"
                className="text-xs text-teal-600 hover:underline flex items-center gap-1 font-medium"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open in New Tab
              </a>
              <div className="flex gap-2">
                <button 
                  type="button" 
                  onClick={() => setSelectedReceipt(null)} 
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Close
                </button>
                <button 
                  type="button"
                  onClick={() => handleDownloadReceipt(selectedReceipt.receipt_url, `Receipt-${selectedReceipt.id}-${selectedReceipt.expense_date}`)}
                  className="px-4 py-2 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-sm flex items-center gap-2"
                >
                  <Download className="w-4 h-4" /> Download Receipt
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Record Expense Modal ─────────────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-slide-up my-6 max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-teal-600" /> Record Expense
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-4">
              {error && <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">{error}</div>}
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Expense Date *</label>
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
                  <input required type="number" min="0.01" step="0.01" name="amount" value={formData.amount} onChange={handleInputChange} className={inputCls} placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method *</label>
                  <select required name="payment_method" value={formData.payment_method} onChange={handleInputChange} className={inputCls}>
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Vendor Selection with Quick Add New Vendor */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-slate-700">Vendor (Optional)</label>
                  <button 
                    type="button" 
                    onClick={() => {
                      setVendorForm({ name: '', contact_info: '', payment_terms_days: '0' });
                      setVendorError('');
                      setIsVendorModalOpen(true);
                    }}
                    className="text-xs font-bold text-teal-700 hover:text-teal-800 bg-teal-50 hover:bg-teal-100 px-2 py-0.5 rounded transition-colors flex items-center gap-1 border border-teal-200"
                  >
                    <Plus className="w-3 h-3" /> New Vendor
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <select name="vendor_id" value={formData.vendor_id} onChange={handleInputChange} className={inputCls}>
                    <option value="">-- No Vendor --</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                  <input type="text" name="receipt_number" value={formData.receipt_number} onChange={handleInputChange} className={inputCls} placeholder="Receipt / Bill No." />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Receipt Attachment (Image or PDF)</label>
                <div className="flex items-center gap-2">
                  <input 
                    type="file" 
                    accept="image/*,.pdf" 
                    onChange={e => {
                      const file = e.target.files[0];
                      if (file) {
                        if (file.size > 10 * 1024 * 1024) {
                          toast.error('File size exceeds 10MB limit');
                          e.target.value = '';
                          return;
                        }
                        setReceiptFile(file);
                      }
                    }} 
                    className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100 cursor-pointer" 
                  />
                  {receiptFile && (
                    <button
                      type="button"
                      onClick={() => setReceiptFile(null)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg transition-colors shrink-0"
                      title="Remove selected receipt"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {receiptFile && (
                  <p className="text-xs text-teal-700 mt-1.5 flex items-center gap-1 font-medium">
                    ✓ Selected: {receiptFile.name} ({(receiptFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea name="notes" value={formData.notes} onChange={handleInputChange} rows="2" className={inputCls} placeholder="Additional details..." />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="px-5 py-2 text-sm font-bold text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-md disabled:opacity-50">
                  {submitting ? 'Saving...' : 'Record Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Quick Add Vendor Modal ──────────────────────────────────────────────── */}
      {isVendorModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-slide-up border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Building className="w-5 h-5 text-teal-600" /> Add New Vendor
              </h3>
              <button onClick={() => setIsVendorModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateVendor} className="p-6 space-y-4">
              {vendorError && <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">{vendorError}</div>}
              
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Vendor Name *
                </label>
                <input 
                  type="text" 
                  required 
                  autoFocus
                  placeholder="e.g. Acme Uniforms Ltd."
                  value={vendorForm.name} 
                  onChange={e => setVendorForm(prev => ({ ...prev, name: e.target.value }))} 
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Contact Info / Phone / Address
                </label>
                <input 
                  type="text" 
                  placeholder="e.g. Phone: 9876543210, Ahmedabad"
                  value={vendorForm.contact_info} 
                  onChange={e => setVendorForm(prev => ({ ...prev, contact_info: e.target.value }))} 
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Payment Terms (Days)
                </label>
                <input 
                  type="number" 
                  min="0"
                  placeholder="0"
                  value={vendorForm.payment_terms_days} 
                  onChange={e => setVendorForm(prev => ({ ...prev, payment_terms_days: e.target.value }))} 
                  className={inputCls}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsVendorModalOpen(false)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 rounded-lg text-sm transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={creatingVendor} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 rounded-lg text-sm shadow-md transition-colors disabled:opacity-50">
                  {creatingVendor ? 'Adding...' : 'Add Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Payment Modal ───────────────────────────────────────────────────────── */}
      {payModalExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-up border border-slate-100">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800">Record Expense Payment</h3>
              <button onClick={() => setPayModalExpense(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handlePaySubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">Amount (₹) *</label>
                <input required type="number" min="0.01" step="0.01" value={payFormData.amount} onChange={e => setPayFormData(prev => ({ ...prev, amount: e.target.value }))} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">Payment Method *</label>
                  <select required value={payFormData.payment_method} onChange={e => setPayFormData(prev => ({ ...prev, payment_method: e.target.value }))} className={inputCls}>
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">Date *</label>
                  <input required type="date" value={payFormData.payment_date} onChange={e => setPayFormData(prev => ({ ...prev, payment_date: e.target.value }))} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">Reference Number</label>
                <input type="text" value={payFormData.reference_number} onChange={e => setPayFormData(prev => ({ ...prev, reference_number: e.target.value }))} className={inputCls} placeholder="e.g. UTR / Cheque No" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">Notes</label>
                <textarea rows="2" value={payFormData.notes} onChange={e => setPayFormData(prev => ({ ...prev, notes: e.target.value }))} className={inputCls} placeholder="Payment notes..."></textarea>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setPayModalExpense(null)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={paying} className="px-5 py-2 text-sm font-bold text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-md disabled:opacity-50">
                  {paying ? 'Saving...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Rejection Modal ─────────────────────────────────────────────────────── */}
      {rejectModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-up border border-slate-100">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-rose-50">
              <h3 className="text-lg font-bold text-rose-800">Reject Expense</h3>
              <button type="button" onClick={() => setRejectModal({ open: false, id: null, reason: '' })} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleRejectSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">Rejection Reason (Optional)</label>
                <textarea
                  rows="3"
                  value={rejectModal.reason}
                  onChange={e => setRejectModal(prev => ({ ...prev, reason: e.target.value }))}
                  className={inputCls}
                  placeholder="Enter reason for rejecting this expense..."
                  autoFocus
                ></textarea>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setRejectModal({ open: false, id: null, reason: '' })} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={rejecting} className="px-5 py-2 text-sm font-bold text-white bg-rose-600 rounded-lg hover:bg-rose-700 shadow-md disabled:opacity-50">
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
