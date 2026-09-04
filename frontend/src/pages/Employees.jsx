import { useState, useEffect } from 'react';
import { 
  UserSquare2, Plus, Search, Edit2, Trash2, CheckCircle2, XCircle, 
  ShieldCheck, X, Upload, FileText, Download, 
  ExternalLink, Eye, Phone, Mail, MapPin, Calendar, CreditCard, Building, User,
  ArrowUpDown, ArrowUp, ArrowDown
} from 'lucide-react';
import api from '../services/api';
import { getServerBaseUrl, getApiBaseUrl } from '../utils/apiUrl';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import Pagination from '../components/Pagination';
import TableSkeleton from '../components/TableSkeleton';
import ImportModal from '../components/shared/ImportModal';
import Toast from '../components/Toast';
import { toast, confirmDialog } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { sanitizePhone, validatePhone } from '../utils/phoneValidation';
import { formatAadhar, maskAadhar, maskPan, maskBankAccount } from '../utils/formatters';

const formatSafeJoiningDate = (dateVal) => {
  if (!dateVal) return { formatted: '—', tenure: '' };
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return { formatted: '—', tenure: '' };
    
    const formatted = format(d, 'dd MMM yyyy');
    
    // Calculate tenure
    const now = new Date();
    const diffMonths = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    let tenure = '';
    if (diffMonths < 0) {
      tenure = 'Joining upcoming';
    } else if (diffMonths < 1) {
      tenure = 'Joined this month';
    } else if (diffMonths < 12) {
      tenure = `${diffMonths} mo${diffMonths > 1 ? 's' : ''} service`;
    } else {
      const yrs = Math.floor(diffMonths / 12);
      const remMonths = diffMonths % 12;
      tenure = remMonths > 0 ? `${yrs}y ${remMonths}m service` : `${yrs} yr${yrs > 1 ? 's' : ''} service`;
    }
    return { formatted, tenure };
  } catch {
    return { formatted: '—', tenure: '' };
  }
};

const emptyForm = {
  full_name: '', phone: '', email: '', date_of_birth: '', address: '', city: '',
  aadhar_number: '', pan_number: '', bank_account_number: '', bank_ifsc_code: '',
  bank_name: '', bank_account_holder_name: '', date_of_joining: format(new Date(), 'yyyy-MM-dd'),
  designation: 'Watchman', salary_structure_id: '', assigned_client_id: '',
  emergency_contact_name: '', emergency_contact_phone: '', notes: '', is_active: true
};

