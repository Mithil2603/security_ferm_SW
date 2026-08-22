import { useState, useEffect } from 'react';
import { FileText, CheckCircle, XCircle, Zap, Clock, Banknote, Search, CheckSquare, X, Eye } from 'lucide-react';
import api from '../services/api';
import Pagination from '../components/Pagination';
import TableSkeleton from '../components/TableSkeleton';
import { format } from 'date-fns';

const STATUS_STYLES = {
  draft: 'bg-gray-500/20 text-slate-500 border border-slate-300',
  pending: 'bg-amber-500/20 text-amber-600 border border-amber-500/30',
  approved: 'bg-blue-500/20 text-blue-600 border border-blue-500/30',
  paid: 'bg-emerald-500/20 text-emerald-600 border border-emerald-500/30',
  cancelled: 'bg-red-500/20 text-red-600 border border-red-500/30',
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
  
  const [generating, setGenerating] = useState(false);
  const [paying, setPaying] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [fetchError, setFetchError] = useState('');
  const [payForm, setPayForm] = useState({ 
    payment_method: 'bank_transfer', 
    transaction_reference: '',
    payment_date: new Date().toISOString().split('T')[0]
  });

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
      setFetchError('');
    } catch (err) {
      console.error('Failed to fetch salary slips', err);
      setFetchError('Failed to load payroll data. Check server connection.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSlips(); }, [page, filterMonth, filterStatus]);

  // ─── Actions ─────────────────────────────────────────────────────────────────

  const handleBatchGenerate = async () => {
    if (!window.confirm(`Generate all missing salary slips for ${filterMonth}?`)) return;
    setGenerating(true);
    try {
      const res = await api.post('/salary-slips/batch-generate', { payroll_month: filterMonth });
      alert(`Generated: ${res.data.generated}\nSkipped (exists): ${res.data.skipped}\nErrors: ${res.data.errors}`);
      fetchSlips();
    } catch (err) {
      alert(err.message || 'Failed to generate');
    } finally {
      setGenerating(false);
    }
  };

  const handleBulkApprove = async () => {
    if (!summary || summary.pending_count === 0) {
      alert('No pending salary slips to approve for this month.');
      return;
    }
    if (!window.confirm(`Approve ALL ${summary.pending_count} pending salary slips for ${filterMonth}?`)) return;
    try {
      const res = await api.post('/salary-slips/bulk-approve', { payroll_month: filterMonth });
      alert(`Approved ${res.data.approved} slips.`);
      fetchSlips();
    } catch (err) {
      alert(err.message || 'Failed to approve');
    }
  };

  const handleAction = async (id, action) => {
    if (processingId === id) return;
    setProcessingId(id);
    try {
      await api.post(`/salary-slips/${id}/${action}`);
      fetchSlips();
      if (isViewOpen && selectedSlip?.id === id) {
        const res = await api.get(`/salary-slips/${id}`);
        setSelectedSlip(res.data);
      }
    } catch (err) {
      alert(err.message || `Failed to ${action}`);
    } finally {
      setProcessingId(null);
    }
  };

  const handlePay = async (e) => {
    e.preventDefault();
    setPaying(true);
    try {
      await api.post(`/salary-slips/${selectedSlip.id}/pay`, payForm);
      setIsPayOpen(false);
      fetchSlips();
      if (isViewOpen) {
        const res = await api.get(`/salary-slips/${selectedSlip.id}`);
        setSelectedSlip(res.data);
      }
    } catch (err) {
      alert(err.message || 'Failed to mark as paid');
    } finally {
      setPaying(false);
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
      payment_date: new Date().toISOString().split('T')[0]
    });
    setIsPayOpen(true);
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-teal-600" /> Payroll Processing
          </h1>
          <p className="text-slate-500 mt-1">Manage payroll generation, approvals, and payouts</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleBulkApprove} className="flex items-center gap-2 bg-emerald-600/20 text-emerald-600 hover:bg-emerald-600/30 px-4 py-2 rounded-lg transition-colors border border-emerald-500/20">
            <CheckSquare className="w-4 h-4" /> Bulk Approve
          </button>
          <button onClick={handleBatchGenerate} disabled={generating} className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white text-slate-900 px-4 py-2 rounded-lg transition-colors">
            <Zap className="w-4 h-4" /> {generating ? 'Generating...' : 'Batch Generate'}
          </button>
        </div>
      </div>

      {/* Filters & Stats */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white shadow-sm p-4 rounded-xl border border-slate-200">
        <div className="flex gap-3">
          <input type="month" value={filterMonth} onChange={e => { setFilterMonth(e.target.value); setPage(1); }}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm" />
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm">
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="pending">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {summary && (
          <div className="flex gap-6 text-sm">
            <div className="text-center">
              <div className="text-slate-500 text-xs">Total Net Payout</div>
              <div className="font-bold text-slate-900">₹{Number(summary.sum_net || 0).toLocaleString('en-IN')}</div>
            </div>
            <div className="flex gap-3">
              <div className="bg-amber-500/10 text-amber-600 px-3 py-1 rounded-lg border border-amber-500/20">
                <span className="font-bold">{summary.pending_count || 0}</span> Pending
              </div>
              <div className="bg-blue-500/10 text-blue-600 px-3 py-1 rounded-lg border border-blue-500/20">
                <span className="font-bold">{summary.approved_count || 0}</span> Approved
              </div>
              <div className="bg-emerald-500/10 text-emerald-600 px-3 py-1 rounded-lg border border-emerald-500/20">
                <span className="font-bold">{summary.paid_count || 0}</span> Paid
              </div>
            </div>
          </div>
        )}
      </div>

      {fetchError && (
        <div className="p-4 bg-red-50 text-red-600 rounded-lg text-sm flex justify-between shadow-sm border border-red-100">
          <div className="flex items-center gap-2"><span>⚠️</span> {fetchError}</div>
          <button onClick={fetchSlips} className="underline hover:text-red-700 font-medium">Retry</button>
        </div>
      )}

      {/* Table */}
      {loading ? <TableSkeleton /> : (
        <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="text-left p-4 font-medium">Employee</th>
                  <th className="text-center p-4 font-medium">Structure</th>
                  <th className="text-center p-4 font-medium">Days</th>
                  <th className="text-right p-4 font-medium">Gross</th>
                  <th className="text-right p-4 font-medium">Deductions</th>
                  <th className="text-right p-4 font-medium">Net Pay</th>
                  <th className="text-center p-4 font-medium">Status</th>
                  <th className="text-right p-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {slips.length === 0 ? (
                  <tr><td colSpan="8" className="p-8 text-center text-slate-400">No salary slips found for {filterMonth}.</td></tr>
                ) : slips.map(s => (
                  <tr key={s.id} className="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                    <td className="p-4">
                      <div className="font-medium text-slate-900">{s.employee_name}</div>
                      <div className="text-xs text-slate-400">{s.designation} • {s.emp_code}</div>
                    </td>
                    <td className="p-4 text-center text-slate-500 text-xs">{s.structure_name || 'Legacy'}</td>
                    <td className="p-4 text-center">
                      <span className="text-slate-900">{s.days_worked}</span>
                      <span className="text-slate-400 text-xs">/{s.days_in_month}</span>
                    </td>
                    <td className="p-4 text-right text-slate-700">₹{Number(s.total_earnings).toLocaleString('en-IN')}</td>
                    <td className="p-4 text-right text-red-600/80">₹{Number(s.total_deductions).toLocaleString('en-IN')}</td>
                    <td className="p-4 text-right font-bold text-emerald-600">₹{Number(s.net_salary).toLocaleString('en-IN')}</td>
                    <td className="p-4 text-center">
                      <span className={`px-2.5 py-1 rounded text-xs font-medium capitalize ${STATUS_STYLES[s.status]}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openView(s.id)} title="View Detail" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"><Eye className="w-4 h-4" /></button>
                        
                        {s.status === 'draft' && (
                          <button onClick={() => handleAction(s.id, 'submit')} title="Submit for Approval" className="p-1.5 rounded-lg hover:bg-amber-500/20 text-amber-600"><Clock className="w-4 h-4" /></button>
                        )}
                        {s.status === 'pending' && (
                          <button onClick={() => handleAction(s.id, 'approve')} title="Approve" className="p-1.5 rounded-lg hover:bg-blue-500/20 text-blue-600"><CheckCircle className="w-4 h-4" /></button>
                        )}
                        {s.status === 'approved' && (
                          <button onClick={() => openPay(s)} title="Mark Paid" className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-emerald-600"><Banknote className="w-4 h-4" /></button>
                        )}
                        {(s.status === 'draft' || s.status === 'pending') && (
                          <button onClick={() => handleAction(s.id, 'cancel')} title="Cancel" className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-600"><XCircle className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination && (
            <Pagination pagination={pagination} onPageChange={(n) => setPage(n)} />
          )}
        </div>
      )}

      {/* ─── View Modal ────────────────────────────────────────────────────────── */}
      {isViewOpen && selectedSlip && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-0 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white/80">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <FileText className="w-5 h-5 text-teal-600" /> Salary Slip - {selectedSlip.payroll_month}
              </h2>
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${STATUS_STYLES[selectedSlip.status]}`}>
                  {selectedSlip.status}
                </span>
                <button onClick={() => setIsViewOpen(false)} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-6">
              {/* Employee Info Box */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-400 text-xs mb-1">Employee</p>
                  <p className="text-slate-900 font-medium">{selectedSlip.employee_name}</p>
                  <p className="text-slate-500 text-xs">{selectedSlip.designation} ({selectedSlip.emp_code})</p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs mb-1">Attendance</p>
                  <p className="text-slate-900 font-medium">{selectedSlip.days_worked} <span className="text-slate-400 text-xs font-normal">/ {selectedSlip.days_in_month} days</span></p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs mb-1">Bank Details</p>
                  <p className="text-slate-900">{selectedSlip.bank_name || 'N/A'}</p>
                  <p className="text-slate-500 text-xs">
                    {selectedSlip.bank_account_number
                      ? `A/c: ${'X'.repeat(Math.max(0, selectedSlip.bank_account_number.length - 4))}${selectedSlip.bank_account_number.slice(-4)}`
                      : ''}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 text-xs mb-1">Tax / Legal</p>
                  <p className="text-slate-900 text-xs">PAN: {selectedSlip.pan_number || 'N/A'}</p>
                  <p className="text-slate-500 text-xs">Aadhar: {selectedSlip.aadhar_number || 'N/A'}</p>
                </div>
              </div>

              {/* Earnings & Deductions Split */}
              <div className="grid grid-cols-2 gap-6">
                {/* Earnings */}
                <div>
                  <h3 className="text-sm font-bold text-slate-700 mb-3 border-b border-slate-200 pb-2">Earnings</h3>
                  <div className="space-y-2">
                    {selectedSlip.earnings?.map(e => (
                      <div key={e.id} className="flex justify-between text-sm">
                        <span className="text-slate-500">{e.component_name}</span>
                        <span className="text-slate-900 font-medium">₹{Number(e.amount).toLocaleString('en-IN')}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-sm font-bold text-slate-900 mt-4 pt-3 border-t border-slate-200">
                    <span>Gross Salary</span>
                    <span>₹{Number(selectedSlip.total_earnings).toLocaleString('en-IN')}</span>
                  </div>
                </div>

                {/* Deductions */}
                <div>
                  <h3 className="text-sm font-bold text-slate-700 mb-3 border-b border-slate-200 pb-2">Deductions</h3>
                  <div className="space-y-2">
                    {selectedSlip.deductions?.length === 0 ? (
                      <div className="text-slate-400 text-sm italic">No deductions</div>
                    ) : selectedSlip.deductions?.map(d => (
                      <div key={d.id} className="flex justify-between text-sm">
                        <span className="text-slate-500">{d.component_name}</span>
                        <span className="text-red-600">₹{Number(d.amount).toLocaleString('en-IN')}</span>
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
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex justify-between items-center">
                <span className="text-emerald-600 font-medium">Net Payable</span>
                <span className="text-2xl font-bold text-emerald-600">₹{Number(selectedSlip.net_salary).toLocaleString('en-IN')}</span>
              </div>
            </div>

            {/* Modal Actions Footer */}
            <div className="p-4 border-t border-slate-200 bg-white/80 flex justify-end gap-3">
              {selectedSlip.status === 'draft' && (
                <button onClick={() => handleAction(selectedSlip.id, 'submit')} disabled={processingId === selectedSlip.id} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">Submit for Approval</button>
              )}
              {selectedSlip.status === 'pending' && (
                <button onClick={() => handleAction(selectedSlip.id, 'approve')} disabled={processingId === selectedSlip.id} className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">Approve</button>
              )}
              {selectedSlip.status === 'approved' && (
                <button onClick={() => openPay(selectedSlip)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm transition-colors">Mark as Paid</button>
              )}
              <button onClick={() => setIsViewOpen(false)} className="bg-slate-100 hover:bg-slate-200 text-slate-900 px-4 py-2 rounded-lg text-sm transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Pay Modal ─────────────────────────────────────────────────────────── */}
      {isPayOpen && selectedSlip && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-4"><Banknote className="w-5 h-5 text-emerald-600" /> Mark as Paid</h2>
            <div className="mb-4 p-3 bg-slate-50 rounded-lg text-sm">
              <div className="text-slate-500">Paying <span className="text-slate-900 font-medium">{selectedSlip.employee_name}</span></div>
              <div className="text-teal-600 font-bold text-xl mt-1">₹{Number(selectedSlip.net_salary).toLocaleString('en-IN')}</div>
            </div>
            <form onSubmit={handlePay} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-500 mb-1">Payment Method</label>
                <select value={payForm.payment_method} onChange={e => setPayForm({...payForm, payment_method: e.target.value})} className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900">
                  <option value="bank_transfer">Bank Transfer (NEFT/RTGS)</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="cash">Cash</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-500 mb-1">Payment Date</label>
                <input type="date" value={payForm.payment_date} onChange={e => setPayForm({...payForm, payment_date: e.target.value})} className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900" />
              </div>
              <div>
                <label className="block text-sm text-slate-500 mb-1">Transaction Ref (optional)</label>
                <input type="text" value={payForm.transaction_reference} onChange={e => setPayForm({...payForm, transaction_reference: e.target.value})} className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900" placeholder="UTR / Cheque No." />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsPayOpen(false)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-900 py-2 rounded-lg">Cancel</button>
                <button type="submit" disabled={paying} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg disabled:opacity-50">{paying ? 'Processing...' : 'Confirm Pay'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
