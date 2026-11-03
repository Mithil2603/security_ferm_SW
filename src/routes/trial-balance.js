const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { authMiddleware, requirePermission, requireCompanyContext } = require('../middleware/auth');
const { logError } = require('../utils/errorLogger');
const { buildTrialBalance } = require('../utils/trialBalance');
const { getCompanyProfile } = require('../utils/companyProfile');
const { generateTallyStylePDF } = require('../utils/tallyReportPdf');
const { sendExcel } = require('../utils/tableExport');

router.use(authMiddleware);
router.use(requireCompanyContext);
router.use(requirePermission('view_balance_sheet', 'view_reports'));

const formatDateLong = (dateStr) => {
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }).replace(/ /g, '-');
  } catch { return dateStr; }
};

// Flattens the grouped trial-balance into the generic row shape the shared
// Tally-style renderer (PDF) and table export expect: a bold group row (with
// the group's own Dr/Cr totals) followed by its indented detail rows.
function toRows(groups) {
  const rows = [];
  groups.forEach((g) => {
    rows.push({ type: 'group', indent: 0, values: { particulars: g.name, debit: g.debit, credit: g.credit } });
    g.items.forEach((it) => {
      rows.push({ type: 'detail', indent: 1, values: { particulars: it.name, debit: it.debit, credit: it.credit } });
    });
  });
  return rows;
}

router.get('/', async (req, res) => {
  try {
    const asOnDate = req.query.as_on_date || new Date().toISOString().split('T')[0];
    const data = await buildTrialBalance(asOnDate, req.companyId);
    res.json({ success: true, data });
  } catch (error) {
    logError(error, req, { feature: 'trial-balance' });
    logger.error('Trial balance error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate trial balance' });
  }
});

router.get('/export', async (req, res) => {
  try {
    const asOnDate = req.query.as_on_date || new Date().toISOString().split('T')[0];
    const fromDate = req.query.from_date;
    const format = (req.query.format || 'pdf').toLowerCase();
    const data = await buildTrialBalance(asOnDate, req.companyId);
    const companyProfile = await getCompanyProfile(req.companyId);

    const subtitle = fromDate
      ? `${formatDateLong(fromDate)} to ${formatDateLong(asOnDate)}`
      : `as on ${formatDateLong(asOnDate)}`;

    const columns = [
      { key: 'particulars', label: 'Particulars', width: 3, align: 'left' },
      { key: 'debit', label: 'Debit', width: 1, align: 'right', money: true },
      { key: 'credit', label: 'Credit', width: 1, align: 'right', money: true },
    ];
    const rows = toRows(data.groups);
    rows.push({ type: 'total', indent: 0, values: { particulars: 'Grand Total', debit: data.grand_total_debit, credit: data.grand_total_credit } });

    if (format === 'xlsx' || format === 'excel') {
      return sendExcel(res, {
        filename: `Trial-Balance-${asOnDate}`,
        title: 'Trial Balance',
        subtitleLines: [subtitle],
        sections: [{
          columns: columns.map((c) => ({ ...c, excelWidth: c.key === 'particulars' ? 40 : 16 })),
          rows: rows.filter((r) => r.type !== 'total').map((r) => r.values),
          totalsRow: { particulars: 'Grand Total', debit: data.grand_total_debit, credit: data.grand_total_credit },
        }],
      });
    }

    const chunks = [];
    generateTallyStylePDF(
      { companyProfile, title: 'Trial Balance', subtitle, columns, rows, groupHeader: 'Closing Balance' },
      (c) => chunks.push(c),
      () => {
        const buf = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', buf.length);
        res.setHeader('Content-Disposition', `attachment; filename="Trial-Balance-${asOnDate}.pdf"`);
        res.end(buf);
      }
    );
  } catch (error) {
    logError(error, req, { feature: 'trial-balance' });
    logger.error('Trial balance export error:', error);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to export trial balance' });
  }
});

module.exports = router;
