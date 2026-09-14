const logger = require('./logger.js');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

/**
 * Draws text with automatic font scaling if the string exceeds available width.
 * Prevents text wrapping or overflowing table cell borders.
 */
function drawFittedText(doc, text, x, y, width, maxFontSize, minFontSize = 6.5, options = {}) {
  let fontSize = maxFontSize;
  doc.fontSize(fontSize);
  const str = String(text ?? '');
  const padding = options.padding !== undefined ? options.padding : 4;
  const availableWidth = Math.max(10, width - padding);
  
  while (fontSize > minFontSize && doc.widthOfString(str) > availableWidth) {
    fontSize -= 0.5;
    doc.fontSize(fontSize);
  }
  doc.text(str, x, y, { width, ...options });
}

/**
 * Converts a number to standard Indian numbering words (Lakhs, Crores, Rupees, Paise).
 */
function toIndianWords(n) {
  if (isNaN(n) || n === null || n === undefined) return '';
  const num = parseFloat(n);
  if (num === 0) return 'Zero Rupees Only';

  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convert(val) {
    if (val === 0) return '';
    if (val < 20) return a[val];
    if (val < 100) return b[Math.floor(val / 10)] + (val % 10 !== 0 ? ' ' + a[val % 10] : '');
    if (val < 1000) return a[Math.floor(val / 100)] + ' Hundred' + (val % 100 !== 0 ? ' ' + convert(val % 100) : '');
    if (val < 100000) return convert(Math.floor(val / 1000)) + ' Thousand' + (val % 1000 !== 0 ? ' ' + convert(val % 1000) : '');
    if (val < 10000000) return convert(Math.floor(val / 100000)) + ' Lakh' + (val % 100000 !== 0 ? ' ' + convert(val % 100000) : '');
    return convert(Math.floor(val / 10000000)) + ' Crore' + (val % 10000000 !== 0 ? ' ' + convert(val % 10000000) : '');
  }

  const intPart = Math.floor(Math.abs(num));
  const decPart = Math.round((Math.abs(num) - intPart) * 100);

  let words = convert(intPart).trim() + ' Rupees';
  if (decPart > 0) {
    words += ' and ' + convert(decPart).trim() + ' Paise';
  }
  return words + ' Only';
}

