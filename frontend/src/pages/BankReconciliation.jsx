import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Landmark, CheckCircle, XCircle, Calendar, RefreshCw, FileText, AlertCircle } from 'lucide-react';

import api from '../services/api';

export default function BankReconciliation() {
  const { token } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [brs, setBrs] = useState(null);
  const [loadingEntries, setLoadingEntries] = useState(false); // L8: Separate loading states
  const [loadingBRS, setLoadingBRS] = useState(false);
  const [reconciling, setReconciling] = useState(false); // H7, M8: Loading state for reconciliation
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showReconciled, setShowReconciled] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all'); // L2: Drill down from summary
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
      if (res.success) {
        // M4: Filter inactive accounts
        const activeAccounts = res.data.filter(a => a.is_active !== 0 && a.is_active !== false);
        setAccounts(activeAccounts);
        if (!selectedAccount && activeAccounts.length > 0) {
          // Select first bank-type account by default
          const bankAcc = activeAccounts.find(a => a.account_type === 'bank');
          setSelectedAccount(bankAcc?.id || activeAccounts[0].id);
        }
      }
    } catch (e) { setError('Failed to fetch bank accounts'); }
  };

  const fetchEntries = async () => {
    if (!selectedAccount) return;
    setLoadingEntries(true); setError('');
    try {
      const params = new URLSearchParams();
      if (fromDate) params.append('from_date', fromDate);
      if (toDate) params.append('to_date', toDate);
      if (showReconciled) params.append('show_reconciled', 'true');
      const res = await api.get(`/bank-reconciliation/${selectedAccount}?${params}`);
      
      if (res.success) {
        setEntries(res.data.entries);
        setSummary(res.data.summary);
      } else {
        setError(res.message);
      }
    } catch (e) { 
      // H3: Better error handling
      console.error('Fetch entries error:', e);
      setError(e.response?.data?.message || e.message || 'Failed to fetch entries'); 
    }
    setLoadingEntries(false);
  };

  const fetchBRS = async () => {
    if (!selectedAccount) return;
    setLoadingBRS(true); setError('');
    try {
      const params = new URLSearchParams();
      if (toDate) params.append('as_on_date', toDate);
      const res = await api.get(`/bank-reconciliation/statement/${selectedAccount}?${params}`);
      if (res.success) setBrs(res.data);
      else setError(res.message);
    } catch (e) { 
      console.error('Fetch BRS error:', e);
      setError(e.message || 'Failed to fetch BRS'); 
    }
    setLoadingBRS(false);
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
    // C4, H5: Validate bank statement date (using toDate as proxy)
    if (!toDate) { setError('Bank statement date (To Date) is required to reconcile'); return; }
    
    setReconciling(true); // H7
    try {
      const entriesToReconcile = Array.from(selectedEntries).map(vid => ({
        voucher_id: vid,
        bank_account_id: parseInt(selectedAccount),
        bank_statement_date: toDate,
      }));
      const res = await api.post(`/bank-reconciliation/reconcile`, { entries: entriesToReconcile });
      
      if (res.success) {
        setSuccess(res.message);
        setSelectedEntries(new Set());
        fetchEntries();
      } else setError(res.message);
    } catch (e) { 
      console.error(e);
      setError(e.message || 'Failed to reconcile'); 
    } finally {
      setReconciling(false);
    }
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

  const handleAddAccount = async (e) => {
    e.preventDefault();
    
    // C6: Modal validation
    if (accountForm.opening_balance && !accountForm.opening_balance_date) {
      setError('Opening balance date required when opening balance is specified');
      return;
    }
    if (accountForm.opening_balance_date && new Date(accountForm.opening_balance_date) > new Date()) {
      setError('Opening date cannot be in the future');
      return;
    }
    
    // L6: IFSC validation
    if (accountForm.account_type === 'bank' && accountForm.ifsc_code && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(accountForm.ifsc_code)) {
      setError('Invalid IFSC format (e.g. HDFC0001234)');
      return;
    }

    try {
      const res = await api.post(`/bank-accounts`, {
        ...accountForm,
        opening_balance: parseFloat(accountForm.opening_balance) || 0
      });
      if (res.success) {
        setSuccess('Bank account added');
        setShowAddAccount(false);
        setAccountForm({ account_name: '', account_type: 'bank', account_number: '', bank_name: '', ifsc_code: '', branch: '', opening_balance: 0, opening_balance_date: '' });
        fetchAccounts();
      } else setError(res.message);
    } catch (e) { setError('Failed to add account'); }
    setTimeout(() => setSuccess(''), 3000);
  };

  // M2: Handle NaN in fmt
  const fmt = (n) => {
    const num = parseFloat(n || 0);
    if (isNaN(num)) return '₹0';
    if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)}Cr`;
    return num.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  };
  
  const currentAccount = accounts.find(a => a.id === parseInt(selectedAccount));

  // Filter entries based on statusFilter (L2)
  const filteredEntries = entries.filter(e => {
    if (statusFilter === 'reconciled') return e.is_reconciled;
    if (statusFilter === 'unreconciled') return !e.is_reconciled;
    return true;
  });

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* L4: Print CSS */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
          .print-container { max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
        }
      `}</style>
      
      {/* Header */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
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
      <div className="no-print">
        {error && <div style={{ padding: '10px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: '8px', marginBottom: '12px' }}>{error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}>✕</button></div>}
        {success && <div style={{ padding: '10px 16px', background: '#f0fdf4', color: '#16a34a', borderRadius: '8px', marginBottom: '12px' }}>{success}</div>}
      </div>

      {/* Account Selector + Filters */}
      <div className="no-print" style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
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
      </div>

      {/* Current Account Summary */}
      {summary && activeTab === 'reconcile' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          {[
            { label: 'Book Balance', value: fmt(summary.book_balance), color: '#0f3460', filter: 'all' },
            { label: 'Total Entries', value: summary.total_entries, color: '#6366f1', filter: 'all' },
            { label: 'Reconciled', value: summary.reconciled_count, color: '#22c55e', filter: 'reconciled' },
            { label: 'Unreconciled', value: summary.unreconciled_count, color: '#f59e0b', filter: 'unreconciled' },
          ].map((c, i) => (
            <div key={i} onClick={() => setStatusFilter(c.filter)} style={{ // L2: drill-down
              padding: '14px', borderRadius: '10px', background: statusFilter === c.filter ? '#f8fafc' : '#fff',
              border: `1px solid ${statusFilter === c.filter ? c.color : '#e2e8f0'}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              cursor: 'pointer', transition: 'all 0.2s'
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {!toDate && <span style={{ fontSize: '12px', color: '#dc2626' }}>Select 'To Date' first</span>}
                <button 
                  onClick={handleReconcile} 
                  disabled={reconciling || !toDate}
                  className={`px-5 py-2 rounded-lg border-none font-semibold transition-colors text-sm flex items-center ${
                    reconciling || !toDate ? 'bg-teal-300 text-teal-50 cursor-not-allowed' : 'bg-teal-600 hover:bg-teal-700 text-white cursor-pointer'
                  }`}
                >
                  {reconciling ? <RefreshCw size={14} className="animate-spin" style={{ marginRight: '6px' }} /> : <CheckCircle size={14} style={{ verticalAlign: 'middle', marginRight: '6px' }} />}
                  {reconciling ? 'Reconciling...' : 'Reconcile Selected'}
                </button>
              </div>
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
                  {loadingEntries ? (
                    <tr><td colSpan="10" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Loading entries...</td></tr>
                  ) : filteredEntries.length === 0 ? (
                    <tr><td colSpan="10" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                      {!selectedAccount ? 'Select a bank account to begin' : 'No entries found matching filters'}
                    </td></tr>
                  ) : filteredEntries.map(entry => (
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
                        {entry.is_reconciled && (
                          <button onClick={() => handleUnreconcile([entry.id])}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '12px' }}>
                            Undo
                          </button>
                        )}
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
      {activeTab === 'brs' && (
        loadingBRS ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>Loading BRS statement...</div>
        ) : brs && (
        <div className="print-container" style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ padding: '20px', background: 'linear-gradient(135deg, #0f3460, #16213e)', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Bank Reconciliation Statement</h2>
              <p style={{ margin: '4px 0 0', opacity: 0.8, fontSize: '13px' }}>
                {brs.account.account_name} — As on {new Date(brs.as_on_date).toLocaleDateString('en-IN')}
              </p>
            </div>
            <button 
              onClick={() => window.print()}
              className="no-print px-3 py-1.5 rounded-lg border-none cursor-pointer bg-white/20 hover:bg-white/30 text-white font-semibold transition-colors text-xs flex items-center gap-1"
            >
              Print BRS
            </button>
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
                    <strong style={{ color: '#16a34a' }}>Add:</strong> Cheques Issued (Expenses) Not Yet Presented
                    <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '6px' }}>({brs.cheques_not_presented.items.length} items)</span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', color: '#16a34a' }}>
                    + {fmt(brs.cheques_not_presented.total)}
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#fef2f2' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <strong style={{ color: '#dc2626' }}>Less:</strong> Deposits Received (Income) Not Yet Cleared
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
                <h3 style={{ fontSize: '14px', color: '#16a34a', marginBottom: '8px' }}>Cheques Issued (Expenses) Not Yet Presented</h3>
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
                <h3 style={{ fontSize: '14px', color: '#dc2626', marginBottom: '8px' }}>Deposits Received (Income) Not Yet Cleared</h3>
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
        )
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
