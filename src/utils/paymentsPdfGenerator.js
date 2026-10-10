/**
 * src/utils/paymentsPdfGenerator.js
 *
 * Generic tabular report PDF generator (pdfkit), shared by:
 *  - the Payments register (any combination of client/vendor/employee types)
 *  - the GST bifurcation report (client or vendor)
 *  - the TDS report (client or vendor)
 * One layout engine instead of three near-identical ones.
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const logger = require('./logger.js');

function drawLogoIfEnabled(doc, agencySettings, x, y) {
  if (agencySettings?.logo_locations?.invoice === false) return;
  if (!agencySettings?.agency_logo_url) return;
  try {
    const storageConfig = require('./storageConfig');
    const logoName = path.basename(agencySettings.agency_logo_url);
    let logoPath = path.join(storageConfig.getActiveUploadDir(), logoName);
    if (!fs.existsSync(logoPath)) logoPath = path.join(storageConfig.getDefaultUploadDir(), logoName);
    if (fs.existsSync(logoPath)) doc.image(logoPath, x, y, { fit: [70, 40] });
  } catch (e) {
    logger.error('Failed to embed logo in report PDF:', e);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string[]} [opts.subtitleLines]
 * @param {{key:string,label:string,width?:number,align?:string}[]} opts.columns
 * @param {object[]} opts.rows - plain objects keyed by column.key (pre-formatted strings)
 * @param {object} [opts.totalsRow] - same shape as a row, rendered bold with a rule above it
 * @param {object} [opts.agencySettings]
 */
function generateTabularReportPDF({ title, subtitleLines = [], columns, rows, totalsRow, agencySettings }, dataCallback, endCallback) {
  const landscape = columns.length > 6;
  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: landscape ? 'landscape' : 'portrait', autoFirstPage: true });
  if (typeof dataCallback === 'function') doc.on('data', dataCallback);
  if (typeof endCallback === 'function') doc.on('end', endCallback);

  const agencyName = agencySettings?.agency_name || process.env.COMPANY_NAME || 'EAGLE EYE SECURITY SERVICE';
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;
  const bottomLimit = doc.page.height - doc.page.margins.bottom;

  drawLogoIfEnabled(doc, agencySettings, startX, 30);
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#8B1E1E').text(agencyName, startX, 30, { width: pageWidth, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#1a365d').text(title, startX, 52, { width: pageWidth, align: 'center' });

  let y = 70;
  doc.font('Helvetica').fontSize(8.5).fillColor('#555');
  subtitleLines.forEach((line) => {
    doc.text(line, startX, y, { width: pageWidth, align: 'center' });
    y += 12;
  });

  y += 6;
  doc.moveTo(startX, y).lineTo(startX + pageWidth, y).strokeColor('#94a3b8').lineWidth(1).stroke();
  y += 8;

  const totalWeight = columns.reduce((s, c) => s + (c.width || 1), 0);
  const colPx = columns.map((c) => (pageWidth * (c.width || 1)) / totalWeight);
  const rowHeight = 16;

  function ensureSpace() {
    if (y + rowHeight > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
    }
  }

  // pdfkit's ellipsis option only truncates when a `height` is also given —
  // without it, long cell text wraps onto multiple lines and bleeds into the
  // row below. Truncating manually keeps every row a fixed single-line height.
  function truncateToWidth(text, maxWidth) {
    let str = String(text ?? '');
    if (doc.widthOfString(str) <= maxWidth) return str;
    while (str.length > 1 && doc.widthOfString(str + '…') > maxWidth) {
      str = str.slice(0, -1);
    }
    return str + '…';
  }

  function drawRow(values, opts = {}) {
    ensureSpace();
    let x = startX;
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(opts.color || '#111827');
    columns.forEach((col, i) => {
      const cellWidth = colPx[i] - 4;
      const text = truncateToWidth(values[i], cellWidth);
      doc.text(text, x + 2, y + 2, { width: cellWidth, align: col.align || 'left', lineBreak: false });
      x += colPx[i];
    });
    y += rowHeight;
  }

  // Header row
  doc.rect(startX, y - 2, pageWidth, rowHeight).fill('#f1f5f9');
  drawRow(columns.map((c) => c.label), { bold: true, color: '#334155' });
  doc.moveTo(startX, y).lineTo(startX + pageWidth, y).strokeColor('#cbd5e1').lineWidth(0.5).stroke();

  rows.forEach((r) => drawRow(columns.map((c) => r[c.key])));

  if (totalsRow) {
    ensureSpace();
    y += 3;
    doc.moveTo(startX, y).lineTo(startX + pageWidth, y).strokeColor('#334155').lineWidth(1).stroke();
    y += 3;
    drawRow(columns.map((c) => totalsRow[c.key]), { bold: true });
  }

  // Keep the "generated at" note safely inside the printable area — writing
  // past the bottom margin (even by a few points) can trigger pdfkit to
  // silently start a new page for it, leaving a spurious blank trailing page.
  y += 10;
  if (y + 12 <= bottomLimit) {
    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8')
      .text(`Generated ${new Date().toLocaleString('en-IN')}`, startX, y, { width: pageWidth, align: 'center' });
  }

  doc.end();
}