function generateInvoicePDF(invoice, client, agencySettings, dataCallback, endCallback) {
  const doc = new PDFDocument({ margin: 40, size: 'A4', autoFirstPage: true });
  
  if (typeof dataCallback === 'function') doc.on('data', dataCallback);
  if (typeof endCallback === 'function') doc.on('end', endCallback);

  const startX = 40;
  const endX = 555;
  const tableWidth = endX - startX; // 515pt

  const getStr = (val, defaultVal = '') => (val ? String(val) : defaultVal);

  const agencyName = agencySettings?.agency_name || process.env.COMPANY_NAME || 'EAGLE EYE SECURITY SERVICE';
  const agencyAddress = getStr(agencySettings?.agency_address, 'Office Adress:- 418, SHIVALIK SATYAMEV, BOPAL-AMBLI JUNCTION, AHMEDABAD-380058');
  const agencyPhone = getStr(agencySettings?.agency_phone, '8320931124');
  const agencyEmail = getStr(agencySettings?.agency_email, 'info@eagleeyesecuritygroup.in');
  const agencyGst = getStr(agencySettings?.gst_number, '24AVYPP2011K1ZB');
  const agencyPan = getStr(agencySettings?.pan_number, agencyGst.length >= 10 ? agencyGst.substring(2, 12) : 'AVYPP2011K');
  const hsnCode = getStr(agencySettings?.hsn_code, '998525');
  const jurisdictionCity = getStr(agencySettings?.jurisdiction_city, 'Ahmedabad');

  // Chosen Bank Details
  const bankName = invoice.bank_name || agencySettings?.bank_name || 'Indusind Bank';
  const bankAccNo = invoice.bank_account_number || agencySettings?.bank_account_number || '252528112019';
  const bankIfsc = invoice.bank_ifsc_code || agencySettings?.bank_ifsc || 'INDB0000676';
  const bankAccName = invoice.bank_account_name || agencyName;

  // Format Bill Date
  const invDate = new Date(invoice.invoice_date || Date.now());
  const formattedBillDate = isNaN(invDate.getTime())
    ? getStr(invoice.invoice_date)
    : `${invDate.getDate().toString().padStart(2, '0')}-${(invDate.getMonth() + 1).toString().padStart(2, '0')}-${invDate.getFullYear()}`;

  // Column definitions (8 columns total = 515pt)
  // 28 + 140 + 62 + 36 + 49 = 315pt (matches top split & bottom bank split!)
  const cols = [
    { name: 'No.', w: 28, align: 'center' },
    { name: 'Particular', w: 140, align: 'left' },
    { name: 'Per Day\nRate', w: 62, align: 'center' },
    { name: 'No.of', w: 36, align: 'center' },
    { name: 'Rate', w: 49, align: 'center' },
    { name: 'HSN\nCODE', w: 50, align: 'center' },
    { name: 'Total\nDay', w: 50, align: 'center' },
    { name: 'Amount', w: 100, align: 'right' }
  ];

  // Parse items
  const isAdhoc = Boolean(invoice.is_ad_hoc);
  const totalAmount = parseFloat(invoice.amount_subtotal) || 0;

  let billingDays = 1;
  if (invoice.billing_period_start && invoice.billing_period_end) {
    const bStart = new Date(invoice.billing_period_start);
    const bEnd = new Date(invoice.billing_period_end);
    billingDays = Math.max(1, Math.ceil((bEnd - bStart) / (1000 * 60 * 60 * 24)) + 1);
  }
  const totalDays = isAdhoc ? (invoice.duty_days_worked || 1) : billingDays;

  const guards = invoice.guards_count || client?.employee_count || 1;
  let monthlyVal = invoice.monthly_rate || client?.monthly_rate || 0;
  let rateVal = invoice.rate_per_day || client?.rate_per_day || 0;
  if (!rateVal && totalDays > 0 && totalAmount > 0) {
    rateVal = totalAmount / totalDays;
  }

  let items = [];
  if (invoice.bill_items) {
    try {
      items = typeof invoice.bill_items === 'string' ? JSON.parse(invoice.bill_items) : invoice.bill_items;
    } catch (e) {
      items = [];
    }
  }
  if (!Array.isArray(items) || items.length === 0) {
    items = [{
      particular: invoice.particular || (isAdhoc ? 'Bouncer / Guard' : 'Security Guard'),
      monthly_rate: monthlyVal,
      guards_count: guards,
      rate_per_day: rateVal,
      hsn_code: invoice.hsn_code || hsnCode || '998525',
      total_duty_days: invoice.total_duty_days || invoice.duty_days_worked || (guards * totalDays),
      amount: totalAmount
    }];
  }

  const isRcm = Boolean(invoice.is_rcm_applicable);
  const subtotal = parseFloat(invoice.amount_subtotal) || 0;
  const finalAmt = parseFloat(invoice.final_amount) || 0;
  const amountInWords = toIndianWords(finalAmt);

  // Logo helper
  function drawLogo() {
    if (agencySettings?.agency_logo_url) {
      const logoName = path.basename(agencySettings.agency_logo_url);
      const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
      const logoPath = path.join(uploadDir, logoName);
      if (fs.existsSync(logoPath)) {
        try {
          doc.image(logoPath, startX, 32, { fit: [75, 45], align: 'left', valign: 'top' });
        } catch(e) {
          logger.error('Failed to embed logo in invoice PDF:', e);
        }
      }
    }
  }

  // --- Helper: Draw Company Header (Page 1) ---
  function drawCompanyHeader() {
    drawLogo();
    doc.font('Times-Bold').fontSize(22).fillColor('#8B1E1E').text(agencyName, startX, 34, { width: tableWidth, align: 'center' });
    doc.font('Helvetica').fontSize(8.5).fillColor('#000000');
    doc.text(agencyAddress.replace(/\n/g, ', '), startX, doc.y + 2, { width: tableWidth, align: 'center' });
    doc.text(`MOBILE NO.${agencyPhone}`, startX, doc.y + 1.5, { width: tableWidth, align: 'center' });
    doc.text(`EMAIL.ID:- ${agencyEmail}`, startX, doc.y + 1.5, { width: tableWidth, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a365d');
    doc.text(`GST NO. ${agencyGst}`, startX, doc.y + 3, { width: tableWidth, align: 'center' });
    doc.text(`PAN NO. ${agencyPan}`, startX, doc.y + 1.5, { width: tableWidth, align: 'center' });
  }

  // --- Helper: Draw Continuation Header (Pages 2+) ---
  function drawContinuationHeader(pageNum, totalPages) {
    doc.font('Times-Bold').fontSize(14).fillColor('#8B1E1E').text(agencyName, startX, 32, { width: tableWidth, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000').text(
      `INVOICE NO. ${invoice.invoice_number}  |  BILL DATE: ${formattedBillDate}  (Continued — Page ${pageNum} of ${totalPages})`,
      startX,
      48,
      { width: tableWidth, align: 'center' }
    );
  }

  // --- Helper: Draw Top Party Info Grid (Page 1) ---
  function drawTopGrid(gridTop) {
    doc.lineWidth(1).strokeColor('#000000').fillColor('#000000');
    const gridHeight = 92;
    const splitX = startX + 315; // 355pt

    // Outer box
    doc.rect(startX, gridTop, tableWidth, gridHeight).stroke();
    // Vertical split
    doc.moveTo(splitX, gridTop).lineTo(splitX, gridTop + gridHeight).stroke();
    // Horizontal row lines:
    // Row 1 separator at +18
    doc.moveTo(startX, gridTop + 18).lineTo(endX, gridTop + 18).stroke();
    // Row 2 separator at +37 (line above Address & Invoice No)
    doc.moveTo(startX, gridTop + 37).lineTo(endX, gridTop + 37).stroke();
    // Row 3 separator at +73 (line below Address & Site Name, above GST NO & Bill Date)
    doc.moveTo(startX, gridTop + 73).lineTo(endX, gridTop + 73).stroke();

    // Row 1: Left PARTY NAME, Right INVOICE BILL
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000').text('PARTY NAME', startX + 6, gridTop + 4.5);
    doc.font('Helvetica-Bold').fontSize(10.5).text('INVOICE BILL', splitX, gridTop + 4, { width: endX - splitX, align: 'center' });

    // Row 2 Left: Client Name | Row 2 Right: RCM BILL
    const clientName = client?.name || invoice.client_name || 'Client Name';
    const displayClientName = clientName.endsWith('.') ? clientName : `${clientName}.`;
    doc.font('Helvetica-Bold').fontSize(10).text(displayClientName, startX + 6, gridTop + 22.5, { width: splitX - startX - 12 });
    doc.font('Helvetica-Bold').fontSize(11).text(`RCM BILL   ${isRcm ? 'YES' : 'NO'}`, splitX, gridTop + 22, { width: endX - splitX, align: 'center' });

    // Extract site name and clean address
    const rawAddress = [
      client?.address || invoice.client_address,
      client?.city || invoice.client_city,
      client?.state || invoice.client_state,
      client?.postal_code || invoice.postal_code
    ].filter(Boolean).join(', ');

    let detectedSiteName = invoice.site_name || invoice.site || '';
    if (!detectedSiteName && (invoice.notes || client?.notes)) {
      const noteStr = `${invoice.notes || ''} ${client?.notes || ''}`;
      const mNote = noteStr.match(/(?:Site\s*name\s*:\s*-?|Site\s*:\s*-?)\s*([^,\n\r]+)/i);
      if (mNote) detectedSiteName = mNote[1].trim();
    }
    if (!detectedSiteName && rawAddress) {
      const mAddr = rawAddress.match(/(?:Site\s*name\s*:\s*-?|Site\s*:\s*-?)\s*([^,\n\r]+)/i);
      if (mAddr) detectedSiteName = mAddr[1].trim();
    }

    // Clean address by stripping any embedded "Site name: ..." or "Site: ..."
    const cleanAddress = rawAddress
      .replace(/(?:^|\n|\r|,|\s)*(?:Site\s*name\s*:\s*-?|Site\s*:\s*-?)[^\n\r]+/gi, '')
      .trim()
      .replace(/^[,-\s]+|[,-\s]+$/g, '')
      .trim();

    // Row 3 Left: Client Address & Site Name (Below Address field!)
    if (cleanAddress) {
      drawFittedText(doc, cleanAddress, startX + 6, gridTop + 41, splitX - startX - 12, 8, 6.5, { lineGap: 1 });
    }
    if (detectedSiteName) {
      doc.font('Helvetica-Bold').fontSize(8.5);
      const sitePrefix = 'Site name: - ';
      const prefW = doc.widthOfString(sitePrefix);
      doc.text(sitePrefix, startX + 6, gridTop + 57.5);
      const maxSiteWidth = splitX - startX - 12 - prefW;
      drawFittedText(doc, detectedSiteName, startX + 6 + prefW, gridTop + 57.5, maxSiteWidth, 8.5, 6.5);
    }

    // Row 3 Right: INVOICE NO.
    doc.font('Helvetica-Bold').fontSize(8.5).text(`INVOICE NO. ${invoice.invoice_number}`, splitX + 8, gridTop + 41.5);

    // Row 4: Left GST NO, Right BILL DATE
    const clientGst = client?.gst_number || invoice.client_gst || 'N/A';
    doc.font('Helvetica-Bold').fontSize(8.5).text(`GST NO. ${clientGst}`, startX + 6, gridTop + 77);
    doc.font('Helvetica-Bold').fontSize(8.5).text(`BILL DATE: - ${formattedBillDate}`, splitX + 8, gridTop + 77);

    return gridTop + gridHeight;
  }

  // --- Helper: Draw Table Header ---
  function drawTableHeader(y) {
    const headerH = 26;
    doc.lineWidth(1).strokeColor('#000000').rect(startX, y, tableWidth, headerH).stroke();

    let curX = startX;
    cols.forEach((col, i) => {
      if (i > 0) {
        doc.moveTo(curX, y).lineTo(curX, y + headerH).stroke();
      }
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000000');
      const isMultiLine = col.name.includes('\n');
      const textY = isMultiLine ? y + 3.5 : y + 8;
      doc.text(col.name, curX, textY, { width: col.w, align: col.align || 'center' });
      curX += col.w;
    });

    return y + headerH;
  }

  // --- Helper: Draw Bottom Summary Box & Footer Notes ---
  function drawBottomSummaryBox(bottomTop) {
    const bottomH = 96;
    const splitX = startX + 315; // 355pt
    const wordsLineY = bottomTop + 76;

    doc.lineWidth(1).strokeColor('#000000').fillColor('#000000');
    // Outer box
    doc.rect(startX, bottomTop, tableWidth, bottomH).stroke();

    // Full-width horizontal line above "Rs in word:-"
    doc.moveTo(startX, wordsLineY).lineTo(endX, wordsLineY).stroke();

    // Vertical line separating Bank Details and Totals (stops at wordsLineY)
    doc.moveTo(splitX, bottomTop).lineTo(splitX, wordsLineY).stroke();

    // --- Left: Bank Details ---
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000');
    doc.text('Bank Details:-', startX + 6, bottomTop + 4.5);
    doc.text(`NAME:- ${bankAccName}`, startX + 6, bottomTop + 17);
    doc.text(`A/c No. ${bankAccNo}`, startX + 6, bottomTop + 29.5);
    doc.text(`Bank Name :- ${bankName}`, startX + 6, bottomTop + 42);
    doc.text(`IFSC Code:s- ${bankIfsc}`, startX + 6, bottomTop + 54.5);

    // --- Right: Totals Mini-Table with vertical & horizontal dividers ---
    const totalsDividerX = splitX + 85; // separates label and amount
    // Vertical line between label and amount
    doc.moveTo(totalsDividerX, bottomTop).lineTo(totalsDividerX, wordsLineY).stroke();

    // Horizontal lines between rows
    doc.moveTo(splitX, bottomTop + 19).lineTo(endX, bottomTop + 19).stroke();
    doc.moveTo(splitX, bottomTop + 38).lineTo(endX, bottomTop + 38).stroke();
    doc.moveTo(splitX, bottomTop + 57).lineTo(endX, bottomTop + 57).stroke();

    const labelW = totalsDividerX - splitX - 6;
    const amtW = endX - totalsDividerX - 6;

    // Row 1: TOTAL
    doc.font('Helvetica-Bold').fontSize(8.5).text('TOTAL', splitX + 6, bottomTop + 5, { width: labelW });
    drawFittedText(doc, subtotal.toFixed(2), totalsDividerX, bottomTop + 5, amtW, 8.5, 6.5, { align: 'right' });

    // Row 2: SGST 9% (or IGST)
    const isIgst = invoice.tax_type === 'igst';
    const sgstLabel = isIgst ? 'IGST 18%' : 'SGST 9%';
    const sgstAmt = (!isRcm && invoice.tax_type === 'cgst_sgst' && invoice.sgst_amount > 0)
      ? parseFloat(invoice.sgst_amount).toFixed(2)
      : (isIgst && invoice.igst_amount > 0 ? parseFloat(invoice.igst_amount).toFixed(2) : '');
    
    doc.font('Helvetica-Bold').fontSize(8.5).text(sgstLabel, splitX + 6, bottomTop + 24, { width: labelW });
    if (sgstAmt) {
      drawFittedText(doc, sgstAmt, totalsDividerX, bottomTop + 24, amtW, 8.5, 6.5, { align: 'right' });
    }

    // Row 3: CGST 9%
    const cgstLabel = 'CGST 9%';
    const cgstAmt = (!isRcm && invoice.tax_type === 'cgst_sgst' && invoice.cgst_amount > 0)
      ? parseFloat(invoice.cgst_amount).toFixed(2)
      : '';
    
    doc.font('Helvetica-Bold').fontSize(8.5).text(cgstLabel, splitX + 6, bottomTop + 43, { width: labelW });
    if (cgstAmt) {
      drawFittedText(doc, cgstAmt, totalsDividerX, bottomTop + 43, amtW, 8.5, 6.5, { align: 'right' });
    }

    // Row 4: GROUND TOTAL
    doc.font('Helvetica-Bold').fontSize(8.5).text('GROUND TOTAL', splitX + 6, bottomTop + 62, { width: labelW });
    drawFittedText(doc, finalAmt.toFixed(2), totalsDividerX, bottomTop + 62, amtW, 9, 6.5, { align: 'right' });

    // --- Full-Width Row: Amount in Words ---
    doc.font('Helvetica-Bold').fontSize(8.5);
    const prefix = 'Rs in word:- ';
    const pWidth = doc.widthOfString(prefix);
    doc.text(prefix, startX + 6, wordsLineY + 5.5);
    drawFittedText(doc, amountInWords, startX + 6 + pWidth + 2, wordsLineY + 5.5, tableWidth - 14 - pWidth, 8.5, 6.5, { align: 'left' });

    // --- Outside Below Box: Footer Note & Jurisdiction ---
    const footerY = bottomTop + bottomH + 5;
    doc.font('Helvetica-Bold').fontSize(8.5).text(`Note:- Subject to ${jurisdictionCity} Jurisdiction Only.`, startX + 2, footerY);
    doc.font('Helvetica-Bold').fontSize(8.5).text(`For, ${agencyName}`, startX, footerY, { width: tableWidth - 2, align: 'right' });
  }

  // =========================================================================
  // PAGINATION & RENDERING ENGINE
  // Handles:
  // - Single page when items <= 7 (matches benchmark image 100%)
  // - Multi-page when items > 7 (e.g. 9 or 15 items, split cleanly across pages)
  // - Auto-scaling text for big amounts so numbers never spill or wrap
  // =========================================================================

  const PAGE_1_MAX = 7;
  const SUB_PAGE_MAX = 16;

  if (items.length <= PAGE_1_MAX) {
    // SINGLE PAGE INVOICE
    drawCompanyHeader();
    const gridTop = doc.y + 10;
    const tableTop = drawTopGrid(gridTop);
    const dataTop = drawTableHeader(tableTop);

    // Height of items block: matches benchmark photo filler vertical lines when rows <= 4
    const rowHeight = 22;
    const minTableHeight = 140;
    const tableBlockHeight = Math.max(minTableHeight, items.length * rowHeight);

    doc.lineWidth(1).strokeColor('#000000').rect(startX, dataTop, tableWidth, tableBlockHeight).stroke();

    // Continuous vertical column divider lines
    let curX = startX;
    cols.forEach((col, i) => {
      if (i > 0) {
        doc.moveTo(curX, dataTop).lineTo(curX, dataTop + tableBlockHeight).stroke();
      }
      curX += col.w;
    });

    // Draw Data Rows
    items.forEach((it, idx) => {
      const rowY = dataTop + (idx * rowHeight);
      let cellX = startX;

      // Col 1: No.
      doc.font('Helvetica').fontSize(8.5).fillColor('#000000');
      doc.text(String(idx + 1).padStart(2, '0'), cellX, rowY + 5, { width: cols[0].w, align: 'center' });
      cellX += cols[0].w;

      // Col 2: Particular
      doc.text(it.particular || 'Security Guard', cellX + 4, rowY + 5, { width: cols[1].w - 8, align: 'left' });
      cellX += cols[1].w;

      // Col 3: Per Day Rate (Monthly rate)
      const mRate = parseFloat(it.monthly_rate);
      const mStr = mRate > 0 ? `${Math.round(mRate)}/-` : '';
      doc.text(mStr, cellX, rowY + 5, { width: cols[2].w, align: 'center' });
      cellX += cols[2].w;

      // Col 4: No.of
      const gCount = parseInt(it.guards_count) || 1;
      doc.text(String(gCount).padStart(2, '0'), cellX, rowY + 5, { width: cols[3].w, align: 'center' });
      cellX += cols[3].w;

      // Col 5: Rate
      const dRate = parseFloat(it.rate_per_day);
      const rStr = dRate > 0 ? dRate.toFixed(2) : '';
      drawFittedText(doc, rStr, cellX, rowY + 5, cols[4].w, 8.5, 6.5, { align: 'center' });
      cellX += cols[4].w;

      // Col 6: HSN CODE
      doc.text(it.hsn_code || hsnCode || '998525', cellX, rowY + 5, { width: cols[5].w, align: 'center' });
      cellX += cols[5].w;

      // Col 7: Total Day
      doc.text(String(it.total_duty_days ?? ''), cellX, rowY + 5, { width: cols[6].w, align: 'center' });
      cellX += cols[6].w;

      // Col 8: Amount (Auto-scaled for big amount edge cases)
      const itAmt = parseFloat(it.amount) || 0;
      doc.font('Helvetica-Bold');
      drawFittedText(doc, itAmt.toFixed(2), cellX, rowY + 5, cols[7].w - 4, 8.5, 6.5, { align: 'right' });

      // Subtle horizontal divider between data rows
      if (idx < items.length - 1) {
        doc.lineWidth(0.5).strokeColor('#cccccc');
        doc.moveTo(startX, rowY + rowHeight).lineTo(endX, rowY + rowHeight).stroke();
      }
    });

    // Draw Bottom Section
    drawBottomSummaryBox(dataTop + tableBlockHeight);

  } else {
    // MULTI-PAGE INVOICE (for 9, 15+ employees/categories)
    const page1Items = items.slice(0, PAGE_1_MAX);
    const remainingItems = items.slice(PAGE_1_MAX);
    const subsequentPagesCount = Math.ceil(remainingItems.length / SUB_PAGE_MAX);
    const totalPages = 1 + subsequentPagesCount;

    // --- PAGE 1 ---
    drawCompanyHeader();
    const gridTop = doc.y + 10;
    const tableTop = drawTopGrid(gridTop);
    const dataTop = drawTableHeader(tableTop);

    const rowHeight = 22;
    const page1TableHeight = page1Items.length * rowHeight + 10;

    doc.lineWidth(1).strokeColor('#000000').rect(startX, dataTop, tableWidth, page1TableHeight).stroke();

    let curX = startX;
    cols.forEach((col, i) => {
      if (i > 0) {
        doc.moveTo(curX, dataTop).lineTo(curX, dataTop + page1TableHeight).stroke();
      }
      curX += col.w;
    });

    page1Items.forEach((it, idx) => {
      const rowY = dataTop + (idx * rowHeight);
      let cellX = startX;

      doc.font('Helvetica').fontSize(8.5).fillColor('#000000');
      doc.text(String(idx + 1).padStart(2, '0'), cellX, rowY + 5, { width: cols[0].w, align: 'center' });
      cellX += cols[0].w;

      doc.text(it.particular || 'Security Guard', cellX + 4, rowY + 5, { width: cols[1].w - 8, align: 'left' });
      cellX += cols[1].w;

      const mRate = parseFloat(it.monthly_rate);
      const mStr = mRate > 0 ? `${Math.round(mRate)}/-` : '';
      doc.text(mStr, cellX, rowY + 5, { width: cols[2].w, align: 'center' });
      cellX += cols[2].w;

      const gCount = parseInt(it.guards_count) || 1;
      doc.text(String(gCount).padStart(2, '0'), cellX, rowY + 5, { width: cols[3].w, align: 'center' });
      cellX += cols[3].w;

      const dRate = parseFloat(it.rate_per_day);
      const rStr = dRate > 0 ? dRate.toFixed(2) : '';
      drawFittedText(doc, rStr, cellX, rowY + 5, cols[4].w, 8.5, 6.5, { align: 'center' });
      cellX += cols[4].w;

      doc.text(it.hsn_code || hsnCode || '998525', cellX, rowY + 5, { width: cols[5].w, align: 'center' });
      cellX += cols[5].w;

      doc.text(String(it.total_duty_days ?? ''), cellX, rowY + 5, { width: cols[6].w, align: 'center' });
      cellX += cols[6].w;

      const itAmt = parseFloat(it.amount) || 0;
      doc.font('Helvetica-Bold');
      drawFittedText(doc, itAmt.toFixed(2), cellX, rowY + 5, cols[7].w - 4, 8.5, 6.5, { align: 'right' });

      if (idx < page1Items.length - 1) {
        doc.lineWidth(0.5).strokeColor('#cccccc');
        doc.moveTo(startX, rowY + rowHeight).lineTo(endX, rowY + rowHeight).stroke();
      }
    });

    // Continuation notice at bottom of Page 1
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000');
    doc.text(`(Continued on Page 2...)`, startX, dataTop + page1TableHeight + 6, { width: tableWidth, align: 'right' });

    // --- SUBSEQUENT PAGES ---
    for (let p = 0; p < subsequentPagesCount; p++) {
      doc.addPage();
      const pageNum = 2 + p;
      const isLastPage = (pageNum === totalPages);
      const pageChunk = remainingItems.slice(p * SUB_PAGE_MAX, (p + 1) * SUB_PAGE_MAX);

      drawContinuationHeader(pageNum, totalPages);
      const subTableTop = 64;
      const subDataTop = drawTableHeader(subTableTop);

      const subTableHeight = isLastPage
        ? Math.max(70, pageChunk.length * rowHeight + 10)
        : pageChunk.length * rowHeight + 10;

      doc.lineWidth(1).strokeColor('#000000').rect(startX, subDataTop, tableWidth, subTableHeight).stroke();

      let subCurX = startX;
      cols.forEach((col, i) => {
        if (i > 0) {
          doc.moveTo(subCurX, subDataTop).lineTo(subCurX, subDataTop + subTableHeight).stroke();
        }
        subCurX += col.w;
      });

      pageChunk.forEach((it, idx) => {
        const itemGlobalIndex = PAGE_1_MAX + (p * SUB_PAGE_MAX) + idx;
        const rowY = subDataTop + (idx * rowHeight);
        let cellX = startX;

        doc.font('Helvetica').fontSize(8.5).fillColor('#000000');
        doc.text(String(itemGlobalIndex + 1).padStart(2, '0'), cellX, rowY + 5, { width: cols[0].w, align: 'center' });
        cellX += cols[0].w;

        doc.text(it.particular || 'Security Guard', cellX + 4, rowY + 5, { width: cols[1].w - 8, align: 'left' });
        cellX += cols[1].w;

        const mRate = parseFloat(it.monthly_rate);
        const mStr = mRate > 0 ? `${Math.round(mRate)}/-` : '';
        doc.text(mStr, cellX, rowY + 5, { width: cols[2].w, align: 'center' });
        cellX += cols[2].w;

        const gCount = parseInt(it.guards_count) || 1;
        doc.text(String(gCount).padStart(2, '0'), cellX, rowY + 5, { width: cols[3].w, align: 'center' });
        cellX += cols[3].w;

        const dRate = parseFloat(it.rate_per_day);
        const rStr = dRate > 0 ? dRate.toFixed(2) : '';
        drawFittedText(doc, rStr, cellX, rowY + 5, cols[4].w, 8.5, 6.5, { align: 'center' });
        cellX += cols[4].w;

        doc.text(it.hsn_code || hsnCode || '998525', cellX, rowY + 5, { width: cols[5].w, align: 'center' });
        cellX += cols[5].w;

        doc.text(String(it.total_duty_days ?? ''), cellX, rowY + 5, { width: cols[6].w, align: 'center' });
        cellX += cols[6].w;

        const itAmt = parseFloat(it.amount) || 0;
        doc.font('Helvetica-Bold');
        drawFittedText(doc, itAmt.toFixed(2), cellX, rowY + 5, cols[7].w - 4, 8.5, 6.5, { align: 'right' });

        if (idx < pageChunk.length - 1) {
          doc.lineWidth(0.5).strokeColor('#cccccc');
          doc.moveTo(startX, rowY + rowHeight).lineTo(endX, rowY + rowHeight).stroke();
        }
      });

      if (isLastPage) {
        // Draw the complete Bottom Summary Box on final page
        drawBottomSummaryBox(subDataTop + subTableHeight);
      } else {
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000');
        doc.text(`(Continued on Page ${pageNum + 1}...)`, startX, subDataTop + subTableHeight + 6, { width: tableWidth, align: 'right' });
      }
    }
  }

  doc.end();
  return doc;
}

module.exports = {
  generateInvoicePDF
};
