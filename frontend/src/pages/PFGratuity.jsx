import { useState, useEffect } from 'react';
import { Shield, Users, Banknote, TrendingUp, Award, Plus, Zap, Eye, X } from 'lucide-react';
import api from '../services/api';
import TableSkeleton from '../components/TableSkeleton';

export default function PFGratuity() {
  const [tab, setTab] = useState('pf'); // pf | gratuity
  const [pfAccounts, setPfAccounts] = useState([]);
  const [liabilityReport, setLiabilityReport] = useState(null);
  const [pfLoading, setPfLoading] = useState(true);
  const [gratuityLoading, setGratuityLoading] = useState(true);
  const [error, setError] = useState('');

  // Modals
  const [isCreatePfOpen, setIsCreatePfOpen] = useState(false);
  const [isViewPfOpen, setIsViewPfOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [pfForm, setPfForm] = useState({ employee_id: '', uan_number: '', pf_number: '' });
  const [submitting, setSubmitting] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const prevMonth = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7);
  const [batchModal, setBatchModal] = useState({ open: false, type: 'pf', month: prevMonth });
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchResult, setBatchResult] = useState(null);

  const [employeesList, setEmployeesList] = useState([]);
  
  useEffect(() => {
    if (isCreatePfOpen && employeesList.length === 0) {
      api.get('/employees?limit=1000').then(res => setEmployeesList(res.data.data || [])).catch(() => {});
    }
  }, [isCreatePfOpen]);

  const fetchPfAccounts = async () => {
    try {
      setPfLoading(true);
      setError('');
      const res = await api.get('/pf-gratuity/pf/accounts?limit=100');
      setPfAccounts(res.data.data || []);
    } catch { 
      setPfAccounts([]); 
      setError('Failed to load PF accounts. Please try again.');
    } finally { 
      setPfLoading(false); 
    }
  };

  const fetchLiability = async () => {
    try {
      setGratuityLoading(true);
      setError('');
      const res = await api.get('/pf-gratuity/gratuity/liability-report');
      setLiabilityReport(res.data.data);
    } catch { 
      setLiabilityReport(null); 
      setError('Failed to load Gratuity liability report. Please try again.');
    } finally { 
      setGratuityLoading(false); 
    }
  };

  useEffect(() => { 
    setError('');
    tab === 'pf' ? fetchPfAccounts() : fetchLiability(); 
  }, [tab]);

  const fmt = (v) => {
    const n = Number(v);
    return isNaN(n) ? '₹0' : `₹${n.toLocaleString('en-IN')}`;
  };

  // ─── PF Actions ────────────────────────────────────────────────────────────

  const handleCreatePf = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/pf-gratuity/pf/accounts', {
        employee_id: parseInt(pfForm.employee_id),
        uan_number: pfForm.uan_number || null,
        pf_number: pfForm.pf_number || null,
      });
      setIsCreatePfOpen(false);
      setPfForm({ employee_id: '', uan_number: '', pf_number: '' });
      await fetchPfAccounts();
    } catch (err) { setError(err.response?.data?.message || err.message || 'Failed to create PF account'); }
    finally { setSubmitting(false); }
  };

  const handleBatchPf = () => {
    setBatchResult(null);
    setBatchModal({ open: true, type: 'pf', month: prevMonth });
  };

  const openViewPf = async (empId) => {
    setIsViewPfOpen(true);
    setIsLoadingDetail(true);
    setSelectedAccount(null);
    setTransactions([]);
    try {
      const [accRes, txnRes] = await Promise.allSettled([
        api.get(`/pf-gratuity/pf/accounts/${empId}`),
        api.get(`/pf-gratuity/pf/transactions/${empId}?limit=24`),
      ]);
      
      if (accRes.status === 'fulfilled') {
        setSelectedAccount(accRes.value.data.data || accRes.value.data);
      } else {
        setError('Failed to load PF account details');
      }
      
      if (txnRes.status === 'fulfilled') {
        setTransactions(txnRes.value.data.data || []);
      }
    } finally { setIsLoadingDetail(false); }
  };

  // ─── Gratuity Actions ─────────────────────────────────────────────────────

  const handleBatchAccrue = () => {
    setBatchResult(null);
    setBatchModal({ open: true, type: 'gratuity', month: prevMonth });
  };

  const handleBatchSubmit = async (e) => {
    e.preventDefault();
    if (!batchModal.month) return;
    if (!window.confirm(`This will process ${batchModal.type === 'pf' ? 'PF' : 'Gratuity'} for all eligible employees for ${batchModal.month}. Are you sure?`)) return;
    setBatchProcessing(true);
    setBatchResult(null);
    try {
      if (batchModal.type === 'pf') {
        const res = await api.post('/pf-gratuity/pf/batch-process', { payroll_month: batchModal.month });
        setBatchResult(res.data.data);
        await fetchPfAccounts();
      } else {
        const res = await api.post('/pf-gratuity/gratuity/batch-accrue', { accrual_month: batchModal.month });
        setBatchResult(res.data.data);
        await fetchLiability();
      }
      // Keep modal open to show results
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Processing failed');
      setBatchModal({ ...batchModal, open: false });
    } finally {
      setBatchProcessing(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header + Tabs */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-emerald-600" /> PF & Gratuity
          </h1>
          <p className="text-slate-500 mt-1">Provident Fund accounts and Gratuity liability management</p>
        </div>
        <div className="flex gap-2">
          {tab === 'pf' ? (
            <>
              <button onClick={handleBatchPf} className="flex items-center gap-2 bg-emerald-600/20 text-emerald-600 hover:bg-emerald-600/30 px-4 py-2 rounded-lg border border-emerald-500/20">
                <Zap className="w-4 h-4" /> Batch Process PF
              </button>
              <button onClick={() => { setPfForm({ employee_id: '', uan_number: '', pf_number: '' }); setIsCreatePfOpen(true); }}
                className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg">
                <Plus className="w-4 h-4" /> New PF Account
              </button>
            </>
          ) : (
            <button onClick={handleBatchAccrue} className="flex items-center gap-2 bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 px-4 py-2 rounded-lg border border-purple-500/20">
              <TrendingUp className="w-4 h-4" /> Batch Accrue
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <p className="text-red-500 text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="flex bg-white rounded-lg p-1 w-fit">
        <button onClick={() => setTab('pf')} className={`px-6 py-2 rounded-lg text-sm transition-colors ${tab === 'pf' ? 'bg-emerald-600 text-slate-900' : 'text-slate-500 hover:text-slate-900'}`}>
          <Shield className="w-4 h-4 inline mr-1" /> Provident Fund
        </button>
        <button onClick={() => setTab('gratuity')} className={`px-6 py-2 rounded-lg text-sm transition-colors ${tab === 'gratuity' ? 'bg-purple-600 text-slate-900' : 'text-slate-500 hover:text-slate-900'}`}>
          <Award className="w-4 h-4 inline mr-1" /> Gratuity
        </button>
      </div>

      {(pfLoading && tab === 'pf') || (gratuityLoading && tab === 'gratuity') ? <TableSkeleton /> : tab === 'pf' ? (
        /* ═══ PF Accounts Tab ═══ */
        <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="text-left p-4 font-medium">Employee</th>
                  <th className="text-left p-4 font-medium">UAN</th>
                  <th className="text-right p-4 font-medium">Employee Bal</th>
                  <th className="text-right p-4 font-medium">Employer Bal</th>
                  <th className="text-right p-4 font-medium">Employer EPS</th>
                  <th className="text-right p-4 font-medium">Total</th>
                  <th className="text-right p-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pfAccounts.length === 0 ? (
                  <tr><td colSpan="7" className="p-8 text-center text-slate-400">No PF accounts found. Create one to get started.</td></tr>
                ) : pfAccounts.map(a => (
                  <tr key={a.id} className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                    <td className="p-4">
                      <div className="font-medium text-slate-900">{a.full_name}</div>
                      <div className="text-xs text-slate-400">{a.designation} • {a.emp_code}</div>
                    </td>
                    <td className="p-4 text-slate-500 text-xs">{a.uan_number || '—'}</td>
                    <td className="p-4 text-right text-slate-900">{fmt(a.employee_balance)}</td>
                    <td className="p-4 text-right text-slate-700">{fmt(a.employer_balance)}</td>
                    <td className="p-4 text-right text-slate-700">{fmt(a.eps_balance)}</td>
                    <td className="p-4 text-right font-bold text-emerald-600">{fmt(a.total_balance)}</td>
                    <td className="p-4 text-right">
                      <button onClick={() => openViewPf(a.employee_id)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><Eye className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ═══ Gratuity Liability Tab ═══ */
        <div className="space-y-4">
          {liabilityReport && (
            <>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 text-center">
                  <p className="text-slate-500 text-xs">Total Liability</p>
                  <p className="text-2xl font-bold text-purple-400">{fmt(liabilityReport.total_liability)}</p>
                </div>
                <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-4 text-center">
                  <p className="text-slate-500 text-xs">Total Employees</p>
                  <p className="text-2xl font-bold text-slate-900">{liabilityReport.total_employees}</p>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center">
                  <p className="text-slate-500 text-xs">Eligible (5+ yrs)</p>
                  <p className="text-2xl font-bold text-emerald-600">{liabilityReport.eligible_employees}</p>
                </div>
              </div>

              <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200">
                      <th className="text-left p-4 font-medium">Employee</th>
                      <th className="text-center p-4 font-medium">Years</th>
                      <th className="text-center p-4 font-medium">Eligible</th>
                      <th className="text-right p-4 font-medium">Gratuity Liability</th>
                      <th className="text-right p-4 font-medium">Provisioned</th>
                      <th className="text-right p-4 font-medium">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(liabilityReport.employees || []).map(e => (
                      <tr key={e.id} className="border-b border-slate-200 hover:bg-slate-50">
                        <td className="p-4">
                          <div className="font-medium text-slate-900">{e.full_name}</div>
                          <div className="text-xs text-slate-400">{e.designation}</div>
                        </td>
                        <td className="p-4 text-center text-slate-900">
                          {Math.floor(e.years_of_service)} yrs {Math.round((e.years_of_service % 1) * 12)} mo
                        </td>
                        <td className="p-4 text-center">
                          {e.is_eligible
                            ? <span className="text-emerald-600 text-xs bg-emerald-500/10 px-2 py-0.5 rounded">Yes</span>
                            : <span className="text-slate-400 text-xs bg-slate-50 px-2 py-0.5 rounded">No</span>}
                        </td>
                        <td className="p-4 text-right text-slate-900">{fmt(e.gratuity_liability)}</td>
                        <td className="p-4 text-right text-emerald-600">{fmt(e.provisioned)}</td>
                        <td className={`p-4 text-right font-medium ${e.gap < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {e.gap < 0 ? `${fmt(Math.abs(e.gap))} short` : `${fmt(e.gap)} excess`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!liabilityReport && !gratuityLoading && (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
              <Award className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-slate-700">No Gratuity Data</h3>
              <p className="text-slate-500 text-sm mt-1 mb-4">Run batch accrue to generate gratuity provisions.</p>
              <button onClick={fetchLiability} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm transition-colors">
                Refresh Report
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══ Create PF Modal ═══ */}
      {isCreatePfOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-sm">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-slate-900">New PF Account</h2>
              <button onClick={() => setIsCreatePfOpen(false)} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreatePf} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-500 mb-1">Employee *</label>
                <select value={pfForm.employee_id} onChange={e => setPfForm({...pfForm, employee_id: e.target.value})} required
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900">
                  <option value="">Select an employee...</option>
                  {employeesList.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.full_name} ({emp.employee_id})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-500 mb-1">UAN Number</label>
                <input type="text" value={pfForm.uan_number} onChange={e => setPfForm({...pfForm, uan_number: e.target.value})}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900" />
              </div>
              <div>
                <label className="block text-sm text-slate-500 mb-1">PF Number</label>
                <input type="text" value={pfForm.pf_number} onChange={e => setPfForm({...pfForm, pf_number: e.target.value})}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900" />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => { setIsCreatePfOpen(false); setPfForm({ employee_id: '', uan_number: '', pf_number: '' }); }} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-900 py-2 rounded-lg transition-colors">Cancel</button>
                <button type="submit" disabled={submitting} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white py-2 rounded-lg transition-colors">
                  {submitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══ View PF Account Modal ═══ */}
      {isViewPfOpen && selectedAccount && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-0 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-900">{selectedAccount.full_name} — PF Account</h2>
              <button onClick={() => setIsViewPfOpen(false)} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
            </div>
            {isLoadingDetail ? (
              <div className="p-12 text-center text-slate-400">Loading details...</div>
            ) : (
              <>
                <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">Total Balance</p>
                  <p className="text-xl font-bold text-emerald-600">{fmt(selectedAccount.total_balance)}</p>
                </div>
                <div className="bg-slate-900/50 border border-slate-200 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">Employee</p>
                  <p className="text-lg font-bold text-slate-900">{fmt(selectedAccount.employee_balance)}</p>
                </div>
                <div className="bg-slate-900/50 border border-slate-200 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-500">Employer PF</p>
                  <p className="text-lg font-bold text-slate-900">{fmt(selectedAccount.employer_balance || 0)}</p>
                </div>
                <div className="bg-slate-900/50 border border-slate-200 rounded-lg p-3 text-center" title="Pension corpus, not freely withdrawable">
                  <p className="text-xs text-slate-500">EPS (Pension)</p>
                  <p className="text-lg font-bold text-slate-900">{fmt(selectedAccount.eps_balance || 0)}</p>
                </div>
              </div>
              <div className="bg-slate-900/50 rounded-lg p-3 grid grid-cols-3 gap-4 text-sm">
                <div><span className="text-slate-400">UAN:</span> <span className="text-slate-900">{selectedAccount.uan_number || 'N/A'}</span></div>
                <div><span className="text-slate-400">PF No:</span> <span className="text-slate-900">{selectedAccount.pf_number || 'N/A'}</span></div>
                <div><span className="text-slate-400">Interest:</span> <span className="text-slate-900">{selectedAccount.interest_rate}%</span></div>
              </div>
              <h3 className="text-sm font-bold text-slate-700 border-b border-slate-200 pb-2">Recent Transactions</h3>
              {transactions.length === 0 ? (
                <p className="text-slate-400 text-sm">No transactions yet.</p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-2 relative shadow-inner">
                  {transactions.map(t => (
                    <div key={t.id} className="flex items-center justify-between bg-white/30 rounded-lg px-3 py-2 text-sm">
                      <div>
                        <span className="text-slate-900 font-medium">
                          {new Date(t.payroll_month + '-01').toLocaleDateString('en-US', {month: 'short', year: 'numeric'})}
                        </span>
                        <span className="text-slate-400 ml-2 text-xs capitalize">{t.transaction_type}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-emerald-600 font-medium">{fmt(t.total_amount)}</span>
                        <span className="text-slate-400 ml-2 text-xs">Bal: {fmt(t.running_balance)}</span>
                      </div>
                    </div>
                  ))}
                  {transactions.length === 24 && (
                    <p className="text-center text-[10px] text-slate-400 pt-2 border-t border-slate-100">Showing latest 24 transactions. Scroll for more.</p>
                  )}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-200">
              <button onClick={() => setIsViewPfOpen(false)} className="w-full bg-slate-100 hover:bg-slate-200 text-slate-900 py-2 rounded-lg transition-colors">Close</button>
            </div>
          </>
        )}
          </div>
        </div>
      )}

      {/* Batch Processing Modal */}
      {batchModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-teal-50">
              <h3 className="text-lg font-bold text-teal-800">
                {batchModal.type === 'pf' ? 'Batch Process PF' : 'Batch Accrue Gratuity'}
              </h3>
              <button type="button" onClick={() => setBatchModal({ ...batchModal, open: false })} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={handleBatchSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {batchModal.type === 'pf' ? 'Select Payroll Month (YYYY-MM)' : 'Select Accrual Month (YYYY-MM)'}
                </label>
                <input
                  required
                  type="month"
                  value={batchModal.month}
                  onChange={e => setBatchModal({ ...batchModal, month: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
                  autoFocus
                />
              </div>
              {batchResult && (
                <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <h4 className="font-bold text-slate-700 text-sm">Batch Complete</h4>
                  <div className="flex gap-4 text-xs font-medium">
                    <span className="text-emerald-600">Processed: {batchResult.processed}</span>
                    <span className="text-slate-500">Skipped: {batchResult.skipped}</span>
                    <span className="text-red-500">Errors: {batchResult.errors}</span>
                  </div>
                  {batchResult.details && batchResult.details.filter(d => d.status === 'error').length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 max-h-32 overflow-y-auto text-xs">
                      {batchResult.details.filter(d => d.status === 'error').map((err, idx) => (
                        <p key={idx} className="text-red-600 mb-1">
                          <span className="font-bold">{err.employee || 'Unknown'}:</span> {err.error}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
              
              <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-slate-100">
                <button type="button" onClick={() => setBatchModal({ ...batchModal, open: false })} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Close</button>
                <button type="submit" disabled={batchProcessing || !!batchResult} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50">
                  {batchProcessing ? 'Processing...' : 'Run Batch Process'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
