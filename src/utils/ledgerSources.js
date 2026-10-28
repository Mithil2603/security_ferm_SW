const { query } = require('../database/connection');
const logger = require('./logger');

// Auto-linked ledgers: entries made in other modules show up in a ledger
// without being re-entered as vouchers. The amounts are read live from the
// module's own table (nothing is copied), so editing/deleting an expense or a
// salary payment is reflected immediately.
//
//   expense_category:<category>  Expenses / Purchase Bills (approved or paid)   Dr
//   payroll                      Payroll gross salary (Salary & Wages)           Dr
//   bank_entry:<kind>            Bank & Payments → Bank Entries (posted)         Dr/Cr
//
// The P&L already counts expenses and payroll from their own tables, so
// ledgerTotals() must NOT add expense_category / payroll amounts again. Bank
// entries were not in the P&L before, so they are added there via BANK_ENTRY_LEDGERS.
//
// Everything here is scoped per company — `ledgers`, `expenses`,
// `expense_categories`, `payroll` and `vouchers` all carry a company_id.

const BANK_ENTRY_LEDGERS = {
  bank_charge: { name: 'Bank Charges', group: 'Indirect Expenses', side: 'debit' },
  other_debit: { name: 'Other Payments', group: 'Indirect Expenses', side: 'debit' },
  interest_credited: { name: 'Interest Received', group: 'Indirect Incomes', side: 'credit' },
  other_credit: { name: 'Other Receipts', group: 'Indirect Incomes', side: 'credit' },
};

const SOURCE_LABELS = {
  expense_category: 'Expenses & Purchase Bills',
  payroll: 'Salary (Payroll)',
  bank_entry: 'Bank Entries',
};

