import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  FileText, Plus, Search, Filter, CheckCircle, XCircle, Clock, Eye,
  ChevronDown, AlertCircle, Send, RefreshCw, Trash2, Download
} from 'lucide-react';

import api from '../services/api';
import { getApiBaseUrl } from '../utils/apiUrl';
import Pagination from '../components/Pagination';
import LedgerFormModal from '../components/LedgerFormModal';
import Select, { GroupedSelect } from '../components/ui/Select';
import { confirmDialog } from '../context/ToastContext';

const PAGE_SIZE = 20;

// A voucher side (Dr / Cr) is one value from the grouped ledger dropdown:
// bank:<id> | ledger:<id> | client:<id> | vendor:<id>
function sideFromVoucher(v, side) {
  if (v[`${side}_account_id`]) return `bank:${v[`${side}_account_id`]}`;
  if (v[`${side}_ledger_id`]) return `ledger:${v[`${side}_ledger_id`]}`;
  if (v.party_side === side && ['client', 'vendor'].includes(v.party_type) && v.party_id) return `${v.party_type}:${v.party_id}`;
  return '';
}
// Sections of the Dr / Cr picker opened first for each voucher type.
const SIDE_SUGGEST = {
  cash_payment: { dr: ['expenses', 'vendors'], cr: ['bank'] },
  bank_payment: { dr: ['expenses', 'vendors'], cr: ['bank'] },
  petty_cash: { dr: ['expenses'], cr: ['bank'] },
  salary: { dr: ['expenses'], cr: ['bank'] },
  cash_receipt: { dr: ['bank'], cr: ['customers', 'income'] },
  bank_receipt: { dr: ['bank'], cr: ['customers', 'income'] },
  contra: { dr: ['bank'], cr: ['bank'] },
  journal: { dr: ['expenses', 'balance_sheet'], cr: ['income', 'balance_sheet'] },
  debit_note: { dr: ['vendors'], cr: ['expenses'] },
  credit_note: { dr: ['income'], cr: ['customers'] },
};
const sideKind = (val) => (val || '').split(':')[0];
const sideId = (val) => parseInt((val || '').split(':')[1]) || null;

const VOUCHER_TYPES = [
  { key: 'cash_payment', label: 'Cash Payment', prefix: 'CP', color: '#ef4444' },
  { key: 'cash_receipt', label: 'Cash Receipt', prefix: 'CR', color: '#22c55e' },
  { key: 'bank_payment', label: 'Bank Payment', prefix: 'BP', color: '#f97316' },
  { key: 'bank_receipt', label: 'Bank Receipt', prefix: 'BR', color: '#3b82f6' },
  { key: 'journal', label: 'Journal Entry', prefix: 'JV', color: '#8b5cf6' },
  { key: 'contra', label: 'Contra', prefix: 'CT', color: '#06b6d4' },
  { key: 'debit_note', label: 'Debit Note', prefix: 'DN', color: '#ec4899' },
  { key: 'credit_note', label: 'Credit Note', prefix: 'CN', color: '#14b8a6' },
  { key: 'salary', label: 'Salary Account', prefix: 'SA', color: '#0ea5e9' },
  { key: 'petty_cash', label: 'Petty Cash Entry', prefix: 'PC', color: '#eab308' },
];

const STATUS_CONFIG = {
  draft: { label: 'Draft', color: '#6b7280', icon: Clock },
  pending_approval: { label: 'Pending Approval', color: '#f59e0b', icon: AlertCircle },
  posted: { label: 'Posted', color: '#22c55e', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: '#ef4444', icon: XCircle },
};

