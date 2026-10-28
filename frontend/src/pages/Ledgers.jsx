import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Plus, Search, Pencil, Trash2, FileText, RotateCcw, Layers, List } from 'lucide-react';
import api from '../services/api';
import { toast, confirmDialog } from '../context/ToastContext';
import Pagination from '../components/Pagination';
import useClientPagination from '../utils/useClientPagination';
import LedgerFormModal from '../components/LedgerFormModal';
import LedgerGroupFormModal from '../components/LedgerGroupFormModal';
import Select from '../components/ui/Select';

const NATURE = {
  expense: { label: 'Expense', cls: 'bg-rose-50 text-rose-700' },
  income: { label: 'Income', cls: 'bg-emerald-50 text-emerald-700' },
  asset: { label: 'Asset', cls: 'bg-sky-50 text-sky-700' },
  liability: { label: 'Liability', cls: 'bg-amber-50 text-amber-700' },
  capital: { label: 'Capital', cls: 'bg-violet-50 text-violet-700' },
};

const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Custom ledgers (Tally-style) under fixed groups. Statements open in the
// shared ledger screen; vouchers post to these from the Vouchers page.
export default function Ledgers() {
  const navigate = useNavigate();
  const [ledgers, setLedgers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groupFilter, setGroupFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [view, setView] = useState('list'); // 'list' | 'groups'
  const [modal, setModal] = useState(null); // null | { ledger }
  const [groupModal, setGroupModal] = useState(null); // null | { group }
  const [dismissedAuto, setDismissedAuto] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const [l, g] = await Promise.all([api.get('/ledger-accounts'), api.get('/ledger-accounts/groups')]);
      if (l.success) { setLedgers(l.data || []); setDismissedAuto(l.dismissed_auto || 0); }
      if (g.success) setGroups(g.data || []);
    } catch (e) {
      toast.error(e?.message || 'Failed to load ledgers');
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ledgers.filter(l =>
      (showInactive || l.is_active) &&
      (!groupFilter || String(l.group_id) === groupFilter) &&
      (!q || l.name.toLowerCase().includes(q) || (l.description || '').toLowerCase().includes(q)));
  }, [ledgers, search, groupFilter, showInactive]);

  const pg = useClientPagination(filtered, 15);
  useEffect(() => { pg.setPage(1); }, [search, groupFilter, showInactive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Group-wise totals (net, on each group's natural side)
  const groupSummary = useMemo(() => groups.map(g => {
    const rows = ledgers.filter(l => l.group_id === g.id && (showInactive || l.is_active));
    const debitNatured = ['expense', 'asset'].includes(g.nature);
    const net = rows.reduce((s, l) => s + (l.total_debit - l.total_credit), 0);
    return {
      ...g,
      count: rows.length,
      amount: Math.abs(net),
      side: net > 0 ? 'Dr' : net < 0 ? 'Cr' : '',
      unusual: net !== 0 && (debitNatured ? net < 0 : net > 0),
    };
  }), [groups, ledgers, showInactive]);

  const handleDelete = async (l) => {
    const used = (l.direct_voucher_count ?? l.voucher_count) > 0;
    const ok = await confirmDialog({
      title: used ? 'Deactivate ledger?' : 'Delete ledger?',
      message: used
        ? `"${l.name}" is used in ${l.direct_voucher_count ?? l.voucher_count} voucher(s), so it will be deactivated (hidden from new vouchers) and its history kept.`
        : l.source_type
        ? `Delete "${l.name}"? Only the ledger view is removed — the entries stay in ${l.source_label}. You can bring it back with "Restore auto ledgers".`
        : used
        ? `"${l.name}" has ${l.voucher_count} voucher(s), so it will be deactivated (hidden from new vouchers) and its history kept.`
        : `"${l.name}" has no vouchers and will be deleted permanently.`,
      confirmText: used ? 'Deactivate' : 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await api.delete(`/ledger-accounts/${l.id}`);
      toast.success(res.message);
      load();
    } catch (e) { toast.error(e?.message || 'Failed to delete ledger'); }
  };

  const handleReactivate = async (l) => {
    try {
      const res = await api.put(`/ledger-accounts/${l.id}`, { is_active: true });
      toast.success(res.message);
      load();
    } catch (e) { toast.error(e?.message || 'Failed to activate ledger'); }
  };

  const handleRestoreAuto = async () => {
    try {
      const res = await api.post('/ledger-accounts/restore-auto');
      toast.success(res.message);
      load();
    } catch (e) { toast.error(e?.message || 'Failed to restore'); }
  };

  const handleDeleteGroup = async (g) => {
    const underGroup = ledgers.filter(l => l.group_id === g.id);
    // Auto-linked ledgers (Expenses, Payroll, Bank Entries) read live from
    // their own module and never show a voucher count here — they still
    // hold real data, so they block the group delete the same as a ledger
    // with recorded vouchers does.
    const hasData = underGroup.filter(l => (l.direct_voucher_count ?? l.voucher_count) > 0 || l.source_type);
    const empty = underGroup.filter(l => !((l.direct_voucher_count ?? l.voucher_count) > 0 || l.source_type));

    if (hasData.length > 0) {
      toast.error(
        `Can't delete "${g.name}" — ${hasData.length} ledger(s) under it have data: ${hasData.map(l => l.name).join(', ')}. ` +
        `Deactivate or move those ledgers first, or edit this group instead of deleting it.`
      );
      return;
    }

    const message = empty.length > 0
      ? `Delete "${g.name}"? This will also permanently delete ${empty.length} unused ledger(s) under it: ${empty.map(l => l.name).join(', ')}. ` +
        `It will also disappear from the P&L / Balance Sheet reports and the Ledgers list. This can't be undone.`
      : `Delete "${g.name}"? It has no ledgers under it. This can't be undone.`;

    const ok = await confirmDialog({
      title: 'Delete group?',
      message,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await api.delete(`/ledger-accounts/groups/${g.id}`);
      toast.success(res.message);
      load();
    } catch (e) { toast.error(e?.message || 'Failed to delete group'); }
  };

  const openStatement = (l) => navigate(`/account-ledger?type=ledger&id=${l.id}`);

  return (
    <div className="space-y-5 animate-fade-in pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <BookOpen className="text-teal-600 shrink-0" size={24} /> Ledgers
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Ledgers under Tally groups. <b>Auto</b> ledgers fill themselves from Expenses, Purchase Bills, Salary and Bank Entries; your own ledgers (capital, loans, deposits…) are used as Debit / Credit in vouchers.
          </p>
        </div>
        <div className="flex items-center gap-2">
        {dismissedAuto > 0 && (
          <button onClick={handleRestoreAuto}
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium cursor-pointer">
            <RotateCcw size={15} className="shrink-0" /> Restore auto ledgers ({dismissedAuto})
          </button>
        )}
        {view === 'groups' ? (
          <button onClick={() => setGroupModal({ group: null })}
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold border-none cursor-pointer">
            <Plus size={16} className="shrink-0" /> New Group
          </button>
        ) : (
          <button onClick={() => setModal({ ledger: null })}
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold border-none cursor-pointer">
            <Plus size={16} className="shrink-0" /> Create Ledger
          </button>
        )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col lg:flex-row gap-3 p-4 border-b border-slate-100 lg:items-center">
          <div className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ledgers..."
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <Select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
            <option value="">All groups</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
          <label className="inline-flex items-center gap-2 text-sm text-slate-600 whitespace-nowrap cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            {[['list', 'Ledgers', List], ['groups', 'Group Summary', Layers]].map(([key, label, Icon]) => (
              <button key={key} onClick={() => setView(key)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-semibold border-none cursor-pointer ${view === key ? 'bg-white text-teal-700 shadow-sm' : 'bg-transparent text-slate-600'}`}>
                <Icon size={14} className="shrink-0" /> {label}
              </button>
            ))}
          </div>
        </div>

        {view === 'list' ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Ledger</th>
                    <th className="text-left px-4 py-3 font-semibold">Group</th>
                    <th className="text-left px-4 py-3 font-semibold">Nature</th>
                    <th className="text-right px-4 py-3 font-semibold">Debit</th>
                    <th className="text-right px-4 py-3 font-semibold">Credit</th>
                    <th className="text-right px-4 py-3 font-semibold">Balance</th>
                    <th className="text-center px-4 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="text-center py-10 text-slate-400">Loading ledgers...</td></tr>
                  ) : pg.pageItems.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-10 text-slate-400">
                      {ledgers.length === 0 ? 'No ledgers yet. Click "Create Ledger" to add your first one.' : 'No ledgers match these filters.'}
                    </td></tr>
                  ) : pg.pageItems.map(l => (
                    <tr key={l.id} className={`border-t border-slate-100 hover:bg-slate-50 ${l.is_active ? '' : 'opacity-60'}`}>
                      <td className="px-4 py-3">
                        <button onClick={() => openStatement(l)} className="font-semibold text-slate-800 hover:text-teal-700 bg-transparent border-none p-0 cursor-pointer text-left">
                          {l.name}
                        </button>
                        {!l.is_active && <span className="ml-2 text-[10px] font-bold uppercase text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">Inactive</span>}
                        {l.source_type && (
                          <span title={`Filled automatically from ${l.source_label}`}
                            className="ml-2 text-[10px] font-bold uppercase text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded">Auto · {l.source_label}</span>
                        )}
                        {l.description && <div className="text-xs text-slate-400 truncate max-w-xs">{l.description}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{l.group_name}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${NATURE[l.nature]?.cls || ''}`}>{NATURE[l.nature]?.label}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-600">{fmt(l.total_debit)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-600">{fmt(l.total_credit)}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800 whitespace-nowrap">
                        {fmt(l.balance)} {l.balance_side}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-1">
                          <button title="View statement" onClick={() => openStatement(l)} className="p-1.5 rounded hover:bg-slate-100 text-slate-500 bg-transparent border-none cursor-pointer"><FileText size={15} /></button>
                          <button title="Edit" onClick={() => setModal({ ledger: l })} className="p-1.5 rounded hover:bg-slate-100 text-blue-600 bg-transparent border-none cursor-pointer"><Pencil size={15} /></button>
                          {l.is_active ? (
                            <button title={(l.direct_voucher_count ?? l.voucher_count) > 0 ? 'Deactivate' : 'Delete'} onClick={() => handleDelete(l)} className="p-1.5 rounded hover:bg-red-50 text-red-600 bg-transparent border-none cursor-pointer"><Trash2 size={15} /></button>
                          ) : (
                            <button title="Activate" onClick={() => handleReactivate(l)} className="p-1.5 rounded hover:bg-emerald-50 text-emerald-600 bg-transparent border-none cursor-pointer"><RotateCcw size={15} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && <div className="px-4 pb-3"><Pagination pagination={pg.pagination} onPageChange={pg.setPage} alwaysShow /></div>}
          </>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Group</th>
                  <th className="text-left px-4 py-3 font-semibold">Nature</th>
                  <th className="text-left px-4 py-3 font-semibold">Shows in</th>
                  <th className="text-right px-4 py-3 font-semibold">Ledgers</th>
                  <th className="text-right px-4 py-3 font-semibold">Balance</th>
                  <th className="text-center px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {groupSummary.map(g => (
                  <tr key={g.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className={`px-4 py-3 font-semibold ${g.count ? 'cursor-pointer' : 'text-slate-400'}`}
                      onClick={() => { if (g.count) { setGroupFilter(String(g.id)); setView('list'); } }}>
                      {g.name}
                      {g.is_system && <span className="ml-1.5 text-[10px] font-bold uppercase text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded align-middle">Default</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${NATURE[g.nature]?.cls || ''}`}>{NATURE[g.nature]?.label}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{g.report === 'pl' ? 'P&L Account' : 'Balance Sheet'}</td>
                    <td className="px-4 py-3 text-right">{g.count}</td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold whitespace-nowrap ${g.unusual ? 'text-amber-700' : ''}`}>
                      {fmt(g.amount)} {g.side}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center gap-1">
                        <button title="Edit" onClick={() => setGroupModal({ group: g })} className="p-1.5 rounded hover:bg-slate-100 text-blue-600 bg-transparent border-none cursor-pointer"><Pencil size={15} /></button>
                        <button title="Delete" onClick={() => handleDeleteGroup(g)} className="p-1.5 rounded hover:bg-red-50 text-red-600 bg-transparent border-none cursor-pointer"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LedgerFormModal
        isOpen={!!modal}
        ledger={modal?.ledger}
        groups={groups}
        onClose={() => setModal(null)}
        onSaved={(_, message) => { setModal(null); toast.success(message || 'Ledger saved'); load(); }} />

      <LedgerGroupFormModal
        isOpen={!!groupModal}
        group={groupModal?.group}
        affectedLedgers={groupModal?.group ? ledgers.filter(l => l.group_id === groupModal.group.id) : []}
        onClose={() => setGroupModal(null)}
        onSaved={(_, message) => { setGroupModal(null); toast.success(message || 'Group saved'); load(); }} />
    </div>
  );
}
