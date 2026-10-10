// Shared Excel / PDF download for simple tabular reports (vouchers, bank
// reconciliation, BRS). One "report" = a title, subtitle lines, and one or
// more sections of { name, columns, rows, totalsRow }. Row values are raw:
// numbers stay numbers in Excel (money columns get a 2-decimal format) and are
// formatted en-IN for the PDF.
const ExcelJS = require('exceljs');
const { query } = require('../database/connection');
const { generateMultiSectionReportPDF } = require('./paymentsPdfGenerator');

async function getAgencySettings() {
  try {
    const r = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'");
    return r.rows.length > 0 ? JSON.parse(r.rows[0].setting_value) : null;
  } catch (_) {
    return null;
  }
}

const fmtMoney = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function pdfValue(col, v) {
  if (v === null || v === undefined || v === '') return '';
  if (col.money && typeof v === 'number') return fmtMoney(v);
  return String(v);
}

// Spreadsheet formula injection guard: text starting with = + - @ is executed
// by Excel, so prefix it with a quote (numbers are left alone).
function excelValue(v) {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return `'${v}`;
  return v === undefined ? null : v;
}

async function sendPdf(res, { filename, title, subtitleLines = [], sections }) {
  const agencySettings = await getAgencySettings();
  const pdfSections = sections.map((s) => ({
    name: s.name,
    columns: s.columns.map((c) => ({ key: c.key, label: c.label, width: c.width, align: c.money ? 'right' : c.align })),
    rows: s.rows.map((r) => Object.fromEntries(s.columns.map((c) => [c.key, pdfValue(c, r[c.key])]))),
    totalsRow: s.totalsRow ? Object.fromEntries(s.columns.map((c) => [c.key, pdfValue(c, s.totalsRow[c.key])])) : undefined,
  }));
  const chunks = [];
  await new Promise((resolve, reject) => {
    try {
      generateMultiSectionReportPDF(
        { title, subtitleLines, sections: pdfSections, agencySettings },
        (chunk) => chunks.push(chunk),
        resolve
      );
    } catch (e) {
      reject(e);
    }
  });
  const pdfBuffer = Buffer.concat(chunks);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', pdfBuffer.length);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  res.end(pdfBuffer);
}

async function sendExcel(res, { filename, title, subtitleLines = [], sections, sheetName = 'Report' }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Security Firm Software';
  workbook.created = new Date();
  const ws = workbook.addWorksheet(sheetName.slice(0, 31));

  const maxCols = Math.max(...sections.map((s) => s.columns.length), 1);
  const titleRow = ws.addRow([title]);
  titleRow.font = { bold: true, size: 14 };
  ws.mergeCells(titleRow.number, 1, titleRow.number, maxCols);
  subtitleLines.forEach((line) => {
    const r = ws.addRow([line]);
    r.font = { italic: true, color: { argb: 'FF555555' } };
    ws.mergeCells(r.number, 1, r.number, maxCols);
  });

  const widths = new Array(maxCols).fill(12);
  sections.forEach((s) => {
    ws.addRow([]);
    if (s.name) {
      const nameRow = ws.addRow([s.name]);
      nameRow.font = { bold: true, color: { argb: 'FF0F766E' } };
    }
    const header = ws.addRow(s.columns.map((c) => c.label));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };
    });
    const addDataRow = (r, bold) => {
      const row = ws.addRow(s.columns.map((c) => excelValue(r[c.key])));
      s.columns.forEach((c, i) => {
        if (c.money) row.getCell(i + 1).numFmt = '#,##0.00';
      });
      if (bold) row.font = { bold: true };
    };
    s.rows.forEach((r) => addDataRow(r, false));
    if (s.totalsRow) addDataRow(s.totalsRow, true);
    s.columns.forEach((c, i) => {
      widths[i] = Math.max(widths[i], c.excelWidth || Math.min(45, Math.max(String(c.label).length + 4, 12)));
    });
  });
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

// format = 'pdf' | 'xlsx' (also accepts 'excel')
async function sendReport(res, format, report) {
  if (format === 'pdf') return sendPdf(res, report);
  return sendExcel(res, report);
}

module.exports = { sendReport, sendPdf, sendExcel, getAgencySettings };
