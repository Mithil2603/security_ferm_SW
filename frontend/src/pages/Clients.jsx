import { useState, useEffect } from 'react';
import { Building2, Plus, Search, MapPin, Mail, Phone, Edit2, Trash2, CheckCircle2, XCircle, X, CalendarDays, AlertCircle, FileEdit, FileText, Download, Upload, FileSpreadsheet } from 'lucide-react';
import api from '../services/api';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import Pagination from '../components/Pagination';
import TableSkeleton from '../components/TableSkeleton';
import ImportModal from '../components/shared/ImportModal';
import Toast from '../components/Toast';
import { sanitizePhone, validatePhone } from '../utils/phoneValidation';

const emptyForm = {
  name: '', address: '', city: '', state: 'Gujarat', postal_code: '',
  email: '', phone: '', contact_person: '', gst_number: '',
  monthly_rate: '', contract_start_date: '', contract_end_date: '', notes: '', is_active: true
};

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRenewModalOpen, setIsRenewModalOpen] = useState(false);
  const [statementClient, setStatementClient] = useState(null);
  const [statementData, setStatementData] = useState(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementDates, setStatementDates] = useState({ from: '', to: '' });
  const [editingClient, setEditingClient] = useState(null);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [renewData, setRenewData] = useState({ contract_end_date: '', monthly_rate: '' });
  const [error, setError] = useState('');
  const [fetchError, setFetchError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const fetchClients = async () => {
    try {
      setLoading(true);
      setFetchError('');
      const url = `/clients?search=${searchTerm}${!showInactive ? '&is_active=true' : ''}&page=${page}&limit=20`;
      const response = await api.get(url);
      setClients(response.data || []);
      if (response.pagination) setPagination(response.pagination);
    } catch (err) {
      console.error('Failed to fetch clients', err);
      setFetchError('Failed to load clients. Check server connection.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => fetchClients(), 300);
    return () => clearTimeout(timer);
  }, [searchTerm, showInactive, page]);

  // Reset page when search or filters change
  useEffect(() => {
    setPage(1);
  }, [searchTerm, showInactive]);

  const [toast, setToast] = useState({ show: false, message: '', type: 'error' });

  const showToast = (message, type = 'error') => {
    setToast({ show: true, message, type });
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === 'phone') {
      setFormData(prev => ({ ...prev, phone: sanitizePhone(value) }));
      return;
    }
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const openCreateModal = () => {
    setEditingClient(null);
    setFormData({ ...emptyForm });
    setError('');
    setIsModalOpen(true);
  };

  const openEditModal = (client) => {
    setEditingClient(client);
    setFormData({
      name: client.name || '',
      address: client.address || '',
      city: client.city || '',
      state: client.state || 'Gujarat',
      postal_code: client.postal_code || '',
      email: client.email || '',
      phone: client.phone || '',
      contact_person: client.contact_person || '',
      gst_number: client.gst_number || '',
      monthly_rate: client.monthly_rate || '',
      contract_start_date: client.contract_start_date ? client.contract_start_date.substring(0, 10) : '',
      contract_end_date: client.contract_end_date ? client.contract_end_date.substring(0, 10) : '',
      notes: client.notes || '',
      is_active: client.is_active !== undefined ? client.is_active : true,
    });
    setError('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Phone validation (if provided)
    const phoneCheck = validatePhone(formData.phone, 'Client Phone Number', false);
    if (!phoneCheck.valid) {
      setError(phoneCheck.error);
      showToast(phoneCheck.error, 'error');
      return;
    }

    setSubmitting(true);
    try {
      if (editingClient) {
        await api.put(`/clients/${editingClient.id}`, formData);
        showToast('Client updated successfully!', 'success');
      } else {
        await api.post('/clients', formData);
        showToast('Client created successfully!', 'success');
      }
      setIsModalOpen(false);
      setEditingClient(null);
      setFormData({ ...emptyForm });
      fetchClients();
    } catch (err) {
      const msg = err.errors && Array.isArray(err.errors)
        ? err.errors.map(e => e.message).join(' | ')
        : err.response?.data?.message || err.message || 'Failed to save client';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const openRenewModal = (client) => {
    setEditingClient(client);
    setRenewData({
      contract_end_date: client.contract_end_date ? client.contract_end_date.substring(0, 10) : '',
      monthly_rate: client.monthly_rate || ''
    });
    setIsRenewModalOpen(true);
    setError('');
  };

  const handleRenew = async (e) => {
    e.preventDefault();
    try {
      await api.patch(`/clients/${editingClient.id}/renew`, renewData);
      setIsRenewModalOpen(false);
      setTimeout(() => setEditingClient(null), 300);
      fetchClients();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to renew contract');
    }
  };

  const fetchStatement = async (clientId, from = '', to = '') => {
    try {
      setStatementLoading(true);
      const params = new URLSearchParams();
      if (from) params.append('from_date', from);
      if (to) params.append('to_date', to);
      const res = await api.get(`/clients/${clientId}/statement?${params.toString()}`);
      if (res.data) {
        setStatementData(res.data);
      }
    } catch (err) {
      alert('Failed to load statement');
    } finally {
      setStatementLoading(false);
    }
  };

  const openStatement = (client) => {
    setStatementClient(client);
    setStatementDates({ from: '', to: '' });
    fetchStatement(client.id);
  };

  const downloadStatementExcel = () => {
    if (!statementData) return;
    const wb = XLSX.utils.book_new();
    const rows = [
      ['STATEMENT OF ACCOUNT', '', '', '', '', ''],
      [`Client: ${statementData.client.name}`, '', '', '', '', ''],
      [`Address: ${statementData.client.address}, ${statementData.client.city}`, '', '', '', '', ''],
      [`Period: ${statementData.period.from || 'All time'} to ${statementData.period.to || 'Present'}`, '', '', '', '', ''],
      ['', '', '', '', '', ''],
      ['DATE', 'REFERENCE', 'TYPE', 'DEBIT (₹)', 'CREDIT (₹)', 'BALANCE (₹)'],
      ...statementData.transactions.map(t => [
        format(new Date(t.date + 'T00:00:00'), 'dd MMM yyyy'),
        t.reference,
        t.type,
        t.debit ? parseFloat(t.debit) : '',
        t.credit ? parseFloat(t.credit) : '',
        parseFloat(t.balance || 0)
      ]),
      ['', '', '', '', 'FINAL BALANCE', parseFloat(statementData.final_balance || 0)]
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch: 15}, {wch: 20}, {wch: 15}, {wch: 15}, {wch: 15}, {wch: 15}];
    XLSX.utils.book_append_sheet(wb, ws, 'Statement');
    XLSX.writeFile(wb, `Statement_${statementData.client.name.replace(/\s+/g, '_')}.xlsx`);
  };

  const handleDeactivate = async (id) => {
    try {
      await api.delete(`/clients/${id}`);
      setConfirmDelete(null);
      fetchClients();
    } catch (err) {
      console.error('Failed to deactivate client', err);
      alert(err.response?.data?.message || 'Failed to deactivate client');
    }
  };

  const handleHardDelete = async (id) => {
    try {
      await api.delete(`/clients/${id}/hard`);
      setConfirmDelete(null);
      fetchClients();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to permanently delete client');
      console.error('Failed to permanently delete client', err);
    }
  };

  const handleExportCSV = async () => {
    try {
      const response = await api.get(`/clients?search=${searchTerm}${!showInactive ? '&is_active=true' : ''}&limit=10000`);
      const allClients = response.data || [];
      const data = allClients.map(c => ({
        'Name': c.name,
        'City': c.city,
        'Contact Person': c.contact_person,
        'Phone': c.phone,
        'Email': c.email,
        'GST Number': c.gst_number,
        'Monthly Rate': c.monthly_rate,
        'Status': c.is_active ? 'Active' : 'Inactive',
        'Total Billed': c.total_billed,
        'Total Paid': c.total_paid
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Clients");
      XLSX.writeFile(wb, `Clients_Export_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    } catch (err) {
      console.error('Failed to export clients', err);
      alert('Export failed. Please try again.');
    }
  };

  const handleDownloadSampleTemplate = () => {
    const sampleData = [
      {
        "Name": "Royal Residency Ltd",
        "Address": "123 SG Highway",
        "City": "Ahmedabad",
        "Phone": "9876543210",
        "Email": "contact@royalresidency.com",
        "Monthly Rate": 55000
      },
      {
        "Name": "Green Heights Complex",
        "Address": "45 CG Road",
        "City": "Ahmedabad",
        "Phone": "9876543211",
        "Email": "info@greenheights.com",
        "Monthly Rate": 48000
      }
    ];
    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Clients");
    XLSX.writeFile(workbook, "Sample_Clients_Import_Template.xlsx");
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Building2 className="w-6 h-6 text-teal-600" />
            Client Management
          </h1>
          <p className="text-slate-500 text-sm mt-1">Manage society contracts and contact details.</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button
            onClick={handleDownloadSampleTemplate}
            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2 border border-indigo-200"
            title="Download pre-formatted Excel template for importing"
          >
            <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
            Sample Template
          </button>
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2 border border-slate-300"
          >
            <Upload className="w-4 h-4" />
            Import Excel
          </button>
          <button
            onClick={handleExportCSV}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2 border border-slate-300"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={openCreateModal}
            className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add New Client
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col sm:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search clients by name, contact, or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600 cursor-pointer flex items-center gap-2">
            <input 
              type="checkbox" 
              checked={showInactive} 
              onChange={(e) => setShowInactive(e.target.checked)} 
              className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500"
            />
            Show Inactive Clients
          </label>
        </div>
      </div>

      {/* Table */}
      {fetchError && (
        <div className="mb-4 p-4 bg-red-50 text-red-600 rounded-lg text-sm flex justify-between shadow-sm border border-red-100">
          <div className="flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {fetchError}</div>
          <button onClick={fetchClients} className="underline hover:text-red-700 font-medium">Retry</button>
        </div>
      )}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-semibold">Society Name</th>
                <th className="px-6 py-4 font-semibold">Contact Info</th>
                <th className="px-6 py-4 font-semibold">Contract details</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="5">
                    <TableSkeleton columns={5} rows={10} />
                  </td>
                </tr>
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-12 text-center text-slate-500">
                    <div className="flex justify-center mb-3"><Building2 className="w-10 h-10 text-slate-300" /></div>
                    <p className="font-medium text-slate-600 mb-1">No clients found</p>
                    <p className="text-xs">Try adjusting your search or add a new client.</p>
                  </td>
                </tr>
              ) : (
                clients.map((client) => (
                  <tr key={client.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">{client.name}</div>
                      <div className="text-slate-500 text-xs mt-1 flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {client.city}, {client.state}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-700">{client.contact_person || 'N/A'}</div>
                      <div className="text-slate-500 text-xs mt-1 flex flex-col gap-1">
                        <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {client.phone}</span>
                        {client.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {client.email}</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">₹{parseFloat(client.monthly_rate || 0).toLocaleString('en-IN')}/mo</div>
                      {client.contract_end_date ? (() => {
                        const daysLeft = Math.ceil((new Date(client.contract_end_date + 'T00:00:00') - new Date()) / (1000 * 60 * 60 * 24));
                        const isExpired = daysLeft < 0;
                        const isExpiringSoon = daysLeft >= 0 && daysLeft <= 60;
                        return (
                          <div className={`text-xs mt-1 font-bold flex items-center gap-1 ${isExpired ? 'text-red-600' : isExpiringSoon ? 'text-amber-600' : 'text-slate-500'}`}>
                            {isExpired || isExpiringSoon ? <AlertCircle className="w-3 h-3" /> : <CalendarDays className="w-3 h-3" />}
                            {isExpired ? `Expired ${Math.abs(daysLeft)} days ago` : `Expires ${format(new Date(client.contract_end_date + 'T00:00:00'), 'dd MMM yyyy')}`}
                            {isExpiringSoon && ` (${daysLeft} days left)`}
                          </div>
                        );
                      })() : (
                        <div className="text-slate-500 text-xs mt-1">
                          {client.contract_start_date 
                            ? `Since ${format(new Date(client.contract_start_date + 'T00:00:00'), 'MMM yyyy')}`
                            : 'No start date'}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {client.is_active ? (
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
                        <button onClick={() => openStatement(client)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Statement of Account">
                          <FileText className="w-4 h-4" />
                        </button>
                        <button onClick={() => openEditModal(client)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {client.is_active && (
                          <button onClick={() => openRenewModal(client)} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Renew Contract">
                            <FileEdit className="w-4 h-4" />
                          </button>
                        )}
                        {client.is_active && (
                          <button onClick={() => setConfirmDelete({ id: client.id, type: 'deactivate' })} className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="Deactivate">
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => setConfirmDelete({ id: client.id, type: 'hard' })} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete Permanently">
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

      {/* Modals */}
      {/* Deactivate/Delete Confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-slide-up">
            <h3 className="text-lg font-bold text-slate-800 mb-2">
              {confirmDelete.type === 'deactivate' ? 'Confirm Deactivation' : 'Confirm Permanent Delete'}
            </h3>
            <p className="text-sm text-slate-600 mb-6">
              {confirmDelete.type === 'deactivate' 
                ? 'Are you sure you want to deactivate this client? This will not delete the client record.' 
                : 'Are you sure you want to PERMANENTLY delete this client? This action cannot be undone and will fail if they have linked invoices or employees.'}
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
                Cancel
              </button>
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

      {/* Contract Renewal Modal */}
      {isRenewModalOpen && editingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 animate-slide-up">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <FileEdit className="w-5 h-5 text-emerald-600" />
                Renew Contract
              </h3>
              <button onClick={() => {
                setIsRenewModalOpen(false);
                setTimeout(() => setEditingClient(null), 300);
              }} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="mb-5 p-3 bg-slate-50 border border-slate-100 rounded-lg">
              <p className="font-semibold text-slate-800">{editingClient.name}</p>
              <p className="text-xs text-slate-500 mt-1">Current expiry: {editingClient.contract_end_date ? format(new Date(editingClient.contract_end_date + 'T00:00:00'), 'dd MMM yyyy') : 'Not set'}</p>
              <p className="text-xs text-slate-500">Current rate: ₹{parseFloat(editingClient.monthly_rate || 0).toLocaleString('en-IN')}</p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
              </div>
            )}

            <form onSubmit={handleRenew} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">New Contract End Date *</label>
                <input
                  type="date"
                  required
                  min={new Date().toISOString().split('T')[0]}
                  value={renewData.contract_end_date}
                  onChange={(e) => setRenewData({ ...renewData, contract_end_date: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-shadow"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">New Monthly Rate (₹) *</label>
                <input
                  type="number"
                  required
                  min="1"
                  step="0.01"
                  value={renewData.monthly_rate}
                  onChange={(e) => setRenewData({ ...renewData, monthly_rate: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-shadow"
                />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setIsRenewModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2">
                  {submitting ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : <CheckCircle2 className="w-4 h-4" />}
                  Renew Contract
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add/Edit Client Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden animate-slide-up max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-teal-600" />
                {editingClient ? 'Edit Client' : 'Add New Client'}
              </h3>
              <button onClick={() => { setIsModalOpen(false); setEditingClient(null); }} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 min-h-0">
              {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Society Name *</label>
                  <input required type="text" name="name" value={formData.name} onChange={handleInputChange} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                </div>

                <div className="col-span-1 md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Address *</label>
                  <input required type="text" name="address" value={formData.address} onChange={handleInputChange} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">City *</label>
                  <input required type="text" name="city" value={formData.city} onChange={handleInputChange} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">State</label>
                  <input type="text" name="state" value={formData.state} onChange={handleInputChange} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Monthly Rate (₹) *</label>
                  <input required type="number" min="0" step="0.01" name="monthly_rate" value={formData.monthly_rate} onChange={handleInputChange} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Contact Person</label>
                  <input type="text" name="contact_person" value={formData.contact_person} onChange={handleInputChange} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number (10 Digits)</label>
                  <input type="tel" maxLength="10" placeholder="10-digit mobile number" name="phone" value={formData.phone} onChange={handleInputChange} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input type="email" name="email" value={formData.email} onChange={handleInputChange} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">GST Number</label>
                  <input type="text" name="gst_number" value={formData.gst_number} onChange={handleInputChange} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Contract Start Date *</label>
                  <input required type="date" name="contract_start_date" value={formData.contract_start_date} onChange={handleInputChange} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Contract End Date</label>
                  <input type="date" name="contract_end_date" value={formData.contract_end_date} onChange={handleInputChange} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                </div>

                {editingClient && (
                  <div className="col-span-1 md:col-span-2 flex items-center gap-3 pt-2">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleInputChange} className="sr-only peer" />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-teal-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
                    </label>
                    <span className="text-sm font-medium text-slate-700">Client is Active</span>
                  </div>
                )}

                <div className="col-span-1 md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                  <textarea name="notes" value={formData.notes} onChange={handleInputChange} rows="2" className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => { setIsModalOpen(false); setEditingClient(null); }} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors shadow-sm disabled:opacity-50">
                  {submitting ? 'Saving...' : editingClient ? 'Update Client' : 'Save Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Statement Modal */}
      {statementClient && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-scale-in">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-indigo-600" />
                  Statement of Account
                </h2>
                <p className="text-sm text-slate-500 mt-1">{statementClient.name}</p>
              </div>
              <button onClick={() => setStatementClient(null)} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-200 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 bg-white border-b border-slate-100 flex flex-wrap gap-4 items-end justify-between">
              <div className="flex items-center gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">From Date</label>
                  <input type="date" value={statementDates.from} onChange={e => setStatementDates({...statementDates, from: e.target.value})} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">To Date</label>
                  <input type="date" value={statementDates.to} onChange={e => setStatementDates({...statementDates, to: e.target.value})} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm" />
                </div>
                <button onClick={() => fetchStatement(statementClient.id, statementDates.from, statementDates.to)} className="mt-5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
                  Filter
                </button>
              </div>
              <button onClick={downloadStatementExcel} disabled={!statementData || statementData.transactions.length === 0} className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50">
                <Download className="w-4 h-4" />
                Download Excel
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 min-h-0">
              {statementLoading ? (
                <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>
              ) : statementData ? (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Date</th>
                        <th className="px-4 py-3 font-semibold">Reference</th>
                        <th className="px-4 py-3 font-semibold">Type</th>
                        <th className="px-4 py-3 font-semibold text-right">Debit (₹)</th>
                        <th className="px-4 py-3 font-semibold text-right">Credit (₹)</th>
                        <th className="px-4 py-3 font-semibold text-right">Balance (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {statementData.transactions.length === 0 ? (
                        <tr><td colSpan="6" className="text-center py-8 text-slate-500">No transactions found</td></tr>
                      ) : (
                        statementData.transactions.map((t, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="px-4 py-3 whitespace-nowrap">{format(new Date(t.date + 'T00:00:00'), 'dd MMM yyyy')}</td>
                            <td className="px-4 py-3 font-medium text-slate-700">{t.reference}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${t.type === 'Invoice' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                                {t.type}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-slate-600">{t.debit ? parseFloat(t.debit || 0).toLocaleString('en-IN') : '-'}</td>
                            <td className="px-4 py-3 text-right text-emerald-600">{t.credit ? parseFloat(t.credit || 0).toLocaleString('en-IN') : '-'}</td>
                            <td className="px-4 py-3 text-right font-bold text-slate-800">{parseFloat(t.balance || 0).toLocaleString('en-IN')}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {statementData.transactions.length > 0 && (
                      <tfoot className="bg-slate-50 border-t border-slate-200 font-bold">
                        <tr>
                          <td colSpan="5" className="px-4 py-3 text-right text-slate-600">Closing Balance:</td>
                          <td className="px-4 py-3 text-right text-indigo-700">₹{parseFloat(statementData.final_balance || 0).toLocaleString('en-IN')}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
      
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        entityName="Clients"
        endpoint="/clients/import"
        onImportSuccess={() => {
          fetchClients();
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
