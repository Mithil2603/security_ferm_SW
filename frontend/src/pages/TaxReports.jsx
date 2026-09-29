import { useState, useEffect } from 'react';
import { IndianRupee, Download, Building, Users, Wallet, Printer, FileDown, FileText, ShoppingBag, ClipboardCheck } from 'lucide-react';
import api from '../services/api';
import * as XLSX from 'xlsx';
import { getApiBaseUrl } from '../utils/apiUrl';
import Pagination from '../components/Pagination';

// Local-date formatter — toISOString() converts to UTC first, which shifts
// the date by a day in timezones ahead of UTC (e.g. IST). Date-range defaults
// and quarter/month boundaries need the literal local calendar date, not a
// UTC-shifted one.
const toLocalDateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Indian financial year: Apr-Mar. Matches the same rule the backend uses to
// tag filings/snapshots, so "current FY" here always lines up with real data.
const getCurrentFY = () => {
  const now = new Date();
  const year = now.getFullYear();
  return now.getMonth() >= 3 ? `${year}-${String(year + 1).slice(2)}` : `${year - 1}-${String(year).slice(2)}`;
};

const fyStartYear = (fy) => parseInt(fy.split('-')[0], 10);

// Fixed Apr-Jun / Jul-Sep / Oct-Dec / Jan-Mar quarters for a given FY string
// (e.g. "2026-27"). Locks both boundaries — no partial-quarter selection.
const quarterRange = (fy, q) => {
  const startYear = fyStartYear(fy);
  const starts = { 1: [startYear, 3], 2: [startYear, 6], 3: [startYear, 9], 4: [startYear + 1, 0] };
  const [y, m] = starts[q];
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 3, 0);
  return { from_date: toLocalDateStr(start), to_date: toLocalDateStr(end) };
};

const getCurrentQuarter = () => {
  const m = new Date().getMonth(); // 0-indexed
  if (m >= 3 && m <= 5) return 1;
  if (m >= 6 && m <= 8) return 2;
  if (m >= 9 && m <= 11) return 3;
  return 4;
};

const buildFyOptions = () => {
  const current = fyStartYear(getCurrentFY());
  const opts = [];
  for (let y = current + 1; y >= current - 4; y--) {
    opts.push(`${y}-${String(y + 1).slice(2)}`);
  }
  return opts;
};

const QUARTER_LABELS = { 1: 'Q1 (Apr-Jun)', 2: 'Q2 (Jul-Sep)', 3: 'Q3 (Oct-Dec)', 4: 'Q4 (Jan-Mar)' };

