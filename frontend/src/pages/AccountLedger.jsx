import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  BookOpen, Printer, Download, Search, Building2, 
  Calendar, RefreshCw, Landmark, Users, Truck, 
  ChevronDown, FileText, CheckCircle2, ArrowRight
} from 'lucide-react';
import api from '../services/api';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { toast } from '../context/ToastContext';

export default function AccountLedger() {
  const [parties, setParties] = useState({ clients: [], vendors: [], bank_accounts: [] });
  const [loadingParties, setLoadingParties] = useState(true);
  
  // Selection
  const [partyType, setPartyType] = useState('client'); // 'client' | 'vendor' | 'bank_account'
  const [selectedPartyId, setSelectedPartyId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Dates: default to current Indian Financial Year (1-Apr to 31-Mar)
  const getCurrentFYDates = () => {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1; // 1-12
    const startYear = curMonth >= 4 ? curYear : curYear - 1;
    const endYear = startYear + 1;
    return {
      from: `${startYear}-04-01`,
      to: `${endYear}-03-31`
    };
  };

  const [searchParams] = useSearchParams();
  const [dateRange, setDateRange] = useState(() => {
    const qFrom = searchParams.get('from');
    const qTo = searchParams.get('to');
    if (qFrom && qTo) return { from: qFrom, to: qTo };
    return getCurrentFYDates();
  });
  const [ledgerData, setLedgerData] = useState(null);
  const [loadingLedger, setLoadingLedger] = useState(false);

  // Load parties on mount
  useEffect(() => {
    fetchParties();
  }, []);

  const fetchParties = async () => {
    try {
      setLoadingParties(true);
      const res = await api.get('/account-ledger/parties');
      const partyData = res?.data?.clients ? res.data : (res?.clients ? res : res?.data);
      if (partyData) {
        setParties(partyData);
        const qType = searchParams.get('type') || 'client';
        const qId = searchParams.get('id') || '';

        setPartyType(qType);

        const list = qType === 'vendor' ? partyData.vendors : (qType === 'bank_account' ? partyData.bank_accounts : partyData.clients);
        if (qId && list && list.some(p => String(p.id) === String(qId))) {
          setSelectedPartyId(Number(qId) || qId);
        } else if (list && list.length > 0) {
          setSelectedPartyId(list[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load ledger parties:', err);
      toast.error('Failed to load party list');
    } finally {
      setLoadingParties(false);
    }
  };

  // Switch party type
  const handleTypeChange = (newType) => {
    setPartyType(newType);
    setSearchTerm('');
    const list = newType === 'client' ? parties.clients : (newType === 'vendor' ? parties.vendors : parties.bank_accounts);
    if (list && list.length > 0) {
      setSelectedPartyId(list[0].id);
    } else {
      setSelectedPartyId('');
    }
  };

  // Fetch Ledger Statement
  const fetchLedger = async (type = partyType, id = selectedPartyId, range = dateRange) => {
    if (!id) return;
    try {
      setLoadingLedger(true);
      const params = new URLSearchParams({
        party_type: type,
        party_id: id,
        from_date: range.from || '',
        to_date: range.to || ''
      });
      const res = await api.get(`/account-ledger?${params.toString()}`);
      const payload = res?.data?.segments ? res.data : (res?.segments ? res : res?.data);
      setLedgerData(payload || null);
    } catch (err) {
      console.error('Failed to fetch ledger:', err);
      toast.error('Failed to generate ledger statement');
    } finally {
      setLoadingLedger(false);
    }
  };

  useEffect(() => {
    if (selectedPartyId) {
      fetchLedger(partyType, selectedPartyId, dateRange);
    }
  }, [selectedPartyId, partyType]);

  // Quick Date Preset Handlers
  const handlePreset = (preset) => {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    let from = '', to = '';

    if (preset === 'current_fy') {
      const startYear = curMonth >= 4 ? curYear : curYear - 1;
      from = `${startYear}-04-01`;
      to = `${startYear + 1}-03-31`;
    } else if (preset === 'previous_fy') {
      const startYear = (curMonth >= 4 ? curYear : curYear - 1) - 1;
      from = `${startYear}-04-01`;
      to = `${startYear + 1}-03-31`;
    } else if (preset === 'all_time') {
      from = '2020-04-01';
      to = format(new Date(), 'yyyy-MM-dd');
    }
    const newRange = { from, to };
    setDateRange(newRange);
    fetchLedger(partyType, selectedPartyId, newRange);
  };

  // Filter party list for search
  const currentPartyList = (partyType === 'client' ? parties.clients : (partyType === 'vendor' ? parties.vendors : parties.bank_accounts)) || [];
  const filteredParties = currentPartyList.filter(p => {
    const name = p.name || p.account_name || '';
    const code = p.client_code || p.account_number || '';
    return name.toLowerCase().includes(searchTerm.toLowerCase()) || code.toLowerCase().includes(searchTerm.toLowerCase());
  });

  // Selected party object
  const activeParty = currentPartyList.find(p => String(p.id) === String(selectedPartyId)) || ledgerData?.party;

  // Print Handler
  const handlePrint = () => {
    window.print();
  };

  // Excel Export Handler
  const handleExportExcel = () => {
    if (!ledgerData || !ledgerData.segments) {
      toast.error('No ledger data available to export');
      return;
    }

    const rows = [];
    // Header
    rows.push([ledgerData.agency?.name || 'KHETLAJI INDUSTRIES']);
    rows.push([ledgerData.agency?.address || '']);
    rows.push([ledgerData.agency?.email ? `E-Mail: ${ledgerData.agency.email}` : '']);
    rows.push([]);
    rows.push([ledgerData.party?.name || 'Party Name']);
    rows.push(['Ledger Account']);
    rows.push([ledgerData.party?.address || '']);
    rows.push([`Period: ${ledgerData.period?.display || ''}`]);
    rows.push([]);

    // Table Header
    rows.push(['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit', 'Credit']);

    ledgerData.segments.forEach(seg => {
      if (seg.opening_balance) {
        rows.push([
          seg.opening_balance.date_formatted,
          seg.opening_balance.particulars,
          '',
          '',
          seg.opening_balance.side === 'debit' ? seg.opening_balance.amount : '',
          seg.opening_balance.side === 'credit' ? seg.opening_balance.amount : ''
        ]);
      }

      seg.rows.forEach(r => {
        rows.push([
          r.date_formatted,
          r.particulars,
          r.vch_type,
          r.vch_no,
          r.debit > 0 ? r.debit : '',
          r.credit > 0 ? r.credit : ''
        ]);
      });

      // Subtotals
      rows.push(['', '', '', 'Subtotal', seg.subtotal_debit, seg.subtotal_credit]);

      // Closing Balance
      if (seg.closing_balance) {
        rows.push([
          '',
          seg.closing_balance.particulars,
          '',
          '',
          seg.closing_balance.side === 'debit' ? seg.closing_balance.amount : '',
          seg.closing_balance.side === 'credit' ? seg.closing_balance.amount : ''
        ]);
      }

      // Equalized Totals
      rows.push(['', '', '', 'Total', seg.equalized_total, seg.equalized_total]);
      rows.push([]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ledger');
    const safeName = (ledgerData.party?.name || 'Account').replace(/[^a-zA-Z0-9]/g, '_');
    XLSX.writeFile(wb, `Ledger_${safeName}_${ledgerData.period?.from_formatted || ''}_to_${ledgerData.period?.to_formatted || ''}.xlsx`);
    toast.success('Ledger exported to Excel');
  };

  const fmtCurrency = (v) => {
    if (v === undefined || v === null || v === '' || v === 0) return '';
    return Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Top Header Controls (Hidden during print) */}
      <div className="print:hidden space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
              <BookOpen className="w-6 h-6 text-teal-600" />
              Party Ledger (Account Statement)
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Standard Indian double-entry ledger with opening balance, voucher details, and period balancing.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handlePrint}
              disabled={!ledgerData}
              className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
              Print Ledger
            </button>
            <button
              onClick={handleExportExcel}
              disabled={!ledgerData}
              className="bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Export Excel
            </button>
          </div>
        </div>

        {/* Selection & Filter Card */}
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
          {/* Party Type Tabs */}
          <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-xl w-fit">
            <button
              type="button"
              onClick={() => handleTypeChange('client')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                partyType === 'client' 
                  ? 'bg-white text-teal-700 shadow-xs' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              Clients (Debtors)
            </button>
            <button
              type="button"
              onClick={() => handleTypeChange('vendor')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                partyType === 'vendor' 
                  ? 'bg-white text-teal-700 shadow-xs' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Truck className="w-3.5 h-3.5" />
              Vendors (Creditors)
            </button>
            <button
              type="button"
              onClick={() => handleTypeChange('bank_account')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                partyType === 'bank_account' 
                  ? 'bg-white text-teal-700 shadow-xs' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Landmark className="w-3.5 h-3.5" />
              Bank & Cash Accounts
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            {/* Party Selector */}
            <div className="md:col-span-1">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Select {partyType === 'client' ? 'Client' : partyType === 'vendor' ? 'Vendor' : 'Bank Account'}
              </label>
              <select
                value={selectedPartyId}
                onChange={(e) => setSelectedPartyId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium bg-white text-slate-800 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all shadow-xs"
              >
                {currentPartyList.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.account_name} {p.client_code ? `(${p.client_code})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Range & Presets */}
            <div className="md:col-span-2 flex flex-col sm:flex-row gap-3 items-end">
              <div className="flex-1 grid grid-cols-2 gap-2 w-full">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">From Date</label>
                  <input
                    type="date"
                    value={dateRange.from}
                    onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white text-slate-700 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">To Date</label>
                  <input
                    type="date"
                    value={dateRange.to}
                    onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white text-slate-700 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handlePreset('current_fy')}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  title="Current Financial Year (1-Apr to 31-Mar)"
                >
                  Current FY
                </button>
                <button
                  type="button"
                  onClick={() => handlePreset('previous_fy')}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  title="Previous Financial Year"
                >
                  Prev FY
                </button>
                <button
                  type="button"
                  onClick={() => handlePreset('all_time')}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  title="All Available Transactions"
                >
                  All Time
                </button>
                <button
                  type="button"
                  onClick={() => fetchLedger(partyType, selectedPartyId, dateRange)}
                  className="p-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition-colors cursor-pointer shadow-xs"
                  title="Apply Filters"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingLedger ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Printable Ledger Document Container */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 sm:p-12 print:p-0 print:border-none print:shadow-none print:m-0">
        {loadingLedger ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-600"></div>
            <p className="text-slate-500 text-sm mt-3 font-medium">Generating official ledger statement...</p>
          </div>
        ) : !ledgerData ? (
          <div className="text-center py-20 text-slate-400">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-40 text-slate-400" />
            <p className="text-base font-semibold text-slate-600">No Ledger Selected</p>
            <p className="text-xs text-slate-400 mt-1">Select an account and date range above to view its statement.</p>
          </div>
        ) : (
          <div className="font-sans text-slate-900 max-w-4xl mx-auto print:max-w-full">
            {/* Page Number (Top Right) */}
            <div className="flex justify-end text-xs font-medium text-slate-600 mb-2">
              <span>Page 1</span>
            </div>

            {/* 1. Header Block: Centered Agency Details (Matching PDF Benchmark) */}
            <div className="text-center pb-4 mb-4">
              <h1 className="text-lg sm:text-xl font-black uppercase tracking-wide text-slate-900">
                {ledgerData.agency?.name || 'KHETLAJI INDUSTRIES'}
              </h1>
              <p className="text-xs text-slate-700 mt-1 font-medium leading-relaxed max-w-md mx-auto">
                {ledgerData.agency?.address}
                {ledgerData.agency?.city ? `, ${ledgerData.agency.city}` : ''}
              </p>
              {ledgerData.agency?.email && (
                <p className="text-xs text-slate-700 mt-0.5 font-medium">
                  E-Mail : {ledgerData.agency.email}
                </p>
              )}
            </div>

            {/* 2. Party Block: Account Title & Address */}
            <div className="text-center pb-3 mb-4 border-b border-slate-200 print:border-slate-400">
              <h2 className="text-base sm:text-lg font-black uppercase tracking-wide text-slate-900">
                {ledgerData.party?.name}
              </h2>
              <p className="text-xs font-semibold text-slate-700 tracking-wide mt-0.5">
                Ledger Account
              </p>
              {ledgerData.party?.address && (
                <p className="text-xs text-slate-600 mt-1 font-medium max-w-lg mx-auto whitespace-pre-line leading-relaxed">
                  {ledgerData.party.address}
                  {ledgerData.party?.city ? `, ${ledgerData.party.city}` : ''}
                </p>
              )}
              {/* Period Date Display */}
              <p className="text-xs font-bold text-slate-800 mt-2 tracking-wide">
                {ledgerData.period?.display}
              </p>
            </div>

            {/* 3. The 6-Column Tally Ledger Table */}
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-t border-b border-slate-900 text-slate-900 font-bold">
                    <th className="py-2.5 px-3 text-left w-24">Date</th>
                    <th className="py-2.5 px-3 text-left">Particulars</th>
                    <th className="py-2.5 px-3 text-left w-28">Vch Type</th>
                    <th className="py-2.5 px-3 text-left w-28">Vch No.</th>
                    <th className="py-2.5 px-3 text-right w-28">Debit</th>
                    <th className="py-2.5 px-3 text-right w-28">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 print:divide-none">
                  {ledgerData.segments.map((seg, sIdx) => (
                    <SegmentRows key={sIdx} seg={seg} isFirst={sIdx === 0} fmtCurrency={fmtCurrency} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Print Footer Notice */}
            <div className="mt-8 pt-4 border-t border-slate-200 text-[10px] text-slate-500 text-right print:block hidden">
              Generated on {format(new Date(), 'dd-MMM-yyyy HH:mm')} • Security Firm Management System
            </div>
          </div>
        )}
      </div>

      {/* Print Specific CSS to guarantee exact A4 formatting */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 12mm 15mm 15mm 15mm;
          }
          body {
            background: white !important;
            color: black !important;
            font-size: 11pt !important;
          }
          .print\\:hidden {
            display: none !important;
          }
          .print\\:block {
            display: block !important;
          }
          table {
            border-collapse: collapse !important;
            width: 100% !important;
          }
          th, td {
            padding: 4px 6px !important;
            color: black !important;
          }
          thead tr {
            border-top: 1.5pt solid black !important;
            border-bottom: 1.5pt solid black !important;
          }
          .border-subtotal {
            border-top: 1pt solid black !important;
          }
          .border-balanced-totals {
            border-top: 1pt solid black !important;
            border-bottom: 2.5pt double black !important;
          }
        }
      `}</style>
    </div>
  );
}

/**
 * Sub-component for rendering a Financial Year Segment (with year rollover support like PDF 2)
 */
function SegmentRows({ seg, fmtCurrency }) {
  return (
    <>
      {/* 1. Opening Balance Row (if present) */}
      {seg.opening_balance && (
        <tr className="font-semibold text-slate-900">
          <td className="py-2 px-3 text-left whitespace-nowrap">{seg.opening_balance.date_formatted}</td>
          <td className="py-2 px-3 text-left font-bold">{seg.opening_balance.particulars}</td>
          <td className="py-2 px-3 text-left"></td>
          <td className="py-2 px-3 text-left"></td>
          <td className="py-2 px-3 text-right font-mono font-bold">
            {seg.opening_balance.side === 'debit' ? fmtCurrency(seg.opening_balance.amount) : ''}
          </td>
          <td className="py-2 px-3 text-right font-mono font-bold">
            {seg.opening_balance.side === 'credit' ? fmtCurrency(seg.opening_balance.amount) : ''}
          </td>
        </tr>
      )}

      {/* 2. Regular Period Transactions */}
      {seg.rows.map((r, rIdx) => (
        <tr key={rIdx} className="hover:bg-slate-50 transition-colors">
          <td className="py-1.5 px-3 text-left whitespace-nowrap text-slate-800 font-medium">
            {r.date_formatted}
          </td>
          <td className="py-1.5 px-3 text-left font-medium text-slate-900">
            {r.particulars}
          </td>
          <td className="py-1.5 px-3 text-left text-slate-700">
            {r.vch_type}
          </td>
          <td className="py-1.5 px-3 text-left font-mono text-slate-800">
            {r.vch_no}
          </td>
          <td className="py-1.5 px-3 text-right font-mono font-medium text-slate-900">
            {r.debit > 0 ? fmtCurrency(r.debit) : ''}
          </td>
          <td className="py-1.5 px-3 text-right font-mono font-medium text-slate-900">
            {r.credit > 0 ? fmtCurrency(r.credit) : ''}
          </td>
        </tr>
      ))}

      {/* 3. Subtotal Line (Single top line) */}
      <tr className="border-t border-slate-400 font-semibold border-subtotal">
        <td className="py-2 px-3" colSpan="4"></td>
        <td className="py-2 px-3 text-right font-mono text-slate-800">
          {fmtCurrency(seg.subtotal_debit)}
        </td>
        <td className="py-2 px-3 text-right font-mono text-slate-800">
          {fmtCurrency(seg.subtotal_credit)}
        </td>
      </tr>

      {/* 4. Closing Balance Row */}
      {seg.closing_balance && seg.closing_balance.amount > 0 && (
        <tr className="font-semibold text-slate-900">
          <td className="py-2 px-3 text-left"></td>
          <td className="py-2 px-3 text-left font-bold">{seg.closing_balance.particulars}</td>
          <td className="py-2 px-3"></td>
          <td className="py-2 px-3"></td>
          <td className="py-2 px-3 text-right font-mono font-bold">
            {seg.closing_balance.side === 'debit' ? fmtCurrency(seg.closing_balance.amount) : ''}
          </td>
          <td className="py-2 px-3 text-right font-mono font-bold">
            {seg.closing_balance.side === 'credit' ? fmtCurrency(seg.closing_balance.amount) : ''}
          </td>
        </tr>
      )}

      {/* 5. Final Equalized Grand Totals (Single Top, Double Bottom Border) */}
      <tr className="border-t border-b-4 border-double border-slate-900 font-bold border-balanced-totals">
        <td className="py-2 px-3" colSpan="4"></td>
        <td className="py-2 px-3 text-right font-mono font-black text-slate-950 text-xs sm:text-sm">
          {fmtCurrency(seg.equalized_total)}
        </td>
        <td className="py-2 px-3 text-right font-mono font-black text-slate-950 text-xs sm:text-sm">
          {fmtCurrency(seg.equalized_total)}
        </td>
      </tr>

      {/* Spacing between multi-year segments */}
      <tr>
        <td colSpan="6" className="py-3"></td>
      </tr>
    </>
  );
}
