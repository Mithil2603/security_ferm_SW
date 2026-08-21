import { useState, useEffect, useRef } from 'react';
import DrillDownModal from '../components/DrillDownModal';
import { PieChart as PieChartIcon, TrendingUp, TrendingDown, Download, IndianRupee, Printer, Calendar, FileSpreadsheet, AlertTriangle, CheckCircle, Clock, Users, Eye, EyeOff, Activity, Zap, Target, Shield, Info, RotateCw, Banknote, Receipt, Wallet, Percent, Briefcase } from 'lucide-react';
import api from '../services/api';
import { getApiBaseUrl } from '../utils/apiUrl';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList, LineChart, Line, ReferenceLine, ComposedChart, Area } from 'recharts';
import * as XLSX from 'xlsx';
const COLORS = ['#4a90e2', '#f5a623', '#50e3c2', '#ef4444', '#8b5cf6', '#ec4899'];
const BAR_COLORS = ['#3b4d6e', '#2c7a7b', '#68b36b', '#f6ad55', '#fc8181'];

const tooltipStyle = {
  backgroundColor: 'rgba(255, 255, 255, 0.95)',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(226, 232, 240, 0.8)',
  borderRadius: '12px',
  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
  padding: '12px',
  fontWeight: 'bold'
};

// Helper to apply styles to a range of cells
const styleRange = (ws, range, style) => {
  const [start, end] = range.split(':');
  const decode = XLSX.utils.decode_range(`${start}:${end || start}`);
  for (let R = decode.s.r; R <= decode.e.r; R++) {
    for (let C = decode.s.c; C <= decode.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      ws[addr].s = style;
    }
  }
};

const FlipCard = ({ children, infoTitle, infoText, infoIcon: InfoIcon, containerClassName = "" }) => {
  const [isFlipped, setIsFlipped] = useState(false);

  return (
    <div className={`relative perspective-1000 group ${containerClassName}`}>
      <div className={`w-full h-full transition-transform duration-700 transform-style-3d ${isFlipped ? 'rotate-y-180' : ''}`}>
        
        {/* Front */}
        <div className="backface-hidden w-full h-full relative z-10">
          {children}
          <button 
            onClick={() => setIsFlipped(true)}
            className="absolute top-2 right-2 p-1.5 bg-slate-100/80 hover:bg-teal-100 text-slate-400 hover:text-teal-600 rounded-full backdrop-blur-sm transition-all z-20 opacity-0 group-hover:opacity-100 shadow-sm no-print"
            title="What is this?"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>

        {/* Back */}
        <div className="absolute inset-0 backface-hidden w-full h-full rotate-y-180 bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col justify-center items-center text-center shadow-inner z-0 overflow-y-auto no-print flex-1 min-h-0">
          <button 
            onClick={() => setIsFlipped(false)}
            className="absolute top-2 right-2 p-1.5 bg-slate-200 hover:bg-slate-300 text-slate-600 rounded-full transition-colors z-20"
            title="Go back"
          >
            <RotateCw className="w-4 h-4" />
          </button>
          
          <div className="w-10 h-10 bg-teal-100 text-teal-600 rounded-full flex items-center justify-center mb-3 shrink-0">
            {InfoIcon ? <InfoIcon className="w-5 h-5" /> : <Info className="w-5 h-5" />}
          </div>
          <h4 className="font-bold text-slate-800 text-sm mb-1">{infoTitle}</h4>
          <p className="text-xs text-slate-600 leading-relaxed max-w-[90%]">
            {infoText}
          </p>
        </div>
      </div>
    </div>
  );
};

