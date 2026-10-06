import { useState, useEffect, useCallback, useRef } from 'react';
import { CreditCard, Users, Truck, UserSquare2, Landmark, Plus, Paperclip, X, ExternalLink, Download, Search, Trash2, Edit2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { toast, confirmDialog } from '../context/ToastContext';
import { getServerBaseUrl, getApiBaseUrl } from '../utils/apiUrl';
import Pagination from '../components/Pagination';
import TaxRateSelect from '../components/TaxRateSelect';

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
  { value: 'bank_entry', label: 'Bank Entries', direction: 'both' },
];

// Local calendar date (YYYY-MM-DD) — toISOString() is UTC and would show
// yesterday's date before 5:30 AM IST.
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Salary is usually paid in arrears, so default to last month.
const lastMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const salaryMonthLabel = (month) => {
  const [y, m] = String(month || '').split('-').map(Number);
  if (!y || !m) return '';
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
};

const freshForm = () => ({ ...emptyForm, payment_date: todayLocal(), salary_month: lastMonth() });

const emptyForm = {
  party_id: '', bill_id: '', amount: '', tds_amount: '', payment_date: '', salary_month: '',
  payment_method: 'bank_transfer', bank_account_id: '', transaction_reference: '', notes: '',
  tax_type: 'none', tax_rate: '', is_rcm_applicable: false,
  employee_bank_choice: 'current',
  round_off_enabled: false,
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

const BANK_ENTRY_TYPES = [
  { value: 'journal', label: 'Charges / Interest / Adjustments' },
  { value: 'contra', label: 'Transfers' },
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
  // Transaction Edit Modal state
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [editForm, setEditForm] = useState({
    amount: '',
    tds_amount: '',
    payment_date: '',
    payment_method: 'bank_transfer',
    bank_account_id: '',
    transaction_reference: '',
    notes: '',
    employee_bank_snapshot: '',
    salary_month: '',
    round_off: '',
  });
  const [editAttachment, setEditAttachment] = useState(null);
  const [submittingEdit, setSubmittingEdit] = useState(false);

  // Bank Entry Edit Modal state
  const [editingBankEntry, setEditingBankEntry] = useState(null);
  const [editBankForm, setEditBankForm] = useState(emptyBankForm);
  const [submittingEditBank, setSubmittingEditBank] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(freshForm);
  const [attachment, setAttachment] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [bankForm, setBankForm] = useState(() => ({ ...emptyBankForm, entry_date: todayLocal() }));
  const [bankEntries, setBankEntries] = useState([]);
  const [loadingBankEntries, setLoadingBankEntries] = useState(false);
  const [bankPage, setBankPage] = useState(1);
  const [bankPagination, setBankPagination] = useState(null);
  const [bankTypes, setBankTypes] = useState(BANK_ENTRY_TYPES.map(t => t.value));
  const [bankDates, setBankDates] = useState({ from: '', to: '' });
  const [bankAccountFilter, setBankAccountFilter] = useState('');
  const [bankSearch, setBankSearch] = useState('');
  const [debouncedBankSearch, setDebouncedBankSearch] = useState('');
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


  // Transaction Delete Handler (matches Purchase Bill UX with confirmDialog danger variant)
  const handleDeleteTransaction = async (row) => {
    const typeLabels = {
      client_receipt: 'Client Receipt',
      vendor_payment: 'Vendor Payment',
      salary_payment: 'Salary Payment',
    };
    const label = typeLabels[row.transaction_type] || 'Payment';
    const ref = row.invoice_number || row.expense_description || row.transaction_reference || 'this transaction';
    const confirmed = await confirmDialog({
      title: `Delete ${label}`,
      message: `Are you sure you want to permanently delete this ${label} of ₹${parseFloat(row.amount).toLocaleString()} for ${row.party_name || 'party'} (${ref})? This will reverse the ledger and payment status. This cannot be undone.`,
      confirmText: 'Delete Permanently',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await api.delete(`/payments/${row.id}`);
      toast.success(`${label} deleted successfully`);
      fetchRegister();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || `Failed to delete ${label}`);
    }
  };

  // Transaction Edit Handlers
  const handleStartEditTransaction = (row) => {
    setEditingTransaction(row);
    setEditForm({
      amount: String(row.amount || ''),
      tds_amount: String(row.tds_amount || ''),
      payment_date: row.payment_date || '',
      payment_method: row.payment_method || 'bank_transfer',
      bank_account_id: row.bank_account_id ? String(row.bank_account_id) : '',
      transaction_reference: row.transaction_reference || '',
      notes: row.notes || '',
      employee_bank_snapshot: row.employee_bank_snapshot || '',
      salary_month: row.salary_month || '',
      round_off: parseFloat(row.round_off) ? String(row.round_off) : '',
    });
    setEditAttachment(null);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editForm.amount || parseFloat(editForm.amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    setSubmittingEdit(true);
    try {
      const fd = new FormData();
      fd.append('amount', editForm.amount);
      fd.append('payment_date', editForm.payment_date);
      fd.append('payment_method', editForm.payment_method);
      fd.append('bank_account_id', editForm.bank_account_id);
      fd.append('transaction_reference', editForm.transaction_reference);
      fd.append('notes', editForm.notes);
      if (editingTransaction.transaction_type === 'client_receipt') {
        fd.append('tds_deducted', editForm.tds_amount || 0);
        fd.append('round_off', editForm.round_off || 0);
      } else if (editingTransaction.transaction_type === 'vendor_payment') {
        fd.append('tds_amount', editForm.tds_amount || 0);
        fd.append('round_off', editForm.round_off || 0);
      } else if (editingTransaction.transaction_type === 'salary_payment') {
        fd.append('employee_bank_snapshot', editForm.employee_bank_snapshot || '');
        if (!editingTransaction.reference_id) fd.append('salary_month', editForm.salary_month || '');
      }
      if (editAttachment) {
        fd.append('attachment', editAttachment);
      }

      await api.put(`/payments/${editingTransaction.id}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const label = editingTransaction.transaction_type === 'client_receipt'
        ? 'Client receipt'
        : editingTransaction.transaction_type === 'vendor_payment'
        ? 'Vendor payment'
        : 'Salary payment';
      toast.success(`${label} updated successfully`);
      setEditingTransaction(null);
      fetchRegister();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to update payment');
    } finally {
      setSubmittingEdit(false);
    }
  };

  // Bank Entry Handlers
  const handleStartEditBankEntry = (v) => {
    let kind = 'bank_charge';
    let bankAccountId = '';
    let toAccountId = '';
    if (v.voucher_type === 'contra') {
      kind = 'transfer';
      bankAccountId = v.credit_account_id ? String(v.credit_account_id) : '';
      toAccountId = v.debit_account_id ? String(v.debit_account_id) : '';
    } else {
      if (v.debit_account_id) {
        bankAccountId = String(v.debit_account_id);
        kind = (v.narration && v.narration.toLowerCase().includes('other')) ? 'other_debit' : 'bank_charge';
      } else if (v.credit_account_id) {
        bankAccountId = String(v.credit_account_id);
        kind = (v.narration && v.narration.toLowerCase().includes('interest')) ? 'interest_credited' : 'other_credit';
      }
    }
    setEditingBankEntry(v);
    setEditBankForm({
      kind,
      bank_account_id: bankAccountId,
      to_account_id: toAccountId,
      amount: String(v.amount || ''),
      entry_date: v.voucher_date || '',
      narration: v.narration || '',
      transaction_ref: v.transaction_ref || '',
    });
  };

  const handleEditBankSubmit = async (e) => {
    e.preventDefault();
    if (!editBankForm.amount || parseFloat(editBankForm.amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (editBankForm.kind === 'transfer' && (!editBankForm.bank_account_id || !editBankForm.to_account_id)) {
      toast.error('Please select both a From and a To account');
      return;
    }
    if (editBankForm.kind !== 'transfer' && !editBankForm.bank_account_id) {
      toast.error('Please select a bank/cash account');
      return;
    }
    setSubmittingEditBank(true);
    try {
      await api.put(`/payments/bank-entries/${editingBankEntry.id}`, editBankForm);
      toast.success(`Bank entry ${editingBankEntry.voucher_number} updated successfully`);
      setEditingBankEntry(null);
      fetchBankEntries();
      fetchRegister();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to update bank entry');
    } finally {
      setSubmittingEditBank(false);
    }
  };

  const handleDeleteBankEntry = async (v) => {
    const confirmed = await confirmDialog({
      title: 'Delete Bank Entry',
      message: `Are you sure you want to permanently delete bank entry ${v.voucher_number} of ₹${parseFloat(v.amount).toLocaleString()}? This will reverse the account balance adjustment. This cannot be undone.`,
      confirmText: 'Delete Permanently',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.delete(`/payments/bank-entries/${v.id}`);
      toast.success(`Bank entry ${v.voucher_number} deleted successfully`);
      fetchBankEntries();
      fetchRegister();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to delete bank entry');
    }
  };

  const resetForm = () => {
    setForm(freshForm());
    setAttachment(null);
    setOpenBills([]);
  };

  const switchTab = (key) => {
    setActiveTab(key);
    setShowForm(false);
    resetForm();
    setBankPage(1);
  };

  const fetchBankEntries = async () => {
    setLoadingBankEntries(true);
    try {
      const params = new URLSearchParams({ page: bankPage, limit: 20, types: bankTypes.join(',') });
      if (bankDates.from) params.set('from_date', bankDates.from);
      if (bankDates.to) params.set('to_date', bankDates.to);
      if (bankAccountFilter) params.set('bank_account_id', bankAccountFilter);
      if (debouncedBankSearch) params.set('search', debouncedBankSearch);
      const res = await api.get(`/payments/bank-entries?${params.toString()}`);
      const rows = res.data || [];
      // Deleting the last entry on a page leaves it empty — step back one page.
      if (rows.length === 0 && bankPage > 1) {
        setBankPage(p => p - 1);
        return;
      }
      setBankEntries(rows);
      setBankPagination(res.pagination || null);
    } catch (err) {
      console.error('Failed to load bank entries', err);
    } finally {
      setLoadingBankEntries(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'bank') fetchBankEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, bankPage, bankTypes, bankDates, bankAccountFilter, debouncedBankSearch]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedBankSearch(bankSearch), 300);
    return () => clearTimeout(timer);
  }, [bankSearch]);

  useEffect(() => { setBankPage(1); }, [bankTypes, bankDates, bankAccountFilter, debouncedBankSearch]);

  const toggleBankType = (value) => {
    setBankTypes(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
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
      setBankForm({ ...emptyBankForm, entry_date: todayLocal() });
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

  // Round off (client / vendor only): pay a rounded amount and write the small
  // difference off so the bill is fully settled — e.g. ₹11,227 due, ₹11,200 paid,
  // ₹27 round off. Positive = written off, negative = a little extra received.
  const canRoundOff = (activeTab === 'client' || activeTab === 'vendor') && !!selectedBill;
  const billDue = canRoundOff ? (billDueAmount(selectedBill) || 0) : 0;
  const roundOffValue = canRoundOff && form.round_off_enabled
    ? Math.round((billDue - (parseFloat(form.amount) || 0) - (parseFloat(effectiveTdsValue) || 0)) * 100) / 100
    : 0;
  const roundOffSuggestions = (() => {
    if (!canRoundOff) return [];
    const net = Math.round((billDue - (parseFloat(effectiveTdsValue) || 0)) * 100) / 100;
    if (net <= 0) return [];
    return [...new Set([
      Math.floor(net / 100) * 100,
      Math.floor(net / 10) * 10,
      Math.ceil(net / 10) * 10,
      Math.ceil(net / 100) * 100,
    ])].filter(v => v > 0 && v !== net).sort((a, b) => a - b);
  })();

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
      round_off_enabled: false,
      // A payroll run / salary slip already belongs to a month — lock to it.
      ...(activeTab === 'employee' && bill?.period ? { salary_month: String(bill.period).slice(0, 7) } : {}),
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
    if (!form.payment_date) {
      toast.error('Please select a payment date');
      return;
    }
    if (activeTab === 'employee' && !form.salary_month) {
      toast.error('Please select the month this salary is for');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('transaction_type', tab.transactionType);
      fd.append('amount', form.amount);
      fd.append('payment_date', form.payment_date);
      fd.append('payment_method', form.payment_method);
      fd.append('bank_account_id', form.bank_account_id);
      fd.append('transaction_reference', form.transaction_reference);
      fd.append('notes', form.notes);
      if (attachment) fd.append('attachment', attachment);

      if (activeTab === 'client') {
        fd.append('invoice_id', form.bill_id);
        fd.append('tds_deducted', effectiveTdsValue || 0);
        fd.append('round_off', roundOffValue);
      } else if (activeTab === 'vendor') {
        fd.append('expense_id', form.bill_id);
        fd.append('tds_amount', effectiveTdsValue || 0);
        fd.append('round_off', roundOffValue);
        if (!(selectedBill && selectedBill.tax_type && selectedBill.tax_type !== 'none')) {
          fd.append('tax_type', form.tax_type);
          fd.append('tax_rate', form.tax_rate || 0);
          fd.append('is_rcm_applicable', form.is_rcm_applicable);
        }
      } else {
        fd.append('employee_id', form.party_id);
        fd.append('salary_month', form.salary_month);
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
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-medium shadow-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          {activeTab === 'bank' ? 'Record Bank Entry' : 'Record Payment'}
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
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-200 overflow-hidden my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Record Bank Entry</h3>
                <p className="text-xs text-slate-500 mt-0.5">Bank charges, interest, other adjustments, or a transfer between accounts.</p>
              </div>
              <button type="button" onClick={() => setShowForm(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
          <form onSubmit={handleBankFormSubmit} className="p-6 space-y-4">
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
                <label className="block text-xs font-medium text-slate-700 mb-1">Date *</label>
                <input
                  type="date" required
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
                    <option key={b.id} value={b.id}>{b.account_name} ({b.bank_name || (b.account_type === 'cash' ? 'Cash' : b.account_type)})</option>
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
                      <option key={b.id} value={b.id}>{b.account_name} ({b.bank_name || (b.account_type === 'cash' ? 'Cash' : b.account_type)})</option>
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
          </div>
          </div>
        )}

        {showForm && activeTab !== 'bank' && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full border border-slate-200 overflow-hidden my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div>
                <h3 className="text-lg font-bold text-slate-800">{activeTab === 'client' ? 'Record Client Receipt' : activeTab === 'vendor' ? 'Record Vendor Payment' : 'Record Salary Payment'}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{activeTab === 'client' ? 'Money received from a client against an invoice.' : activeTab === 'vendor' ? 'Money paid to a vendor against a bill.' : 'Salary paid to an employee.'}</p>
              </div>
              <button type="button" onClick={() => setShowForm(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
          <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Payment Date *</label>
                <input
                  type="date" required
                  value={form.payment_date}
                  onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Amount (₹) *</label>
                <input
                  type="number" required min="0.01" step="0.01"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                />
              </div>
              {activeTab === 'employee' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Salary Month *</label>
                  <input
                    type="month" required
                    value={form.salary_month}
                    onChange={e => setForm(f => ({ ...f, salary_month: e.target.value }))}
                    disabled={!!form.bill_id}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                  {form.bill_id && <p className="text-xs text-slate-400 mt-1">Set by the selected salary run.</p>}
                </div>
              )}
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

            {canRoundOff && (
              <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-2 text-xs">
                <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.round_off_enabled}
                    onChange={e => setForm(f => ({ ...f, round_off_enabled: e.target.checked }))}
                  />
                  Round off &amp; settle this {activeTab === 'client' ? 'invoice' : 'bill'} in full
                  <span className="font-normal text-slate-500">(due ₹{billDue.toLocaleString('en-IN', { minimumFractionDigits: 2 })})</span>
                </label>
                {form.round_off_enabled && (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-slate-500">{activeTab === 'client' ? 'Amount received:' : 'Amount paid:'}</span>
                      {roundOffSuggestions.map(v => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, amount: String(v) }))}
                          className={`px-2 py-1 rounded border font-semibold transition-colors cursor-pointer ${parseFloat(form.amount) === v ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                        >
                          ₹{v.toLocaleString('en-IN')}
                        </button>
                      ))}
                      <span className="text-slate-400">or type it in Amount above</span>
                    </div>
                    <p className="text-slate-600">
                      Round off: <strong className="text-slate-800">{roundOffValue > 0 ? `-₹${roundOffValue.toFixed(2)} (written off)` : roundOffValue < 0 ? `+₹${Math.abs(roundOffValue).toFixed(2)} (extra received)` : '₹0.00'}</strong>
                      {' '}— the {activeTab === 'client' ? 'invoice' : 'bill'} will be marked fully paid. Only the actual amount goes to the bank.
                    </p>
                    {billDue > 0 && Math.abs(roundOffValue) > billDue * 0.01 && (
                      <p className="text-amber-700">Round off is more than 1% of the amount due — double-check the amount.</p>
                    )}
                  </>
                )}
              </div>
            )}

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
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">Tax / % Rate</label>
                      <TaxRateSelect
                        taxType={form.tax_type}
                        taxRate={form.tax_rate}
                        onChange={({ tax_type, tax_rate }) => setForm(f => ({ ...f, tax_type, tax_rate }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
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
                    <option key={a.id} value={a.id}>{a.account_name} ({a.bank_name || (a.account_type === 'cash' ? 'Cash' : a.account_type)})</option>
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

            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancel</button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-medium shadow-sm disabled:opacity-50"
              >
                {submitting ? 'Recording...' : 'Record Payment'}
              </button>
            </div>
          </form>
          </div>
          </div>
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
                <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingRegister ? (
                <tr><td colSpan={13} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
              ) : register.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-8 text-center text-slate-500">No payments match this filter</td></tr>
              ) : register.map(row => {
                const isBankEntry = row.transaction_type === 'bank_entry';
                const debitAmt = parseFloat(row.debit_amount) || 0;
                const creditAmt = parseFloat(row.credit_amount) || 0;
                const typeLabel = isBankEntry
                  ? (row.voucher_type === 'contra' ? 'Bank Transfer' : 'Bank Entry')
                  : (REGISTER_TYPES.find(t => t.value === row.transaction_type)?.label || row.transaction_type);
                return (
                  <tr key={row.row_key || row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{row.payment_date}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{typeLabel}</td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-800">{row.party_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{row.invoice_number || row.expense_description || (row.salary_month && `Salary — ${salaryMonthLabel(row.salary_month)}`) || row.transaction_reference || '—'}
                      {parseFloat(row.round_off) ? <span className="block text-[11px] text-slate-400">Round off ₹{parseFloat(row.round_off).toFixed(2)}</span> : null}</td>
                    <td className="px-4 py-3 text-sm font-bold text-rose-700 text-right">{debitAmt > 0 ? `₹${debitAmt.toLocaleString()}` : ''}</td>
                    <td className="px-4 py-3 text-sm font-bold text-teal-700 text-right">{creditAmt > 0 ? `₹${creditAmt.toLocaleString()}` : ''}</td>
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
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => isBankEntry ? handleStartEditBankEntry(row) : handleStartEditTransaction(row)}
                          title={isBankEntry ? 'Edit bank entry' : 'Edit payment'}
                          className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => isBankEntry ? handleDeleteBankEntry(row) : handleDeleteTransaction(row)}
                          title={isBankEntry ? 'Delete bank entry' : 'Delete payment'}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
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
                    ₹{register.reduce((s, r) => s + (parseFloat(r.debit_amount) || 0), 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-teal-700 text-right">
                    ₹{register.reduce((s, r) => s + (parseFloat(r.credit_amount) || 0), 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-amber-700 text-right">
                    ₹{register.reduce((s, r) => s + (parseFloat(r.total_gst_amount) || 0), 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-indigo-700 text-right">
                    ₹{register.reduce((s, r) => s + (parseFloat(r.tds_amount) || 0), 0).toLocaleString()}
                  </td>
                  <td colSpan={5}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-200">
          <Pagination pagination={registerPagination} onPageChange={setRegisterPage} alwaysShow />
        </div>
        </>
        )}

        {activeTab === 'bank' && (
          <>
          <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-wrap items-center gap-4">
            <span className="text-xs font-bold text-slate-500 uppercase">Show:</span>
            {BANK_ENTRY_TYPES.map(t => (
              <label key={t.value} className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bankTypes.includes(t.value)}
                  onChange={() => toggleBankType(t.value)}
                />
                {t.label}
              </label>
            ))}
            <input
              type="date"
              value={bankDates.from}
              onChange={e => setBankDates(d => ({ ...d, from: e.target.value }))}
              className="px-2 py-1 border border-slate-300 rounded-md text-xs"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              value={bankDates.to}
              onChange={e => setBankDates(d => ({ ...d, to: e.target.value }))}
              className="px-2 py-1 border border-slate-300 rounded-md text-xs"
            />
            <select
              value={bankAccountFilter}
              onChange={e => setBankAccountFilter(e.target.value)}
              className="px-2 py-1 border border-slate-300 rounded-md text-xs bg-white"
            >
              <option value="">All accounts</option>
              {bankAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.account_name}</option>
              ))}
            </select>
          </div>

          <div className="p-4 border-b border-slate-200">
            <div className="relative max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by voucher no., narration, reference, or account..."
                value={bankSearch}
                onChange={e => setBankSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all text-sm"
              />
            </div>
          </div>

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
                  <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingBankEntries ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
                ) : bankEntries.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">No bank entries found</td></tr>
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
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleStartEditBankEntry(v)}
                          title="Edit bank entry"
                          className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteBankEntry(v)}
                          title="Delete bank entry"
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-slate-200">
            <Pagination pagination={bankPagination} onPageChange={setBankPage} alwaysShow />
          </div>
          </>
        )}
      </div>

      {/* Edit Transaction Modal (Client Receipt, Vendor Payment, Salary Payment) */}
      {editingTransaction && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div>
                <h3 className="text-lg font-bold text-slate-800">
                  Edit {editingTransaction.transaction_type === 'client_receipt' ? 'Client Receipt' : editingTransaction.transaction_type === 'vendor_payment' ? 'Vendor Payment' : 'Salary Payment'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Party: <span className="font-semibold text-slate-700">{editingTransaction.party_name || '—'}</span>
                  {(editingTransaction.invoice_number || editingTransaction.expense_description) && (
                    <> • Ref: <span className="font-semibold text-slate-700">{editingTransaction.invoice_number || editingTransaction.expense_description}</span></>
                  )}
                </p>
              </div>
              <button
                onClick={() => setEditingTransaction(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-4">
              {editingTransaction.transaction_type === 'salary_payment' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Salary Month *</label>
                  <input
                    type="month"
                    required={!editingTransaction.reference_id}
                    value={editForm.salary_month}
                    onChange={e => setEditForm(f => ({ ...f, salary_month: e.target.value }))}
                    disabled={!!editingTransaction.reference_id}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                  {editingTransaction.reference_id && <p className="text-xs text-slate-400 mt-1">Set by the linked salary run.</p>}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Payment Date *</label>
                  <input
                    type="date"
                    required
                    value={editForm.payment_date}
                    onChange={e => setEditForm(f => ({ ...f, payment_date: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Payment Method *</label>
                  <select
                    value={editForm.payment_method}
                    onChange={e => setEditForm(f => ({ ...f, payment_method: e.target.value }))}
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={editForm.amount}
                    onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                {editingTransaction.transaction_type !== 'salary_payment' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">TDS Amount (₹)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editForm.tds_amount}
                      onChange={e => setEditForm(f => ({ ...f, tds_amount: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                )}
                {editingTransaction.transaction_type !== 'salary_payment' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Round Off (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editForm.round_off}
                      onChange={e => setEditForm(f => ({ ...f, round_off: e.target.value }))}
                      placeholder="0"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">Written off to settle the bill (− if extra was received).</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Bank / Cash Account *</label>
                  <select
                    required
                    value={editForm.bank_account_id}
                    onChange={e => setEditForm(f => ({ ...f, bank_account_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">-- Select Account --</option>
                    {bankAccounts.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.account_name} ({a.bank_name || (a.account_type === 'cash' ? 'Cash' : a.account_type)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Reference No.</label>
                  <input
                    type="text"
                    value={editForm.transaction_reference}
                    onChange={e => setEditForm(f => ({ ...f, transaction_reference: e.target.value }))}
                    placeholder="Cheque / UTR / UPI ref"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              {editingTransaction.transaction_type === 'salary_payment' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Employee Bank Details Snapshot</label>
                  <input
                    type="text"
                    value={editForm.employee_bank_snapshot}
                    onChange={e => setEditForm(f => ({ ...f, employee_bank_snapshot: e.target.value }))}
                    placeholder="Bank Name, A/C number, IFSC code"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={editForm.notes}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Add payment notes..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Attachment</label>
                {editingTransaction.attachment_url && !editAttachment && (
                  <div className="flex items-center justify-between p-2 mb-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                    <span className="text-slate-600 truncate">Current receipt file attached</span>
                    <a
                      href={`${getServerBaseUrl()}${editingTransaction.attachment_url}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-teal-600 hover:text-teal-800 font-semibold"
                    >
                      View
                    </a>
                  </div>
                )}
                <label className="flex items-center gap-2 cursor-pointer bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  <Paperclip className="w-4 h-4" />
                  {editAttachment ? editAttachment.name : (editingTransaction.attachment_url ? 'Replace file' : 'Choose file')}
                  <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => setEditAttachment(e.target.files[0])} />
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingTransaction(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingEdit}
                  className="px-5 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-sm disabled:opacity-50 transition-colors"
                >
                  {submittingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Bank Entry Modal */}
      {editingBankEntry && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div>
                <h3 className="text-lg font-bold text-slate-800">
                  Edit Bank Entry
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Voucher: <span className="font-mono font-semibold text-slate-700">{editingBankEntry.voucher_number}</span>
                </p>
              </div>
              <button
                onClick={() => setEditingBankEntry(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditBankSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Entry Type *</label>
                  <select
                    required
                    value={editBankForm.kind}
                    onChange={e => setEditBankForm(f => ({ ...f, kind: e.target.value, to_account_id: '' }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                  >
                    {BANK_ENTRY_KINDS.map(k => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Date *</label>
                  <input
                    type="date"
                    required
                    value={editBankForm.entry_date}
                    onChange={e => setEditBankForm(f => ({ ...f, entry_date: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {editBankForm.kind === 'transfer' ? 'From Account *' : 'Bank / Cash Account *'}
                  </label>
                  <select
                    required
                    value={editBankForm.bank_account_id}
                    onChange={e => setEditBankForm(f => ({ ...f, bank_account_id: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">-- Select Account --</option>
                    {bankAccounts.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.account_name} ({b.bank_name || (b.account_type === 'cash' ? 'Cash' : b.account_type)})
                      </option>
                    ))}
                  </select>
                </div>
                {editBankForm.kind === 'transfer' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">To Account *</label>
                    <select
                      required
                      value={editBankForm.to_account_id}
                      onChange={e => setEditBankForm(f => ({ ...f, to_account_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                    >
                      <option value="">-- Select Account --</option>
                      {bankAccounts
                        .filter(b => String(b.id) !== String(editBankForm.bank_account_id))
                        .map(b => (
                          <option key={b.id} value={b.id}>
                            {b.account_name} ({b.bank_name || (b.account_type === 'cash' ? 'Cash' : b.account_type)})
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={editBankForm.amount}
                    onChange={e => setEditBankForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Reference No.</label>
                  <input
                    type="text"
                    value={editBankForm.transaction_ref}
                    onChange={e => setEditBankForm(f => ({ ...f, transaction_ref: e.target.value }))}
                    placeholder="Cheque / UTR / statement ref"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Narration</label>
                <input
                  type="text"
                  value={editBankForm.narration}
                  onChange={e => setEditBankForm(f => ({ ...f, narration: e.target.value }))}
                  placeholder="e.g. Monthly account maintenance charge"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingBankEntry(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingEditBank}
                  className="px-5 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 shadow-sm disabled:opacity-50 transition-colors"
                >
                  {submittingEditBank ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
