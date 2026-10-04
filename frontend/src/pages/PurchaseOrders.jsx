import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ClipboardList, Plus, Search, X, Trash2, CheckCircle2, Ban, Eye,
  ArrowRightCircle, Paperclip, Edit, Printer, Share2, Upload,
  Calendar, ChevronDown, Check, ArrowLeft, FileText, AlertCircle, Receipt
} from 'lucide-react';
import api from '../services/api';
import { toast, confirmDialog } from '../context/ToastContext';
import Pagination from '../components/Pagination';
import { getServerBaseUrl } from '../utils/apiUrl';
import { sanitizePhone } from '../utils/phoneValidation';
import { numberToIndianWords } from '../utils/numberToIndianWords';

const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
  "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa",
  "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka",
  "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"
];

const UNIT_OPTIONS = [
  "Bag", "NONE", "Box", "Pcs", "Kg", "Mtr", "Nos", "Pkt", "Set", "Pair", "Ltr", "Roll"
];

const TAX_OPTIONS = [
  { label: 'Exempt (0%)', rate: 0, type: 'none' },
  { label: 'GST @ 0%', rate: 0, type: 'cgst_sgst' },
  { label: 'GST @ 5%', rate: 5, type: 'cgst_sgst' },
  { label: 'GST @ 12%', rate: 12, type: 'cgst_sgst' },
  { label: 'GST @ 18%', rate: 18, type: 'cgst_sgst' },
  { label: 'GST @ 28%', rate: 28, type: 'cgst_sgst' },
  { label: 'IGST @ 5%', rate: 5, type: 'igst' },
  { label: 'IGST @ 12%', rate: 12, type: 'igst' },
  { label: 'IGST @ 18%', rate: 18, type: 'igst' },
  { label: 'IGST @ 28%', rate: 28, type: 'igst' },
];

const TERMS_TEMPLATES = [
  {
    title: 'Standard Procurement Terms',
    content: '1. Goods received are subject to physical inspection and verification.\n2. Invoices must clearly quote this Purchase Order number.\n3. Defective or substandard materials must be replaced within 48 hours.\n4. Payment will be released strictly according to agreed credit terms.'
  },
  {
    title: 'Payment on Delivery (POD)',
    content: '1. Full payment upon satisfactory delivery and verification of items.\n2. Original tax invoice and delivery challan must accompany goods.\n3. Goods transit risk remains with vendor until received at firm premises.'
  },
  {
    title: 'Net 30 Days Credit',
    content: '1. Payment terms: Net 30 days from date of receipt of original tax invoice.\n2. In case of delay beyond specified date, firm reserves right to cancel without liability.'
  },
  {
    title: 'Delivery within 7 Days',
    content: '1. Urgent requirement: delivery must be completed within 7 calendar days.\n2. Late deliveries will attract 1% penalty per week or part thereof.'
  }
];

const emptyItem = {
  description: '',
  hsn_code: '',
  item_description: '',
  quantity: '1',
  unit: 'NONE',
  unit_price: '',
  price_type: 'without_tax', // 'without_tax' | 'with_tax'
  discount_percent: '',
  discount_amount: '',
  tax_rate: '18',
  tax_type: 'cgst_sgst',
};

const emptyForm = {
  vendor_id: '',
  vendor_name: '',
  phone_no: '',
  bill_number: '',
  po_date: new Date().toISOString().split('T')[0],
  state_of_supply: 'Gujarat',
  price_type: 'without_tax',
  payment_type: 'cash',
  payment_details: '',
  show_payment_details: false,
  notes: '',
  terms_title: '',
  terms_conditions: '',
  round_off_enabled: false,
  round_off_value: '0',
  is_rcm_applicable: false,
  tds_rate: '',
  items: [{ ...emptyItem }],
};

const STATUS_STYLES = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  billed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
};

// Line Item Calculation
function computeRowCalculations(item) {
  const qty = parseFloat(item.quantity) || 0;
  const unitPrice = parseFloat(item.unit_price) || 0;
  const base = qty * unitPrice;

  let discAmt = 0;
  const discPct = parseFloat(item.discount_percent) || 0;
  if (discPct > 0) {
    discAmt = (base * discPct) / 100;
  } else if (parseFloat(item.discount_amount) > 0) {
    discAmt = parseFloat(item.discount_amount);
  }
  discAmt = Math.min(base, discAmt);

  const priceType = item.price_type === 'with_tax' ? 'with_tax' : 'without_tax';
  const taxRate = parseFloat(item.tax_rate) || 0;

  let taxable = 0;
  let taxAmt = 0;
  let lineTotal = 0;

  if (priceType === 'with_tax') {
    const gross = Math.max(0, base - discAmt);
    if (taxRate > 0) {
      taxable = gross / (1 + taxRate / 100);
      taxAmt = gross - taxable;
    } else {
      taxable = gross;
      taxAmt = 0;
    }
    lineTotal = gross;
  } else {
    taxable = Math.max(0, base - discAmt);
    taxAmt = taxRate > 0 ? (taxable * taxRate) / 100 : 0;
    lineTotal = taxable + taxAmt;
  }

  return {
    base,
    discountAmount: discAmt,
    taxable,
    taxAmount: taxAmt,
    lineTotal,
  };
}

