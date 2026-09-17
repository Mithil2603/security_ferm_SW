import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Plus, Search, Edit2, CheckCircle2, XCircle, FileText,
  Upload, Download, ExternalLink, Eye, AlertCircle, Clock, ShieldCheck,
  Check, X, CreditCard, RefreshCw, Calendar, Tag, Filter, Trash2,
  FileCheck, AlertTriangle, ArrowUpRight
} from 'lucide-react';
import api from '../services/api';
import { getServerBaseUrl } from '../utils/apiUrl';
import { format } from 'date-fns';
import Pagination from '../components/Pagination';
import TableSkeleton from '../components/TableSkeleton';
import { toast, confirmDialog } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

function formatDateSafe(val) {
  if (!val) return '—';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val).slice(0, 10);
    return format(d, 'dd MMM yyyy');
  } catch (_) {
    return String(val).slice(0, 10);
  }
}

const emptyVendorForm = {
  vendor_code: '',
  legal_name: '',
  display_name: '',
  tax_id: '',
  currency: 'INR',
  contact_info: '',
  payment_terms_days: 30,
  bank_name: '',
  bank_account_no: '',
  bank_routing_code: '',
  default_account_id: '',
  is_active: true
};

export default function Vendors() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);

  // Stats & Alert counts
  const [expiringDocs, setExpiringDocs] = useState([]);

  // Category dropdown options
  const [expenseCategories, setExpenseCategories] = useState([]);

  // Add / Edit Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState(null);
  const [formData, setFormData] = useState({ ...emptyVendorForm });
  const [submitting, setSubmitting] = useState(false);

  // Detail / Document Drawer state
  const [viewingVendor, setViewingVendor] = useState(null);
  const [drawerTab, setDrawerTab] = useState('documents'); // 'documents' | 'overview'
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // Document Upload state
  const [uploadDocType, setUploadDocType] = useState('GST Certificate');
  const [uploadExpiryDate, setUploadExpiryDate] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  // Fetch Vendors
  const fetchVendors = async () => {
    try {
      setLoading(true);
      let queryUrl = `/vendors?page=${page}&limit=15`;
      if (searchTerm) queryUrl += `&search=${encodeURIComponent(searchTerm)}`;
      if (statusFilter !== '') queryUrl += `&is_active=${statusFilter}`;

      const res = await api.get(queryUrl);
      setVendors(res.data || []);
      if (res.pagination) setPagination(res.pagination);
    } catch (err) {
      console.error('Failed to fetch vendors', err);
      toast.error('Failed to load vendors');
    } finally {
      setLoading(false);
    }
  };

  // Fetch Categories and Alerts
  const fetchMeta = async () => {
    try {
      const [catRes, alertRes] = await Promise.all([
        api.get('/expenses/categories').catch(() => ({ data: [] })),
        api.get('/vendors/alerts/expiring-docs').catch(() => ({ data: [] }))
      ]);
      setExpenseCategories(catRes.data || []);
      setExpiringDocs(alertRes.data || []);
    } catch (err) {
      console.error('Failed to fetch metadata', err);
    }
  };

  useEffect(() => {
    fetchVendors();
  }, [page, searchTerm, statusFilter]);

  useEffect(() => {
    fetchMeta();
  }, []);

  // Fetch documents for selected vendor
  const fetchVendorDocuments = async (vendorId) => {
    try {
      setLoadingDocs(true);
      const res = await api.get(`/vendors/${vendorId}/documents`);
      setDocuments(res.data || []);
    } catch (err) {
      console.error('Failed to fetch vendor documents', err);
    } finally {
      setLoadingDocs(false);
    }
  };

  const openViewDrawer = (vendor, tab = 'documents') => {
    setViewingVendor(vendor);
    setDrawerTab(tab);
    fetchVendorDocuments(vendor.id);
  };

  const openCreateModal = () => {
    setEditingVendor(null);
    setFormData({ ...emptyVendorForm });
    setIsModalOpen(true);
  };

  const openEditModal = (vendor) => {
    setEditingVendor(vendor);
    setFormData({
      vendor_code: vendor.vendor_code || '',
      legal_name: vendor.legal_name || vendor.name || '',
      display_name: vendor.display_name || vendor.name || '',
      tax_id: vendor.tax_id || '',
      currency: vendor.currency || 'INR',
      contact_info: vendor.contact_info || '',
      payment_terms_days: vendor.payment_terms_days !== undefined ? vendor.payment_terms_days : 30,
      bank_name: vendor.bank_name || '',
      bank_account_no: vendor.bank_account_no || '',
      bank_routing_code: vendor.bank_routing_code || '',
      default_account_id: vendor.default_account_id || '',
      is_active: vendor.is_active !== undefined ? Boolean(vendor.is_active) : true
    });
    setIsModalOpen(true);
  };

  const handleFormChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSaveVendor = async (e) => {
    e.preventDefault();
    if (!formData.display_name.trim() && !formData.legal_name.trim()) {
      toast.error('Vendor Name is required');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        ...formData,
        display_name: formData.display_name.trim() || formData.legal_name.trim(),
        legal_name: formData.legal_name.trim() || formData.display_name.trim(),
        payment_terms_days: parseInt(formData.payment_terms_days) || 0,
        default_account_id: formData.default_account_id ? parseInt(formData.default_account_id) : null
      };

      if (editingVendor) {
        await api.put(`/vendors/${editingVendor.id}`, payload);
        toast.success('Vendor updated successfully');
      } else {
        await api.post('/vendors', payload);
        toast.success('Vendor created successfully');
      }

      setIsModalOpen(false);
      fetchVendors();
    } catch (err) {
      console.error('Save vendor error:', err);
      toast.error(err.response?.data?.message || 'Failed to save vendor');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (vendor) => {
    const action = vendor.is_active ? 'deactivate' : 'activate';
    const confirmed = await confirmDialog({
      title: `Confirm ${action}`,
      message: `Are you sure you want to ${action} ${vendor.display_name || vendor.name}?`
    });
    if (!confirmed) return;

    try {
      await api.patch(`/vendors/${vendor.id}/toggle-status`);
      toast.success(`Vendor ${action}d successfully`);
      fetchVendors();
      if (viewingVendor && viewingVendor.id === vendor.id) {
        setViewingVendor(prev => ({ ...prev, is_active: !prev.is_active }));
      }
    } catch (err) {
      toast.error('Failed to toggle status');
    }
  };

  // Upload Document Handler
  const handleUploadDocument = async (e) => {
    e.preventDefault();
    if (!uploadFile) {
      toast.error('Please choose a file to upload');
      return;
    }

    try {
      setUploading(true);
      const data = new FormData();
      data.append('file', uploadFile);
      data.append('document_type', uploadDocType);
      if (uploadExpiryDate) data.append('expiry_date', uploadExpiryDate);

      await api.post(`/vendors/${viewingVendor.id}/documents`, data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      toast.success('Compliance document uploaded');
      setUploadFile(null);
      setUploadExpiryDate('');
      fetchVendorDocuments(viewingVendor.id);
      fetchMeta();
    } catch (err) {
      console.error('Document upload error:', err);
      toast.error(err.response?.data?.message || 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  // Change Document Status (Approve / Reject)
  const handleUpdateDocStatus = async (docId, newStatus) => {
    let rejectionReason = '';
    if (newStatus === 'Rejected') {
      rejectionReason = window.prompt('Please enter a rejection reason:') || '';
      if (!rejectionReason.trim()) return;
    }

    try {
      await api.patch(`/vendors/${viewingVendor.id}/documents/${docId}/status`, {
        status: newStatus,
        rejection_reason: rejectionReason
      });
      toast.success(`Document marked as ${newStatus}`);
      fetchVendorDocuments(viewingVendor.id);
    } catch (err) {
      toast.error('Failed to update document status');
    }
  };

  // Delete Document
  const handleDeleteDoc = async (docId) => {
    const confirmed = await confirmDialog({
      title: 'Delete Document',
      message: 'Are you sure you want to permanently delete this compliance document?'
    });
    if (!confirmed) return;

    try {
      await api.delete(`/vendors/${viewingVendor.id}/documents/${docId}`);
      toast.success('Document deleted');
      fetchVendorDocuments(viewingVendor.id);
      fetchMeta();
    } catch (err) {
      toast.error('Failed to delete document');
    }
  };

  // Aggregates for Top Cards
  const activeVendorsCount = vendors.filter(v => v.is_active).length;
  const pendingDocsCount = vendors.reduce((acc, v) => acc + (parseInt(v.pending_documents) || 0), 0);
  const totalOutstanding = vendors.reduce((acc, v) => acc + (parseFloat(v.balance_due) || 0), 0);

  const inputCls = "w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Building2 className="w-7 h-7 text-teal-600" />
            Vendor Management
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Supplier directory, payout banking, tax profiles, and compliance document verification
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/vendor-statements')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs"
          >
            <FileText className="w-4 h-4 text-slate-500" />
            Statements
          </button>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-xl hover:bg-teal-700 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add New Vendor
          </button>
        </div>
      </div>

      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Active Vendors
          </span>
          <div className="text-2xl font-bold text-slate-800 flex items-baseline justify-between">
            <span>{activeVendorsCount}</span>
            <span className="text-xs font-normal text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              Operational
            </span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Pending Document Review
          </span>
          <div className="text-2xl font-bold text-slate-800 flex items-baseline justify-between">
            <span className={pendingDocsCount > 0 ? "text-amber-600" : ""}>{pendingDocsCount}</span>
            {pendingDocsCount > 0 ? (
              <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 flex items-center gap-1">
                <Clock className="w-3 h-3" /> Needs Audit
              </span>
            ) : (
              <span className="text-xs font-medium text-slate-400">All cleared</span>
            )}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Expiring Compliance Docs
          </span>
          <div className="text-2xl font-bold text-slate-800 flex items-baseline justify-between">
            <span className={expiringDocs.length > 0 ? "text-rose-600" : ""}>{expiringDocs.length}</span>
            {expiringDocs.length > 0 ? (
              <span className="text-xs font-medium text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> &lt; 30 Days
              </span>
            ) : (
              <span className="text-xs font-medium text-emerald-600">Up to date</span>
            )}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Total Outstanding Payables
          </span>
          <div className="text-2xl font-bold text-slate-800">
            ₹{totalOutstanding.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search code, name, GSTIN..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-teal-500 outline-none transition-all"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-teal-500 outline-none transition-all cursor-pointer"
            >
              <option value="">All Statuses</option>
              <option value="true">Active Only</option>
              <option value="false">Inactive Only</option>
            </select>
          </div>

          <button
            onClick={fetchVendors}
            className="p-2 text-slate-500 hover:text-teal-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Vendors Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50/80 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
              <tr>
                <th className="px-6 py-4">Vendor Code</th>
                <th className="px-6 py-4">Vendor Name</th>
                <th className="px-6 py-4">GSTIN / Tax ID</th>
                <th className="px-6 py-4">Bank Payout Info</th>
                <th className="px-6 py-4">Compliance Docs</th>
                <th className="px-6 py-4 text-right">Balance Due</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-normal">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <TableSkeleton rows={5} cols={8} />
                  </td>
                </tr>
              ) : vendors.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <Building2 className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p className="font-medium text-slate-600">No vendors found</p>
                    <p className="text-xs text-slate-400 mt-0.5">Click "Add New Vendor" to onboard your first supplier</p>
                  </td>
                </tr>
              ) : (
                vendors.map((vendor) => (
                  <tr key={vendor.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="font-mono text-xs font-bold text-teal-700 bg-teal-50 px-2.5 py-1 rounded-md border border-teal-200">
                        {vendor.vendor_code || `VND-${String(vendor.id).padStart(3, '0')}`}
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-800">
                        {vendor.display_name || vendor.name}
                      </div>
                      {vendor.legal_name && vendor.legal_name !== vendor.display_name && (
                        <div className="text-xs text-slate-400 truncate max-w-xs" title={vendor.legal_name}>
                          Legal: {vendor.legal_name}
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4 font-mono text-xs text-slate-700">
                      {vendor.tax_id ? (
                        <span className="px-2 py-0.5 bg-slate-100 rounded border border-slate-200">
                          {vendor.tax_id}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Not provided</span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-xs">
                      {vendor.bank_name ? (
                        <div>
                          <div className="font-medium text-slate-700">{vendor.bank_name}</div>
                          <div className="font-mono text-slate-400">
                            {vendor.bank_account_no ? `••••${vendor.bank_account_no.slice(-4)}` : ''}
                            {vendor.bank_routing_code ? ` (${vendor.bank_routing_code})` : ''}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">No bank details</span>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-slate-700">
                          {vendor.total_documents || 0} docs
                        </span>
                        {vendor.pending_documents > 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                            <Clock className="w-2.5 h-2.5" /> {vendor.pending_documents} review
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-6 py-4 text-right font-medium text-slate-800 whitespace-nowrap">
                      ₹{parseFloat(vendor.balance_due || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>

                    <td className="px-6 py-4 text-center">
                      {vendor.is_active ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                          <XCircle className="w-3 h-3" /> Inactive
                        </span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openViewDrawer(vendor, 'documents')}
                          className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors cursor-pointer"
                          title="View Profile & Compliance Documents"
                        >
                          <FileCheck className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEditModal(vendor)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                          title="Edit Vendor"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => navigate(`/vendor-statements?vendorId=${vendor.id}`)}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                          title="View Statement & Invoices"
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleToggleStatus(vendor)}
                          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                            vendor.is_active ? 'text-slate-400 hover:text-amber-600 hover:bg-amber-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                          }`}
                          title={vendor.is_active ? 'Deactivate' : 'Activate'}
                        >
                          {vendor.is_active ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
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

      {/* Add / Edit Vendor Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden animate-slide-up max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-teal-600" />
                {editingVendor ? 'Edit Vendor Profile' : 'Onboard New Vendor'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveVendor} className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* Primary Identity Section */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                  <Tag className="w-4 h-4 text-teal-600" />
                  Primary Identity
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Display Name *</label>
                    <input
                      required
                      type="text"
                      name="display_name"
                      placeholder="e.g. Apex Security Gear"
                      value={formData.display_name}
                      onChange={handleFormChange}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Legal Registered Name</label>
                    <input
                      type="text"
                      name="legal_name"
                      placeholder="e.g. Apex Uniforms Private Limited"
                      value={formData.legal_name}
                      onChange={handleFormChange}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Vendor Code</label>
                    <input
                      type="text"
                      name="vendor_code"
                      placeholder="Auto-generated if blank (VND-XXX)"
                      value={formData.vendor_code}
                      onChange={handleFormChange}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Tax ID / GSTIN</label>
                    <input
                      type="text"
                      name="tax_id"
                      placeholder="e.g. 24AAAAA0000A1Z5"
                      value={formData.tax_id}
                      onChange={handleFormChange}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>

              {/* Banking & Payouts */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-teal-600" />
                  Payout Banking Details
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Bank Name</label>
                    <input
                      type="text"
                      name="bank_name"
                      placeholder="e.g. HDFC Bank"
                      value={formData.bank_name}
                      onChange={handleFormChange}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Account Number</label>
                    <input
                      type="text"
                      name="bank_account_no"
                      placeholder="e.g. 50100234567890"
                      value={formData.bank_account_no}
                      onChange={handleFormChange}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">IFSC / Routing Code</label>
                    <input
                      type="text"
                      name="bank_routing_code"
                      placeholder="e.g. HDFC0001234"
                      value={formData.bank_routing_code}
                      onChange={handleFormChange}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>

              {/* Accounting & Terms */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-teal-600" />
                  Accounting & Terms
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Payment Terms (Days)</label>
                    <input
                      type="number"
                      name="payment_terms_days"
                      min="0"
                      value={formData.payment_terms_days}
                      onChange={handleFormChange}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Currency</label>
                    <input
                      type="text"
                      name="currency"
                      maxLength="3"
                      value={formData.currency}
                      onChange={handleFormChange}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Default Expense Ledger</label>
                    <select
                      name="default_account_id"
                      value={formData.default_account_id}
                      onChange={handleFormChange}
                      className={inputCls}
                    >
                      <option value="">Select Ledger Category</option>
                      {expenseCategories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Contact Information */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Contact Information & Address</label>
                <textarea
                  rows="2"
                  name="contact_info"
                  placeholder="Phone, email, branch contact, or physical address"
                  value={formData.contact_info}
                  onChange={handleFormChange}
                  className={inputCls}
                />
              </div>

              {/* Active Toggle */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active"
                  name="is_active"
                  checked={formData.is_active}
                  onChange={handleFormChange}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 h-4 w-4"
                />
                <label htmlFor="is_active" className="text-sm font-medium text-slate-700 cursor-pointer">
                  Vendor is active for purchasing & payments
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingVendor ? 'Update Vendor' : 'Onboard Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Vendor Details & Compliance Documents Drawer */}
      {viewingVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden animate-slide-up max-h-[90vh] flex flex-col">
            {/* Drawer Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-teal-600" />
                <div>
                  <h3 className="text-lg font-bold text-slate-800">
                    {viewingVendor.display_name || viewingVendor.name}
                  </h3>
                  <span className="font-mono text-xs text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                    {viewingVendor.vendor_code || `VND-${String(viewingVendor.id).padStart(3, '0')}`}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setViewingVendor(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Tabs */}
            <div className="flex border-b border-slate-200 px-6 bg-slate-50 shrink-0 gap-6">
              <button
                type="button"
                onClick={() => setDrawerTab('documents')}
                className={`py-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                  drawerTab === 'documents'
                    ? 'border-teal-600 text-teal-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <FileCheck className="w-4 h-4" /> Compliance Documents ({documents.length})
              </button>
              <button
                type="button"
                onClick={() => setDrawerTab('overview')}
                className={`py-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                  drawerTab === 'overview'
                    ? 'border-teal-600 text-teal-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Building2 className="w-4 h-4" /> Vendor Profile & Banking
              </button>
            </div>

            {/* Drawer Body */}
            <div className="p-6 overflow-y-auto flex-1 min-h-0 space-y-6">
              {drawerTab === 'overview' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-xs font-semibold text-slate-400 block mb-1">Legal Name</span>
                      <span className="text-sm font-bold text-slate-800">{viewingVendor.legal_name || '—'}</span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-xs font-semibold text-slate-400 block mb-1">Tax ID / GSTIN</span>
                      <span className="font-mono text-sm font-bold text-slate-800">{viewingVendor.tax_id || '—'}</span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-xs font-semibold text-slate-400 block mb-1">Payout Bank</span>
                      <span className="text-sm font-semibold text-slate-800">{viewingVendor.bank_name || '—'}</span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-xs font-semibold text-slate-400 block mb-1">Bank Account / IFSC</span>
                      <span className="font-mono text-sm font-semibold text-slate-800">
                        {viewingVendor.bank_account_no || '—'} {viewingVendor.bank_routing_code ? `(${viewingVendor.bank_routing_code})` : ''}
                      </span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-xs font-semibold text-slate-400 block mb-1">Payment Terms</span>
                      <span className="text-sm font-semibold text-slate-800">{viewingVendor.payment_terms_days || 0} Days</span>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                      <span className="text-xs font-semibold text-slate-400 block mb-1">Default Expense Account</span>
                      <span className="text-sm font-semibold text-slate-800">{viewingVendor.default_account_name || 'General Expense'}</span>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                    <span className="text-xs font-semibold text-slate-400 block mb-1">Contact Details & Notes</span>
                    <p className="text-sm text-slate-700 whitespace-pre-line">{viewingVendor.contact_info || 'No contact notes available.'}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Upload Compliance Document Box */}
                  <form onSubmit={handleUploadDocument} className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5 text-teal-600" />
                      Upload Compliance Document (GST, Cheque, PAN, Agreement)
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Document Type *</label>
                        <select
                          value={uploadDocType}
                          onChange={(e) => setUploadDocType(e.target.value)}
                          className={inputCls}
                        >
                          <option value="GST Certificate">GST Certificate</option>
                          <option value="Cancelled Cheque">Cancelled Cheque</option>
                          <option value="PAN Card">PAN Card</option>
                          <option value="MSME Registration">MSME Registration</option>
                          <option value="Vendor Agreement">Vendor Agreement</option>
                          <option value="W-9 / Tax Declaration">W-9 / Tax Declaration</option>
                          <option value="Other">Other Certificate</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Expiry Date (if any)</label>
                        <input
                          type="date"
                          value={uploadExpiryDate}
                          onChange={(e) => setUploadExpiryDate(e.target.value)}
                          className={inputCls}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Select File (PDF / Image) *</label>
                        <input
                          required
                          type="file"
                          accept=".pdf,image/jpeg,image/png,image/webp"
                          onChange={(e) => setUploadFile(e.target.files[0])}
                          className="w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        type="submit"
                        disabled={uploading}
                        className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        {uploading ? 'Uploading...' : 'Upload & Submit for Audit'}
                      </button>
                    </div>
                  </form>

                  {/* Documents List */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                      Stored Vendor Documents ({documents.length})
                    </h4>

                    {loadingDocs ? (
                      <div className="text-center py-6 text-slate-400">Loading documents...</div>
                    ) : documents.length === 0 ? (
                      <div className="p-6 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400">
                        <FileText className="w-8 h-8 mx-auto mb-1 text-slate-300" />
                        <p className="text-xs">No compliance documents uploaded yet</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3">
                        {documents.map((doc) => {
                          const isExpired = doc.expiry_date && new Date(doc.expiry_date).getTime() < Date.now();
                          return (
                            <div
                              key={doc.id}
                              className="p-3.5 rounded-xl border border-slate-200/80 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
                            >
                              <div className="flex items-start gap-3 min-w-0">
                                <div className="p-2.5 rounded-lg bg-teal-50 text-teal-700 shrink-0">
                                  <FileText className="w-5 h-5" />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-sm text-slate-800">{doc.document_type}</span>
                                    {doc.status === 'Approved' ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                                        <CheckCircle2 className="w-3 h-3" /> Approved
                                      </span>
                                    ) : doc.status === 'Rejected' ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-700">
                                        <XCircle className="w-3 h-3" /> Rejected
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
                                        <Clock className="w-3 h-3" /> Pending Review
                                      </span>
                                    )}

                                    {doc.expiry_date && (
                                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                                        isExpired ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-slate-100 text-slate-600'
                                      }`}>
                                        {isExpired ? 'Expired: ' : 'Expires: '} {formatDateSafe(doc.expiry_date)}
                                      </span>
                                    )}
                                  </div>

                                  <div className="text-xs text-slate-500 mt-1 truncate">
                                    File: <span className="font-medium text-slate-700">{doc.file_name || 'Document'}</span>
                                    {doc.verified_by_name && (
                                      <span> • Verified by {doc.verified_by_name}</span>
                                    )}
                                  </div>

                                  {doc.rejection_reason && (
                                    <div className="text-xs text-rose-600 mt-1 bg-rose-50 p-1.5 rounded">
                                      Rejection note: {doc.rejection_reason}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                                <a
                                  href={`${getServerBaseUrl()}${doc.file_url}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1.5 text-slate-500 hover:text-teal-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                                  title="View / Download Document"
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </a>

                                {doc.status !== 'Approved' && (
                                  <button
                                    onClick={() => handleUpdateDocStatus(doc.id, 'Approved')}
                                    className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                                    title="Approve Document"
                                  >
                                    <Check className="w-4 h-4" />
                                  </button>
                                )}

                                {doc.status !== 'Rejected' && (
                                  <button
                                    onClick={() => handleUpdateDocStatus(doc.id, 'Rejected')}
                                    className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                    title="Reject Document"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                )}

                                <button
                                  onClick={() => handleDeleteDoc(doc.id)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                  title="Delete Document"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <button
                type="button"
                onClick={() => setViewingVendor(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => navigate(`/vendor-statements?vendorId=${viewingVendor.id}`)}
                className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <ArrowUpRight className="w-4 h-4" />
                Open Vendor Statement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
