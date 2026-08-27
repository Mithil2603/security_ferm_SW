import { useState, useEffect, useRef } from 'react';
import { Wallet, TrendingUp, TrendingDown, Download, Printer, Calendar, RefreshCw, ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight, FileText, Users, Receipt, IndianRupee, Building2, BarChart3, Minus } from 'lucide-react';
import api from '../services/api';
import * as XLSX from 'xlsx';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart, Bar, Legend, ReferenceLine } from 'recharts';

function fmt(val) {
  return `₹${parseFloat(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function fmtDec(val) {
  return `₹${parseFloat(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function pct(val) { return `${parseFloat(val || 0).toFixed(1)}%`; }
function formatDate(d) {
  if (!d) return '-';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

function change(current, previous) {
  if (!previous || previous === 0) return null;
  return parseFloat(((current - previous) / Math.abs(previous) * 100).toFixed(1));
}

const tooltipStyle = {
  backgroundColor: 'rgba(255,255,255,0.96)',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(226,232,240,0.8)',
  borderRadius: '12px',
  boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)',
  padding: '12px',
  fontWeight: 'bold'
};

function ChangeIndicator({ value }) {
  if (value === null || value === undefined) return null;
  const isUp = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded-full ${isUp ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
      {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(value)}%
    </span>
  );
}

function SummaryCard({ icon: Icon, label, value, subtext, color, changeVal }) {
  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-5 ${color}`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-lg bg-opacity-10 ${color.includes('emerald') ? 'bg-emerald-100' : color.includes('red') ? 'bg-red-100' : color.includes('blue') ? 'bg-blue-100' : 'bg-amber-100'}`}>
          <Icon className="w-5 h-5" />
        </div>
        {changeVal !== null && changeVal !== undefined && <ChangeIndicator value={changeVal} />}
      </div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-black text-slate-900 mt-1">{value}</p>
      {subtext && <p className="text-xs text-slate-400 mt-1">{subtext}</p>}
    </div>
  );
}

function CollapsibleSection({ title, icon: Icon, iconColor, children, defaultOpen = true, total, count }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${iconColor}`}><Icon className="w-5 h-5" /></div>
          <div className="text-left">
            <h3 className="text-sm font-bold text-slate-800">{title}</h3>
            {count !== undefined && <p className="text-xs text-slate-400">{count} line items</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {total !== undefined && <span className="text-lg font-black text-slate-800">{fmt(total)}</span>}
          {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </button>
      {open && <div className="border-t border-slate-100">{children}</div>}
    </div>
  );
}

function LineItem({ label, amount, sublabel, bold = false, previousAmount, isNegative = false }) {
  const chg = previousAmount !== undefined ? change(amount, previousAmount) : null;
  return (
    <div className={`flex items-center justify-between px-6 py-3 ${bold ? 'bg-slate-50 border-t border-b border-slate-200' : 'hover:bg-slate-50/50'} transition-colors`}>
      <div>
        <span className={`text-sm ${bold ? 'font-bold text-slate-800' : 'text-slate-600'}`}>{label}</span>
        {sublabel && <span className="text-xs text-slate-400 ml-2">{sublabel}</span>}
      </div>
      <div className="flex items-center gap-3">
        {chg !== null && <ChangeIndicator value={isNegative ? -chg : chg} />}
        <span className={`text-sm font-mono tabular-nums ${bold ? 'font-black text-slate-900 text-base' : 'font-semibold text-slate-700'} ${isNegative ? 'text-red-600' : ''}`}>
          {isNegative && amount > 0 ? `(${fmt(amount)})` : fmt(amount)}
        </span>
      </div>
    </div>
  );
}

export default function PLAccount() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [compare, setCompare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);
  const printRef = useRef();
  const abortRef = useRef(null);

  const now = new Date();
  // FY starts April 1. If month >= 3 (April, 0-indexed), FY is current year; else previous year
  const fyStart = now.getMonth() >= 3 ? `${now.getFullYear()}-04-01` : `${now.getFullYear() - 1}-04-01`;
  const [dateRange, setDateRange] = useState({
    from_date: fyStart,
    to_date: now.toISOString().split('T')[0]
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      
      const params = new URLSearchParams({
        from_date: dateRange.from_date,
        to_date: dateRange.to_date,
        compare: compare.toString()
      });
      const res = await api.get(`/pl-account?${params.toString()}`, { signal: abortRef.current.signal });
      setData(res.data?.data || res.data); // Adjust for the correct response structure
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      console.error('Failed to fetch P&L', err);
      setError(err.response?.data?.message || 'Failed to load P&L data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [dateRange.from_date, dateRange.to_date, compare]);

  const handleSaveArchive = async () => {
    try {
      setSaving(true);
      setSaveStatus(null);
      await api.post('/pl-account/generate', {
        from_date: dateRange.from_date,
        to_date: dateRange.to_date
      });
      setSaveStatus({ type: 'success', msg: 'P&L statement saved to Statement Archive!' });
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      setSaveStatus({ type: 'error', msg: 'Failed to save P&L statement' });
      setTimeout(() => setSaveStatus(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => window.print();

  const handleExportExcel = () => {
    if (!data) return;
    const cp = data.current_period;
    const wb = XLSX.utils.book_new();
    const rows = [
      [`PROFIT & LOSS ACCOUNT`],
      [`Period: ${formatDate(cp.period.from)} to ${formatDate(cp.period.to)}`],
      [],
      ['', 'Amount (₹)'],
      ['═══ INCOME ═══', ''],
    ];
    cp.income.by_client.forEach(c => rows.push([`  ${c.name}`, c.collected]));
    rows.push(['TOTAL INCOME', cp.income.total], []);
    rows.push(['═══ COST OF SERVICES ═══', '']);
    cp.cost_of_services.by_employee.forEach(e => rows.push([`  ${e.name}`, e.net_salary]));
    rows.push(['TOTAL COST OF SERVICES', cp.cost_of_services.total], []);
    rows.push(['GROSS PROFIT', cp.gross_profit]);
    rows.push([`  Gross Margin`, `${cp.gross_margin}%`], []);
    rows.push(['═══ OPERATING EXPENSES ═══', '']);
    cp.operating_expenses.by_category.forEach(e => rows.push([`  ${e.name}`, e.amount]));
    rows.push(['TOTAL OPERATING EXPENSES', cp.operating_expenses.total], []);
    rows.push(['═══════════════════════════', '']);
    rows.push(['NET PROFIT / (LOSS)', cp.net_profit]);
    rows.push([`  Net Margin`, `${cp.net_margin}%`], []);
    rows.push(['═══ TAX SUMMARY ═══', '']);
    rows.push(['  GST Collected', cp.tax_summary.gst_collected]);
    rows.push(['  TDS Deducted by Clients', cp.tax_summary.tds_deducted]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 35 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'P&L');

    if (data.monthly_trend?.length > 0) {
      const trendRows = [['Month', 'Revenue', 'Payroll', 'Expenses', 'Total Costs', 'Profit']];
      data.monthly_trend.forEach(m => trendRows.push([`${m.month} ${m.year}`, m.revenue, m.payroll, m.expenses, m.total_costs, m.profit]));
      const ws2 = XLSX.utils.aoa_to_sheet(trendRows);
      ws2['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws2, 'Monthly Trend');
    }

    const filename = `PL_Account_${dateRange.from_date.replace(/[^0-9-]/g, '_')}_to_${dateRange.to_date.replace(/[^0-9-]/g, '_')}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  const cp = data?.current_period;
  const pp = data?.previous_period;

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-10 bg-slate-200 rounded-lg w-64 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-32 bg-slate-100 rounded-2xl animate-pulse" />)}
        </div>
        {[1,2,3].map(i => <div key={i} className="h-48 bg-slate-100 rounded-2xl animate-pulse" />)}
      </div>
    );
  }

  const trendData = data?.monthly_trend || [];

  return (
    <div className="space-y-6 animate-fade-in pb-12" ref={printRef}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background-color: white !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .animate-fade-in { animation: none !important; }
          .pb-12 { padding-bottom: 0 !important; }
        }
      `}</style>
      
      {/* ── Error & Success States ──────────────────────────────────────── */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 flex justify-between items-center text-sm no-print">
          <span>⚠ {error}</span>
          <button onClick={() => fetchData()} className="font-medium hover:underline">Retry</button>
        </div>
      )}
      {saveStatus && (
        <div className={`border rounded-xl px-4 py-3 text-sm no-print ${saveStatus.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {saveStatus.msg}
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 no-print">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <Wallet className="w-7 h-7 text-teal-600" />
            Profit & Loss Account
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {formatDate(dateRange.from_date)} — {formatDate(dateRange.to_date)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={dateRange.from_date}
            onChange={e => setDateRange(p => ({ ...p, from_date: e.target.value }))}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500" />
          <span className="text-slate-400 font-medium text-sm">to</span>
          <input type="date" value={dateRange.to_date}
            onChange={e => setDateRange(p => ({ ...p, to_date: e.target.value }))}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500" />
          <button onClick={() => setCompare(!compare)}
            className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${compare ? 'bg-teal-50 border-teal-300 text-teal-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            <RefreshCw className="w-3.5 h-3.5 inline mr-1" /> Compare
          </button>
          <button onClick={handleExportExcel}
            className="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" /> Excel
          </button>
          <button onClick={handlePrint}
            className="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors flex items-center gap-1.5">
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
          <button onClick={handleSaveArchive} disabled={saving}
            className="px-3 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors flex items-center gap-1.5 disabled:opacity-50">
            <FileText className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Archive'}
          </button>
        </div>
      </div>

      {/* ── Print Header ─────────────────────────────────────────────────── */}
      <div className="hidden print:block text-center mb-8">
        <h1 className="text-2xl font-bold">PROFIT & LOSS ACCOUNT</h1>
        <p className="text-sm text-slate-500 mt-1">
          For the period {formatDate(dateRange.from_date)} to {formatDate(dateRange.to_date)}
        </p>
      </div>

      {/* ── Summary Cards ────────────────────────────────────────────────── */}
      {cp && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard icon={IndianRupee} label="Total Income" value={fmt(cp.income.total)}
            subtext={`${cp.income.invoice_count} invoices | Billed: ${fmt(cp.income.total_billed)}`}
            color="border-blue-200 text-blue-600"
            changeVal={pp ? change(cp.income.total, pp.income.total) : null} />
          <SummaryCard icon={Receipt} label="Total Costs" value={fmt(cp.cost_of_services.total + cp.operating_expenses.total)}
            subtext={`Payroll: ${fmt(cp.cost_of_services.total)} | OpEx: ${fmt(cp.operating_expenses.total)}`}
            color="border-amber-200 text-amber-600"
            changeVal={pp ? change(cp.cost_of_services.total + cp.operating_expenses.total, pp.cost_of_services.total + pp.operating_expenses.total) : null} />
          <SummaryCard icon={cp.net_profit >= 0 ? TrendingUp : TrendingDown}
            label="Net Profit" value={fmt(cp.net_profit)}
            subtext={`Margin: ${pct(cp.net_margin)}`}
            color={cp.net_profit >= 0 ? 'border-emerald-200 text-emerald-600' : 'border-red-200 text-red-600'}
            changeVal={pp ? change(cp.net_profit, pp.net_profit) : null} />
          <SummaryCard icon={BarChart3} label="Gross Margin" value={pct(cp.gross_margin)}
            subtext={`Gross Profit: ${fmt(cp.gross_profit)}`}
            color="border-purple-200 text-purple-600"
            changeVal={pp ? change(cp.gross_margin, pp.gross_margin) : null} />
        </div>
      )}

      {/* ── P&L Statement ──────────────────────────────────────────────── */}
      {cp && (
        <>
          {/* INCOME */}
          <CollapsibleSection title="Income (Revenue)" icon={IndianRupee} iconColor="bg-blue-100 text-blue-600"
            total={cp.income.total} count={cp.income.by_client.length}>
            {cp.income.by_client.map((c, i) => (
              <LineItem key={i} label={c.name} amount={c.collected}
                sublabel={`${c.count} inv | Billed: ${fmt(c.billed)}`}
                previousAmount={pp?.income?.by_client?.find(x => x.name === c.name)?.collected} />
            ))}
            <LineItem label="TOTAL INCOME" amount={cp.income.total} bold
              previousAmount={pp?.income?.total} />
          </CollapsibleSection>

          {/* COST OF SERVICES */}
          <CollapsibleSection title="Cost of Services (Payroll)" icon={Users} iconColor="bg-teal-100 text-teal-600"
            total={cp.cost_of_services.total} count={cp.cost_of_services.by_employee.length}>
            {cp.cost_of_services.by_employee.map((e, i) => (
              <LineItem key={i} label={e.name} amount={e.net_salary}
                sublabel={`${e.emp_id} • ${e.months} month(s)`}
                previousAmount={pp?.cost_of_services?.by_employee?.find(x => x.emp_id === e.emp_id)?.net_salary}
                isNegative />
            ))}
            <div className="px-6 py-2 bg-slate-50 border-t border-slate-200">
              <div className="flex justify-between text-xs text-slate-500">
                <span>Statutory: PF {fmt(cp.cost_of_services.pf_total)} | ESI {fmt(cp.cost_of_services.esi_total)} | Tax {fmt(cp.cost_of_services.tax_total)}</span>
                <span>{cp.cost_of_services.employee_count} employees</span>
              </div>
            </div>
            <LineItem label="TOTAL COST OF SERVICES" amount={cp.cost_of_services.total} bold isNegative
              previousAmount={pp?.cost_of_services?.total} />
          </CollapsibleSection>

          {/* ── GROSS PROFIT BAR ──────────────────────────────────────── */}
          <div className={`rounded-2xl p-5 border shadow-sm ${cp.gross_profit >= 0 ? 'bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200' : 'bg-gradient-to-r from-red-50 to-rose-50 border-red-200'}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Gross Profit</p>
                <p className={`text-3xl font-black mt-1 ${cp.gross_profit >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
                  {cp.gross_profit < 0 ? '-' : ''}{fmt(Math.abs(cp.gross_profit))}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">Gross Margin</p>
                <p className={`text-2xl font-black ${cp.gross_margin >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {pct(cp.gross_margin)}
                </p>
                {pp && <ChangeIndicator value={change(cp.gross_profit, pp.gross_profit)} />}
              </div>
            </div>
          </div>

          {/* OPERATING EXPENSES */}
          <CollapsibleSection title="Operating Expenses" icon={Receipt} iconColor="bg-amber-100 text-amber-600"
            total={cp.operating_expenses.total} count={cp.operating_expenses.by_category.length}>
            {cp.operating_expenses.by_category.map((e, i) => (
              <LineItem key={i} label={e.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} amount={e.amount}
                sublabel={`${e.count} entries`}
                previousAmount={pp?.operating_expenses?.by_category?.find(x => x.name === e.name)?.amount}
                isNegative />
            ))}
            {cp.operating_expenses.by_vendor.length > 0 && (
              <div className="px-6 py-2 bg-slate-50 border-t border-slate-100">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">By Vendor</p>
                {cp.operating_expenses.by_vendor.map((v, i) => (
                  <div key={i} className="flex justify-between py-1.5 text-xs text-slate-500">
                    <span>{v.name}</span>
                    <span className="font-semibold">{fmt(v.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <LineItem label="TOTAL OPERATING EXPENSES" amount={cp.operating_expenses.total} bold isNegative
              previousAmount={pp?.operating_expenses?.total} />
          </CollapsibleSection>

          {/* ── NET PROFIT BAR ─────────────────────────────────────── */}
          <div className={`rounded-2xl p-6 border-2 shadow-lg ${cp.net_profit >= 0 ? 'bg-gradient-to-r from-emerald-600 to-teal-600 border-emerald-500' : 'bg-gradient-to-r from-red-600 to-rose-600 border-red-500'}`}>
            <div className="flex items-center justify-between text-white">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider opacity-80">
                  {cp.net_profit >= 0 ? '✦ NET PROFIT' : '✦ NET LOSS'}
                </p>
                <p className="text-4xl font-black mt-1">
                  {cp.net_profit < 0 ? '-' : ''}{fmt(Math.abs(cp.net_profit))}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs opacity-80">Net Margin</p>
                <p className="text-3xl font-black">{pct(cp.net_margin)}</p>
                {pp && (
                  <div className="mt-2">
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${change(cp.net_profit, pp.net_profit) >= 0 ? 'bg-white/20' : 'bg-white/20'}`}>
                      vs prev: {fmt(pp.net_profit)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── TAX SUMMARY ─────────────────────────────────────────── */}
          <CollapsibleSection title="Tax Liability Summary" icon={Building2} iconColor="bg-purple-100 text-purple-600"
            defaultOpen={false}>
            <LineItem label="GST Collected (Output Tax)" amount={cp.tax_summary.gst_collected} />
            <div className="px-6 py-2 bg-slate-50 border-t border-slate-100">
              <div className="flex justify-between text-xs text-slate-500 py-1">
                <span>CGST</span><span className="font-semibold">{fmt(cp.tax_summary.cgst)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500 py-1">
                <span>SGST</span><span className="font-semibold">{fmt(cp.tax_summary.sgst)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500 py-1">
                <span>IGST</span><span className="font-semibold">{fmt(cp.tax_summary.igst)}</span>
              </div>
            </div>
            <LineItem label="TDS Deducted by Clients" amount={cp.tax_summary.tds_deducted} />
          </CollapsibleSection>

          {/* ── MONTHLY TREND CHART ──────────────────────────────────── */}
          {trendData.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 no-print">
              <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-teal-600" /> Monthly P&L Trend
              </h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trendData}>
                    <defs>
                      <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }}
                      tickFormatter={v => v >= 100000 ? `${(v/100000).toFixed(1)}L` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
                    <Tooltip contentStyle={tooltipStyle}
                      formatter={(val, name) => {
                        const label = name === 'revenue' ? 'Revenue' : name === 'total_costs' ? 'Total Costs' : 'Profit';
                        const displayVal = val >= 10000000 ? `${(val/10000000).toFixed(2)}Cr` : val >= 100000 ? `${(val/100000).toFixed(2)}L` : fmt(val);
                        return [displayVal, label];
                      }} />
                    <Legend formatter={v => v === 'revenue' ? 'Revenue' : v === 'total_costs' ? 'Total Costs' : 'Net Profit'} />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                    <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={20} opacity={0.7} />
                    <Bar dataKey="total_costs" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={20} opacity={0.7} />
                    <Area type="monotone" dataKey="profit" fill="url(#profitGradient)" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4, fill: '#10b981' }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── COMPARISON TABLE ──────────────────────────────────────── */}
          {pp && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden no-print">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-teal-600" /> Period Comparison
                </h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-200 bg-slate-50">
                    <th className="px-6 py-3 text-left font-semibold">Particulars</th>
                    <th className="px-6 py-3 text-right font-semibold">Current Period</th>
                    <th className="px-6 py-3 text-right font-semibold">Previous Period</th>
                    <th className="px-6 py-3 text-right font-semibold">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[
                    { label: 'Total Income', cur: cp.income.total, prev: pp.income.total },
                    { label: 'Cost of Services', cur: cp.cost_of_services.total, prev: pp.cost_of_services.total },
                    { label: 'Gross Profit', cur: cp.gross_profit, prev: pp.gross_profit, bold: true },
                    { label: 'Operating Expenses', cur: cp.operating_expenses.total, prev: pp.operating_expenses.total },
                    { label: 'Net Profit', cur: cp.net_profit, prev: pp.net_profit, bold: true },
                    { label: 'GST Collected', cur: cp.tax_summary.gst_collected, prev: pp.tax_summary.gst_collected },
                    { label: 'TDS Deducted', cur: cp.tax_summary.tds_deducted, prev: pp.tax_summary.tds_deducted },
                  ].map((row, i) => {
                    const chg = change(row.cur, row.prev);
                    return (
                      <tr key={i} className={row.bold ? 'bg-slate-50 font-bold' : ''}>
                        <td className="px-6 py-3 text-slate-700">{row.label}</td>
                        <td className="px-6 py-3 text-right font-mono tabular-nums">{fmt(row.cur)}</td>
                        <td className="px-6 py-3 text-right font-mono tabular-nums text-slate-500">{fmt(row.prev)}</td>
                        <td className="px-6 py-3 text-right">{chg !== null && <ChangeIndicator value={chg} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
