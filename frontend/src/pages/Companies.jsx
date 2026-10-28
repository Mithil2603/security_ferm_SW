import { useState, useEffect } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Building2, Plus, Loader2, Archive, X, Check, AlertCircle } from 'lucide-react';

export default function Companies() {
  const { user, switchCompany } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const currentCompanyId = user?.company?.id;

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/companies');
      setCompanies(res.data || []);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load companies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.post('/companies', { name: newName.trim() });
      setNewName('');
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err.message || 'Failed to create company');
    } finally {
      setCreating(false);
    }
  };

  const handleArchive = async (id, name) => {
    if (!window.confirm(`Archive "${name}"? It will be hidden from the switcher, but its data is kept.`)) return;
    setBusyId(id);
    try {
      await api.delete(`/companies/${id}`);
      await load();
    } catch (err) {
      setError(err.message || 'Failed to archive company');
    } finally {
      setBusyId(null);
    }
  };

  const handleSwitch = async (id) => {
    if (id === currentCompanyId) return;
    setBusyId(id);
    try {
      await switchCompany(id);
      window.location.reload();
    } catch (err) {
      setError(err.message || 'Failed to switch company');
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Companies</h1>
          <p className="text-slate-500 text-sm mt-1">Every company here is fully separate — its own books, invoices, and ledgers. All of {user?.business?.name || 'your business'}'s users can access any of them.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-medium text-sm shadow-sm transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" /> New Company
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-100 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-500" />
          <p className="text-sm font-medium text-red-700">{error}</p>
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-5 bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center gap-3">
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Company name"
            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 cursor-pointer"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
          </button>
          <button
            type="button"
            onClick={() => { setShowCreate(false); setNewName(''); }}
            className="p-2 text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm divide-y divide-slate-100 overflow-hidden">
          {companies.map((c) => (
            <div key={c.id} className="flex items-center gap-4 px-5 py-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white shrink-0">
                <Building2 className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 truncate">{c.name}</p>
                {c.legal_name && <p className="text-xs text-slate-400 truncate">{c.legal_name}</p>}
              </div>
              {c.id === currentCompanyId ? (
                <span className="flex items-center gap-1 text-xs font-bold text-teal-600 bg-teal-50 px-2.5 py-1 rounded-full">
                  <Check className="w-3.5 h-3.5" /> Current
                </span>
              ) : (
                <button
                  onClick={() => handleSwitch(c.id)}
                  disabled={busyId === c.id}
                  className="text-xs font-bold text-teal-600 hover:text-teal-800 px-2.5 py-1 cursor-pointer disabled:opacity-50"
                >
                  {busyId === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Switch to'}
                </button>
              )}
              {companies.length > 1 && (
                <button
                  onClick={() => handleArchive(c.id, c.name)}
                  disabled={busyId === c.id}
                  title="Archive company"
                  className="p-2 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Archive className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
