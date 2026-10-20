const { query } = require('../database/connection');

// Posted-voucher totals for custom ledgers (vouchers.debit_ledger_id /
// credit_ledger_id), used by P&L and Balance Sheet.
//
// amount follows each group's natural side:
//   expense / asset              → Dr − Cr
//   income / liability / capital → Cr − Dr

const DEBIT_NATURES = ['expense', 'asset'];

// Bank entries (bank charges, interest, other payment/receipt) feed their
// auto-linked ledgers. Expenses and payroll are linked too, but the P&L
// already counts those from their own tables, so they are not added here.
const BANK_ENTRY_SIDES = { bank_charge: 'debit', other_debit: 'debit', interest_credited: 'credit', other_credit: 'credit' };

async function bankEntryRows(params, dateSql) {
  try {
    const r = await query(`
      SELECT l.id, l.name, l.source_key, g.name AS group_name, g.nature, g.is_direct, g.sort_order,
             COALESCE(SUM(v.amount), 0) AS amt
        FROM ledgers l
        JOIN ledger_groups g ON g.id = l.group_id
        JOIN vouchers v ON v.category = l.source_key AND v.voucher_type = 'journal'
                       AND v.debit_ledger_id IS NULL AND v.credit_ledger_id IS NULL
       WHERE l.source_type = 'bank_entry' AND v.status = 'posted'${dateSql}
       GROUP BY l.id, l.name, l.source_key, g.name, g.nature, g.is_direct, g.sort_order`, params);
    return r.rows;
  } catch (err) {
    if (/source_|ledger/i.test(err.message || '')) return [];
    throw err;
  }
}

/**
 * @param {{ from?: string, to: string }} range  voucher_date bounds (from optional)
 * @returns rows { id, name, group_name, nature, is_direct, sort_order, debit, credit, amount }
 */
async function ledgerTotals({ from, to }) {
  const params = [to];
  let fromSql = '';
  if (from) { params.push(from); fromSql = ' AND v.voucher_date >= $2'; }

  let result;
  try {
    result = await query(`
      SELECT l.id, l.name, g.name AS group_name, g.nature, g.is_direct, g.sort_order,
             COALESCE(SUM(CASE WHEN v.debit_ledger_id = l.id THEN v.amount ELSE 0 END), 0) AS debit,
             COALESCE(SUM(CASE WHEN v.credit_ledger_id = l.id THEN v.amount ELSE 0 END), 0) AS credit
        FROM ledgers l
        JOIN ledger_groups g ON g.id = l.group_id
        JOIN vouchers v ON (v.debit_ledger_id = l.id OR v.credit_ledger_id = l.id)
       WHERE v.status = 'posted' AND v.voucher_date <= $1${fromSql}
       GROUP BY l.id, l.name, g.name, g.nature, g.is_direct, g.sort_order
       ORDER BY g.sort_order, l.name
    `, params);
  } catch (err) {
    // Ledger tables not migrated yet — reports carry on without ledgers.
    if (/ledger/i.test(err.message || '')) return [];
    throw err;
  }

  // merge bank-entry amounts into the voucher totals
  const byId = new Map(result.rows.map((r) => [r.id, { ...r }]));
  for (const b of await bankEntryRows(params, ` AND v.voucher_date <= $1${from ? ' AND v.voucher_date >= $2' : ''}`)) {
    const row = byId.get(b.id) || { ...b, debit: 0, credit: 0 };
    const amt = parseFloat(b.amt) || 0;
    if (BANK_ENTRY_SIDES[b.source_key] === 'debit') row.debit = (parseFloat(row.debit) || 0) + amt;
    else row.credit = (parseFloat(row.credit) || 0) + amt;
    byId.set(b.id, row);
  }

  return [...byId.values()].sort((a, b) => (a.sort_order - b.sort_order) || String(a.name).localeCompare(b.name)).map((r) => {
    const debit = parseFloat(r.debit) || 0;
    const credit = parseFloat(r.credit) || 0;
    const amount = DEBIT_NATURES.includes(r.nature) ? debit - credit : credit - debit;
    return { ...r, is_direct: !!Number(r.is_direct), debit, credit, amount: Math.round(amount * 100) / 100 };
  }).filter((r) => r.amount !== 0);
}

/** Month-wise (YYYY-MM) ledger income and expense for the P&L trend. */
async function ledgerMonthly(fromYm, toYm) {
  try {
    const result = await query(`
      SELECT strftime('%Y-%m', v.voucher_date) AS ym, g.nature,
             COALESCE(SUM(CASE WHEN v.debit_ledger_id = l.id THEN v.amount ELSE 0 END), 0) AS debit,
             COALESCE(SUM(CASE WHEN v.credit_ledger_id = l.id THEN v.amount ELSE 0 END), 0) AS credit
        FROM ledgers l
        JOIN ledger_groups g ON g.id = l.group_id
        JOIN vouchers v ON (v.debit_ledger_id = l.id OR v.credit_ledger_id = l.id)
       WHERE v.status = 'posted' AND g.nature IN ('income', 'expense')
         AND strftime('%Y-%m', v.voucher_date) >= $1
         AND strftime('%Y-%m', v.voucher_date) <= $2
       GROUP BY ym, g.nature
    `, [fromYm, toYm]);
    const map = new Map();
    const be = await query(`
      SELECT strftime('%Y-%m', v.voucher_date) AS ym, l.source_key, COALESCE(SUM(v.amount), 0) AS amt
        FROM ledgers l
        JOIN vouchers v ON v.category = l.source_key AND v.voucher_type = 'journal'
                       AND v.debit_ledger_id IS NULL AND v.credit_ledger_id IS NULL
       WHERE l.source_type = 'bank_entry' AND v.status = 'posted'
         AND strftime('%Y-%m', v.voucher_date) >= $1
         AND strftime('%Y-%m', v.voucher_date) <= $2
       GROUP BY ym, l.source_key`, [fromYm, toYm]).catch(() => ({ rows: [] }));
    for (const r of be.rows) {
      const m = map.get(r.ym) || { income: 0, expense: 0 };
      if (BANK_ENTRY_SIDES[r.source_key] === 'debit') m.expense += parseFloat(r.amt) || 0;
      else m.income += parseFloat(r.amt) || 0;
      map.set(r.ym, m);
    }
    for (const r of result.rows) {
      const m = map.get(r.ym) || { income: 0, expense: 0 };
      const dr = parseFloat(r.debit) || 0;
      const cr = parseFloat(r.credit) || 0;
      if (r.nature === 'income') m.income += cr - dr;
      else m.expense += dr - cr;
      map.set(r.ym, m);
    }
    return map;
  } catch (err) {
    if (/ledger/i.test(err.message || '')) return new Map();
    throw err;
  }
}

const sum = (rows) => Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
const lineItems = (rows) => rows.map((r) => ({ id: r.id, name: r.name, group_name: r.group_name, amount: r.amount }));

module.exports = { ledgerTotals, ledgerMonthly, sum, lineItems };