export default function Vouchers() {
  const { user } = useAuth();
  
  // Permission checks
  const userPerms = typeof user?.permissions === 'string' ? JSON.parse(user?.permissions || '[]') : (user?.permissions || []);
  const isAdmin = user?.role === 'admin';
  const canView = isAdmin || userPerms.includes('view_vouchers') || user?.role === 'accountant';
  const canCreate = isAdmin || userPerms.includes('create_vouchers');
  const canEdit = isAdmin || userPerms.includes('edit_vouchers');
  const canDelete = isAdmin || userPerms.includes('delete_vouchers');
  const canApprove = isAdmin || userPerms.includes('approve_vouchers');

  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters
  const [activeType, setActiveType] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Paging
  const [page, setPage] = useState(1);
  const [totalVouchers, setTotalVouchers] = useState(0);

  // Bulk approve: a selection mode — checkboxes on pending rows, header
  // checkbox for the page, and a banner to extend it to every pending voucher.
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [statusBeforeBulk, setStatusBeforeBulk] = useState('');
  const [approving, setApproving] = useState(false);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState(null);
  const [viewVoucher, setViewVoucher] = useState(null);

  // Bank accounts
  const [bankAccounts, setBankAccounts] = useState([]);

  // Party lists
  const [clients, setClients] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [ledgerOptions, setLedgerOptions] = useState([]);
  const [newLedgerFor, setNewLedgerFor] = useState(null); // 'dr' | 'cr' while the create-ledger popup is open

  // Form state
  const [form, setForm] = useState({
    voucher_type: 'cash_payment',
    voucher_date: new Date().toISOString().split('T')[0],
    amount: '',
    debit_account_id: '',
    credit_account_id: '',
    dr: '',
    cr: '',
    party_type: '',
    party_id: '',
    party_name: '',
    narration: '',
    cheque_number: '',
    cheque_date: '',
    transaction_ref: '',
    reference_type: '',
    reference_id: '',
    category: ''
  });
  const [nextNumber, setNextNumber] = useState('');
  const [summary, setSummary] = useState(null);

  // Cancel modal
  const [cancelModal, setCancelModal] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [deleteModal, setDeleteModal] = useState(null);
  const [exportTypes, setExportTypes] = useState(VOUCHER_TYPES.map(t => t.key));
  const [deleting, setDeleting] = useState(false);

  
  const fetchVouchers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeType) params.append('voucher_type', activeType);
      if (statusFilter) params.append('status', statusFilter);
      if (fromDate) params.append('from_date', fromDate);
      if (toDate) params.append('to_date', toDate);
      if (searchTerm) params.append('search', searchTerm);
      params.append('limit', String(PAGE_SIZE));
      params.append('offset', String((page - 1) * PAGE_SIZE));

      const res = await api.get(`/vouchers?${params}`);
      const data = res;
      if (data.success) {
        const total = parseInt(data.total) || 0;
        // Approving/deleting the last rows of a page leaves it empty — step back.
        if (data.data.length === 0 && page > 1 && total > 0) {
          setPage(Math.max(1, Math.ceil(total / PAGE_SIZE)));
        } else {
          setVouchers(data.data);
          setTotalVouchers(total);
        }
      } else setError(data.message);
    } catch (e) {
      setError('Failed to fetch vouchers');
    }
    setLoading(false);
  }, [activeType, statusFilter, fromDate, toDate, searchTerm, page]);

  const fetchBankAccounts = async () => {
    try {
      const res = await api.get(`/bank-accounts?active_only=true`);
      const data = res;
      if (data.success) setBankAccounts(data.data);
    } catch (e) { /* ignore */ }
  };

  const fetchLedgerOptions = async () => {
    try {
      const res = await api.get('/ledger-accounts/voucher-options');
      if (res.success) setLedgerOptions(res.data || []);
    } catch (e) { /* ignore */ }
  };

  const fetchPartyLists = async () => {
    try {
      const [cRes, eRes, vRes] = await Promise.all([
        api.get(`/clients`),
        api.get(`/employees`),
        api.get(`/vendors`)
      ]);
      const [cData, eData, vData] = [cRes, eRes, vRes];
      if (cData.success) setClients(cData.data || []);
      if (eData.success) setEmployees(eData.data || []);
      if (vData.success) setVendors(vData.data || []);
    } catch (e) { /* ignore */ }
  };

  const fetchSummary = async () => {
    try {
      const res = await api.get(`/vouchers/summary`);
      const data = res;
      if (data.success) setSummary(data.data);
    } catch (e) { /* ignore */ }
  };

  const fetchNextNumber = async (type, date) => {
    try {
      const res = await api.get(`/vouchers/next-number/${type}?date=${date}`);
      const data = res;
      if (data.success) setNextNumber(data.data.next_number);
    } catch (e) { /* ignore */ }
  };

  useEffect(() => { fetchVouchers(); }, [fetchVouchers]);
  // Any filter change starts again from page 1.
  useEffect(() => { setPage(1); }, [activeType, statusFilter, fromDate, toDate, searchTerm]);
  useEffect(() => { fetchBankAccounts(); fetchLedgerOptions(); fetchPartyLists(); fetchSummary(); }, []);
  useEffect(() => {
    if (showModal) fetchNextNumber(form.voucher_type, form.voucher_date);
  }, [form.voucher_type, form.voucher_date, showModal]);

  const resetForm = () => {
    setForm({
      voucher_type: 'cash_payment', voucher_date: new Date().toISOString().split('T')[0],
      amount: '', debit_account_id: '', credit_account_id: '', dr: '', cr: '',
      party_type: '', party_id: '', party_name: '',
      narration: '', cheque_number: '', cheque_date: '', transaction_ref: '',
      reference_type: '', reference_id: '', category: ''
    });
    setEditingVoucher(null);
    setNextNumber('');
  };

  const openCreateModal = (type) => {
    resetForm();
    setForm(f => ({ ...f, voucher_type: type || 'cash_payment' }));
    setShowModal(true);
  };

  const openEditModal = (v) => {
    setEditingVoucher(v);
    setForm({
      voucher_type: v.voucher_type, voucher_date: v.voucher_date,
      amount: v.amount, debit_account_id: v.debit_account_id || '',
      credit_account_id: v.credit_account_id || '',
      dr: sideFromVoucher(v, 'debit'), cr: sideFromVoucher(v, 'credit'),
      party_type: v.party_type || '', party_id: v.party_id || '',
      party_name: v.party_name || '', narration: v.narration || '',
      cheque_number: v.cheque_number || '', cheque_date: v.cheque_date || '',
      transaction_ref: v.transaction_ref || '',
      reference_type: v.reference_type || '', reference_id: v.reference_id || '',
      category: v.category || ''
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      const url = editingVoucher ? `/vouchers/${editingVoucher.id}` : `/vouchers`;
      const method = editingVoucher ? 'PUT' : 'POST';
      if (!form.dr || !form.cr) { setError('Select both the Debit and the Credit ledger'); return; }
      if (form.dr === form.cr) { setError('Debit and Credit cannot be the same ledger'); return; }
      const partyKinds = ['client', 'vendor'];
      if (partyKinds.includes(sideKind(form.dr)) && partyKinds.includes(sideKind(form.cr))) {
        setError('Only one side can be a customer or vendor'); return;
      }
      const { dr, cr, ...rest } = form;
      const body = {
        ...rest,
        amount: parseFloat(form.amount),
        debit_account_id: sideKind(dr) === 'bank' ? sideId(dr) : null,
        credit_account_id: sideKind(cr) === 'bank' ? sideId(cr) : null,
        debit_ledger_id: sideKind(dr) === 'ledger' ? sideId(dr) : null,
        credit_ledger_id: sideKind(cr) === 'ledger' ? sideId(cr) : null,
        party_side: null,
        party_id: form.party_id ? parseInt(form.party_id) : null,
        reference_id: form.reference_id ? parseInt(form.reference_id) : null,
      };
      // A customer / vendor picked as Dr or Cr becomes the voucher's party.
      for (const [val, side] of [[dr, 'debit'], [cr, 'credit']]) {
        if (partyKinds.includes(sideKind(val))) {
          body.party_type = sideKind(val);
          body.party_id = sideId(val);
          body.party_name = '';
          body.party_side = side;
        }
      }
      const res = await api.request({ url, method, data: body });
      const data = res;
      if (data.success) {
        setSuccess(data.message);
        setShowModal(false);
        resetForm();
        fetchVouchers();
        fetchSummary();
      } else {
        setError(data.message);
      }
    } catch (e) {
      setError(e?.message || 'Failed to save voucher');
    }
  };

  const handleApprove = async (id) => {
    try {
      const res = await api.post(`/vouchers/${id}/approve`);
      const data = res;
      if (data.success) {
        setSuccess(data.message);
        fetchVouchers();
        fetchSummary();
      } else setError(data.message);
    } catch (e) { setError('Failed to approve'); }
  };

  const handleCancel = async () => {
    if (!cancelReason.trim()) { setError('Cancellation reason is required'); return; }
    try {
      const res = await api.post(`/vouchers/${cancelModal.id}/cancel`, { reason: cancelReason });
      const data = res;
      if (data.success) {
        setSuccess(data.message);
        setCancelModal(null);
        setCancelReason('');
        fetchVouchers();
        fetchSummary();
      } else setError(data.message);
    } catch (e) { setError('Failed to cancel'); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const data = await api.delete(`/vouchers/${deleteModal.id}`);
      if (data.success) {
        setSuccess(data.message);
        setDeleteModal(null);
        fetchVouchers();
        fetchSummary();
      } else setError(data.message);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to delete voucher');
      setDeleteModal(null);
    } finally {
      setDeleting(false);
    }
  };

  // Excel / PDF download — any combination of voucher types, for the date range,
  // status and search set in the filters above.
  const toggleExportType = (key) => {
    setExportTypes(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };
  const handleExport = (format) => {
    if (exportTypes.length === 0) { setError('Select at least one voucher type to download'); return; }
    const params = new URLSearchParams({ format });
    if (exportTypes.length < VOUCHER_TYPES.length) params.set('types', exportTypes.join(','));
    if (statusFilter) params.set('status', statusFilter);
    if (fromDate) params.set('from_date', fromDate);
    if (toDate) params.set('to_date', toDate);
    if (searchTerm) params.set('search', searchTerm);
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    if (token) params.set('token', token);
    window.open(`${getApiBaseUrl()}/vouchers/export?${params.toString()}`, '_blank');
  };

  // Enter selection mode showing only pending vouchers; leaving restores the
  // status filter the user had before.
  const startBulkApprove = () => {
    setStatusBeforeBulk(statusFilter);
    setStatusFilter('pending_approval');
    setSelectedIds(new Set());
    setBulkMode(true);
  };
  const exitBulkApprove = () => {
    setBulkMode(false);
    setSelectedIds(new Set());
    setStatusFilter(statusBeforeBulk);
  };

  const pendingOnPage = vouchers.filter(v => v.status === 'pending_approval');
  const allPageSelected = pendingOnPage.length > 0 && pendingOnPage.every(v => selectedIds.has(v.id));
  const somePageSelected = pendingOnPage.some(v => selectedIds.has(v.id));

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectPage = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allPageSelected) pendingOnPage.forEach(v => next.delete(v.id));
      else pendingOnPage.forEach(v => next.add(v.id));
      return next;
    });
  };
  // Select every pending voucher matching the current filters, across all pages.
  const selectAllPending = async () => {
    try {
      const params = new URLSearchParams({ status: 'pending_approval', limit: '10000', offset: '0' });
      if (activeType) params.append('voucher_type', activeType);
      if (fromDate) params.append('from_date', fromDate);
      if (toDate) params.append('to_date', toDate);
      if (searchTerm) params.append('search', searchTerm);
      const data = await api.get(`/vouchers?${params}`);
      if (data.success) setSelectedIds(new Set(data.data.map(v => v.id)));
      else setError(data.message);
    } catch (e) { setError('Failed to select all pending vouchers'); }
  };

  const handleApproveSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const confirmed = await confirmDialog({
      title: 'Approve Vouchers',
      message: `Approve and post ${ids.length} voucher(s)? Posted vouchers count in bank/cash balances, ledgers and reports.`,
      confirmText: `Approve ${ids.length}`,
    });
    if (!confirmed) return;
    setApproving(true);
    try {
      const data = await api.post(`/vouchers/bulk-approve`, { voucher_ids: ids });
      if (data.success) {
        setSuccess(data.message);
        setSelectedIds(new Set());
        fetchVouchers();
        fetchSummary();
      } else setError(data.message);
    } catch (e) { setError(e.message || 'Failed to bulk approve'); }
    setApproving(false);
  };

  const getPartyList = () => {
    switch (form.party_type) {
      case 'client': return clients.map(c => ({ id: c.id, name: c.name }));
      case 'employee': return employees.map(e => ({ id: e.id, name: e.full_name }));
      case 'vendor': return vendors.map(v => ({ id: v.id, name: v.name }));
      default: return [];
    }
  };

  const handlePartyChange = (partyId) => {
    const list = getPartyList();
    const party = list.find(p => p.id === parseInt(partyId));
    setForm(f => ({ ...f, party_id: partyId, party_name: party?.name || '' }));
  };

  const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

  const pendingCount = summary?.pending_approval_count || 0;

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#1e293b', margin: 0 }}>Voucher Management</h1>
          <p style={{ fontSize: '14px', color: '#64748b', marginTop: '4px' }}>Create, approve, and track financial vouchers</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {canApprove && pendingCount > 0 && !bulkMode && (
            <button onClick={startBulkApprove} style={{
              padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              background: '#f59e0b', color: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap'
            }}>
              <CheckCircle size={16} /> Bulk Approve ({pendingCount})
            </button>
          )}
          {canCreate && (
            <button 
              onClick={() => openCreateModal()} 
              className="px-4 py-2 rounded-lg border-none cursor-pointer bg-teal-600 hover:bg-teal-700 text-white font-semibold flex items-center gap-2 transition-colors text-sm"
            >
              <Plus size={18} /> New Voucher
            </button>
          )}
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div style={{ padding: '10px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: '8px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <XCircle size={16} /> {error}
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}>✕</button>
        </div>
      )}
      {success && (
        <div style={{ padding: '10px 16px', background: '#f0fdf4', color: '#16a34a', borderRadius: '8px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CheckCircle size={16} /> {success}
          <button onClick={() => setSuccess('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a' }}>✕</button>
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          {VOUCHER_TYPES.map(vt => {
            const data = summary.by_type?.find(s => s.voucher_type === vt.key);
            return (
              <div key={vt.key} onClick={() => setActiveType(activeType === vt.key ? '' : vt.key)}
                style={{
                  padding: '14px', borderRadius: '10px', cursor: 'pointer',
                  background: activeType === vt.key ? vt.color : '#fff',
                  color: activeType === vt.key ? '#fff' : '#1e293b',
                  border: `2px solid ${activeType === vt.key ? vt.color : '#e2e8f0'}`,
                  boxShadow: activeType === vt.key ? `0 4px 12px ${vt.color}33` : '0 1px 3px rgba(0,0,0,0.08)',
                  transition: 'all 0.2s'
                }}>
                <div style={{ fontSize: '11px', fontWeight: 600, opacity: 0.8, textTransform: 'uppercase' }}>{vt.prefix}</div>
                <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '2px' }}>{vt.label}</div>
                <div style={{ fontSize: '16px', fontWeight: 700, marginTop: '6px' }}>{fmt(data?.total_amount || 0)}</div>
                <div style={{ fontSize: '11px', opacity: 0.7, marginTop: '2px' }}>{data?.count || 0} entries</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1', minWidth: '200px' }}>
          <Search size={16} style={{ position: 'absolute', left: '10px', top: '10px', color: '#94a3b8' }} />
          <input type="text" placeholder="Search vouchers..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '8px 8px 8px 34px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
        </div>
        <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', minWidth: '140px' }}>
          <option value="">All Status</option>
          <option value="pending_approval">Pending Approval</option>
          <option value="posted">Posted</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <span style={{ fontSize: '12px', color: '#64748b' }}>From</span>
        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} title="From date"
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
        <span style={{ fontSize: '12px', color: '#64748b' }}>To</span>
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} title="To date"
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
        <button onClick={() => { setActiveType(''); setStatusFilter(''); setFromDate(''); setToDate(''); setSearchTerm(''); }}
          style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <RefreshCw size={14} /> Reset
        </button>
      </div>

      {/* Download (Excel / PDF) */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px', display: 'flex', flexWrap: 'wrap', gap: '10px 14px', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Download:</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', cursor: 'pointer', fontWeight: 600 }}>
          <input type="checkbox"
            checked={exportTypes.length === VOUCHER_TYPES.length}
            onChange={e => setExportTypes(e.target.checked ? VOUCHER_TYPES.map(t => t.key) : [])} />
          All
        </label>
        {VOUCHER_TYPES.map(vt => (
          <label key={vt.key} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', cursor: 'pointer' }}>
            <input type="checkbox" checked={exportTypes.includes(vt.key)} onChange={() => toggleExportType(vt.key)} />
            {vt.label}
          </label>
        ))}
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>
          {fromDate || toDate ? `${fromDate || 'Start'} to ${toDate || 'Today'}` : 'All dates'} — set the dates in the filters above
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button onClick={() => handleExport('xlsx')}
            style={{ padding: '7px 14px', borderRadius: '8px', border: 'none', background: '#15803d', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Download size={14} /> Excel
          </button>
          <button onClick={() => handleExport('pdf')}
            style={{ padding: '7px 14px', borderRadius: '8px', border: 'none', background: '#1e293b', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Download size={14} /> PDF
          </button>
        </div>
      </div>

      {/* Bulk approve bar */}
      {bulkMode && (
        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '10px', padding: '10px 14px', marginBottom: '12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#92400e' }}>
            Bulk approve — {selectedIds.size} of {totalVouchers} pending voucher(s) selected
          </span>
          {allPageSelected && selectedIds.size < totalVouchers && (
            <button onClick={selectAllPending}
              style={{ background: 'none', border: 'none', color: '#b45309', fontWeight: 600, fontSize: '13px', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
              Select all {totalVouchers} pending vouchers
            </button>
          )}
          {selectedIds.size > 0 && (
            <button onClick={() => setSelectedIds(new Set())}
              style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '13px', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
              Clear selection
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <button onClick={exitBulkApprove} disabled={approving}
              style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: '13px' }}>
              Cancel
            </button>
            <button onClick={handleApproveSelected} disabled={approving || selectedIds.size === 0}
              style={{ padding: '7px 14px', borderRadius: '8px', border: 'none', background: '#16a34a', color: '#fff', cursor: selectedIds.size ? 'pointer' : 'not-allowed', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', opacity: selectedIds.size && !approving ? 1 : 0.5 }}>
              <CheckCircle size={14} /> {approving ? 'Approving...' : `Approve Selected (${selectedIds.size})`}
            </button>
          </div>
        </div>
      )}

      {/* Vouchers Table */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {bulkMode && (
                  <th style={{ ...thStyle, width: '40px' }}>
                    <input type="checkbox" title="Select all pending on this page"
                      checked={allPageSelected}
                      ref={el => { if (el) el.indeterminate = !allPageSelected && somePageSelected; }}
                      disabled={pendingOnPage.length === 0}
                      onChange={toggleSelectPage}
                      style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                  </th>
                )}
                <th style={thStyle}>Voucher #</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Party</th>
                <th style={thStyle}>Dr / Cr</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                <th style={thStyle}>Narration</th>
                <th style={thStyle}>Status</th>
                {canView && <th style={{ ...thStyle, textAlign: 'center' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={bulkMode ? 10 : 9} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Loading vouchers...</td></tr>
              ) : vouchers.length === 0 ? (
                <tr><td colSpan={bulkMode ? 10 : 9} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>{bulkMode ? 'No vouchers pending approval' : 'No vouchers found'}</td></tr>
              ) : vouchers.map(v => {
                const typeConfig = VOUCHER_TYPES.find(t => t.key === v.voucher_type);
                const statusCfg = STATUS_CONFIG[v.status];
                const StatusIcon = statusCfg?.icon || Clock;
                return (
                  <tr key={v.id} style={{ borderBottom: '1px solid #f1f5f9', background: bulkMode && selectedIds.has(v.id) ? '#fefce8' : 'transparent' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = bulkMode && selectedIds.has(v.id) ? '#fefce8' : 'transparent'}>
                    {bulkMode && (
                      <td style={{ ...tdStyle, width: '40px' }}>
                        <input type="checkbox"
                          checked={selectedIds.has(v.id)}
                          disabled={v.status !== 'pending_approval'}
                          onChange={() => toggleSelect(v.id)}
                          style={{ cursor: v.status === 'pending_approval' ? 'pointer' : 'not-allowed', width: '15px', height: '15px' }} />
                      </td>
                    )}
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{v.voucher_number}</span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                        background: `${typeConfig?.color}15`, color: typeConfig?.color
                      }}>
                        {typeConfig?.label}
                      </span>
                    </td>
                    <td style={tdStyle}>{new Date(v.voucher_date).toLocaleDateString('en-IN')}</td>
                    <td style={tdStyle}>{v.party_name || '-'}</td>
                    <td style={{ ...tdStyle, fontSize: '12px', lineHeight: 1.35, maxWidth: '200px' }}>
                      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ color: '#94a3b8' }}>Dr</span> {v.debit_account_name || '-'}</div>
                      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ color: '#94a3b8' }}>Cr</span> {v.credit_account_name || '-'}</div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{fmt(v.amount)}</td>
                    <td style={{ ...tdStyle, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.narration || '-'}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                        background: `${statusCfg?.color}15`, color: statusCfg?.color,
                        display: 'inline-flex', alignItems: 'center', gap: '4px'
                      }}>
                        <StatusIcon size={12} /> {statusCfg?.label}
                      </span>
                    </td>
                    {canView && (
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button onClick={() => setViewVoucher(v)} title="View"
                            style={actionBtnStyle}><Eye size={14} /></button>
                          {v.status === 'pending_approval' && canApprove && (
                            <button onClick={() => handleApprove(v.id)} title="Approve"
                              style={{ ...actionBtnStyle, color: '#22c55e' }}><CheckCircle size={14} /></button>
                          )}
                          {['draft', 'pending_approval'].includes(v.status) && canEdit && (
                            <button onClick={() => openEditModal(v)} title="Edit"
                              style={{ ...actionBtnStyle, color: '#3b82f6' }}>✏️</button>
                          )}
                          {['draft', 'pending_approval'].includes(v.status) && canDelete && (
                            <button onClick={() => setCancelModal(v)} title="Cancel"
                              style={{ ...actionBtnStyle, color: '#ef4444' }}><XCircle size={14} /></button>
                          )}
                          {canDelete && (
                            <button onClick={() => setDeleteModal(v)} title="Delete"
                              style={{ ...actionBtnStyle, color: '#dc2626' }}><Trash2 size={14} /></button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '0 14px 12px' }}>
          <Pagination
            pagination={{ page, limit: PAGE_SIZE, total: totalVouchers, pages: Math.max(1, Math.ceil(totalVouchers / PAGE_SIZE)) }}
            onPageChange={setPage}
            alwaysShow />
        </div>
      </div>

      {/* ── Create/Edit Modal ────────────────────────────────────────────── */}
      {showModal && (
        <div style={overlayStyle} onClick={() => { setShowModal(false); resetForm(); }}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 20px', fontSize: '20px', color: '#1e293b' }}>
              {editingVoucher ? `Edit ${editingVoucher.voucher_number}` : `New Voucher — ${nextNumber || '...'}`}
            </h2>
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={labelStyle}>Voucher Type</label>
                  <Select value={form.voucher_type} onChange={e => setForm(f => ({ ...f, voucher_type: e.target.value }))}
                    disabled={!!editingVoucher} style={inputStyle}>
                    {VOUCHER_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </Select>
                </div>
                <div>
                  <label style={labelStyle}>Date</label>
                  <input type="date" value={form.voucher_date} onChange={e => setForm(f => ({ ...f, voucher_date: e.target.value }))}
                    required style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Amount (₹)</label>
                  <input type="number" step="0.01" min="0.01" value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                    required placeholder="0.00" style={inputStyle} />
                </div>
                {[['dr', 'Debit (Dr) — To', 'Receives the value / expense'], ['cr', 'Credit (Cr) — By', 'Gives the value / income']].map(([key, label, hint]) => (
                  <div key={key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <label style={labelStyle}>{label} *</label>
                      <button type="button" onClick={() => setNewLedgerFor(key)}
                        style={{ background: 'none', border: 'none', color: '#0d9488', fontSize: '11px', fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                        + New Ledger
                      </button>
                    </div>
                    <GroupedSelect
                      value={form[key]}
                      required
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      groups={ledgerOptions}
                      defaultExpanded={SIDE_SUGGEST[form.voucher_type]?.[key]}
                      placeholder="Select ledger"
                      searchPlaceholder="Search bank, customer, vendor, ledger..."
                      footerAction={{ label: '+ Create new ledger', onClick: () => setNewLedgerFor(key) }}
                      aria-label={label} />
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{hint}</div>
                  </div>
                ))}
                {!['client', 'vendor'].includes(sideKind(form.dr)) && !['client', 'vendor'].includes(sideKind(form.cr)) && (<>
                <div>
                  <label style={labelStyle}>Party Type</label>
                  <Select value={form.party_type} onChange={e => setForm(f => ({ ...f, party_type: e.target.value, party_id: '', party_name: '' }))}
                    style={inputStyle}>
                    <option value="">— None —</option>
                    <option value="client">Client</option>
                    <option value="employee">Employee</option>
                    <option value="vendor">Vendor</option>
                    <option value="other">Other</option>
                  </Select>
                </div>
                {form.party_type && form.party_type !== 'other' && (
                  <div>
                    <label style={labelStyle}>Select Party</label>
                    <Select value={form.party_id} onChange={e => handlePartyChange(e.target.value)} style={inputStyle}>
                      <option value="">— Select —</option>
                      {getPartyList().map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </div>
                )}
                {form.party_type === 'other' && (
                  <div>
                    <label style={labelStyle}>Party Name</label>
                    <input type="text" value={form.party_name} onChange={e => setForm(f => ({ ...f, party_name: e.target.value }))}
                      placeholder="Enter name" style={inputStyle} />
                  </div>
                )}
                </>)}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Budget Category (Optional)</label>
                  <input type="text" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    placeholder="e.g. Travel, Office Supplies" style={inputStyle} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Narration / Description</label>
                  <textarea value={form.narration} onChange={e => setForm(f => ({ ...f, narration: e.target.value }))}
                    rows={2} placeholder="Describe the transaction" style={{ ...inputStyle, resize: 'vertical' }} />
                </div>
                {['bank_payment', 'bank_receipt', 'contra', 'salary'].includes(form.voucher_type) && (
                  <>
                    <div>
                      <label style={labelStyle}>Cheque Number</label>
                      <input type="text" value={form.cheque_number} onChange={e => setForm(f => ({ ...f, cheque_number: e.target.value }))}
                        placeholder="Optional" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Cheque Date</label>
                      <input type="date" value={form.cheque_date} onChange={e => setForm(f => ({ ...f, cheque_date: e.target.value }))}
                        style={inputStyle} />
                    </div>
                  </>
                )}
                <div>
                  <label style={labelStyle}>Transaction Reference (UTR/UPI)</label>
                  <input type="text" value={form.transaction_ref} onChange={e => setForm(f => ({ ...f, transaction_ref: e.target.value }))}
                    placeholder="Optional" style={inputStyle} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
                <button 
                  type="button" 
                  onClick={() => { setShowModal(false); resetForm(); }}
                  className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors text-sm cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="inline-flex items-center gap-1.5 whitespace-nowrap px-5 py-2 rounded-lg border-none cursor-pointer bg-teal-600 hover:bg-teal-700 text-white font-semibold transition-colors text-sm"
                >
                  <Send size={14} className="shrink-0" />
                  {editingVoucher ? 'Update' : 'Submit for Approval'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <LedgerFormModal
        isOpen={!!newLedgerFor}
        onClose={() => setNewLedgerFor(null)}
        onSaved={async (ledger) => {
          const side = newLedgerFor;
          setNewLedgerFor(null);
          await fetchLedgerOptions();
          if (ledger?.id && side) setForm(f => ({ ...f, [side]: `ledger:${ledger.id}` }));
        }} />

      {/* ── View Modal ───────────────────────────────────────────────────── */}
      {viewVoucher && (
        <div style={overlayStyle} onClick={() => setViewVoucher(null)}>
          <div style={{ ...modalStyle, maxWidth: '550px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', color: '#1e293b' }}>Voucher Details</h2>
              <button onClick={() => setViewVoucher(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#94a3b8' }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
              {[
                ['Voucher #', viewVoucher.voucher_number],
                ['Type', VOUCHER_TYPES.find(t => t.key === viewVoucher.voucher_type)?.label],
                ['Date', new Date(viewVoucher.voucher_date).toLocaleDateString('en-IN')],
                ['Amount', fmt(viewVoucher.amount)],
                ['Debit A/C', viewVoucher.debit_account_name || '-'],
                ['Credit A/C', viewVoucher.credit_account_name || '-'],
                ['Party', viewVoucher.party_name || '-'],
                ['Status', STATUS_CONFIG[viewVoucher.status]?.label],
                ['Cheque #', viewVoucher.cheque_number || '-'],
                ['Txn Ref', viewVoucher.transaction_ref || '-'],
                ['Created By', viewVoucher.created_by_name || '-'],
                ['Approved By', viewVoucher.approved_by_name || '-'],
              ].map(([label, value], i) => (
                <div key={i}>
                  <div style={{ color: '#64748b', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
                  <div style={{ fontWeight: 500, color: '#1e293b', marginTop: '2px' }}>{value}</div>
                </div>
              ))}
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ color: '#64748b', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>Narration</div>
                <div style={{ fontWeight: 500, color: '#1e293b', marginTop: '2px' }}>{viewVoucher.narration || '-'}</div>
              </div>
              {viewVoucher.cancellation_reason && (
                <div style={{ gridColumn: '1 / -1', background: '#fef2f2', padding: '10px', borderRadius: '8px' }}>
                  <div style={{ color: '#dc2626', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>Cancellation Reason</div>
                  <div style={{ color: '#dc2626', marginTop: '2px' }}>{viewVoucher.cancellation_reason}</div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
              {viewVoucher.status === 'pending_approval' && canApprove && (
                <button onClick={() => { handleApprove(viewVoucher.id); setViewVoucher(null); }}
                  style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                  Approve Voucher
                </button>
              )}
              <button onClick={() => setViewVoucher(null)}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Modal ─────────────────────────────────────────────────── */}
      {deleteModal && (
        <div style={overlayStyle} onClick={() => !deleting && setDeleteModal(null)}>
          <div style={{ ...modalStyle, maxWidth: '450px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 12px', fontSize: '18px', color: '#dc2626' }}>Delete Voucher</h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '8px' }}>
              Permanently delete <strong>{deleteModal.voucher_number}</strong> for {fmt(deleteModal.amount)}?
            </p>
            <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '16px' }}>
              It will be removed from the voucher list and the bank/cash balance will be adjusted. This cannot be undone.
              To keep a record instead, use Cancel.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteModal(null)} disabled={deleting}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer' }}>
                Back
              </button>
              <button onClick={handleDelete} disabled={deleting}
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontWeight: 600, opacity: deleting ? 0.6 : 1 }}>
                {deleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel Modal ─────────────────────────────────────────────────── */}
      {cancelModal && (
        <div style={overlayStyle} onClick={() => { setCancelModal(null); setCancelReason(''); }}>
          <div style={{ ...modalStyle, maxWidth: '450px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 12px', fontSize: '18px', color: '#dc2626' }}>Cancel Voucher</h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>
              Cancel <strong>{cancelModal.voucher_number}</strong> for {fmt(cancelModal.amount)}?
            </p>
            <label style={labelStyle}>Reason for Cancellation *</label>
            <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)}
              rows={3} required placeholder="Enter reason..." style={{ ...inputStyle, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button onClick={() => { setCancelModal(null); setCancelReason(''); }}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer' }}>
                Back
              </button>
              <button onClick={handleCancel}
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Styles
const thStyle = { padding: '10px 14px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' };
const tdStyle = { padding: '10px 14px', color: '#334155' };
const actionBtnStyle = { background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', color: '#64748b' };
const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
  display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px',
  overflowY: 'auto'
};
const modalStyle = {
  background: '#fff', borderRadius: '16px', padding: '28px', maxWidth: '700px', width: '100%',
  maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)'
};
const labelStyle = { display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' };
const inputStyle = { width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', boxSizing: 'border-box' };