/**
 * Same look-and-feel as generateTabularReportPDF, but for a report made of
 * several independently-shaped tables in one document (e.g. a GSTR-1 filing's
 * B2B / B2CS / B2CL / HSN breakdown) — one PDFDocument, one title block, each
 * section gets its own heading + column set, empty sections are skipped.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string[]} [opts.subtitleLines]
 * @param {{name:string, columns:{key:string,label:string,width?:number,align?:string}[], rows:object[], totalsRow?:object}[]} opts.sections
 *   totalsRow (optional) is drawn bold with a rule above it, like the tabular report.
 * @param {object} [opts.agencySettings]
 */
function generateMultiSectionReportPDF({ title, subtitleLines = [], sections, agencySettings }, dataCallback, endCallback) {
  const landscape = sections.some((s) => s.columns.length > 6);
  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: landscape ? 'landscape' : 'portrait', autoFirstPage: true });
  if (typeof dataCallback === 'function') doc.on('data', dataCallback);
  if (typeof endCallback === 'function') doc.on('end', endCallback);

  const agencyName = agencySettings?.agency_name || process.env.COMPANY_NAME || 'EAGLE EYE SECURITY SERVICE';
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;
  const bottomLimit = doc.page.height - doc.page.margins.bottom;

  drawLogoIfEnabled(doc, agencySettings, startX, 30);
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#8B1E1E').text(agencyName, startX, 30, { width: pageWidth, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#1a365d').text(title, startX, 52, { width: pageWidth, align: 'center' });

  let y = 70;
  doc.font('Helvetica').fontSize(8.5).fillColor('#555');
  subtitleLines.forEach((line) => {
    doc.text(line, startX, y, { width: pageWidth, align: 'center' });
    y += 12;
  });
  y += 10;

  const rowHeight = 16;
  function ensureSpace(extra = 0) {
    if (y + rowHeight + extra > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
    }
  }
  function truncateToWidth(text, maxWidth) {
    let str = String(text ?? '');
    if (doc.widthOfString(str) <= maxWidth) return str;
    while (str.length > 1 && doc.widthOfString(str + '…') > maxWidth) {
      str = str.slice(0, -1);
    }
    return str + '…';
  }

  const nonEmptySections = sections.filter((s) => s.rows.length > 0);
  if (nonEmptySections.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#94a3b8').text('No data for this period.', startX, y);
  }

  nonEmptySections.forEach((section) => {
    ensureSpace(30);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f766e').text(section.name, startX, y, { width: pageWidth });
    y += 16;

    const totalWeight = section.columns.reduce((s, c) => s + (c.width || 1), 0);
    const colPx = section.columns.map((c) => (pageWidth * (c.width || 1)) / totalWeight);

    function drawRow(values, opts = {}) {
      ensureSpace();
      let x = startX;
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(opts.color || '#111827');
      section.columns.forEach((col, i) => {
        const cellWidth = colPx[i] - 4;
        const text = truncateToWidth(values[i], cellWidth);
        doc.text(text, x + 2, y + 2, { width: cellWidth, align: col.align || 'left', lineBreak: false });
        x += colPx[i];
      });
      y += rowHeight;
    }

    doc.rect(startX, y - 2, pageWidth, rowHeight).fill('#f1f5f9');
    drawRow(section.columns.map((c) => c.label), { bold: true, color: '#334155' });
    doc.moveTo(startX, y).lineTo(startX + pageWidth, y).strokeColor('#cbd5e1').lineWidth(0.5).stroke();

    section.rows.forEach((r) => drawRow(section.columns.map((c) => r[c.key])));
    if (section.totalsRow) {
      doc.moveTo(startX, y).lineTo(startX + pageWidth, y).strokeColor('#94a3b8').lineWidth(0.75).stroke();
      drawRow(section.columns.map((c) => section.totalsRow[c.key]), { bold: true });
    }
    y += 14;
  });

  y += 6;
  if (y + 12 <= bottomLimit) {
    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8')
      .text(`Generated ${new Date().toLocaleString('en-IN')}`, startX, y, { width: pageWidth, align: 'center' });
  }

  doc.end();
}

module.exports = { generateTabularReportPDF, generateMultiSectionReportPDF };
