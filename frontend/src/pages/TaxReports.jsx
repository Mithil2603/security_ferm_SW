import { useState, useEffect } from 'react';
import { IndianRupee, Download, Building, Users, Wallet, Printer, FileDown } from 'lucide-react';
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

export default function TaxReports() {
  const [activeTab, setActiveTab] = useState('gst-clients'); // 'gst-clients', 'gst-vendors', 'tds'
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState([]);
  const [totals, setTotals] = useState({});
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [dateRange, setDateRange] = useState({
    from_date: `${new Date().getFullYear()}-01-01`,
    to_date: toLocalDateStr(new Date())
  });

  // Indian FY quarters: Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar.
  // GSTR-3B/TDS returns are both filed on this cycle, so it's useful for any tab.
  const setQuarterPreset = (q) => {
    const now = new Date();
    // FY start year: if today is Jan-Mar, the current FY started last calendar year.
    const fyStartYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
    const quarterStartMonth = { 1: 3, 2: 6, 3: 9, 4: 0 }[q]; // 0-indexed months
    const quarterYear = q === 4 ? fyStartYear + 1 : fyStartYear;
    const start = new Date(quarterYear, quarterStartMonth, 1);
    const end = new Date(quarterYear, quarterStartMonth + 3, 0);
    setDateRange({
      from_date: toLocalDateStr(start),
      to_date: toLocalDateStr(end)
    });
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (dateRange.from_date) params.append('from_date', dateRange.from_date);
      if (dateRange.to_date) params.append('to_date', dateRange.to_date);
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
    } catch (err) {
      console.error('Failed to fetch tax reports', err);
      setData([]);
      setTotals({});
      setPagination(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab, dateRange.from_date, dateRange.to_date, page]);

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

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 print:shadow-none print:border-none print:p-0 print:gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <IndianRupee className="w-8 h-8 text-teal-600 p-1.5 bg-teal-100 rounded-lg print:hidden" />
            Tax Reports
          </h1>
          <p className="text-slate-500 mt-1">
            {activeTab === 'gst-clients' && 'GST Bifurcation (Clients)'}
            {activeTab === 'gst-vendors' && 'GST Bifurcation (Vendors)'}
            {activeTab === 'tds' && 'TDS Receivable Report (Clients)'}
            {activeTab === 'tds-vendors' && 'TDS Deducted Report (Vendors)'}
            {' '}({dateRange.from_date} to {dateRange.to_date})
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto print:hidden">
          <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200">
            {[1, 2, 3, 4].map(q => (
              <button
                key={q}
                onClick={() => setQuarterPreset(q)}
                className="px-2.5 py-1.5 text-xs font-semibold text-teal-700 bg-white hover:bg-teal-50 rounded-md border border-slate-200 transition-colors"
                title={`FY Quarter ${q}`}
              >
                Q{q}
              </button>
            ))}
          </div>
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
        </div>

        <div className="p-6 print:p-0">
          {!loading && activeTab.startsWith('gst') && data.length > 0 && (() => {
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
          {loading ? (
            <div className="flex justify-center items-center h-64 print:hidden">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
            </div>
          ) : data.length === 0 ? (
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
          {!loading && data.length > 0 && (
            <div className="mt-2 print:hidden">
              <Pagination pagination={pagination} onPageChange={setPage} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
