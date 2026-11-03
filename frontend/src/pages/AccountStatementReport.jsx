import { useState, useEffect, useCallback } from 'react';
import { Landmark, Wallet, Download, Printer } from 'lucide-react';
import api from '../services/api';
import { toast } from '../context/ToastContext';
import { getApiBaseUrl } from '../utils/apiUrl';
import Select from '../components/ui/Select';
import TallyReportDocument from '../components/TallyReportDocument';

const formatDateLong = (d) => {
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }).replace(/ /g, '-');
  } catch { return d; }
};

// Bank Report and Cash Report are the same screen — just restricted to a
// different account_type. Each account is its own, never-combined report,
// exactly matching how Bank Reconciliation's account picker works.
export default function AccountStatementReport({ accountType }) {
  const isCash = accountType === 'cash';
  const [accounts, setAccounts] = useState([]);
  const [showInactive, setShowInactive] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [company, setCompany] = useState({});
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/settings/system/agency_settings')
      .then((res) => {
        const parsed = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        if (parsed) setCompany(parsed);
      })
      .catch(() => {});
  }, []);

  // Re-fetches whenever accountType changes too — Bank Report and Cash
  // Report share this same component, and React Router reuses the mounted
  // instance across that route change rather than remounting it, so
  // selectedId must be reset here or a stale id from the other report's
  // account would silently carry over.
  useEffect(() => {
    api.get('/bank-accounts').then((res) => {
      if (res.success) {
        const list = res.data.filter((a) => a.account_type === accountType && (showInactive || a.is_active));
        setAccounts(list);
        setSelectedId((prev) => {
          if (prev && list.some((a) => String(a.id) === String(prev))) return prev;
          return list.length > 0 ? String(list[0].id) : '';
        });
      }
    }).catch(() => {});
  }, [accountType, showInactive]);

  const load = useCallback(async () => {
    if (!selectedId) { setData(null); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ ...(fromDate ? { from_date: fromDate } : {}), ...(toDate ? { to_date: toDate } : {}) });
      const res = await api.get(`/bank-accounts/${selectedId}/statement/export?${params.toString()}`);
      if (res.success) setData(res.data);
      else toast.error(res.message || 'Failed to load report');
    } catch (e) {
      toast.error(e?.message || 'Failed to load report');
    }
    setLoading(false);
  }, [selectedId, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const rows = data ? [
    { type: 'group', indent: 0, values: { particulars: 'Opening Balance', balance: data.opening_balance } },
    ...data.entries.map((e) => ({
      type: 'detail',
      indent: 0,
      values: {
        date: formatDateLong(e.voucher_date),
        particulars: e.party_name || e.narration || '-',
        vch_type: String(e.voucher_type || '').replace(/_/g, ' '),
        vch_no: e.voucher_number,
        debit: e.debit_amount || '',
        credit: e.credit_amount || '',
        balance: e.running_balance,
      },
    })),
    { type: 'total', indent: 0, values: { particulars: 'Closing Balance', debit: data.total_debit, credit: data.total_credit, balance: data.closing_balance } },
  ] : [];

  const exportUrl = (format) => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const params = new URLSearchParams({ format, ...(fromDate ? { from_date: fromDate } : {}), ...(toDate ? { to_date: toDate } : {}), ...(token ? { token } : {}) });
    return `${getApiBaseUrl()}/bank-accounts/${selectedId}/statement/export?${params.toString()}`;
  };

  // Bank name is the meaningful label (e.g. "Indusind Bank") — account_name
  // is often just the holder's/company's name, which reads wrong here.
  const displayName = (a) => a.bank_name || a.account_name;

  const selectedAccount = accounts.find((a) => String(a.id) === String(selectedId));
  const Icon = isCash ? Wallet : Landmark;
  const title = isCash ? 'Cash Report' : 'Bank Report';
  const subtitle = selectedAccount
    ? `${displayName(selectedAccount)}${fromDate ? ` — ${formatDateLong(fromDate)} to ${formatDateLong(toDate)}` : ` — as on ${formatDateLong(toDate)}`}`
    : '';

  return (
    <div className="space-y-4 animate-fade-in pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Icon className="text-teal-600 shrink-0" size={24} /> {title}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Pick {isCash ? 'a cash account' : 'a bank account'} to see every transaction posted to it — one account's full statement at a time, never combined with another.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-3 print:hidden">
        <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white min-w-[220px]">
          {accounts.length === 0 && <option value="">No {isCash ? 'cash' : 'bank'} accounts found</option>}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{displayName(a)}{a.account_number ? ` (${a.account_number})` : ''}{!a.is_active ? ' — inactive' : ''}</option>
          ))}
        </Select>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} placeholder="From"
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} placeholder="To"
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
        <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive accounts
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => window.print()} disabled={!selectedId}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium cursor-pointer disabled:opacity-50">
            <Printer size={15} /> Print
          </button>
          <a href={selectedId ? exportUrl('xlsx') : undefined} aria-disabled={!selectedId}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold no-underline ${!selectedId ? 'opacity-50 pointer-events-none' : ''}`}>
            <Download size={15} /> Excel
          </a>
          <a href={selectedId ? exportUrl('pdf') : undefined} aria-disabled={!selectedId}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold no-underline ${!selectedId ? 'opacity-50 pointer-events-none' : ''}`}>
            <Download size={15} /> PDF
          </a>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 print:border-none print:shadow-none print:rounded-none">
        {loading ? (
          <div className="text-center py-16 text-slate-400">Loading...</div>
        ) : !selectedId ? (
          <div className="text-center py-16 text-slate-400">Select {isCash ? 'a cash' : 'a bank'} account above.</div>
        ) : (
          <TallyReportDocument
            companyName={company.agency_name}
            companyAddress={company.agency_address}
            companyEmail={company.agency_email}
            title={title}
            subtitle={subtitle}
            columns={[
              { key: 'date', label: 'Date' },
              { key: 'particulars', label: 'Particulars' },
              { key: 'vch_type', label: 'Vch Type' },
              { key: 'vch_no', label: 'Vch No.' },
              { key: 'debit', label: 'Debit', money: true },
              { key: 'credit', label: 'Credit', money: true },
              { key: 'balance', label: 'Balance', money: true },
            ]}
            rows={rows}
          />
        )}
      </div>
    </div>
  );
}
