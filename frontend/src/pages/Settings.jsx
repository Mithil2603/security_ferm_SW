import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { format } from 'date-fns';
import {
  Settings as SettingsIcon, Banknote, Users, Building2,
  Plus, Edit2, Trash2, X, CheckCircle2, AlertCircle,
  Shield, ShieldCheck, ShieldOff, Eye, EyeOff, RotateCcw,
  IndianRupee, Percent, Clock, UserPlus, Key, Mail, Receipt, Settings2, Database
} from 'lucide-react';
import { getServerBaseUrl } from '../utils/apiUrl';

import DatabaseBackupTab from '../components/settings/DatabaseBackupTab';

// ─────────────────────────────────────────────────────────────
// Tab definitions
// ─────────────────────────────────────────────────────────────
const TABS = [
  { id: 'salary', label: 'Salary Structures', icon: Banknote },
  { id: 'team',   label: 'Team Management',   icon: Users },
  { id: 'agency', label: 'Agency Profile',     icon: Building2 },
  { id: 'backup', label: 'Database Backup',    icon: Database },
  { id: 'expenses', label: 'Expense Categories', icon: Receipt },
  { id: 'vendors', label: 'Vendors', icon: Building2 },
  { id: 'recurring', label: 'Recurring Expenses', icon: Clock },
  { id: 'payroll_adj', label: 'Payroll Adjustments', icon: Banknote },
];

const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-shadow';

