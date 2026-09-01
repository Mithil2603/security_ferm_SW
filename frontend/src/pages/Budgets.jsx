import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, AlertTriangle, Plus, Trash2, X } from 'lucide-react';
import api from '../services/api';
import { toast, confirmDialog } from '../context/ToastContext';

export default function Budgets() {
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const currentYear = new Date().getFullYear();
  const [form, setForm] = useState({
    entity_type: 'client',
    entity_id: '',
    budget_category: '',
    amount: '',
    period_start: `${currentYear}-04-01`,
    period_end: `${currentYear + 1}-03-31`
  });

  const [clients, setClients] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [budRes, cliRes, venRes] = await Promise.allSettled([
        api.get('/budgets/vs-actual'),
        api.get('/clients?limit=200'),
        api.get('/vendors?limit=200')
      ]);
      if (budRes.status === 'fulfilled') setBudgets(budRes.value.data || []);
      if (cliRes.status === 'fulfilled') setClients(cliRes.value.data || []);
      if (venRes.status === 'fulfilled') setVendors(venRes.value.data || []);
    } catch (err) {
      console.error('Failed to fetch budget data:', err);
      setError('Failed to load budget data');
      toast.error('Failed to load budget data');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.amount || parseFloat(form.amount) <= 0) {
      toast.error('Please enter a valid budget amount');
      return;
    }
    setSaving(true);
    try {
      await api.post('/budgets', form);
      toast.success('Budget saved successfully!');
      setShowModal(false);
      setForm({
        entity_type: 'client', entity_id: '', budget_category: '', amount: '',
        period_start: `${currentYear}-04-01`, period_end: `${currentYear + 1}-03-31`
      });
      fetchData();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to save budget';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    const confirmed = await confirmDialog({
      title: 'Delete Budget',
      message: 'Are you sure you want to delete this budget?',
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) return;
    try {
      await api.delete(`/budgets/${id}`);
      toast.success('Budget deleted successfully!');
      fetchData();
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to delete budget';
      toast.error(msg);
    }
  };

  const getEntityName = (type, id) => {
    if (!id) return 'General/All';
    if (type === 'client') {
      const c = clients.find(c => c.id === parseInt(id));
      return c ? c.name : `Client #${id}`;
    }
    if (type === 'vendor') {
      const v = vendors.find(v => v.id === parseInt(id));
      return v ? v.name : `Vendor #${id}`;
    }
    return 'General/All';
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Budgets vs Actuals</h1>
          <p className="text-slate-500 text-sm mt-1">Track financial limits against real expenses/revenue</p>
        </div>
        <button onClick={() => setShowModal(true)} className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
          <Plus className="w-4 h-4" /> Set Budget
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin h-8 w-8 border-b-2 border-teal-500 rounded-full"></div></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {budgets.length === 0 && (
            <div className="col-span-full text-center py-12 bg-white rounded-xl border border-slate-200">
              <Target className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-medium">No budgets configured</p>
              <button onClick={() => setShowModal(true)} className="text-teal-600 font-medium mt-2 hover:underline">Create your first budget</button>
            </div>
          )}
          {budgets.map(b => (
            <div key={b.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-teal-600 bg-teal-50 px-2 py-1 rounded-md">{b.entity_type}</span>
                  <h3 className="font-bold text-slate-800 mt-2 text-lg">{getEntityName(b.entity_type, b.entity_id)}</h3>
                  <p className="text-xs text-slate-500 mt-1">{b.budget_category || 'All Categories'} • {b.period_start} to {b.period_end}</p>
                </div>
                <button onClick={() => handleDelete(b.id)} className="text-slate-400 hover:text-red-500 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="flex justify-between items-end mb-2 mt-6">
                <div>
                  <p className="text-xs text-slate-500 font-medium mb-1">Budget</p>
                  <p className="text-lg font-bold text-slate-800">₹ {parseFloat(b.amount).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500 font-medium mb-1">Actual</p>
                  <p className={`text-lg font-bold ${b.percentage > 100 ? 'text-red-600' : 'text-emerald-600'}`}>₹ {parseFloat(b.actual_amount).toLocaleString()}</p>
                </div>
              </div>

              <div className="w-full bg-slate-100 rounded-full h-2.5 mt-2 overflow-hidden">
                <div className={`h-2.5 rounded-full ${b.percentage > 100 ? 'bg-red-500' : b.percentage > 85 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(b.percentage, 100)}%` }}></div>
              </div>
              <div className="flex justify-between mt-2">
                <span className="text-xs font-medium text-slate-500">{b.percentage.toFixed(1)}% Used</span>
                {b.percentage > 100 && (
                  <span className="text-xs font-medium text-red-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> Exceeded by ₹{Math.abs(b.variance).toLocaleString()}</span>
                )}
                {b.percentage <= 100 && (
                  <span className="text-xs font-medium text-emerald-600">₹{b.variance.toLocaleString()} Remaining</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800">Set Budget</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 text-xl font-medium">&times;</button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Entity Type</label>
                  <select value={form.entity_type} onChange={e => setForm({...form, entity_type: e.target.value})} className="w-full text-sm border-slate-200 rounded-lg p-2.5 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 bg-slate-50" required>
                    <option value="client">Client</option>
                    <option value="vendor">Vendor</option>
                    <option value="internal">Internal / General</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Specific Entity (Optional)</label>
                  <select value={form.entity_id} onChange={e => setForm({...form, entity_id: e.target.value})} className="w-full text-sm border-slate-200 rounded-lg p-2.5 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 bg-slate-50">
                    <option value="">-- All --</option>
                    {form.entity_type === 'client' && clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    {form.entity_type === 'vendor' && vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Budget Category (Optional)</label>
                <input type="text" value={form.budget_category} onChange={e => setForm({...form, budget_category: e.target.value})} className="w-full text-sm border-slate-200 rounded-lg p-2.5 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 bg-slate-50" placeholder="e.g. Travel, Operations, Office Supplies" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Budget Amount (₹)</label>
                <input type="number" step="0.01" min="1" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} className="w-full text-sm border-slate-200 rounded-lg p-2.5 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 bg-slate-50" required placeholder="0.00" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Period Start</label>
                  <input type="date" value={form.period_start} onChange={e => setForm({...form, period_start: e.target.value})} className="w-full text-sm border-slate-200 rounded-lg p-2.5 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 bg-slate-50" required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Period End</label>
                  <input type="date" value={form.period_end} onChange={e => setForm({...form, period_end: e.target.value})} className="w-full text-sm border-slate-200 rounded-lg p-2.5 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 bg-slate-50" required />
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors text-sm">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-medium transition-colors text-sm disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Budget'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
