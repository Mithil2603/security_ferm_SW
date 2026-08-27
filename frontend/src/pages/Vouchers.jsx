import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  FileText, Plus, Search, Filter, CheckCircle, XCircle, Clock, Eye,
  ChevronDown, AlertCircle, Send, RefreshCw
} from 'lucide-react';

import api from '../services/api';

const VOUCHER_TYPES = [
  { key: 'cash_payment', label: 'Cash Payment', prefix: 'CP', color: '#ef4444' },
  { key: 'cash_receipt', label: 'Cash Receipt', prefix: 'CR', color: '#22c55e' },
  { key: 'bank_payment', label: 'Bank Payment', prefix: 'BP', color: '#f97316' },
  { key: 'bank_receipt', label: 'Bank Receipt', prefix: 'BR', color: '#3b82f6' },
  { key: 'journal', label: 'Journal Entry', prefix: 'JV', color: '#8b5cf6' },
  { key: 'contra', label: 'Contra', prefix: 'CT', color: '#06b6d4' },
  { key: 'debit_note', label: 'Debit Note', prefix: 'DN', color: '#ec4899' },
  { key: 'credit_note', label: 'Credit Note', prefix: 'CN', color: '#14b8a6' },
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
  const canView = isAdmin || userPerms.includes('view_vouchers') || userPerms.includes('manage_vouchers') || user?.role === 'accountant';
  const canCreate = isAdmin || userPerms.includes('create_vouchers') || userPerms.includes('manage_vouchers');
  const canEdit = isAdmin || userPerms.includes('edit_vouchers') || userPerms.includes('manage_vouchers');
  const canDelete = isAdmin || userPerms.includes('delete_vouchers') || userPerms.includes('manage_vouchers');
  const canApprove = isAdmin || userPerms.includes('approve_vouchers') || userPerms.includes('manage_vouchers');

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
  const [loadingParties, setLoadingParties] = useState(false);

  // Pagination
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const limit = 50;

  // Form state
  const [form, setForm] = useState({
    voucher_type: 'cash_payment',
    voucher_date: new Date().toISOString().split('T')[0],
    amount: '',
    debit_account_id: '',
    credit_account_id: '',
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
  
  const [submitting, setSubmitting] = useState(false);
  
  const fetchVouchers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeType) params.append('voucher_type', activeType);
      if (statusFilter) params.append('status', statusFilter);
      if (fromDate) params.append('from_date', fromDate);
      if (toDate) params.append('to_date', toDate);
      if (searchTerm) params.append('search', searchTerm);
      params.append('limit', limit);
      params.append('offset', page * limit);

      const res = await api.get(`/vouchers?${params}`);
      const data = res.data || res;
      if (data.success) {
        setVouchers(data.data);
        setTotal(data.total || 0);
      } else {
        setError(data.message);
      }
    } catch (e) {
      console.error('Fetch error:', e);
      setError(e.response?.data?.message || 'Failed to fetch vouchers');
    }
    setLoading(false);
  }, [activeType, statusFilter, fromDate, toDate, searchTerm, page]);

  const fetchBankAccounts = async () => {
    try {
      const res = await api.get(`/bank-accounts?active_only=true`);
      const data = res.data || res;
      if (data.success) setBankAccounts(data.data);
    } catch (e) { 
      console.error('Fetch bank accounts error:', e);
    }
  };

  const fetchPartyLists = async () => {
    setLoadingParties(true);
    try {
      const [cRes, eRes, vRes] = await Promise.all([
        api.get(`/clients`),
        api.get(`/employees`),
        api.get(`/vendors`)
      ]);
      const [cData, eData, vData] = [cRes.data || cRes, eRes.data || eRes, vRes.data || vRes];
      if (cData.success) setClients(cData.data || []);
      if (eData.success) setEmployees(eData.data || []);
      if (vData.success) setVendors(vData.data || []);
    } catch (e) {
      console.error('Fetch party lists error:', e);
    } finally {
      setLoadingParties(false);
    }
  };

  const fetchSummary = async () => {
    try {
      const res = await api.get(`/vouchers/summary`);
      const data = res.data || res;
      if (data.success) setSummary(data.data);
    } catch (e) { 
      console.error('Fetch summary error:', e);
    }
  };

  const fetchNextNumber = async (type, date) => {
    try {
      const res = await api.get(`/vouchers/next-number/${type}?date=${date}`);
      const data = res.data || res;
      if (data.success) setNextNumber(data.data.next_number);
    } catch (e) { 
      console.error('Fetch next number error:', e);
    }
  };

  useEffect(() => { fetchVouchers(); }, [fetchVouchers]);
  useEffect(() => { fetchBankAccounts(); fetchPartyLists(); fetchSummary(); }, []);
  useEffect(() => {
    if (showModal) fetchNextNumber(form.voucher_type, form.voucher_date);
  }, [form.voucher_type, form.voucher_date, showModal]);

  const resetForm = () => {
    setForm({
      voucher_type: 'cash_payment', voucher_date: new Date().toISOString().split('T')[0],
      amount: '', debit_account_id: '', credit_account_id: '',
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
    if (submitting) return;
    setError(''); setSuccess('');
    
    if (form.debit_account_id && form.credit_account_id && form.debit_account_id === form.credit_account_id) {
      setError('Debit and credit accounts cannot be the same');
      return;
    }
    
    try {
      setSubmitting(true);
      const url = editingVoucher ? `/vouchers/${editingVoucher.id}` : `/vouchers`;
      const method = editingVoucher ? 'PUT' : 'POST';
      const body = {
        ...form,
        amount: parseFloat(form.amount),
        debit_account_id: form.debit_account_id ? parseInt(form.debit_account_id) : null,
        credit_account_id: form.credit_account_id ? parseInt(form.credit_account_id) : null,
        party_id: form.party_id ? parseInt(form.party_id) : null,
        reference_id: form.reference_id ? parseInt(form.reference_id) : null,
      };
      const res = await api.request({ url, method, data: body });
      const data = res.data || res;
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
      setError(e.response?.data?.message || 'Failed to save voucher');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (id) => {
    try {
      const res = await api.post(`/vouchers/${id}/approve`);
      const data = res.data || res;
      if (data.success) {
        setSuccess(data.message);
        fetchVouchers();
        fetchSummary();
      } else setError(data.message);
    } catch (e) { 
      setError(e.response?.data?.message || 'Failed to approve voucher');
    }
  };

  const handleCancel = async () => {
    if (!cancelReason.trim()) { setError('Cancellation reason is required'); return; }
    try {
      const res = await api.post(`/vouchers/${cancelModal.id}/cancel`, { reason: cancelReason });
      const data = res.data || res;
      if (data.success) {
        setSuccess(data.message);
        setCancelModal(null);
        setCancelReason('');
        fetchVouchers();
        fetchSummary();
      } else setError(data.message);
    } catch (e) { 
      setError(e.response?.data?.message || 'Failed to cancel voucher');
    }
  };

  const handleBulkApprove = async () => {
    const pendingIds = vouchers.filter(v => v.status === 'pending_approval').map(v => v.id);
    if (pendingIds.length === 0) return;
    try {
      const res = await api.post(`/vouchers/bulk-approve`, { voucher_ids: pendingIds });
      const data = res.data || res;
      if (data.success) { setSuccess(data.message); fetchVouchers(); fetchSummary(); }
      else setError(data.message);
    } catch (e) { 
      setError(e.response?.data?.message || 'Failed to bulk approve');
    }
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

  const fmt = (n) => {
    const num = Number(n || 0);
    if (isNaN(num)) return '₹0';
    return num < 0 
      ? `(₹${Math.abs(num).toLocaleString('en-IN', { maximumFractionDigits: 0 })})` 
      : `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  };

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
          {canApprove && pendingCount > 0 && (
            <button onClick={handleBulkApprove} style={{
              padding: '8px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              background: '#f59e0b', color: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px'
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
              <div key={vt.key} onClick={() => { setActiveType(activeType === vt.key ? '' : vt.key); setPage(0); }}
                title={`Total amount for all ${vt.label}s`}
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
          <input type="text" placeholder="Search vouchers..." value={searchTerm} onChange={e => {
            if (e.target.value.length > 100) return;
            setSearchTerm(e.target.value);
            setPage(0);
          }}
            style={{ width: '100%', padding: '8px 8px 8px 34px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', minWidth: '140px' }}>
          <option value="">All Status</option>
          <option value="pending_approval">Pending Approval</option>
          <option value="posted">Posted</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(0); }}
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
        <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(0); }}
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
        <button onClick={() => { setActiveType(''); setStatusFilter(''); setFromDate(''); setToDate(''); setSearchTerm(''); setPage(0); }}
          style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <RefreshCw size={14} /> Reset
        </button>
      </div>

      {/* Vouchers Table */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ ...thStyle, width: '120px' }}>Voucher #</th>
                <th style={{ ...thStyle, width: '120px' }}>Type</th>
                <th style={{ ...thStyle, width: '100px' }}>Date</th>
                <th style={{ ...thStyle, minWidth: '150px' }}>Party</th>
                <th style={{ ...thStyle, textAlign: 'right', width: '100px' }}>Amount</th>
                <th style={{ ...thStyle, maxWidth: '200px' }}>Narration</th>
                <th style={{ ...thStyle, width: '100px' }}>Status</th>
                {canView && <th style={{ ...thStyle, textAlign: 'center', width: '100px' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Loading vouchers...</td></tr>
              ) : vouchers.length === 0 ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>No vouchers found</td></tr>
              ) : vouchers.map(v => {
                const typeConfig = VOUCHER_TYPES.find(t => t.key === v.voucher_type);
                const statusCfg = STATUS_CONFIG[v.status];
                const StatusIcon = statusCfg?.icon || Clock;
                return (
                  <tr key={v.id} style={{ borderBottom: '1px solid #f1f5f9' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
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
                          {v.status === 'draft' && canEdit && (
                            <button onClick={() => openEditModal(v)} title="Edit"
                              style={{ ...actionBtnStyle, color: '#3b82f6' }}>✏️</button>
                          )}
                          {['draft', 'pending_approval'].includes(v.status) && canDelete && (
                            <button onClick={() => setCancelModal(v)} title="Cancel"
                              style={{ ...actionBtnStyle, color: '#ef4444' }}><XCircle size={14} /></button>
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
        {/* Pagination controls */}
        {total > limit && (
          <div style={{ padding: '12px 16px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: '#64748b' }}>
            <span>Showing {page * limit + 1} to {Math.min((page + 1) * limit, total)} of {total} entries</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', background: page === 0 ? '#f1f5f9' : '#fff', cursor: page === 0 ? 'not-allowed' : 'pointer', color: '#475569' }}>Previous</button>
              <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * limit >= total}
                style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', background: (page + 1) * limit >= total ? '#f1f5f9' : '#fff', cursor: (page + 1) * limit >= total ? 'not-allowed' : 'pointer', color: '#475569' }}>Next</button>
            </div>
          </div>
        )}
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
                  <select value={form.voucher_type} onChange={e => setForm(f => ({ ...f, voucher_type: e.target.value }))}
                    disabled={!!editingVoucher} title={editingVoucher ? "Voucher type cannot be changed after creation" : ""} style={inputStyle}>
                    {VOUCHER_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
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
                <div>
                  <label style={labelStyle}>Debit Account (Money To)</label>
                  <select value={form.debit_account_id} onChange={e => setForm(f => ({ ...f, debit_account_id: e.target.value }))}
                    style={inputStyle}>
                    <option value="">— Select —</option>
                    {bankAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.account_name} ({a.account_type})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Credit Account (Money From)</label>
                  <select value={form.credit_account_id} onChange={e => setForm(f => ({ ...f, credit_account_id: e.target.value }))}
                    style={inputStyle}>
                    <option value="">— Select —</option>
                    {bankAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.account_name} ({a.account_type})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Party Type</label>
                  <select value={form.party_type} onChange={e => setForm(f => ({ ...f, party_type: e.target.value, party_id: '', party_name: '' }))}
                    style={inputStyle}>
                    <option value="">— None —</option>
                    <option value="client">Client</option>
                    <option value="employee">Employee</option>
                    <option value="vendor">Vendor</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                {form.party_type && form.party_type !== 'other' && (
                  <div>
                    <label style={labelStyle}>Select Party</label>
                    <select value={form.party_id} onChange={e => handlePartyChange(e.target.value)} style={inputStyle}>
                      <option value="">{loadingParties ? 'Loading...' : '— Select —'}</option>
                      {getPartyList().map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                )}
                {form.party_type === 'other' && (
                  <div>
                    <label style={labelStyle}>Party Name</label>
                    <input type="text" value={form.party_name} onChange={e => setForm(f => ({ ...f, party_name: e.target.value }))}
                      placeholder="Enter name" style={inputStyle} />
                  </div>
                )}
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
                {['bank_payment', 'bank_receipt', 'contra'].includes(form.voucher_type) && (
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
                  disabled={submitting}
                  className={`px-5 py-2 rounded-lg border-none ${submitting ? 'bg-teal-400 cursor-wait' : 'cursor-pointer bg-teal-600 hover:bg-teal-700'} text-white font-semibold transition-colors text-sm`}
                >
                  <Send size={14} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                  {submitting ? 'Submitting...' : editingVoucher ? 'Update' : 'Submit for Approval'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
