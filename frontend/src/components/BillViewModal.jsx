import React, { useRef } from 'react';
import { X, Printer, Download, Edit, AlertCircle, XCircle } from 'lucide-react';
import { numberToIndianWords } from '../utils/numberToIndianWords';
import { getApiBaseUrl } from '../utils/apiUrl';
import { toast, confirmDialog } from '../context/ToastContext';
import api from '../services/api';

export default function BillViewModal({ isOpen, onClose, invoice, onEdit, onCancelled }) {
  const printRef = useRef(null);

  if (!isOpen || !invoice) return null;

  const agencyName = 'EAGLE EYE SECURITY SERVICE';
  const agencyAddress = 'Office Adress:- 418, SHIVALIK SATYAMEV, BOPAL-AMBLI JUNCTION, AHMEDABAD-380058';
  const agencyMobile = 'MOBILE NO.8320932214';
  const agencyEmail = 'EMAIL.ID:- info@egleeyesecuritygroup.in';
  const agencyGst = 'GST NO. 24AVYPP2011K1ZB';
  const agencyPan = 'PAN NO. AVYPP2011K';

  // Bank Details (selected or default IndusInd)
  const bankAccountName = invoice.bank_account_name || agencyName;
  const bankName = invoice.bank_name || 'Indusind Bank';
  const bankAccountNo = invoice.bank_account_number || '252528112019';
  const bankIfsc = invoice.bank_ifsc_code || 'INDB0000676';

  // Format Bill Date: DD-MM-YYYY
  const formatDisplayDate = (dStr) => {
    if (!dStr) return '';
    try {
      const d = new Date(dStr);
      if (isNaN(d.getTime())) return String(dStr);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    } catch (_) {
      return String(dStr);
    }
  };

  const billDate = formatDisplayDate(invoice.invoice_date);

  // Client Details
  const clientName = invoice.client_name || invoice.name || 'Client Name';
  const rawClientAddress = [
    invoice.client_address || invoice.address,
    invoice.client_city || invoice.city,
    invoice.client_state || invoice.state,
    invoice.postal_code
  ].filter(Boolean).join(', ');

  let siteName = invoice.site_name || invoice.site || '';
  if (!siteName && (invoice.notes || invoice.client_notes)) {
    const noteStr = `${invoice.notes || ''} ${invoice.client_notes || ''}`;
    const mNote = noteStr.match(/(?:Site\s*name\s*:\s*-?|Site\s*:\s*-?)\s*([^,\n\r]+)/i);
    if (mNote) siteName = mNote[1].trim();
  }
  if (!siteName && rawClientAddress) {
    const mAddr = rawClientAddress.match(/(?:Site\s*name\s*:\s*-?|Site\s*:\s*-?)\s*([^,\n\r]+)/i);
    if (mAddr) siteName = mAddr[1].trim();
  }

  // Clean address by stripping any embedded "Site name: ..." or "Site: ..."
  const clientAddress = rawClientAddress
    .replace(/(?:^|\n|\r|,|\s)*(?:Site\s*name\s*:\s*-?|Site\s*:\s*-?)[^\n\r]+/gi, '')
    .trim()
    .replace(/^[,-\s]+|[,-\s]+$/g, '')
    .trim();

  const clientGst = invoice.client_gst || invoice.gst_number || 'N/A';

  // RCM
  const isRcm = Boolean(invoice.is_rcm_applicable);

  // Math & Line items
  const guardsCount = invoice.guards_count || invoice.employee_count || 1;
  const guardsFormatted = String(guardsCount).padStart(2, '0');

  // Days
  let billingDays = 30;
  if (invoice.billing_period_start && invoice.billing_period_end) {
    const s = new Date(invoice.billing_period_start);
    const e = new Date(invoice.billing_period_end);
    billingDays = Math.max(1, Math.ceil((e - s) / (1000 * 60 * 60 * 24)) + 1);
  }
  const totalDays = invoice.total_duty_days || invoice.duty_days_worked || (guardsCount * billingDays);

  const subtotal = parseFloat(invoice.amount_subtotal) || 0;
  const finalAmount = parseFloat(invoice.final_amount) || 0;

  let monthlyRateVal = invoice.monthly_rate || 0;
  let ratePerDayVal = invoice.rate_per_day || 0;

  if (!ratePerDayVal && totalDays > 0 && subtotal > 0) {
    ratePerDayVal = subtotal / totalDays;
  }
  if (!monthlyRateVal && ratePerDayVal > 0) {
    monthlyRateVal = ratePerDayVal * 31;
  }

  const perDayRateDisplay = monthlyRateVal > 0 ? `${Math.round(monthlyRateVal)}/-` : (subtotal > 0 ? `${Math.round(subtotal)}/-` : '');
  const rateDisplay = ratePerDayVal > 0 ? parseFloat(ratePerDayVal).toFixed(2) : (subtotal > 0 && totalDays > 0 ? (subtotal / totalDays).toFixed(2) : '');

  const particularText = invoice.particular || 'Security Guard';
  const hsnCode = invoice.hsn_code || '998525';

  const displayItems = (() => {
    if (invoice.bill_items) {
      try {
        const arr = typeof invoice.bill_items === 'string' ? JSON.parse(invoice.bill_items) : invoice.bill_items;
        if (Array.isArray(arr) && arr.length > 0) return arr;
      } catch (_) {}
    }
    return [{
      particular: particularText,
      monthly_rate: monthlyRateVal,
      guards_count: guardsCount,
      rate_per_day: ratePerDayVal,
      hsn_code: hsnCode,
      total_duty_days: totalDays,
      amount: subtotal
    }];
  })();

  const amountInWords = numberToIndianWords(finalAmount);

  const getAmtScaleClass = (valStr, isBold = false) => {
    const len = String(valStr || '').length;
    if (len > 12) return 'text-[9.5px] sm:text-[11px]';
    if (len > 9) return 'text-[11px] sm:text-xs';
    return isBold ? 'text-xs sm:text-sm font-bold' : 'text-xs sm:text-sm';
  };

  // Actions
  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = () => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const url = `${getApiBaseUrl()}/invoices/${invoice.id}/pdf${token ? `?token=${token}` : ''}`;
    window.open(url, '_blank');
  };

  const handleCancelInvoice = async () => {
    const confirmed = await confirmDialog({
      title: 'Cancel Bill',
      message: `Are you sure you want to cancel invoice ${invoice.invoice_number}? This marks the bill as cancelled and clears payment due.`,
      confirmText: 'Yes, Cancel Bill',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      await api.post(`/invoices/${invoice.id}/cancel`);
      toast.success(`Invoice ${invoice.invoice_number} cancelled`);
      if (onCancelled) onCancelled();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to cancel invoice');
    }
  };

  const isCancelled = invoice.status === 'cancelled';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl my-auto overflow-hidden flex flex-col max-h-[96vh]">
        {/* Top Header / Action Toolbar (Hidden during Print) */}
        <div className="px-6 py-3.5 bg-slate-800 text-white flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
          <div className="flex items-center gap-3">
            <span className="font-bold text-base tracking-wide flex items-center gap-2">
              Bill Preview: {invoice.invoice_number}
            </span>
            {isCancelled && (
              <span className="bg-red-500 text-white text-xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                Cancelled
              </span>
            )}
            {isRcm && (
              <span className="bg-amber-400 text-slate-900 text-xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                RCM Bill
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" /> Print Bill
            </button>
            <button
              type="button"
              onClick={handleDownloadPDF}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" /> PDF
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                if (onEdit) onEdit(invoice);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              <Edit className="w-4 h-4" /> Edit
            </button>
            {!isCancelled && (
              <button
                type="button"
                onClick={handleCancelInvoice}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-700 hover:bg-rose-600 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                <XCircle className="w-4 h-4" /> Cancel Bill
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-slate-300 hover:text-white rounded-lg hover:bg-slate-700 transition-colors ml-2"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Bill Printable Area */}
        <div className="p-4 sm:p-8 overflow-y-auto flex-1 bg-white text-black font-sans select-text printable-bill-root">
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              body * {
                visibility: hidden !important;
              }
              .printable-bill-root, .printable-bill-root * {
                visibility: visible !important;
              }
              .printable-bill-root {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                margin: 0 !important;
                padding: 8mm 10mm !important;
                background: white !important;
              }
              @page {
                size: A4;
                margin: 6mm;
              }
              .print-avoid-break {
                break-inside: avoid !important;
                page-break-inside: avoid !important;
              }
            }
          `}} />

          <div ref={printRef} className="max-w-[780px] mx-auto relative bg-white">
            {/* Cancelled Watermark */}
            {isCancelled && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                <span className="text-7xl md:text-8xl font-black text-red-500/20 border-8 border-red-500/25 rounded-2xl px-8 py-4 -rotate-12 select-none uppercase tracking-widest">
                  CANCELLED
                </span>
              </div>
            )}

            {/* Top Company Header (Maroon Title, Black Address/Phone, Blue GST/PAN) */}
            <div className="text-center mb-3">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-widest text-[#8B1E1E] font-serif uppercase">
                {agencyName}
              </h1>
              <p className="text-[12px] sm:text-[13px] text-black mt-0.5 font-normal">
                {agencyAddress}
              </p>
              <p className="text-[12px] sm:text-[13px] text-black font-normal">
                {agencyMobile}
              </p>
              <p className="text-[12px] sm:text-[13px] text-black font-normal">
                {agencyEmail}
              </p>
              <p className="text-base sm:text-lg font-bold text-[#1a365d] mt-1 tracking-wide">
                {agencyGst}
              </p>
              <p className="text-base sm:text-lg font-bold text-[#1a365d] tracking-wide">
                {agencyPan}
              </p>
            </div>

            {/* Boxed Grid Layout - Exactly Matching Reference Format */}
            <div className="border border-black bg-white">
              {/* Row 1: PARTY NAME & INVOICE BILL */}
              <div className="grid grid-cols-12 border-b border-black font-bold">
                <div className="col-span-7 p-1.5 pl-2 text-xs sm:text-sm border-r border-black uppercase tracking-wider text-slate-800">
                  PARTY NAME
                </div>
                <div className="col-span-5 p-1.5 text-xs sm:text-sm text-center uppercase tracking-wider">
                  INVOICE BILL
                </div>
              </div>

              {/* Row 2: Client Name (Left) & RCM BILL (Right) */}
              <div className="grid grid-cols-12 border-b border-black font-bold">
                <div className="col-span-7 p-1.5 pl-2 border-r border-black flex items-center">
                  <h2 className="text-sm sm:text-base font-bold text-black leading-snug">
                    {clientName.endsWith('.') ? clientName : `${clientName}.`}
                  </h2>
                </div>
                <div className="col-span-5 p-1.5 flex items-center justify-center text-center">
                  <div className="text-sm sm:text-base font-extrabold tracking-wider">
                    RCM BILL &nbsp;&nbsp; {isRcm ? 'YES' : 'NO'}
                  </div>
                </div>
              </div>

              {/* Row 3: Client Address (Left) & INVOICE NO. (Right) - with line above and below */}
              <div className="grid grid-cols-12 border-b border-black">
                <div className="col-span-7 p-1.5 pl-2 border-r border-black flex items-center text-xs text-slate-800 leading-snug">
                  {clientAddress || '—'}
                </div>
                <div className="col-span-5 p-1.5 pl-3 sm:pl-4 flex items-center font-bold text-xs sm:text-sm uppercase tracking-tight">
                  INVOICE NO. {invoice.invoice_number}
                </div>
              </div>

              {/* Row 4: GST No & Site Name (Left) | Bill Date (Right) */}
              <div className="grid grid-cols-12 border-b border-black font-bold text-xs sm:text-sm">
                <div className="col-span-7 p-1.5 pl-2 border-r border-black flex flex-col justify-center space-y-1">
                  <div className="uppercase tracking-tight">
                    GST NO. {clientGst}
                  </div>
                  {siteName && (
                    <div className="font-bold text-black">
                      Site name: - <span className="font-semibold underline">{siteName}</span>
                    </div>
                  )}
                </div>
                <div className="col-span-5 p-1.5 pl-3 sm:pl-4 flex items-center">
                  <div className="uppercase tracking-tight">
                    BILL DATE: - {billDate}
                  </div>
                </div>
              </div>

              {/* Items Table Header */}
              <div className="flex flex-row border-b border-black text-center text-[11px] sm:text-xs font-bold bg-white">
                <div className="w-[5%] p-1.5 border-r border-black flex items-center justify-center">No.</div>
                <div className="w-[27%] p-1.5 pl-2 border-r border-black flex items-center justify-start">Particular</div>
                <div className="w-[12%] p-1.5 border-r border-black flex flex-col justify-center leading-tight">
                  <span>Per Day</span>
                  <span>Rate</span>
                </div>
                <div className="w-[8%] p-1.5 border-r border-black flex items-center justify-center">No.of</div>
                <div className="w-[10%] p-1.5 border-r border-black flex items-center justify-center">Rate</div>
                <div className="w-[11%] p-1.5 border-r border-black flex flex-col justify-center leading-tight">
                  <span>HSN</span>
                  <span>CODE</span>
                </div>
                <div className="w-[11%] p-1.5 border-r border-black flex flex-col justify-center leading-tight">
                  <span>Total</span>
                  <span>Day</span>
                </div>
                <div className="w-[16%] p-1.5 flex items-center justify-end pr-2">Amount</div>
              </div>

              {/* Items Table Data Rows */}
              <div className={`flex flex-col text-xs sm:text-sm ${displayItems.length <= 4 ? 'min-h-[140px] sm:min-h-[160px]' : ''}`}>
                {displayItems.map((it, idx) => {
                  const m = parseFloat(it.monthly_rate);
                  const r = parseFloat(it.rate_per_day);
                  const amt = parseFloat(it.amount) || 0;
                  const amtStr = amt.toFixed(2);
                  const amtClass = getAmtScaleClass(amtStr, true);

                  return (
                    <div key={idx} className="flex flex-row min-h-[26px] sm:min-h-[28px] items-center border-b border-black/20 last:border-b-0 print-avoid-break">
                      <div className="w-[5%] h-full p-1 text-center border-r border-black flex items-center justify-center font-medium">
                        {String(idx + 1).padStart(2, '0')}
                      </div>
                      <div className="w-[27%] h-full p-1 pl-2 text-left border-r border-black flex items-center font-medium truncate">
                        {it.particular || 'Security Guard'}
                      </div>
                      <div className="w-[12%] h-full p-1 text-center border-r border-black flex items-center justify-center font-medium">
                        {m > 0 ? `${Math.round(m)}/-` : ''}
                      </div>
                      <div className="w-[8%] h-full p-1 text-center border-r border-black flex items-center justify-center font-medium">
                        {String(it.guards_count || 1).padStart(2, '0')}
                      </div>
                      <div className="w-[10%] h-full p-1 text-center border-r border-black flex items-center justify-center font-medium tabular-nums">
                        {r > 0 ? r.toFixed(2) : ''}
                      </div>
                      <div className="w-[11%] h-full p-1 text-center border-r border-black flex items-center justify-center font-medium">
                        {it.hsn_code || '998525'}
                      </div>
                      <div className="w-[11%] h-full p-1 text-center border-r border-black flex items-center justify-center font-medium tabular-nums">
                        {it.total_duty_days ?? ''}
                      </div>
                      <div className={`w-[16%] h-full p-1 pr-2 text-right flex items-center justify-end tabular-nums truncate ${amtClass}`}>
                        {amtStr}
                      </div>
                    </div>
                  );
                })}

                {/* Vertical Line Fillers when table has fewer rows (Matches photo) */}
                {displayItems.length <= 4 && (
                  <div className="flex flex-row flex-1 min-h-[50px]">
                    <div className="w-[5%] border-r border-black"></div>
                    <div className="w-[27%] border-r border-black"></div>
                    <div className="w-[12%] border-r border-black"></div>
                    <div className="w-[8%] border-r border-black"></div>
                    <div className="w-[10%] border-r border-black"></div>
                    <div className="w-[11%] border-r border-black"></div>
                    <div className="w-[11%] border-r border-black"></div>
                    <div className="w-[16%]"></div>
                  </div>
                )}
              </div>

              {/* Bottom Section: Bank Details (Left ~58%) & Totals Table (Right ~42%) */}
              <div className="flex flex-row border-t border-black print-avoid-break">
                {/* Left: Bank Details with proper clearance so IFSC Code never touches the line */}
                <div className="w-[58%] border-r border-black p-2.5 sm:p-3 text-xs sm:text-[13px] leading-tight flex flex-col justify-start space-y-1">
                  <p className="font-bold">Bank Details:-</p>
                  <p className="font-bold">NAME:- {bankAccountName}</p>
                  <p className="font-bold">A/c No. {bankAccountNo}</p>
                  <p className="font-bold">Bank Name :- {bankName}</p>
                  <p className="font-bold pb-2">IFSC Code:s- {bankIfsc}</p>
                </div>

                {/* Right: Totals Mini-Table with vertical & horizontal dividers */}
                <div className="w-[42%] flex flex-col justify-between text-xs sm:text-sm">
                  {/* TOTAL */}
                  <div className="flex flex-row border-b border-black font-bold h-7 sm:h-7.5 items-center">
                    <div className="w-[44%] pl-2 border-r border-black flex items-center h-full">TOTAL</div>
                    <div className={`w-[56%] pr-2 text-right tabular-nums truncate flex items-center justify-end h-full ${getAmtScaleClass(subtotal.toFixed(2), true)}`}>
                      {subtotal.toFixed(2)}
                    </div>
                  </div>

                  {/* SGST */}
                  <div className="flex flex-row border-b border-black font-bold h-7 sm:h-7.5 items-center">
                    <div className="w-[44%] pl-2 border-r border-black flex items-center h-full">SGST &nbsp; 9%</div>
                    <div className={`w-[56%] pr-2 text-right tabular-nums truncate flex items-center justify-end h-full ${getAmtScaleClass(invoice.sgst_amount, true)}`}>
                      {!isRcm && invoice.tax_type === 'cgst_sgst' && invoice.sgst_amount > 0 ? parseFloat(invoice.sgst_amount).toFixed(2) : ''}
                    </div>
                  </div>

                  {/* CGST */}
                  <div className="flex flex-row border-b border-black font-bold h-7 sm:h-7.5 items-center">
                    <div className="w-[44%] pl-2 border-r border-black flex items-center h-full">CGST &nbsp; 9%</div>
                    <div className={`w-[56%] pr-2 text-right tabular-nums truncate flex items-center justify-end h-full ${getAmtScaleClass(invoice.cgst_amount, true)}`}>
                      {!isRcm && invoice.tax_type === 'cgst_sgst' && invoice.cgst_amount > 0 ? parseFloat(invoice.cgst_amount).toFixed(2) : ''}
                    </div>
                  </div>

                  {/* GROUND TOTAL */}
                  <div className="flex flex-row font-bold text-xs sm:text-sm h-8 sm:h-8.5 items-center bg-slate-50/50">
                    <div className="w-[44%] pl-2 border-r border-black flex items-center h-full uppercase tracking-tight">GROUND TOTAL</div>
                    <div className={`w-[56%] pr-2 text-right tabular-nums font-extrabold flex items-center justify-end h-full ${getAmtScaleClass(finalAmount.toFixed(2), true)}`}>
                      {finalAmount.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Amount in Words: Full-Width Row Bounded By Horizontal Lines (Exact Benchmark Layout) */}
              <div className="border-t border-black py-2 px-2.5 sm:px-3 text-xs sm:text-sm font-bold leading-snug print-avoid-break">
                <span className="underline">Rs in word:-</span> {amountInWords}
              </div>
            </div>

            {/* Footer Notes & Sign Off (Outside Below Box) */}
            <div className="flex justify-between items-center text-xs sm:text-sm font-bold mt-1.5 px-1 text-black print-avoid-break">
              <div>
                Note:- Subject to Ahmedabad Jurisdiction Only.
              </div>
              <div className="text-right">
                For, {agencyName}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