export default function Employees() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState(null);
  const [viewingEmp, setViewingEmp] = useState(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [salaryStructures, setSalaryStructures] = useState([]);
  const [clientsList, setClientsList] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const fetchEmployees = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/employees?search=${searchTerm}&sort_by=${sortBy}&order=${sortOrder}&page=${page}&limit=20`);
      setEmployees(response.data || []);
      if (response.pagination) setPagination(response.pagination);
    } catch (err) {
      console.error('Failed to fetch employees', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDropdownData = async () => {
    try {
      const [ssRes, clRes] = await Promise.all([
        api.get('/employees/meta/salary-structures'),
        api.get('/clients?limit=200'),
      ]);
      setSalaryStructures(ssRes.data || []);
      setClientsList(clRes.data || []);
    } catch (err) {
      console.error('Failed to fetch dropdown data', err);
    }
  };

  const fetchDocuments = async (empId) => {
    try {
      const response = await api.get(`/employees/${empId}/docs`);
      setDocuments(response.data || []);
    } catch (err) {
      console.error('Failed to fetch documents', err);
    }
  };

  useEffect(() => { fetchEmployees(); }, [searchTerm, page, sortBy, sortOrder]);

  useEffect(() => { setPage(1); }, [searchTerm, sortBy, sortOrder]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === 'phone' || name === 'emergency_contact_phone') {
      setFormData(prev => ({ ...prev, [name]: sanitizePhone(value) }));
      return;
    }
    if (name === 'aadhar_number') {
      const formatted = formatAadhar(value);
      setFormData(prev => ({ ...prev, aadhar_number: formatted }));
      return;
    }
    if (name === 'pan_number') {
      const cleanPan = value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase();
      setFormData(prev => ({ ...prev, pan_number: cleanPan }));
      return;
    }
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const openViewModal = (emp) => {
    setViewingEmp(emp);
    fetchDocuments(emp.id);
    setIsViewModalOpen(true);
  };

  const openCreateModal = () => {
    setEditingEmp(null);
    setFormData({ ...emptyForm });
    setError('');
    fetchDropdownData();
    setIsModalOpen(true);
  };

  const openEditModal = (emp) => {
    setEditingEmp(emp);
    setFormData({
      full_name: emp.full_name || '', phone: emp.phone || '', email: emp.email || '',
      date_of_birth: emp.date_of_birth ? emp.date_of_birth.substring(0, 10) : '',
      address: emp.address || '', city: emp.city || '',
      aadhar_number: formatAadhar(emp.aadhar_number || ''), pan_number: emp.pan_number || '',
      bank_account_number: emp.bank_account_number || '', bank_ifsc_code: emp.bank_ifsc_code || '',
      bank_name: emp.bank_name || '', bank_account_holder_name: emp.bank_account_holder_name || '',
      date_of_joining: emp.date_of_joining ? emp.date_of_joining.substring(0, 10) : '',
      designation: emp.designation || 'Watchman',
      salary_structure_id: emp.salary_structure_id || '',
      assigned_client_id: emp.assigned_client_id || '',
      emergency_contact_name: emp.emergency_contact_name || '',
      emergency_contact_phone: emp.emergency_contact_phone || '',
      notes: emp.notes || '', is_active: emp.is_active !== undefined ? emp.is_active : true,
    });
    setError('');
    fetchDropdownData();
    fetchDocuments(emp.id);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Phone validation: 10 digits check
    const phoneCheck = validatePhone(formData.phone, 'Employee Phone Number', true);
    if (!phoneCheck.valid) {
      setError(phoneCheck.error);
      toast.error(phoneCheck.error);
      return;
    }

    const emgCheck = validatePhone(formData.emergency_contact_phone, 'Emergency Contact Phone', false);
    if (!emgCheck.valid) {
      setError(emgCheck.error);
      toast.error(emgCheck.error);
      return;
    }

    const canEditAadharPan = !editingEmp || isAdmin;
    if (canEditAadharPan) {
      if (formData.aadhar_number) {
        const cleanAadhar = formData.aadhar_number.replace(/\D/g, '');
        if (cleanAadhar.length > 0 && cleanAadhar.length !== 12 && !cleanAadhar.startsWith('X')) {
          const msg = 'Aadhar number must be exactly 12 digits (e.g. 1234-1234-1234)';
          setError(msg);
          toast.error(msg);
          return;
        }
      }
      if (formData.pan_number) {
        const cleanPan = formData.pan_number.trim().toUpperCase();
        if (cleanPan.length > 0 && cleanPan.length !== 10 && !cleanPan.startsWith('X')) {
          const msg = 'PAN number must be exactly 10 characters (e.g. ABCDE1234F)';
          setError(msg);
          toast.error(msg);
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      const payload = { ...formData };
      if (!payload.salary_structure_id) payload.salary_structure_id = null;
      if (!payload.assigned_client_id) payload.assigned_client_id = null;

      if (editingEmp) {
        if (!isAdmin) {
          delete payload.aadhar_number;
          delete payload.pan_number;
        }
        await api.put(`/employees/${editingEmp.id}`, payload);
        toast.success('Employee updated successfully!');
      } else {
        await api.post('/employees', payload);
        toast.success('Employee registered successfully!');
      }
      setIsModalOpen(false);
      setEditingEmp(null);
      fetchEmployees();
    } catch (err) {
      const msg = err.errors && Array.isArray(err.errors)
        ? err.errors.map(e => e.message).join(' | ')
        : err.response?.data?.message || err.message || 'Failed to save employee';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDocumentUpload = async (e) => {
    if (!editingEmp) return;
    const file = e.target.files[0];
    if (!file) return;

    setUploadingDoc(true);
    const formData = new FormData();
    formData.append('document', file);

    try {
      await api.post(`/employees/${editingEmp.id}/upload-doc`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      toast.success('Document uploaded successfully');
      fetchDocuments(editingEmp.id);
    } catch (err) {
      toast.error(err.message || 'Failed to upload document');
    } finally {
      setUploadingDoc(false);
      e.target.value = '';
    }
  };

  const handleDeleteDocument = async (docId, fileName) => {
    if (!editingEmp) return;
    const confirmed = await confirmDialog({
      title: 'Delete Document',
      message: `Are you sure you want to delete "${fileName || 'this document'}"?`,
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      await api.delete(`/employees/${editingEmp.id}/docs/${docId}`);
      toast.success('Document deleted successfully');
      fetchDocuments(editingEmp.id);
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to delete document');
    }
  };

  const handleDownloadDocument = async (doc) => {
    try {
      const fileUrl = `${getServerBaseUrl()}/uploads/docs/${doc.file_path}`;
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error('Failed to fetch file');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = doc.file_name || doc.file_path.split('/').pop() || 'document';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 200);
      toast.success(`Downloading ${doc.file_name || 'document'}`);
    } catch (err) {
      console.error('Download error:', err);
      // Fallback: server attachment endpoint or direct anchor
      try {
        const empId = viewingEmp?.id || editingEmp?.id || doc.employee_id;
        const downloadUrl = `${getApiBaseUrl()}/employees/${empId}/docs/${doc.id}/download`;
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = doc.file_name || 'document';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (fallbackErr) {
        window.open(`${getServerBaseUrl()}/uploads/docs/${doc.file_path}`, '_blank');
      }
    }
  };

  const handleDeactivate = async (id) => {
    try {
      await api.delete(`/employees/${id}`);
      setConfirmDelete(null);
      toast.success('Employee status updated');
      fetchEmployees();
    } catch (err) {
      console.error('Failed to deactivate employee', err);
      toast.error('Failed to deactivate employee');
    }
  };

  const handleHardDelete = async (id) => {
    try {
      await api.delete(`/employees/${id}/hard`);
      setConfirmDelete(null);
      toast.success('Employee permanently deleted');
      fetchEmployees();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to permanently delete employee');
      console.error('Failed to permanently delete employee', err);
    }
  };

  const handleExportCSV = () => {
    const data = employees.map(e => ({
      'Emp ID': e.employee_id,
      'Full Name': e.full_name,
      'Designation': e.designation,
      'Phone': e.phone,
      'Client Site': e.client_name || 'Unassigned',
      'Salary Structure': e.salary_structure_name || 'None',
      'Joining Date': formatSafeJoiningDate(e.date_of_joining).formatted,
      'Status': e.is_active ? 'Active' : 'Inactive',
      'Aadhar': formatAadhar(e.aadhar_number),
      'Bank Account': e.bank_account_number,
      'IFSC': e.bank_ifsc_code
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Employees");
    XLSX.writeFile(wb, `Watchmen_Export_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const inputCls = "w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <UserSquare2 className="w-6 h-6 text-teal-600" />
            Watchmen Management
          </h1>
          <p className="text-slate-500 text-sm mt-1">Manage personnel, deployments, and salary structures.</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button onClick={() => setIsImportModalOpen(true)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2 border border-slate-300">
            <Upload className="w-4 h-4" />
            Import Excel
          </button>
          <button onClick={handleExportCSV} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2 border border-slate-300">
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button onClick={openCreateModal} className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Onboard Watchman
          </button>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Search by name, ID, or phone..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all text-sm" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 whitespace-nowrap">
            <Calendar className="w-3.5 h-3.5 text-teal-600" />
            Sort:
          </label>
          <select
            value={`${sortBy}_${sortOrder}`}
            onChange={(e) => {
              const [sb, so] = e.target.value.split('_');
              setSortBy(sb);
              setSortOrder(so);
            }}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all shadow-xs"
          >
            <option value="name_asc">Name (A → Z)</option>
            <option value="name_desc">Name (Z → A)</option>
            <option value="joining_date_desc">Joining Date (Newest First)</option>
            <option value="joining_date_asc">Joining Date (Oldest First)</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-semibold">Employee</th>
                <th 
                  className="px-6 py-4 font-semibold cursor-pointer hover:text-teal-600 transition-colors select-none group/th"
                  onClick={() => {
                    if (sortBy === 'joining_date') {
                      setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
                    } else {
                      setSortBy('joining_date');
                      setSortOrder('desc');
                    }
                  }}
                  title="Click to sort by Joining Date"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Joining Date</span>
                    {sortBy === 'joining_date' ? (
                      sortOrder === 'desc' ? <ArrowDown className="w-3.5 h-3.5 text-teal-600" /> : <ArrowUp className="w-3.5 h-3.5 text-teal-600" />
                    ) : (
                      <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 opacity-50 group-hover/th:opacity-100 transition-opacity" />
                    )}
                  </div>
                </th>
                <th className="px-6 py-4 font-semibold">Assignment</th>
                <th className="px-6 py-4 font-semibold">Salary Structure</th>
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
              ) : employees.length === 0 ? (
                <tr><td colSpan="6" className="px-6 py-12 text-center text-slate-500">
                  <div className="flex justify-center mb-3"><UserSquare2 className="w-10 h-10 text-slate-300" /></div>
                  <p className="font-medium text-slate-600 mb-1">No employees found</p>
                </td></tr>
              ) : (
                employees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div 
                        className="flex items-center gap-3 cursor-pointer group/emp"
                        onClick={() => openViewModal(emp)}
                        title="Click to view details"
                      >
                        <div className="w-10 h-10 rounded-full bg-slate-100 group-hover/emp:bg-teal-100 group-hover/emp:text-teal-700 flex items-center justify-center text-slate-600 font-bold border border-slate-200 transition-colors">
                          {emp.full_name.charAt(0)}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900 group-hover/emp:text-teal-600 transition-colors">{emp.full_name}</div>
                          <div className="text-slate-500 text-xs mt-0.5 flex items-center gap-1 font-mono">
                            <ShieldCheck className="w-3 h-3 text-teal-600" /> {emp.employee_id}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {(() => {
                        const { formatted, tenure } = formatSafeJoiningDate(emp.date_of_joining);
                        return (
                          <div>
                            <div className="flex items-center gap-1.5 font-medium text-slate-800">
                              <Calendar className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                              <span>{formatted}</span>
                            </div>
                            {tenure && (
                              <div className="text-[11px] text-slate-500 mt-0.5 pl-5 font-normal">
                                {tenure}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4">
                      {emp.client_name ? (
                        <div>
                          <div className="font-medium text-slate-700">{emp.client_name}</div>
                          <div className="text-slate-500 text-xs mt-1">{emp.designation}</div>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-xs">Unassigned</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {emp.base_salary ? (
                        <div>
                          <div className="font-semibold text-slate-900">₹{parseFloat(emp.base_salary).toLocaleString('en-IN')}/mo</div>
                          <div className="text-slate-500 text-xs mt-1 truncate max-w-[150px]">{emp.salary_structure_name}</div>
                        </div>
                      ) : (
                        <span className="inline-flex px-2 py-1 text-xs font-medium bg-amber-100 text-amber-700 rounded-md">Pending Setup</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {emp.is_active ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          <XCircle className="w-3.5 h-3.5" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button 
                          onClick={() => openViewModal(emp)} 
                          className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors" 
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => openEditModal(emp)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {emp.is_active && (
                          <button onClick={() => setConfirmDelete({ id: emp.id, type: 'deactivate' })} className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="Deactivate">
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => setConfirmDelete({ id: emp.id, type: 'hard' })} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete Permanently">
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

      {/* Deactivate/Delete Confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-slide-up">
            <h3 className="text-lg font-bold text-slate-800 mb-2">
              {confirmDelete.type === 'deactivate' ? 'Confirm Deactivation' : 'Confirm Permanent Delete'}
            </h3>
            <p className="text-sm text-slate-600 mb-6">
              {confirmDelete.type === 'deactivate' 
                ? 'Are you sure you want to deactivate this employee? They will be marked as inactive.' 
                : 'Are you sure you want to PERMANENTLY delete this employee? This action cannot be undone and will fail if they have linked attendance or payroll records.'}
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">Cancel</button>
              <button 
                onClick={() => confirmDelete.type === 'deactivate' ? handleDeactivate(confirmDelete.id) : handleHardDelete(confirmDelete.id)} 
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors shadow-sm"
              >
                {confirmDelete.type === 'deactivate' ? 'Deactivate' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboard / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden animate-slide-up max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <UserSquare2 className="w-5 h-5 text-teal-600" />
                {editingEmp ? 'Edit Employee' : 'Onboard New Watchman'}
              </h3>
              <button onClick={() => { setIsModalOpen(false); setEditingEmp(null); }} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 min-h-0">
              {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

              {/* Personal Info */}
              <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Personal Information</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Full Name *</label>
                  <input required type="text" name="full_name" value={formData.full_name} onChange={handleInputChange} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Phone (10 Digits) *</label>
                  <input required type="tel" maxLength="10" placeholder="10-digit number" name="phone" value={formData.phone} onChange={handleInputChange} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input type="email" name="email" value={formData.email} onChange={handleInputChange} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Date of Birth</label>
                  <input type="date" name="date_of_birth" value={formData.date_of_birth} onChange={handleInputChange} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">City</label>
                  <input type="text" name="city" value={formData.city} onChange={handleInputChange} className={inputCls} />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                  <input type="text" name="address" value={formData.address} onChange={handleInputChange} className={inputCls} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-slate-700">Aadhar Number</label>
                    {editingEmp && (
                      isAdmin ? (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">Admin Edit</span>
                      ) : (
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">🔒 Admin Only</span>
                      )
                    )}
                  </div>
                  <input
                    type="text"
                    name="aadhar_number"
                    value={formData.aadhar_number}
                    onChange={handleInputChange}
                    maxLength="14"
                    placeholder="1234-1234-1234"
                    disabled={editingEmp && !isAdmin}
                    className={(editingEmp && !isAdmin) ? "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-100 text-slate-700 font-mono cursor-not-allowed select-none" : inputCls}
                  />
                  {editingEmp && (
                    <p className="text-[11px] text-slate-500 mt-1">
                      {isAdmin ? 'Admins have permission to view & edit Aadhar.' : 'Aadhar is locked. Only Admin can modify this number.'}
                    </p>
                  )}
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-slate-700">PAN Number</label>
                    {editingEmp && (
                      isAdmin ? (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">Admin Edit</span>
                      ) : (
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">🔒 Admin Only</span>
                      )
                    )}
                  </div>
                  <input
                    type="text"
                    name="pan_number"
                    value={formData.pan_number}
                    onChange={handleInputChange}
                    maxLength="10"
                    placeholder="ABCDE1234F"
                    disabled={editingEmp && !isAdmin}
                    className={(editingEmp && !isAdmin) ? "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-100 text-slate-700 font-mono cursor-not-allowed select-none" : inputCls}
                  />
                  {editingEmp && (
                    <p className="text-[11px] text-slate-500 mt-1">
                      {isAdmin ? 'Admins have permission to view & edit PAN.' : 'PAN is locked. Only Admin can modify this number.'}
                    </p>
                  )}
                </div>
              </div>

              {/* Employment */}
              <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Employment Details</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-slate-700">Joining Date *</label>
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, date_of_joining: format(new Date(), 'yyyy-MM-dd') }))}
                      className="text-[11px] font-semibold text-teal-600 hover:text-teal-700 hover:underline cursor-pointer"
                      title="Set joining date to today"
                    >
                      Today
                    </button>
                  </div>
                  <input required type="date" name="date_of_joining" value={formData.date_of_joining} onChange={handleInputChange} className={inputCls} />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Official date the watchman commences duty.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Designation</label>
                  <select name="designation" value={formData.designation} onChange={handleInputChange} className={inputCls}>
                    <option value="Watchman">Watchman</option>
                    <option value="Senior Watchman">Senior Watchman</option>
                    <option value="Head Guard">Head Guard</option>
                    <option value="Supervisor">Supervisor</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Salary Structure</label>
                  <select name="salary_structure_id" value={formData.salary_structure_id} onChange={handleInputChange} className={inputCls}>
                    <option value="">-- Select --</option>
                    {salaryStructures.map(ss => (
                      <option key={ss.id} value={ss.id}>{ss.name} (₹{parseFloat(ss.base_salary).toLocaleString('en-IN')})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Assigned Client (Site)</label>
                  <select name="assigned_client_id" value={formData.assigned_client_id} onChange={handleInputChange} className={inputCls}>
                    <option value="">-- Unassigned --</option>
                    {clientsList.filter(c => c.is_active).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Bank Details */}
              <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Bank Details</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Bank Name</label>
                  <input type="text" name="bank_name" value={formData.bank_name} onChange={handleInputChange} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Account Number</label>
                  <input type="text" name="bank_account_number" value={formData.bank_account_number} onChange={handleInputChange} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">IFSC Code</label>
                  <input type="text" name="bank_ifsc_code" value={formData.bank_ifsc_code} onChange={handleInputChange} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Account Holder Name</label>
                  <input type="text" name="bank_account_holder_name" value={formData.bank_account_holder_name} onChange={handleInputChange} className={inputCls} />
                </div>
              </div>

              {/* Emergency */}
              <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Emergency Contact</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Contact Name</label>
                  <input type="text" name="emergency_contact_name" value={formData.emergency_contact_name} onChange={handleInputChange} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Contact Phone (10 Digits)</label>
                  <input type="tel" maxLength="10" placeholder="10-digit number" name="emergency_contact_phone" value={formData.emergency_contact_phone} onChange={handleInputChange} className={inputCls} />
                </div>
              </div>

              {editingEmp && (
                <div className="flex items-center gap-3 mb-4">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleInputChange} className="sr-only peer" />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-teal-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
                  </label>
                  <span className="text-sm font-medium text-slate-700">Employee is Active</span>
                </div>
              )}

              {/* KYC Documents Section */}
              {editingEmp && (
                <div className="mt-6 border-t border-slate-100 pt-6">
                  <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center justify-between">
                    <span>KYC & Documents</span>
                    <label className={`cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${uploadingDoc ? 'bg-slate-100 text-slate-400' : 'bg-teal-50 text-teal-700 hover:bg-teal-100'}`}>
                      <Upload className="w-3.5 h-3.5" />
                      {uploadingDoc ? 'Uploading...' : 'Upload Document'}
                      <input type="file" className="hidden" accept=".pdf,image/*" onChange={handleDocumentUpload} disabled={uploadingDoc} />
                    </label>
                  </h4>
                  
                  {documents.length === 0 ? (
                    <div className="text-sm text-slate-500 italic py-3 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200">
                      No documents uploaded yet.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {documents.map(doc => (
                        <li 
                          key={doc.id} 
                          className="flex justify-between items-center p-3 border border-slate-200 rounded-lg bg-white shadow-sm hover:shadow-md hover:border-slate-300 transition-all group"
                        >
                          <div 
                            className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                            onClick={() => window.open(`${getServerBaseUrl()}/uploads/docs/${doc.file_path}`, '_blank')}
                            title="Click anywhere to view document in new window"
                          >
                            <div className="p-2 bg-slate-100 group-hover:bg-teal-50 group-hover:text-teal-600 rounded-lg text-slate-500 transition-colors shrink-0">
                              <FileText className="w-4 h-4" />
                            </div>
                            <div className="truncate">
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-medium text-slate-800 group-hover:text-teal-600 transition-colors truncate">{doc.file_name}</p>
                                <ExternalLink className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                              </div>
                              <p className="text-xs text-slate-400">Uploaded {format(new Date(doc.uploaded_at), 'MMM dd, yyyy')}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            <button 
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownloadDocument(doc);
                              }}
                              className="p-1.5 text-teal-600 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition-colors cursor-pointer"
                              title="Download Document"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteDocument(doc.id, doc.file_name);
                              }}
                              className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              title="Delete Document"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="col-span-full mt-6">
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea name="notes" value={formData.notes} onChange={handleInputChange} rows="2" className={inputCls} />
              </div>

              <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-slate-100">
                <button type="button" onClick={() => { setIsModalOpen(false); setEditingEmp(null); }} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors shadow-sm disabled:opacity-50">
                  {submitting ? 'Saving...' : editingEmp ? 'Update Employee' : 'Onboard Watchman'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Employee Details Modal */}
      {isViewModalOpen && viewingEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden animate-slide-up max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <div className="flex items-center gap-2">
                <Eye className="w-5 h-5 text-teal-600" />
                <h3 className="text-lg font-bold text-slate-800">Employee Details</h3>
                <span className="text-xs font-mono text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                  {viewingEmp.employee_id}
                </span>
              </div>
              <button 
                onClick={() => { setIsViewModalOpen(false); setViewingEmp(null); }} 
                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 min-h-0 space-y-6">
              {/* Profile Card Banner */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-gradient-to-r from-teal-50/80 via-slate-50 to-indigo-50/50 border border-teal-100/80">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-teal-600 text-white flex items-center justify-center text-2xl font-bold shadow-sm shadow-teal-600/30 shrink-0">
                    {viewingEmp.full_name?.charAt(0) || 'E'}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{viewingEmp.full_name}</h2>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-xs font-medium text-slate-600 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                        {viewingEmp.designation || 'Watchman'}
                      </span>
                      {viewingEmp.client_name ? (
                        <span className="text-xs font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200 flex items-center gap-1">
                          <Building className="w-3 h-3" /> {viewingEmp.client_name}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 italic bg-white px-2 py-0.5 rounded-md border border-slate-200">
                          Unassigned
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex sm:flex-col items-center sm:items-end gap-2 w-full sm:w-auto justify-between border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-200/60">
                  {viewingEmp.is_active ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                      <XCircle className="w-3.5 h-3.5" /> Inactive
                    </span>
                  )}
                  {(() => {
                    const { formatted, tenure } = formatSafeJoiningDate(viewingEmp.date_of_joining);
                    return (
                      <div className="flex flex-col items-start sm:items-end">
                        <span className="text-xs text-slate-600 font-medium flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-teal-600" />
                          Joined {formatted}
                        </span>
                        {tenure && (
                          <span className="text-[10px] text-teal-700 font-semibold bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200 mt-0.5">
                            {tenure}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* KYC & Identity Section (Aadhaar & PAN Masked) */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-teal-600" />
                    KYC & Identity
                  </h4>
                  <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1">
                    🔒 Masked (Last 4 digits shown)
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-xs font-medium text-slate-500 block mb-1">Aadhar Card Number</span>
                    <div className="font-mono text-base font-bold text-slate-800 tracking-wider">
                      {maskAadhar(viewingEmp.aadhar_number)}
                    </div>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-xs font-medium text-slate-500 block mb-1">PAN Card Number</span>
                    <div className="font-mono text-base font-bold text-slate-800 tracking-wider">
                      {maskPan(viewingEmp.pan_number)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Personal Information */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                  <User className="w-4 h-4 text-teal-600" />
                  Personal Information
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-xs font-medium text-slate-500 block mb-1">Phone Number</span>
                    <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 font-mono">
                      <Phone className="w-3.5 h-3.5 text-slate-400" />
                      {viewingEmp.phone || '—'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-xs font-medium text-slate-500 block mb-1">Email Address</span>
                    <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 truncate">
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{viewingEmp.email || '—'}</span>
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-xs font-medium text-slate-500 block mb-1">Date of Birth</span>
                    <span className="text-sm font-semibold text-slate-800">
                      {viewingEmp.date_of_birth ? format(new Date(viewingEmp.date_of_birth), 'dd MMM yyyy') : '—'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-xs font-medium text-slate-500 block mb-1">City</span>
                    <span className="text-sm font-semibold text-slate-800">{viewingEmp.city || '—'}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 sm:col-span-2">
                    <span className="text-xs font-medium text-slate-500 block mb-1">Residential Address</span>
                    <span className="text-sm font-medium text-slate-800 flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                      <span>{viewingEmp.address || '—'}</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Employment & Deployment */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                  <Building className="w-4 h-4 text-teal-600" />
                  Employment & Compensation
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-xs font-medium text-slate-500 block mb-1">Designation</span>
                    <span className="text-sm font-semibold text-slate-800">{viewingEmp.designation || 'Watchman'}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-xs font-medium text-slate-500 block mb-1">Assigned Client Site</span>
                    <span className="text-sm font-semibold text-slate-800">{viewingEmp.client_name || 'Unassigned'}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-xs font-medium text-slate-500 block mb-1">Salary Structure</span>
                    <span className="text-sm font-semibold text-slate-800">{viewingEmp.salary_structure_name || 'None'}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-xs font-medium text-slate-500 block mb-1">Base Monthly Salary</span>
                    <span className="text-sm font-bold text-teal-700">
                      {viewingEmp.base_salary ? `₹${parseFloat(viewingEmp.base_salary).toLocaleString('en-IN')}` : '—'}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 sm:col-span-2">
                    <span className="text-xs font-medium text-slate-500 block mb-1">Date of Joining</span>
                    {(() => {
                      const { formatted, tenure } = formatSafeJoiningDate(viewingEmp.date_of_joining);
                      return (
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                            <Calendar className="w-4 h-4 text-teal-600" />
                            {formatted}
                          </span>
                          {tenure && (
                            <span className="text-xs font-medium text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200">
                              {tenure}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Bank Details */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-teal-600" />
                  Bank Details
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-xs font-medium text-slate-500 block mb-1">Bank Name</span>
                    <span className="text-sm font-semibold text-slate-800">{viewingEmp.bank_name || '—'}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-xs font-medium text-slate-500 block mb-1">Account Number</span>
                    <span className="text-sm font-mono font-semibold text-slate-800">
                      {maskBankAccount(viewingEmp.bank_account_number)}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-xs font-medium text-slate-500 block mb-1">IFSC Code</span>
                    <span className="text-sm font-mono font-semibold text-slate-800">{viewingEmp.bank_ifsc_code || '—'}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-xs font-medium text-slate-500 block mb-1">Account Holder</span>
                    <span className="text-sm font-semibold text-slate-800">{viewingEmp.bank_account_holder_name || '—'}</span>
                  </div>
                </div>
              </div>

              {/* Emergency Contact & Notes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-2">Emergency Contact</span>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-slate-800">{viewingEmp.emergency_contact_name || 'No contact provided'}</div>
                    {viewingEmp.emergency_contact_phone && (
                      <div className="text-xs text-slate-600 font-mono flex items-center gap-1.5">
                        <Phone className="w-3 h-3 text-slate-400" />
                        {viewingEmp.emergency_contact_phone}
                      </div>
                    )}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-2">Notes</span>
                  <p className="text-xs text-slate-600 italic whitespace-pre-line">
                    {viewingEmp.notes || 'No notes added for this employee.'}
                  </p>
                </div>
              </div>

              {/* Uploaded Documents */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-teal-600" />
                    Uploaded Documents ({documents.length})
                  </h4>
                </div>
                {documents.length === 0 ? (
                  <div className="text-sm text-slate-500 italic py-4 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    No documents uploaded for this employee.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {documents.map(doc => (
                      <li 
                        key={doc.id} 
                        className="flex justify-between items-center p-3 border border-slate-200 rounded-xl bg-white shadow-sm hover:shadow-md hover:border-slate-300 transition-all group"
                      >
                        <div 
                          className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                          onClick={() => window.open(`${getServerBaseUrl()}/uploads/docs/${doc.file_path}`, '_blank')}
                          title="Click to view document in new window"
                        >
                          <div className="p-2 bg-slate-100 group-hover:bg-teal-50 group-hover:text-teal-600 rounded-lg text-slate-500 transition-colors shrink-0">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="truncate">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium text-slate-800 group-hover:text-teal-600 transition-colors truncate">{doc.file_name}</p>
                              <ExternalLink className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                            </div>
                            <p className="text-xs text-slate-400">Uploaded {format(new Date(doc.uploaded_at), 'MMM dd, yyyy')}</p>
                          </div>
                        </div>
                        <button 
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadDocument(doc);
                          }}
                          className="p-2 text-teal-600 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition-colors cursor-pointer shrink-0 ml-2"
                          title="Download Document"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <button 
                type="button" 
                onClick={() => { setIsViewModalOpen(false); setViewingEmp(null); }} 
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
              >
                Close
              </button>
              <button 
                type="button"
                onClick={() => {
                  const empToEdit = viewingEmp;
                  setIsViewModalOpen(false);
                  setViewingEmp(null);
                  openEditModal(empToEdit);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors shadow-sm flex items-center gap-2"
              >
                <Edit2 className="w-4 h-4" />
                Edit Employee
              </button>
            </div>
          </div>
        </div>
      )}
      
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        entityName="Employees"
        endpoint="/employees/import"
        onImportSuccess={(data) => {
          fetchEmployees();
          toast.success(data?.message || 'Employees imported successfully!');
        }}
      />

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
