import { useState, useEffect } from 'react';
import { X, Layers, Info } from 'lucide-react';
import api from '../services/api';
import Select from './ui/Select';

const NATURE_OPTIONS = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'asset', label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'capital', label: 'Capital' },
];

// Create / edit a ledger group (Tally-style), including the 13 built-in
// defaults — editing one of those forks a private copy for this company only
// (the backend handles that transparently); other businesses are unaffected.
export default function LedgerGroupFormModal({ isOpen, onClose, onSaved, group = null, affectedLedgers = [] }) {
  const [form, setForm] = useState({ name: '', nature: 'expense', report: 'pl', is_direct: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setForm(group
      ? { name: group.name || '', nature: group.nature || 'expense', report: group.report || 'pl', is_direct: !!Number(group.is_direct) }
      : { name: '', nature: 'expense', report: 'pl', is_direct: false });
  }, [isOpen, group]);

  if (!isOpen) return null;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const body = { name: form.name.trim(), nature: form.nature, report: form.report, is_direct: form.is_direct };
      const res = group
        ? await api.put(`/ledger-accounts/groups/${group.id}`, body)
        : await api.post('/ledger-accounts/groups', body);
      if (res.success) onSaved?.(res.data, res.message);
      else setError(res.message || 'Failed to save group');
    } catch (err) {
      setError(err?.message || 'Failed to save group');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[1100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Layers size={18} className="text-teal-600 shrink-0" />
            {group ? 'Edit Group' : 'Create Group'}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {group && (
            <div className="flex items-start gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
              <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
              <span>
                {affectedLedgers.length > 0 ? (
                  <>This updates {affectedLedgers.length} ledger{affectedLedgers.length === 1 ? '' : 's'} under this group ({affectedLedgers.map(l => l.name).join(', ')}), and how they appear in the P&L Account / Balance Sheet, the Ledgers list, and Account Ledger statements.</>
                ) : (
                  <>No ledgers use this group yet — this only changes how it appears going forward.</>
                )}
                {group.is_system && <> This is a default group, so the change only applies to your company — other businesses keep seeing the original.</>}
              </span>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Group Name *</label>
            <input autoFocus required minLength={2} maxLength={100} value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Director's Remuneration"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Nature *</label>
            <Select required value={form.nature} onChange={e => setForm(f => ({ ...f, nature: e.target.value, report: ['expense', 'income'].includes(e.target.value) ? 'pl' : 'bs' }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
              {NATURE_OPTIONS.map(n => <option key={n.value} value={n.value}>{n.label}</option>)}
            </Select>
            <p className="text-xs text-slate-500 mt-1">
              {['expense', 'income'].includes(form.nature) ? 'Shows in the P&L Account' : 'Shows in the Balance Sheet'}
            </p>
          </div>
          {form.nature === 'expense' && (
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={form.is_direct} onChange={e => setForm(f => ({ ...f, is_direct: e.target.checked }))} />
              Direct expense (e.g. cost of service) — otherwise it's indirect
            </label>
          )}
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-sm cursor-pointer">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 rounded-lg border-none bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm cursor-pointer disabled:opacity-60">
              {saving ? 'Saving...' : group ? 'Update Group' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
