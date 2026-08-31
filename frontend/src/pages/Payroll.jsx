import { useState, useEffect } from 'react';
import { FileText, CheckCircle, XCircle, Zap, Clock, Banknote, Plus, CheckSquare, X, Eye, Calendar, User } from 'lucide-react';
import api from '../services/api';
import Pagination from '../components/Pagination';
import TableSkeleton from '../components/TableSkeleton';
import { format } from 'date-fns';

const STATUS_STYLES = {
  draft: 'bg-slate-100 text-slate-700 border border-slate-300',
  pending: 'bg-amber-50 text-amber-700 border border-amber-300',
  approved: 'bg-blue-50 text-blue-700 border border-blue-300',
  paid: 'bg-emerald-50 text-emerald-700 border border-emerald-300',
  cancelled: 'bg-red-50 text-red-700 border border-red-300',
};

export default function Payroll() {
  const [slips, setSlips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [filterMonth, setFilterMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [filterStatus, setFilterStatus] = useState('');
  
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isPayOpen, setIsPayOpen] = useState(false);
  const [selectedSlip, setSelectedSlip] = useState(null);
  const [employees, setEmployees] = useState([]);
  
  const [generating, setGenerating] = useState(false);
  const [singleGenForm, setSingleGenForm] = useState({
    employee_id: '',
    payroll_month: format(new Date(), 'yyyy-MM'),
    days_worked: ''
  });

  const [payForm, setPayForm] = useState({
    payment_method: 'bank_transfer',
    transaction_reference: '',
    payment_date: format(new Date(), 'yyyy-MM-dd')
  });

  const fetchEmployees = async () => {
    try {
      const res = await api.get('/employees?limit=300');
      const all = res.data || [];
      setEmployees(all.filter(e => e.is_active));
    } catch (err) {
      console.error('Failed to fetch employees', err);
    }
  };

  const fetchSlips = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page, limit: 20 });
      if (filterMonth) params.append('payroll_month', filterMonth);
      if (filterStatus) params.append('status', filterStatus);
      
      const res = await api.get(`/salary-slips?${params}`);
      setSlips(res.data || []);
      if (res.summary) setSummary(res.summary);
      if (res.pagination) setPagination(res.pagination);
    } catch (err) {
      console.error('Failed to fetch salary slips', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSlips();
    fetchEmployees();
  }, [page, filterMonth, filterStatus]);

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const handleBatchGenerate = async () => {
    if (!window.confirm(`Generate all missing salary slips for ${filterMonth}?`)) return;
    setGenerating(true);
    try {
      const res = await api.post('/salary-slips/batch-generate', { payroll_month: filterMonth });
      alert(`Generated: ${res.data.generated}\nSkipped (exists): ${res.data.skipped}\nErrors: ${res.data.errors}`);
      fetchSlips();
    } catch (err) {
      alert(err.response?.data?.message || err.message || 'Failed to generate');
    } finally {
      setGenerating(false);
    }
  };

  const handleSingleGenerate = async (e) => {
    e.preventDefault();
    if (!singleGenForm.employee_id) {
      alert('Please select an employee');
      return;
    }
    setGenerating(true);
    try {
      await api.post('/salary-slips/generate', {
        employee_id: parseInt(singleGenForm.employee_id),
        payroll_month: singleGenForm.payroll_month,
        days_worked: singleGenForm.days_worked ? parseInt(singleGenForm.days_worked) : undefined
      });
      setIsGenerateOpen(false);
      fetchSlips();
      alert('Salary slip generated successfully!');
    } catch (err) {
      alert(err.response?.data?.message || err.message || 'Failed to generate salary slip');
    } finally {
      setGenerating(false);
    }
  };

  const handleBulkApprove = async () => {
    if (!window.confirm(`Approve ALL pending salary slips for ${filterMonth}?`)) return;
    try {
      const res = await api.post('/salary-slips/bulk-approve', { payroll_month: filterMonth });
      alert(`Approved ${res.data.approved} slips.`);
      fetchSlips();
    } catch (err) {
      alert(err.response?.data?.message || err.message || 'Failed to approve');
    }
  };

  const handleAction = async (id, action) => {
    try {
      await api.post(`/salary-slips/${id}/${action}`);
      fetchSlips();
      if (isViewOpen && selectedSlip?.id === id) {
        const res = await api.get(`/salary-slips/${id}`);
        setSelectedSlip(res.data);
      }
    } catch (err) {
      alert(err.response?.data?.message || err.message || `Failed to ${action}`);
    }
  };

  const handlePay = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/salary-slips/${selectedSlip.id}/pay`, payForm);
      setIsPayOpen(false);
      fetchSlips();
      if (isViewOpen) {
        const res = await api.get(`/salary-slips/${selectedSlip.id}`);
        setSelectedSlip(res.data);
      }
      alert('Salary slip marked as paid successfully!');
    } catch (err) {
      alert(err.response?.data?.message || err.message || 'Failed to mark as paid');
    }
  };

  const openView = async (id) => {
    try {
      const res = await api.get(`/salary-slips/${id}`);
      setSelectedSlip(res.data);
      setIsViewOpen(true);
    } catch (err) {
      alert('Failed to load slip details');
    }
  };

  const openPay = (slip) => {
    setSelectedSlip(slip);
    setPayForm({
      payment_method: 'bank_transfer',
      transaction_reference: '',
      payment_date: format(new Date(), 'yyyy-MM-dd')
    });
    setIsPayOpen(true);
  };

  const inputCls = "w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all";

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-teal-600" /> Payroll Processing
          </h1>
          <p className="text-slate-500 text-sm mt-1">Manage employee salary slips, approvals, and payouts</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button 
            type="button"
            onClick={() => {
              fetchEmployees();
              setSingleGenForm({
                employee_id: '',
                payroll_month: filterMonth,
                days_worked: ''
              });
              setIsGenerateOpen(true);
            }} 
            className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-medium px-3.5 py-2 rounded-lg border border-slate-300 text-sm transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4 text-teal-600" /> Generate Slip
          </button>
          <button 
            type="button"
            onClick={handleBulkApprove} 
            className="flex items-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-medium px-3.5 py-2 rounded-lg border border-emerald-200 text-sm transition-colors"
          >
            <CheckSquare className="w-4 h-4 text-emerald-600" /> Bulk Approve
          </button>
          <button 
            type="button"
            onClick={handleBatchGenerate} 
            disabled={generating} 
            className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm transition-colors"
          >
            <Zap className="w-4 h-4" /> {generating ? 'Generating...' : 'Batch Generate All'}
          </button>
        </div>
      </div>

      {/* Filters & Stats */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between bg-white shadow-sm p-4 rounded-xl border border-slate-200">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Month:</span>
            <input 
              type="month" 
              value={filterMonth} 
              onChange={e => { setFilterMonth(e.target.value); setPage(1); }}
              className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800 text-sm font-semibold focus:ring-2 focus:ring-teal-500 focus:border-transparent" 
            />
            <button
              type="button"
              onClick={() => { setFilterMonth(format(new Date(), 'yyyy-MM')); setPage(1); }}
              className="text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 px-2.5 py-1.5 rounded-lg transition-colors border border-teal-200"
            >
              This Month
            </button>
            <button
              type="button"
              onClick={() => {
                const d = new Date();
                d.setMonth(d.getMonth() - 1);
                setFilterMonth(format(d, 'yyyy-MM'));
                setPage(1);
              }}
              className="text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg transition-colors border border-slate-200"
            >
              Last Month
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Status:</span>
            <select 
              value={filterStatus} 
              onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
              className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-800 text-sm font-semibold focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            >
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="pending">Pending Approval</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {summary && (
          <div className="flex flex-wrap items-center gap-4 text-sm w-full md:w-auto justify-between md:justify-end pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
            <div className="text-left md:text-right">
              <div className="text-slate-400 text-xs font-medium">Total Net Payout</div>
              <div className="font-extrabold text-slate-900 text-base">₹{Number(summary.sum_net || 0).toLocaleString('en-IN')}</div>
            </div>
            <div className="flex gap-2">
              <div className="bg-amber-50 text-amber-700 px-2.5 py-1 rounded-lg border border-amber-200 text-xs">
                <span className="font-bold">{summary.pending_count || 0}</span> Pending
              </div>
              <div className="bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg border border-blue-200 text-xs">
                <span className="font-bold">{summary.approved_count || 0}</span> Approved
              </div>
              <div className="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg border border-emerald-200 text-xs">
                <span className="font-bold">{summary.paid_count || 0}</span> Paid
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? <TableSkeleton /> : (
        <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 text-xs uppercase tracking-wider">
                  <th className="text-left p-4 font-semibold">Employee</th>
                  <th className="text-center p-4 font-semibold">Structure</th>
                  <th className="text-center p-4 font-semibold">Days</th>
                  <th className="text-right p-4 font-semibold">Gross</th>
                  <th className="text-right p-4 font-semibold">Deductions</th>
                  <th className="text-right p-4 font-semibold">Net Pay</th>
                  <th className="text-center p-4 font-semibold">Status</th>
                  <th className="text-right p-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {slips.length === 0 ? (
                  <tr><td colSpan="8" className="p-8 text-center text-slate-400">No salary slips found for {filterMonth}.</td></tr>
                ) : slips.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4">
                      <div className="font-semibold text-slate-900">{s.employee_name}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{s.designation || 'Staff'} • {s.emp_code}</div>
                    </td>
                    <td className="p-4 text-center text-slate-500 text-xs">{s.structure_name || 'Standard'}</td>
                    <td className="p-4 text-center">
                      <span className="font-bold text-slate-800">{s.days_worked}</span>
                      <span className="text-slate-400 text-xs">/{s.days_in_month}</span>
                    </td>
                    <td className="p-4 text-right text-slate-700 font-medium">₹{Number(s.total_earnings).toLocaleString('en-IN')}</td>
                    <td className="p-4 text-right text-red-600 font-medium">₹{Number(s.total_deductions).toLocaleString('en-IN')}</td>
                    <td className="p-4 text-right font-bold text-emerald-600">₹{Number(s.net_salary).toLocaleString('en-IN')}</td>
                    <td className="p-4 text-center">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize border ${STATUS_STYLES[s.status]}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => openView(s.id)} title="View Slip" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"><Eye className="w-4 h-4" /></button>
                        
                        {s.status === 'draft' && (
                          <button onClick={() => handleAction(s.id, 'submit')} title="Submit for Approval" className="p-1.5 rounded-lg hover:bg-amber-100 text-amber-700 transition-colors"><Clock className="w-4 h-4" /></button>
                        )}
                        {s.status === 'pending' && (
                          <button onClick={() => handleAction(s.id, 'approve')} title="Approve" className="p-1.5 rounded-lg hover:bg-blue-100 text-blue-700 transition-colors"><CheckCircle className="w-4 h-4" /></button>
                        )}
                        {s.status !== 'paid' && s.status !== 'cancelled' && (
                          <button onClick={() => openPay(s)} title="Mark as Paid" className="p-1.5 rounded-lg hover:bg-emerald-100 text-emerald-700 transition-colors"><Banknote className="w-4 h-4" /></button>
                        )}
                        {(s.status === 'draft' || s.status === 'pending') && (
                          <button onClick={() => handleAction(s.id, 'cancel')} title="Cancel" className="p-1.5 rounded-lg hover:bg-red-100 text-red-700 transition-colors"><XCircle className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination && pagination.total > 20 && (
            <Pagination pagination={pagination} page={page} setPage={setPage} />
          )}
        </div>
      )}

      {/* ─── Generate Single Slip Modal ────────────────────────────────────────── */}
      {isGenerateOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-up border border-slate-100">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Plus className="w-5 h-5 text-teal-600" /> Generate Salary Slip
              </h2>
              <button onClick={() => setIsGenerateOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSingleGenerate} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Employee *
                </label>
                <select 
                  required
                  value={singleGenForm.employee_id} 
                  onChange={e => setSingleGenForm(prev => ({ ...prev, employee_id: e.target.value }))}
                  className={inputCls}
                >
                  <option value="">-- Select Employee --</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name} ({emp.employee_id} • {emp.designation || 'Guard'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Payroll Month *
                </label>
                <input 
                  type="month" 
                  required 
                  value={singleGenForm.payroll_month} 
                  onChange={e => setSingleGenForm(prev => ({ ...prev, payroll_month: e.target.value }))}
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Days Worked (Leave empty for auto-calculate from Attendance)
                </label>
                <input 
                  type="number" 
                  min="0" 
                  max="31" 
                  placeholder="Auto-derived if empty"
                  value={singleGenForm.days_worked} 
                  onChange={e => setSingleGenForm(prev => ({ ...prev, days_worked: e.target.value }))}
                  className={inputCls}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsGenerateOpen(false)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 rounded-lg text-sm transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={generating} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-2.5 rounded-lg text-sm shadow-md transition-colors disabled:opacity-50">
                  {generating ? 'Generating...' : 'Generate Slip'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── View Modal ────────────────────────────────────────────────────────── */}
      {isViewOpen && selectedSlip && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-slide-up border border-slate-100">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <FileText className="w-5 h-5 text-teal-600" /> Salary Slip - {selectedSlip.payroll_month}
              </h2>
              <div className="flex items-center gap-3">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize border ${STATUS_STYLES[selectedSlip.status]}`}>
                  {selectedSlip.status}
                </span>
                <button onClick={() => setIsViewOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-6">
              {/* Employee Info Box */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-400 text-xs mb-0.5 font-medium uppercase tracking-wider">Employee</p>
                  <p className="text-slate-900 font-bold">{selectedSlip.employee_name}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{selectedSlip.designation || 'Staff'} ({selectedSlip.emp_code})</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs mb-0.5 font-medium uppercase tracking-wider">Attendance</p>
                  <p className="text-slate-900 font-bold">{selectedSlip.days_worked} <span className="text-slate-400 text-xs font-normal">/ {selectedSlip.days_in_month} days</span></p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs mb-0.5 font-medium uppercase tracking-wider">Bank Details</p>
                  <p className="text-slate-900 font-medium">{selectedSlip.bank_name || 'Bank'}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{selectedSlip.bank_account_number ? `A/c: ${selectedSlip.bank_account_number}` : 'N/A'}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs mb-0.5 font-medium uppercase tracking-wider">Tax / KYC</p>
                  <p className="text-slate-900 text-xs font-medium">PAN: {selectedSlip.pan_number || 'N/A'}</p>
                  <p className="text-slate-500 text-xs mt-0.5">Aadhar: {selectedSlip.aadhar_number || 'N/A'}</p>
                </div>
              </div>

              {/* Earnings & Deductions Split */}
              <div className="grid grid-cols-2 gap-6">
                {/* Earnings */}
                <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-200">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3 border-b border-slate-200 pb-2">Earnings</h3>
                  <div className="space-y-2">
                    {selectedSlip.earnings?.map(e => (
                      <div key={e.id} className="flex justify-between text-sm">
                        <span className="text-slate-600">{e.component_name}</span>
                        <span className="text-slate-900 font-semibold">₹{Number(e.amount).toLocaleString('en-IN')}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-sm font-bold text-slate-900 mt-4 pt-3 border-t border-slate-200">
                    <span>Gross Salary</span>
                    <span>₹{Number(selectedSlip.total_earnings).toLocaleString('en-IN')}</span>
                  </div>
                </div>

                {/* Deductions */}
                <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-200">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3 border-b border-slate-200 pb-2">Deductions</h3>
                  <div className="space-y-2">
                    {selectedSlip.deductions?.length === 0 ? (
                      <div className="text-slate-400 text-sm italic">No deductions</div>
                    ) : selectedSlip.deductions?.map(d => (
                      <div key={d.id} className="flex justify-between text-sm">
                        <span className="text-slate-600">{d.component_name}</span>
                        <span className="text-red-600 font-semibold">₹{Number(d.amount).toLocaleString('en-IN')}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-sm font-bold text-red-600 mt-4 pt-3 border-t border-slate-200">
                    <span>Total Deductions</span>
                    <span>₹{Number(selectedSlip.total_deductions).toLocaleString('en-IN')}</span>
                  </div>
                </div>
              </div>

              {/* Net Pay Highlight */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex justify-between items-center">
                <span className="text-emerald-800 font-bold">Net Payable Salary</span>
                <span className="text-2xl font-extrabold text-emerald-700">₹{Number(selectedSlip.net_salary).toLocaleString('en-IN')}</span>
              </div>
            </div>

            {/* Modal Actions Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2.5">
              {selectedSlip.status === 'draft' && (
                <button onClick={() => handleAction(selectedSlip.id, 'submit')} className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors">Submit for Approval</button>
              )}
              {selectedSlip.status === 'pending' && (
                <button onClick={() => handleAction(selectedSlip.id, 'approve')} className="bg-teal-600 hover:bg-teal-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors">Approve</button>
              )}
              {selectedSlip.status !== 'paid' && selectedSlip.status !== 'cancelled' && (
                <button onClick={() => openPay(selectedSlip)} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors">Mark as Paid</button>
              )}
              <button onClick={() => setIsViewOpen(false)} className="bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-medium px-4 py-2 rounded-lg text-sm transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Pay Modal ─────────────────────────────────────────────────────────── */}
      {isPayOpen && selectedSlip && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md animate-slide-up border border-slate-100">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Banknote className="w-5 h-5 text-emerald-600" /> Mark Salary as Paid
              </h2>
              <button onClick={() => setIsPayOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4 p-4 bg-emerald-50/60 rounded-xl border border-emerald-100 text-sm">
              <div className="text-slate-600">
                Employee: <span className="text-slate-900 font-bold">{selectedSlip.employee_name}</span> ({selectedSlip.emp_code})
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Month: {selectedSlip.payroll_month} • Worked: {selectedSlip.days_worked}/{selectedSlip.days_in_month} days
              </div>
              <div className="text-emerald-700 font-extrabold text-2xl mt-2">
                ₹{Number(selectedSlip.net_salary).toLocaleString('en-IN')}
              </div>
            </div>

            <form onSubmit={handlePay} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Payment Date *
                </label>
                <input
                  type="date"
                  required
                  value={payForm.payment_date || format(new Date(), 'yyyy-MM-dd')}
                  onChange={e => setPayForm(prev => ({ ...prev, payment_date: e.target.value }))}
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Payment Method *
                </label>
                <select
                  value={payForm.payment_method}
                  onChange={e => setPayForm(prev => ({ ...prev, payment_method: e.target.value }))}
                  className={inputCls}
                >
                  <option value="bank_transfer">Bank Transfer (NEFT/RTGS/IMPS)</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="cash">Cash</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Transaction / Cheque Reference (Optional)
                </label>
                <input
                  type="text"
                  value={payForm.transaction_reference || ''}
                  onChange={e => setPayForm(prev => ({ ...prev, transaction_reference: e.target.value }))}
                  className={inputCls}
                  placeholder="e.g. UTR12345678 or Cheque #000123"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsPayOpen(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-lg text-sm shadow-md transition-colors"
                >
                  Confirm Pay
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