export default function TaxReports() {
  const [activeTab, setActiveTab] = useState('gst-clients');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState([]);
  const [totals, setTotals] = useState({});
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);

  const [fy, setFy] = useState(getCurrentFY());
  const [quarter, setQuarter] = useState(getCurrentQuarter());
  const [customRange, setCustomRange] = useState(false);
  const [dateRange, setDateRange] = useState(quarterRange(getCurrentFY(), getCurrentQuarter()));

  const [gstr1a, setGstr1a] = useState(null);
  const [gstr2b, setGstr2b] = useState(null);
  const [gstr3bFilings, setGstr3bFilings] = useState([]);

  const fyOptions = buildFyOptions();
  const isNewReturnTab = activeTab === 'gstr1a' || activeTab === 'gstr2b' || activeTab === 'gstr3b';

  // Whenever FY or quarter changes (and we're not in custom range mode), the
  // date range is recomputed and locked to that quarter's real boundaries.
  useEffect(() => {
    if (!customRange) setDateRange(quarterRange(fy, quarter));
  }, [fy, quarter, customRange]);

  const fetchData = async () => {
    try {
      setLoading(true);

      if (activeTab === 'gstr1a') {
        const params = new URLSearchParams({ from_date: dateRange.from_date, to_date: dateRange.to_date });
        const res = await api.get(`/gst/gstr1/preview?${params.toString()}`);
        setGstr1a(res.data || null);
      } else if (activeTab === 'gstr2b') {
        const params = new URLSearchParams({ from_date: dateRange.from_date, to_date: dateRange.to_date });
        const res = await api.get(`/gst/gstr2b?${params.toString()}`);
        setGstr2b(res.data || null);
      } else if (activeTab === 'gstr3b') {
        const res = await api.get(`/gst/filings?return_type=GSTR3B&financial_year=${fy}&limit=12`);
        setGstr3bFilings(res.data || []);
      } else {
        const params = new URLSearchParams();
        params.append('from_date', dateRange.from_date);
        params.append('to_date', dateRange.to_date);
        params.append('page', page);
        params.append('limit', '20');

        let res;
        if (activeTab === 'gst-clients') {
          params.append('type', 'client');
          res = await api.get(`/reports/gst-bifurcation?${params.toString()}`);
        } else if (activeTab === 'gst-vendors') {
          params.append('type', 'vendor');
          res = await api.get(`/reports/gst-bifurcation?${params.toString()}`);
        } else if (activeTab === 'tds') {
          params.append('type', 'client');
          res = await api.get(`/reports/tds?${params.toString()}`);
        } else if (activeTab === 'tds-vendors') {
          params.append('type', 'vendor');
          res = await api.get(`/reports/tds?${params.toString()}`);
        }

        setData(res.data || []);
        setTotals(res.totals || {});
        setPagination(res.pagination || null);
      }
    } catch (err) {
      console.error('Failed to fetch tax reports', err);
      setData([]);
      setTotals({});
      setPagination(null);
      setGstr1a(null);
      setGstr2b(null);
      setGstr3bFilings([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab, dateRange.from_date, dateRange.to_date, page, fy]);

  useEffect(() => { setPage(1); }, [activeTab, dateRange.from_date, dateRange.to_date]);

  const handleDownloadPdf = () => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const params = new URLSearchParams();
    if (dateRange.from_date) params.set('from_date', dateRange.from_date);
    if (dateRange.to_date) params.set('to_date', dateRange.to_date);
    if (token) params.set('token', token);

    let endpoint = '';
    if (activeTab === 'gst-clients') { params.set('type', 'client'); endpoint = 'gst-bifurcation'; }
    else if (activeTab === 'gst-vendors') { params.set('type', 'vendor'); endpoint = 'gst-bifurcation'; }
    else if (activeTab === 'tds') { params.set('type', 'client'); endpoint = 'tds'; }
    else if (activeTab === 'tds-vendors') { params.set('type', 'vendor'); endpoint = 'tds'; }
    if (!endpoint) return;

    window.open(`${getApiBaseUrl()}/reports/${endpoint}/pdf?${params.toString()}`, '_blank');
  };

  const handleExport = async () => {
    // Excel export must contain every matching party, not just the on-screen
    // page — fetch fresh with a high limit rather than exporting `data`
    // (which only ever holds the current page since pagination was added).
    let fullData = data;
    try {
      const params = new URLSearchParams();
      if (dateRange.from_date) params.append('from_date', dateRange.from_date);
      if (dateRange.to_date) params.append('to_date', dateRange.to_date);
      params.append('page', '1');
      params.append('limit', '100000');
      let res;
      if (activeTab === 'gst-clients') { params.append('type', 'client'); res = await api.get(`/reports/gst-bifurcation?${params.toString()}`); }
      else if (activeTab === 'gst-vendors') { params.append('type', 'vendor'); res = await api.get(`/reports/gst-bifurcation?${params.toString()}`); }
      else if (activeTab === 'tds') { params.append('type', 'client'); res = await api.get(`/reports/tds?${params.toString()}`); }
      else if (activeTab === 'tds-vendors') { params.append('type', 'vendor'); res = await api.get(`/reports/tds?${params.toString()}`); }
      fullData = res?.data || data;
    } catch (err) {
      console.error('Failed to fetch full report for export, falling back to current page', err);
    }

    const wb = XLSX.utils.book_new();
    const wsData = [];

    // Add Title and Date Range
    let reportTitle = '';
    if (activeTab === 'gst-clients') reportTitle = 'GST Bifurcation (Clients)';
    else if (activeTab === 'gst-vendors') reportTitle = 'GST Bifurcation (Vendors)';
    else if (activeTab === 'tds') reportTitle = 'TDS Receivable Report';

    wsData.push([reportTitle]);
    wsData.push([`Period: ${dateRange.from_date} to ${dateRange.to_date}`]);
    wsData.push([]); // blank row

    if (activeTab.startsWith('gst')) {
      wsData.push(['Party Name', 'GSTIN', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total Amount', 'Invoice Count']);
      fullData.forEach(row => {
        wsData.push([
          row.party_name,
          row.gst_number || 'N/A',
          row.total_taxable_value || 0,
          row.total_cgst || 0,
          row.total_sgst || 0,
          row.total_igst || 0,
          row.total_invoice_amount || 0,
          row.invoice_count
        ]);
      });

      // Totals
      const sumTaxable = fullData.reduce((s, r) => s + (r.total_taxable_value || 0), 0);
      const sumCgst = fullData.reduce((s, r) => s + (r.total_cgst || 0), 0);
      const sumSgst = fullData.reduce((s, r) => s + (r.total_sgst || 0), 0);
      const sumIgst = fullData.reduce((s, r) => s + (r.total_igst || 0), 0);
      const sumTotal = fullData.reduce((s, r) => s + (r.total_invoice_amount || 0), 0);
      wsData.push(['Grand Total', '', sumTaxable, sumCgst, sumSgst, sumIgst, sumTotal, '']);
    } else {
      wsData.push(['Party Name', 'GSTIN', 'Total Amount Paid', 'Total TDS Deducted', 'Payment Count']);
      fullData.forEach(row => {
        wsData.push([
          row.client_name || row.vendor_name,
          row.gst_number || 'N/A',
          row.total_amount_paid || 0,
          row.total_tds_deducted || 0,
          row.payment_count
        ]);
      });

      // Totals
      const sumPaid = fullData.reduce((s, r) => s + (r.total_amount_paid || 0), 0);
      const sumTds = fullData.reduce((s, r) => s + (r.total_tds_deducted || 0), 0);
      wsData.push(['Grand Total', '', sumPaid, sumTds, '']);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Auto-size columns for better readability
    const colWidths = [
      { wch: 30 }, // Name
      { wch: 20 }, // GSTIN
      { wch: 18 }, // Col 3
      { wch: 18 }, // Col 4
      { wch: 18 }, // Col 5
      { wch: 18 }, // Col 6
      { wch: 18 }, // Col 7
      { wch: 15 }, // Col 8
    ];
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `Tax_Report_${activeTab}_${dateRange.from_date}_to_${dateRange.to_date}.xlsx`);
  };

  const tabLabel = {
    'gst-clients': 'GST Bifurcation (Clients)',
    'gst-vendors': 'GST Bifurcation (Vendors)',
    'tds': 'TDS Receivable Report (Clients)',
    'tds-vendors': 'TDS Deducted Report (Vendors)',
    'gstr1a': 'GSTR-1A — Outward Supplies Breakdown',
    'gstr2b': 'GSTR-2B — Purchase / ITC Register',
    'gstr3b': 'GSTR-3B — Filed Summary Returns',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 print:shadow-none print:border-none print:p-0 print:gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <IndianRupee className="w-8 h-8 text-teal-600 p-1.5 bg-teal-100 rounded-lg print:hidden" />
            Tax Reports
          </h1>
          <p className="text-slate-500 mt-1">
            {tabLabel[activeTab]}
            {activeTab === 'gstr3b' ? ` (FY ${fy})` : ` (${dateRange.from_date} to ${dateRange.to_date})`}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto print:hidden">
          <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
            <select
              value={fy}
              onChange={(e) => setFy(e.target.value)}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm font-medium focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              title="Financial Year"
            >
              {fyOptions.map(f => <option key={f} value={f}>FY {f}</option>)}
            </select>
            {activeTab !== 'gstr3b' && (
              <select
                value={customRange ? 'custom' : quarter}
                onChange={(e) => {
                  if (e.target.value === 'custom') { setCustomRange(true); }
                  else { setCustomRange(false); setQuarter(parseInt(e.target.value, 10)); }
                }}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm font-medium focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                title="Quarter"
              >
                {[1, 2, 3, 4].map(q => <option key={q} value={q}>{QUARTER_LABELS[q]}</option>)}
                <option value="custom">Custom Range</option>
              </select>
            )}
          </div>
          {customRange && activeTab !== 'gstr3b' && (
            <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
              <input
                type="date"
                value={dateRange.from_date}
                onChange={(e) => setDateRange(prev => ({ ...prev, from_date: e.target.value }))}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
              <span className="text-slate-400 font-medium">to</span>
              <input
                type="date"
                value={dateRange.to_date}
                onChange={(e) => setDateRange(prev => ({ ...prev, to_date: e.target.value }))}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
          )}
          {!isNewReturnTab && (
            <>
              <button
                onClick={handleExport}
                disabled={loading || data.length === 0}
                className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors flex items-center gap-2 disabled:opacity-50 font-medium"
              >
                <Download className="w-4 h-4" /> Export
              </button>
              <button
                onClick={handleDownloadPdf}
                disabled={loading || data.length === 0}
                className="px-4 py-2 bg-rose-700 text-white rounded-lg hover:bg-rose-800 transition-colors flex items-center gap-2 disabled:opacity-50 font-medium"
              >
                <FileDown className="w-4 h-4" /> PDF
              </button>
            </>
          )}
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-2 font-medium"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden print:shadow-none print:border-none">
        <div className="flex border-b border-slate-200 p-2 gap-2 bg-slate-50/50 print:hidden overflow-x-auto">
          <button
            onClick={() => setActiveTab('gst-clients')}
            className={`px-4 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'gst-clients'
                ? 'bg-white text-teal-700 shadow-sm border border-slate-200/60'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/80'
            }`}
          >
            <Users className="w-4 h-4" />
            GST Bifurcation (Clients)
          </button>
          <button
            onClick={() => setActiveTab('gst-vendors')}
            className={`px-4 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'gst-vendors'
                ? 'bg-white text-teal-700 shadow-sm border border-slate-200/60'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/80'
            }`}
          >
            <Building className="w-4 h-4" />
            GST Bifurcation (Vendors)
          </button>
          <button
            onClick={() => setActiveTab('tds')}
            className={`px-4 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'tds'
                ? 'bg-white text-teal-700 shadow-sm border border-slate-200/60'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/80'
            }`}
          >
            <Wallet className="w-4 h-4" />
            TDS Receivable (Clients)
          </button>
          <button
            onClick={() => setActiveTab('tds-vendors')}
            className={`px-4 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'tds-vendors'
                ? 'bg-white text-teal-700 shadow-sm border border-slate-200/60'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/80'
            }`}
          >
            <Wallet className="w-4 h-4" />
            TDS Deducted (Vendors)
          </button>
          <button
            onClick={() => setActiveTab('gstr1a')}
            className={`px-4 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'gstr1a'
                ? 'bg-white text-teal-700 shadow-sm border border-slate-200/60'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/80'
            }`}
          >
            <FileText className="w-4 h-4" />
            GSTR-1A
          </button>
          <button
            onClick={() => setActiveTab('gstr2b')}
            className={`px-4 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'gstr2b'
                ? 'bg-white text-teal-700 shadow-sm border border-slate-200/60'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/80'
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            GSTR-2B
          </button>
          <button
            onClick={() => setActiveTab('gstr3b')}
            className={`px-4 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'gstr3b'
                ? 'bg-white text-teal-700 shadow-sm border border-slate-200/60'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/80'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            GSTR-3B
          </button>
        </div>

        <div className="p-6 print:p-0">
          {loading ? (
            <div className="flex justify-center items-center h-64 print:hidden">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
            </div>
          ) : activeTab === 'gstr1a' ? (
            <GSTR1APanel data={gstr1a} />
          ) : activeTab === 'gstr2b' ? (
            <GSTR2BPanel data={gstr2b} />
          ) : activeTab === 'gstr3b' ? (
            <GSTR3BPanel filings={gstr3bFilings} />
          ) : (
            <>
              {activeTab.startsWith('gst') && data.length > 0 && (() => {
                const isVendor = activeTab === 'gst-vendors';
                // Sums come from the backend's `totals` (computed across ALL matching
                // parties before pagination), not just the rows on the current page.
                const sumTaxable = totals.total_taxable_value || 0;
                const sumCgst = totals.total_cgst || 0;
                const sumSgst = totals.total_sgst || 0;
                const sumIgst = totals.total_igst || 0;
                const sumGst = sumCgst + sumSgst + sumIgst;
                return (
                  <div className={`mb-6 p-5 rounded-2xl border ${isVendor ? 'bg-amber-50/60 border-amber-200' : 'bg-teal-50/60 border-teal-200'}`}>
                    <p className={`text-xs font-bold uppercase tracking-wide mb-3 ${isVendor ? 'text-amber-800' : 'text-teal-800'}`}>
                      {isVendor
                        ? `GST Paid Summary (Input Tax Credit) — ready for GSTR-3B (${dateRange.from_date} to ${dateRange.to_date})`
                        : `GST Payable Summary (Output Tax) — ready for GSTR-3B (${dateRange.from_date} to ${dateRange.to_date})`}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                      <div className={`p-3 bg-white rounded-xl border ${isVendor ? 'border-amber-100' : 'border-teal-100'}`}>
                        <div className="text-[10px] text-slate-500 uppercase">Taxable Value</div>
                        <div className="font-bold text-slate-800">₹{sumTaxable.toLocaleString('en-IN')}</div>
                      </div>
                      <div className={`p-3 bg-white rounded-xl border ${isVendor ? 'border-amber-100' : 'border-teal-100'}`}>
                        <div className="text-[10px] text-slate-500 uppercase">CGST</div>
                        <div className="font-bold text-slate-800">₹{sumCgst.toLocaleString('en-IN')}</div>
                      </div>
                      <div className={`p-3 bg-white rounded-xl border ${isVendor ? 'border-amber-100' : 'border-teal-100'}`}>
                        <div className="text-[10px] text-slate-500 uppercase">SGST</div>
                        <div className="font-bold text-slate-800">₹{sumSgst.toLocaleString('en-IN')}</div>
                      </div>
                      <div className={`p-3 bg-white rounded-xl border ${isVendor ? 'border-amber-100' : 'border-teal-100'}`}>
                        <div className="text-[10px] text-slate-500 uppercase">IGST</div>
                        <div className="font-bold text-slate-800">₹{sumIgst.toLocaleString('en-IN')}</div>
                      </div>
                      <div className={`p-3 rounded-xl ${isVendor ? 'bg-amber-600' : 'bg-teal-700'}`}>
                        <div className={`text-[10px] uppercase ${isVendor ? 'text-amber-100' : 'text-teal-100'}`}>
                          {isVendor ? 'Total GST Paid (ITC)' : 'Total GST Payable'}
                        </div>
                        <div className="font-bold text-white">₹{sumGst.toLocaleString('en-IN')}</div>
                      </div>
                    </div>
                    {isVendor && (
                      <p className="text-[11px] text-amber-700 mt-3">
                        This is Input Tax Credit paid to vendors — it offsets against the Total GST Payable on the Clients tab when you actually file GSTR-3B, it isn't a separate amount you pay out.
                      </p>
                    )}
                  </div>
                );
              })()}
              {data.length === 0 ? (
                <div className="text-center py-12">
                  <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 print:hidden">
                    <IndianRupee className="w-8 h-8 text-slate-400" />
                  </div>
                  <h3 className="text-lg font-medium text-slate-800 mb-1">No Data Found</h3>
                  <p className="text-slate-500">No records found for the selected date range.</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 print:border-none">
                  <table className="min-w-full divide-y divide-slate-200 print:divide-slate-400">
                    <thead className="bg-slate-50 print:bg-transparent">
                      {activeTab.startsWith('gst') ? (
                        <tr>
                          <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider print:text-black print:px-2">Party Name</th>
                          <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider print:text-black print:px-2">GSTIN</th>
                          <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider print:text-black print:px-2">Taxable Base</th>
                          <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider print:text-black print:px-2">CGST</th>
                          <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider print:text-black print:px-2">SGST</th>
                          <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider print:text-black print:px-2">IGST</th>
                          <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider print:text-black print:px-2">Total Amount</th>
                        </tr>
                      ) : (
                        <tr>
                          <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider print:text-black print:px-2">{activeTab === 'tds-vendors' ? 'Vendor Name' : 'Client Name'}</th>
                          <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider print:text-black print:px-2">GSTIN</th>
                          <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider print:text-black print:px-2">Total Paid</th>
                          <th className="px-6 py-4 text-right text-xs font-bold text-teal-600 uppercase tracking-wider print:text-black print:px-2">TDS Deducted</th>
                          <th className="px-6 py-4 text-center text-xs font-bold text-slate-500 uppercase tracking-wider print:text-black print:px-2">Payments</th>
                        </tr>
                      )}
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200 print:divide-slate-300">
                      {data.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                          {activeTab.startsWith('gst') ? (
                            <>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-800 print:px-2 print:py-2">{row.party_name}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 font-mono print:px-2 print:py-2">{row.gst_number || 'N/A'}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 text-right print:px-2 print:py-2">₹{(row.total_taxable_value || 0).toLocaleString()}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 text-right print:px-2 print:py-2">₹{(row.total_cgst || 0).toLocaleString()}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 text-right print:px-2 print:py-2">₹{(row.total_sgst || 0).toLocaleString()}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 text-right print:px-2 print:py-2">₹{(row.total_igst || 0).toLocaleString()}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-slate-800 text-right print:px-2 print:py-2">₹{(row.total_invoice_amount || 0).toLocaleString()}</td>
                            </>
                          ) : (
                            <>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-800 print:px-2 print:py-2">{row.client_name || row.vendor_name}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 font-mono print:px-2 print:py-2">{row.gst_number || 'N/A'}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 text-right print:px-2 print:py-2">₹{(row.total_amount_paid || 0).toLocaleString()}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-teal-600 text-right print:px-2 print:py-2">₹{(row.total_tds_deducted || 0).toLocaleString()}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 text-center print:px-2 print:py-2">
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 print:bg-transparent print:border print:border-slate-300">
                                  {row.payment_count} {row.payment_count === 1 ? 'pmt' : 'pmts'}
                                </span>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                      {/* Totals Row — from the backend's unpaginated `totals`, so it
                          always reflects every matching party, not just this page. */}
                      <tr className="bg-slate-50 font-bold border-t-2 border-slate-300 print:bg-transparent print:border-black">
                        {activeTab.startsWith('gst') ? (
                          <>
                            <td colSpan={2} className="px-6 py-4 text-right text-slate-800 print:px-2">Grand Total:</td>
                            <td className="px-6 py-4 text-right text-slate-800 print:px-2">₹{(totals.total_taxable_value || 0).toLocaleString()}</td>
                            <td className="px-6 py-4 text-right text-slate-800 print:px-2">₹{(totals.total_cgst || 0).toLocaleString()}</td>
                            <td className="px-6 py-4 text-right text-slate-800 print:px-2">₹{(totals.total_sgst || 0).toLocaleString()}</td>
                            <td className="px-6 py-4 text-right text-slate-800 print:px-2">₹{(totals.total_igst || 0).toLocaleString()}</td>
                            <td className="px-6 py-4 text-right text-teal-700 print:px-2">₹{(totals.total_invoice_amount || 0).toLocaleString()}</td>
                          </>
                        ) : (
                          <>
                            <td colSpan={2} className="px-6 py-4 text-right text-slate-800 print:px-2">Grand Total:</td>
                            <td className="px-6 py-4 text-right text-slate-800 print:px-2">₹{(totals.total_amount_paid || 0).toLocaleString()}</td>
                            <td className="px-6 py-4 text-right text-teal-700 print:px-2">₹{(totals.total_tds_deducted || 0).toLocaleString()}</td>
                            <td></td>
                          </>
                        )}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              {data.length > 0 && (
                <div className="mt-2 print:hidden">
                  <Pagination pagination={pagination} onPageChange={setPage} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyPanel({ label }) {
  return (
    <div className="text-center py-12">
      <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
        <IndianRupee className="w-8 h-8 text-slate-400" />
      </div>
      <h3 className="text-lg font-medium text-slate-800 mb-1">No Data Found</h3>
      <p className="text-slate-500">{label || 'No records found for the selected period.'}</p>
    </div>
  );
}

function SummaryStat({ label, value, highlight }) {
  return (
    <div className={`p-3 rounded-xl border text-center ${highlight ? 'bg-teal-700 border-teal-700' : 'bg-white border-teal-100'}`}>
      <div className={`text-[10px] uppercase ${highlight ? 'text-teal-100' : 'text-slate-500'}`}>{label}</div>
      <div className={`font-bold ${highlight ? 'text-white' : 'text-slate-800'}`}>₹{(value || 0).toLocaleString('en-IN')}</div>
    </div>
  );
}

function GSTR1APanel({ data }) {
  if (!data) return <EmptyPanel />;
  const { b2b, b2cs, b2cl, summary } = data;
  const sections = [
    { key: 'b2b', title: 'B2B — Registered Buyers (with GSTIN)', rows: b2b },
    { key: 'b2cl', title: 'B2CL — Unregistered, Invoice Value > ₹1 Lakh', rows: b2cl },
    { key: 'b2cs', title: 'B2CS — Unregistered, Small Value (aggregated by rate)', rows: b2cs },
  ];
  if (summary.total_invoices === 0) return <EmptyPanel label="No invoices found for the selected quarter." />;
  return (
    <div className="space-y-6">
      <div className="p-5 rounded-2xl border bg-teal-50/60 border-teal-200">
        <p className="text-xs font-bold uppercase tracking-wide mb-3 text-teal-800">
          GSTR-1A Breakdown Summary — {summary.total_invoices} invoice(s) ({summary.b2b_count} B2B, {summary.b2cl_count} B2CL, {summary.b2cs_count} B2CS)
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryStat label="Taxable Value" value={summary.total_taxable} />
          <SummaryStat label="CGST" value={summary.total_cgst} />
          <SummaryStat label="SGST" value={summary.total_sgst} />
          <SummaryStat label="IGST" value={summary.total_igst} />
        </div>
      </div>
      {sections.map(sec => (
        <div key={sec.key}>
          <h4 className="text-sm font-bold text-slate-700 mb-2">{sec.title} ({sec.rows.length})</h4>
          {sec.rows.length === 0 ? (
            <p className="text-sm text-slate-400 italic px-2">No records in this category.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Invoice #</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Buyer</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">GSTIN</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Taxable</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">CGST</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">SGST</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">IGST</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Invoice Value</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {sec.rows.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 text-sm font-medium text-slate-800">{r.invoice_number}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{r.invoice_date}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{r.buyer_name}</td>
                      <td className="px-4 py-3 text-sm text-slate-500 font-mono">{r.buyer_gstin || 'N/A'}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 text-right">₹{r.taxable_value.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 text-right">₹{r.cgst.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 text-right">₹{r.sgst.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 text-right">₹{r.igst.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm font-bold text-slate-800 text-right">₹{r.invoice_value.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function GSTR2BPanel({ data }) {
  if (!data) return <EmptyPanel />;
  const { rows, summary } = data;
  if (summary.bill_count === 0) return <EmptyPanel label="No GST-bearing vendor bills found for the selected quarter." />;
  return (
    <div className="space-y-6">
      <div className="p-5 rounded-2xl border bg-amber-50/60 border-amber-200">
        <p className="text-xs font-bold uppercase tracking-wide mb-3 text-amber-800">
          GSTR-2B Purchase / ITC Register — {summary.bill_count} bill(s)
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <SummaryStat label="Taxable Value" value={summary.total_taxable} />
          <SummaryStat label="CGST" value={summary.total_cgst} />
          <SummaryStat label="SGST" value={summary.total_sgst} />
          <SummaryStat label="IGST" value={summary.total_igst} />
          <SummaryStat label="Total ITC" value={summary.total_itc} highlight />
        </div>
        <p className="text-[11px] text-amber-700 mt-3">
          Self-reported from vendor bills recorded in Expenses. Real GSTR-2B is auto-drafted by the GST portal from what
          vendors file on their own returns — since this app has no GSTN integration, treat this as your internal purchase
          register to reconcile against the portal's GSTR-2B once it's available.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Bill Date</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Vendor</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">GSTIN</th>
              <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Description</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Taxable</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">CGST</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">SGST</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">IGST</th>
              <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase">RCM</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50/80">
                <td className="px-4 py-3 text-sm text-slate-600">{r.bill_date}</td>
                <td className="px-4 py-3 text-sm font-medium text-slate-800">{r.vendor_name}</td>
                <td className="px-4 py-3 text-sm text-slate-500 font-mono">{r.vendor_gstin}</td>
                <td className="px-4 py-3 text-sm text-slate-600 max-w-xs truncate">{r.description}</td>
                <td className="px-4 py-3 text-sm text-slate-600 text-right">₹{r.taxable_value.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-slate-600 text-right">₹{r.cgst.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-slate-600 text-right">₹{r.sgst.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-slate-600 text-right">₹{r.igst.toLocaleString()}</td>
                <td className="px-4 py-3 text-center">
                  {r.is_rcm_applicable && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">RCM</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const FILING_STATUS_STYLES = {
  draft: 'bg-slate-100 text-slate-700',
  generated: 'bg-blue-100 text-blue-700',
  filed: 'bg-emerald-100 text-emerald-700',
};

function GSTR3BPanel({ filings }) {
  if (!filings || filings.length === 0) {
    return <EmptyPanel label="No GSTR-3B filings generated yet for this financial year. Generate one from GST Compliance → GSTR-3B." />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Return Period</th>
            <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Taxable Value</th>
            <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">CGST</th>
            <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">SGST</th>
            <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">IGST</th>
            <th className="px-6 py-4 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Invoices</th>
            <th className="px-6 py-4 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Filed Date</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-slate-200">
          {filings.map((f) => (
            <tr key={f.id} className="hover:bg-slate-50/80">
              <td className="px-6 py-4 text-sm font-medium text-slate-800">{f.return_period}</td>
              <td className="px-6 py-4 text-sm text-slate-600 text-right">₹{(f.total_taxable_value || 0).toLocaleString()}</td>
              <td className="px-6 py-4 text-sm text-slate-600 text-right">₹{(f.total_cgst || 0).toLocaleString()}</td>
              <td className="px-6 py-4 text-sm text-slate-600 text-right">₹{(f.total_sgst || 0).toLocaleString()}</td>
              <td className="px-6 py-4 text-sm text-slate-600 text-right">₹{(f.total_igst || 0).toLocaleString()}</td>
              <td className="px-6 py-4 text-sm text-slate-500 text-center">{f.total_invoices}</td>
              <td className="px-6 py-4 text-center">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${FILING_STATUS_STYLES[f.status] || 'bg-slate-100 text-slate-700'}`}>
                  {f.status}
                </span>
              </td>
              <td className="px-6 py-4 text-sm text-slate-500">{f.filed_date ? new Date(f.filed_date).toLocaleDateString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
