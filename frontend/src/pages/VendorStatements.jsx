import { useState, useEffect } from 'react';
import { Building2, FileText, IndianRupee, Printer, TrendingDown, Clock, Search, AlertCircle, ArrowUpRight } from 'lucide-react';
import api from '../services/api';
import { getServerBaseUrl } from '../utils/apiUrl';
import { format } from 'date-fns';

function formatDateSafe(val) {
  if (!val) return '-';
  try {
    if (typeof val === 'string') {
      const clean = val.split('T')[0];
      const parts = clean.split('-');
      if (parts.length === 3 && parts[0].length === 4) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val).slice(0, 10);
    return format(d, 'dd-MM-yyyy');
  } catch (_) {
    return String(val).slice(0, 10);
  }
}

export default function VendorStatements() {
  const [vendors, setVendors] = useState([]);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [aging, setAging] = useState(null);

  const [agencySettings, setAgencySettings] = useState(null);

  useEffect(() => {
    fetchVendors();
    fetchAgencySettings();
    fetchAging();
  }, []);

  const fetchAgencySettings = async () => {
    try {
      const res = await api.get('/settings/system/agency_settings');
      if (res.data) setAgencySettings(JSON.parse(res.data));
    } catch (err) {
      console.error('Failed to load agency settings', err);
    }
  };

  useEffect(() => {
    if (selectedVendorId) {
      fetchStatement(selectedVendorId);
    } else {
      setStatement(null);
    }
  }, [selectedVendorId]);

  const fetchAging = async () => {
    try {
      const res = await api.get('/vouchers/aging');
      setAging(res.data || null);
    } catch (err) {
      console.error('Failed to load aging', err);
    }
  };

  const fetchVendors = async () => {
    try {
      const res = await api.get('/vendors');
      setVendors(res.data || []);
    } catch (err) {
      console.error(err);
      setError('Failed to load vendors');
    }
  };

  const fetchStatement = async (id) => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get(`/vendors/${id}/statement`);
      
      const { expenses, payments, total_billed, total_paid, balance_due, vendor } = res.data;
      
      const expenseEntries = (expenses || []).map(e => ({
        id: `exp-${e.id}`,
        rawDate: e.expense_date || e.created_at,
        dateDisplay: formatDateSafe(e.expense_date || e.created_at),
        type: 'Expense',
        ref: e.receipt_number ? `Rec #${e.receipt_number}` : `EXP-${e.id}`,
        description: e.description || e.category,
        category: e.category,
        amount_billed: parseFloat(e.amount) || 0,
        amount_paid: parseFloat(e.amount_paid) || 0,
        outstanding: Math.max(0, (parseFloat(e.amount) || 0) - (parseFloat(e.amount_paid) || 0)),
        status: e.status
      }));

      const paymentEntries = (payments || []).map(p => ({
        id: `pmt-${p.id}`,
        rawDate: p.payment_date || p.created_at,
        dateDisplay: formatDateSafe(p.payment_date || p.created_at),
        type: 'Payment',
        ref: p.reference_number || `PMT-${p.id}`,
        description: p.expense_description ? `Payment for: ${p.expense_description}` : `Payment via ${p.payment_mode || 'Bank'}`,
        category: 'Payment',
        amount_billed: 0,
        amount_paid: parseFloat(p.amount) || 0,
        outstanding: 0,
        status: 'paid'
      }));

      const ledger = [...expenseEntries, ...paymentEntries].sort((a, b) => {
        return new Date(b.rawDate || 0) - new Date(a.rawDate || 0);
      });

      setStatement({ vendor, total_billed, total_paid, balance_due, ledger });
    } catch (err) {
      console.error(err);
      setError('Failed to fetch vendor statement');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Vendor Ledger</h1>
          <p className="text-sm text-slate-500 mt-1">View expense statements and payment history for your vendors.</p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select
              value={selectedVendorId}
              onChange={(e) => setSelectedVendorId(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 appearance-none shadow-sm"
            >
              <option value="">Select a vendor...</option>
              {vendors.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handlePrint}
            disabled={!statement}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
          >
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">Print</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-xl border border-red-100 flex items-center gap-2 print:hidden">
          <AlertCircle className="w-5 h-5" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {!selectedVendorId ? (
        aging ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2"><Clock className="w-5 h-5 text-amber-500"/> Global Vendor Aging Report</h3>
            
            <div className="grid grid-cols-4 gap-4 mb-8">
              <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                <p className="text-sm font-medium text-emerald-800">1 - 30 Days</p>
                <p className="text-2xl font-bold text-emerald-600 mt-2">₹ {aging['1_to_30']?.reduce((acc, curr) => acc + curr.amount, 0).toLocaleString() || 0}</p>
              </div>
              <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
                <p className="text-sm font-medium text-amber-800">31 - 60 Days</p>
                <p className="text-2xl font-bold text-amber-600 mt-2">₹ {aging['31_to_60']?.reduce((acc, curr) => acc + curr.amount, 0).toLocaleString() || 0}</p>
              </div>
              <div className="p-4 bg-orange-50 rounded-xl border border-orange-100">
                <p className="text-sm font-medium text-orange-800">61 - 90 Days</p>
                <p className="text-2xl font-bold text-orange-600 mt-2">₹ {aging['61_to_90']?.reduce((acc, curr) => acc + curr.amount, 0).toLocaleString() || 0}</p>
              </div>
              <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                <p className="text-sm font-medium text-red-800">Over 90 Days</p>
                <p className="text-2xl font-bold text-red-600 mt-2">₹ {aging['over_90']?.reduce((acc, curr) => acc + curr.amount, 0).toLocaleString() || 0}</p>
              </div>
            </div>
            <p className="text-sm text-slate-500 mb-4">Select a vendor from the dropdown to view detailed statements.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center print:hidden">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-900 mb-1">No Vendor Selected</h3>
            <p className="text-slate-500">Please select a vendor from the dropdown above to view their statement.</p>
          </div>
        )
      ) : loading ? (
        <div className="flex justify-center p-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500"></div>
        </div>
      ) : statement ? (
        <div className="bg-white p-8 sm:p-12 shadow-sm border border-slate-200 print:border-none print:shadow-none print:p-0">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-12">
            <div className="w-48 h-24 flex items-center justify-start overflow-hidden">
              {agencySettings?.agency_logo_url ? (
                <img src={`${getServerBaseUrl()}${agencySettings.agency_logo_url}`} alt="Agency Logo" className="w-full h-full object-contain object-left" />
              ) : (
                <div className="w-full h-full border border-dashed border-slate-300 flex items-center justify-center text-slate-400 font-bold tracking-widest text-sm bg-slate-50">
                  YOUR LOGO HERE
                </div>
              )}
            </div>
            <div className="text-right w-full sm:w-auto">
              <h1 className="text-4xl font-black text-slate-500 tracking-wider">STATEMENT</h1>
            </div>
          </div>

          {/* Bill To & Summary */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-8 mb-12">
            <div>
              <h2 className="text-lg font-bold text-slate-900 border-b-2 border-slate-300 pb-1 mb-3 inline-block">Bill To</h2>
              <p className="font-bold text-slate-900 text-lg">{statement.vendor.name}</p>
              {statement.vendor.contact_info && (
                <p className="text-slate-700 whitespace-pre-wrap mt-1">{statement.vendor.contact_info}</p>
              )}
            </div>
            <div className="text-right text-sm w-full sm:w-auto">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                <span className="text-slate-600">As Of</span>
                <span className="text-slate-900 font-medium">{format(new Date(), 'MM-dd-yyyy')}</span>
                
                <span className="text-slate-600">Total Invoiced</span>
                <span className="text-slate-900 font-medium">₹{statement.total_billed.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                
                <span className="text-slate-600">Total Paid</span>
                <span className="text-slate-900 font-medium">₹{statement.total_paid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                
                <span className="text-slate-900 font-bold mt-2">Total Outstanding</span>
                <span className="text-slate-900 font-bold mt-2">₹{statement.balance_due.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="mb-12">
            <h3 className="text-xl font-bold text-slate-500 tracking-wider mb-6 uppercase">SUMMARY</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-300 text-slate-900">
                    <th className="py-3 font-bold text-left">DATE</th>
                    <th className="py-3 font-bold text-left">REFERENCE</th>
                    <th className="py-3 font-bold text-left">DETAILS</th>
                    <th className="py-3 font-bold text-right">AMOUNT</th>
                    <th className="py-3 font-bold text-right">PAID</th>
                    <th className="py-3 font-bold text-right">OUTSTANDING</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {statement.ledger.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="py-8 text-center text-slate-500">No transactions recorded.</td>
                    </tr>
                  ) : (
                    statement.ledger.filter(item => item.status !== 'rejected').map((item) => (
                      <tr key={item.id}>
                        <td className="py-3 text-slate-800 font-medium">{item.dateDisplay}</td>
                        <td className="py-3 text-slate-800">{item.ref || '-'}</td>
                        <td className="py-3 text-slate-800 truncate max-w-[200px]">{item.description}</td>
                        <td className="py-3 text-right text-slate-800">
                          {item.amount_billed > 0 ? '₹' + item.amount_billed.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '₹0.00'}
                        </td>
                        <td className="py-3 text-right text-slate-800">
                          {item.amount_paid > 0 ? '₹' + item.amount_paid.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '₹0.00'}
                        </td>
                        <td className="py-3 text-right text-slate-800">
                          {item.outstanding > 0 ? '₹' + item.outstanding.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '₹0.00'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-y-2 border-slate-300 font-bold text-slate-900">
                    <td colSpan="3" className="py-4 text-right pr-4 uppercase tracking-wider">GRAND TOTAL</td>
                    <td className="py-4 text-right">₹{statement.total_billed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="py-4 text-right">₹{statement.total_paid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="py-4 text-right">₹{statement.balance_due.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Footer */}
          <div className="flex flex-col sm:flex-row justify-between items-start pt-8 mt-12 break-inside-avoid">
            <div>
              <h2 className="text-lg font-bold text-slate-900 border-b-2 border-slate-300 pb-1 mb-3 inline-block">Please Send Payment To</h2>
              <p className="font-bold text-slate-900 text-lg">{agencySettings?.agency_name || 'Company Name'}</p>
              <p className="text-slate-700 mt-1 whitespace-pre-wrap">{agencySettings?.agency_address || '123 Main St.\nSalt Lake City, UT 84010'}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
