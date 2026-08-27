import { X, Download, Printer, FileText, Building2, IndianRupee, Users, Receipt } from 'lucide-react';
import * as XLSX from 'xlsx';

const domainIcons = {
  invoice: <FileText className="w-5 h-5" />,
  vendor: <Building2 className="w-5 h-5" />,
  gst: <IndianRupee className="w-5 h-5" />,
  tds: <Receipt className="w-5 h-5" />,
  payroll: <Users className="w-5 h-5" />,
};

const domainColors = {
  invoice: 'text-blue-600 bg-blue-50 border-blue-200',
  vendor: 'text-amber-600 bg-amber-50 border-amber-200',
  gst: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  tds: 'text-purple-600 bg-purple-50 border-purple-200',
  payroll: 'text-teal-600 bg-teal-50 border-teal-200',
};

function formatCurrency(val) {
  return `₹${parseFloat(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

function formatDate(d) {
  if (!d) return '-';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

function DataRow({ label, value, isCurrency = false }) {
  return (
    <div className="flex justify-between py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-500 font-medium">{label}</span>
      <span className="text-sm text-slate-800 font-semibold">{isCurrency ? formatCurrency(value) : (value || '-')}</span>
    </div>
  );
}

function InvoiceView({ data }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-50 rounded-xl p-5 border border-slate-100">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Invoice Details</h4>
          <DataRow label="Invoice #" value={data.invoice_number} />
          <DataRow label="Date" value={formatDate(data.invoice_date)} />
          <DataRow label="Due Date" value={formatDate(data.due_date)} />
          <DataRow label="Status" value={data.status?.replace('_', ' ').toUpperCase()} />
          <DataRow label="Tax Type" value={data.tax_type?.replace('_', ' + ').toUpperCase()} />
        </div>
        <div className="bg-slate-50 rounded-xl p-5 border border-slate-100">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Client Details</h4>
          <DataRow label="Client" value={data.client_name} />
          <DataRow label="Address" value={data.client_address} />
          <DataRow label="City" value={data.client_city} />
          <DataRow label="GST" value={data.client_gst} />
          <DataRow label="Phone" value={data.client_phone} />
        </div>
      </div>
      <div className="bg-white rounded-xl p-5 border border-slate-200">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Financial Breakdown</h4>
        <DataRow label="Billing Period" value={`${formatDate(data.billing_period_start)} to ${formatDate(data.billing_period_end)}`} />
        <DataRow label="Subtotal" value={data.amount_subtotal} isCurrency />
        {parseFloat(data.cgst_amount) > 0 && <DataRow label="CGST (9%)" value={data.cgst_amount} isCurrency />}
        {parseFloat(data.sgst_amount) > 0 && <DataRow label="SGST (9%)" value={data.sgst_amount} isCurrency />}
        {parseFloat(data.igst_amount) > 0 && <DataRow label="IGST (18%)" value={data.igst_amount} isCurrency />}
        {parseFloat(data.discount_amount) > 0 && <DataRow label="Discount" value={data.discount_amount} isCurrency />}
        <div className="flex justify-between py-3 mt-2 border-t-2 border-slate-300">
          <span className="text-base font-bold text-slate-800">Final Amount</span>
          <span className="text-base font-bold text-emerald-700">{formatCurrency(data.final_amount)}</span>
        </div>
        <DataRow label="Payment Received" value={data.payment_received || data.total_received} isCurrency />
        <DataRow label="TDS Deducted" value={data.tds_deducted || data.total_tds} isCurrency />
        <DataRow label="Remaining Due" value={data.payment_due || data.remaining_due} isCurrency />
      </div>
    </div>
  );
}

function VendorView({ data }) {
  return (
    <div className="space-y-6">
      <div className="bg-slate-50 rounded-xl p-5 border border-slate-100">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Vendor Details</h4>
        <DataRow label="Vendor" value={data.vendor_name} />
        <DataRow label="Category" value={data.category?.replace(/_/g, ' ').toUpperCase()} />
        <DataRow label="Description" value={data.description} />
        <DataRow label="Date" value={formatDate(data.expense_date || data.payment_date)} />
        <DataRow label="Status" value={data.status?.toUpperCase()} />
      </div>
      <div className="bg-white rounded-xl p-5 border border-slate-200">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Payment Details</h4>
        <DataRow label="Expense Amount" value={data.amount || data.expense_amount} isCurrency />
        <DataRow label="Amount Paid" value={data.amount_paid || data.payment_amount} isCurrency />
        <DataRow label="Total Paid So Far" value={data.total_paid} isCurrency />
        {data.payment_method && <DataRow label="Payment Method" value={data.payment_method?.replace(/_/g, ' ').toUpperCase()} />}
        {data.reference_number && <DataRow label="Reference" value={data.reference_number} />}
      </div>
    </div>
  );
}

function GstView({ data }) {
  return (
    <div className="space-y-6">
      <div className="bg-slate-50 rounded-xl p-5 border border-slate-100">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">GST Details</h4>
        <DataRow label="Invoice #" value={data.invoice_number} />
        <DataRow label="Client" value={data.client_name} />
        <DataRow label="Client GST" value={data.client_gst} />
        <DataRow label="Tax Type" value={data.tax_type?.replace('_', ' + ').toUpperCase()} />
        <DataRow label="RCM Applicable" value={data.is_rcm ? 'Yes' : 'No'} />
      </div>
      <div className="bg-white rounded-xl p-5 border border-slate-200">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Tax Breakdown</h4>
        <DataRow label="Taxable Value" value={data.taxable_value} isCurrency />
        {parseFloat(data.cgst) > 0 && <DataRow label="CGST (9%)" value={data.cgst} isCurrency />}
        {parseFloat(data.sgst) > 0 && <DataRow label="SGST (9%)" value={data.sgst} isCurrency />}
        {parseFloat(data.igst) > 0 && <DataRow label="IGST (18%)" value={data.igst} isCurrency />}
        <div className="flex justify-between py-3 mt-2 border-t-2 border-slate-300">
          <span className="text-base font-bold text-slate-800">Total Tax</span>
          <span className="text-base font-bold text-emerald-700">{formatCurrency((parseFloat(data.cgst || 0) + parseFloat(data.sgst || 0) + parseFloat(data.igst || 0)))}</span>
        </div>
        <DataRow label="Invoice Total" value={data.total} isCurrency />
      </div>
    </div>
  );
}

function TdsView({ data }) {
  return (
    <div className="space-y-6">
      <div className="bg-slate-50 rounded-xl p-5 border border-slate-100">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">TDS Certificate</h4>
        <DataRow label="Client" value={data.client_name} />
        <DataRow label="Client GST" value={data.client_gst} />
        <DataRow label="Invoice #" value={data.invoice_number} />
        <DataRow label="Payment Date" value={formatDate(data.payment_date)} />
      </div>
      <div className="bg-white rounded-xl p-5 border border-slate-200">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Amount Details</h4>
        <DataRow label="Payment Amount" value={data.payment_amount} isCurrency />
        <div className="flex justify-between py-3 mt-2 border-t-2 border-purple-200 bg-purple-50/50 -mx-5 px-5 rounded-b-xl">
          <span className="text-base font-bold text-purple-800">TDS Deducted</span>
          <span className="text-base font-bold text-purple-700">{formatCurrency(data.tds_amount)}</span>
        </div>
        {data.payment_method && <DataRow label="Payment Method" value={data.payment_method?.replace(/_/g, ' ').toUpperCase()} />}
        {data.transaction_reference && <DataRow label="Transaction Ref" value={data.transaction_reference} />}
      </div>
    </div>
  );
}

function PayrollView({ data }) {
  return (
    <div className="space-y-6">
      <div className="bg-slate-50 rounded-xl p-5 border border-slate-100">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Employee Details</h4>
        <DataRow label="Employee" value={data.employee_name || data.full_name} />
        <DataRow label="Employee ID" value={data.emp_id || data.employee_id} />
        <DataRow label="Payroll Month" value={formatDate(data.payroll_month)} />
        <DataRow label="Days Worked" value={`${data.days_worked} / ${data.days_in_month}`} />
        <DataRow label="Status" value={data.payment_status?.toUpperCase()} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-emerald-50 rounded-xl p-5 border border-emerald-100">
          <h4 className="text-xs font-bold text-emerald-500 uppercase tracking-wider mb-3">Earnings</h4>
          <DataRow label="Base Salary" value={data.base_salary} isCurrency />
          <DataRow label="DA" value={data.da_amount} isCurrency />
          <DataRow label="HRA" value={data.hra_amount} isCurrency />
          <DataRow label="Other Allowances" value={data.other_allowances} isCurrency />
          <div className="flex justify-between py-2.5 mt-1 border-t border-emerald-200">
            <span className="text-sm font-bold text-emerald-800">Gross Salary</span>
            <span className="text-sm font-bold text-emerald-700">{formatCurrency(data.gross_salary)}</span>
          </div>
        </div>
        <div className="bg-red-50 rounded-xl p-5 border border-red-100">
          <h4 className="text-xs font-bold text-red-500 uppercase tracking-wider mb-3">Deductions</h4>
          <DataRow label="PF" value={data.pf_deduction} isCurrency />
          <DataRow label="ESI" value={data.esi_deduction} isCurrency />
          <DataRow label="Tax" value={data.tax_deduction} isCurrency />
          <DataRow label="Other" value={data.other_deductions} isCurrency />
          <div className="flex justify-between py-2.5 mt-1 border-t border-red-200">
            <span className="text-sm font-bold text-red-800">Total Deductions</span>
            <span className="text-sm font-bold text-red-700">{formatCurrency(data.total_deductions)}</span>
          </div>
        </div>
      </div>
      <div className="bg-teal-600 rounded-xl p-5 text-white text-center">
        <p className="text-xs font-bold uppercase tracking-wider opacity-80 mb-1">Net Salary</p>
        <p className="text-2xl font-bold">{formatCurrency(data.net_salary)}</p>
      </div>
    </div>
  );
}

const viewMap = {
  invoice: InvoiceView,
  vendor: VendorView,
  gst: GstView,
  tds: TdsView,
  payroll: PayrollView,
};

export default function StatementViewerModal({ isOpen, onClose, statement }) {
  if (!isOpen || !statement) return null;

  const data = statement.statement_data || {};
  const ViewComponent = viewMap[statement.domain] || InvoiceView;
  const colorClass = domainColors[statement.domain] || domainColors.invoice;

  const handlePrint = () => {
    const content = document.getElementById('statement-modal-content');
    if (!content) return;
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Print Statement</title><style>
      body { font-family: sans-serif; padding: 20px; }
      h4 { margin-top: 15px; margin-bottom: 5px; color: #64748b; font-size: 12px; text-transform: uppercase; }
      .flex { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
      .font-bold { font-weight: bold; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    </style></head><body><h2>${statement.title}</h2><p>${statement.statement_number} • ${formatDate(statement.generated_at)}</p><hr/>${content.outerHTML}</body></html>`);
    w.document.close();
    w.onload = () => {
      w.print();
      setTimeout(() => w.close(), 500);
    };
  };

  const handleExport = () => {
    const wb = XLSX.utils.book_new();
    const wsData = [[statement.title], [`Date: ${formatDate(statement.generated_at)}`], []];
    
    // Flatten data into rows
    const flatten = (obj, prefix = '') => {
      let flat = {};
      Object.entries(obj).forEach(([key, val]) => {
        if (typeof val === 'object' && val !== null) {
          Object.assign(flat, flatten(val, `${prefix}${key} - `));
        } else {
          flat[`${prefix}${key}`] = val;
        }
      });
      return flat;
    };
    
    Object.entries(flatten(data)).forEach(([key, val]) => {
      wsData.push([key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), val]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 25 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Statement');
    XLSX.writeFile(wb, `${statement.statement_number}.xlsx`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-in print:static print:p-0 print:bg-white print:backdrop-blur-none">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-slide-up print:shadow-none print:max-h-none print:rounded-none">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50 print:bg-white">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg border ${colorClass}`}>
              {domainIcons[statement.domain]}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{statement.title}</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {statement.statement_number} • {formatDate(statement.generated_at)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium shadow-sm">
              <Download className="w-3.5 h-3.5" /> Export
            </button>
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium shadow-sm">
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            <button onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div id="statement-modal-content" className="flex-1 overflow-auto p-6 print:overflow-visible">
          <ViewComponent data={data} />
        </div>
      </div>
    </div>
  );
}
