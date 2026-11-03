import { useState, useEffect, useCallback } from 'react';
import { Scale, Download, Printer } from 'lucide-react';
import api from '../services/api';
import { toast } from '../context/ToastContext';
import { getApiBaseUrl } from '../utils/apiUrl';
import TallyReportDocument from '../components/TallyReportDocument';

const todayStr = () => new Date().toISOString().split('T')[0];

const formatDateLong = (d) => {
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }).replace(/ /g, '-');
  } catch { return d; }
};

// Flattens the grouped trial-balance into the same row shape the backend's
// PDF/Excel export builds, so on-screen and downloaded versions always match.
function toRows(groups) {
  const rows = [];
  groups.forEach((g) => {
    rows.push({ type: 'group', indent: 0, values: { particulars: g.name, debit: g.debit, credit: g.credit } });
    g.items.forEach((it) => {
      rows.push({ type: 'detail', indent: 1, values: { particulars: it.name, debit: it.debit, credit: it.credit } });
    });
  });
  return rows;
}

export default function TrialBalance() {
  const [asOnDate, setAsOnDate] = useState(todayStr());
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/trial-balance?as_on_date=${asOnDate}`);
      if (res.success) setData(res.data);
      else toast.error(res.message || 'Failed to load trial balance');
    } catch (e) {
      toast.error(e?.message || 'Failed to load trial balance');
    }
    setLoading(false);
  }, [asOnDate]);

  useEffect(() => { load(); }, [load]);

  const rows = data ? [
    ...toRows(data.groups),
    { type: 'total', indent: 0, values: { particulars: 'Grand Total', debit: data.grand_total_debit, credit: data.grand_total_credit } },
  ] : [];

  const exportUrl = (format) => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const params = new URLSearchParams({ as_on_date: asOnDate, format, ...(token ? { token } : {}) });
    return `${getApiBaseUrl()}/trial-balance/export?${params.toString()}`;
  };

  return (
    <div className="space-y-4 animate-fade-in pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Scale className="text-teal-600 shrink-0" size={24} /> Trial Balance
          </h1>
          <p className="text-sm text-slate-500 mt-1">Every ledger and bank/cash account, grouped and balanced — reflects what's posted through vouchers.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-3 print:hidden">
        <label className="text-sm text-slate-600 font-medium">As on</label>
        <input type="date" value={asOnDate} onChange={(e) => setAsOnDate(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium cursor-pointer">
            <Printer size={15} /> Print
          </button>
          <a href={exportUrl('xlsx')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold no-underline">
            <Download size={15} /> Excel
          </a>
          <a href={exportUrl('pdf')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold no-underline">
            <Download size={15} /> PDF
          </a>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 print:border-none print:shadow-none print:rounded-none">
        {loading ? (
          <div className="text-center py-16 text-slate-400">Loading...</div>
        ) : (
          <TallyReportDocument
            companyName={company.agency_name}
            companyAddress={company.agency_address}
            companyEmail={company.agency_email}
            title="Trial Balance"
            subtitle={`as on ${formatDateLong(asOnDate)}`}
            groupHeader="Closing Balance"
            columns={[
              { key: 'particulars', label: 'Particulars' },
              { key: 'debit', label: 'Debit', money: true },
              { key: 'credit', label: 'Credit', money: true },
            ]}
            rows={rows}
          />
        )}
      </div>
    </div>
  );
}