export default function PurchaseOrders() {
  // Navigation / Tabs: 'list' or 'editor'
  const [activeTab, setActiveTab] = useState('list'); // 'list' | 'editor'
  const [editorMode, setEditorMode] = useState('create'); // 'create' | 'edit'
  const [editingPoId, setEditingPoId] = useState(null);
  const [editingPoNumber, setEditingPoNumber] = useState('');

  // PO List Data
  const [pos, setPos] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  // Form State
  const [vendors, setVendors] = useState([]);
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorDropdownOpen, setVendorDropdownOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [existingAttachmentUrl, setExistingAttachmentUrl] = useState(null);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Modals
  const [viewPo, setViewPo] = useState(null);
  const [convertModal, setConvertModal] = useState({ open: false, po: null, expense_date: '', payment_method: 'bank_transfer' });
  const [converting, setConverting] = useState(false);

  // Fetch Vendors
  useEffect(() => {
    api.get('/vendors?all=true')
      .then(res => setVendors(res.data || []))
      .catch(() => {
        api.get('/vendors').then(res => setVendors(res.data || [])).catch(() => setVendors([]));
      });
  }, []);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter]);

  // Fetch POs
  const fetchPOs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', page);
      params.set('limit', '20');
      const res = await api.get(`/purchase-orders?${params.toString()}`);
      setPos(res.data || []);
      if (res.pagination) setPagination(res.pagination);
    } catch (err) {
      console.error('Failed to load purchase orders', err);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter, page]);

  useEffect(() => { fetchPOs(); }, [fetchPOs]);

  // Filtered Vendors for search
  const filteredVendors = useMemo(() => {
    if (!vendorSearch) return vendors;
    const term = vendorSearch.toLowerCase();
    return vendors.filter(v =>
      (v.name && v.name.toLowerCase().includes(term)) ||
      (v.legal_name && v.legal_name.toLowerCase().includes(term)) ||
      (v.display_name && v.display_name.toLowerCase().includes(term)) ||
      (v.contact_info && v.contact_info.toLowerCase().includes(term)) ||
      (v.tax_id && v.tax_id.toLowerCase().includes(term))
    );
  }, [vendors, vendorSearch]);

  // Calculations for entire form
  const totals = useMemo(() => {
    let totalQty = 0;
    let grossAmount = 0;
    let subtotalTaxable = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    let rawTotal = 0;

    form.items.forEach(it => {
      const { base, discountAmount, taxable, taxAmount, lineTotal } = computeRowCalculations(it);
      totalQty += parseFloat(it.quantity) || 0;
      grossAmount += base;
      totalDiscount += discountAmount;
      subtotalTaxable += taxable;
      totalTax += taxAmount;
      rawTotal += lineTotal;
    });

    const isInterState = form.state_of_supply && form.state_of_supply !== 'Gujarat';
    const totalCgst = isInterState ? 0 : totalTax / 2;
    const totalSgst = isInterState ? 0 : totalTax / 2;
    const totalIgst = isInterState ? totalTax : 0;

    let roundOffVal = 0;
    let finalTotal = rawTotal;

    if (form.round_off_enabled) {
      const rounded = Math.round(rawTotal);
      roundOffVal = rounded - rawTotal;
      finalTotal = rounded;
    } else if (form.round_off_value && parseFloat(form.round_off_value) !== 0) {
      roundOffVal = parseFloat(form.round_off_value) || 0;
      finalTotal = rawTotal + roundOffVal;
    }

    const grandTotal = Math.max(0, finalTotal);
    const amountInWords = numberToIndianWords(grandTotal);

    return {
      totalQty,
      grossAmount,
      subtotalTaxable,
      totalDiscount,
      totalTax,
      isInterState,
      totalCgst,
      totalSgst,
      totalIgst,
      roundOffVal,
      grandTotal,
      amountInWords,
    };
  }, [form.items, form.state_of_supply, form.round_off_enabled, form.round_off_value]);

  // Handle Vendor Selection
  const selectVendor = (vendor) => {
    setForm(prev => ({
      ...prev,
      vendor_id: vendor.id,
      vendor_name: vendor.display_name || vendor.legal_name || vendor.name,
      phone_no: sanitizePhone(vendor.contact_info || ''),
      state_of_supply: vendor.tax_id && vendor.tax_id.length >= 2 ? (
        // Map 24 -> Gujarat, etc. or preserve default
        vendor.tax_id.startsWith('24') ? 'Gujarat' : prev.state_of_supply
      ) : prev.state_of_supply,
    }));
    setVendorSearch(vendor.display_name || vendor.legal_name || vendor.name);
    setVendorDropdownOpen(false);
  };

  // Line item helpers
  const updateItem = (idx, field, value) => {
    setForm(f => {
      const items = [...f.items];
      const cur = { ...items[idx], [field]: value };

      const qty = parseFloat(field === 'quantity' ? value : cur.quantity) || 0;
      const price = parseFloat(field === 'unit_price' ? value : cur.unit_price) || 0;
      const base = qty * price;

      // Mutual sync between % and Amount discount
      if (field === 'discount_percent') {
        const pct = parseFloat(value) || 0;
        cur.discount_amount = pct > 0 && base > 0 ? ((base * pct) / 100).toFixed(2) : '';
      } else if (field === 'discount_amount') {
        const amt = parseFloat(value) || 0;
        cur.discount_percent = base > 0 && amt > 0 ? ((amt / base) * 100).toFixed(1) : '';
      } else if (field === 'quantity' || field === 'unit_price') {
        // If qty or price changes, sync discount values so they never desync
        const pct = parseFloat(cur.discount_percent) || 0;
        const amt = parseFloat(cur.discount_amount) || 0;
        if (pct > 0 && base > 0) {
          cur.discount_amount = ((base * pct) / 100).toFixed(2);
        } else if (amt > 0 && base > 0) {
          cur.discount_percent = ((amt / base) * 100).toFixed(1);
        }
      }

      items[idx] = cur;
      return { ...f, items };
    });
  };

  const handlePriceTypeChange = (newType) => {
    setForm(f => ({
      ...f,
      price_type: newType,
      items: f.items.map(it => ({ ...it, price_type: newType }))
    }));
  };

  const addItem = () => {
    setForm(f => ({
      ...f,
      items: [...f.items, { ...emptyItem, price_type: f.price_type || 'without_tax' }]
    }));
  };

  const removeItem = (idx) => {
    setForm(f => ({
      ...f,
      items: f.items.length <= 1 ? f.items : f.items.filter((_, i) => i !== idx)
    }));
  };

  // Terms & Conditions selection
  const handleTermsTemplateSelect = (title) => {
    const tpl = TERMS_TEMPLATES.find(t => t.title === title);
    setForm(prev => ({
      ...prev,
      terms_title: title,
      terms_conditions: tpl ? tpl.content : prev.terms_conditions
    }));
  };

  // Reset & Navigation
  const startNewPO = () => {
    setForm(emptyForm);
    setVendorSearch('');
    setAttachmentFile(null);
    setExistingAttachmentUrl(null);
    setRemoveAttachment(false);
    setEditorMode('create');
    setEditingPoId(null);
    setEditingPoNumber('');
    setActiveTab('editor');
  };

  const backToList = () => {
    setActiveTab('list');
    setEditorMode('create');
    setEditingPoId(null);
    setEditingPoNumber('');
    setForm(emptyForm);
    setVendorSearch('');
    setAttachmentFile(null);
    setExistingAttachmentUrl(null);
  };

  // Start Edit Mode for an existing PO
  const startEditPO = async (po) => {
    try {
      const res = await api.get(`/purchase-orders/${po.id}`);
      const data = res.data;
      if (!data) throw new Error('Could not load bill details');

      if (data.status !== 'draft') {
        toast.warning(`This purchase bill is ${data.status} and cannot be edited`);
        return;
      }

      setEditingPoId(data.id);
      setEditingPoNumber(data.bill_number || data.po_number);
      setEditorMode('edit');

      setVendorSearch(data.vendor_name || '');
      setExistingAttachmentUrl(data.attachment_url || null);
      setAttachmentFile(null);
      setRemoveAttachment(false);

      const items = (data.items && data.items.length > 0)
        ? data.items.map(it => ({
            description: it.description || '',
            hsn_code: it.hsn_code || '',
            item_description: it.item_description || '',
            quantity: String(it.quantity || '1'),
            unit: it.unit || 'NONE',
            unit_price: String(it.unit_price || ''),
            price_type: it.price_type || 'without_tax',
            discount_percent: it.discount_percent ? String(it.discount_percent) : '',
            discount_amount: it.discount_amount ? String(it.discount_amount) : '',
            tax_rate: String(it.tax_rate ?? '18'),
            tax_type: data.tax_type || 'cgst_sgst',
          }))
        : [{ ...emptyItem }];

      setForm({
        vendor_id: data.vendor_id,
        vendor_name: data.vendor_name || '',
        phone_no: sanitizePhone(data.vendor_contact || ''),
        bill_number: data.bill_number || data.po_number || '',
        po_date: data.po_date || new Date().toISOString().split('T')[0],
        state_of_supply: data.state_of_supply || 'Gujarat',
        payment_type: data.payment_type || 'cash',
        payment_details: data.payment_details || '',
        show_payment_details: Boolean(data.payment_details),
        notes: data.notes || '',
        terms_title: '',
        terms_conditions: data.terms_conditions || '',
        round_off_enabled: Boolean(parseFloat(data.round_off) !== 0),
        round_off_value: String(data.round_off || '0'),
        is_rcm_applicable: Boolean(data.is_rcm_applicable),
        tds_rate: data.tds_rate ? String(data.tds_rate) : '',
        items,
      });

      setActiveTab('editor');
    } catch (err) {
      toast.error('Failed to load purchase bill for editing');
    }
  };

  // Submit Handler (Create or Update)
  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();

    if (!form.vendor_id) {
      toast.error('Please select a vendor (Party)');
      return;
    }
    if (form.items.some(it => !it.description.trim() || !(parseFloat(it.quantity) > 0) || it.unit_price === '')) {
      toast.error('Each line item requires an item name, positive quantity, and a price/unit');
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('vendor_id', form.vendor_id);
      fd.append('po_date', form.po_date);
      fd.append('bill_number', form.bill_number || '');
      fd.append('state_of_supply', form.state_of_supply || 'Gujarat');
      fd.append('payment_type', form.payment_type || 'cash');
      fd.append('payment_details', form.payment_details || '');
      fd.append('terms_conditions', form.terms_conditions || '');
      fd.append('notes', form.notes || '');
      // Derived from the real entered data — not hardcoded — so an inter-state
      // PO is saved as IGST and the stored rate reflects what was actually
      // typed per item, instead of always being forced to CGST+SGST @ 18%.
      const effectiveTaxType = totals.totalTax <= 0 ? 'none' : (totals.isInterState ? 'igst' : 'cgst_sgst');
      const effectiveTaxRate = totals.subtotalTaxable > 0 ? (totals.totalTax / totals.subtotalTaxable) * 100 : 0;
      fd.append('tax_type', effectiveTaxType);
      fd.append('tax_rate', effectiveTaxRate.toFixed(2));
      fd.append('is_rcm_applicable', form.is_rcm_applicable);
      fd.append('tds_rate', form.tds_rate || 0);
      fd.append('round_off', totals.roundOffVal || 0);

      // Enriched line items
      const enrichedItems = form.items.map(it => {
        const rowCalc = computeRowCalculations(it);
        return {
          description: it.description.trim(),
          hsn_code: it.hsn_code ? it.hsn_code.trim() : null,
          item_description: it.item_description || '',
          quantity: parseFloat(it.quantity) || 1,
          unit: it.unit || 'NONE',
          unit_price: parseFloat(it.unit_price) || 0,
          price_type: it.price_type || 'without_tax',
          discount_percent: parseFloat(it.discount_percent) || 0,
          discount_amount: rowCalc.discountAmount,
          tax_rate: parseFloat(it.tax_rate) || 0,
          tax_amount: rowCalc.taxAmount,
          amount: rowCalc.lineTotal,
        };
      });
      fd.append('items', JSON.stringify(enrichedItems));

      if (attachmentFile) {
        fd.append('attachment_file', attachmentFile);
      }
      if (removeAttachment) {
        fd.append('remove_attachment', 'true');
      }

      if (editorMode === 'edit' && editingPoId) {
        await api.put(`/purchase-orders/${editingPoId}`, fd);
        toast.success(`Purchase bill ${editingPoNumber || ''} updated successfully`);
      } else {
        const res = await api.post('/purchase-orders', fd);
        const createdNum = res.data?.bill_number || res.data?.po_number || '';
        toast.success(`Purchase bill ${createdNum} created successfully`);
      }

      backToList();
      fetchPOs();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to save purchase bill');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete Handler (usable from List, Modal, and Editor!)
  const handleDelete = async (poOrId, poNumberParam) => {
    const id = typeof poOrId === 'object' ? poOrId.id : poOrId;
    const num = typeof poOrId === 'object' ? (poOrId.bill_number || poOrId.po_number) : (poNumberParam || 'this Purchase Bill');

    const confirmed = await confirmDialog({
      title: 'Delete Purchase Bill',
      message: `Are you sure you want to permanently delete ${num}? This cannot be undone.`,
      confirmText: 'Delete Permanently',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await api.delete(`/purchase-orders/${id}`);
      toast.success(`Purchase bill ${num} deleted`);
      if (activeTab === 'editor' && editingPoId === id) {
        backToList();
      }
      if (viewPo && viewPo.id === id) {
        setViewPo(null);
      }
      fetchPOs();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to delete purchase bill');
    }
  };

  // Cancel PO Handler
  const handleCancel = async (po) => {
    const num = po.bill_number || po.po_number;
    const confirmed = await confirmDialog({
      title: 'Cancel Purchase Bill',
      message: `Cancel ${num}? This cannot be undone.`,
      confirmText: 'Cancel Bill',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.post(`/purchase-orders/${po.id}/cancel`);
      toast.success('Purchase bill cancelled');
      fetchPOs();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to cancel');
    }
  };

  // View PO Details
  const openView = async (po) => {
    try {
      const res = await api.get(`/purchase-orders/${po.id}`);
      setViewPo(res.data);
    } catch {
      toast.error('Failed to load purchase bill details');
    }
  };

  // Convert to Bill
  const openConvert = (po) => {
    setConvertModal({
      open: true,
      po,
      expense_date: new Date().toISOString().split('T')[0],
      payment_method: po.payment_type && ['cash', 'bank_transfer', 'cheque', 'upi'].includes(po.payment_type) ? po.payment_type : 'bank_transfer'
    });
  };

  const handleConvert = async (e) => {
    e.preventDefault();
    setConverting(true);
    try {
      await api.post(`/purchase-orders/${convertModal.po.id}/convert-to-bill`, {
        expense_date: convertModal.expense_date,
        payment_method: convertModal.payment_method,
      });
      toast.success('Converted to a bill — visible in Bank & Payments → Vendor Payments');
      setConvertModal({ open: false, po: null, expense_date: '', payment_method: 'bank_transfer' });
      if (viewPo) setViewPo(null);
      fetchPOs();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to convert to a bill');
    } finally {
      setConverting(false);
    }
  };

  // Browser Print Trigger
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4 animate-fade-in pb-10">
      {/* ─── Top Tabs Strip (Mimicking the screenshot's Purchase Bill tab bar) ─── */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 rounded-t-2xl shadow-sm">
        <div className="flex items-center space-x-1.5 overflow-x-auto">
          {/* Tab 1: All Bills */}
          <button
            onClick={() => setActiveTab('list')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'list'
                ? 'bg-teal-50 text-teal-700 border border-teal-200 shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ClipboardList className="w-4 h-4 text-teal-600" />
            <span>All Purchase Bills</span>
            <span className="px-1.5 py-0.2 bg-slate-200/70 text-slate-700 rounded-full text-[10px]">
              {pagination?.total ?? pos.length}
            </span>
          </button>

          {/* Tab 2: Active Purchase Bill Editor */}
          {activeTab === 'editor' && (
            <div className="flex items-center gap-1.5 px-3.5 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-medium shadow-xs">
              <span>{editorMode === 'edit' ? `Edit ${editingPoNumber || 'Bill'}` : 'Bill #1'}</span>
              <button
                type="button"
                onClick={backToList}
                title="Close tab"
                className="hover:bg-teal-700 rounded p-0.5 ml-1 text-teal-100 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* New Purchase Bill + Button */}
          <button
            type="button"
            onClick={startNewPO}
            title="Create New Purchase Bill"
            className="w-7 h-7 flex items-center justify-center rounded-full bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 transition-colors ml-1"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Right side info / quick action */}
        {activeTab === 'list' ? (
          <button
            onClick={startNewPO}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Purchase Bill</span>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 hidden sm:inline">
              Mode: <strong className="text-slate-800 uppercase">{editorMode}</strong>
            </span>
            <button
              type="button"
              onClick={backToList}
              className="text-xs text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100"
            >
              Back to List
            </button>
          </div>
        )}
      </div>

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* ─── TAB CONTENT: LIST VIEW ─────────────────────────────────────────── */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'list' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {/* Header & Filter Controls */}
          <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 bg-slate-50/50">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by Bill number, vendor, or phone..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm bg-white text-slate-800"
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-xl text-xs font-medium bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="billed">Billed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left">
              <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Bill Number</th>
                  <th className="px-4 py-3">Vendor / Party</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-center">Items</th>
                  <th className="px-4 py-3 text-right">Total Amount</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                      <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-teal-500 border-t-transparent mb-2"></div>
                      <p className="text-xs">Loading purchase bills...</p>
                    </td>
                  </tr>
                ) : pos.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                      <ClipboardList className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                      <p className="font-medium text-slate-700">No purchase bills found</p>
                      <p className="text-xs text-slate-400 mt-0.5">Click "New Purchase Bill" to itemize and generate a new purchase bill.</p>
                      <button
                        onClick={startNewPO}
                        className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-semibold"
                      >
                        <Plus className="w-3.5 h-3.5" /> Create Purchase Bill
                      </button>
                    </td>
                  </tr>
                ) : (
                  pos.map(po => (
                    <tr key={po.id} className="hover:bg-teal-50/20 transition-colors">
                      <td className="px-4 py-3.5 font-mono text-xs font-semibold text-teal-700">
                        <div>{po.bill_number || po.po_number}</div>
                        {po.bill_number && po.po_number && po.bill_number !== po.po_number && (
                          <div className="text-[10px] text-slate-400 font-mono font-normal">Ref: {po.po_number}</div>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-slate-800">{po.vendor_name}</div>
                        {po.vendor_gstin && (
                          <div className="text-[11px] text-slate-400 font-mono">GSTIN: {po.vendor_gstin}</div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-600 whitespace-nowrap">
                        {po.po_date}
                      </td>
                      <td className="px-4 py-3.5 text-center text-xs font-medium text-slate-600">
                        {po.item_count || 1}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-slate-900 whitespace-nowrap">
                        ₹{parseFloat(po.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-block px-2.5 py-0.5 text-[11px] font-semibold rounded-full border capitalize ${STATUS_STYLES[po.status] || 'bg-slate-100 text-slate-600'}`}>
                          {po.status}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {/* View Button */}
                          <button
                            onClick={() => openView(po)}
                            title="View Purchase Bill & Print"
                            className="p-1.5 text-slate-400 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Edit Button */}
                          {po.status === 'draft' && (
                            <button
                              onClick={() => startEditPO(po)}
                              title="Edit Purchase Bill"
                              className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                          )}

                          {/* Convert to bill (Draft only) */}
                          {po.status === 'draft' && (
                            <button
                              onClick={() => openConvert(po)}
                              title="Book to Expenses"
                              className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                            >
                              <ArrowRightCircle className="w-4 h-4" />
                            </button>
                          )}

                          {/* Cancel (Draft only) */}
                          {po.status === 'draft' && (
                            <button
                              onClick={() => handleCancel(po)}
                              title="Cancel Purchase Bill"
                              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                              <Ban className="w-4 h-4" />
                            </button>
                          )}

                          {/* Delete Button */}
                          {po.status !== 'billed' && (
                            <button
                              onClick={() => handleDelete(po)}
                              title="Delete Purchase Bill"
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}

                          {po.status === 'billed' && (
                            <span className="text-xs text-emerald-600 flex items-center gap-1 pl-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Billed
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/50">
            <Pagination pagination={pagination} onPageChange={setPage} />
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* ─── TAB CONTENT: PURCHASE BILL EDITOR (Mimicking Vyapar Screen) ───── */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'editor' && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden space-y-0">
          {/* Top Title & Status Banner */}
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                {editorMode === 'edit' ? `Edit Purchase Bill — ${editingPoNumber}` : 'New Purchase Bill'}
              </h2>
              {editorMode === 'edit' && (
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  Draft Mode
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={backToList}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Back to List
              </button>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* ─── 1. Party & Header Metadata (Left: Party/Phone, Right: Bill Info) ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Vendor Autocomplete + Phone Number */}
              <div className="lg:col-span-6 flex flex-col sm:flex-row gap-3 items-start">
                {/* Search by Name/Phone Dropdown */}
                <div className="relative flex-1 w-full">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Search by Name/Phone <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Type vendor name or phone..."
                      value={vendorSearch}
                      onChange={e => {
                        setVendorSearch(e.target.value);
                        setVendorDropdownOpen(true);
                      }}
                      onFocus={() => setVendorDropdownOpen(true)}
                      className="w-full px-3 py-2 pr-8 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none bg-white text-slate-800 placeholder-slate-400"
                    />
                    <ChevronDown
                      onClick={() => setVendorDropdownOpen(o => !o)}
                      className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer hover:text-slate-600"
                    />
                  </div>

                  {/* Autocomplete Menu */}
                  {vendorDropdownOpen && (
                    <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                      {filteredVendors.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-slate-400">No matching vendor found</div>
                      ) : (
                        filteredVendors.map(v => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => selectVendor(v)}
                            className="w-full px-3 py-2 text-left text-xs hover:bg-teal-50 flex items-center justify-between border-b border-slate-50 last:border-0 transition-colors"
                          >
                            <div>
                              <div className="font-semibold text-slate-800">{v.display_name || v.legal_name || v.name}</div>
                              {v.tax_id && <div className="text-[10px] text-slate-400 font-mono">GSTIN: {v.tax_id}</div>}
                            </div>
                            {v.contact_info && (
                              <div className="text-[11px] text-teal-700 font-medium">{v.contact_info}</div>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Phone No. Field */}
                <div className="w-full sm:w-44">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Phone No. (10 Digits)
                  </label>
                  <input
                    type="tel"
                    maxLength="10"
                    placeholder="10-digit number"
                    value={form.phone_no}
                    onChange={e => setForm(f => ({ ...f, phone_no: sanitizePhone(e.target.value) }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none bg-white text-slate-800 placeholder-slate-400"
                  />
                </div>
              </div>

              {/* Right Column: Bill Number, Bill Date, State of Supply */}
              <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Bill Number */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Bill Number
                  </label>
                  <input
                    type="text"
                    placeholder="Auto if empty (e.g. PB-...) or type vendor invoice #"
                    value={form.bill_number}
                    onChange={e => setForm(f => ({ ...f, bill_number: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none bg-white text-slate-800"
                  />
                </div>

                {/* Bill Date */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-teal-600" />
                    <span>Bill Date <span className="text-rose-500">*</span></span>
                  </label>
                  <input
                    type="date"
                    required
                    value={form.po_date}
                    onChange={e => setForm(f => ({ ...f, po_date: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none bg-white text-slate-800"
                  />
                </div>

                {/* State of Supply */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    State of supply
                  </label>
                  <select
                    value={form.state_of_supply}
                    onChange={e => setForm(f => ({ ...f, state_of_supply: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none bg-white text-slate-800"
                  >
                    {INDIAN_STATES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* ─── 2. Line Items Table (Spacious, Professional 2-Tier Layout) ─── */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs bg-white">
              <div className="overflow-x-auto w-full">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-slate-50 text-slate-700 text-xs font-bold uppercase tracking-wider border-b border-slate-200">
                    <tr>
                      <th rowSpan={2} className="py-2 px-1 text-center w-8 text-slate-400">#</th>
                      <th rowSpan={2} className="py-2 px-1.5 text-left w-40 xl:w-48">Item</th>
                      <th rowSpan={2} className="py-2 px-1.5 text-left w-24">HSN Code</th>
                      <th rowSpan={2} className="py-2 px-1.5 text-left min-w-[110px]">Description</th>
                      <th rowSpan={2} className="py-2 px-1.5 text-right w-20">Qty</th>
                      <th rowSpan={2} className="py-2 px-1.5 text-left w-24">Unit</th>
                      <th rowSpan={2} className="py-2 px-1.5 text-right w-28">
                        <div className="flex flex-col items-end gap-0.5">
                          <span>Price/Unit</span>
                          <select
                            value={form.price_type || 'without_tax'}
                            onChange={e => handlePriceTypeChange(e.target.value)}
                            className="text-[10px] font-semibold bg-white border border-slate-300 rounded px-1 py-0.5 text-teal-700 hover:border-teal-500 focus:outline-none cursor-pointer"
                          >
                            <option value="without_tax">Without Tax ▾</option>
                            <option value="with_tax">With Tax ▾</option>
                          </select>
                        </div>
                      </th>
                      {/* DISCOUNT split header */}
                      <th colSpan={2} className="py-1 px-1 text-center border-l border-r border-slate-200 bg-slate-100/70 font-bold">
                        Discount
                      </th>
                      {/* TAX split header */}
                      <th colSpan={2} className="py-1 px-1 text-center border-r border-slate-200 bg-slate-100/70 font-bold">
                        Tax (GST)
                      </th>
                      <th rowSpan={2} className="py-2 px-1.5 text-right w-28">Amount (₹)</th>
                      <th rowSpan={2} className="py-2 px-1 w-8 text-center"></th>
                    </tr>
                    <tr className="bg-slate-100/80 text-[10px] text-slate-500 font-semibold border-t border-slate-200">
                      <th className="py-1 px-1 text-center border-l border-slate-200 w-16">%</th>
                      <th className="py-1 px-1 text-center border-r border-slate-200 w-20">Amount (₹)</th>
                      <th className="py-1 px-1 text-left w-24">% Rate</th>
                      <th className="py-1 px-1 text-right border-r border-slate-200 w-20">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {form.items.map((it, idx) => {
                      const { base, discountAmount, taxAmount, lineTotal } = computeRowCalculations(it);
                      return (
                        <tr key={idx} className="hover:bg-teal-50/15 transition-colors group">
                          {/* Row Number */}
                          <td className="py-2 px-1 text-center text-slate-400 font-mono text-xs">
                            {idx + 1}
                          </td>

                          {/* Item Name */}
                          <td className="py-2 px-1.5">
                            <input
                              type="text"
                              required
                              placeholder="Item name (e.g. Uniforms)"
                              value={it.description}
                              onChange={e => updateItem(idx, 'description', e.target.value)}
                              className="w-full h-8.5 px-2.5 bg-white hover:bg-slate-50/70 focus:bg-white border border-slate-200 hover:border-slate-300 focus:border-teal-500 rounded-lg text-xs font-medium focus:ring-1 focus:ring-teal-500 focus:outline-none transition-all placeholder:text-slate-300"
                            />
                          </td>

                          {/* HSN Code */}
                          <td className="py-2 px-1.5">
                            <input
                              type="text"
                              placeholder="HSN/SAC"
                              value={it.hsn_code}
                              onChange={e => updateItem(idx, 'hsn_code', e.target.value)}
                              className="w-full h-8.5 px-2 bg-white hover:bg-slate-50/70 focus:bg-white border border-slate-200 hover:border-slate-300 focus:border-teal-500 rounded-lg text-xs font-mono focus:ring-1 focus:ring-teal-500 focus:outline-none transition-all placeholder:text-slate-300"
                            />
                          </td>

                          {/* Description */}
                          <td className="py-2 px-1.5">
                            <input
                              type="text"
                              placeholder="Specs / remarks"
                              value={it.item_description}
                              onChange={e => updateItem(idx, 'item_description', e.target.value)}
                              className="w-full h-8.5 px-2.5 bg-white hover:bg-slate-50/70 focus:bg-white border border-slate-200 hover:border-slate-300 focus:border-teal-500 rounded-lg text-xs focus:ring-1 focus:ring-teal-500 focus:outline-none transition-all placeholder:text-slate-300"
                            />
                          </td>

                          {/* Quantity */}
                          <td className="py-2 px-1.5">
                            <input
                              type="number"
                              min="0.01"
                              step="any"
                              required
                              value={it.quantity}
                              onChange={e => updateItem(idx, 'quantity', e.target.value)}
                              className="w-full h-8.5 px-2 bg-white hover:bg-slate-50/70 focus:bg-white border border-slate-200 hover:border-slate-300 focus:border-teal-500 rounded-lg text-xs text-right font-medium focus:ring-1 focus:ring-teal-500 focus:outline-none transition-all"
                            />
                          </td>

                          {/* Unit */}
                          <td className="py-2 px-1.5">
                            <select
                              value={it.unit}
                              onChange={e => updateItem(idx, 'unit', e.target.value)}
                              className="w-full h-8.5 px-1.5 bg-white hover:bg-slate-50/70 focus:bg-white border border-slate-200 hover:border-slate-300 focus:border-teal-500 rounded-lg text-xs text-slate-700 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-all cursor-pointer"
                            >
                              {UNIT_OPTIONS.map(u => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          </td>

                          {/* Price / Unit (Single clean input, mode in header) */}
                          <td className="py-2 px-1.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              required
                              placeholder="0.00"
                              value={it.unit_price}
                              onChange={e => updateItem(idx, 'unit_price', e.target.value)}
                              className="w-full h-8.5 px-2 bg-white hover:bg-slate-50/70 focus:bg-white border border-slate-200 hover:border-slate-300 focus:border-teal-500 rounded-lg text-xs text-right font-semibold text-slate-800 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-all placeholder:text-slate-300"
                            />
                          </td>

                          {/* Discount % */}
                          <td className="py-2 px-1 border-l border-slate-200">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="any"
                              placeholder="0%"
                              value={it.discount_percent}
                              onChange={e => updateItem(idx, 'discount_percent', e.target.value)}
                              className="w-full h-8.5 px-1.5 bg-white hover:bg-slate-50/70 focus:bg-white border border-slate-200 hover:border-slate-300 focus:border-teal-500 rounded-lg text-xs text-right focus:ring-1 focus:ring-teal-500 focus:outline-none transition-all placeholder:text-slate-300"
                            />
                          </td>

                          {/* Discount Amount */}
                          <td className="py-2 px-1 border-r border-slate-200">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              placeholder="₹0.00"
                              value={it.discount_amount}
                              onChange={e => updateItem(idx, 'discount_amount', e.target.value)}
                              className="w-full h-8.5 px-1.5 bg-white hover:bg-slate-50/70 focus:bg-white border border-slate-200 hover:border-slate-300 focus:border-teal-500 rounded-lg text-xs text-right focus:ring-1 focus:ring-teal-500 focus:outline-none transition-all placeholder:text-slate-300"
                            />
                          </td>

                          {/* Tax % Rate Select */}
                          <td className="py-2 px-1">
                            <select
                              value={it.tax_rate}
                              onChange={e => updateItem(idx, 'tax_rate', e.target.value)}
                              className="w-full h-8.5 px-1 bg-white hover:bg-slate-50/70 focus:bg-white border border-slate-200 hover:border-slate-300 focus:border-teal-500 rounded-lg text-xs text-slate-700 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-all cursor-pointer"
                            >
                              {TAX_OPTIONS.map((opt, i) => (
                                <option key={i} value={opt.rate}>{opt.label}</option>
                              ))}
                            </select>
                          </td>

                          {/* Tax Amount Display */}
                          <td className="py-2 px-1 text-right font-mono text-slate-700 font-medium text-xs border-r border-slate-200 pr-2 whitespace-nowrap">
                            ₹{taxAmount.toFixed(2)}
                          </td>

                          {/* Amount — the straightforward Qty × Price figure; discount and
                              tax are already broken out in their own columns to the left. */}
                          <td className="py-2 px-1.5 text-right font-bold text-slate-900 font-mono text-sm pr-2 whitespace-nowrap">
                            ₹{base.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>

                          {/* Delete Item Row */}
                          <td className="py-2 px-1 text-center">
                            <button
                              type="button"
                              onClick={() => removeItem(idx)}
                              disabled={form.items.length <= 1}
                              title="Delete Item Row"
                              className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg disabled:opacity-20 transition-all mx-auto cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Table Footer: ADD ROW Button & Summary Totals */}
              <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 text-xs">
                <div>
                  <button
                    type="button"
                    onClick={addItem}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-teal-500 hover:bg-teal-50 text-teal-700 rounded-xl font-bold transition-all shadow-2xs"
                  >
                    <Plus className="w-4 h-4 text-teal-600" />
                    <span>ADD ROW</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3 justify-end">
                  <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-1.5 shadow-2xs flex items-center gap-2">
                    <span className="text-slate-400 font-medium text-[11px] uppercase">Total Qty:</span>
                    <span className="font-bold text-slate-800 text-xs">{totals.totalQty}</span>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-1.5 shadow-2xs flex items-center gap-2">
                    <span className="text-slate-400 font-medium text-[11px] uppercase">Total Discount:</span>
                    <span className="font-bold text-slate-800 text-xs font-mono">₹{totals.totalDiscount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-1.5 shadow-2xs flex items-center gap-2">
                    <span className="text-slate-400 font-medium text-[11px] uppercase">Total Tax:</span>
                    <span className="font-bold text-slate-800 text-xs font-mono">₹{totals.totalTax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-1.5 shadow-2xs flex items-center gap-2 text-teal-900">
                    <span className="text-teal-600 font-semibold text-[11px] uppercase">Subtotal:</span>
                    <span className="font-extrabold text-sm font-mono">₹{totals.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ─── 3. Bottom 3-Card Section: Terms, Payment & Description, Comprehensive Order Summary ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              {/* Card 1: Terms & Conditions */}
              <div className="lg:col-span-4 bg-slate-50/60 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between space-y-3">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                    Terms & Conditions
                  </h3>
                  <div className="mt-2">
                    <select
                      value={form.terms_title}
                      onChange={e => handleTermsTemplateSelect(e.target.value)}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs bg-white text-slate-700 focus:ring-1 focus:ring-teal-500 focus:outline-none"
                    >
                      <option value="">-- Select Template --</option>
                      {TERMS_TEMPLATES.map((t, i) => (
                        <option key={i} value={t.title}>{t.title}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <textarea
                  rows={4}
                  placeholder="Selected terms and conditions appear here..."
                  value={form.terms_conditions}
                  onChange={e => setForm(f => ({ ...f, terms_conditions: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-white text-slate-800 placeholder-slate-400 focus:ring-1 focus:ring-teal-500 focus:outline-none resize-none flex-1"
                />
              </div>

              {/* Card 2: Payment Details & Notes/Description */}
              <div className="lg:col-span-4 bg-slate-50/60 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between space-y-3">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-slate-800 uppercase tracking-wide mb-1">
                        Payment Type
                      </label>
                      <select
                        value={form.payment_type}
                        onChange={e => setForm(f => ({ ...f, payment_type: e.target.value }))}
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs bg-white text-slate-800 focus:ring-1 focus:ring-teal-500 focus:outline-none capitalize font-medium"
                      >
                        <option value="cash">Cash</option>
                        <option value="bank_transfer">Bank Transfer</option>
                        <option value="cheque">Cheque</option>
                        <option value="upi">UPI</option>
                        <option value="credit">Credit / To Be Paid</option>
                      </select>
                    </div>

                    <div className="pt-5">
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, show_payment_details: !f.show_payment_details }))}
                        className="text-xs text-teal-700 hover:text-teal-900 font-semibold flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{form.show_payment_details ? 'Hide Ref' : 'Add Ref / Details'}</span>
                      </button>
                    </div>
                  </div>

                  {form.show_payment_details && (
                    <input
                      type="text"
                      placeholder="Transaction ID / Cheque No. / Bank info"
                      value={form.payment_details}
                      onChange={e => setForm(f => ({ ...f, payment_details: e.target.value }))}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs bg-white text-slate-800 focus:ring-1 focus:ring-teal-500 focus:outline-none"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Description / Notes
                  </label>
                  <textarea
                    rows={2}
                    placeholder="General remarks, delivery instructions, reference..."
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs bg-white text-slate-800 placeholder-slate-400 focus:ring-1 focus:ring-teal-500 focus:outline-none resize-none"
                  />
                </div>
              </div>

              {/* Card 3: Comprehensive Purchase Bill Summary */}
              <div className="lg:col-span-4 bg-slate-50/70 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between space-y-3 shadow-2xs">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wide">
                      <Receipt className="w-3.5 h-3.5 text-teal-600" />
                      <span>Bill Summary</span>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                      {totals.totalQty} {totals.totalQty === 1 ? 'Qty' : 'Qty'}
                    </span>
                  </div>

                  {/* Summary Breakdown */}
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Gross Amount</span>
                      <span className="font-mono font-medium text-slate-800">
                        ₹{totals.grossAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>

                    {totals.totalDiscount > 0 && (
                      <div className="flex justify-between items-center text-emerald-600">
                        <span>Total Discount</span>
                        <span className="font-mono font-medium">
                          -₹{totals.totalDiscount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between items-center text-slate-700 font-semibold pt-1 border-t border-dashed border-slate-200">
                      <span>Taxable Subtotal</span>
                      <span className="font-mono">
                        ₹{totals.subtotalTaxable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>

                    {/* GST Breakdown */}
                    {totals.isInterState ? (
                      <div className="flex justify-between items-center text-slate-600 text-[11px]">
                        <span>IGST</span>
                        <span className="font-mono">₹{totals.totalIgst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between items-center text-slate-600 text-[11px]">
                          <span>CGST</span>
                          <span className="font-mono">₹{totals.totalCgst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between items-center text-slate-600 text-[11px]">
                          <span>SGST</span>
                          <span className="font-mono">₹{totals.totalSgst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      </>
                    )}

                    <div className="flex justify-between items-center text-slate-500 text-[11px]">
                      <span>Total Tax (GST)</span>
                      <span className="font-mono font-medium text-slate-700">₹{totals.totalTax.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>

                    {/* Round Off */}
                    <div className="flex items-center justify-between pt-1 border-t border-dashed border-slate-200">
                      <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-slate-600 select-none">
                        <input
                          type="checkbox"
                          checked={form.round_off_enabled}
                          onChange={e => setForm(f => ({ ...f, round_off_enabled: e.target.checked }))}
                          className="w-3.5 h-3.5 text-teal-600 rounded border-slate-300 focus:ring-teal-500"
                        />
                        <span>Round Off</span>
                      </label>

                      {form.round_off_enabled ? (
                        <span className="text-[11px] font-mono font-medium text-slate-600 bg-white px-2 py-0.5 border border-slate-200 rounded">
                          {totals.roundOffVal >= 0 ? `+₹${totals.roundOffVal.toFixed(2)}` : `-₹${Math.abs(totals.roundOffVal).toFixed(2)}`}
                        </span>
                      ) : (
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={form.round_off_value}
                          onChange={e => setForm(f => ({ ...f, round_off_value: e.target.value }))}
                          className="w-16 px-1.5 py-0.5 text-right border border-slate-300 rounded text-xs bg-white font-mono"
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* Grand Total Highlight */}
                <div className="pt-2 border-t border-slate-200 space-y-1">
                  <div className="flex items-baseline justify-between bg-teal-600 text-white px-3.5 py-2 rounded-xl shadow-xs">
                    <span className="text-xs font-bold uppercase tracking-wider">Grand Total</span>
                    <span className="text-base font-black font-mono">
                      ₹{totals.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>

                  {totals.amountInWords && (
                    <div className="text-[10px] text-slate-500 italic text-right px-1 leading-snug">
                      ({totals.amountInWords})
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ─── 4. Bottom Action Footer Bar ─── */}
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            {/* Left: Upload Bill / Attachment */}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer bg-white border border-slate-300 hover:border-teal-500 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 shadow-2xs hover:bg-teal-50/30 transition-all">
                <Upload className="w-4 h-4 text-teal-600" />
                <span>Upload Bill</span>
                <input
                  type="file"
                  accept="image/*,.pdf,.xlsx"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files[0];
                    if (file) {
                      setAttachmentFile(file);
                      setRemoveAttachment(false);
                    }
                  }}
                />
              </label>

              {/* Show chosen or existing file */}
              {attachmentFile && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-teal-50 text-teal-700 rounded-lg text-xs border border-teal-200">
                  <Paperclip className="w-3.5 h-3.5" />
                  <span className="max-w-[140px] truncate">{attachmentFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachmentFile(null)}
                    className="hover:text-rose-600 p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {!attachmentFile && existingAttachmentUrl && !removeAttachment && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs border border-slate-200">
                  <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                  <a
                    href={`${getServerBaseUrl()}${existingAttachmentUrl}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-teal-700 hover:text-teal-900"
                  >
                    View Attachment
                  </a>
                  <button
                    type="button"
                    onClick={() => setRemoveAttachment(true)}
                    title="Remove attachment"
                    className="hover:text-rose-600 p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            {/* Right Actions: Cancel, Print/Share, Delete (if edit), Save */}
            <div className="flex items-center gap-2.5 justify-end">
              <button
                type="button"
                onClick={backToList}
                className="px-4 py-2 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl transition-colors shadow-2xs"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl transition-colors shadow-2xs"
              >
                <Printer className="w-3.5 h-3.5 text-slate-500" />
                <span>Print / Share</span>
              </button>

              {/* DELETE BUTTON when editing existing Purchase Bill */}
              {editorMode === 'edit' && editingPoId && (
                <button
                  type="button"
                  onClick={() => handleDelete(editingPoId, editingPoNumber)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-xl transition-colors shadow-2xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Purchase Bill</span>
                </button>
              )}

              {/* Primary SAVE / UPDATE BUTTON */}
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-6 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl shadow-sm transition-colors disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>{editorMode === 'edit' ? 'Update Purchase Bill' : 'Save Purchase Bill'}</span>
                )}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* ─── VIEW MODAL / PRINTABLE PREVIEW ─────────────────────────────────── */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {viewPo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div className="flex items-center gap-3">
                <ClipboardList className="w-6 h-6 text-teal-600" />
                <div>
                  <h3 className="text-base font-bold text-slate-800">
                    {viewPo.bill_number || viewPo.po_number}
                  </h3>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-slate-500">{viewPo.vendor_name}</p>
                    {viewPo.bill_number && viewPo.po_number && viewPo.bill_number !== viewPo.po_number && (
                      <span className="text-[10px] text-slate-400 font-mono">Ref: {viewPo.po_number}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrint}
                  title="Print Purchase Bill"
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60"
                >
                  <Printer className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewPo(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-xs print:p-0">
              {/* Meta Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Bill Date</span>
                  <span className="font-semibold text-slate-800">{viewPo.po_date}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Status</span>
                  <span className={`inline-block px-2 py-0.5 rounded-full capitalize text-[10px] font-bold border ${STATUS_STYLES[viewPo.status] || 'bg-slate-100 text-slate-600'}`}>
                    {viewPo.status}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Vendor GSTIN</span>
                  <span className="font-mono text-slate-700">{viewPo.vendor_gstin || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">State of Supply</span>
                  <span className="font-medium text-slate-700">{viewPo.state_of_supply || 'Gujarat'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Bill Number</span>
                  <span className="font-mono text-slate-800 font-semibold">{viewPo.bill_number || viewPo.po_number}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Payment Type</span>
                  <span className="capitalize font-medium text-slate-700">{viewPo.payment_type || 'Cash'}</span>
                </div>
                {viewPo.payment_details && (
                  <div className="sm:col-span-2">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Payment Details</span>
                    <span className="text-slate-700">{viewPo.payment_details}</span>
                  </div>
                )}
              </div>

              {/* Items Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-[10px] text-slate-500 font-bold uppercase">
                    <tr>
                      <th className="p-2 text-left">Item & Description</th>
                      <th className="p-2 text-left w-20">HSN</th>
                      <th className="p-2 text-right w-16">Qty</th>
                      <th className="p-2 text-left w-16">Unit</th>
                      <th className="p-2 text-right w-24">Price</th>
                      <th className="p-2 text-right w-20">Discount</th>
                      <th className="p-2 text-right w-20">Tax</th>
                      <th className="p-2 text-right w-28">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {viewPo.items?.map((it, idx) => (
                      <tr key={it.id || idx}>
                        <td className="p-2">
                          <div className="font-semibold text-slate-800">{it.description}</div>
                          {it.item_description && (
                            <div className="text-[11px] text-slate-400">{it.item_description}</div>
                          )}
                        </td>
                        <td className="p-2 font-mono text-slate-500">{it.hsn_code || '-'}</td>
                        <td className="p-2 text-right font-medium text-slate-700">{it.quantity}</td>
                        <td className="p-2 text-slate-500">{it.unit || 'NONE'}</td>
                        <td className="p-2 text-right font-mono">₹{parseFloat(it.unit_price || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td className="p-2 text-right font-mono text-slate-600">
                          {parseFloat(it.discount_amount || 0) > 0 ? `₹${parseFloat(it.discount_amount).toFixed(2)}` : '-'}
                        </td>
                        <td className="p-2 text-right font-mono text-slate-600">
                          {parseFloat(it.tax_amount || 0) > 0 ? `₹${parseFloat(it.tax_amount).toFixed(2)}` : '-'}
                        </td>
                        <td className="p-2 text-right font-bold text-slate-900 font-mono">
                          ₹{(parseFloat(it.quantity || 0) * parseFloat(it.unit_price || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Financial Breakdown */}
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                <div className="space-y-3 flex-1 text-slate-600">
                  {viewPo.terms_conditions && (
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                      <span className="font-bold text-slate-700 block mb-1">Terms & Conditions:</span>
                      <p className="whitespace-pre-line text-slate-600 leading-relaxed">{viewPo.terms_conditions}</p>
                    </div>
                  )}
                  {viewPo.notes && (
                    <div className="text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">Notes:</span> {viewPo.notes}
                    </div>
                  )}
                  {viewPo.attachment_url && (
                    <div>
                      <a
                        href={`${getServerBaseUrl()}${viewPo.attachment_url}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-900 bg-teal-50 px-3 py-1.5 rounded-lg border border-teal-200"
                      >
                        <Paperclip className="w-3.5 h-3.5" /> View Attached Bill / Quotation
                      </a>
                    </div>
                  )}
                </div>

                {/* Totals Summary Card */}
                <div className="bg-slate-50 rounded-xl p-3.5 text-xs space-y-1 w-full sm:w-64 border border-slate-200">
                  <div className="flex justify-between text-slate-500">
                    <span>Subtotal</span>
                    <span className="font-mono">₹{parseFloat(viewPo.subtotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  {parseFloat(viewPo.discount_amount || 0) > 0 && (
                    <div className="flex justify-between text-slate-500">
                      <span>Total Discount</span>
                      <span className="font-mono">-₹{parseFloat(viewPo.discount_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {parseFloat(viewPo.cgst_amount || 0) > 0 && (
                    <div className="flex justify-between text-slate-500">
                      <span>CGST</span>
                      <span className="font-mono">₹{parseFloat(viewPo.cgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {parseFloat(viewPo.sgst_amount || 0) > 0 && (
                    <div className="flex justify-between text-slate-500">
                      <span>SGST</span>
                      <span className="font-mono">₹{parseFloat(viewPo.sgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {parseFloat(viewPo.igst_amount || 0) > 0 && (
                    <div className="flex justify-between text-slate-500">
                      <span>IGST</span>
                      <span className="font-mono">₹{parseFloat(viewPo.igst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {parseFloat(viewPo.round_off || 0) !== 0 && (
                    <div className="flex justify-between text-slate-500">
                      <span>Round Off</span>
                      <span className="font-mono">{parseFloat(viewPo.round_off) >= 0 ? `+₹${parseFloat(viewPo.round_off).toFixed(2)}` : `-₹${Math.abs(parseFloat(viewPo.round_off)).toFixed(2)}`}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-extrabold text-sm text-slate-900 border-t border-slate-200 pt-1.5 mt-1">
                    <span>Total</span>
                    <span className="font-mono">₹{parseFloat(viewPo.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                {viewPo.status === 'draft' && (
                  <>
                    {/* Edit inside modal */}
                    <button
                      type="button"
                      onClick={() => {
                        setViewPo(null);
                        startEditPO(viewPo);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-xs font-semibold"
                    >
                      <Edit className="w-3.5 h-3.5" /> Edit Purchase Bill
                    </button>

                    {/* Delete inside modal */}
                    <button
                      type="button"
                      onClick={() => handleDelete(viewPo)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete Purchase Bill
                    </button>

                    {/* Convert inside modal */}
                    <button
                      type="button"
                      onClick={() => openConvert(viewPo)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold"
                    >
                      <ArrowRightCircle className="w-3.5 h-3.5" /> Book to Expenses
                    </button>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => setViewPo(null)}
                className="px-4 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* ─── BOOK TO EXPENSES (CONVERT TO BILL) MODAL ───────────────────────── */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {convertModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-emerald-50">
              <h3 className="text-base font-bold text-emerald-800">
                Book {convertModal.po?.bill_number || convertModal.po?.po_number} to Expenses
              </h3>
              <button
                onClick={() => setConvertModal({ ...convertModal, open: false })}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleConvert} className="p-6 space-y-4">
              <p className="text-xs text-slate-500 leading-relaxed">
                This books a real vendor bill (expense) for <strong>₹{parseFloat(convertModal.po?.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>. It will be ready for payment in Bank & Payments → Vendor Payments.
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Bill Date
                </label>
                <input
                  type="date"
                  required
                  value={convertModal.expense_date}
                  onChange={e => setConvertModal(m => ({ ...m, expense_date: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Default Payment Method
                </label>
                <select
                  value={convertModal.payment_method}
                  onChange={e => setConvertModal(m => ({ ...m, payment_method: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none capitalize"
                >
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                  <option value="upi">UPI</option>
                </select>
              </div>
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setConvertModal({ ...convertModal, open: false })}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={converting}
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 shadow-sm disabled:opacity-50"
                >
                  {converting ? 'Booking...' : 'Book to Expenses'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
