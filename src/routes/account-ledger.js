const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const logger = require('../utils/logger');
const { logError } = require('../utils/errorLogger');

router.use(authMiddleware);
router.use(requirePermission('manage_invoices', 'manage_expenses', 'view_reports', 'manage_payroll'));

/**
 * Format a Date object or ISO string to standard Indian Tally format: D-MMM-YY
 * e.g. 2025-04-03 -> 3-Apr-25
 */
function formatTallyDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const day = d.getDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const year = String(d.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  } catch (_) {
    return String(dateStr);
  }
}

/**
 * Determine the Financial Year of a given date (1-Apr to 31-Mar)
 * e.g. 2025-08-27 -> 2025-26
 */
function getFinancialYear(dateStr) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-12
  if (month >= 4) {
    const nextYear = String(year + 1).slice(-2);
    return `${year}-${nextYear}`;
  } else {
    const curYearShort = String(year).slice(-2);
    return `${year - 1}-${curYearShort}`;
  }
}

/**
 * GET /api/account-ledger/parties
 * Fetch all selectable parties (clients, vendors, bank/cash accounts)
 */
router.get('/parties', async (req, res) => {
  try {
    const [clientsRes, vendorsRes, bankRes] = await Promise.all([
      query(`SELECT id, name, client_code, phone, email, address, city, state, gst_number, is_active FROM clients ORDER BY name ASC`),
      query(`SELECT id, name, contact_info, payment_terms_days, is_active FROM vendors ORDER BY name ASC`),
      query(`SELECT id, account_name, account_type, account_number, bank_name, ifsc_code, is_active FROM bank_accounts ORDER BY account_name ASC`)
    ]);

    res.json({
      success: true,
      data: {
        clients: clientsRes.rows || [],
        vendors: vendorsRes.rows || [],
        bank_accounts: bankRes.rows || []
      }
    });
  } catch (error) {
    logError(error, req, { feature: 'account-ledger' });
    logger.error('Failed to fetch ledger parties:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch party list' });
  }
});

/**
 * GET /api/account-ledger
 * Fetch complete double-entry ledger statement for a client, vendor, or bank account
 */