export default function Settings() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('salary');

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-teal-600" />
          Settings & Administration
        </h1>
        <p className="text-slate-500 text-sm mt-1">Manage salary structures, database backups, team accounts, and agency profile.</p>
      </div>

      {/* Tab Bar */}
      <div className="flex flex-wrap gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-white text-teal-700 shadow-sm border border-slate-200'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'salary' && <SalaryStructuresTab />}
      {activeTab === 'team'   && <TeamManagementTab />}
      {activeTab === 'agency' && <AgencyProfileTab />}
      {activeTab === 'backup' && <DatabaseBackupTab />}
      {activeTab === 'expenses' && <ExpenseCategoriesTab />}
      {activeTab === 'vendors' && <VendorsTab />}
      {activeTab === 'recurring' && <RecurringExpensesTab />}
      {activeTab === 'payroll_adj' && <PayrollAdjustmentsTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 1: SALARY STRUCTURES
// ═══════════════════════════════════════════════════════════════
function SalaryStructuresTab() {
  const [structures, setStructures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [fetchError, setFetchError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const emptyForm = {
    name: '', base_salary: '', dearness_allowance: '0', house_rent_allowance: '0',
    other_allowances: '0', pf_percentage: '0', esi_applicable: false,
    income_tax_applicable: false, effective_from: format(new Date(), 'yyyy-MM-dd')
  };
  const [formData, setFormData] = useState({ ...emptyForm });

  const fetchStructures = async () => {
    try {
      setLoading(true);
      setFetchError('');
      const res = await api.get('/settings/salary-structures');
      setStructures(res.data || []);
    } catch (err) {
      setFetchError(err.message || 'Failed to load salary structures');
      console.error('Failed to fetch salary structures', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStructures(); }, []);

  const openCreate = () => {
    setEditing(null);
    setFormData({ ...emptyForm });
    setError('');
    setIsModalOpen(true);
  };

  const openEdit = (ss) => {
    setEditing(ss);
    setFormData({
      name: ss.name || '',
      base_salary: ss.base_salary || '',
      dearness_allowance: ss.dearness_allowance || '0',
      house_rent_allowance: ss.house_rent_allowance || '0',
      other_allowances: ss.other_allowances || '0',
      pf_percentage: ss.pf_percentage !== undefined && ss.pf_percentage !== null ? String(ss.pf_percentage) : '0',
      esi_applicable: ss.esi_applicable || false,
      income_tax_applicable: ss.income_tax_applicable || false,
      effective_from: ss.effective_from ? ss.effective_from.substring(0, 10) : format(new Date(), 'yyyy-MM-dd'),
    });
    setError('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        ...formData,
        base_salary: parseFloat(formData.base_salary),
        dearness_allowance: parseFloat(formData.dearness_allowance) || 0,
        house_rent_allowance: parseFloat(formData.house_rent_allowance) || 0,
        other_allowances: parseFloat(formData.other_allowances) || 0,
        pf_percentage: parseFloat(formData.pf_percentage) || 0,
      };
      if (editing) {
        await api.put(`/settings/salary-structures/${editing.id}`, payload);
      } else {
        await api.post('/settings/salary-structures', payload);
      }
      setIsModalOpen(false);
      fetchStructures();
    } catch (err) {
      setError(err.message || 'Failed to save salary structure');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/settings/salary-structures/${id}`);
      setConfirmDelete(null);
      fetchStructures();
    } catch (err) {
      alert(err.message || 'Failed to deactivate');
      setConfirmDelete(null);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({ ...formData, [name]: type === 'checkbox' ? checked : value });
  };

  const computeGross = () => {
    const base = parseFloat(formData.base_salary) || 0;
    const da = parseFloat(formData.dearness_allowance) || 0;
    const hra = parseFloat(formData.house_rent_allowance) || 0;
    const oth = parseFloat(formData.other_allowances) || 0;
    return base + da + hra + oth;
  };

  const computeNet = () => {
    const gross = computeGross();
    const pfPct = parseFloat(formData.pf_percentage) || 0;
    const pfDeduction = (gross * pfPct) / 100;
    return gross - pfDeduction;
  };

  return (
    <>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <IndianRupee className="w-5 h-5 text-emerald-600" />
              Salary Structures
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Define pay scales used when onboarding guards</p>
          </div>
          <button onClick={openCreate} className="flex items-center gap-2 bg-teal-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors shadow-sm">
            <Plus className="w-4 h-4" /> New Structure
          </button>
        </div>

        {fetchError && (
          <div className="mx-6 mt-4 p-4 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm flex items-start gap-2">
            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
            <div>
              <p className="font-bold">Error loading data</p>
              <p>{fetchError}</p>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Name', 'Base Salary', 'DA', 'HRA', 'Allowances', 'PF %', 'ESI', 'Gross', 'Effective', 'Guards', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={12} className="px-6 py-12 text-center text-slate-500">
                  <div className="flex justify-center mb-2"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-500"></div></div>
                  Loading...
                </td></tr>
              ) : structures.length === 0 ? (
                <tr><td colSpan={12} className="px-6 py-12 text-center text-slate-500">
                  <Banknote className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                  <p className="font-medium text-slate-600 mb-1">No salary structures defined</p>
                  <p className="text-xs">Create one to start onboarding guards.</p>
                </td></tr>
              ) : structures.map(ss => {
                const base = parseFloat(ss.base_salary) || 0;
                const da = parseFloat(ss.dearness_allowance) || 0;
                const hra = parseFloat(ss.house_rent_allowance) || 0;
                const oth = parseFloat(ss.other_allowances) || 0;
                const gross = base + da + hra + oth;
                return (
                  <tr key={ss.id} className={`hover:bg-slate-50 transition-colors ${!ss.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-semibold text-slate-800">{ss.name}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">₹{base.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-slate-500">₹{da.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-slate-500">₹{hra.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-slate-500">₹{oth.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 font-medium text-slate-600">{ss.pf_percentage}%</td>
                    <td className="px-4 py-3">{ss.esi_applicable ? <span className="text-emerald-600 text-xs font-bold">Yes</span> : <span className="text-slate-400 text-xs">No</span>}</td>
                    <td className="px-4 py-3 font-black text-emerald-700">₹{gross.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{ss.effective_from?.substring(0, 10)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{ss.active_guards}</span>
                    </td>
                    <td className="px-4 py-3">
                      {ss.is_active ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" /> Active
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => openEdit(ss)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {ss.is_active ? (
                          <button onClick={() => setConfirmDelete(ss.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Deactivate">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        ) : (
                          <button 
                            onClick={async () => {
                              try {
                                await api.put(`/settings/salary-structures/${ss.id}`, { is_active: true });
                                fetchStructures();
                              } catch (err) {
                                alert(err.response?.data?.message || 'Failed to reactivate structure');
                              }
                            }} 
                            className="px-2 py-1 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-md border border-teal-200 transition-colors" 
                            title="Re-activate Structure"
                          >
                            Activate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirm Deactivate */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-slide-up">
            <h3 className="text-lg font-bold text-slate-800 mb-2">Deactivate Structure?</h3>
            <p className="text-sm text-slate-600 mb-6">Guards already assigned to it will keep their pay. New assignments won't be allowed.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 shadow-sm">Deactivate</button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-slide-up max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Banknote className="w-5 h-5 text-teal-600" />
                {editing ? 'Edit Salary Structure' : 'New Salary Structure'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 flex-1 min-h-0">
              {error && (
                <div className="p-3 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Structure Name *</label>
                  <input name="name" value={formData.name} onChange={handleChange} required placeholder="e.g. Day Guard, Night Guard" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Base Salary (₹) *</label>
                  <input name="base_salary" type="number" step="0.01" min="1" value={formData.base_salary} onChange={handleChange} required className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Dearness Allowance (₹)</label>
                  <input name="dearness_allowance" type="number" step="0.01" min="0" value={formData.dearness_allowance} onChange={handleChange} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">HRA (₹)</label>
                  <input name="house_rent_allowance" type="number" step="0.01" min="0" value={formData.house_rent_allowance} onChange={handleChange} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Other Allowances (₹)</label>
                  <input name="other_allowances" type="number" step="0.01" min="0" value={formData.other_allowances} onChange={handleChange} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">PF Percentage (%)</label>
                  <input name="pf_percentage" type="number" step="0.01" min="0" max="100" value={formData.pf_percentage} onChange={handleChange} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Effective From</label>
                  <input name="effective_from" type="date" value={formData.effective_from} onChange={handleChange} className={inputCls} />
                </div>
              </div>

              <div className="flex gap-6 mt-2">
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input type="checkbox" name="esi_applicable" checked={formData.esi_applicable} onChange={handleChange} className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                  ESI Applicable
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input type="checkbox" name="income_tax_applicable" checked={formData.income_tax_applicable} onChange={handleChange} className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                  Income Tax Applicable
                </label>
              </div>

              {/* Live Preview */}
              <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Live Preview</p>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Gross Salary:</span>
                  <span className="font-black text-emerald-700">₹{computeGross().toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-slate-600">PF Deduction ({formData.pf_percentage}%):</span>
                  <span className="font-bold text-red-500">- ₹{((computeGross() * (parseFloat(formData.pf_percentage) || 0)) / 100).toLocaleString('en-IN')}</span>
                </div>
                <hr className="my-2 border-slate-200" />
                <div className="flex justify-between text-sm">
                  <span className="text-slate-700 font-bold">Approx Net Salary:</span>
                  <span className="font-black text-blue-700">₹{computeNet().toLocaleString('en-IN')}</span>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-sm disabled:opacity-50 flex items-center gap-2">
                  {submitting ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : <CheckCircle2 className="w-4 h-4" />}
                  {editing ? 'Save Changes' : 'Create Structure'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 2: TEAM MANAGEMENT
// ═══════════════════════════════════════════════════════════════
function TeamManagementTab() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(null);
  const [error, setError] = useState('');
  const [fetchError, setFetchError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isPermissionsOpen, setIsPermissionsOpen] = useState(null); // holds the user object being edited
  const [selectedPermissions, setSelectedPermissions] = useState([]);

  const AVAILABLE_PERMISSIONS = [
    { id: 'manage_invoices', label: 'Manage Invoices & Clients', desc: 'Create, edit, and delete invoices and client records' },
    { id: 'manage_expenses', label: 'Manage Expenses', desc: 'Record and approve/reject company expenses' },
    { id: 'manage_employees', label: 'Manage Employees', desc: 'Add, edit, and track attendance of security guards' },
    { id: 'manage_payroll', label: 'Manage Payroll', desc: 'Generate and manage salary slips' },
    { id: 'view_vouchers', label: 'View Vouchers', desc: 'Can view the list of vouchers and details' },
    { id: 'create_vouchers', label: 'Create Vouchers', desc: 'Can create new vouchers (Draft state)' },
    { id: 'edit_vouchers', label: 'Edit Vouchers', desc: 'Can edit existing pending vouchers' },
    { id: 'delete_vouchers', label: 'Delete Vouchers', desc: 'Can cancel or delete vouchers' },
    { id: 'approve_vouchers', label: 'Approve Vouchers', desc: 'Can approve vouchers and post them to ledger' },
    { id: 'view_reports', label: 'View Analytics & Reports', desc: 'Access advanced business analytics and reports' },
    { id: 'view_pl_account', label: 'View Profit & Loss Account', desc: 'Access the P&L statement' },
    { id: 'view_dev_errors', label: 'View Developer Error Console', desc: 'Access system diagnostics and error logs' },
    { id: 'manage_settings', label: 'Manage System Settings', desc: 'Configure core agency settings and logo' }
  ];

  const [addForm, setAddForm] = useState({
    full_name: '', email: '', password: '', role: 'manager', phone: ''
  });
  const [resetPwd, setResetPwd] = useState('');

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setFetchError('');
      const res = await api.get('/auth/users');
      setUsers(res.data || []);
    } catch (err) {
      setFetchError(err.message || 'Failed to load team members');
      console.error('Failed to fetch users', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleAddUser = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/auth/users', addForm);
      setIsAddOpen(false);
      setAddForm({ full_name: '', email: '', password: '', role: 'manager', phone: '' });
      fetchUsers();
    } catch (err) {
      setError(err.message || 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleUser = async (id) => {
    try {
      await api.patch(`/settings/users/${id}/toggle`);
      fetchUsers();
    } catch (err) {
      alert(err.message || 'Failed to toggle user');
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post(`/settings/users/${isResetOpen}/reset-password`, { new_password: resetPwd });
      setIsResetOpen(null);
      setResetPwd('');
      alert('Password reset successfully');
    } catch (err) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdatePermissions = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.put(`/settings/users/${isPermissionsOpen.id}`, { permissions: selectedPermissions });
      setIsPermissionsOpen(null);
      fetchUsers();
    } catch (err) {
      setError(err.message || 'Failed to update permissions');
    } finally {
      setSubmitting(false);
    }
  };

  const roleColors = {
    admin:      'bg-red-100 text-red-700 border-red-200',
    manager:    'bg-blue-100 text-blue-700 border-blue-200',
    accountant: 'bg-violet-100 text-violet-700 border-violet-200',
    employee:   'bg-slate-100 text-slate-700 border-slate-200',
  };

  return (
    <>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Shield className="w-5 h-5 text-indigo-600" />
              Team Members
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Invite managers, accountants, and staff to SecurManage</p>
          </div>
          <button onClick={() => { setIsAddOpen(true); setError(''); }} className="flex items-center gap-2 bg-teal-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors shadow-sm">
            <UserPlus className="w-4 h-4" /> Add Team Member
          </button>
        </div>

        {fetchError && (
          <div className="mx-6 mt-4 p-4 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm flex items-start gap-2">
            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
            <div>
              <p className="font-bold">Error loading team members</p>
              <p>{fetchError}</p>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Name', 'Email', 'Role', 'Phone', 'Last Login', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                  <div className="flex justify-center mb-2"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-500"></div></div>
                  Loading team...
                </td></tr>
              ) : users.map(u => (
                <tr key={u.id} className={`hover:bg-slate-50 transition-colors ${!u.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-400 to-blue-500 flex items-center justify-center text-white font-bold text-xs">
                        {u.full_name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800">{u.full_name}</p>
                        {u.id === currentUser?.id && <span className="text-[10px] text-teal-600 font-bold">(You)</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border capitalize ${roleColors[u.role] || roleColors.employee}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{u.phone || '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{u.last_login ? format(new Date(u.last_login), 'dd MMM yyyy HH:mm') : 'Never'}</td>
                  <td className="px-4 py-3">
                    {u.is_active ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><ShieldCheck className="w-3.5 h-3.5" /> Active</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400"><ShieldOff className="w-3.5 h-3.5" /> Disabled</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.id !== currentUser?.id && (
                      <div className="flex gap-1">
                        <button onClick={() => toggleUser(u.id)} className={`p-1.5 rounded-lg transition-colors ${u.is_active ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'}`} title={u.is_active ? 'Disable' : 'Enable'}>
                          {u.is_active ? <ShieldOff className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                        </button>
                        <button onClick={() => { setIsPermissionsOpen(u); setSelectedPermissions(u.permissions ? (typeof u.permissions === 'string' ? JSON.parse(u.permissions) : u.permissions) : []); setError(''); }} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Permissions">
                          <Settings2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => { setIsResetOpen(u.id); setResetPwd(''); setError(''); }} className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="Reset Password">
                          <Key className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add User Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 animate-slide-up">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><UserPlus className="w-5 h-5 text-teal-600" /> Add Team Member</h3>
              <button onClick={() => setIsAddOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            {error && <div className="mb-4 p-3 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}</div>}

            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name *</label>
                <input required value={addForm.full_name} onChange={e => setAddForm({...addForm, full_name: e.target.value})} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
                <input type="email" required value={addForm.email} onChange={e => setAddForm({...addForm, email: e.target.value})} className={inputCls} />
              </div>
              <div className="relative">
                <label className="block text-sm font-medium text-slate-700 mb-1">Password *</label>
                <input type={showPassword ? 'text' : 'password'} required minLength={6} value={addForm.password} onChange={e => setAddForm({...addForm, password: e.target.value})} className={inputCls} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-8 text-slate-400 hover:text-slate-600">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Role *</label>
                  <select value={addForm.role} onChange={e => setAddForm({...addForm, role: e.target.value})} className={inputCls}>
                    <option value="manager">Manager</option>
                    <option value="accountant">Accountant</option>
                    <option value="employee">Employee</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                  <input value={addForm.phone} onChange={e => setAddForm({...addForm, phone: e.target.value})} className={inputCls} />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsAddOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-sm disabled:opacity-50 flex items-center gap-2">
                  {submitting ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : <CheckCircle2 className="w-4 h-4" />}
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {isResetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-slide-up">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Key className="w-5 h-5 text-amber-600" /> Reset Password</h3>
              <button onClick={() => setIsResetOpen(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            {error && <div className="mb-4 p-3 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}</div>}

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">New Password *</label>
                <input type="password" required minLength={6} value={resetPwd} onChange={e => setResetPwd(e.target.value)} placeholder="Min 6 characters" className={inputCls} />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setIsResetOpen(null)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 shadow-sm disabled:opacity-50 flex items-center gap-2">
                  {submitting ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : <RotateCcw className="w-4 h-4" />}
                  Reset Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Permissions Modal */}
      {isPermissionsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={() => setIsPermissionsOpen(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-up flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Settings2 className="w-5 h-5 text-indigo-600" /> Manage Permissions</h3>
              <button onClick={() => setIsPermissionsOpen(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-3 bg-indigo-50/50 border-b border-indigo-100/50 text-sm text-indigo-800 font-medium shrink-0">
              Updating access for: {isPermissionsOpen.full_name} ({isPermissionsOpen.role})
            </div>
            
            <form onSubmit={handleUpdatePermissions} className="p-6 overflow-y-auto space-y-4 flex-1 min-h-0">
              {error && <div className="p-3 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}</div>}
              
              <div className="space-y-3">
                {AVAILABLE_PERMISSIONS.map(p => (
                  <label key={p.id} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${selectedPermissions.includes(p.id) ? 'bg-teal-50 border-teal-200' : 'bg-white border-slate-200 hover:border-teal-300'}`}>
                    <input 
                      type="checkbox" 
                      className="mt-1 w-4 h-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500"
                      checked={selectedPermissions.includes(p.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedPermissions([...selectedPermissions, p.id]);
                        } else {
                          setSelectedPermissions(selectedPermissions.filter(id => id !== p.id));
                        }
                      }}
                    />
                    <div>
                      <div className={`text-sm font-bold ${selectedPermissions.includes(p.id) ? 'text-teal-900' : 'text-slate-800'}`}>{p.label}</div>
                      <div className={`text-xs mt-0.5 ${selectedPermissions.includes(p.id) ? 'text-teal-700' : 'text-slate-500'}`}>{p.desc}</div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-slate-100 shrink-0">
                <button type="button" onClick={() => setIsPermissionsOpen(null)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-sm disabled:opacity-50 flex items-center gap-2">
                  {submitting ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : <CheckCircle2 className="w-4 h-4" />}
                  Save Permissions
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 3: AGENCY PROFILE & DEFAULTS
// ═══════════════════════════════════════════════════════════════
function AgencyProfileTab() {
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);
  const [changePwd, setChangePwd] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [pwdError, setPwdError] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  const [editProfile, setEditProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ full_name: user?.full_name || '', email: user?.email || '' });
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    setSubmitting(true);
    try {
      await api.put('/auth/update-profile', profileForm);
      setProfileSuccess('Profile updated successfully! Refresh to see changes.');
      setEditProfile(false);
    } catch (err) {
      setProfileError(err.message || 'Failed to update profile');
    } finally {
      setSubmitting(false);
    }
  };

  // Agency settings from backend
  const [agencySettings, setAgencySettings] = useState({
    agency_name: 'SecurManage',
    agency_address: '',
    agency_phone: '',
    agency_email: '',
    gst_number: '',
    default_tax_rate: '18',
    invoice_prefix: 'INV',
    currency: 'INR',
  });

  const [smtpSettings, setSmtpSettings] = useState({
    host: 'smtp.gmail.com',
    port: '587',
    user: '',
    password: ''
  });

  const [smtpSaved, setSmtpSaved] = useState(false);

  useEffect(() => {
    // Only fetch if admin
    if (user?.role !== 'admin') return;
    
    api.get('/settings/system/agency_settings')
      .then(res => {
        if (res.data) setAgencySettings(JSON.parse(res.data));
      })
      .catch(err => console.error('Failed to load agency settings', err));

    api.get('/settings/system/smtp_settings')
      .then(res => {
        if (res.data) setSmtpSettings(JSON.parse(res.data));
      })
      .catch(err => console.error('Failed to load smtp settings', err));
  }, [user]);

  const handleSaveAgency = async () => {
    try {
      await api.put('/settings/system/agency_settings', { value: JSON.stringify(agencySettings) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error(err);
      alert('Failed to save agency settings');
    }
  };

  const handleSaveSmtp = async () => {
    try {
      await api.put('/settings/system/smtp_settings', { value: JSON.stringify(smtpSettings) });
      setSmtpSaved(true);
      setTimeout(() => setSmtpSaved(false), 2000);
    } catch (err) {
      console.error(err);
      alert('Failed to save SMTP settings');
    }
  };

  const [uploadingLogo, setUploadingLogo] = useState(false);

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setUploadingLogo(true);
    const formData = new FormData();
    formData.append('logo', file);
    
    try {
      const res = await api.post('/settings/system/agency_logo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const newLogoUrl = res.data?.logo_url || res.data?.data?.logo_url;
      if (newLogoUrl) {
        setAgencySettings(prev => ({ ...prev, agency_logo_url: newLogoUrl }));
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || 'Failed to upload logo. Please ensure image is under 2MB.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = async () => {
    try {
      await api.delete('/settings/system/agency_logo');
      setAgencySettings(prev => ({ ...prev, agency_logo_url: '' }));
    } catch (err) {
      console.error(err);
      alert('Failed to remove logo');
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwdError('');
    setPwdSuccess('');

    if (pwdForm.new_password !== pwdForm.confirm) {
      setPwdError('New passwords do not match');
      return;
    }
    if (pwdForm.new_password.length < 6) {
      setPwdError('Password must be at least 6 characters');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/auth/change-password', {
        current_password: pwdForm.current_password,
        new_password: pwdForm.new_password,
      });
      setPwdSuccess('Password changed successfully!');
      setPwdForm({ current_password: '', new_password: '', confirm: '' });
    } catch (err) {
      setPwdError(err.message || 'Failed to change password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Agency Details */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-5">
          <Building2 className="w-5 h-5 text-teal-600" />
          Agency Details
        </h3>

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6">
            <div className="w-28 h-24 border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center rounded-lg overflow-hidden flex-shrink-0 p-1">
              {agencySettings.agency_logo_url ? (
                <img src={`${getServerBaseUrl()}${agencySettings.agency_logo_url}`} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                <span className="text-xs text-slate-400 text-center px-2">No Logo</span>
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Agency Logo</p>
              <div className="flex items-center gap-2">
                <label className="cursor-pointer bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-sm hover:bg-slate-50 transition-colors shadow-sm font-medium">
                  {uploadingLogo ? 'Uploading...' : 'Upload Logo'}
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={uploadingLogo} />
                </label>
                {agencySettings.agency_logo_url && (
                  <button onClick={handleRemoveLogo} className="text-red-500 hover:text-red-600 text-sm font-medium px-3 py-1.5 border border-transparent hover:border-red-100 hover:bg-red-50 rounded-lg transition-colors">
                    Remove
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Standard format: <strong>PNG or JPG</strong>. Recommended dimensions: <strong>400×120 px</strong> (or square 300×300 px), max size 2 MB.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Agency Name</label>
            <input value={agencySettings.agency_name} onChange={e => setAgencySettings({...agencySettings, agency_name: e.target.value})} className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
            <textarea rows={2} value={agencySettings.agency_address} onChange={e => setAgencySettings({...agencySettings, agency_address: e.target.value})} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <input value={agencySettings.agency_phone} onChange={e => setAgencySettings({...agencySettings, agency_phone: e.target.value})} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input type="email" value={agencySettings.agency_email} onChange={e => setAgencySettings({...agencySettings, agency_email: e.target.value})} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">GST Number</label>
              <input value={agencySettings.gst_number} onChange={e => setAgencySettings({...agencySettings, gst_number: e.target.value})} placeholder="e.g. 24AABCT1332E1ZH" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">PAN Number</label>
              <input value={agencySettings.pan_number || ''} onChange={e => setAgencySettings({...agencySettings, pan_number: e.target.value})} placeholder="e.g. AABCT1332E" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Invoice Prefix</label>
              <input value={agencySettings.invoice_prefix} onChange={e => setAgencySettings({...agencySettings, invoice_prefix: e.target.value})} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Default Tax Rate (%)</label>
              <input type="number" min="0" max="100" step="0.5" value={agencySettings.default_tax_rate} onChange={e => setAgencySettings({...agencySettings, default_tax_rate: e.target.value})} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Default HSN/SAC Code</label>
              <input value={agencySettings.hsn_code || ''} onChange={e => setAgencySettings({...agencySettings, hsn_code: e.target.value})} placeholder="e.g. 998525" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Jurisdiction City</label>
              <input value={agencySettings.jurisdiction_city || ''} onChange={e => setAgencySettings({...agencySettings, jurisdiction_city: e.target.value})} placeholder="e.g. Ahmedabad" className={inputCls} />
            </div>
          </div>

          <h4 className="text-sm font-bold text-slate-800 mt-6 mb-2 border-b pb-2">Bank Details for Invoice</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Bank Name</label>
              <input value={agencySettings.bank_name || ''} onChange={e => setAgencySettings({...agencySettings, bank_name: e.target.value})} placeholder="e.g. Indusind Bank" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Account Number</label>
              <input value={agencySettings.bank_account_number || ''} onChange={e => setAgencySettings({...agencySettings, bank_account_number: e.target.value})} placeholder="e.g. 252528112019" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">IFSC Code</label>
              <input value={agencySettings.bank_ifsc || ''} onChange={e => setAgencySettings({...agencySettings, bank_ifsc: e.target.value})} placeholder="e.g. INDB0000676" className={inputCls} />
            </div>
          </div>

          <button onClick={handleSaveAgency} className="w-full mt-4 px-4 py-2.5 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-sm transition-colors flex items-center justify-center gap-2">
            {saved ? <><CheckCircle2 className="w-4 h-4" /> Saved!</> : 'Save Settings'}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Database Backup Section */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              Database Backups
            </h3>
          </div>
          <p className="text-sm text-slate-600 mb-4">
            The system automatically backs up your database locally every night at 2:00 AM. You can also manually trigger a backup or download the latest backup archive here.
          </p>
          <div className="flex flex-col gap-3">
            <button 
              onClick={async () => {
                try {
                  const res = await api.post('/backups/create');
                  if (res.data.success) {
                    alert('Backup created successfully!');
                  }
                } catch (err) {
                  alert('Failed to create manual backup');
                }
              }}
              className="w-full px-4 py-2.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" /> Trigger Manual Backup
            </button>
            <button 
              onClick={async () => {
                try {
                  const res = await api.get('/backups');
                  if (res.data.success && res.data.data.length > 0) {
                    const latest = res.data.data[0].filename;
                    const token = localStorage.getItem('token');
                    window.open(`http://localhost:3000/api/backups/download/${latest}?token=${token}`, '_blank');
                  } else {
                    alert('No backups available. Trigger one first.');
                  }
                } catch (err) {
                  alert('Failed to fetch backup list');
                }
              }}
              className="w-full px-4 py-2.5 text-sm font-medium text-white bg-slate-800 rounded-lg hover:bg-slate-900 shadow-sm transition-colors flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" /> Download Latest Backup
            </button>
          </div>
        </div>

        {/* Profile Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex justify-between items-center mb-5">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Shield className="w-5 h-5 text-indigo-600" />
              Your Account
            </h3>
            <button onClick={() => setEditProfile(!editProfile)} className="text-sm text-teal-600 hover:text-teal-700 font-medium">
              {editProfile ? 'Cancel' : 'Edit'}
            </button>
          </div>
          
          {profileError && <div className="mb-4 p-3 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {profileError}</div>}
          {profileSuccess && <div className="mb-4 p-3 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-lg text-sm flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> {profileSuccess}</div>}
          
          {!editProfile ? (
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-teal-400 to-blue-500 flex items-center justify-center text-white font-black text-xl shadow-lg">
                {user?.full_name?.charAt(0)?.toUpperCase()}
              </div>
              <div>
                <p className="text-lg font-bold text-slate-800">{user?.full_name}</p>
                <p className="text-sm text-slate-500">{user?.email}</p>
                <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 capitalize">{user?.role}</span>
              </div>
            </div>
          ) : (
            <form onSubmit={handleUpdateProfile} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input required value={profileForm.full_name} onChange={e => setProfileForm({...profileForm, full_name: e.target.value})} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email ID</label>
                <input type="email" required value={profileForm.email} onChange={e => setProfileForm({...profileForm, email: e.target.value})} className={inputCls} />
              </div>
              <button type="submit" disabled={submitting} className="w-full mt-2 px-4 py-2.5 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-sm transition-colors flex items-center justify-center gap-2">
                {submitting ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : 'Save Profile'}
              </button>
            </form>
          )}
        </div>

        {/* SMTP Email Settings */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Mail className="w-5 h-5 text-indigo-600" />
              Email Configuration (SMTP)
            </h3>
          </div>
          
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">SMTP Host</label>
                <input required value={smtpSettings.host} onChange={e => setSmtpSettings({...smtpSettings, host: e.target.value})} placeholder="smtp.gmail.com" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">SMTP Port</label>
                <input type="number" required value={smtpSettings.port} onChange={e => setSmtpSettings({...smtpSettings, port: e.target.value})} placeholder="587" className={inputCls} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">SMTP User / Email</label>
              <input type="email" required value={smtpSettings.user} onChange={e => setSmtpSettings({...smtpSettings, user: e.target.value})} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">SMTP Password (App Password)</label>
              <input type="password" required value={smtpSettings.password} onChange={e => setSmtpSettings({...smtpSettings, password: e.target.value})} className={inputCls} />
            </div>
            <button onClick={handleSaveSmtp} className="w-full mt-2 px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-sm transition-colors flex items-center justify-center gap-2">
              {smtpSaved ? <><CheckCircle2 className="w-4 h-4" /> Saved!</> : 'Save Email Settings'}
            </button>
            <p className="text-xs text-slate-500 mt-2">Required for sending automated invoices and password resets. For Gmail, use an "App Password".</p>
          </div>
        </div>

        {/* Change Password */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Key className="w-5 h-5 text-amber-600" />
              Change Password
            </h3>
            <button onClick={() => setChangePwd(!changePwd)} className="text-sm text-teal-600 hover:text-teal-700 font-medium">
              {changePwd ? 'Cancel' : 'Change'}
            </button>
          </div>

          {changePwd && (
            <form onSubmit={handleChangePassword} className="space-y-3">
              {pwdError && <div className="p-3 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {pwdError}</div>}
              {pwdSuccess && <div className="p-3 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-lg text-sm flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> {pwdSuccess}</div>}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
                <input type="password" required value={pwdForm.current_password} onChange={e => setPwdForm({...pwdForm, current_password: e.target.value})} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
                <input type="password" required minLength={6} value={pwdForm.new_password} onChange={e => setPwdForm({...pwdForm, new_password: e.target.value})} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
                <input type="password" required value={pwdForm.confirm} onChange={e => setPwdForm({...pwdForm, confirm: e.target.value})} className={inputCls} />
              </div>
              <button type="submit" disabled={submitting} className="w-full px-4 py-2.5 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 shadow-sm disabled:opacity-50 flex items-center justify-center gap-2">
                {submitting ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : <RotateCcw className="w-4 h-4" />}
                Update Password
              </button>
            </form>
          )}
          {!changePwd && <p className="text-sm text-slate-400">Click "Change" above to update your login password.</p>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 4: EXPENSE CATEGORIES
// ═══════════════════════════════════════════════════════════════
function ExpenseCategoriesTab() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      const res = await api.get('/settings/expense-categories');
      setCategories(res.data || []);
    } catch (err) {
      console.error('Failed to load categories', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCategories(); }, []);

  const handleAddCategory = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      // Create a machine-friendly name from the input (e.g. "Office Supplies" -> "office_supplies")
      const machineName = newCategory.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
      await api.post('/settings/expense-categories', { name: machineName });
      setIsAddOpen(false);
      setNewCategory('');
      fetchCategories();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to create category');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleCategory = async (cat) => {
    try {
      await api.put(`/settings/expense-categories/${cat.id}`, { is_active: !cat.is_active });
      fetchCategories();
    } catch (err) {
      alert('Failed to update category');
    }
  };

  return (
    <>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-fade-in">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Receipt className="w-5 h-5 text-indigo-600" />
              Expense Categories
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Manage the categories available when employees submit expenses.</p>
          </div>
          <button onClick={() => { setIsAddOpen(true); setError(''); }} className="flex items-center gap-2 bg-teal-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors shadow-sm">
            <Plus className="w-4 h-4" /> Add Category
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Category Name</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Machine Value</th>
                <th className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-500">Loading categories...</td></tr>
              ) : categories.length === 0 ? (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-500">No categories defined</td></tr>
              ) : categories.map(cat => (
                <tr key={cat.id} className={`hover:bg-slate-50 transition-colors ${!cat.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-6 py-4 font-semibold text-slate-800 capitalize">{cat.name.replace(/_/g, ' ')}</td>
                  <td className="px-6 py-4 text-slate-500 font-mono text-xs">{cat.name}</td>
                  <td className="px-6 py-4">
                    {cat.is_active ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> Active</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400"><X className="w-3.5 h-3.5" /> Disabled</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => toggleCategory(cat)} className={`p-1.5 rounded-lg transition-colors ${cat.is_active ? 'text-slate-400 hover:text-amber-600 hover:bg-amber-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'}`} title={cat.is_active ? 'Disable Category' : 'Enable Category'}>
                      {cat.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-slide-up">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Plus className="w-5 h-5 text-teal-600" /> New Category</h3>
              <button onClick={() => setIsAddOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm">{error}</div>}
            <form onSubmit={handleAddCategory} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Display Name *</label>
                <input required value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="e.g. Office Supplies" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-shadow" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsAddOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-sm disabled:opacity-50">
                  {submitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 5: PAYROLL ADJUSTMENTS
// ═══════════════════════════════════════════════════════════════
function PayrollAdjustmentsTab() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newCat, setNewCat] = useState({ name: '', type: 'deduction' });

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const res = await api.get('/settings/system/payroll_adjustment_categories');
      if (res.data) {
        const parsed = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        setCategories(Array.isArray(parsed) ? parsed : []);
      } else {
        setCategories([]);
      }
    } catch (err) {
      console.error('Fetch categories error:', err);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  };

  const saveCategories = async (newCats) => {
    setSaving(true);
    try {
      await api.put('/settings/system/payroll_adjustment_categories', { value: JSON.stringify(newCats) });
      setCategories(newCats);
    } catch (err) {
      console.error('Save categories error:', err);
      alert('Failed to save category: ' + (err.response?.data?.message || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = (e) => {
    e.preventDefault();
    if (!newCat.name.trim()) return;
    if (categories.some(c => c.name.toLowerCase() === newCat.name.trim().toLowerCase())) {
      alert('Category already exists');
      return;
    }
    saveCategories([...categories, { ...newCat, name: newCat.name.trim() }]);
    setNewCat({ name: '', type: 'deduction' });
  };

  const handleDelete = (name) => {
    if (!window.confirm(`Delete ${name}?`)) return;
    saveCategories(categories.filter(c => c.name !== name));
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Payroll Adjustment Categories</h2>
          <p className="text-sm text-slate-500 mt-1">Define custom additions and deductions that can be applied during payroll generation.</p>
        </div>
      </div>
      <div className="p-6">
        <form onSubmit={handleAdd} className="flex gap-3 mb-6 bg-slate-50 p-4 rounded-lg border border-slate-100 items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-700 mb-1">Adjustment Name</label>
            <input type="text" value={newCat.name} onChange={e => setNewCat({...newCat, name: e.target.value})} className={inputCls} placeholder="e.g. Uniform Cost, Transport, Advance Salary" required />
          </div>
          <div className="w-48">
            <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
            <select value={newCat.type} onChange={e => setNewCat({...newCat, type: e.target.value})} className={inputCls}>
              <option value="deduction">Deduction (-)</option>
              <option value="addition">Addition (+)</option>
            </select>
          </div>
          <button type="submit" disabled={saving} className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors h-[38px] disabled:opacity-50">
            {saving ? 'Adding...' : 'Add Category'}
          </button>
        </form>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Additions List */}
          <div>
            <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              Additions (+)
            </h3>
            <div className="space-y-2">
              {categories.filter(c => c.type === 'addition').length === 0 && <p className="text-xs text-slate-400 italic">No addition categories</p>}
              {categories.filter(c => c.type === 'addition').map((c, i) => (
                <div key={i} className="flex justify-between items-center p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
                  <span className="text-sm font-medium text-slate-800">{c.name}</span>
                  <button onClick={() => handleDelete(c.name)} className="text-red-500 hover:text-red-700 p-1"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>
          {/* Deductions List */}
          <div>
            <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              Deductions (-)
            </h3>
            <div className="space-y-2">
              {categories.filter(c => c.type === 'deduction').length === 0 && <p className="text-xs text-slate-400 italic">No deduction categories</p>}
              {categories.filter(c => c.type === 'deduction').map((c, i) => (
                <div key={i} className="flex justify-between items-center p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
                  <span className="text-sm font-medium text-slate-800">{c.name}</span>
                  <button onClick={() => handleDelete(c.name)} className="text-red-500 hover:text-red-700 p-1"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}



// ═══════════════════════════════════════════════════════════════
// TAB: VENDORS
// ═══════════════════════════════════════════════════════════════
function VendorsTab() {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newVendor, setNewVendor] = useState({ name: '', contact_info: '', payment_terms_days: 0 });
  const [saving, setSaving] = useState(false);

  const fetchVendors = async () => {
    try {
      setLoading(true);
      const res = await api.get('/vendors');
      setVendors(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchVendors(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newVendor.name) return;
    setSaving(true);
    try {
      await api.post('/vendors', { ...newVendor, payment_terms_days: parseInt(newVendor.payment_terms_days) || 0 });
      setNewVendor({ name: '', contact_info: '', payment_terms_days: 0 });
      fetchVendors();
    } catch (err) {
      alert(err.message || 'Failed to add vendor');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (v) => {
    try {
      await api.put(`/vendors/${v.id}`, { ...v, is_active: v.is_active ? 0 : 1 });
      fetchVendors();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return <div className="text-center py-10 text-slate-500">Loading vendors...</div>;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-slide-up">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Vendors & Suppliers</h2>
          <p className="text-sm text-slate-500 mt-1">Manage external vendors used in expense recording.</p>
        </div>
      </div>
      <div className="p-6">
        <form onSubmit={handleAdd} className="flex gap-3 mb-6 bg-slate-50 p-4 rounded-lg border border-slate-100 items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-700 mb-1">Vendor Name</label>
            <input type="text" value={newVendor.name} onChange={e => setNewVendor({...newVendor, name: e.target.value})} className={inputCls} placeholder="e.g. Amazon, BestBuy" required />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-700 mb-1">Contact Info (Optional)</label>
            <input type="text" value={newVendor.contact_info} onChange={e => setNewVendor({...newVendor, contact_info: e.target.value})} className={inputCls} placeholder="Phone, Email, etc." />
          </div>
          <div className="w-24">
            <label className="block text-xs font-medium text-slate-700 mb-1">Terms (Days)</label>
            <input type="number" min="0" value={newVendor.payment_terms_days} onChange={e => setNewVendor({...newVendor, payment_terms_days: e.target.value})} className={inputCls} placeholder="e.g. 30" />
          </div>
          <button type="submit" disabled={saving} className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors h-[38px] disabled:opacity-50">
            {saving ? 'Adding...' : 'Add Vendor'}
          </button>
        </form>

        <div className="space-y-2">
          {vendors.length === 0 && <p className="text-xs text-slate-400 italic">No vendors found.</p>}
          {vendors.map((v) => (
            <div key={v.id} className={`flex justify-between items-center p-4 bg-white border ${v.is_active ? 'border-slate-200' : 'border-red-100 bg-red-50'} rounded-lg shadow-sm`}>
              <div>
                <h3 className="text-sm font-bold text-slate-800">{v.name}</h3>
                {v.contact_info && <p className="text-xs text-slate-500 mt-1">{v.contact_info}</p>}
                <p className="text-xs text-slate-500 mt-1">Terms: {v.payment_terms_days || 0} days</p>
              </div>
              <button onClick={() => handleToggleActive(v)} className={`text-xs px-3 py-1 rounded font-medium border ${v.is_active ? 'text-slate-500 border-slate-200 hover:bg-slate-100' : 'text-emerald-600 border-emerald-200 bg-emerald-50 hover:bg-emerald-100'}`}>
                {v.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB: RECURRING EXPENSES
// ═══════════════════════════════════════════════════════════════
function RecurringExpensesTab() {
  const [recurring, setRecurring] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const emptyForm = { title: '', category: '', amount: '', vendor_id: '', payment_method: 'bank_transfer', frequency: 'monthly', next_run_date: format(new Date(), 'yyyy-MM-dd') };
  const [formData, setFormData] = useState({...emptyForm});

  const fetchData = async () => {
    try {
      setLoading(true);
      const [recRes, catRes, venRes] = await Promise.all([
        api.get('/recurring-expenses'),
        api.get('/expenses/categories'),
        api.get('/vendors')
      ]);
      setRecurring(recRes.data || []);
      setCategories(catRes.data || []);
      setVendors(venRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/recurring-expenses', {
        ...formData,
        amount: parseFloat(formData.amount),
        vendor_id: formData.vendor_id ? parseInt(formData.vendor_id) : null,
      });
      setIsModalOpen(false);
      setFormData({...emptyForm});
      fetchData();
    } catch (err) {
      alert(err.message || 'Failed to add recurring expense');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id) => {
    try {
      await api.put(`/recurring-expenses/${id}/toggle`);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this recurring expense?")) return;
    try {
      await api.delete(`/recurring-expenses/${id}`);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return <div className="text-center py-10 text-slate-500">Loading recurring expenses...</div>;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-slide-up">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Recurring Expenses</h2>
          <p className="text-sm text-slate-500 mt-1">Automate regular expenses like rent or software subscriptions.</p>
        </div>
        <button onClick={() => { setFormData({...emptyForm}); setIsModalOpen(true); }} className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Recurring Expense
        </button>
      </div>
      <div className="p-6">
        <div className="space-y-3">
          {recurring.length === 0 && <p className="text-sm text-slate-500 text-center py-8">No recurring expenses set up.</p>}
          {recurring.map(r => (
            <div key={r.id} className={`flex justify-between items-center p-4 bg-white border ${r.is_active ? 'border-slate-200' : 'border-slate-100 bg-slate-50'} rounded-lg shadow-sm`}>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-sm font-bold ${r.is_active ? 'text-slate-800' : 'text-slate-400'}`}>{r.title}</span>
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full capitalize">{r.frequency}</span>
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-3">
                  <span>₹{r.amount}</span>
                  {r.vendor_name && <span>• Vendor: {r.vendor_name}</span>}
                  <span>• Next run: {format(new Date(r.next_run_date), 'MMM dd, yyyy')}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleToggle(r.id)} className={`text-xs px-3 py-1.5 rounded font-medium border ${r.is_active ? 'text-amber-600 border-amber-200 bg-amber-50 hover:bg-amber-100' : 'text-emerald-600 border-emerald-200 bg-emerald-50 hover:bg-emerald-100'}`}>
                  {r.is_active ? 'Pause' : 'Resume'}
                </button>
                <button onClick={() => handleDelete(r.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-slide-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800">Add Recurring Expense</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleAdd} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                  <input required type="text" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className={inputCls} placeholder="e.g. Office Rent" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Category *</label>
                    <select required value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className={inputCls}>
                      <option value="">-- Select --</option>
                      {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₹) *</label>
                    <input required type="number" min="0.01" step="0.01" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Frequency *</label>
                    <select required value={formData.frequency} onChange={e => setFormData({...formData, frequency: e.target.value})} className={inputCls}>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Next Run Date *</label>
                    <input required type="date" value={formData.next_run_date} onChange={e => setFormData({...formData, next_run_date: e.target.value})} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Vendor</label>
                    <select value={formData.vendor_id} onChange={e => setFormData({...formData, vendor_id: e.target.value})} className={inputCls}>
                      <option value="">-- None --</option>
                      {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
                    <select value={formData.payment_method} onChange={e => setFormData({...formData, payment_method: e.target.value})} className={inputCls}>
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="upi">UPI</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 mt-6 border-t border-slate-100">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Recurring Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
