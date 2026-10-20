import { useState, useEffect } from 'react';
import { X, BookOpen } from 'lucide-react';
import api from '../services/api';
import Select from './ui/Select';

// Create / edit a custom ledger under one of the fixed Tally groups.
// Used by the Ledgers page and the "+ New Ledger" link in the voucher form.
export default function LedgerFormModal({ isOpen, onClose, onSaved, ledger = null, groups: groupsProp = null }) {
  const [groups, setGroups] = useState(groupsProp || []);
  const [form, setForm] = useState({ name: '', group_id: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setForm(ledger
      ? { name: ledger.name || '', group_id: String(ledger.group_id || ''), description: ledger.description || '' }
      : { name: '', group_id: '', description: '' });
    if (groupsProp) setGroups(groupsProp);
    else api.get('/ledger-accounts/groups').then(r => { if (r.success) setGroups(r.data || []); }).catch(() => {});
  }, [isOpen, ledger, groupsProp]);

  if (!isOpen) return null;

  const natureLabel = { expense: 'Expense', income: 'Income', asset: 'Asset', liability: 'Liability', capital: 'Capital' };
  const selected = groups.find(g => String(g.id) === String(form.group_id));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const body = { name: form.name.trim(), group_id: parseInt(form.group_id), description: form.description };
      const res = ledger
        ? await api.put(`/ledger-accounts/${ledger.id}`, body)
        : await api.post('/ledger-accounts', body);
      if (res.success) onSaved?.(res.data, res.message);
      else setError(res.message || 'Failed to save ledger');
    } catch (err) {
      setError(err?.message || 'Failed to save ledger');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[1100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <BookOpen size={18} className="text-teal-600 shrink-0" />
            {ledger ? 'Edit Ledger' : 'Create Ledger'}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-transparent border-none cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {ledger?.source_type && (
            <p className="text-xs text-teal-800 bg-teal-50 rounded-lg px-3 py-2">
              This ledger fills automatically from {ledger.source_label || 'another module'}. Renaming it or changing its group keeps the link.
            </p>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Ledger Name *</label>
            <input autoFocus required minLength={2} maxLength={150} value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Office Rent, Owner Capital"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Under Group *</label>
            <Select required value={form.group_id} onChange={e => setForm(f => ({ ...f, group_id: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="">— Select group —</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
            {selected && (
              <p className="text-xs text-slate-500 mt-1">
                {natureLabel[selected.nature]} · shows in {selected.report === 'pl' ? 'P&L Account' : 'Balance Sheet'}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Description (optional)</label>
            <textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-sm cursor-pointer">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 rounded-lg border-none bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm cursor-pointer disabled:opacity-60">
              {saving ? 'Saving...' : ledger ? 'Update Ledger' : 'Create Ledger'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