router.get('/', async (req, res) => {
  try {
    const { party_type, party_id, from_date, to_date } = req.query;

    if (!party_type || !party_id) {
      return res.status(400).json({ success: false, message: 'party_type and party_id are required' });
    }

    // 1. Fetch Agency Settings (for official print header)
    let agency = {
      name: 'KHETLAJI INDUSTRIES',
      address: 'Ground Floor, 44, Suvan Business Park, Opp.Bharat Textile Mills, Rakhial',
      city: 'Ahmedabad',
      state: 'Gujarat',
      email: 'khetlajiindustries79@gmail.com',
      phone: '',
      gstin: ''
    };
    try {
      const agencyRes = await query(`SELECT setting_value FROM system_settings WHERE setting_key = 'agency_settings'`);
      if (agencyRes.rows.length > 0 && agencyRes.rows[0].setting_value) {
        const parsed = JSON.parse(agencyRes.rows[0].setting_value);
        agency = { ...agency, ...parsed };
      }
    } catch (_) {}

    let primaryBankName = 'HDFC BANK';
    try {
      const bankRes = await query(`SELECT account_name, bank_name FROM bank_accounts WHERE account_type = 'bank' AND is_active = 1 LIMIT 1`);
      if (bankRes.rows.length > 0) {
        primaryBankName = (bankRes.rows[0].bank_name || bankRes.rows[0].account_name || 'HDFC BANK').toUpperCase();
      }
    } catch (_) {}

    // 2. Fetch Party Metadata
    let party = { id: party_id, name: '', address: '', city: '', phone: '', email: '', gst_number: '' };
    if (party_type === 'client') {
      const cRes = await query(`SELECT * FROM clients WHERE id = $1`, [party_id]);
      if (cRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Client not found' });
      const c = cRes.rows[0];
      party = {
        id: c.id,
        name: c.name,
        code: c.client_code,
        address: c.address || '',
        city: c.city || '',
        state: c.state || '',
        pincode: c.pincode || '',
        phone: c.phone || '',
        email: c.email || '',
        gst_number: c.gst_number || c.gstin || '',
        account_type: 'Sundry Debtors (Client)'
      };
    } else if (party_type === 'vendor') {
      const vRes = await query(`SELECT * FROM vendors WHERE id = $1`, [party_id]);
      if (vRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Vendor not found' });
      const v = vRes.rows[0];
      party = {
        id: v.id,
        name: v.name,
        address: v.contact_info || '',
        city: '',
        phone: '',
        email: '',
        account_type: 'Sundry Creditors (Vendor / Supplier)'
      };
    } else if (party_type === 'bank_account') {
      const bRes = await query(`SELECT * FROM bank_accounts WHERE id = $1`, [party_id]);
      if (bRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Bank account not found' });
      const b = bRes.rows[0];
      party = {
        id: b.id,
        name: b.account_name,
        bank_name: b.bank_name,
        account_number: b.account_number,
        ifsc_code: b.ifsc_code,
        branch: b.branch,
        account_type: b.account_type === 'cash' ? 'Cash Account' : 'Bank Account',
        opening_balance: parseFloat(b.opening_balance) || 0
      };
    }

    // 3. Gather all transactions across all time for this party
    let allTransactions = [];

    if (party_type === 'client') {
      // Invoices (Debits to Client)
      const invRes = await query(`
        SELECT 
          id, invoice_number, invoice_date as tx_date, final_amount as amount, 
          tax_rate, cgst_amount, sgst_amount, igst_amount, notes, created_at
        FROM invoices 
        WHERE client_id = $1 AND status != 'cancelled'
      `, [party_id]);

      invRes.rows.forEach(inv => {
        let taxSuffix = '';
        if (inv.tax_rate && inv.tax_rate > 0) {
          taxSuffix = ` ${inv.tax_rate}%`;
        } else if ((inv.cgst_amount > 0 || inv.sgst_amount > 0 || inv.igst_amount > 0)) {
          taxSuffix = ' 18%';
        }
        allTransactions.push({
          id: `inv-${inv.id}`,
          date: inv.tx_date,
          particulars: `To Sales${taxSuffix}`,
          vch_type: 'Sales',
          vch_no: inv.invoice_number || `INV-${inv.id}`,
          debit: parseFloat(inv.amount) || 0,
          credit: 0,
          created_at: inv.created_at || inv.tx_date
        });
      });

      // Payments received from Client (Credits to Client)
      const pmtRes = await query(`
        SELECT 
          p.id, p.payment_date as tx_date, p.amount_paid as amount, 
          p.payment_method, p.transaction_reference, p.created_at
        FROM payments p
        JOIN invoices i ON p.invoice_id = i.id
        WHERE i.client_id = $1
      `, [party_id]);

      pmtRes.rows.forEach(pmt => {
        let bankName = primaryBankName;
        if (pmt.payment_method === 'cash') {
          bankName = 'Cash';
        }
        allTransactions.push({
          id: `pmt-${pmt.id}`,
          date: pmt.tx_date,
          particulars: `By ${bankName}`,
          vch_type: 'Receipt',
          vch_no: pmt.transaction_reference || `${pmt.id}`,
          debit: 0,
          credit: parseFloat(pmt.amount) || 0,
          created_at: pmt.created_at || pmt.tx_date
        });
      });

      // Vouchers (Direct receipts, credit notes, debit notes, journals)
      const vchRes = await query(`
        SELECT 
          v.id, v.voucher_number, v.voucher_date as tx_date, v.voucher_type,
          v.amount, v.narration, v.created_at,
          debit_ba.account_name as debit_acc, debit_ba.bank_name as debit_bank,
          credit_ba.account_name as credit_acc, credit_ba.bank_name as credit_bank
        FROM vouchers v
        LEFT JOIN bank_accounts debit_ba ON v.debit_account_id = debit_ba.id
        LEFT JOIN bank_accounts credit_ba ON v.credit_account_id = credit_ba.id
        WHERE v.party_type = 'client' AND v.party_id = $1 AND v.status = 'posted'
          AND (v.reference_type != 'invoice' OR v.reference_id IS NULL)
      `, [party_id]);

      vchRes.rows.forEach(v => {
        const amt = parseFloat(v.amount) || 0;
        if (v.voucher_type === 'credit_note') {
          allTransactions.push({
            id: `vch-${v.id}`,
            date: v.tx_date,
            particulars: 'By Credit Note',
            vch_type: 'Credit Note',
            vch_no: v.voucher_number,
            debit: 0,
            credit: amt,
            created_at: v.created_at
          });
        } else if (v.voucher_type === 'debit_note') {
          allTransactions.push({
            id: `vch-${v.id}`,
            date: v.tx_date,
            particulars: 'To Debit Note',
            vch_type: 'Debit Note',
            vch_no: v.voucher_number,
            debit: amt,
            credit: 0,
            created_at: v.created_at
          });
        } else if (['bank_receipt', 'cash_receipt'].includes(v.voucher_type)) {
          const bankName = (v.debit_bank || v.debit_acc || 'HDFC BANK').toUpperCase();
          allTransactions.push({
            id: `vch-${v.id}`,
            date: v.tx_date,
            particulars: `By ${bankName}`,
            vch_type: 'Receipt',
            vch_no: v.voucher_number,
            debit: 0,
            credit: amt,
            created_at: v.created_at
          });
        }
      });

    } else if (party_type === 'vendor') {
      // Expenses / Purchases from Vendor (Credits to Vendor)
      const expRes = await query(`
        SELECT 
          id, expense_date as tx_date, amount, category, 
          receipt_number, description, created_at
        FROM expenses 
        WHERE vendor_id = $1 AND status != 'rejected'
      `, [party_id]);

      expRes.rows.forEach(exp => {
        const categoryName = (exp.category || 'Purchase').toUpperCase();
        allTransactions.push({
          id: `exp-${exp.id}`,
          date: exp.tx_date,
          particulars: `By ${categoryName} 18%`,
          vch_type: 'Purchase',
          vch_no: exp.receipt_number || `EXP-${exp.id}`,
          debit: 0,
          credit: parseFloat(exp.amount) || 0,
          created_at: exp.created_at || exp.tx_date
        });
      });

      // Vendor Payments (Debits to Vendor)
      const vpRes = await query(`
        SELECT 
          vp.id, vp.payment_date as tx_date, vp.amount, 
          vp.payment_method, vp.reference_number, vp.created_at
        FROM vendor_payments vp
        WHERE vp.vendor_id = $1
      `, [party_id]);

      vpRes.rows.forEach(vp => {
        let bankName = primaryBankName;
        if (vp.payment_method === 'cash') {
          bankName = 'Cash';
        }
        allTransactions.push({
          id: `vp-${vp.id}`,
          date: vp.tx_date,
          particulars: `To ${bankName}`,
          vch_type: 'Payment',
          vch_no: vp.reference_number || `${vp.id}`,
          debit: parseFloat(vp.amount) || 0,
          credit: 0,
          created_at: vp.created_at || vp.tx_date
        });
      });

      // Vouchers for Vendor (bank_payment, cash_payment, debit_note, credit_note)
      const vchRes = await query(`
        SELECT 
          v.id, v.voucher_number, v.voucher_date as tx_date, v.voucher_type,
          v.amount, v.narration, v.created_at,
          debit_ba.account_name as debit_acc, debit_ba.bank_name as debit_bank,
          credit_ba.account_name as credit_acc, credit_ba.bank_name as credit_bank
        FROM vouchers v
        LEFT JOIN bank_accounts debit_ba ON v.debit_account_id = debit_ba.id
        LEFT JOIN bank_accounts credit_ba ON v.credit_account_id = credit_ba.id
        WHERE v.party_type = 'vendor' AND v.party_id = $1 AND v.status = 'posted'
          AND (v.reference_type != 'expense' OR v.reference_id IS NULL)
      `, [party_id]);

      vchRes.rows.forEach(v => {
        const amt = parseFloat(v.amount) || 0;
        if (['bank_payment', 'cash_payment'].includes(v.voucher_type)) {
          const bankName = (v.credit_bank || v.credit_acc || 'HDFC BANK').toUpperCase();
          allTransactions.push({
            id: `vch-${v.id}`,
            date: v.tx_date,
            particulars: `To ${bankName}`,
            vch_type: 'Payment',
            vch_no: v.voucher_number,
            debit: amt,
            credit: 0,
            created_at: v.created_at
          });
        } else if (v.voucher_type === 'debit_note') {
          allTransactions.push({
            id: `vch-${v.id}`,
            date: v.tx_date,
            particulars: 'To Debit Note',
            vch_type: 'Debit Note',
            vch_no: v.voucher_number,
            debit: amt,
            credit: 0,
            created_at: v.created_at
          });
        } else if (v.voucher_type === 'credit_note') {
          allTransactions.push({
            id: `vch-${v.id}`,
            date: v.tx_date,
            particulars: 'By Credit Note',
            vch_type: 'Credit Note',
            vch_no: v.voucher_number,
            debit: 0,
            credit: amt,
            created_at: v.created_at
          });
        }
      });

    } else if (party_type === 'bank_account') {
      const vchRes = await query(`
        SELECT 
          v.id, v.voucher_number, v.voucher_date as tx_date, v.voucher_type,
          v.amount, v.party_name, v.narration, v.created_at,
          v.debit_account_id, v.credit_account_id,
          debit_ba.account_name as debit_acc, credit_ba.account_name as credit_acc
        FROM vouchers v
        LEFT JOIN bank_accounts debit_ba ON v.debit_account_id = debit_ba.id
        LEFT JOIN bank_accounts credit_ba ON v.credit_account_id = credit_ba.id
        WHERE (v.debit_account_id = $1 OR v.credit_account_id = $1) AND v.status = 'posted'
      `, [party_id]);

      vchRes.rows.forEach(v => {
        const amt = parseFloat(v.amount) || 0;
        const isDebit = String(v.debit_account_id) === String(party_id);
        allTransactions.push({
          id: `vch-${v.id}`,
          date: v.tx_date,
          particulars: isDebit 
            ? `To ${v.party_name || v.credit_acc || 'Receipt'}` 
            : `By ${v.party_name || v.debit_acc || 'Payment'}`,
          vch_type: v.voucher_type === 'contra' ? 'Contra' : (isDebit ? 'Receipt' : 'Payment'),
          vch_no: v.voucher_number,
          debit: isDebit ? amt : 0,
          credit: isDebit ? 0 : amt,
          created_at: v.created_at
        });
      });
    }

    // Sort all transactions chronologically
    allTransactions.sort((a, b) => {
      const diff = new Date(a.date) - new Date(b.date);
      if (diff !== 0) return diff;
      return new Date(a.created_at) - new Date(b.created_at);
    });

    // 4. Pre-Period Opening Balance Calculation
    let initialBalance = 0;
    if (party_type === 'bank_account' && party.opening_balance) {
      initialBalance = party.opening_balance;
    }

    let prePeriodDebit = 0;
    let prePeriodCredit = 0;
    const periodTransactions = [];

    const fromDateObj = from_date ? new Date(from_date) : null;
    const toDateObj = to_date ? new Date(to_date) : null;

    allTransactions.forEach(tx => {
      const txDate = new Date(tx.date);
      if (fromDateObj && txDate < fromDateObj) {
        prePeriodDebit += tx.debit;
        prePeriodCredit += tx.credit;
      } else if (!toDateObj || txDate <= toDateObj) {
        periodTransactions.push({
          ...tx,
          date_formatted: formatTallyDate(tx.date)
        });
      }
    });

    const netPrePeriod = (initialBalance + prePeriodDebit) - prePeriodCredit;

    // 5. Build Financial Year Segments
    const fyMap = new Map();
    periodTransactions.forEach(tx => {
      const fy = getFinancialYear(tx.date);
      if (!fyMap.has(fy)) fyMap.set(fy, []);
      fyMap.get(fy).push(tx);
    });

    // If no transactions in period, ensure at least one segment exists
    if (fyMap.size === 0) {
      const defaultFy = from_date ? getFinancialYear(from_date) : getFinancialYear(new Date().toISOString());
      fyMap.set(defaultFy, []);
    }

    const segments = [];
    const sortedFys = Array.from(fyMap.keys()).sort();

    let rollingBalance = netPrePeriod;

    sortedFys.forEach((fy) => {
      const rows = fyMap.get(fy) || [];
      const segOpeningAmt = Math.abs(rollingBalance);
      const segOpeningSide = rollingBalance >= 0 ? 'debit' : 'credit';

      let segDebitTotal = segOpeningSide === 'debit' ? segOpeningAmt : 0;
      let segCreditTotal = segOpeningSide === 'credit' ? segOpeningAmt : 0;

      rows.forEach(r => {
        segDebitTotal += r.debit;
        segCreditTotal += r.credit;
      });

      const segClosingAmt = Math.abs(segDebitTotal - segCreditTotal);
      // If debit > credit, closing balance is on credit side (By Closing Balance) to balance
      const segClosingSide = segDebitTotal >= segCreditTotal ? 'credit' : 'debit';
      const segClosingParticulars = segDebitTotal >= segCreditTotal ? 'By Closing Balance' : 'To Closing Balance';

      // The equalized total is the maximum of the two sides
      const equalizedTotal = Math.max(segDebitTotal, segCreditTotal);

      // Determine date range text for segment
      const [startYear] = fy.split('-');
      const fyStart = `1-Apr-${startYear.slice(-2)}`;
      const fyEnd = `31-Mar-${String(Number(startYear) + 1).slice(-2)}`;

      segments.push({
        financial_year: fy,
        period_label: `${fyStart} to ${fyEnd}`,
        opening_balance: segOpeningAmt > 0 ? {
          amount: segOpeningAmt,
          side: segOpeningSide,
          particulars: segOpeningSide === 'debit' ? 'To Opening Balance' : 'By Opening Balance',
          date_formatted: fyStart
        } : null,
        rows,
        subtotal_debit: segDebitTotal - (segOpeningSide === 'debit' ? segOpeningAmt : 0),
        subtotal_credit: segCreditTotal - (segOpeningSide === 'credit' ? segOpeningAmt : 0),
        closing_balance: {
          amount: segClosingAmt,
          side: segClosingSide,
          particulars: segClosingParticulars
        },
        equalized_total: equalizedTotal
      });

      // Rolling balance forward for next FY
      rollingBalance = (segDebitTotal >= segCreditTotal ? 1 : -1) * segClosingAmt;
    });

    // Period summary
    const periodFromFormatted = from_date ? formatTallyDate(from_date) : (periodTransactions[0] ? periodTransactions[0].date_formatted : formatTallyDate(new Date()));
    const periodToFormatted = to_date ? formatTallyDate(to_date) : (periodTransactions[periodTransactions.length - 1] ? periodTransactions[periodTransactions.length - 1].date_formatted : formatTallyDate(new Date()));

    res.json({
      success: true,
      data: {
        agency,
        party,
        period: {
          from: from_date || null,
          to: to_date || null,
          from_formatted: periodFromFormatted,
          to_formatted: periodToFormatted,
          display: `${periodFromFormatted} to ${periodToFormatted}`
        },
        segments,
        total_transactions: periodTransactions.length,
        final_balance: Math.abs(rollingBalance),
        final_balance_side: rollingBalance >= 0 ? 'Dr' : 'Cr'
      }
    });

  } catch (error) {
    logError(error, req, { feature: 'account-ledger' });
    logger.error('Account ledger generation error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate account ledger' });
  }
});

module.exports = router;
