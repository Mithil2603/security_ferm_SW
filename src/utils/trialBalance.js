// Trial Balance: every ledger + every bank/cash account, grouped exactly like
// the Ledgers screen groups them (ledger_groups), each shown on whichever
// side (Debit/Credit) its balance naturally falls on, plus the two synthetic
// groups "Bank Accounts" and "Cash-in-Hand" for bank_accounts rows (which
// aren't part of the ledgers table at all).
//
// Scope: this reflects only what's been posted through vouchers — the same
// double-entry subsystem ledgerTotals()/Balance Sheet's bank-balance query
// already use. It does NOT fold in invoice receivables, pending payroll, or
// other business-module figures the Balance Sheet approximates, since those
// aren't posted as voucher debits/credits and mixing them in would break the
// one thing a trial balance must guarantee: Grand Total Debit = Grand Total
// Credit. A single "Profit & Loss A/c" line plugs the gap between the two
// columns at the end, exactly like Tally does for an open (unclosed) period.
const { query } = require('../database/connection');
const ledgerTotalsUtil = require('./ledgerTotals');

const DEBIT_NATURES = ['expense', 'asset'];

// amount is signed toward the account's natural side (see ledgerTotals()).
// Positive -> show on the natural side; negative -> contra (opposite) side.
function splitBySide(nature, amount) {
  const debitNatured = DEBIT_NATURES.includes(nature);
  if (debitNatured) {
    return amount >= 0 ? { debit: amount, credit: 0 } : { debit: 0, credit: -amount };
  }
  return amount >= 0 ? { debit: 0, credit: amount } : { debit: -amount, credit: 0 };
}

async function bankCashGroups(asOnDate, companyId) {
  const result = await query(`
    SELECT ba.id, ba.account_name, ba.account_type, ba.bank_name, ba.account_number,
           COALESCE(ba.opening_balance, 0) +
             COALESCE((SELECT SUM(v.amount) FROM vouchers v WHERE v.debit_account_id = ba.id AND v.company_id = $2 AND v.status = 'posted' AND v.voucher_date <= $1), 0) -
             COALESCE((SELECT SUM(v.amount) FROM vouchers v WHERE v.credit_account_id = ba.id AND v.company_id = $2 AND v.status = 'posted' AND v.voucher_date <= $1), 0)
             AS balance
      FROM bank_accounts ba
     WHERE ba.company_id = $2
     ORDER BY ba.account_type, ba.account_name
  `, [asOnDate, companyId]);

  const makeGroup = (key, label, type) => {
    const accounts = result.rows.filter((a) => a.account_type === type);
    const items = accounts.map((a) => {
      const bal = Math.round((parseFloat(a.balance) || 0) * 100) / 100;
      const { debit, credit } = splitBySide('asset', bal);
      return { id: `bank_account:${a.id}`, name: a.account_name, debit, credit };
    }).filter((it) => it.debit !== 0 || it.credit !== 0);
    const debit = Math.round(items.reduce((s, i) => s + i.debit, 0) * 100) / 100;
    const credit = Math.round(items.reduce((s, i) => s + i.credit, 0) * 100) / 100;
    return { key, name: label, items, debit, credit };
  };

  return [
    makeGroup('cash_in_hand', 'Cash-in-Hand', 'cash'),
    makeGroup('bank_accounts', 'Bank Accounts', 'bank'),
  ].filter((g) => g.items.length > 0);
}

/**
 * @param {string} asOnDate  YYYY-MM-DD — balances reflect everything posted on or before this date
 * @param {number} companyId
 */
async function buildTrialBalance(asOnDate, companyId) {
  const ledgerRows = await ledgerTotalsUtil.ledgerTotals({ to: asOnDate, companyId });

  const byGroup = new Map();
  for (const r of ledgerRows) {
    const key = `ledger_group:${r.group_id}`;
    const g = byGroup.get(key) || { key, name: r.group_name, sort_order: r.sort_order, items: [] };
    const { debit, credit } = splitBySide(r.nature, r.amount);
    if (debit !== 0 || credit !== 0) g.items.push({ id: `ledger:${r.id}`, name: r.name, debit, credit });
    byGroup.set(key, g);
  }
  const ledgerGroups = [...byGroup.values()]
    .filter((g) => g.items.length > 0)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((g) => ({
      key: g.key,
      name: g.name,
      items: g.items,
      debit: Math.round(g.items.reduce((s, i) => s + i.debit, 0) * 100) / 100,
      credit: Math.round(g.items.reduce((s, i) => s + i.credit, 0) * 100) / 100,
    }));

  const groups = [...ledgerGroups, ...(await bankCashGroups(asOnDate, companyId))];

  let totalDebit = Math.round(groups.reduce((s, g) => s + g.debit, 0) * 100) / 100;
  let totalCredit = Math.round(groups.reduce((s, g) => s + g.credit, 0) * 100) / 100;

  const diff = Math.round((totalDebit - totalCredit) * 100) / 100;
  if (Math.abs(diff) >= 0.01) {
    if (diff > 0) {
      groups.push({ key: 'profit_and_loss', name: 'Profit & Loss A/c', items: [], debit: 0, credit: diff });
      totalCredit = Math.round((totalCredit + diff) * 100) / 100;
    } else {
      groups.push({ key: 'profit_and_loss', name: 'Profit & Loss A/c', items: [], debit: -diff, credit: 0 });
      totalDebit = Math.round((totalDebit - diff) * 100) / 100;
    }
  }

  return {
    as_on_date: asOnDate,
    groups,
    grand_total_debit: totalDebit,
    grand_total_credit: totalCredit,
    is_balanced: Math.abs(totalDebit - totalCredit) < 0.01,
  };
}

module.exports = { buildTrialBalance };
