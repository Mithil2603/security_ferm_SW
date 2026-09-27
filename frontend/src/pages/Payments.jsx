import { useState, useEffect, useCallback } from 'react';
import { CreditCard, Users, Truck, UserSquare2, Landmark, Plus, Paperclip, X, ExternalLink, Download, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { toast } from '../context/ToastContext';
import { getServerBaseUrl, getApiBaseUrl } from '../utils/apiUrl';
import Pagination from '../components/Pagination';

const TABS = [
  { key: 'client', label: 'Client Receipts', icon: Users, transactionType: 'client_receipt', partyType: 'client' },
  { key: 'vendor', label: 'Vendor Payments', icon: Truck, transactionType: 'vendor_payment', partyType: 'vendor' },
  { key: 'employee', label: 'Salary Payments', icon: UserSquare2, transactionType: 'salary_payment', partyType: 'employee' },
];

// Register filter is independent of the "Record Payment" tab above it — any
// combination (all 3, just one, or 2 of 3) can be viewed on screen and
// downloaded as the exact same PDF.
const REGISTER_TYPES = [
  { value: 'client_receipt', label: 'Client Receipts', direction: 'credit' },
  { value: 'vendor_payment', label: 'Vendor Payments', direction: 'debit' },
  { value: 'salary_payment', label: 'Salary Payments', direction: 'debit' },
];

const emptyForm = {
  party_id: '', bill_id: '', amount: '', tds_amount: '',
  payment_method: 'bank_transfer', bank_account_id: '', transaction_reference: '', notes: '',
  tax_type: 'none', tax_rate: '', is_rcm_applicable: false,
  employee_bank_choice: 'current',
};

// Bank Entries — charges, interest, other adjustments, and inter-account
// transfers, not tied to any client/vendor/employee bill.
const BANK_ENTRY_KINDS = [
  { value: 'bank_charge', label: 'Bank Charges (debit)' },
  { value: 'interest_credited', label: 'Interest Credited' },
  { value: 'other_debit', label: 'Other Charge / Debit' },
  { value: 'other_credit', label: 'Other Credit' },
  { value: 'transfer', label: 'Transfer Between Accounts (bank↔bank, cash↔bank)' },
];

const emptyBankForm = {
  kind: 'bank_charge', bank_account_id: '', to_account_id: '',
  amount: '', entry_date: '', narration: '', transaction_ref: '',
};

export default function Payments() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('client');
  const tab = TABS.find(t => t.key === activeTab);

  const [clients, setClients] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [openBills, setOpenBills] = useState([]);
  const [register, setRegister] = useState([]);
  const [loadingRegister, setLoadingRegister] = useState(false);
  const [registerTypes, setRegisterTypes] = useState(REGISTER_TYPES.map(t => t.value));
  const [registerDates, setRegisterDates] = useState({ from: '', to: '' });
  const [registerSearch, setRegisterSearch] = useState('');
  const [debouncedRegisterSearch, setDebouncedRegisterSearch] = useState('');
  const [registerPage, setRegisterPage] = useState(1);
  const [registerPagination, setRegisterPagination] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [attachment, setAttachment] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [bankForm, setBankForm] = useState(emptyBankForm);
  const [bankEntries, setBankEntries] = useState([]);
  const [loadingBankEntries, setLoadingBankEntries] = useState(false);
  const [submittingBank, setSubmittingBank] = useState(false);

  const partyList = activeTab === 'client' ? clients : activeTab === 'vendor' ? vendors : employees;
  const selectedBill = openBills.find(b => String(b.id) === String(form.bill_id));
  const selectedEmployee = activeTab === 'employee' ? employees.find(e => String(e.id) === String(form.party_id)) : null;

  // Employee's bank accounts on file — current, plus one level of "previous"
  // if their bank details were ever updated, so a specific payment can still
  // be routed to the old account when needed (e.g. correcting a payment made
  // just before the switch).
  const employeeBankOptions = (() => {
    if (!selectedEmployee) return [];
    const options = [];
    if (selectedEmployee.bank_account_number) {
      options.push({
        value: 'current',
        label: `Current — ${selectedEmployee.bank_name || 'Bank'} • A/C ${selectedEmployee.bank_account_number} • IFSC ${selectedEmployee.bank_ifsc_code || 'N/A'}`,
        snapshot: `${selectedEmployee.bank_name || 'Bank'} - A/C ${selectedEmployee.bank_account_number} - IFSC ${selectedEmployee.bank_ifsc_code || 'N/A'} (${selectedEmployee.bank_account_holder_name || selectedEmployee.full_name})`
      });
    }
    if (selectedEmployee.previous_bank_account_number) {
      options.push({
        value: 'previous',
        label: `Previous — ${selectedEmployee.previous_bank_name || 'Bank'} • A/C ${selectedEmployee.previous_bank_account_number} • IFSC ${selectedEmployee.previous_bank_ifsc_code || 'N/A'}`,
        snapshot: `${selectedEmployee.previous_bank_name || 'Bank'} - A/C ${selectedEmployee.previous_bank_account_number} - IFSC ${selectedEmployee.previous_bank_ifsc_code || 'N/A'} (${selectedEmployee.previous_bank_account_holder_name || selectedEmployee.full_name}) [PREVIOUS ACCOUNT]`
      });
    }
    return options;
  })();

  useEffect(() => {
    Promise.all([
      api.get('/clients?limit=200').catch(() => ({ data: [] })),
      api.get('/vendors').catch(() => ({ data: [] })),
      // reveal=true: this screen needs the real bank account number to
      // actually route a salary transfer, not the masked "XXXXX1234" default.
      api.get('/employees?limit=300&reveal=true').catch(() => ({ data: [] })),
      api.get('/bank-accounts?active_only=true').catch(() => ({ data: [] })),
    ]).then(([c, v, e, b]) => {
      setClients((c.data || []).filter(x => x.is_active !== false));
      setVendors(v.data || []);
      setEmployees((e.data || []).filter(x => x.is_active !== false));
      setBankAccounts(b.data || []);
    });
  }, []);

  const buildRegisterParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('types', (registerTypes.length > 0 ? registerTypes : REGISTER_TYPES.map(t => t.value)).join(','));
    if (registerDates.from) params.set('from_date', registerDates.from);
    if (registerDates.to) params.set('to_date', registerDates.to);
    if (debouncedRegisterSearch) params.set('search', debouncedRegisterSearch);
    return params;
  }, [registerTypes, registerDates, debouncedRegisterSearch]);

  const fetchRegister = useCallback(async () => {
    setLoadingRegister(true);
    try {
      const params = buildRegisterParams();
      params.set('page', registerPage);
      params.set('limit', '20');
      const res = await api.get(`/payments?${params.toString()}`);
      setRegister(res.data || []);
      if (res.pagination) setRegisterPagination(res.pagination);
    } catch (err) {
      console.error('Failed to load payments register', err);
      setRegister([]);
    } finally {
      setLoadingRegister(false);
    }
  }, [buildRegisterParams, registerPage]);

  useEffect(() => { fetchRegister(); }, [fetchRegister]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedRegisterSearch(registerSearch), 300);
    return () => clearTimeout(timer);
  }, [registerSearch]);

  useEffect(() => { setRegisterPage(1); }, [debouncedRegisterSearch, registerTypes, registerDates]);

  const toggleRegisterType = (value) => {
    setRegisterTypes(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  };

  const handleDownloadRegisterPdf = () => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const params = buildRegisterParams();
    if (token) params.set('token', token);
    window.open(`${getApiBaseUrl()}/payments/register/pdf?${params.toString()}`, '_blank');
  };

  const directionFor = (transactionType) => REGISTER_TYPES.find(t => t.value === transactionType)?.direction || 'debit';

  const resetForm = () => {
    setForm(emptyForm);
    setAttachment(null);
    setOpenBills([]);
  };

  const switchTab = (key) => {
    setActiveTab(key);
    setShowForm(false);
    resetForm();
    if (key === 'bank') fetchBankEntries();
  };

  const fetchBankEntries = async () => {
    setLoadingBankEntries(true);
    try {
      const res = await api.get('/payments/bank-entries?limit=100');
      setBankEntries(res.data || []);
    } catch (err) {
      console.error('Failed to load bank entries', err);
    } finally {
      setLoadingBankEntries(false);
    }
  };

  const handleBankFormSubmit = async (e) => {
    e.preventDefault();
    if (!bankForm.amount || parseFloat(bankForm.amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (bankForm.kind === 'transfer' && (!bankForm.bank_account_id || !bankForm.to_account_id)) {
      toast.error('Please select both a From and a To account');
      return;
    }
    if (bankForm.kind !== 'transfer' && !bankForm.bank_account_id) {
      toast.error('Please select a bank/cash account');
      return;
    }
    setSubmittingBank(true);
    try {
      await api.post('/payments/bank-entry', bankForm);
      toast.success('Bank entry recorded successfully');
      setBankForm(emptyBankForm);
      setShowForm(false);
      fetchBankEntries();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to record bank entry');
    } finally {
      setSubmittingBank(false);
    }
  };

  const handlePartyChange = async (partyId) => {
    setForm(f => ({ ...f, party_id: partyId, bill_id: '', amount: '', employee_bank_choice: 'current' }));
    setOpenBills([]);
    if (!partyId) return;
    try {
      const res = await api.get(`/payments/open-bills?party_type=${tab.partyType}&party_id=${partyId}`);
      setOpenBills(res.data || []);
    } catch (err) {
      console.error('Failed to load open bills', err);
    }
  };

  const billDueAmount = (bill) => (
    !bill ? null
    : activeTab === 'client' ? parseFloat(bill.payment_due)
    : activeTab === 'vendor' ? parseFloat(bill.balance_due)
    : parseFloat(bill.amount)
  );

  // If the bill was created with a known TDS rate, derive TDS from it instead
  // of asking the user to work it out — computed once as a ratio to Amount so
  // it stays correct (and locked/read-only) even if Amount is later reduced
  // for a partial payment.
  const selectedBillTdsRate = selectedBill ? parseFloat(selectedBill.tds_rate) || 0 : 0;
  const isTdsLocked = selectedBillTdsRate > 0;
  const tdsRatio = (() => {
    if (!isTdsLocked) return 0;
    const due = billDueAmount(selectedBill);
    const billTaxRate = parseFloat(selectedBill.tax_rate) || 0;
    const taxableOfDue = billTaxRate > 0 ? due / (1 + billTaxRate / 100) : due;
    const tdsAtFullDue = taxableOfDue * (selectedBillTdsRate / 100);
    const netAtFullDue = due - tdsAtFullDue;
    return netAtFullDue > 0 ? tdsAtFullDue / netAtFullDue : 0;
  })();
  const computedTds = isTdsLocked ? Math.round((parseFloat(form.amount) || 0) * tdsRatio * 100) / 100 : null;
  const effectiveTdsValue = isTdsLocked ? computedTds : form.tds_amount;

  const handleBillChange = (billId) => {
    const bill = openBills.find(b => String(b.id) === String(billId));
    const due = billDueAmount(bill);
    const billTdsRate = bill ? parseFloat(bill.tds_rate) || 0 : 0;
    let amount = due !== null ? due : null;
    if (due !== null && billTdsRate > 0) {
      const billTaxRate = parseFloat(bill.tax_rate) || 0;
      const taxableOfDue = billTaxRate > 0 ? due / (1 + billTaxRate / 100) : due;
      amount = due - taxableOfDue * (billTdsRate / 100);
    }
    setForm(f => ({
      ...f,
      bill_id: billId,
      amount: amount !== null ? String(Math.round(amount * 100) / 100) : f.amount,
      tds_amount: '',
    }));
  };

  // TDS is real money withheld, not physically received — so when a specific
  // bill is selected (and it has no known TDS rate of its own), typing a TDS
  // value here reduces Amount to match, keeping Amount + TDS equal to what's
  // actually due instead of silently overshooting it (the exact trap that
  // produced "Amount + TDS exceeds remaining balance").
  const handleTdsChange = (value) => {
    if (isTdsLocked) return; // locked fields don't take manual input
    const bill = openBills.find(b => String(b.id) === String(form.bill_id));
    const due = billDueAmount(bill);
    if (due === null) {
      setForm(f => ({ ...f, tds_amount: value }));
      return;
    }
    const tds = parseFloat(value) || 0;
    const adjustedAmount = Math.max(0, due - tds);
    setForm(f => ({ ...f, tds_amount: value, amount: String(adjustedAmount) }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.party_id || !form.amount || parseFloat(form.amount) <= 0) {
      toast.error('Please select a party and enter a valid amount');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('transaction_type', tab.transactionType);
      fd.append('amount', form.amount);
      fd.append('payment_method', form.payment_method);
      fd.append('bank_account_id', form.bank_account_id);
      fd.append('transaction_reference', form.transaction_reference);
      fd.append('notes', form.notes);
      if (attachment) fd.append('attachment', attachment);

      if (activeTab === 'client') {
        fd.append('invoice_id', form.bill_id);
        fd.append('tds_deducted', effectiveTdsValue || 0);
      } else if (activeTab === 'vendor') {
        fd.append('expense_id', form.bill_id);
        fd.append('tds_amount', effectiveTdsValue || 0);
        if (!(selectedBill && selectedBill.tax_type && selectedBill.tax_type !== 'none')) {
          fd.append('tax_type', form.tax_type);
          fd.append('tax_rate', form.tax_rate || 0);
          fd.append('is_rcm_applicable', form.is_rcm_applicable);
        }
      } else {
        fd.append('employee_id', form.party_id);
        if (form.bill_id) {
          const src = selectedBill?.source || 'payroll';
          fd.append('reference_type', src);
          fd.append('reference_id', form.bill_id);
        }
        const bankOpt = employeeBankOptions.find(o => o.value === form.employee_bank_choice);
        if (bankOpt) fd.append('employee_bank_snapshot', bankOpt.snapshot);
      }

      await api.post('/payments', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Payment recorded successfully');
      setShowForm(false);
      resetForm();
      fetchRegister();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to record payment');
    } finally {
      setSubmitting(false);
    }
  };

  const billHasTax = activeTab === 'vendor' && selectedBill && selectedBill.tax_type && selectedBill.tax_type !== 'none';

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <CreditCard className="w-8 h-8 text-teal-600 p-1.5 bg-teal-100 rounded-lg" />
            Bank & Payments
          </h1>
          <p className="text-slate-500 mt-1">Record money received from clients, paid to vendors, disbursed as salary, and general bank activity — charges, interest, and transfers.</p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-medium shadow-sm transition-colors"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancel' : activeTab === 'bank' ? 'Record Bank Entry' : 'Record Payment'}
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-200 p-2 gap-2 bg-slate-50/50 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={`px-4 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === t.key ? 'bg-white text-teal-700 shadow-sm border border-slate-200/60' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/80'
              }`}
            >
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
          <button
            onClick={() => switchTab('bank')}
            className={`px-4 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'bank' ? 'bg-white text-teal-700 shadow-sm border border-slate-200/60' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100/80'
            }`}
          >
            <Landmark className="w-4 h-4" /> Bank Entries
          </button>
        </div>

        {showForm && activeTab === 'bank' && (
          <form onSubmit={handleBankFormSubmit} className="p-6 border-b border-slate-200 bg-slate-50/50 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Entry Type *</label>
                <select
                  required
                  value={bankForm.kind}
                  onChange={e => setBankForm(f => ({ ...f, kind: e.target.value, to_account_id: '' }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                >
                  {BANK_ENTRY_KINDS.map(k => (
                    <option key={k.value} value={k.value}>{k.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={bankForm.entry_date}
                  onChange={e => setBankForm(f => ({ ...f, entry_date: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {bankForm.kind === 'transfer' ? 'From Account *' : 'Bank / Cash Account *'}
                </label>
                <select
                  required
                  value={bankForm.bank_account_id}
                  onChange={e => setBankForm(f => ({ ...f, bank_account_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">-- Select Account --</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>{b.account_name} ({b.account_type})</option>
                  ))}
                </select>
              </div>
              {bankForm.kind === 'transfer' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">To Account *</label>
                  <select
                    required
                    value={bankForm.to_account_id}
                    onChange={e => setBankForm(f => ({ ...f, to_account_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">-- Select Account --</option>
                    {bankAccounts.filter(b => String(b.id) !== String(bankForm.bank_account_id)).map(b => (
                      <option key={b.id} value={b.id}>{b.account_name} ({b.account_type})</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Amount (₹) *</label>
                <input
                  type="number" required min="0.01" step="0.01"
                  value={bankForm.amount}
                  onChange={e => setBankForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Reference No.</label>
                <input
                  type="text"
                  value={bankForm.transaction_ref}
                  onChange={e => setBankForm(f => ({ ...f, transaction_ref: e.target.value }))}
                  placeholder="Cheque / UTR / statement ref"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Narration</label>
              <input
                type="text"
                value={bankForm.narration}
                onChange={e => setBankForm(f => ({ ...f, narration: e.target.value }))}
                placeholder="e.g. Monthly account maintenance charge"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={submittingBank} className="px-5 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-sm disabled:opacity-50">
                {submittingBank ? 'Recording...' : 'Record Bank Entry'}
              </button>
            </div>
          </form>
        )}

        {showForm && activeTab !== 'bank' && (
          <form onSubmit={handleSubmit} className="p-6 border-b border-slate-200 bg-slate-50/50 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {activeTab === 'client' ? 'Client' : activeTab === 'vendor' ? 'Vendor' : 'Employee'} *
                </label>
                <select
                  required
                  value={form.party_id}
                  onChange={e => handlePartyChange(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">-- Select --</option>
                  {partyList.map(p => (
                    <option key={p.id} value={p.id}>{p.name || p.full_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {activeTab === 'client' ? 'Close Out Invoice *' : activeTab === 'vendor' ? 'Close Out Bill *' : 'Pending Salary (optional)'}
                </label>
                <select
                  required={activeTab !== 'employee'}
                  value={form.bill_id}
                  onChange={e => handleBillChange(e.target.value)}
                  disabled={!form.party_id}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
                >
                  {activeTab === 'employee' ? (
                    <option value="">-- Pay directly (no payroll run) --</option>
                  ) : (
                    <option value="" disabled>-- Select bill --</option>
                  )}
                  {openBills.length === 0 && form.party_id && activeTab !== 'employee' && (
                    <option value="" disabled>No open {activeTab === 'client' ? 'invoices' : 'bills'} for this {activeTab}</option>
                  )}
                  {openBills.map(b => (
                    <option key={b.id} value={b.id}>
                      {activeTab === 'client' && `${b.invoice_number} — Due ₹${parseFloat(b.payment_due).toLocaleString()}`}
                      {activeTab === 'vendor' && `${b.description} — Due ₹${parseFloat(b.balance_due).toLocaleString()}`}
                      {activeTab === 'employee' && `${b.period} — ₹${parseFloat(b.amount).toLocaleString()} (${b.source === 'salary_slip' ? 'Slip' : 'Payroll'})`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {activeTab === 'employee' && selectedEmployee && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Employee's Bank Account (destination) *</label>
                {employeeBankOptions.length === 0 ? (
                  <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                    No bank account on file for {selectedEmployee.full_name} — add one on their Employee profile before paying by bank transfer.
                  </p>
                ) : (
                  <>
                    <select
                      required
                      value={form.employee_bank_choice}
                      onChange={e => setForm(f => ({ ...f, employee_bank_choice: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                    >
                      {employeeBankOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-400 mt-1">Fetched from {selectedEmployee.full_name}'s employee record — includes their previous account if it was ever updated.</p>
                  </>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Amount (₹) *</label>
                <input
                  type="number" required min="0.01" step="0.01"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                />
              </div>
              {activeTab !== 'employee' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">TDS Deducted (₹)</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={isTdsLocked ? effectiveTdsValue : form.tds_amount}
                    onChange={e => handleTdsChange(e.target.value)}
                    disabled={isTdsLocked}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                  {isTdsLocked ? (
                    <p className="text-xs text-slate-400 mt-1">Auto-calculated from this bill's TDS rate ({selectedBillTdsRate}%) — locked.</p>
                  ) : form.bill_id && (
                    <p className="text-xs text-slate-400 mt-1">Amount is auto-adjusted so Amount + TDS matches what's due.</p>
                  )}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Payment Method *</label>
                <select
                  value={form.payment_method}
                  onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                >
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                </select>
              </div>
            </div>

            {activeTab === 'client' && selectedBill && selectedBill.tax_type && selectedBill.tax_type !== 'none' && (
              <div className="p-3 bg-white rounded-lg border border-slate-200">
                <p className="text-xs text-slate-600">
                  GST auto-derived from the selected invoice: <strong>{selectedBill.tax_type}</strong> @ {selectedBill.tax_rate}%
                  (CGST ₹{selectedBill.cgst_amount}, SGST ₹{selectedBill.sgst_amount}, IGST ₹{selectedBill.igst_amount})
                  {selectedBill.is_rcm_applicable ? ', RCM applicable' : ''}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  This is fixed by the invoice and settles proportionally with each payment — it's not editable here. It will show up in the GST Bifurcation (Clients) report under Tax Reports.
                </p>
              </div>
            )}

            {activeTab === 'vendor' && (
              <div className="p-3 bg-white rounded-lg border border-slate-200">
                {billHasTax ? (
                  <p className="text-xs text-slate-600">
                    GST auto-derived from the selected bill: <strong>{selectedBill.tax_type}</strong> @ {selectedBill.tax_rate}%
                    (CGST ₹{selectedBill.cgst_amount}, SGST ₹{selectedBill.sgst_amount}, IGST ₹{selectedBill.igst_amount})
                    {selectedBill.is_rcm_applicable ? ', RCM applicable' : ''}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Tax Type</label>
                      <select
                        value={form.tax_type}
                        onChange={e => setForm(f => ({ ...f, tax_type: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                      >
                        <option value="none">None</option>
                        <option value="cgst_sgst">CGST + SGST</option>
                        <option value="igst">IGST</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">GST Rate (%)</label>
                      <input
                        type="number" min="0" max="28" step="0.1"
                        value={form.tax_rate}
                        onChange={e => setForm(f => ({ ...f, tax_rate: e.target.value }))}
                        disabled={form.tax_type === 'none'}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
                      />
                    </div>
                    <label className="flex items-center gap-2 mt-5">
                      <input
                        type="checkbox"
                        checked={form.is_rcm_applicable}
                        onChange={e => setForm(f => ({ ...f, is_rcm_applicable: e.target.checked }))}
                      />
                      <span className="text-xs font-medium text-slate-700">RCM Applicable</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Bank / Cash Account *</label>
                <select
                  required
                  value={form.bank_account_id}
                  onChange={e => setForm(f => ({ ...f, bank_account_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">-- Select Account --</option>
                  {bankAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.account_name} ({a.account_type})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Reference No.</label>
                <input
                  type="text"
                  value={form.transaction_reference}
                  onChange={e => setForm(f => ({ ...f, transaction_reference: e.target.value }))}
                  placeholder="Cheque / UTR / UPI ref"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Attachment (receipt / proof)</label>
                <label className="flex items-center gap-2 cursor-pointer bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  <Paperclip className="w-4 h-4" />
                  {attachment ? attachment.name : 'Choose file'}
                  <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => setAttachment(e.target.files[0])} />
                </label>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-medium shadow-sm disabled:opacity-50"
              >
                {submitting ? 'Recording...' : 'Record Payment'}
              </button>
            </div>
          </form>
        )}

        {/* Register filter — independent of the Record Payment tab above:
            any combination of the 3 types, on screen and in the PDF. */}
        {activeTab !== 'bank' && (
        <>
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-xs font-bold text-slate-500 uppercase">Show:</span>
            {REGISTER_TYPES.map(t => (
              <label key={t.value} className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={registerTypes.includes(t.value)}
                  onChange={() => toggleRegisterType(t.value)}
                />
                {t.label}
              </label>
            ))}
            <input
              type="date"
              value={registerDates.from}
              onChange={e => setRegisterDates(d => ({ ...d, from: e.target.value }))}
              className="px-2 py-1 border border-slate-300 rounded-md text-xs"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              value={registerDates.to}
              onChange={e => setRegisterDates(d => ({ ...d, to: e.target.value }))}
              className="px-2 py-1 border border-slate-300 rounded-md text-xs"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleDownloadRegisterPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg shadow-sm"
            >
              <Download className="w-3.5 h-3.5" /> Download PDF
            </button>
            <button
              onClick={() => navigate(`/${activeTab === 'employee' ? 'ledger' : activeTab === 'client' ? 'party-ledger' : 'vendor-ledger'}`)}
              className="text-xs text-teal-700 hover:text-teal-800 font-medium flex items-center gap-1"
            >
              View full ledger <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="p-4 border-b border-slate-200">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by party name, reference, or invoice/bill number..."
              value={registerSearch}
              onChange={e => setRegisterSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all text-sm"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Party</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Reference</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Debit</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Credit</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">GST</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">TDS</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Method</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Account</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Employee Bank</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase">Attachment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingRegister ? (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
              ) : register.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-slate-500">No payments match this filter</td></tr>
              ) : register.map(row => {
                const isCredit = directionFor(row.transaction_type) === 'credit';
                const typeLabel = REGISTER_TYPES.find(t => t.value === row.transaction_type)?.label || row.transaction_type;
                return (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{row.payment_date}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{typeLabel}</td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-800">{row.party_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{row.invoice_number || row.expense_description || row.transaction_reference || '—'}</td>
                    <td className="px-4 py-3 text-sm font-bold text-rose-700 text-right">{isCredit ? '' : `₹${parseFloat(row.amount).toLocaleString()}`}</td>
                    <td className="px-4 py-3 text-sm font-bold text-teal-700 text-right">{isCredit ? `₹${parseFloat(row.amount).toLocaleString()}` : ''}</td>
                    <td className="px-4 py-3 text-sm text-amber-700 text-right">{parseFloat(row.total_gst_amount) > 0 ? `₹${parseFloat(row.total_gst_amount).toLocaleString()}` : '—'}</td>
                    <td className="px-4 py-3 text-sm text-indigo-700 text-right">{parseFloat(row.tds_amount) > 0 ? `₹${parseFloat(row.tds_amount).toLocaleString()}` : '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500 capitalize">{row.payment_method?.replace('_', ' ')}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{row.bank_account_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500 max-w-[220px]">{row.employee_bank_snapshot || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      {row.attachment_url ? (
                        <a href={`${getServerBaseUrl()}${row.attachment_url}`} target="_blank" rel="noreferrer" className="text-teal-600 hover:text-teal-800">
                          <Paperclip className="w-4 h-4 inline" />
                        </a>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {register.length > 0 && (
              <tfoot className="bg-slate-50 font-bold border-t-2 border-slate-300">
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-sm text-right text-slate-700">TOTAL</td>
                  <td className="px-4 py-3 text-sm text-rose-700 text-right">
                    ₹{register.filter(r => directionFor(r.transaction_type) === 'debit').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-teal-700 text-right">
                    ₹{register.filter(r => directionFor(r.transaction_type) === 'credit').reduce((s, r) => s + (parseFloat(r.amount) || 0), 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-amber-700 text-right">
                    ₹{register.reduce((s, r) => s + (parseFloat(r.total_gst_amount) || 0), 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-indigo-700 text-right">
                    ₹{register.reduce((s, r) => s + (parseFloat(r.tds_amount) || 0), 0).toLocaleString()}
                  </td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-200">
          <Pagination pagination={registerPagination} onPageChange={setRegisterPage} />
        </div>
        </>
        )}

        {activeTab === 'bank' && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Voucher No.</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Debit A/C</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Credit A/C</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Narration</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingBankEntries ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
                ) : bankEntries.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No bank entries recorded yet</td></tr>
                ) : bankEntries.map(v => (
                  <tr key={v.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{v.voucher_date}</td>
                    <td className="px-4 py-3 text-sm text-slate-500 font-mono">{v.voucher_number}</td>
                    <td className="px-4 py-3 text-sm text-slate-500 capitalize">{v.voucher_type === 'contra' ? 'Transfer' : 'Journal'}</td>
                    <td className="px-4 py-3 text-sm text-rose-700">{v.debit_account_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-teal-700">{v.credit_account_name || '—'}</td>
                    <td className="px-4 py-3 text-sm font-bold text-slate-800 text-right">₹{parseFloat(v.amount).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{v.narration || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{v.transaction_ref || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
