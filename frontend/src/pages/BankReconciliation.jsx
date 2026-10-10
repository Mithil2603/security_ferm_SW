import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Landmark, CheckCircle, XCircle, Calendar, RefreshCw, FileText, AlertCircle, Download, Trash2 } from 'lucide-react';

import api from '../services/api';
import { getApiBaseUrl } from '../utils/apiUrl';
import { confirmDialog } from '../context/ToastContext';

export default function BankReconciliation() {
  const { token } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [brs, setBrs] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showReconciled, setShowReconciled] = useState(false);
  const [selectedEntries, setSelectedEntries] = useState(new Set());
  const [activeTab, setActiveTab] = useState('reconcile'); // 'reconcile' | 'brs'

  // Bank account management
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [accountForm, setAccountForm] = useState({
    account_name: '', account_type: 'bank', account_number: '',
    bank_name: '', ifsc_code: '', branch: '', opening_balance: 0, opening_balance_date: ''
  });

  
  const fetchAccounts = async () => {
    try {
      const res = await api.get(`/bank-accounts?active_only=true`);
      const data = res;
      if (data.success) {
        setAccounts(data.data);
        if (!selectedAccount && data.data.length > 0) {
          // Select first bank-type account by default
          const bankAcc = data.data.find(a => a.account_type === 'bank');
          setSelectedAccount(bankAcc?.id || data.data[0].id);
        }
      }
    } catch (e) { setError('Failed to fetch bank accounts'); }
  };

  const fetchEntries = async () => {
    if (!selectedAccount) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (fromDate) params.append('from_date', fromDate);
      if (toDate) params.append('to_date', toDate);
      if (showReconciled) params.append('show_reconciled', 'true');
      const res = await api.get(`/bank-reconciliation/${selectedAccount}?${params}`);
      const data = res;
      if (data.success) {
        setEntries(data.data.entries);
        setSummary(data.data.summary);
      } else setError(data.message);
    } catch (e) { setError('Failed to fetch entries'); }
    setLoading(false);
  };

  const fetchBRS = async () => {
    if (!selectedAccount) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (toDate) params.append('as_on_date', toDate);
      const res = await api.get(`/bank-reconciliation/statement/${selectedAccount}?${params}`);
      const data = res;
      if (data.success) setBrs(data.data);
      else setError(data.message);
    } catch (e) { setError('Failed to fetch BRS'); }
    setLoading(false);
  };

  useEffect(() => { fetchAccounts(); }, []);
  useEffect(() => {
    if (selectedAccount) {
      if (activeTab === 'reconcile') fetchEntries();
      else fetchBRS();
    }
  }, [selectedAccount, fromDate, toDate, showReconciled, activeTab]);

  const toggleEntry = (voucherId) => {
    setSelectedEntries(prev => {
      const next = new Set(prev);
      if (next.has(voucherId)) next.delete(voucherId);
      else next.add(voucherId);
      return next;
    });
  };

  const selectAll = () => {
    const unreconciled = entries.filter(e => !e.is_reconciled);
    if (selectedEntries.size === unreconciled.length) {
      setSelectedEntries(new Set());
    } else {
      setSelectedEntries(new Set(unreconciled.map(e => e.id)));
    }
  };

  const handleReconcile = async () => {
    if (selectedEntries.size === 0) { setError('Select entries to reconcile'); return; }
    try {
      const entriesToReconcile = Array.from(selectedEntries).map(vid => ({
        voucher_id: vid,
        bank_account_id: parseInt(selectedAccount),
        bank_statement_date: toDate || new Date().toISOString().split('T')[0],
      }));
      const res = await api.post(`/bank-reconciliation/reconcile`, { entries: entriesToReconcile });
      const data = res;
      if (data.success) {
        setSuccess(data.message);
        setSelectedEntries(new Set());
        fetchEntries();
      } else setError(data.message);
    } catch (e) { setError('Failed to reconcile'); }
    setTimeout(() => setSuccess(''), 3000);
  };

  const handleUnreconcile = async (voucherIds) => {
    try {
      const res = await api.post(`/bank-reconciliation/unreconcile`, {
        voucher_ids: voucherIds, bank_account_id: parseInt(selectedAccount) 
      });
      const data = res;
      if (data.success) { setSuccess(data.message); fetchEntries(); }
      else setError(data.message);
    } catch (e) { setError('Failed to unreconcile'); }
    setTimeout(() => setSuccess(''), 3000);
  };

  // Delete an entry (voucher). The backend refuses payment-created vouchers
  // (delete the payment in Bank & Payments) and reconciled ones (Undo first).
  const handleDeleteEntry = async (entry) => {
    const confirmed = await confirmDialog({
      title: 'Delete Entry',
      message: `Permanently delete ${entry.voucher_number} for ${fmt(entry.amount)}? The voucher is removed and the book balance adjusts. This cannot be undone.`,
      confirmText: 'Delete Permanently',
      variant: 'danger',
    });
    if (!confirmed) return;
    setError('');
    try {
      const data = await api.delete(`/bank-reconciliation/entry/${entry.id}`);
      if (data.success) {
        setSuccess(data.message);
        setSelectedEntries(prev => { const next = new Set(prev); next.delete(entry.id); return next; });
        fetchEntries();
        fetchAccounts();
      } else setError(data.message);
    } catch (e) { setError(e.response?.data?.message || e.message || 'Failed to delete entry'); }
    setTimeout(() => setSuccess(''), 3000);
  };

  // Excel / PDF download of whichever tab is open: the reconciliation list (with
  // the current dates / show-reconciled filter) or the BRS as on the To date.
  const handleDownload = (format) => {
    if (!selectedAccount) { setError('Select a bank account first'); return; }
    const params = new URLSearchParams({ format });
    let path;
    if (activeTab === 'brs') {
      path = `export/statement/${selectedAccount}`;
      if (toDate) params.set('as_on_date', toDate);
    } else {
      path = `export/entries/${selectedAccount}`;
      if (fromDate) params.set('from_date', fromDate);
      if (toDate) params.set('to_date', toDate);
      if (showReconciled) params.set('show_reconciled', 'true');
    }
    const authToken = localStorage.getItem('token') || sessionStorage.getItem('token');
    if (authToken) params.set('token', authToken);
    window.open(`${getApiBaseUrl()}/bank-reconciliation/${path}?${params.toString()}`, '_blank');
  };

  const handleAddAccount = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post(`/bank-accounts`, {
        ...accountForm,
        opening_balance: parseFloat(accountForm.opening_balance) || 0
      });
      const data = res;
      if (data.success) {
        setSuccess('Bank account added');
        setShowAddAccount(false);
        setAccountForm({ account_name: '', account_type: 'bank', account_number: '', bank_name: '', ifsc_code: '', branch: '', opening_balance: 0, opening_balance_date: '' });
        fetchAccounts();
      } else setError(data.message);
    } catch (e) { setError('Failed to add account'); }
    setTimeout(() => setSuccess(''), 3000);
  };

  const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const currentAccount = accounts.find(a => a.id === parseInt(selectedAccount));

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#1e293b', margin: 0 }}>
            <Landmark size={24} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
            Bank Reconciliation
          </h1>
          <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>
            Match book entries with bank statement
          </p>
        </div>
        <button 
          onClick={() => setShowAddAccount(true)} 
          className="px-4 py-2 rounded-lg border-none cursor-pointer bg-teal-600 hover:bg-teal-700 text-white font-semibold flex items-center gap-2 transition-colors text-sm"
        >
          + Add Bank Account
        </button>
      </div>

      {/* Alerts */}
      {error && <div style={{ padding: '10px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: '8px', marginBottom: '12px' }}>{error}
        <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}>✕</button></div>}
      {success && <div style={{ padding: '10px 16px', background: '#f0fdf4', color: '#16a34a', borderRadius: '8px', marginBottom: '12px' }}>{success}</div>}

      {/* Account Selector + Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}
          style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', minWidth: '250px', fontWeight: 600 }}>
          <option value="">Select Bank Account</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>
              {a.account_type === 'bank' ? '🏦' : '💰'} {a.account_name} {a.account_number ? `(${a.account_number})` : ''}
              — Bal: {fmt(a.current_balance)}
            </option>
          ))}
        </select>
        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} placeholder="From"
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} placeholder="To"
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#64748b', cursor: 'pointer' }}>
          <input type="checkbox" checked={showReconciled} onChange={e => setShowReconciled(e.target.checked)} />
          Show Reconciled
        </label>

        {/* Tabs */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', background: '#f1f5f9', padding: '3px', borderRadius: '8px' }}>
          {['reconcile', 'brs'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer',
              background: activeTab === tab ? '#fff' : 'transparent',
              color: activeTab === tab ? '#6366f1' : '#64748b',
              fontWeight: activeTab === tab ? 600 : 400, fontSize: '13px',
              boxShadow: activeTab === tab ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
            }}>
              {tab === 'reconcile' ? 'Reconcile' : 'BRS Statement'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => handleDownload('xlsx')} disabled={!selectedAccount}
            title={activeTab === 'brs' ? 'Download BRS statement as Excel' : 'Download entries as Excel'}
            style={{ padding: '7px 12px', borderRadius: '8px', border: 'none', background: '#15803d', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', opacity: selectedAccount ? 1 : 0.5 }}>
            <Download size={14} /> Excel
          </button>
          <button onClick={() => handleDownload('pdf')} disabled={!selectedAccount}
            title={activeTab === 'brs' ? 'Download BRS statement as PDF' : 'Download entries as PDF'}
            style={{ padding: '7px 12px', borderRadius: '8px', border: 'none', background: '#1e293b', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', opacity: selectedAccount ? 1 : 0.5 }}>
            <Download size={14} /> PDF
          </button>
        </div>
      </div>

      {/* Current Account Summary */}
      {summary && activeTab === 'reconcile' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          {[
            { label: 'Book Balance', value: fmt(summary.book_balance), color: '#0f3460' },
            { label: 'Total Entries', value: summary.total_entries, color: '#6366f1' },
            { label: 'Reconciled', value: summary.reconciled_count, color: '#22c55e' },
            { label: 'Unreconciled', value: summary.unreconciled_count, color: '#f59e0b' },
          ].map((c, i) => (
            <div key={i} style={{
              padding: '14px', borderRadius: '10px', background: '#fff',
              border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
            }}>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>{c.label}</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: c.color, marginTop: '4px' }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Reconcile Tab */}
      {activeTab === 'reconcile' && (
        <>
          {selectedEntries.size > 0 && (
            <div style={{
              padding: '10px 16px', background: '#eef2ff', borderRadius: '8px', marginBottom: '12px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <span style={{ fontWeight: 600, color: '#6366f1' }}>{selectedEntries.size} entries selected</span>
              <button 
                onClick={handleReconcile} 
                className="px-5 py-2 rounded-lg border-none cursor-pointer bg-teal-600 hover:bg-teal-700 text-white font-semibold transition-colors text-sm"
              >
                <CheckCircle size={14} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                Reconcile Selected
              </button>
            </div>
          )}

          <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    <th style={{ ...thStyle, width: '40px' }}>
                      <input type="checkbox" checked={selectedEntries.size > 0 && selectedEntries.size === entries.filter(e => !e.is_reconciled).length}
                        onChange={selectAll} />
                    </th>
                    <th style={thStyle}>Voucher #</th>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Party</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Debit</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Credit</th>
                    <th style={thStyle}>Cheque/Ref</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="10" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Loading...</td></tr>
                  ) : entries.length === 0 ? (
                    <tr><td colSpan="10" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                      {!selectedAccount ? 'Select a bank account to begin' : 'No entries found'}
                    </td></tr>
                  ) : entries.map(entry => (
                    <tr key={entry.id} style={{ borderBottom: '1px solid #f1f5f9', background: entry.is_reconciled ? '#f0fdf4' : 'transparent' }}>
                      <td style={tdStyle}>
                        {!entry.is_reconciled && (
                          <input type="checkbox" checked={selectedEntries.has(entry.id)} onChange={() => toggleEntry(entry.id)} />
                        )}
                      </td>
                      <td style={tdStyle}><span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{entry.voucher_number}</span></td>
                      <td style={tdStyle}>{new Date(entry.voucher_date).toLocaleDateString('en-IN')}</td>
                      <td style={tdStyle}><span style={{ fontSize: '11px', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>{entry.voucher_type.replace(/_/g, ' ')}</span></td>
                      <td style={tdStyle}>{entry.party_name || '-'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', color: '#22c55e' }}>
                        {entry.debit_amount > 0 ? fmt(entry.debit_amount) : '-'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', color: '#ef4444' }}>
                        {entry.credit_amount > 0 ? fmt(entry.credit_amount) : '-'}
                      </td>
                      <td style={tdStyle}>{entry.cheque_number || entry.transaction_ref || '-'}</td>
                      <td style={tdStyle}>
                        <span style={{
                          padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                          background: entry.is_reconciled ? '#dcfce7' : '#fef3c7',
                          color: entry.is_reconciled ? '#16a34a' : '#d97706'
                        }}>
                          {entry.is_reconciled ? '✓ Reconciled' : 'Pending'}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {entry.is_reconciled && (
                            <button onClick={() => handleUnreconcile([entry.id])}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '12px' }}>
                              Undo
                            </button>
                          )}
                          <button onClick={() => handleDeleteEntry(entry)} title="Delete entry"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: '2px', display: 'flex' }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* BRS Statement Tab */}
      {activeTab === 'brs' && brs && (
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ padding: '20px', background: 'linear-gradient(135deg, #0f3460, #16213e)', color: '#fff' }}>
            <h2 style={{ margin: 0, fontSize: '18px' }}>Bank Reconciliation Statement</h2>
            <p style={{ margin: '4px 0 0', opacity: 0.8, fontSize: '13px' }}>
              {brs.account.account_name} — As on {new Date(brs.as_on_date).toLocaleDateString('en-IN')}
            </p>
          </div>
          <div style={{ padding: '24px' }}>
            {/* Summary table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', maxWidth: '600px', margin: '0 auto' }}>
              <tbody>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>Balance as per Cash Book</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', fontSize: '16px' }}>
                    {fmt(brs.book_balance)}
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f0fdf4' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <strong style={{ color: '#16a34a' }}>Add:</strong> Cheques issued but not yet presented
                    <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '6px' }}>({brs.cheques_not_presented.items.length} items)</span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', color: '#16a34a' }}>
                    + {fmt(brs.cheques_not_presented.total)}
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#fef2f2' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <strong style={{ color: '#dc2626' }}>Less:</strong> Deposits in transit / not yet credited
                    <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '6px' }}>({brs.deposits_not_cleared.items.length} items)</span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', color: '#dc2626' }}>
                    - {fmt(brs.deposits_not_cleared.total)}
                  </td>
                </tr>
                <tr style={{ borderTop: '3px solid #0f3460', background: '#f0f9ff' }}>
                  <td style={{ padding: '14px 16px', fontWeight: 700, fontSize: '15px', color: '#0f3460' }}>
                    Balance as per Bank Statement
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', fontSize: '18px', color: '#0f3460' }}>
                    {fmt(brs.bank_balance)}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Detail sections */}
            {brs.cheques_not_presented.items.length > 0 && (
              <div style={{ marginTop: '24px' }}>
                <h3 style={{ fontSize: '14px', color: '#16a34a', marginBottom: '8px' }}>Cheques Not Yet Presented</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={thStyleSm}>Voucher #</th><th style={thStyleSm}>Date</th><th style={thStyleSm}>Cheque</th>
                      <th style={thStyleSm}>Narration</th><th style={{ ...thStyleSm, textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brs.cheques_not_presented.items.map(item => (
                      <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={tdStyleSm}>{item.voucher_number}</td>
                        <td style={tdStyleSm}>{new Date(item.voucher_date).toLocaleDateString('en-IN')}</td>
                        <td style={tdStyleSm}>{item.cheque_number || '-'}</td>
                        <td style={tdStyleSm}>{item.narration || '-'}</td>
                        <td style={{ ...tdStyleSm, textAlign: 'right', fontFamily: 'monospace' }}>{fmt(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {brs.deposits_not_cleared.items.length > 0 && (
              <div style={{ marginTop: '24px' }}>
                <h3 style={{ fontSize: '14px', color: '#dc2626', marginBottom: '8px' }}>Deposits Not Yet Cleared</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={thStyleSm}>Voucher #</th><th style={thStyleSm}>Date</th><th style={thStyleSm}>Ref</th>
                      <th style={thStyleSm}>Narration</th><th style={{ ...thStyleSm, textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brs.deposits_not_cleared.items.map(item => (
                      <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={tdStyleSm}>{item.voucher_number}</td>
                        <td style={tdStyleSm}>{new Date(item.voucher_date).toLocaleDateString('en-IN')}</td>
                        <td style={tdStyleSm}>{item.cheque_number || '-'}</td>
                        <td style={tdStyleSm}>{item.narration || '-'}</td>
                        <td style={{ ...tdStyleSm, textAlign: 'right', fontFamily: 'monospace' }}>{fmt(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Bank Account Modal */}
      {showAddAccount && (
        <div style={overlayStyle} onClick={() => setShowAddAccount(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: '18px', color: '#1e293b' }}>Add Bank/Cash Account</h2>
            <form onSubmit={handleAddAccount}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={labelStyle}>Account Name *</label>
                  <input type="text" required value={accountForm.account_name}
                    onChange={e => setAccountForm(f => ({ ...f, account_name: e.target.value }))}
                    placeholder="e.g. HDFC Current A/C" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Account Type *</label>
                  <select value={accountForm.account_type}
                    onChange={e => setAccountForm(f => ({ ...f, account_type: e.target.value }))}
                    style={inputStyle}>
                    <option value="bank">Bank Account</option>
                    <option value="cash">Cash Account</option>
                  </select>
                </div>
                {accountForm.account_type === 'bank' && (
                  <>
                    <div>
                      <label style={labelStyle}>Account Number</label>
                      <input type="text" value={accountForm.account_number}
                        onChange={e => setAccountForm(f => ({ ...f, account_number: e.target.value }))}
                        placeholder="A/C Number" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Bank Name</label>
                      <input type="text" value={accountForm.bank_name}
                        onChange={e => setAccountForm(f => ({ ...f, bank_name: e.target.value }))}
                        placeholder="e.g. HDFC Bank" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>IFSC Code</label>
                      <input type="text" value={accountForm.ifsc_code}
                        onChange={e => setAccountForm(f => ({ ...f, ifsc_code: e.target.value }))}
                        placeholder="HDFC0001234" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Branch</label>
                      <input type="text" value={accountForm.branch}
                        onChange={e => setAccountForm(f => ({ ...f, branch: e.target.value }))}
                        placeholder="Branch name" style={inputStyle} />
                    </div>
                  </>
                )}
                <div>
                  <label style={labelStyle}>Opening Balance (₹)</label>
                  <input type="number" step="0.01" value={accountForm.opening_balance}
                    onChange={e => setAccountForm(f => ({ ...f, opening_balance: e.target.value }))}
                    style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Opening Balance Date</label>
                  <input type="date" value={accountForm.opening_balance_date}
                    onChange={e => setAccountForm(f => ({ ...f, opening_balance_date: e.target.value }))}
                    style={inputStyle} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
                <button 
                  type="button" 
                  onClick={() => setShowAddAccount(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors text-sm cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-5 py-2 rounded-lg border-none cursor-pointer bg-teal-600 hover:bg-teal-700 text-white font-semibold transition-colors text-sm"
                >Save Account</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle = { padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' };
const tdStyle = { padding: '8px 12px', color: '#334155' };
const thStyleSm = { padding: '6px 10px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#64748b', borderBottom: '1px solid #e2e8f0' };
const tdStyleSm = { padding: '6px 10px', color: '#334155' };
const overlayStyle = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' };
const modalStyle = { background: '#fff', borderRadius: '16px', padding: '24px', maxWidth: '600px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' };
const labelStyle = { display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' };
const inputStyle = { width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', boxSizing: 'border-box' };
