import { useState, useEffect } from 'react';
import { IndianRupee, Download, Building, Users, Wallet, Printer } from 'lucide-react';
import api from '../services/api';
import * as XLSX from 'xlsx';

export default function TaxReports() {
  const [activeTab, setActiveTab] = useState('gst-clients'); // 'gst-clients', 'gst-vendors', 'tds'
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState([]);
  
  const [dateRange, setDateRange] = useState(() => {
    const today = new Date();
    // Default from_date to 1st of current month
    const from_date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    const to_date = today.toISOString().split('T')[0];
    return { from_date, to_date };
  });

  const fetchData = async (abortController) => {
    try {
      setError('');
      
      // Date Validation
      if (!dateRange.from_date || !dateRange.to_date) return;
      const from = new Date(dateRange.from_date);
      const to = new Date(dateRange.to_date);
      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        setError('Invalid date format selected.');
        return;
      }
      if (to < from) {
        setError('End date cannot be earlier than start date.');
        return;
      }

      setLoading(true);
      const params = new URLSearchParams();
      params.append('from_date', dateRange.from_date);
      params.append('to_date', dateRange.to_date);

      let res;
      const reqConfig = { signal: abortController?.signal };
      
      if (activeTab === 'gst-clients') {
        params.append('type', 'client');
        res = await api.get(`/reports/gst-bifurcation?${params.toString()}`, reqConfig);
      } else if (activeTab === 'gst-vendors') {
        params.append('type', 'vendor');
        res = await api.get(`/reports/gst-bifurcation?${params.toString()}`, reqConfig);
      } else if (activeTab === 'tds') {
        res = await api.get(`/reports/tds?${params.toString()}`, reqConfig);
      }

      // Check if response contains array in data.data or just data
      const responseData = res?.data?.data || res?.data || [];
      setData(Array.isArray(responseData) ? responseData : []);
      
    } catch (err) {
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
      console.error('Failed to fetch tax reports:', err);
      setError('Failed to load reports. Please try again.');
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    window.scrollTo(0, 0);
    const abortController = new AbortController();
    fetchData(abortController);
    return () => abortController.abort();
  }, [activeTab, dateRange.from_date, dateRange.to_date]);

  const handleExport = async () => {
    if (!Array.isArray(data) || data.length === 0) return;
    
    try {
      setExporting(true);
      // Brief timeout to allow React to render loading state before heavy sync operation
      await new Promise(resolve => setTimeout(resolve, 50));
      
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
        data.forEach(row => {
          wsData.push([
            row.party_name,
            row.gst_number || 'N/A',
            parseFloat(row.total_taxable_value || 0),
            parseFloat(row.total_cgst || 0),
            parseFloat(row.total_sgst || 0),
            parseFloat(row.total_igst || 0),
            parseFloat(row.total_invoice_amount || 0),
            parseInt(row.invoice_count || 0, 10)
          ]);
        });
        
        // Totals
        const sumTaxable = data.reduce((s, r) => s + parseFloat(r.total_taxable_value || 0), 0);
        const sumCgst = data.reduce((s, r) => s + parseFloat(r.total_cgst || 0), 0);
        const sumSgst = data.reduce((s, r) => s + parseFloat(r.total_sgst || 0), 0);
        const sumIgst = data.reduce((s, r) => s + parseFloat(r.total_igst || 0), 0);
        const sumTotal = data.reduce((s, r) => s + parseFloat(r.total_invoice_amount || 0), 0);
        wsData.push(['Grand Total', '', sumTaxable, sumCgst, sumSgst, sumIgst, sumTotal, '']);
      } else {
        wsData.push(['Client Name', 'GSTIN', 'Total Amount Paid', 'Total TDS Deducted', 'Payment Count']);
        data.forEach(row => {
          wsData.push([
            row.client_name,
            row.gst_number || 'N/A',
            parseFloat(row.total_amount_paid || 0),
            parseFloat(row.total_tds_deducted || 0),
            parseInt(row.payment_count || 0, 10)
          ]);
        });
        
        // Totals
        const sumPaid = data.reduce((s, r) => s + parseFloat(r.total_amount_paid || 0), 0);
        const sumTds = data.reduce((s, r) => s + parseFloat(r.total_tds_deducted || 0), 0);
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
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to export data. Please try again.');
    } finally {
      setExporting(false);
    }
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
            {activeTab === 'tds' && 'TDS Receivable Report'}
            {' '}({dateRange.from_date} to {dateRange.to_date})
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto print:hidden">
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
            TDS Receivable
          </button>
        </div>

        <div className="p-6 print:p-0">
          {loading ? (
            <div className="flex justify-center items-center h-64 print:hidden">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 print:hidden">
                <span className="text-red-500 font-bold text-2xl">!</span>
              </div>
              <h3 className="text-lg font-medium text-slate-800 mb-1">Error Loading Data</h3>
              <p className="text-red-500">{error}</p>
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
                      <th className="px-6 py-4 text-center text-xs font-bold text-slate-500 uppercase tracking-wider print:text-black print:px-2">Invoices</th>
                    </tr>
                  ) : (
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider print:text-black print:px-2">Client Name</th>
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
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 text-right print:px-2 print:py-2">₹{parseFloat(row.total_taxable_value || 0).toLocaleString('en-IN')}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 text-right print:px-2 print:py-2">₹{parseFloat(row.total_cgst || 0).toLocaleString('en-IN')}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 text-right print:px-2 print:py-2">₹{parseFloat(row.total_sgst || 0).toLocaleString('en-IN')}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 text-right print:px-2 print:py-2">₹{parseFloat(row.total_igst || 0).toLocaleString('en-IN')}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-slate-800 text-right print:px-2 print:py-2">₹{parseFloat(row.total_invoice_amount || 0).toLocaleString('en-IN')}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 text-center print:px-2 print:py-2">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 print:bg-transparent print:border print:border-slate-300">
                              {parseInt(row.invoice_count || 0, 10)}
                            </span>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-800 print:px-2 print:py-2">{row.client_name}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 font-mono print:px-2 print:py-2">{row.gst_number || 'N/A'}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 text-right print:px-2 print:py-2">₹{parseFloat(row.total_amount_paid || 0).toLocaleString('en-IN')}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-teal-600 text-right print:px-2 print:py-2">₹{parseFloat(row.total_tds_deducted || 0).toLocaleString('en-IN')}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 text-center print:px-2 print:py-2">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 print:bg-transparent print:border print:border-slate-300">
                              {parseInt(row.payment_count || 0, 10)} {parseInt(row.payment_count || 0, 10) === 1 ? 'Payment' : 'Payments'}
                            </span>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                  {/* Totals Row */}
                  {data.length > 0 && (
                    <tr className="bg-slate-50 font-bold border-t-2 border-slate-300 print:bg-transparent print:border-black">
                      {activeTab.startsWith('gst') ? (
                        <>
                          <td colSpan={2} className="px-6 py-4 text-right text-slate-800 print:px-2">Grand Total:</td>
                          <td className="px-6 py-4 text-right text-slate-800 print:px-2">₹{data.reduce((sum, r) => sum + parseFloat(r.total_taxable_value || 0), 0).toLocaleString('en-IN')}</td>
                          <td className="px-6 py-4 text-right text-slate-800 print:px-2">₹{data.reduce((sum, r) => sum + parseFloat(r.total_cgst || 0), 0).toLocaleString('en-IN')}</td>
                          <td className="px-6 py-4 text-right text-slate-800 print:px-2">₹{data.reduce((sum, r) => sum + parseFloat(r.total_sgst || 0), 0).toLocaleString('en-IN')}</td>
                          <td className="px-6 py-4 text-right text-slate-800 print:px-2">₹{data.reduce((sum, r) => sum + parseFloat(r.total_igst || 0), 0).toLocaleString('en-IN')}</td>
                          <td className="px-6 py-4 text-right text-teal-700 print:px-2">₹{data.reduce((sum, r) => sum + parseFloat(r.total_invoice_amount || 0), 0).toLocaleString('en-IN')}</td>
                          <td></td>
                        </>
                      ) : (
                        <>
                          <td colSpan={2} className="px-6 py-4 text-right text-slate-800 print:px-2">Grand Total:</td>
                          <td className="px-6 py-4 text-right text-slate-800 print:px-2">₹{data.reduce((sum, r) => sum + parseFloat(r.total_amount_paid || 0), 0).toLocaleString('en-IN')}</td>
                          <td className="px-6 py-4 text-right text-teal-700 print:px-2">₹{data.reduce((sum, r) => sum + parseFloat(r.total_tds_deducted || 0), 0).toLocaleString('en-IN')}</td>
                          <td></td>
                        </>
                      )}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
