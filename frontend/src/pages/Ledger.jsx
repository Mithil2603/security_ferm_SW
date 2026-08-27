import { useState, useEffect } from 'react';
import api from '../services/api';
import { Plus, Trash2, IndianRupee, ArrowDownRight, ArrowUpRight, Search, X } from 'lucide-react';
import { format } from 'date-fns';

export default function Ledger() {
  const [employees, setEmployees] = useState([]);
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); // C6
  const [search, setSearch] = useState('');

  // Add Transaction Modal
  const [catError, setCatError] = useState(''); // H5

  // Selected Employee Ledger View
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [ledgerEntries, setLedgerEntries] = useState([]);
  const [loadingLedger, setLoadingLedger] = useState(false);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState(null); // H7, L6
  
  const getInitialForm = () => ({ // M5: Full form reset helper
    transaction_date: format(new Date(), 'yyyy-MM-dd'),
    type: '',
    category: '',
    amount: '',
    description: ''
  });
  const [form, setForm] = useState(getInitialForm());

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [empRes, balRes] = await Promise.all([
        api.get('/employees?status=1&limit=5000'), // L2: Increased limit
        api.get('/ledger/balances') // C1: Use separate balances endpoint
      ]);
      setEmployees(empRes.data || []);
      
      const balMap = {};
      (balRes.balances || []).forEach(b => {
        // C3: Safe parsing
        const additions = parseFloat(b.total_additions) || 0;
        const deductions = parseFloat(b.total_deductions) || 0;
        balMap[b.employee_id] = {
          additions,
          deductions,
          net: additions - deductions
        };
      });
      setBalances(balMap);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to fetch ledger data'); // C6
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      setCatError('');
      const res = await api.get('/settings/system/payroll_adjustment_categories');
      setCategories(JSON.parse(res.data || '[]'));
    } catch (err) {
      setCatError('Failed to load categories'); // H5
      setCategories([]);
    }
  };

  useEffect(() => {
    fetchData();
    fetchCategories();
  }, []);

  const openLedger = async (emp) => {
    setSelectedEmp(emp);
    setLoadingLedger(true);
    try {
      const res = await api.get(`/ledger?employee_id=${emp.id}&status=unsettled`);
      setLedgerEntries(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingLedger(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/ledger/${id}`);
      setLedgerEntries(ledgerEntries.filter(e => e.id !== id));
      fetchData(); // refresh balances
      setDeleteId(null);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete');
    }
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    
    // M3: Validate amount
    const amt = parseFloat(form.amount);
    if (!amt || amt < 1) {
      alert('Amount must be at least ₹1');
      return;
    }

    // C4: Safe JSON parse
    let cat;
    try {
      cat = JSON.parse(form.category);
    } catch (err) {
      alert('Invalid category format');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/ledger', {
        employee_id: selectedEmp.id,
        transaction_date: form.transaction_date,
        type: cat.type,
        category: cat.name,
        amount: amt,
        description: form.description
      });
      setIsAddModalOpen(false);
      setForm(getInitialForm()); // M5: Full reset
      openLedger(selectedEmp);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to add transaction');
    } finally {
      setSubmitting(false);
    }
  };

  // M8: Export CSV
  const handleExport = () => {
    if (!selectedEmp || ledgerEntries.length === 0) return;
    let csv = 'Date,Type,Category,Amount,Status,Description\n';
    ledgerEntries.forEach(e => {
      const status = e.payroll_id ? 'Settled (Pending)' : 'Unsettled';
      csv += `"${format(new Date(e.transaction_date), 'yyyy-MM-dd')}","${e.type}","${e.category}",${e.amount},"${status}","${e.description || ''}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedEmp.full_name}_Ledger.csv`;
    a.click();
  };

  const filteredEmployees = employees.filter(e => 
    e.full_name.toLowerCase().includes(search.toLowerCase()) || 
    e.employee_id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <IndianRupee className="w-6 h-6 text-teal-600" />
          Employee Ledger
        </h1>
        <p className="text-slate-500 text-sm mt-1">Track advances, uniform costs, and other mid-month transactions.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left Side: Employee List */}
        <div className="w-full lg:w-1/3 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[calc(100vh-200px)]">
          <div className="p-4 border-b border-slate-100 bg-slate-50">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Search employees..." 
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            {error && <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded border border-red-100">{error}</div>}
          </div>
          <div className="flex-1 overflow-y-auto p-2 min-h-0">
            {loading ? (
              <div className="p-4 text-center text-slate-500">Loading...</div>
            ) : filteredEmployees.length === 0 ? (
              <div className="p-4 text-center text-slate-500">No employees found</div>
            ) : (
              <div className="space-y-1">
                {filteredEmployees.map(emp => {
                  const bal = balances[emp.id] || { net: 0 };
                  const isSelected = selectedEmp?.id === emp.id;
                  return (
                    <button
                      key={emp.id}
                      onClick={() => openLedger(emp)}
                      className={`w-full text-left p-3 rounded-lg transition-colors flex justify-between items-center ${
                        isSelected ? 'bg-teal-50 border-teal-200 border' : 'hover:bg-slate-50 border border-transparent'
                      }`}
                    >
                      <div>
                        <div className="font-medium text-slate-800 text-sm">{emp.full_name}</div>
                        <div className="text-xs text-slate-500">{emp.employee_id}</div>
                      </div>
                      {/* L8: Standardized currency format */}
                      <div className={`text-sm font-bold ${bal.net > 0 ? 'text-emerald-600' : bal.net < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                        {bal.net > 0 ? '+' : (bal.net < 0 ? '-' : '')}₹{Math.abs(bal.net).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Ledger View */}
        <div className="w-full lg:w-2/3 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[calc(100vh-200px)]">
          {selectedEmp ? (
            <>
              <div className="p-6 border-b border-slate-100 flex flex-wrap gap-4 justify-between items-center bg-slate-50">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">{selectedEmp.full_name}</h2>
                  <p className="text-sm text-slate-500">Unsettled Ledger Balance</p>
                </div>
                
                {/* L3: Unsettled Balance Summary */}
                {balances[selectedEmp.id]?.net !== 0 && (
                  <div className={`px-4 py-2 rounded-lg border ${balances[selectedEmp.id]?.net > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                    <div className="text-xs font-bold uppercase">Total Unsettled</div>
                    <div className="text-lg font-bold">
                      {balances[selectedEmp.id]?.net > 0 ? '+' : '-'}₹{Math.abs(balances[selectedEmp.id]?.net || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                )}
                
                <div className="flex gap-2">
                  <button onClick={handleExport} className="bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm">
                    Export CSV
                  </button>
                  <button 
                    onClick={() => setIsAddModalOpen(true)}
                    className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-sm"
                  >
                    <Plus className="w-4 h-4" /> Add Transaction
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 min-h-0">
                {loadingLedger ? (
                  <div className="text-center py-8 text-slate-500">Loading ledger...</div>
                ) : ledgerEntries.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <IndianRupee className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                    <p>No unsettled transactions.</p>
                    <p className="text-sm mt-1">This employee's ledger is completely settled.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {ledgerEntries.map(entry => (
                      <div key={entry.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${entry.type === 'addition' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                            {entry.type === 'addition' ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
                          </div>
                          <div>
                            <div className="font-medium text-slate-800">{entry.category}</div>
                            <div className="text-xs text-slate-500 flex gap-2">
                              <span>{format(new Date(entry.transaction_date), 'dd MMM yyyy')}</span>
                              {entry.description && <span>• {entry.description}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className={`font-bold ${entry.type === 'addition' ? 'text-emerald-600' : 'text-red-600'}`}>
                            {entry.type === 'addition' ? '+' : '-'}₹{parseFloat(entry.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          </div>
                          {entry.payroll_id ? (
                            // M7: Safe date parsing for payroll_month
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 px-2 py-1 rounded">
                              Pending in {format(new Date(entry.payroll_month + (entry.payroll_month.length === 7 ? '-01' : '')), 'MMM yyyy')}
                            </span>
                          ) : (
                            <button onClick={() => setDeleteId(entry.id)} className="text-slate-400 hover:text-red-500 p-2 rounded-lg hover:bg-red-50 transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-8">
              <IndianRupee className="w-16 h-16 text-slate-200 mb-4" />
              <p className="text-lg font-medium text-slate-600">Select an Employee</p>
              <p className="text-sm mt-1 text-center">Click on an employee from the list to view their unsettled ledger entries or add a new transaction.</p>
            </div>
          )}
        </div>
      </div>

      {/* Add Transaction Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800">Add Transaction</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleAddSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                <input type="date" value={form.transaction_date} onChange={e => setForm({...form, transaction_date: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                {catError ? (
                  <div className="text-xs text-red-600 mb-2">{catError}</div>
                ) : null}
                <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent" required>
                  <option value="">Select category...</option>
                  {categories.map((c, i) => (
                    <option key={i} value={JSON.stringify(c)}>{c.name} ({c.type === 'addition' ? 'Addition' : 'Deduction'})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₹)</label>
                <input type="number" min="1" step="0.01" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent" placeholder="e.g. 500" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description (Optional)</label>
                <input type="text" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent" placeholder="e.g. June uniform purchase" />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50">
                  {submitting ? 'Adding...' : 'Add Transaction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* L2: Confirm Delete Modal */}
      {deleteId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center animate-slide-up">
            <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Transaction?</h3>
            <p className="text-sm text-slate-500 mb-6">Are you sure you want to delete this ledger entry? This action cannot be undone.</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200">Cancel</button>
              <button onClick={() => handleDelete(deleteId)} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