const titleCase = (s) => String(s || '').replace(/_/g, ' ').trim().replace(/\s+/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

// Per-company throttle for ensureLinkedLedgers (was a single shared timestamp,
// which meant one company's call could suppress another's within the window).
const lastEnsureByCompany = new Map();

// Auto ledgers the user deleted ("type:key"), kept in system_settings so they
// are not re-created. Restoring clears the list. Keyed per company since the
// dismissal is a per-company preference, even though system_settings itself
// is a global table.
const DISMISSED_KEY_PREFIX = 'dismissed_linked_ledgers';
const dismissedKey = (companyId) => `${DISMISSED_KEY_PREFIX}:${companyId}`;

async function getDismissed(companyId) {
  try {
    const r = await query('SELECT setting_value FROM system_settings WHERE setting_key = $1', [dismissedKey(companyId)]);
    return new Set(r.rows.length ? JSON.parse(r.rows[0].setting_value || '[]') : []);
  } catch (_) { return new Set(); }
}
async function saveDismissed(set, companyId) {
  await query(
    `INSERT INTO system_settings (setting_key, setting_value) VALUES ($1, $2)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [dismissedKey(companyId), JSON.stringify([...set])]
  );
}
async function dismissLinkedLedger(type, key, companyId) {
  const set = await getDismissed(companyId);
  set.add(`${type}:${String(key).toLowerCase()}`);
  await saveDismissed(set, companyId);
}
async function restoreLinkedLedgers(companyId) {
  const n = (await getDismissed(companyId)).size;
  await saveDismissed(new Set(), companyId);
  lastEnsureByCompany.delete(companyId);
  await ensureLinkedLedgers(companyId, { force: true });
  return n;
}

/**
 * Make sure every expense category, payroll and each bank-entry type has its
 * linked ledger for this company. Idempotent; inserts only into `ledgers`. A
 * user ledger in the same company with the same name and no source is
 * adopted instead of creating a duplicate.
 */
async function ensureLinkedLedgers(companyId, { force = false } = {}) {
  if (!companyId) return;
  const last = lastEnsureByCompany.get(companyId) || 0;
  if (!force && Date.now() - last < 15000) return;
  lastEnsureByCompany.set(companyId, Date.now());
  try {
    const groups = (await query('SELECT id, name FROM ledger_groups')).rows;
    const gid = (name) => groups.find((g) => g.name === name)?.id;

    const wanted = [];
    const cats = await query(`
      SELECT name AS cat FROM expense_categories WHERE is_active = 1 AND company_id = $1
      UNION
      SELECT DISTINCT category AS cat FROM expenses WHERE category IS NOT NULL AND category != '' AND company_id = $1`,
      [companyId]);
    const seen = new Set();
    for (const { cat } of cats.rows) {
      const key = String(cat).trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const isSalary = /salar|wage/.test(key);
      wanted.push({ type: 'expense_category', key, name: titleCase(cat), group: isSalary ? 'Direct Expenses' : 'Indirect Expenses' });
    }
    wanted.push({ type: 'payroll', key: 'payroll', name: 'Salary & Wages', group: 'Direct Expenses' });
    for (const [kind, d] of Object.entries(BANK_ENTRY_LEDGERS)) {
      wanted.push({ type: 'bank_entry', key: kind, name: d.name, group: d.group });
    }

    const existing = (await query('SELECT id, name, source_type, source_key FROM ledgers WHERE company_id = $1', [companyId])).rows;
    const dismissed = await getDismissed(companyId);
    for (const w of wanted) {
      if (dismissed.has(`${w.type}:${w.key}`)) continue;
      if (existing.some((l) => l.source_type === w.type && String(l.source_key).toLowerCase() === w.key)) continue;
      let name = w.name;
      const sameName = existing.find((l) => l.name.toLowerCase() === name.toLowerCase());
      if (sameName && !sameName.source_type) {
        await query('UPDATE ledgers SET source_type = $1, source_key = $2 WHERE id = $3 AND company_id = $4', [w.type, w.key, sameName.id, companyId]);
        sameName.source_type = w.type; sameName.source_key = w.key;
        continue;
      }
      if (sameName) name = `${name} (${SOURCE_LABELS[w.type]})`;
      if (!gid(w.group)) continue;
      const r = await query(
        'INSERT INTO ledgers (name, group_id, description, source_type, source_key, company_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [name, gid(w.group), `Auto-filled from ${SOURCE_LABELS[w.type]}`, w.type, w.key, companyId]
      );
      existing.push(r.rows[0]);
    }
  } catch (err) {
    // ledgers / source columns not migrated yet — linked ledgers just stay off.
    if (!/ledger|source_/i.test(err.message || '')) logger.error('ensureLinkedLedgers failed:', err);
  }
}

/**
 * Entries a linked ledger gets from its source module, as ledger rows
 * ({ id, date, particulars, vch_type, vch_no, debit, credit, created_at }).
 */
async function linkedEntries(ledger, companyId) {
  if (!ledger?.source_type) return [];
  if (ledger.source_type === 'expense_category') {
    const r = await query(`
      SELECT e.id, e.expense_date, e.amount, e.receipt_number, e.description, e.created_at,
             COALESCE(v.name, e.vendor_name) AS vendor
        FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id AND v.company_id = e.company_id
       WHERE LOWER(TRIM(e.category)) = $1 AND e.status IN ('approved', 'paid') AND e.company_id = $2`, [ledger.source_key, companyId]);
    return r.rows.map((e) => ({
      id: `exp-${e.id}`,
      date: e.expense_date,
      particulars: `To ${e.vendor || e.description || 'Expense'}`,
      vch_type: 'Expense',
      vch_no: e.receipt_number || `EXP-${e.id}`,
      debit: parseFloat(e.amount) || 0,
      credit: 0,
      created_at: e.created_at || e.expense_date,
    }));
  }
  if (ledger.source_type === 'payroll') {
    const r = await query(`
      SELECT p.id, p.payroll_month, p.gross_salary, p.created_at, emp.full_name
        FROM payroll p LEFT JOIN employees emp ON emp.id = p.employee_id AND emp.company_id = p.company_id
       WHERE p.company_id = $1`, [companyId]);
    return r.rows.map((p) => ({
      id: `pay-${p.id}`,
      date: p.payroll_month,
      particulars: `To ${p.full_name || 'Employee'} (salary)`,
      vch_type: 'Payroll',
      vch_no: `PAY-${p.id}`,
      debit: parseFloat(p.gross_salary) || 0,
      credit: 0,
      created_at: p.created_at || p.payroll_month,
    }));
  }
  if (ledger.source_type === 'bank_entry') {
    const def = BANK_ENTRY_LEDGERS[ledger.source_key];
    if (!def) return [];
    const r = await query(`
      SELECT v.id, v.voucher_number, v.voucher_date, v.amount, v.narration, v.created_at,
             ba.account_name
        FROM vouchers v
        LEFT JOIN bank_accounts ba ON ba.id = COALESCE(v.debit_account_id, v.credit_account_id) AND ba.company_id = v.company_id
       WHERE v.status = 'posted' AND v.voucher_type = 'journal' AND v.category = $1
         AND v.debit_ledger_id IS NULL AND v.credit_ledger_id IS NULL AND v.company_id = $2`, [ledger.source_key, companyId]);
    return r.rows.map((v) => {
      const amt = parseFloat(v.amount) || 0;
      const dr = def.side === 'debit';
      return {
        id: `vch-${v.id}`,
        date: v.voucher_date,
        particulars: `${dr ? 'To' : 'By'} ${v.account_name || 'Bank'}`,
        vch_type: 'Bank Entry',
        vch_no: v.voucher_number,
        debit: dr ? amt : 0,
        credit: dr ? 0 : amt,
        created_at: v.created_at,
      };
    });
  }
  return [];
}

/** Dr / Cr totals per linked ledger (all time), for the Ledgers list. */
async function linkedTotals(ledgers, companyId) {
  const out = new Map();
  for (const l of ledgers) {
    if (!l.source_type) continue;
    const rows = await linkedEntries(l, companyId);
    out.set(l.id, {
      debit: rows.reduce((s, r) => s + r.debit, 0),
      credit: rows.reduce((s, r) => s + r.credit, 0),
      count: rows.length,
    });
  }
  return out;
}

module.exports = {
  ensureLinkedLedgers, linkedEntries, linkedTotals, dismissLinkedLedger, restoreLinkedLedgers, getDismissed,
  BANK_ENTRY_LEDGERS, SOURCE_LABELS,
};
