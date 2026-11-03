// Shared "classic Tally printout" PDF style, used by Trial Balance, Bank
// Report and Cash Report so all three look the same: centered company
// letterhead, bold title + date range, "Page N" top-right, a single bordered
// table, bold group/total rows, and a bold Grand Total row closed off by a
// double top border — matching docs/TrialBal.pdf exactly.
const PDFDocument = require('pdfkit');

const fmt = (n) => {
  const num = Number(n) || 0;
  if (num === 0) return '';
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * @param {object} opts
 * @param {object} opts.companyProfile  { agency_name, agency_address, agency_email }
 * @param {string} opts.title  e.g. "Trial Balance", "Bank Book", "Cash Book"
 * @param {string} opts.subtitle  e.g. "1-Apr-26 to 30-Sep-26" or an account name line
 * @param {{key:string,label:string,width:number,align?:string}[]} opts.columns  first column is the particulars/label column
 * @param {{type:'group'|'detail'|'total', indent?:number, values:Record<string,string|number>, bold?:boolean}[]} opts.rows
 * @param {string} [opts.groupHeader]  e.g. "Closing Balance" — spans every column after the first (Particulars) as a merged label above the Debit/Credit header row, matching the sample's two-row header.
 */
function generateTallyStylePDF({ companyProfile, title, subtitle, columns, rows, groupHeader }, dataCallback, endCallback) {
  const doc = new PDFDocument({ margin: 40, size: 'A4', autoFirstPage: true });
  if (typeof dataCallback === 'function') doc.on('data', dataCallback);
  if (typeof endCallback === 'function') doc.on('end', endCallback);

  const startX = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  let pageNum = 1;

  const agencyName = companyProfile?.agency_name || 'Company';
  const agencyAddress = companyProfile?.agency_address || '';
  const agencyEmail = companyProfile?.agency_email || '';

  function drawPageNumber() {
    doc.font('Helvetica').fontSize(8).fillColor('#000').text(`Page ${pageNum}`, startX, 38, { width: pageWidth, align: 'right' });
  }

  function drawHeader() {
    let y = 38;
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000').text(agencyName.toUpperCase(), startX, y, { width: pageWidth, align: 'center' });
    y = doc.y + 1;
    if (agencyAddress) {
      doc.font('Helvetica').fontSize(8.5).text(agencyAddress.replace(/\n/g, ', '), startX, y, { width: pageWidth, align: 'center' });
      y = doc.y + 1;
    }
    if (agencyEmail) {
      const label = `E-Mail : ${agencyEmail}`;
      doc.font('Helvetica').fontSize(8.5).text(label, startX, y, { width: pageWidth, align: 'center' });
      const w = doc.widthOfString(label);
      const lineY = doc.y + 1;
      doc.moveTo(startX + (pageWidth - w) / 2, lineY).lineTo(startX + (pageWidth + w) / 2, lineY).lineWidth(0.5).strokeColor('#000').stroke();
      y = lineY + 6;
    } else {
      y += 6;
    }
    doc.font('Helvetica-Bold').fontSize(11).text(title, startX, y, { width: pageWidth, align: 'center' });
    y = doc.y + 2;
    if (subtitle) {
      doc.font('Helvetica').fontSize(8.5).text(subtitle, startX, y, { width: pageWidth, align: 'center' });
      y = doc.y + 6;
    } else {
      y += 6;
    }
    return y;
  }

  const colWidths = (() => {
    const totalWeight = columns.reduce((s, c) => s + (c.width || 1), 0);
    return columns.map((c) => (pageWidth * (c.width || 1)) / totalWeight);
  })();

  function drawTableHeader(y) {
    const h = 16;
    doc.lineWidth(0.75).strokeColor('#000');
    doc.moveTo(startX, y).lineTo(startX + pageWidth, y).stroke();

    if (groupHeader) {
      const restWidth = pageWidth - colWidths[0];
      doc.font('Helvetica-Bold').fontSize(8);
      doc.text(groupHeader, startX + colWidths[0], y + 3, { width: restWidth, align: 'center', lineBreak: false });
      y += h;
      doc.moveTo(startX, y).lineTo(startX + pageWidth, y).stroke();
    }

    let x = startX;
    doc.font('Helvetica-Bold').fontSize(8);
    columns.forEach((c, i) => {
      doc.text(truncateToWidth(c.label, colWidths[i] - 4), x + 2, y + 3, { width: colWidths[i] - 4, align: c.align || 'left', lineBreak: false });
      x += colWidths[i];
    });
    y += h;
    doc.moveTo(startX, y).lineTo(startX + pageWidth, y).stroke();
    return y;
  }

  function drawRow(y, row) {
    const rowH = 15;
    const indent = (row.indent || 0) * 10;
    doc.font(row.bold ? 'Helvetica-Bold' : (row.italic ? 'Helvetica-Oblique' : 'Helvetica')).fontSize(8.5).fillColor('#000');
    let x = startX;
    columns.forEach((c, i) => {
      const val = row.values[c.key];
      const text = c.money ? fmt(val) : String(val ?? '');
      const cellX = i === 0 ? x + 2 + indent : x + 2;
      const cellW = i === 0 ? colWidths[i] - 4 - indent : colWidths[i] - 4;
      doc.text(truncateToWidth(text, cellW), cellX, y + 2, { width: cellW, align: c.align || (i === 0 ? 'left' : 'right'), lineBreak: false });
      x += colWidths[i];
    });
    return y + rowH;
  }

  function truncateToWidth(text, maxWidth) {
    let str = String(text ?? '');
    if (doc.widthOfString(str) <= maxWidth) return str;
    while (str.length > 1 && doc.widthOfString(str + '…') > maxWidth) {
      str = str.slice(0, -1);
    }
    return str + '…';
  }

  let y = drawHeader();
  drawPageNumber();
  y = drawTableHeader(y);

  const ensureSpace = () => {
    if (y + 20 > bottomLimit) {
      doc.addPage();
      pageNum += 1;
      y = drawHeader();
      drawPageNumber();
      y = drawTableHeader(y);
    }
  };

  rows.forEach((row) => {
    ensureSpace();
    if (row.type === 'total') {
      // Grand total gets a rule above it, like the sample's line before the totals row.
      doc.lineWidth(1).strokeColor('#000').moveTo(startX, y).lineTo(startX + pageWidth, y).stroke();
    }
    y = drawRow(y, { ...row, bold: row.type !== 'detail' });
  });
  doc.lineWidth(0.75).strokeColor('#000').moveTo(startX, y).lineTo(startX + pageWidth, y).stroke();

  doc.end();
  return doc;
}

module.exports = { generateTallyStylePDF };
