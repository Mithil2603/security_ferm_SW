import { useState, useEffect } from 'react';
import { TrendingUp, DollarSign, BarChart3, PieChart, ArrowUpRight, ArrowDownRight, Zap, Plus, X } from 'lucide-react';
import api from '../services/api';
import TableSkeleton from '../components/TableSkeleton';

export default function FinancialReports() {
  const [tab, setTab] = useState('kpis'); // kpis | cashflow | budgets
  const [snapshots, setSnapshots] = useState([]);
  const [cashFlow, setCashFlow] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createBudget, setCreateBudget] = useState(false);
  const [budgetForm, setBudgetForm] = useState({ name: '', financial_year: '2025-26', budget_type: 'annual', notes: '' });

  const fmt = (v) => `₹${parseFloat(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

  // Compute Indian fiscal year start: April of the current or previous calendar year
  const getFYStart = () => {
    const now = new Date();
    const yr = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
    return `${yr}-04-01`;
  };

  const [snapshotModal, setSnapshotModal] = useState({ open: false, month: new Date().toISOString().slice(0, 7) });
  const [cashFlowModal, setCashFlowModal] = useState({ open: false, start: getFYStart(), end: new Date().toISOString().split('T')[0] });
  const [generatingSnapshot, setGeneratingSnapshot] = useState(false);

  const fetchSnapshots = async () => {
    try { setLoading(true); setError(''); const r = await api.get('/financial-reports/snapshots?financial_year=2025-26'); setSnapshots(r.data || []); }
    catch (err) { setError(err?.response?.data?.message || 'Failed to load snapshots'); }
    finally { setLoading(false); }
  };

  const fetchBudgets = async () => {
    try { setLoading(true); setError(''); const r = await api.get('/financial-reports/budgets'); setBudgets(r.data || []); }
    catch (err) { setError(err?.response?.data?.message || 'Failed to load budgets'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (tab === 'kpis') fetchSnapshots();
    else if (tab === 'budgets') fetchBudgets();
    else setLoading(false);
  }, [tab]);

  const generateSnapshot = () => {
    setSnapshotModal({ open: true, month: new Date().toISOString().slice(0, 7) });
  };

  const handleSnapshotSubmit = async (e) => {
    e.preventDefault();
    if (!snapshotModal.month) return;
    setGeneratingSnapshot(true);
    setError(''); setSuccess('');
    try {
      await api.post('/financial-reports/snapshots/generate', { month: snapshotModal.month });
      setSuccess('Snapshot generated successfully!');
      setSnapshotModal({ ...snapshotModal, open: false });
      fetchSnapshots();
    } catch (err) { setError(err?.response?.data?.message || err.message || 'Failed to generate snapshot'); }
    finally { setGeneratingSnapshot(false); }
  };

  const generateCashFlow = () => {
    setCashFlowModal({ open: true, start: getFYStart(), end: new Date().toISOString().split('T')[0] });
  };

  const handleCashFlowSubmit = async (e) => {
    e.preventDefault();
    if (!cashFlowModal.start || !cashFlowModal.end) return;
    if (cashFlowModal.end < cashFlowModal.start) {
      setError('End date cannot be before start date'); return;
    }
    setError(''); setSuccess('');
    try {
      setLoading(true);
      const r = await api.post('/financial-reports/cash-flow', { start_date: cashFlowModal.start, end_date: cashFlowModal.end });
      setCashFlow(r.data);
      setCashFlowModal({ ...cashFlowModal, open: false });
    } catch (err) { setError(err?.response?.data?.message || err.message || 'Failed to generate cash flow'); }
    finally { setLoading(false); }
  };

  const handleCreateBudget = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      await api.post('/financial-reports/budgets', budgetForm);
      setSuccess('Budget created successfully!');
      setCreateBudget(false);
      setBudgetForm({ name: '', financial_year: '2025-26', budget_type: 'annual', notes: '' });
      fetchBudgets();
    } catch (err) { setError(err?.response?.data?.message || err.message || 'Failed to create budget'); }
  };

  // ─── KPI Cards ─────────────────────────────────────────────────────────────
  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-cyan-400" /> Financial Reports
          </h1>
          <p className="text-slate-500 mt-1">Cash flow, KPIs, budgets &amp; variance analysis</p>
        </div>
        <div className="flex gap-2">
          {tab === 'kpis' && (
            <button onClick={generateSnapshot} className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm">
              <Zap className="w-4 h-4" /> Generate Snapshot
            </button>
          )}
          {tab === 'cashflow' && (
            <button onClick={generateCashFlow} className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm">
              <Zap className="w-4 h-4" /> Generate Cash Flow
            </button>
          )}
          {tab === 'budgets' && (
            <button onClick={() => setCreateBudget(true)} className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm">
              <Plus className="w-4 h-4" /> New Budget
            </button>
          )}
        </div>
      </div>

      {/* Error / Success banners */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 flex justify-between items-center text-sm">
          <span>⚠ {error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-4"><X className="w-4 h-4" /></button>
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-3 flex justify-between items-center text-sm">
          <span>✓ {success}</span>
          <button onClick={() => setSuccess('')} className="text-emerald-400 hover:text-emerald-600 ml-4"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-white rounded-lg p-1 w-fit">
        {[
          { id: 'kpis', label: 'KPI Dashboard', icon: TrendingUp },
          { id: 'cashflow', label: 'Cash Flow', icon: DollarSign },
          { id: 'budgets', label: 'Budgets', icon: PieChart },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${tab === t.id ? 'bg-teal-600 text-white' : 'text-slate-500 hover:text-slate-900'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* ═══ KPI Dashboard Tab ═══ */}
      {tab === 'kpis' && (loading ? <TableSkeleton /> : (
        <div className="space-y-6 animate-fade-in">
          {latestSnapshot ? (
            <>
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: 'Revenue', value: fmt(latestSnapshot.total_revenue), color: 'cyan', icon: DollarSign },
                  { label: 'Net Profit', value: fmt(latestSnapshot.net_profit), color: latestSnapshot.net_profit >= 0 ? 'emerald' : 'red', icon: latestSnapshot.net_profit >= 0 ? ArrowUpRight : ArrowDownRight },
                  { label: 'Gross Margin', value: `${latestSnapshot.gross_margin}%`, color: 'blue', icon: TrendingUp },
                  { label: 'Net Margin', value: `${latestSnapshot.net_margin}%`, color: 'purple', icon: TrendingUp },
                ].map((kpi, i) => (
                  <div key={i} className={`bg-${kpi.color}-500/10 border border-${kpi.color}-500/20 rounded-xl p-5`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-slate-500 text-xs">{kpi.label}</span>
                      <kpi.icon className={`w-4 h-4 text-${kpi.color}-400`} />
                    </div>
                    <p className={`text-2xl font-bold text-${kpi.color}-400`}>{kpi.value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: 'DSO (Days Sales Outstanding)', value: `${latestSnapshot.dso} days` },
                  { label: 'Current Ratio', value: latestSnapshot.current_ratio },
                  { label: 'Employee Count', value: latestSnapshot.employee_count },
                  { label: 'Revenue/Employee', value: fmt(latestSnapshot.revenue_per_employee) },
                ].map((kpi, i) => (
                  <div key={i} className="bg-white shadow-sm border border-slate-200 rounded-xl p-4 text-center">
                    <p className="text-xs text-slate-400 mb-1">{kpi.label}</p>
                    <p className="text-xl font-bold text-slate-900">{kpi.value}</p>
                  </div>
                ))}
              </div>

              <p className="text-xs text-slate-400 text-right">Latest snapshot: {latestSnapshot.snapshot_month}</p>
            </>
          ) : (
            <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-12 text-center text-slate-400">
              No snapshots generated yet. Click "Generate Snapshot" to create one.
            </div>
          )}

          {/* Snapshot History */}
          {snapshots.length > 0 && (
            <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
              <h3 className="text-sm font-bold text-slate-700 p-4 border-b border-slate-200">Monthly Trend</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200">
                    <th className="text-left p-3 font-medium">Month</th>
                    <th className="text-right p-3 font-medium">Revenue</th>
                    <th className="text-right p-3 font-medium">Expenses</th>
                    <th className="text-right p-3 font-medium">Net Profit</th>
                    <th className="text-right p-3 font-medium">Margin</th>
                    <th className="text-right p-3 font-medium">DSO</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map(s => (
                    <tr key={s.id} className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="p-3 text-slate-900 font-medium">{s.snapshot_month}</td>
                      <td className="p-3 text-right text-slate-900">{fmt(s.total_revenue)}</td>
                      <td className="p-3 text-right text-red-600">{fmt(s.total_expenses)}</td>
                      <td className={`p-3 text-right font-medium ${s.net_profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(s.net_profit)}</td>
                      <td className="p-3 text-right text-slate-700">{s.net_margin}%</td>
                      <td className="p-3 text-right text-slate-700">{s.dso}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {/* ═══ Cash Flow Tab ═══ */}
      {tab === 'cashflow' && (loading ? <TableSkeleton /> : (
        <div className="space-y-4">
          {cashFlow ? (
            <>
              <div className="text-xs text-slate-400 mb-2">Period: {cashFlow.period.start} to {cashFlow.period.end}</div>
              {/* Operating */}
              <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-emerald-600 mb-3">A. Cash Flow from Operating Activities</h3>
                <div className="space-y-2 text-sm">
                  {[
                    ['Cash from Customers', cashFlow.operating_activities.cash_from_customers, true],
                    ['Cash Paid to Suppliers', cashFlow.operating_activities.cash_paid_to_suppliers],
                    ['Cash Paid to Employees', cashFlow.operating_activities.cash_paid_to_employees],
                    ['Change in Receivables', cashFlow.operating_activities.change_in_receivables],
                  ].map(([label, val], i) => (
                    <div key={i} className="flex justify-between">
                      <span className="text-slate-500">{label}</span>
                      <span className={val >= 0 ? 'text-emerald-600' : 'text-red-600'}>{fmt(val)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-slate-200 pt-2 font-bold">
                    <span className="text-slate-900">Net Operating Cash Flow</span>
                    <span className={cashFlow.operating_activities.net_operating_cash_flow >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                      {fmt(cashFlow.operating_activities.net_operating_cash_flow)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Investing */}
              <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-blue-600 mb-3">B. Cash Flow from Investing Activities</h3>
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-slate-900">Net Investing Cash Flow</span>
                  <span className="text-slate-500">{fmt(cashFlow.investing_activities.net_investing_cash_flow)}</span>
                </div>
              </div>

              {/* Financing */}
              <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-purple-400 mb-3">C. Cash Flow from Financing Activities</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">PF Deposits</span>
                    <span className="text-red-600">{fmt(cashFlow.financing_activities.pf_deposits)}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2 font-bold">
                    <span className="text-slate-900">Net Financing Cash Flow</span>
                    <span className={cashFlow.financing_activities.net_financing_cash_flow >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                      {fmt(cashFlow.financing_activities.net_financing_cash_flow)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Net */}
              <div className={`rounded-xl p-5 text-center border ${cashFlow.net_cash_flow >= 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                <p className="text-sm text-slate-500 mb-1">Net Cash Flow (A + B + C)</p>
                <p className={`text-3xl font-bold ${cashFlow.net_cash_flow >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(cashFlow.net_cash_flow)}</p>
              </div>
            </>
          ) : (
            <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-12 text-center text-slate-400">
              Click "Generate Cash Flow" to create a cash flow statement for any period.
            </div>
          )}
        </div>
      ))}

      {/* ═══ Budgets Tab ═══ */}
      {tab === 'budgets' && (loading ? <TableSkeleton /> : (
        <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200">
                <th className="text-left p-4 font-medium">Name</th>
                <th className="text-left p-4 font-medium">FY</th>
                <th className="text-left p-4 font-medium">Type</th>
                <th className="text-right p-4 font-medium">Revenue Budget</th>
                <th className="text-right p-4 font-medium">Expense Budget</th>
                <th className="text-center p-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {budgets.length === 0 ? (
                <tr><td colSpan="6" className="p-8 text-center text-slate-400">No budgets created yet.</td></tr>
              ) : budgets.map(b => (
                <tr key={b.id} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="p-4 text-slate-900 font-medium">{b.name}</td>
                  <td className="p-4 text-slate-700">{b.financial_year}</td>
                  <td className="p-4"><span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded capitalize">{b.budget_type}</span></td>
                  <td className="p-4 text-right text-slate-900">{fmt(b.total_revenue_budget)}</td>
                  <td className="p-4 text-right text-slate-700">{fmt(b.total_expense_budget)}</td>
                  <td className="p-4 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      b.status === 'approved' ? 'bg-emerald-500/20 text-emerald-600' :
                      b.status === 'active' ? 'bg-blue-500/20 text-blue-600' :
                      'bg-slate-100 text-slate-500'
                    } capitalize`}>{b.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* ═══ Create Budget Modal ═══ */}
      {createBudget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-sm">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-slate-900">New Budget</h2>
              <button onClick={() => { setCreateBudget(false); setBudgetForm({ name: '', financial_year: '2025-26', budget_type: 'annual', notes: '' }); }} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleCreateBudget} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Name *</label>
                <input type="text" value={budgetForm.name} onChange={e => setBudgetForm({...budgetForm, name: e.target.value})} required
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900" placeholder="FY 2025-26 Annual Budget" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Financial Year *</label>
                  <input type="text" value={budgetForm.financial_year} onChange={e => setBudgetForm({...budgetForm, financial_year: e.target.value})} required
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Type</label>
                  <select value={budgetForm.budget_type} onChange={e => setBudgetForm({...budgetForm, budget_type: e.target.value})}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900">
                    <option value="annual">Annual</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Notes</label>
                <textarea value={budgetForm.notes} onChange={e => setBudgetForm({...budgetForm, notes: e.target.value})} rows={2}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900" />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setCreateBudget(false)} className="flex-1 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors font-medium">Cancel</button>
                <button type="submit" className="flex-1 bg-teal-600 hover:bg-teal-700 text-white py-2 rounded-lg font-medium transition-colors">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Snapshot Modal */}
      {snapshotModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-teal-50">
              <h3 className="text-lg font-bold text-teal-800">Generate Monthly Snapshot</h3>
              <button type="button" onClick={() => setSnapshotModal({ ...snapshotModal, open: false })} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={handleSnapshotSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Select Month (YYYY-MM)</label>
                <input
                  required
                  type="month"
                  value={snapshotModal.month}
                  onChange={e => setSnapshotModal({ ...snapshotModal, month: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-slate-100">
                <button type="button" onClick={() => setSnapshotModal({ ...snapshotModal, open: false })} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={generatingSnapshot} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50">
                  {generatingSnapshot ? 'Generating...' : 'Generate Snapshot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cash Flow Date Range Modal */}
      {cashFlowModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-teal-50">
              <h3 className="text-lg font-bold text-teal-800">Generate Cash Flow Statement</h3>
              <button type="button" onClick={() => setCashFlowModal({ ...cashFlowModal, open: false })} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={handleCashFlowSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Start Date *</label>
                  <input
                    required
                    type="date"
                    value={cashFlowModal.start}
                    onChange={e => setCashFlowModal({ ...cashFlowModal, start: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">End Date *</label>
                  <input
                    required
                    type="date"
                    value={cashFlowModal.end}
                    onChange={e => setCashFlowModal({ ...cashFlowModal, end: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-slate-100">
                <button type="button" onClick={() => setCashFlowModal({ ...cashFlowModal, open: false })} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700">
                  Generate Cash Flow
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
