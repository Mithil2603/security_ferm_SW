import { useState, useEffect } from 'react';
import { Layers, Plus, Users, Zap, X, Edit, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../services/api';
import TableSkeleton from '../components/TableSkeleton';
import { toast, confirmDialog } from '../context/ToastContext';

const TEMPLATE_TYPES = {
  custom: { label: 'Custom', color: 'bg-gray-500/20 text-gray-400' },
  guard: { label: 'Guard', color: 'bg-blue-500/20 text-blue-400' },
  supervisor: { label: 'Supervisor', color: 'bg-emerald-500/20 text-emerald-400' },
  manager: { label: 'Manager', color: 'bg-purple-500/20 text-purple-400' },
};

export default function SalaryStructures() {
  const [structures, setStructures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const emptyForm = {
    name: '', base_salary: '', dearness_allowance: '0', house_rent_allowance: '0',
    other_allowances: '0', pf_percentage: '12', esi_applicable: false,
    income_tax_applicable: false, description: '', template_type: 'custom',
  };
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);

  const fetchStructures = async () => {
    try {
      setLoading(true);
      const res = await api.get('/salary-structures?limit=100');
      setStructures(res.data || []);
    } catch (err) {
      console.error('Failed to fetch structures', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStructures(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        base_salary: parseFloat(form.base_salary),
        dearness_allowance: parseFloat(form.dearness_allowance || '0'),
        house_rent_allowance: parseFloat(form.house_rent_allowance || '0'),
        other_allowances: parseFloat(form.other_allowances || '0'),
        pf_percentage: parseFloat(form.pf_percentage || '12'),
      };
      await api.post('/salary-structures', payload);
      setIsCreateOpen(false);
      fetchStructures();
    } catch (err) {
      setError(err.message || 'Failed to create');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        base_salary: parseFloat(form.base_salary),
        dearness_allowance: parseFloat(form.dearness_allowance || '0'),
        house_rent_allowance: parseFloat(form.house_rent_allowance || '0'),
        other_allowances: parseFloat(form.other_allowances || '0'),
        pf_percentage: parseFloat(form.pf_percentage || '12'),
      };
      await api.put(`/salary-structures/${editId}`, payload);
      setIsEditOpen(false);
      fetchStructures();
    } catch (err) {
      setError(err.message || 'Failed to update');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    const confirmed = await confirmDialog({
      title: 'Deactivate Structure',
      message: 'Deactivate this salary structure?',
      confirmText: 'Deactivate',
      variant: 'danger'
    });
    if (!confirmed) return;
    try {
      await api.delete(`/salary-structures/${id}`);
      toast.success('Salary structure deactivated');
      fetchStructures();
    } catch (err) {
      toast.error(err.message || 'Failed to delete');
    }
  };

  const handleSeedTemplates = async () => {
    try {
      const res = await api.get('/salary-structures/templates/seed');
      toast.success(res.message || 'Templates seeded successfully');
      fetchStructures();
    } catch (err) {
      toast.error(err.message || 'Failed to seed');
    }
  };

  const toggleExpand = async (id) => {
    if (expandedId === id) { setExpandedId(null); return; }
    try {
      const res = await api.get(`/salary-structures/${id}/employees`);
      setEmployees(res.data || []);
    } catch (err) {
      setEmployees([]);
    }
    setExpandedId(id);
  };

  const openEdit = (s) => {
    setForm({
      name: s.name, base_salary: String(s.base_salary),
      dearness_allowance: String(s.dearness_allowance || 0),
      house_rent_allowance: String(s.house_rent_allowance || 0),
      other_allowances: String(s.other_allowances || 0),
      pf_percentage: String(s.pf_percentage || 12),
      esi_applicable: !!s.esi_applicable,
      income_tax_applicable: !!s.income_tax_applicable,
      description: s.description || '', template_type: s.template_type || 'custom',
    });
    setEditId(s.id);
    setError('');
    setIsEditOpen(true);
  };

  const handleInput = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const calcGross = () => {
    const b = parseFloat(form.base_salary) || 0;
    const d = parseFloat(form.dearness_allowance) || 0;
    const h = parseFloat(form.house_rent_allowance) || 0;
    const o = parseFloat(form.other_allowances) || 0;
    return b + d + h + o;
  };

  // ─── Modal Form (shared between create and edit) ────────────────────────────
  const renderForm = (onSubmit, buttonText) => (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm text-gray-400 mb-1">Structure Name *</label>
        <input type="text" name="name" value={form.name} onChange={handleInput} required
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" placeholder="Security Guard — Grade I" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Basic Salary (₹) *</label>
          <input type="number" name="base_salary" value={form.base_salary} onChange={handleInput} required min="0" step="0.01"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Template Type</label>
          <select name="template_type" value={form.template_type} onChange={handleInput}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white">
            <option value="custom">Custom</option>
            <option value="guard">Guard</option>
            <option value="supervisor">Supervisor</option>
            <option value="manager">Manager</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">DA (₹)</label>
          <input type="number" name="dearness_allowance" value={form.dearness_allowance} onChange={handleInput} min="0" step="0.01"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">HRA (₹)</label>
          <input type="number" name="house_rent_allowance" value={form.house_rent_allowance} onChange={handleInput} min="0" step="0.01"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Other (₹)</label>
          <input type="number" name="other_allowances" value={form.other_allowances} onChange={handleInput} min="0" step="0.01"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" />
        </div>
      </div>
      <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-3 text-center">
        <span className="text-gray-400 text-sm">Gross Salary: </span>
        <span className="text-white font-bold text-lg">₹{calcGross().toLocaleString('en-IN')}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">PF %</label>
          <input type="number" name="pf_percentage" value={form.pf_percentage} onChange={handleInput} min="0" max="100" step="0.1"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" />
        </div>
        <div className="flex items-end gap-4 pb-2">
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input type="checkbox" name="esi_applicable" checked={form.esi_applicable} onChange={handleInput} className="rounded" /> ESI
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input type="checkbox" name="income_tax_applicable" checked={form.income_tax_applicable} onChange={handleInput} className="rounded" /> TDS
          </label>
        </div>
      </div>
      <div>
        <label className="block text-sm text-gray-400 mb-1">Description</label>
        <textarea name="description" value={form.description} onChange={handleInput} rows="2"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white resize-none" />
      </div>
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={() => { setIsCreateOpen(false); setIsEditOpen(false); }} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg transition-colors">Cancel</button>
        <button type="submit" disabled={submitting} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white py-2 rounded-lg transition-colors">
          {submitting ? 'Saving...' : buttonText}
        </button>
      </div>
    </form>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Layers className="w-6 h-6 text-purple-400" /> Salary Structures
          </h1>
          <p className="text-gray-400 mt-1">Define pay templates for different employee grades</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSeedTemplates} className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors">
            <Zap className="w-4 h-4" /> Seed Templates
          </button>
          <button onClick={() => { setForm(emptyForm); setError(''); setIsCreateOpen(true); }} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> New Structure
          </button>
        </div>
      </div>

      {loading ? <TableSkeleton /> : (
        <div className="space-y-3">
          {structures.length === 0 ? (
            <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-12 text-center">
              <p className="text-gray-500">No salary structures found. Click "Seed Templates" to create predefined ones.</p>
            </div>
          ) : structures.map(s => (
            <div key={s.id} className={`bg-gray-800/30 border rounded-xl overflow-hidden transition-all ${s.is_active ? 'border-gray-700/50' : 'border-red-900/30 opacity-60'}`}>
              <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-700/20" onClick={() => toggleExpand(s.id)}>
                <div className="flex items-center gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{s.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${TEMPLATE_TYPES[s.template_type]?.color || TEMPLATE_TYPES.custom.color}`}>
                        {TEMPLATE_TYPES[s.template_type]?.label || 'Custom'}
                      </span>
                      {!s.is_active && <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">Inactive</span>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{s.description || 'No description'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Gross</div>
                    <div className="font-bold text-white">₹{Number((s.base_salary || 0) + (s.dearness_allowance || 0) + (s.house_rent_allowance || 0) + (s.other_allowances || 0)).toLocaleString('en-IN')}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Employees</div>
                    <div className="font-bold text-blue-400">{s.employee_count || 0}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={(e) => { e.stopPropagation(); openEdit(s); }} className="p-1.5 rounded-lg hover:bg-blue-500/20 text-blue-400"><Edit className="w-4 h-4" /></button>
                    {s.is_active && <button onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }} className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400"><Trash2 className="w-4 h-4" /></button>}
                    {expandedId === s.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                </div>
              </div>

              {expandedId === s.id && (
                <div className="border-t border-gray-700/50 p-4 bg-gray-900/30">
                  <div className="grid grid-cols-5 gap-4 mb-4 text-sm">
                    <div><span className="text-gray-500">Basic:</span> <span className="text-white">₹{Number(s.base_salary).toLocaleString('en-IN')}</span></div>
                    <div><span className="text-gray-500">DA:</span> <span className="text-white">₹{Number(s.dearness_allowance || 0).toLocaleString('en-IN')}</span></div>
                    <div><span className="text-gray-500">HRA:</span> <span className="text-white">₹{Number(s.house_rent_allowance || 0).toLocaleString('en-IN')}</span></div>
                    <div><span className="text-gray-500">PF:</span> <span className="text-white">{s.pf_percentage}%</span></div>
                    <div><span className="text-gray-500">ESI:</span> <span className="text-white">{s.esi_applicable ? 'Yes' : 'No'}</span></div>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-1"><Users className="w-4 h-4" /> Assigned Employees ({employees.length})</h4>
                    {employees.length === 0 ? (
                      <p className="text-xs text-gray-600">No employees assigned to this structure.</p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {employees.map(e => (
                          <div key={e.id} className="bg-gray-800/50 rounded px-3 py-1.5 text-sm">
                            <span className="text-white">{e.full_name}</span>
                            <span className="text-gray-500 ml-2 text-xs">{e.designation}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><Layers className="w-5 h-5 text-purple-400" /> New Salary Structure</h2>
              <button onClick={() => setIsCreateOpen(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg mb-4 text-sm">{error}</div>}
            {renderForm(handleCreate, 'Create Structure')}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {isEditOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><Edit className="w-5 h-5 text-blue-400" /> Edit Salary Structure</h2>
              <button onClick={() => setIsEditOpen(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg mb-4 text-sm">{error}</div>}
            {renderForm(handleUpdate, 'Save Changes')}
          </div>
        </div>
      )}
    </div>
  );
}
