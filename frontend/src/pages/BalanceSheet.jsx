import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { BarChart3, Download, RefreshCw, Calendar, GitCompare } from 'lucide-react';

import api from '../services/api';

export default function BalanceSheet() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [asOnDate, setAsOnDate] = useState(new Date().toISOString().split('T')[0]);
  const [compare, setCompare] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const fmt = (n) => {
    const num = parseFloat(n || 0);
    if (isNaN(num)) return '₹0';
    return num.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  };

  const formatFinancialYear = (fy) => {
    if (!fy) return '';
    const startYear = new Date(fy.start).getFullYear();
    const endYear = new Date(fy.end).getFullYear().toString().slice(2);
    return `${startYear}-${endYear}`;
  };



  const fetchBalanceSheet = async () => {
    setLoading(true); setError('');
    
    // M8: Date validation
    if (new Date(asOnDate) > new Date()) {
      setError('Future date not allowed');
      setLoading(false);
      return;
    }
    if (new Date(asOnDate) < new Date('2020-01-01')) {
      setError('Date before company founding not allowed (Min: 2020-01-01)');
      setLoading(false);
      return;
    }

    try {
      const params = new URLSearchParams({ as_on_date: asOnDate });
      if (compare) params.append('compare', 'true');
      const res = await api.get(`/balance-sheet?${params}`);
      
      // H7: Error boundary
      if (res.success) {
        setData(res.data);
        // M4: Compare toggle validation
        if (compare && !res.data.previous) {
          setError('Previous year data not available for comparison');
          setCompare(false);
        }
      } else {
        setError(res.message || 'Failed to fetch balance sheet');
      }
    } catch (e) {
      console.error('Fetch error:', e);
      setError(e.message || 'Failed to fetch balance sheet');
    }
    setLoading(false);
  };

  useEffect(() => { fetchBalanceSheet(); }, [asOnDate, compare]);

  const handleGenerate = async () => {
    setArchiving(true);
    setError('');
    try {
      const res = await api.post('/balance-sheet/generate', { as_on_date: asOnDate });
      if (res.success) setSuccess('Balance sheet archived successfully!');
      else setError(res.message);
    } catch (e) { 
      setError(e.message || 'Failed to generate'); 
    } finally {
      setArchiving(false);
    }
    setTimeout(() => setSuccess(''), 3000);
  };

  const bs = data?.current;
  const prev = data?.previous;

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* L3: Print CSS */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
        }
      `}</style>
      
      {/* Header */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#1e293b', margin: 0 }}>
            <BarChart3 size={24} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
            Balance Sheet
          </h1>
          <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>
            Statement of Assets & Liabilities
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Calendar size={16} color="#64748b" />
            <span style={{ fontSize: '13px', color: '#64748b' }}>As on:</span>
            <input type="date" value={asOnDate} onChange={e => setAsOnDate(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
          </div>
          <button 
            onClick={() => setCompare(!compare)} 
            className={`px-3 py-2 rounded-lg border text-sm font-medium flex items-center gap-2 transition-colors ${
              compare 
                ? 'bg-teal-50 border-teal-200 text-teal-700' 
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <GitCompare size={14} /> Compare YoY
          </button>
          <button 
            onClick={handleGenerate} 
            disabled={archiving}
            className={`px-4 py-2 rounded-lg border-none cursor-pointer font-semibold flex items-center gap-2 transition-colors text-sm ${
              archiving ? 'bg-teal-400 text-teal-100 cursor-not-allowed' : 'bg-teal-600 hover:bg-teal-700 text-white'
            }`}
          >
            {archiving ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />} 
            {archiving ? 'Archiving...' : 'Archive'}
          </button>
          <button 
            onClick={() => window.print()}
            className="px-4 py-2 rounded-lg border-none cursor-pointer bg-slate-600 hover:bg-slate-700 text-white font-semibold flex items-center gap-2 transition-colors text-sm"
          >
            <BarChart3 size={14} /> Print
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && <div style={{ padding: '10px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: '8px', marginBottom: '12px' }}>{error}</div>}
      {success && <div style={{ padding: '10px 16px', background: '#f0fdf4', color: '#16a34a', borderRadius: '8px', marginBottom: '12px' }}>{success}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>Loading balance sheet...</div>
      ) : !bs ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>No data available</div>
      ) : (
        <>
          {/* Balance Check Banner */}
          <div className="no-print" style={{
            padding: '14px 20px', borderRadius: '12px', marginBottom: '20px',
            background: bs.totals.is_balanced ? 'linear-gradient(135deg, #ecfdf5, #d1fae5)' : 'linear-gradient(135deg, #fef2f2, #fecaca)',
            border: `1px solid ${bs.totals.is_balanced ? '#86efac' : '#fca5a5'}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <div>
              <span style={{ fontWeight: 700, color: bs.totals.is_balanced ? '#16a34a' : '#dc2626' }}>
                {bs.totals.is_balanced ? '✅ Balance Sheet is Balanced' : `⚠️ Balance Sheet Mismatch (Difference: ${fmt(bs.totals.difference)})`}
              </span>
              <span style={{ marginLeft: '12px', fontSize: '13px', color: '#64748b' }}>
                FY {formatFinancialYear(bs.financial_year)}
              </span>
            </div>
            <div style={{ fontWeight: 700, fontSize: '18px', color: '#1e293b' }}>
              {fmt(bs.totals.total_assets)}
            </div>
          </div>

          {/* Two Column Layout */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {/* ASSETS */}
            <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ padding: '16px 20px', background: 'linear-gradient(135deg, #0f3460, #16213e)', color: '#fff' }}>
                <h2 style={{ margin: 0, fontSize: '18px' }}>ASSETS</h2>
              </div>
              <div style={{ padding: '16px 20px' }}>
                {/* Cash & Bank */}
                <SectionHeader title={bs.assets.cash_and_bank.label} total={bs.assets.cash_and_bank.total} prev={prev?.assets?.cash_and_bank?.total} compare={compare} />
                {bs.assets.cash_and_bank.cash_accounts?.map((a, i) => (
                  <LineItem key={`c${i}`} label={a.account_name} amount={a.balance} />
                ))}
                {bs.assets.cash_and_bank.bank_accounts?.map((a, i) => (
                  <LineItem key={`b${i}`} label={`🏦 ${a.account_name}`} amount={a.balance} />
                ))}
                <div style={{ borderTop: '1px solid #e2e8f0', margin: '12px 0' }} />

                {/* Receivables */}
                <SectionHeader title={bs.assets.accounts_receivable.label} total={bs.assets.accounts_receivable.total} prev={prev?.assets?.accounts_receivable?.total} compare={compare} />
                {bs.assets.accounts_receivable.details?.map((r, i) => (
                  <LineItem key={`r${i}`} label={r.client_name} amount={r.amount_due} sub={`${r.invoice_count} invoices`} />
                ))}
                {bs.assets.accounts_receivable.details?.length === 0 && <LineItem label="No outstanding receivables" amount={0} />}
                <div style={{ borderTop: '1px solid #e2e8f0', margin: '12px 0' }} />

                {/* Advances */}
                <SectionHeader title={bs.assets.advances.label} total={bs.assets.advances.total} prev={prev?.assets?.advances?.total} compare={compare} />
                <LineItem label="Salary Advances" amount={bs.assets.advances.salary_advances} />
              </div>
              {/* Total Assets */}
              <div style={{ padding: '14px 20px', background: '#f0f9ff', borderTop: '2px solid #0f3460', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: '15px', color: '#0f3460' }}>TOTAL ASSETS</span>
                <span style={{ fontWeight: 700, fontSize: '15px', color: '#0f3460', fontFamily: 'monospace' }}>{fmt(bs.totals.total_assets)}</span>
              </div>
            </div>

            {/* LIABILITIES */}
            <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ padding: '16px 20px', background: 'linear-gradient(135deg, #7c3aed, #6366f1)', color: '#fff' }}>
                <h2 style={{ margin: 0, fontSize: '18px' }}>LIABILITIES & EQUITY</h2>
              </div>
              <div style={{ padding: '16px 20px' }}>
                {/* Current Liabilities */}
                <SectionHeader title={bs.liabilities.current_liabilities.label} total={bs.liabilities.current_liabilities.total} prev={prev?.liabilities?.current_liabilities?.total} compare={compare} />
                <LineItem label="Salary Payable" amount={bs.liabilities.current_liabilities.salary_payable} />
                <LineItem label="PF Payable" amount={bs.liabilities.current_liabilities.pf_payable} />
                <LineItem label="ESI Payable" amount={bs.liabilities.current_liabilities.esi_payable} />
                <LineItem label="TDS Payable" amount={bs.liabilities.current_liabilities.tds_payable} />
                <LineItem label="GST Payable" amount={bs.liabilities.current_liabilities.gst_payable} />
                <LineItem label="Expense Payable" amount={bs.liabilities.current_liabilities.expense_payable} />
                <div style={{ borderTop: '1px solid #e2e8f0', margin: '12px 0' }} />

                {/* Capital */}
                <SectionHeader title={bs.liabilities.capital_account.label} total={bs.liabilities.capital_account.total} prev={prev?.liabilities?.capital_account?.total} compare={compare} />
                <LineItem label="Net Profit (Current FY)" amount={bs.liabilities.capital_account.net_profit} />
                <LineItem label="Retained Earnings" amount={bs.liabilities.capital_account.retained_earnings} />
              </div>
              {/* Total Liabilities */}
              <div style={{ padding: '14px 20px', background: '#faf5ff', borderTop: '2px solid #7c3aed', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: '15px', color: '#7c3aed' }}>TOTAL LIABILITIES</span>
                <span style={{ fontWeight: 700, fontSize: '15px', color: '#7c3aed', fontFamily: 'monospace' }}>{fmt(bs.totals.total_liabilities)}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function SectionHeader({ title, total, prev, compare }) {
  const fmt = (n) => {
    const num = parseFloat(n || 0);
    if (isNaN(num)) return '₹0';
    return num.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  };
  const change = compare && prev != null ? total - prev : null;
  const pctChange = compare && prev != null && prev !== 0 ? ((total - prev) / Math.abs(prev) * 100).toFixed(1) : null;
  
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px', marginTop: '8px' }}>
      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#334155' }}>{title}</h3>
      <div style={{ textAlign: 'right' }}>
        <span style={{ fontWeight: 600, fontSize: '14px', fontFamily: 'monospace', color: '#1e293b' }}>{fmt(total)}</span>
        {change != null && (
          <div style={{ fontSize: '11px', color: change >= 0 ? '#16a34a' : '#dc2626' }}>
            {change >= 0 ? '▲' : '▼'} {fmt(Math.abs(change))} {pctChange ? `(${pctChange}%)` : ''}
          </div>
        )}
      </div>
    </div>
  );
}

function LineItem({ label, amount, sub }) {
  const fmt = (n) => {
    const num = parseFloat(n || 0);
    if (isNaN(num)) return '₹0';
    return num.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  };
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0 4px 16px', fontSize: '13px' }}>
      <div>
        <span style={{ color: '#475569' }}>{label}</span>
        {sub && <span style={{ color: '#94a3b8', fontSize: '11px', marginLeft: '6px' }}>({sub})</span>}
      </div>
      <span style={{ fontFamily: 'monospace', color: '#1e293b' }}>{fmt(amount)}</span>
    </div>
  );
}