export default function Reports() {
  const [loading, setLoading] = useState(true);
  const [exportingSheet, setExportingSheet] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expenseData, setExpenseData] = useState([]);
  const [plData, setPlData] = useState(null);
  const [advancedData, setAdvancedData] = useState(null);
  const [trendData, setTrendData] = useState(null);
  const [agingData, setAgingData] = useState(null);
  const [bizData, setBizData] = useState(null);
  const [costPerGuardData, setCostPerGuardData] = useState(null);
  const [tdsData, setTdsData] = useState([]);
  const [dateRange, setDateRange] = useState({
    from_date: '2024-08-01',
    to_date: new Date().toISOString().split('T')[0]
  });

  const [drillDownModal, setDrillDownModal] = useState({
    isOpen: false,
    title: '',
    data: [],
    columns: [],
    type: ''
  });

  const handleKpiClick = async (type) => {
    try {
      const params = new URLSearchParams();
      if (dateRange.from_date) params.append('from_date', dateRange.from_date);
      if (dateRange.to_date) params.append('to_date', dateRange.to_date);
      const queryStr = params.toString() ? `?${params.toString()}` : '';

      if (type === 'billed') {
        const res = await api.get(`/reports/drilldown/billed${queryStr}`);
        setDrillDownModal({
          isOpen: true,
          title: 'Total Billed Details',
          type: 'billed',
          data: res.data || [],
          columns: [
            { key: 'invoice_number', label: 'Invoice #' },
            { key: 'invoice_date', label: 'Date', format: d => new Date(d).toLocaleDateString() },
            { key: 'client_name', label: 'Client' },
            { key: 'status', label: 'Status' },
            { key: 'final_amount', label: 'Amount', format: v => `₹${Number(v || 0).toLocaleString()}` }
          ]
        });
      } else if (type === 'collected') {
        const res = await api.get(`/reports/drilldown/collected${queryStr}`);
        setDrillDownModal({
          isOpen: true,
          title: 'Total Collected Details',
          type: 'collected',
          data: res.data || [],
          columns: [
            { key: 'payment_date', label: 'Date', format: d => new Date(d).toLocaleDateString() },
            { key: 'invoice_number', label: 'Invoice #' },
            { key: 'client_name', label: 'Client' },
            { key: 'payment_method', label: 'Method' },
            { key: 'amount_paid', label: 'Amount', format: v => `₹${Number(v || 0).toLocaleString()}` }
          ]
        });
      } else if (type === 'pending') {
        const res = await api.get(`/reports/drilldown/pending${queryStr}`);
        setDrillDownModal({
          isOpen: true,
          title: 'Pending Due Details',
          type: 'pending',
          data: res.data || [],
          columns: [
            { key: 'invoice_number', label: 'Invoice #' },
            { key: 'due_date', label: 'Due Date', format: d => new Date(d).toLocaleDateString() },
            { key: 'client_name', label: 'Client' },
            { key: 'final_amount', label: 'Total Amount', format: v => `₹${Number(v || 0).toLocaleString()}` },
            { key: 'payment_due', label: 'Pending Due', format: v => `₹${Number(v || 0).toLocaleString()}` }
          ]
        });
      }
    } catch (err) {
      console.error('Failed to fetch drill down data', err);
    }
  };

  const handleExpensePieClick = async (entry, index, event) => {
    // Recharts passes (entry, index, event) to Cell onClick
    const e = event || index;
    if (e && e.stopPropagation) e.stopPropagation();
    
    if (!entry || !entry.name) return;
    try {
      const params = new URLSearchParams();
      if (dateRange.from_date) params.append('from_date', dateRange.from_date);
      if (dateRange.to_date) params.append('to_date', dateRange.to_date);
      params.append('category', entry.name);
      const queryStr = `?${params.toString()}`;

      const res = await api.get(`/reports/drilldown/expenses${queryStr}`);
      setDrillDownModal({
        isOpen: true,
        title: `Expenses: ${entry.name}`,
        type: 'expenses',
        data: res.data || [],
        columns: [
          { key: 'expense_date', label: 'Date', format: d => new Date(d).toLocaleDateString() },
          { key: 'vendor_name', label: 'Vendor' },
          { key: 'description', label: 'Description' },
          { key: 'status', label: 'Status' },
          { key: 'amount', label: 'Amount', format: v => `₹${Number(v || 0).toLocaleString()}` }
        ]
      });
    } catch (err) {
      console.error('Failed to fetch expense drill down data', err);
    }
  };

  const handleRevenuePieClick = async (entry, index, event) => {
    const e = event || index;
    if (e && e.stopPropagation) e.stopPropagation();
    
    if (!entry || !entry.name) return;
    try {
      const params = new URLSearchParams();
      if (dateRange.from_date) params.append('from_date', dateRange.from_date);
      if (dateRange.to_date) params.append('to_date', dateRange.to_date);
      params.append('client_name', entry.name);
      const queryStr = `?${params.toString()}`;

      const res = await api.get(`/reports/drilldown/revenue${queryStr}`);
      setDrillDownModal({
        isOpen: true,
        title: `Revenue: ${entry.name}`,
        type: 'revenue',
        data: res.data || [],
        columns: [
          { key: 'invoice_number', label: 'Invoice #' },
          { key: 'invoice_date', label: 'Date', format: d => new Date(d).toLocaleDateString() },
          { key: 'client_name', label: 'Client' },
          { key: 'final_amount', label: 'Billed', format: v => `₹${Number(v || 0).toLocaleString()}` },
          { key: 'payment_received', label: 'Received', format: v => `₹${Number(v || 0).toLocaleString()}` }
        ]
      });
    } catch (err) {
      console.error('Failed to fetch revenue drill down data', err);
    }
  };

  const handleMonthlyChartClick = async (entry, event) => {
    // Recharts passes (state, event) to ComposedChart onClick
    if (event && event.stopPropagation) event.stopPropagation();
    else if (entry && entry.stopPropagation) entry.stopPropagation();

    if (!entry || !entry.activePayload || !entry.activePayload.length) return;
    const monthData = entry.activePayload[0].payload;
    if (!monthData || !monthData.month_num) return;
    
    try {
      const year = new Date(dateRange.from_date).getFullYear();
      const res = await api.get(`/reports/drilldown/monthly?year=${year}&month=${monthData.month_num}`);
      
      const combined = [
        ...(res.data?.billed || []),
        ...(res.data?.collected || [])
      ].sort((a, b) => new Date(b.invoice_date || b.payment_date) - new Date(a.invoice_date || a.payment_date));

      setDrillDownModal({
        isOpen: true,
        title: `Monthly Details: ${monthData.month}`,
        type: 'monthly',
        data: combined,
        columns: [
          { key: 'type', label: 'Type' },
          { key: 'invoice_number', label: 'Invoice #' },
          { key: 'client_name', label: 'Client' },
          { key: 'final_amount', label: 'Amount', format: v => `₹${Number(v || 0).toLocaleString()}` }
        ]
      });
    } catch (err) {
      console.error('Failed to fetch monthly drill down data', err);
    }
  };

  const fetchReports = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (dateRange.from_date) params.append('from_date', dateRange.from_date);
      if (dateRange.to_date) params.append('to_date', dateRange.to_date);
      const queryStr = params.toString() ? `?${params.toString()}` : '';

      // Only fetch basic reports initially to improve load time
      const [expenseRes, plRes, tdsRes] = await Promise.all([
        api.get(`/reports/expense-summary${queryStr}`),
        api.get(`/reports/profit-loss${queryStr}`),
        api.get(`/reports/tds${queryStr}`)
      ]);
      setExpenseData(expenseRes.data?.data?.by_category || []);
      setPlData(plRes.data?.data || plRes.data || null);
      if (tdsRes.data?.success) setTdsData(tdsRes.data.data);

      const year = new Date(dateRange.from_date).getFullYear();
      const [trendRes, agingRes] = await Promise.all([
        api.get(`/reports/monthly-trend?from_date=${dateRange.from_date}&to_date=${dateRange.to_date}`),
        api.get('/reports/receivables-aging')
      ]);
      if (trendRes.data?.success) setTrendData(trendRes.data);
      if (agingRes.data?.success) setAgingData(agingRes.data);
    } catch (err) {
      console.error('Failed to fetch reports', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAdvancedReports = async () => {
    try {
      const params = new URLSearchParams();
      if (dateRange.from_date) params.append('from_date', dateRange.from_date);
      if (dateRange.to_date) params.append('to_date', dateRange.to_date);
      const queryStr = params.toString() ? `?${params.toString()}` : '';

      const [advRes, bizRes, cpgRes] = await Promise.all([
        api.get(`/reports/advanced-metrics${queryStr}`),
        api.get(`/reports/business-analytics${queryStr}`),
        api.get(`/reports/cost-per-guard${queryStr}`)
      ]);
      setAdvancedData(advRes.data?.data || advRes.data || null);
      if (bizRes.data?.success) setBizData(bizRes.data);
      if (cpgRes.data?.success) setCostPerGuardData(cpgRes.data?.data ?? cpgRes.data);
    } catch (err) {
      console.error('Failed to fetch advanced reports', err);
    }
  };

  useEffect(() => {
    fetchReports();
    // Also reset advanced data so it can be refetched if toggled
    setAdvancedData(null);
    if (showAdvanced) {
      fetchAdvancedReports();
    }
  }, [dateRange.from_date, dateRange.to_date]);

  useEffect(() => {
    if (showAdvanced && !advancedData) {
      fetchAdvancedReports();
    }
  }, [showAdvanced]);

  const [pdfGenerating, setPdfGenerating] = useState(false);

  const handleExport = async () => {
    setPdfGenerating(true);
    try {
      // Use Electron's native printToPDF (renders SVG charts perfectly)
      if (window.electronAPI && window.electronAPI.isElectron) {
        const result = await window.electronAPI.printToPDF({ landscape: true });
        if (result.success) {
          const fileName = `Financial_Report_${dateRange.from_date}_to_${dateRange.to_date}.pdf`;
          const saveResult = await window.electronAPI.saveFile({
            buffer: result.buffer,
            defaultName: fileName
          });
          if (saveResult.success) {
            alert(`PDF saved to: ${saveResult.filePath}`);
          } else if (!saveResult.canceled) {
            alert('Failed to save PDF: ' + (saveResult.error || 'Unknown error'));
          }
        } else {
          alert('Failed to generate PDF: ' + (result.error || 'Unknown error'));
        }
      } else {
        // Fallback for non-Electron (dev mode)
        window.print();
      }
    } catch (err) {
      console.error('Failed to generate PDF', err);
      alert('Failed to generate PDF document');
    } finally {
      setPdfGenerating(false);
    }
  };

  const downloadRawData = (type) => {
    const token = localStorage.getItem('token');
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/reports/export-excel?type=${type}&from_date=${dateRange.from_date}&to_date=${dateRange.to_date}&token=${token}`;
    window.open(url, '_blank');
  };

  const handleExportSheet = async () => {
    if (!plData) return;
    setExportingSheet(true);
    try {
      const params = new URLSearchParams();
      if (dateRange.from_date) params.append('from_date', dateRange.from_date);
      if (dateRange.to_date)   params.append('to_date',   dateRange.to_date);
      const qs = params.toString() ? `?${params.toString()}` : '';

      // Fetch additional revenue details for the Revenue sheet
      const invRes = await api.get(`/reports/client-revenue${qs}`);
      const wb = XLSX.utils.book_new();

      // ─── HEADER STYLE ──────────────────────────────────────────────────
      const hdrStyle = { font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 12 }, fill: { fgColor: { rgb: '1E3A5F' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: { bottom: { style: 'thin', color: { rgb: 'CCCCCC' } } } };
      const subHdrStyle = { font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 }, fill: { fgColor: { rgb: '2C7A7B' } }, alignment: { horizontal: 'center' } };
      const greenStyle = { font: { bold: true, color: { rgb: '15803D' }, sz: 12 }, fill: { fgColor: { rgb: 'F0FDF4' } }, alignment: { horizontal: 'right' } };
      const redStyle   = { font: { bold: true, color: { rgb: 'B91C1C' }, sz: 12 }, fill: { fgColor: { rgb: 'FFF1F2' } }, alignment: { horizontal: 'right' } };
      const boldStyle  = { font: { bold: true, sz: 11 }, alignment: { horizontal: 'right' } };
      const labelStyle = { font: { bold: true, sz: 11 }, fill: { fgColor: { rgb: 'F8FAFC' } } };
      const altStyle   = { fill: { fgColor: { rgb: 'F1F5F9' } } };
      const titleStyle = { font: { bold: true, color: { rgb: '1E3A5F' }, sz: 16 }, alignment: { horizontal: 'center' } };

      // ─── SHEET 1: SUMMARY ──────────────────────────────────────────────
      const summaryRows = [
        ['FINANCIAL SUMMARY REPORT', '', ''],
        [`Period: ${dateRange.from_date}  →  ${dateRange.to_date}`, '', ''],
        ['', '', ''],
        ['METRIC', 'AMOUNT (₹)', 'NOTES'],
        ['Total Billed',   parseFloat(plData.total_billed),  'All invoices raised'],
        ['Total Collected', parseFloat(plData.revenue),      'Payments actually received'],
        ['Total Expenses', parseFloat(plData.expenses),      'Approved & paid expenses'],
        ['Total Payroll',  parseFloat(plData.payroll),       'Net salaries paid'],
        ['Total Costs',    parseFloat(plData.total_costs),   'Expenses + Payroll'],
        ['', '', ''],
        ['NET PROFIT',     parseFloat(plData.profit),        `Margin: ${plData.margin}%`],
      ];
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
      wsSummary['!cols'] = [{ wch: 30 }, { wch: 22 }, { wch: 30 }];
      wsSummary['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } }];
      styleRange(wsSummary, 'A1:C1', titleStyle);
      styleRange(wsSummary, 'A4:C4', hdrStyle);
      styleRange(wsSummary, 'A5:C9', labelStyle);
      styleRange(wsSummary, 'B5:B9', boldStyle);
      styleRange(wsSummary, 'A11:C11', { ...greenStyle, font: { ...greenStyle.font, sz: 13 } });
      XLSX.utils.book_append_sheet(wb, wsSummary, '📊 Summary');

      // ─── SHEET 2: REVENUE BY CLIENT ────────────────────────────────────
      const revData = invRes.data || [];
      const revRows = [
        ['REVENUE BY CLIENT', '', '', '', '', '', ''],
        [`Period: ${dateRange.from_date}  →  ${dateRange.to_date}`, '', '', '', '', '', ''],
        ['', '', '', '', '', '', ''],
        ['CLIENT NAME', 'CITY', 'INVOICES', 'TOTAL BILLED (₹)', 'COLLECTED (₹)', 'PENDING (₹)', 'COLLECTION RATE %'],
        ...revData.map((r, i) => [
          r.client_name,
          r.city || '—',
          parseInt(r.invoice_count),
          parseFloat(r.total_billed),
          parseFloat(r.total_paid),
          parseFloat(r.total_due),
          `${parseFloat(r.collection_rate).toFixed(1)}%`
        ]),
        ['', '', '', '', '', '', ''],
        ['TOTAL', '', revData.reduce((s,r)=>s+parseInt(r.invoice_count),0),
          revData.reduce((s,r)=>s+parseFloat(r.total_billed),0),
          revData.reduce((s,r)=>s+parseFloat(r.total_paid),0),
          revData.reduce((s,r)=>s+parseFloat(r.total_due),0), '']
      ];
      const wsRevenue = XLSX.utils.aoa_to_sheet(revRows);
      wsRevenue['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 18 }];
      wsRevenue['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } }];
      styleRange(wsRevenue, 'A1:G1', titleStyle);
      styleRange(wsRevenue, 'A4:G4', hdrStyle);
      revData.forEach((_, i) => {
        const row = `A${5+i}:G${5+i}`;
        styleRange(wsRevenue, row, i % 2 === 0 ? {} : altStyle);
        styleRange(wsRevenue, `D${5+i}:F${5+i}`, { ...greenStyle });
      });
      const totRow = `A${5+revData.length+1}:G${5+revData.length+1}`;
      styleRange(wsRevenue, totRow, subHdrStyle);
      XLSX.utils.book_append_sheet(wb, wsRevenue, '💰 Revenue');

      // ─── SHEET 3: PAYROLL ──────────────────────────────────────────────
      const payDetails = plData.payroll_details || [];
      const payRows = [
        ['PAYROLL DETAILS', '', ''],
        [`Period: ${dateRange.from_date}  →  ${dateRange.to_date}`, '', ''],
        ['', '', ''],
        ['EMPLOYEE NAME', 'NET SALARY (₹)', 'STATUS'],
        ...payDetails.map((p, i) => [
          p.name,
          parseFloat(p.amount),
          'Processed'
        ]),
        ['', '', ''],
        ['TOTAL PAYROLL', parseFloat(plData.payroll), '']
      ];
      const wsPayroll = XLSX.utils.aoa_to_sheet(payRows);
      wsPayroll['!cols'] = [{ wch: 30 }, { wch: 22 }, { wch: 16 }];
      wsPayroll['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } }];
      styleRange(wsPayroll, 'A1:C1', titleStyle);
      styleRange(wsPayroll, 'A4:C4', hdrStyle);
      payDetails.forEach((_, i) => {
        styleRange(wsPayroll, `A${5+i}:C${5+i}`, i % 2 === 0 ? {} : altStyle);
        styleRange(wsPayroll, `B${5+i}`, redStyle);
      });
      styleRange(wsPayroll, `A${5+payDetails.length+1}:C${5+payDetails.length+1}`, subHdrStyle);
      XLSX.utils.book_append_sheet(wb, wsPayroll, '👥 Payroll');

      // ─── SHEET 4: EXPENSES ─────────────────────────────────────────────
      const expDetails = plData.expense_details || [];
      const expRows = [
        ['EXPENSE DETAILS', '', ''],
        [`Period: ${dateRange.from_date}  →  ${dateRange.to_date}`, '', ''],
        ['', '', ''],
        ['CATEGORY', 'AMOUNT (₹)', 'TYPE'],
        ...expDetails.map((e, i) => [
          e.name.replace(/_/g,' ').replace(/\b\w/g, l => l.toUpperCase()),
          parseFloat(e.amount),
          'Approved/Paid'
        ]),
        ['', '', ''],
        ['TOTAL EXPENSES', parseFloat(plData.expenses), '']
      ];
      const wsExpenses = XLSX.utils.aoa_to_sheet(expRows);
      wsExpenses['!cols'] = [{ wch: 30 }, { wch: 22 }, { wch: 18 }];
      wsExpenses['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } }];
      styleRange(wsExpenses, 'A1:C1', titleStyle);
      styleRange(wsExpenses, 'A4:C4', hdrStyle);
      expDetails.forEach((_, i) => {
        styleRange(wsExpenses, `A${5+i}:C${5+i}`, i % 2 === 0 ? {} : altStyle);
        styleRange(wsExpenses, `B${5+i}`, redStyle);
      });
      styleRange(wsExpenses, `A${5+expDetails.length+1}:C${5+expDetails.length+1}`, subHdrStyle);
      XLSX.utils.book_append_sheet(wb, wsExpenses, '🧾 Expenses');

      // ─── SHEET 5: COST BREAKDOWN ───────────────────────────────────────
      const costRows = [
        ['COST BREAKDOWN', '', ''],
        [`Period: ${dateRange.from_date}  →  ${dateRange.to_date}`, '', ''],
        ['', '', ''],
        ['COST TYPE', 'AMOUNT (₹)', '% OF TOTAL'],
        ...costData.map(c => [
          c.name,
          c.amount,
          plData.total_costs > 0 ? `${(c.amount / plData.total_costs * 100).toFixed(1)}%` : '0%'
        ]),
        ['', '', ''],
        ['TOTAL COSTS', parseFloat(plData.total_costs), '100%']
      ];
      const wsCosts = XLSX.utils.aoa_to_sheet(costRows);
      wsCosts['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 18 }];
      wsCosts['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } }];
      styleRange(wsCosts, 'A1:C1', titleStyle);
      styleRange(wsCosts, 'A4:C4', hdrStyle);
      costData.forEach((_, i) => {
        styleRange(wsCosts, `A${5+i}:C${5+i}`, i % 2 === 0 ? {} : altStyle);
        styleRange(wsCosts, `B${5+i}`, redStyle);
      });
      styleRange(wsCosts, `A${5+costData.length+1}:C${5+costData.length+1}`, subHdrStyle);
      XLSX.utils.book_append_sheet(wb, wsCosts, '📉 Cost Breakdown');

      // ─── WRITE FILE ────────────────────────────────────────────────────
      XLSX.writeFile(wb, `Business_Report_${dateRange.from_date}_to_${dateRange.to_date}.xlsx`);
    } catch (err) {
      console.error('Export sheet failed', err);
    } finally {
      setExportingSheet(false);
    }
  };

  // Prepare combined Cost Breakdown data
  const costData = expenseData.map(d => ({
    name: d.category.replace('_', ' ').toUpperCase(),
    amount: parseFloat(d.total)
  }));
  if (plData && plData.payroll > 0) {
    costData.push({ name: 'PAYROLL', amount: parseFloat(plData.payroll) });
  }

  // Revenue Mode toggle — 'collected' | 'billed'
  const [revenueMode, setRevenueMode] = useState('collected');
  const displayRevenue = plData
    ? (revenueMode === 'billed' ? parseFloat(plData.total_billed) : parseFloat(plData.revenue))
    : 0;
  const displayProfit  = plData ? displayRevenue - parseFloat(plData.total_costs) : 0;
  const displayMargin  = displayRevenue > 0 ? (displayProfit / displayRevenue * 100).toFixed(1) : '0.0';

  // ── Derived advanced metric values ────────────────────────────────────
  const labourRatio   = plData && plData.revenue > 0
    ? parseFloat((plData.payroll / plData.revenue * 100).toFixed(1)) : 0;
  const cashGapAmt    = plData ? parseFloat(plData.total_billed) - parseFloat(plData.revenue) : 0;
  const cashGapPct    = plData && plData.total_billed > 0
    ? parseFloat((cashGapAmt / plData.total_billed * 100).toFixed(1)) : 0;
  const dso           = advancedData ? advancedData.dso : null;
  const clientProfit  = advancedData ? (advancedData.client_profitability || []) : [];

  // DSO zone colour
  const dsoZone = dso === null ? 'slate'
    : dso <= 30 ? 'emerald' : dso <= 60 ? 'amber' : 'red';
  const dsoLabel = dso === null ? '—'
    : dso <= 30 ? 'Healthy' : dso <= 60 ? 'Watch' : 'Critical';

  // Labour ratio zone
  const labourZone = labourRatio <= 60 ? 'emerald' : labourRatio <= 75 ? 'amber' : 'red';
  const labourLabel = labourRatio <= 60 ? 'Efficient' : labourRatio <= 75 ? 'Caution' : 'Over-leveraged';

  // ── Business Health Score ────────────────────────────────────────────
  const bhs = plData ? (() => {
    const collectionRate   = plData.total_billed > 0 ? Math.min(parseFloat(plData.revenue) / parseFloat(plData.total_billed) * 100, 100) : 0;
    const labourSafety     = Math.max(0, 100 - labourRatio);
    const marginScore      = Math.max(0, Math.min(parseFloat(displayMargin) * 2, 100));
    const overdueCtrl      = dso !== null ? Math.max(0, 100 - dso) : 50;
    const raw = (collectionRate * 0.30) + (labourSafety * 0.25) + (marginScore * 0.25) + (overdueCtrl * 0.20);
    return Math.round(Math.min(Math.max(raw, 0), 100));
  })() : null;
  const bhsZone  = bhs === null ? 'slate' : bhs >= 80 ? 'emerald' : bhs >= 65 ? 'yellow' : bhs >= 50 ? 'amber' : 'red';
  const bhsLabel = bhs === null ? '—' : bhs >= 80 ? 'Excellent' : bhs >= 65 ? 'Good' : bhs >= 50 ? 'Caution' : 'Danger';
  const bhsTip   = bhs === null ? '' : bhs >= 80 ? 'Business is thriving' : bhs >= 65 ? 'Doing well, minor areas to watch' : bhs >= 50 ? 'Needs attention — risks building' : 'Immediate action required';

  // Derived KPIs for the comprehensive view
  const pendingPayments = plData ? plData.total_billed - plData.revenue : 0;
  const collectionRate = plData && plData.total_billed > 0 ? ((plData.revenue / plData.total_billed) * 100).toFixed(1) : 0;
  const payrollRatio = plData && displayRevenue > 0 ? ((plData.payroll / displayRevenue) * 100).toFixed(1) : 0;
  const opexRatio = plData && displayRevenue > 0 ? ((plData.expenses / displayRevenue) * 100).toFixed(1) : 0;

  return (
    <div className="space-y-6 animate-fade-in pb-12 relative">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none no-print -z-10 rounded-[2rem]">
        <div className="absolute top-0 right-0 w-96 h-96 bg-teal-50 rounded-full blur-3xl opacity-50 transform translate-x-1/3 -translate-y-1/3"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-50 rounded-full blur-3xl opacity-50 transform -translate-x-1/3 translate-y-1/3"></div>
      </div>

      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-8 relative z-10 no-print">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-3">
            <Activity className="w-8 h-8 text-teal-600" />
            Financial & Analytics Reports
          </h1>
          <p className="text-slate-500 font-medium mt-1 text-sm tracking-wide">Deep insights into agency performance, margins, and payroll.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {/* Date Filter */}
          <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-1.5 px-2 text-slate-500">
              <Calendar className="w-4 h-4" />
              <span className="text-sm font-bold">Filter:</span>
            </div>
            <input 
              type="date" 
              className="border-none bg-slate-50 hover:bg-slate-100 rounded-lg text-sm px-2 py-1.5 outline-none focus:ring-2 focus:ring-teal-500 text-slate-700 font-semibold cursor-pointer transition-colors"
              value={dateRange.from_date}
              onChange={(e) => setDateRange(prev => ({...prev, from_date: e.target.value}))}
            />
            <span className="text-slate-300 font-bold px-1">→</span>
            <input 
              type="date" 
              className="border-none bg-slate-50 hover:bg-slate-100 rounded-lg text-sm px-2 py-1.5 outline-none focus:ring-2 focus:ring-teal-500 text-slate-700 font-semibold cursor-pointer transition-colors"
              value={dateRange.to_date}
              onChange={(e) => setDateRange(prev => ({...prev, to_date: e.target.value}))}
            />
          </div>

          {/* Toggle Advanced */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-sm flex items-center gap-2 border ${
              showAdvanced 
                ? 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100' 
                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {showAdvanced ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            {showAdvanced ? 'Hide Advanced' : 'Show Advanced'}
          </button>

          {/* Actions */}
          <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
            <button 
              onClick={handleExport} 
              disabled={loading || pdfGenerating} 
              className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-sm font-bold transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50"
            >
              {pdfGenerating ? (
                <><span className="w-4 h-4 border-2 border-slate-400 border-t-slate-700 rounded-full animate-spin"></span> Generating...</>
              ) : (
                <><Printer className="w-4 h-4 text-slate-500" /> Export PDF</>
              )}
            </button>
            <select 
              onChange={(e) => { if(e.target.value) downloadRawData(e.target.value); e.target.value=''; }}
              className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-2 rounded-xl text-sm font-bold shadow-sm outline-none cursor-pointer"
            >
              <option value="">Raw Data</option>
              <option value="invoices">Export Invoices</option>
              <option value="payroll">Export Payroll</option>
              <option value="expenses">Export Expenses</option>
            </select>
            <button
              onClick={handleExportSheet}
              disabled={loading || exportingSheet || !plData}
              className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-md shadow-emerald-900/20 flex items-center gap-2 disabled:opacity-50 active:scale-95"
            >
              {exportingSheet ? (
                <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>...</>
              ) : (
                <><FileSpreadsheet className="w-4 h-4" /> Export Excel</>  
              )}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          /* Hide everything except the reports content */
          body > *:not(#root) { display: none !important; }
          .no-print, nav, aside, header, footer { display: none !important; }
          
          /* Allow the entire page to expand infinitely for printing */
          html, body, #root { 
            height: auto !important; 
            overflow: visible !important; 
            background: white !important;
          }
          
          /* Remove borders, shadows, backgrounds from the dashboard container */
          #printable-dashboard {
            border: none !important;
            box-shadow: none !important;
            background: white !important;
            padding: 0 !important;
            border-radius: 0 !important;
          }
          
          /* Flatten 3D transforms for PDF */
          .perspective-1000 { perspective: none !important; }
          .transform-style-3d { transform-style: flat !important; }
          .backface-hidden { backface-visibility: visible !important; }
          .rotate-y-180 { display: none !important; }
          
          /* Page breaks */
          .print-break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
          @page { size: A4 landscape; margin: 5mm; }
        }
        .perspective-1000 { perspective: 1000px; }
        .transform-style-3d { transform-style: preserve-3d; }
        .backface-hidden { backface-visibility: hidden; }
        .rotate-y-180 { transform: rotateY(180deg); }
      `}</style>

      {loading ? (
        <div className="bg-white/80 backdrop-blur-xl p-8 rounded-3xl shadow-sm border border-slate-100">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-16 animate-pulse">
            <div className="space-y-8 flex flex-col justify-center px-6">
              <div className="h-8 bg-slate-200 rounded w-1/2 mb-4"></div>
              {[1, 2, 3, 4].map(i => <div key={i} className="h-12 bg-slate-100 rounded-xl w-full"></div>)}
            </div>
            <div className="flex flex-col items-center">
              <div className="h-8 bg-slate-200 rounded w-1/2 mb-8"></div>
              <div className="h-[250px] w-[250px] bg-slate-100 rounded-full"></div>
            </div>
            <div className="flex flex-col items-center w-full">
              <div className="h-8 bg-slate-200 rounded w-1/3 mb-8"></div>
              <div className="h-[300px] bg-slate-100 rounded-xl w-full"></div>
            </div>
            <div className="flex flex-col items-center w-full">
              <div className="h-8 bg-slate-200 rounded w-1/3 mb-8"></div>
              <div className="h-[300px] bg-slate-100 rounded-xl w-full"></div>
            </div>
          </div>
        </div>
      ) : (
        <div id="printable-dashboard" className="bg-white/90 backdrop-blur-2xl p-10 print:p-2 rounded-[2rem] print:rounded-none shadow-2xl print:shadow-none shadow-blue-900/5 border border-white/50 print:border-none relative overflow-hidden print:overflow-visible transition-all duration-500 hover:shadow-blue-900/10">
          
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-400 via-teal-400 to-emerald-400 no-print"></div>

          {/* Print Letterhead */}
          <div className="hidden print:flex justify-between items-end border-b-2 border-slate-200 pb-4 mb-6">
            <div>
              <h2 className="text-3xl font-black text-slate-800 tracking-tight">SECURITY AGENCY PRO</h2>
              <p className="text-slate-500 font-medium text-sm mt-1">Professional Security & Guarding Services</p>
            </div>
            <div className="text-right text-sm text-slate-600">
              <p className="font-bold">Financial Dashboard Report</p>
              <p>Generated on: {new Date().toLocaleDateString()}</p>
            </div>
          </div>

          <div className="text-center mb-14 mt-4 print:mb-8 print:hidden">
            <h1 className="text-4xl font-extrabold tracking-tight" style={{ color: '#1e3a5f' }}>Financial Dashboard</h1>
            <p className="text-slate-500 font-bold mt-3 text-lg flex items-center justify-center gap-3">
              <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-md">{dateRange.from_date}</span>
              <span className="text-slate-300">→</span> 
              <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-md">{dateRange.to_date}</span>
            </p>
          </div>

          {plData && (
            <div className="grid grid-cols-1 lg:grid-cols-2 print:grid-cols-1 gap-x-12 gap-y-16 print:gap-y-8">
              
              {/* Top Left: KPIs */}
              <div className="flex flex-col justify-center px-6 group print-break-inside-avoid">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <TrendingUp className="w-6 h-6 text-blue-500" /> Key Performance Indicators
                  </h3>
                  {/* Revenue Mode Toggle */}
                  <div className="no-print flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200 shadow-inner">
                    <button
                      onClick={() => setRevenueMode('collected')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${
                        revenueMode === 'collected'
                          ? 'bg-white text-teal-700 shadow-md shadow-teal-900/10 scale-105'
                          : 'text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      💰 Collected
                    </button>
                    <button
                      onClick={() => setRevenueMode('billed')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${
                        revenueMode === 'billed'
                          ? 'bg-white text-blue-700 shadow-md shadow-blue-900/10 scale-105'
                          : 'text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      📋 Billed
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Billed */}
                  <FlipCard 
                    infoTitle="Total Billed" 
                    infoText="This is the total value of all invoices generated for clients during the selected period, regardless of whether they have been paid yet."
                    infoIcon={Receipt}
                  >
                    <div 
                      onClick={() => handleKpiClick('billed')}
                      className="bg-slate-50 rounded-xl p-4 border border-slate-100 hover:bg-white hover:shadow-md transition-all h-full cursor-pointer"
                    >
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Billed</p>
                      <p className="text-xl font-black text-blue-700">₹{plData.total_billed.toLocaleString('en-IN')}</p>
                    </div>
                  </FlipCard>

                  {/* Collected */}
                  <FlipCard 
                    infoTitle="Total Collected" 
                    infoText="This represents the actual cash deposited in your bank from clients during the selected period. It is your realized revenue."
                    infoIcon={Banknote}
                  >
                    <div 
                      onClick={() => handleKpiClick('collected')}
                      className="bg-slate-50 rounded-xl p-4 border border-slate-100 hover:bg-white hover:shadow-md transition-all h-full cursor-pointer"
                    >
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Collected</p>
                      <p className="text-xl font-black text-teal-700">₹{plData.revenue.toLocaleString('en-IN')}</p>
                    </div>
                  </FlipCard>

                  {/* Pending Payments */}
                  <FlipCard 
                    infoTitle="Pending Due" 
                    infoText="The difference between what was billed and what was collected. This is the outstanding cash clients still owe you for this period."
                    infoIcon={Wallet}
                  >
                    <div 
                      onClick={() => handleKpiClick('pending')}
                      className="bg-amber-50/50 rounded-xl p-4 border border-amber-100 hover:bg-white hover:shadow-md transition-all h-full cursor-pointer"
                    >
                      <p className="text-xs font-bold text-amber-600/70 uppercase tracking-wider mb-1">Pending Due</p>
                      <p className="text-xl font-black text-amber-700">₹{pendingPayments.toLocaleString('en-IN')}</p>
                    </div>
                  </FlipCard>

                  {/* Collection Rate */}
                  <FlipCard 
                    infoTitle="Collection Rate" 
                    infoText="The percentage of your total billed amount that has been successfully collected. A healthy business targets 90%+."
                    infoIcon={Percent}
                  >
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 hover:bg-white hover:shadow-md transition-all flex justify-between items-center h-full">
                      <div>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Collection Rate</p>
                        <p className="text-xl font-black text-slate-700">{collectionRate}%</p>
                      </div>
                      {collectionRate > 85 ? <CheckCircle className="w-6 h-6 text-emerald-500 opacity-50" /> : <AlertTriangle className="w-6 h-6 text-amber-500 opacity-50" />}
                    </div>
                  </FlipCard>

                  {/* Net Profit */}
                  <FlipCard 
                    containerClassName="col-span-1 md:col-span-2 print:col-span-full"
                    infoTitle="Net Profit" 
                    infoText="This is your final profit margin after deducting all operational costs, payroll, and taxes. A negative number indicates a loss."
                    infoIcon={TrendingUp}
                  >
                    <div className={`rounded-xl p-5 border shadow-sm transition-all h-full flex flex-col justify-center ${displayProfit >= 0 ? 'bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200' : 'bg-gradient-to-r from-red-50 to-rose-50 border-red-200'}`}>
                      <div className="flex justify-between items-center mb-1">
                        <p className={`text-xs font-bold uppercase tracking-wider ${displayProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                          Net Profit <span className="text-[10px] opacity-70 ml-1">(based on {revenueMode})</span>
                        </p>
                        <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${displayProfit >= 0 ? 'bg-emerald-200 text-emerald-800' : 'bg-red-200 text-red-800'}`}>
                          {displayMargin}% Margin
                        </span>
                      </div>
                      <p className={`text-3xl font-black ${displayProfit >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
                        {displayProfit < 0 ? '-' : ''}₹{Math.abs(displayProfit).toLocaleString('en-IN')}
                      </p>
                    </div>
                  </FlipCard>

                </div>
              </div>

              {/* Top Row: Revenue Pie Chart */}
              <FlipCard
                containerClassName="flex flex-col items-center hover:scale-[1.02] transition-transform duration-300 w-full h-full print-break-inside-avoid"
                infoTitle="Revenue by Society"
                infoText="This donut chart breaks down which clients are contributing the most to your total revenue. It helps you identify your most valuable contracts."
                infoIcon={PieChartIcon}
              >
                <h3 className="text-2xl font-bold mb-6 text-slate-800">Revenue by Society</h3>
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie 
                      data={(plData.revenue_details || []).map(d => ({...d, amount: parseFloat(d.amount)}))} 
                      cx="50%" cy="50%" 
                      innerRadius={90} outerRadius={120} 
                      dataKey="amount" nameKey="name" 
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
                      labelLine={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                      stroke="white"
                      strokeWidth={4}
                      isAnimationActive={true}
                      onClick={handleRevenuePieClick}
                      style={{ cursor: 'pointer' }}
                    >
                      {(plData.revenue_details || []).map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={COLORS[index % COLORS.length]} 
                          className="hover:opacity-80 transition-opacity duration-300" 
                        />
                      ))}
                    </Pie>
                    <RechartsTooltip formatter={(value) => `₹${parseFloat(value).toLocaleString('en-IN')}`} contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </FlipCard>
              {/* Bottom Left: Cost Breakdown */}
              <FlipCard
                containerClassName="flex flex-col items-center group w-full h-full print-break-inside-avoid"
                infoTitle="Cost Breakdown"
                infoText="This bar chart categorizes where your money is being spent (e.g., payroll vs operational expenses). It helps you track overheads and manage budgets."
                infoIcon={Activity}
              >
                <h3 className="text-2xl font-bold mb-4 text-slate-800">Cost Breakdown</h3>
                <div className="w-full border border-slate-200/60 rounded-xl pt-6 pr-6 pb-2 pl-2 bg-slate-50/30 group-hover:bg-white group-hover:shadow-xl transition-all duration-300">
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={costData} margin={{ top: 20, right: 10, left: 20, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fill: '#475569', fontWeight: 500 }} axisLine={{stroke: '#cbd5e1'}} tickLine={false} />
                      <YAxis tick={{ fill: '#475569', fontWeight: 500 }} axisLine={{stroke: '#cbd5e1'}} tickLine={false} label={{ value: 'Amount (INR)', angle: -90, position: 'insideLeft', offset: -10, fill: '#64748b' }} />
                      <RechartsTooltip formatter={(value) => `₹${parseFloat(value).toLocaleString('en-IN')}`} cursor={{fill: '#f8fafc'}} contentStyle={tooltipStyle}/>
                      <Bar 
                        dataKey="amount" 
                        radius={[6, 6, 0, 0]} 
                        maxBarSize={100} 
                        isAnimationActive={true} 
                        animationDuration={1500}
                        onClick={handleExpensePieClick}
                        style={{ cursor: 'pointer' }}
                      >
                        <LabelList dataKey="amount" position="top" formatter={(value) => `₹${parseFloat(value).toLocaleString('en-IN')}`} style={{ fill: '#1e293b', fontWeight: '800' }} />
                        {costData.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={BAR_COLORS[index % BAR_COLORS.length]} 
                            className="hover:opacity-80 transition-opacity duration-300" 
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </FlipCard>
              {/* Bottom Right: Payroll Distribution */}
              <FlipCard
                containerClassName="flex flex-col items-center group w-full h-full print-break-inside-avoid"
                infoTitle="Payroll Distribution"
                infoText="This horizontal bar chart shows exactly how much is being paid out in watchmen salaries across your different client sites."
                infoIcon={Users}
              >
                <h3 className="text-2xl font-bold mb-4 text-slate-800">Payroll Distribution</h3>
                <div className="w-full border border-slate-200/60 rounded-xl pt-6 pr-6 pb-2 pl-2 bg-slate-50/30 group-hover:bg-white group-hover:shadow-xl transition-all duration-300">
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={(plData.payroll_details || []).map(d => ({...d, amount: parseFloat(d.amount)}))} layout="vertical" margin={{ top: 10, right: 10, left: 40, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                      <XAxis type="number" tick={{ fill: '#475569', fontWeight: 500 }} axisLine={{stroke: '#cbd5e1'}} tickLine={false} label={{ value: 'Amount (INR)', position: 'insideBottom', offset: -15, fill: '#64748b' }} />
                      <YAxis dataKey="name" type="category" width={100} tick={{ fill: '#334155', fontSize: 13, fontWeight: 500 }} axisLine={{stroke: '#cbd5e1'}} tickLine={false} />
                      <RechartsTooltip formatter={(value) => `₹${parseFloat(value).toLocaleString('en-IN')}`} cursor={{fill: '#f8fafc'}} contentStyle={tooltipStyle}/>
                      <Bar dataKey="amount" fill="url(#colorTeal)" barSize={35} radius={[0, 6, 6, 0]} isAnimationActive={true} animationDuration={1500}>
                        {/* Define subtle gradient for the horizontal bars */}
                        <defs>
                          <linearGradient id="colorTeal" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#4fd1c5" stopOpacity={1}/>
                            <stop offset="100%" stopColor="#319795" stopOpacity={1}/>
                          </linearGradient>
                        </defs>
                        {(plData.payroll_details || []).map((entry, index) => (
                          <Cell key={`cell-${index}`} className="hover:opacity-80 transition-opacity duration-300 cursor-pointer" />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </FlipCard>

            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          ADVANCED ANALYTICS SECTION (below the printable dashboard)
          ════════════════════════════════════════════════════════════ */}
      {plData && advancedData && showAdvanced && (
        <div className="mt-8 animate-fade-in print:mt-12">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-1 h-8 bg-gradient-to-b from-violet-500 to-indigo-600 rounded-full"></div>
            <h2 className="text-xl font-bold text-slate-800">Advanced Business Analytics</h2>
            <span className="bg-violet-100 text-violet-700 text-xs font-bold px-2.5 py-1 rounded-full">LIVE</span>
          </div>

          {/* ── Row 1: DSO + Labour Cost Ratio ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

            {/* DSO Card */}
            <FlipCard
              infoTitle="Days Sales Outstanding (DSO)"
              infoText="DSO measures the average number of days it takes your clients to pay their invoices after being billed. A lower number means faster cash flow."
              infoIcon={Clock}
            >
              <div className={`bg-white rounded-2xl border p-6 shadow-sm hover:shadow-lg transition-all duration-300 border-${dsoZone}-200 h-full`}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Days Sales Outstanding</p>
                    <p className="text-slate-400 text-xs mt-0.5">How long clients take to pay on average</p>
                  </div>
                  <Clock className={`w-6 h-6 text-${dsoZone}-500`} />
                </div>
                <div className="flex items-end gap-3 mb-4">
                  <span className={`text-5xl font-black text-${dsoZone}-600`}>{dso ?? '—'}</span>
                  <span className="text-slate-400 font-semibold text-lg mb-1">days</span>
                  <span className={`ml-auto text-sm font-bold px-3 py-1 rounded-full bg-${dsoZone}-100 text-${dsoZone}-700`}>{dsoLabel}</span>
                </div>
                {/* Gauge bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-400 font-semibold">
                    <span>0</span><span className="text-emerald-500">30 Good</span><span className="text-amber-500">60 Watch</span><span className="text-red-500">90+ Bad</span>
                  </div>
                  <div className="relative h-3 bg-gradient-to-r from-emerald-200 via-amber-200 to-red-300 rounded-full overflow-hidden">
                    <div
                      className={`absolute top-0 left-0 h-full rounded-full bg-${dsoZone}-500 transition-all duration-700`}
                      style={{ width: `${Math.min((dso / 90) * 100, 100)}%` }}
                    />
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-3">
                  ₹{advancedData.total_due?.toLocaleString('en-IN')} outstanding out of ₹{advancedData.total_billed?.toLocaleString('en-IN')} billed
                </p>
              </div>
            </FlipCard>

            {/* Labour Cost Ratio Card */}
            <FlipCard
              infoTitle="Labour Cost Ratio"
              infoText="This shows what percentage of your collected revenue goes strictly towards paying guard salaries. Keeping this below 65% is crucial for profitability."
              infoIcon={Users}
            >
              <div className={`bg-white rounded-2xl border p-6 shadow-sm hover:shadow-lg transition-all duration-300 border-${labourZone}-200 h-full`}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Labour Cost Ratio</p>
                    <p className="text-slate-400 text-xs mt-0.5">Payroll as % of collected revenue — target &lt; 65%</p>
                  </div>
                  <Users className={`w-6 h-6 text-${labourZone}-500`} />
                </div>
                <div className="flex items-end gap-3 mb-4">
                  <span className={`text-5xl font-black text-${labourZone}-600`}>{labourRatio}</span>
                  <span className="text-slate-400 font-semibold text-lg mb-1">%</span>
                  <span className={`ml-auto text-sm font-bold px-3 py-1 rounded-full bg-${labourZone}-100 text-${labourZone}-700`}>{labourLabel}</span>
                </div>
                {/* Segmented gauge */}
                <div className="space-y-1.5">
                  <div className="flex gap-1 h-3">
                    <div className="bg-emerald-400 rounded-l-full flex-1 relative overflow-hidden">
                      <div className="absolute inset-0 bg-white/30" style={{width: `${labourRatio <= 60 ? 100 - (labourRatio/60*100) : 0}%`, right:0, left:'auto'}}/>
                      <span className="absolute left-1 top-0 text-[8px] font-black text-white leading-3">≤60%</span>
                    </div>
                    <div className="bg-amber-400 flex-1 relative overflow-hidden">
                      <div className="absolute inset-0 bg-white/30" style={{width: `${labourRatio > 60 && labourRatio <= 75 ? 100-(labourRatio-60)/15*100 : labourRatio <= 60 ? 100 : 0}%`, right:0, left:'auto'}}/>
                      <span className="absolute left-1 top-0 text-[8px] font-black text-white leading-3">75%</span>
                    </div>
                    <div className="bg-red-400 rounded-r-full flex-1 relative overflow-hidden">
                      <span className="absolute left-1 top-0 text-[8px] font-black text-white leading-3">75%+</span>
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-slate-400 font-semibold">
                    <span className="text-emerald-600">Efficient</span><span className="text-amber-600">Caution</span><span className="text-red-600">Danger</span>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-3">
                  ₹{parseFloat(plData.payroll).toLocaleString('en-IN')} payroll on ₹{parseFloat(plData.revenue).toLocaleString('en-IN')} collected
                </p>
              </div>
            </FlipCard>
          </div>

          {/* ── Row 2: Cash Gap + Client Profitability ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Cash vs Accrual Gap */}
            <FlipCard
              infoTitle="Cash vs Accrual Gap"
              infoText="This compares what you have billed (Accrual) against what you have actually received in the bank (Cash). A high lock-up percentage means your cash is trapped in unpaid invoices, which can hurt liquidity."
              infoIcon={IndianRupee}
            >
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-lg transition-all duration-300 h-full">
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <p className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Cash vs Accrual Gap</p>
                    <p className="text-slate-400 text-xs mt-0.5">Revenue earned but not yet collected</p>
                  </div>
                  <IndianRupee className="w-6 h-6 text-blue-500" />
                </div>
                {/* Stacked visual bar */}
                <div className="mb-5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-bold text-slate-500 w-20 text-right">Billed</span>
                    <div className="flex-1 h-8 bg-blue-100 rounded-lg overflow-hidden flex">
                      <div className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-lg flex items-center pl-2" style={{width: `${plData.total_billed > 0 ? (plData.revenue/plData.total_billed*100) : 0}%`, minWidth: '2px'}}>
                        <span className="text-white text-xs font-black whitespace-nowrap overflow-hidden">₹{parseFloat(plData.revenue).toLocaleString('en-IN')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500 w-20 text-right">Lock-up</span>
                    <div className="flex-1 h-8 bg-slate-50 rounded-lg border border-dashed border-slate-300 flex items-center px-3">
                      <span className="text-slate-600 font-bold text-sm">₹{cashGapAmt.toLocaleString('en-IN')} locked ({cashGapPct}%)</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Total Billed', val: `₹${parseFloat(plData.total_billed).toLocaleString('en-IN')}`, color: 'blue' },
                    { label: 'Collected',    val: `₹${parseFloat(plData.revenue).toLocaleString('en-IN')}`,       color: 'emerald' },
                    { label: 'Locked Up',    val: `₹${cashGapAmt.toLocaleString('en-IN')}`,                       color: cashGapPct > 30 ? 'red' : 'amber' }
                  ].map(m => (
                    <div key={m.label} className={`bg-${m.color}-50 rounded-xl p-3 text-center border border-${m.color}-100`}>
                      <p className={`text-xs font-bold text-${m.color}-600 mb-1`}>{m.label}</p>
                      <p className={`text-sm font-black text-${m.color}-700`}>{m.val}</p>
                    </div>
                  ))}
                </div>
              </div>
            </FlipCard>

            {/* Client Profitability Table */}
            <FlipCard
              infoTitle="Client Profitability"
              infoText="This breaks down how much profit each individual client generates. It subtracts the guard payroll cost from the collected revenue for that specific site to give you a margin per contract."
              infoIcon={Briefcase}
            >
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-lg transition-all duration-300 h-full">
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <p className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Client Profitability</p>
                    <p className="text-slate-400 text-xs mt-0.5">Revenue collected vs guard payroll cost per site</p>
                  </div>
                  <TrendingUp className="w-6 h-6 text-violet-500" />
                </div>
                <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                  {clientProfit.length === 0 ? (
                    <p className="text-slate-400 text-sm text-center py-8">No client data for this period</p>
                  ) : clientProfit.map((c, i) => {
                    const isProfit  = c.profit >= 0;
                    const barWidth  = Math.min(Math.abs(c.margin), 100);
                    return (
                      <div key={i} className="group rounded-xl border border-slate-100 p-3 hover:border-violet-200 hover:bg-violet-50/30 transition-all duration-200">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-slate-700 text-sm truncate flex-1 mr-2">{c.client_name}</span>
                          <span className={`text-xs font-black px-2 py-0.5 rounded-full ${isProfit ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            {isProfit ? '+' : ''}{c.margin}%
                          </span>
                        </div>
                        {/* Margin bar */}
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-1.5">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${isProfit ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-gradient-to-r from-red-400 to-red-600'}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-slate-400 mt-2 border-t border-slate-100 pt-1.5">
                          <span>Collected: <span className="text-emerald-600 font-bold">₹{c.total_collected.toLocaleString('en-IN')}</span></span>
                          <span>Total Cost: <span className="text-red-500 font-bold">₹{c.guard_cost.toLocaleString('en-IN')}</span></span>
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-400">
                          <span>Guards: <span className="font-semibold text-slate-600">{c.guard_count}</span></span>
                          <span>Cost/Guard: <span className="font-semibold text-slate-600">₹{(c.guard_count > 0 ? Math.round(c.guard_cost / c.guard_count) : 0).toLocaleString('en-IN')}</span></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </FlipCard>
          </div>

          {/* ── Row 3: Business Health Score + Revenue Trend ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">

            {/* Business Health Score */}
            <FlipCard
              infoTitle="Business Health Score"
              infoText="A combined score out of 100 representing the overall stability of your agency. It factors in your collection rate, profit margins, labour efficiency, and overdue debt control."
              infoIcon={Activity}
            >
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col items-center justify-center h-full">
                <p className="text-slate-500 text-sm font-semibold uppercase tracking-wide mb-4">Business Health Score</p>
                {/* Circular gauge */}
                <div className="relative w-36 h-36 mb-4">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="#f1f5f9" strokeWidth="12" />
                    <circle
                      cx="60" cy="60" r="50" fill="none"
                      stroke={bhs >= 80 ? '#10b981' : bhs >= 65 ? '#eab308' : bhs >= 50 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="12"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 50}`}
                      strokeDashoffset={`${2 * Math.PI * 50 * (1 - (bhs || 0) / 100)}`}
                      className="transition-all duration-1000"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-4xl font-black ${bhsZone === 'emerald' ? 'text-emerald-600' : bhsZone === 'yellow' ? 'text-yellow-600' : bhsZone === 'amber' ? 'text-amber-600' : 'text-red-600'}`}>
                      {bhs ?? '—'}
                    </span>
                    <span className="text-slate-400 text-xs font-bold">/ 100</span>
                  </div>
                </div>
                <span className={`text-sm font-black px-4 py-1.5 rounded-full ${
                  bhsZone === 'emerald' ? 'bg-emerald-100 text-emerald-700' :
                  bhsZone === 'yellow'  ? 'bg-yellow-100 text-yellow-700' :
                  bhsZone === 'amber'   ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                }`}>{bhsLabel}</span>
                <p className="text-slate-400 text-xs text-center mt-3 leading-relaxed">{bhsTip}</p>
                <div className="mt-4 w-full space-y-1.5 text-xs text-slate-500">
                  {[
                    { label: 'Collection Rate',  weight: '30%' },
                    { label: 'Labour Efficiency',weight: '25%' },
                    { label: 'Profit Margin',    weight: '25%' },
                    { label: 'Overdue Control',  weight: '20%' }
                  ].map(f => (
                    <div key={f.label} className="flex justify-between">
                      <span>{f.label}</span><span className="font-bold text-slate-400">{f.weight}</span>
                    </div>
                  ))}
                </div>
              </div>
            </FlipCard>

            {/* Revenue Trend + Forecast Chart */}
            <FlipCard
              containerClassName="lg:col-span-2"
              infoTitle="Revenue Trend & Year-End Forecast"
              infoText="This chart shows your monthly collected revenue against your costs. The projected year-end is calculated by extrapolating your current average monthly performance."
              infoIcon={TrendingUp}
            >
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-lg transition-all duration-300 h-full">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Revenue Trend & Year-End Forecast</p>
                    {trendData && (
                      <p className="text-slate-400 text-xs mt-0.5">
                        Run Rate: <span className="font-bold text-teal-600">₹{trendData.run_rate?.toLocaleString('en-IN')}/mo</span>
                        &nbsp;·&nbsp; Projected Year-End: <span className="font-bold text-violet-600">₹{trendData.year_end_forecast?.toLocaleString('en-IN')}</span>
                      </p>
                    )}
                  </div>
                  <TrendingUp className="w-5 h-5 text-violet-500 flex-shrink-0" />
                </div>
                {trendData ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart 
                      data={trendData.monthly} 
                      margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
                      onClick={handleMonthlyChartClick}
                      style={{ cursor: 'pointer' }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                      <RechartsTooltip
                        contentStyle={tooltipStyle}
                        formatter={(val, name) => [`₹${parseFloat(val).toLocaleString('en-IN')}`, name === 'collected' ? 'Collected' : name === 'costs' ? 'Costs' : name]}
                      />
                      <Area type="monotone" dataKey="collected" fill="url(#trendGrad)" stroke="#14b8a6" strokeWidth={2} dot={{ fill: '#14b8a6', r: 3 }} isAnimationActive={true} />
                      <Bar dataKey="costs" fill="#fca5a5" radius={[4,4,0,0]} opacity={0.6} barSize={18} />
                      <defs>
                        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#14b8a6" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#14b8a6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-64 flex items-center justify-center text-slate-400 text-sm">Loading trend data...</div>
                )}
              </div>
            </FlipCard>
          </div>

          {/* ── Row 4: Receivables Aging ── */}
          {/* ── Row 4: Receivables Aging ── */}
          {agingData && (
            <FlipCard
              containerClassName="mt-5"
              infoTitle="Receivables Aging"
              infoText="This shows how old your unpaid invoices are. Invoices older than 60 or 90 days are critical risks and require immediate follow-up."
              infoIcon={AlertTriangle}
            >
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-lg transition-all duration-300 h-full">
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <p className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Receivables Aging</p>
                    <p className="text-slate-400 text-xs mt-0.5">Total Outstanding: <span className="font-bold text-red-600">₹{agingData.total_outstanding?.toLocaleString('en-IN')}</span></p>
                  </div>
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                </div>
                {/* Bucket cards */}
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
                  {[
                    { key: 'current', label: 'Current', color: 'emerald', icon: '✅' },
                    { key: '1_30',   label: '1–30 Days', color: 'yellow', icon: '⏰' },
                    { key: '31_60',  label: '31–60 Days', color: 'amber',  icon: '⚠️' },
                    { key: '61_90',  label: '61–90 Days', color: 'orange', icon: '🔴' },
                    { key: '90_plus',label: '90+ Days',   color: 'red',    icon: '💀' },
                  ].map(b => {
                    const bucket = agingData.buckets?.[b.key] || { amount: 0, count: 0 };
                    return (
                      <div key={b.key} className={`rounded-xl border border-${b.color}-200 bg-${b.color}-50 p-3 text-center`}>
                        <p className="text-xl mb-1">{b.icon}</p>
                        <p className={`text-xs font-bold text-${b.color}-700 mb-1`}>{b.label}</p>
                        <p className={`text-lg font-black text-${b.color}-800`}>₹{bucket.amount.toLocaleString('en-IN')}</p>
                        <p className={`text-xs text-${b.color}-500`}>{bucket.count} invoice{bucket.count !== 1 ? 's' : ''}</p>
                      </div>
                    );
                  })}
                </div>
                {/* Overdue invoices table */}
                {(() => {
                  const allOverdue = ['1_30','31_60','61_90','90_plus']
                    .flatMap(k => agingData.buckets?.[k]?.invoices || [])
                    .sort((a,b) => b.days_overdue - a.days_overdue);
                  if (allOverdue.length === 0) return <p className="text-center text-slate-400 text-sm py-4">No overdue invoices 🎉</p>;
                  return (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            {['Invoice #','Client','Due Date','Days Overdue','Amount Due','Status'].map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {allOverdue.map((inv, i) => {
                            const days = inv.days_overdue;
                            const rowColor = days > 90 ? 'bg-red-50' : days > 60 ? 'bg-orange-50' : days > 30 ? 'bg-amber-50' : '';
                            return (
                              <tr key={i} className={`${rowColor} hover:brightness-95 transition-all`}>
                                <td className="px-4 py-3 font-mono font-bold text-slate-700 text-xs">{inv.invoice_number}</td>
                                <td className="px-4 py-3 font-semibold text-slate-800">{inv.client_name}</td>
                                <td className="px-4 py-3 text-slate-500">{inv.due_date?.toString?.().split('T')[0] || inv.due_date}</td>
                                <td className="px-4 py-3">
                                  <span className={`font-black text-xs px-2 py-0.5 rounded-full ${days > 90 ? 'bg-red-100 text-red-700' : days > 60 ? 'bg-orange-100 text-orange-700' : days > 30 ? 'bg-amber-100 text-amber-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                    {days} days
                                  </span>
                                </td>
                                <td className="px-4 py-3 font-black text-red-600">₹{inv.payment_due.toLocaleString('en-IN')}</td>
                                <td className="px-4 py-3 capitalize text-slate-500 text-xs">{inv.status?.replace('_',' ')}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </FlipCard>
          )}
          {/* ── Row 5: Medium-Tier Business Intelligence ── */}
          {bizData && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 mt-5">
                {/* Revenue Per Employee */}
                <FlipCard
                  infoTitle="Revenue Per Guard"
                  infoText="This shows how much revenue each guard generates on average versus their salary cost. It's a key indicator of your base profit margin per head."
                  infoIcon={Users}
                >
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-lg transition-all h-full">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Revenue / Guard</p>
                      <Users className="w-4 h-4 text-blue-500" />
                    </div>
                    <p className="text-3xl font-black text-slate-800 mb-1">₹{bizData.revenue_per_employee.per_month.toLocaleString('en-IN')}<span className="text-sm font-normal text-slate-400">/mo</span></p>
                    <p className="text-xs text-slate-500 mt-2">Avg Guard Salary: <span className="font-bold text-slate-700">₹{bizData.revenue_per_employee.avg_salary.toLocaleString('en-IN')}</span></p>
                    <div className="mt-2 text-xs font-bold px-2 py-1 bg-blue-50 text-blue-700 rounded-md inline-block">
                      Margin per head: ₹{bizData.revenue_per_employee.margin_per_head.toLocaleString('en-IN')}
                    </div>
                  </div>
                </FlipCard>

                {/* Burn Rate & Runway */}
                <FlipCard
                  infoTitle="Burn Rate & Runway"
                  infoText="Burn rate is how much cash you are losing each month. If positive, it calculates how many months of 'runway' you have left before running out of cash."
                  infoIcon={Activity}
                >
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-lg transition-all h-full">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Net Burn Rate</p>
                      <Activity className="w-4 h-4 text-rose-500" />
                    </div>
                    <p className="text-3xl font-black text-slate-800 mb-1">₹{bizData.burn_rate.net_burn.toLocaleString('en-IN')}<span className="text-sm font-normal text-slate-400">/mo</span></p>
                    <p className="text-xs text-slate-500 mt-2">
                      {bizData.burn_rate.net_burn > 0 ? (
                        <>Cash Runway: <span className="font-black text-rose-600">{bizData.burn_rate.runway_months} months</span></>
                      ) : (
                        <span className="font-bold text-emerald-600">Generating Free Cash Flow 🎉</span>
                      )}
                    </p>
                    <div className="mt-2 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden flex">
                      <div className="bg-emerald-400 h-full" style={{ width: `${(bizData.burn_rate.monthly_cash_in / (bizData.burn_rate.monthly_cash_in + bizData.burn_rate.monthly_burn)) * 100}%` }}></div>
                      <div className="bg-rose-400 h-full" style={{ width: `${(bizData.burn_rate.monthly_burn / (bizData.burn_rate.monthly_cash_in + bizData.burn_rate.monthly_burn)) * 100}%` }}></div>
                    </div>
                  </div>
                </FlipCard>

                {/* Break-Even */}
                <FlipCard
                  infoTitle="Break-Even Point"
                  infoText="This is the exact amount of revenue you need to collect each month to cover all your fixed costs (rent, admin salaries, software) and variable costs (guard wages)."
                  infoIcon={Target}
                >
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-lg transition-all h-full">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Break-Even Point</p>
                      <Target className="w-4 h-4 text-indigo-500" />
                    </div>
                    <p className="text-3xl font-black text-slate-800 mb-1">₹{bizData.break_even.monthly_break_even.toLocaleString('en-IN')}<span className="text-sm font-normal text-slate-400">/mo</span></p>
                    <p className="text-xs text-slate-500 mt-2">
                      Current Avg: <span className={`font-bold ${bizData.break_even.above_break_even ? 'text-emerald-600' : 'text-rose-600'}`}>₹{bizData.break_even.monthly_revenue.toLocaleString('en-IN')}</span>
                    </p>
                    <div className="mt-2 text-xs text-slate-400 flex justify-between">
                      <span>Fixed: ₹{bizData.break_even.fixed_costs.toLocaleString('en-IN')}</span>
                      <span>Var Ratio: {bizData.break_even.variable_ratio}%</span>
                    </div>
                  </div>
                </FlipCard>

                {/* Expense vs Revenue Growth */}
                <FlipCard
                  infoTitle="Growth Scissors"
                  infoText="This compares your month-over-month revenue growth versus your expense growth. A warning triggers if your expenses are growing faster than your revenue, known as the 'scissors effect'."
                  infoIcon={Zap}
                >
                  <div className={`rounded-2xl border p-5 shadow-sm hover:shadow-lg transition-all h-full ${bizData.growth.scissors_warning ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <p className={`text-xs font-bold uppercase tracking-wider ${bizData.growth.scissors_warning ? 'text-rose-700' : 'text-slate-500'}`}>Growth Scissors</p>
                      <Zap className={`w-4 h-4 ${bizData.growth.scissors_warning ? 'text-rose-500' : 'text-amber-500'}`} />
                    </div>
                    <div className="flex justify-between items-end mb-2">
                      <div>
                        <p className="text-xs text-slate-500 mb-0.5">Rev Growth</p>
                        <p className={`text-xl font-black ${bizData.growth.revenue_growth >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {bizData.growth.revenue_growth >= 0 ? '+' : ''}{bizData.growth.revenue_growth}%
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500 mb-0.5">Exp Growth</p>
                        <p className={`text-xl font-black ${bizData.growth.expense_growth > bizData.growth.revenue_growth ? 'text-rose-600' : 'text-slate-700'}`}>
                          {bizData.growth.expense_growth >= 0 ? '+' : ''}{bizData.growth.expense_growth}%
                        </p>
                      </div>
                    </div>
                    {bizData.growth.scissors_warning ? (
                      <p className="text-xs font-bold text-rose-600 mt-2 bg-rose-100/50 p-1.5 rounded">⚠️ Expenses growing faster than revenue</p>
                    ) : (
                      <p className="text-xs font-bold text-emerald-600 mt-2 bg-emerald-50 p-1.5 rounded">✅ Healthy growth spread</p>
                    )}
                  </div>
                </FlipCard>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">
                {/* Attendance & Absenteeism */}
                <FlipCard
                  infoTitle="Workforce Attendance"
                  infoText="Shows the overall attendance rate of your guards. High absenteeism directly affects your service quality, client satisfaction, and potentially your billing if shifts are left unfilled."
                  infoIcon={Clock}
                >
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm h-full">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <p className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Workforce Attendance</p>
                        <p className="text-xs text-slate-400 mt-0.5">Impact on service quality & billing</p>
                      </div>
                      <Clock className="text-teal-500 w-5 h-5" />
                    </div>
                    <div className="flex items-center space-x-4 mb-4">
                      <div className="relative w-20 h-20">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                          <circle cx="50" cy="50" r="40" fill="none" stroke="#f1f5f9" strokeWidth="10" />
                          <circle cx="50" cy="50" r="40" fill="none" stroke={bizData.attendance.rate >= 90 ? '#10b981' : bizData.attendance.rate >= 80 ? '#f59e0b' : '#ef4444'} strokeWidth="10" strokeDasharray={`${2 * Math.PI * 40}`} strokeDashoffset={`${2 * Math.PI * 40 * (1 - bizData.attendance.rate / 100)}`} strokeLinecap="round" />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-lg font-black text-slate-700">{bizData.attendance.rate}%</span>
                        </div>
                      </div>
                      <div>
                        <p className="text-sm text-slate-600 font-semibold mb-1">Estimated Absenteeism Cost</p>
                        <p className="text-2xl font-black text-rose-600">₹{bizData.attendance.absenteeism_cost.toLocaleString('en-IN')}</p>
                        <p className="text-xs text-slate-400 mt-1">Paid but non-productive days</p>
                      </div>
                    </div>
                    <div className="space-y-2 mt-4 max-h-32 overflow-y-auto pr-2">
                      {bizData.attendance.by_client.slice(0, 4).map(c => (
                        <div key={c.client} className="flex justify-between items-center text-xs">
                          <span className="text-slate-600 font-medium truncate w-32">{c.client}</span>
                          <div className="flex-1 mx-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-teal-400" style={{ width: `${c.rate}%` }}></div>
                          </div>
                          <span className="font-bold text-slate-700 w-10 text-right">{c.rate}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </FlipCard>

                {/* Client Concentration Risk */}
                <FlipCard
                  infoTitle="Client Concentration Risk"
                  infoText="This checks how much of your total revenue relies on just one or three major clients. If your top client represents too large a percentage, losing them could devastate the business."
                  infoIcon={PieChartIcon}
                >
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm h-full">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <p className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Concentration Risk</p>
                        <p className="text-xs text-slate-400 mt-0.5">Revenue dependency on top clients</p>
                      </div>
                      <PieChartIcon className="text-violet-500 w-5 h-5" />
                    </div>
                    <div className="flex items-center justify-between mb-5">
                      <div>
                        <p className="text-3xl font-black text-slate-800">{bizData.concentration.top_client_pct}%</p>
                        <p className="text-xs font-bold text-slate-400 uppercase">Top Client</p>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-black text-slate-800">{bizData.concentration.top3_pct}%</p>
                        <p className="text-xs font-bold text-slate-400 uppercase">Top 3 Clients</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {bizData.concentration.data.slice(0, 3).map((c, i) => (
                        <div key={i} className="flex flex-col">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="font-semibold text-slate-700 truncate">{c.client}</span>
                            <span className="font-bold text-slate-500">{c.pct}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full ${i === 0 ? 'bg-violet-500' : i === 1 ? 'bg-violet-400' : 'bg-violet-300'}`} style={{ width: `${c.pct}%` }}></div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {bizData.concentration.risk === 'critical' && <p className="mt-4 text-xs font-bold text-rose-600 bg-rose-50 p-2 rounded-lg text-center border border-rose-100">⚠️ Extreme risk: Lose one client, lose half the business.</p>}
                    {bizData.concentration.risk === 'high' && <p className="mt-4 text-xs font-bold text-amber-600 bg-amber-50 p-2 rounded-lg text-center border border-amber-100">⚠️ High dependency on top client.</p>}
                    {bizData.concentration.risk === 'healthy' && <p className="mt-4 text-xs font-bold text-emerald-600 bg-emerald-50 p-2 rounded-lg text-center border border-emerald-100">✅ Healthy diversification.</p>}
                  </div>
                </FlipCard>

                {/* Salary Advances */}
                <FlipCard
                  infoTitle="Salary Advances"
                  infoText="Tracks the total amount of money advanced to staff before payday versus how much has been successfully deducted/recovered from payroll. Low recovery rates drain working capital."
                  infoIcon={Shield}
                >
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm h-full">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <p className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Advance Tracking</p>
                        <p className="text-xs text-slate-400 mt-0.5">Staff advances vs recoveries</p>
                      </div>
                      <Shield className="text-blue-500 w-5 h-5" />
                    </div>
                    <div className="text-center py-4">
                      <p className="text-sm font-semibold text-slate-500 mb-1">Outstanding Balance</p>
                      <p className="text-4xl font-black text-blue-600">₹{bizData.salary_advances.outstanding_balance.toLocaleString('en-IN')}</p>
                    </div>
                    <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100 mb-2">
                      <div>
                        <p className="text-xs text-slate-400 font-semibold uppercase">Total Advanced</p>
                        <p className="font-bold text-slate-700">₹{bizData.salary_advances.total_advanced.toLocaleString('en-IN')}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-400 font-semibold uppercase">Recovered</p>
                        <p className="font-bold text-emerald-600">₹{bizData.salary_advances.total_recovered.toLocaleString('en-IN')}</p>
                      </div>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden mt-3">
                      <div className="bg-blue-500 h-full transition-all" style={{ width: `${bizData.salary_advances.recovery_rate}%` }}></div>
                    </div>
                    <p className="text-center text-xs font-bold text-slate-500 mt-2">{bizData.salary_advances.recovery_rate}% Recovery Rate</p>
                  </div>
                </FlipCard>
              </div>
            </>
          )}

          {/* ── Row 6: Cost Per Guard Per Site (Dedicated Table) ── */}
          {costPerGuardData && costPerGuardData.length > 0 && (
            <FlipCard
              containerClassName="mt-5"
              infoTitle="Site Cost & Margin Analysis"
              infoText="A granular breakdown of each client contract. It calculates the exact cost per guard for each site to ensure you aren't severely undercharging certain clients relative to your operational costs."
              infoIcon={IndianRupee}
            >
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-lg transition-all duration-300 h-full">
                <div className="flex justify-between items-start mb-5">
                  <div>
                    <p className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Site Cost & Margin Analysis</p>
                    <p className="text-xs text-slate-400 mt-0.5">Deep dive into profitability per guard per client site</p>
                  </div>
                  <IndianRupee className="text-emerald-500 w-5 h-5" />
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Client Site</th>
                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wide">Guards Deployed</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wide">Total Guard Cost</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wide bg-blue-50/50">Cost Per Guard</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wide">Monthly Billed</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wide">Site Margin %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {costPerGuardData.map((site) => (
                        <tr key={site.client_id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 font-semibold text-slate-800">{site.client_name}</td>
                          <td className="px-4 py-3 text-center font-medium text-slate-600">{site.guards_deployed}</td>
                          <td className="px-4 py-3 text-right text-rose-600 font-medium">₹{site.total_guard_cost.toLocaleString('en-IN')}</td>
                          <td className="px-4 py-3 text-right text-blue-700 font-black bg-blue-50/30">₹{site.cost_per_guard.toLocaleString('en-IN')}</td>
                          <td className="px-4 py-3 text-right text-emerald-600 font-medium">₹{site.monthly_billed.toLocaleString('en-IN')}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`inline-block px-2 py-0.5 rounded font-black text-xs ${site.site_margin_pct >= 20 ? 'bg-emerald-100 text-emerald-700' : site.site_margin_pct > 0 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                              {site.site_margin_pct > 0 ? '+' : ''}{site.site_margin_pct}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </FlipCard>
          )}

          {/* ── Row 7: TDS Receivable Report ── */}
          {tdsData && (
            <FlipCard
              containerClassName="mt-5"
              infoTitle="TDS Receivable Report"
              infoText="Tracks the total Tax Deducted at Source (TDS) by your clients. This is critical for filing your income tax returns and claiming credit for the TDS deposited by clients."
              infoIcon={Receipt}
            >
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:shadow-lg transition-all duration-300 h-full">
                <div className="flex justify-between items-start mb-5">
                  <div>
                    <p className="text-slate-500 text-sm font-semibold uppercase tracking-wide">TDS Receivable Report</p>
                    <p className="text-xs text-slate-400 mt-0.5">Summary of TDS deducted by clients over the selected period</p>
                  </div>
                  <Receipt className="text-amber-500 w-5 h-5" />
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">Client Name</th>
                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wide">Total Amount Paid</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wide bg-amber-50/50">Total TDS Deducted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {tdsData.length === 0 ? (
                        <tr>
                          <td colSpan="3" className="px-4 py-8 text-center text-slate-500 font-medium">No TDS has been recorded for the selected period.</td>
                        </tr>
                      ) : (
                        tdsData.map((client) => (
                          <tr key={client.client_id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 font-semibold text-slate-800">{client.client_name}</td>
                            <td className="px-4 py-3 text-center font-medium text-emerald-600">₹{client.total_amount_paid.toLocaleString('en-IN')}</td>
                            <td className="px-4 py-3 text-right text-amber-700 font-black bg-amber-50/30">₹{client.total_tds_deducted.toLocaleString('en-IN')}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </FlipCard>
          )}

        </div>
      )}

      <DrillDownModal
        isOpen={drillDownModal.isOpen}
        onClose={() => setDrillDownModal(prev => ({ ...prev, isOpen: false }))}
        title={drillDownModal.title}
        data={drillDownModal.data}
        columns={drillDownModal.columns}
        type={drillDownModal.type}
      />
    </div>
  );
}
