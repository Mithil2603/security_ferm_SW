const logger = require('../utils/logger.js');
const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authMiddleware, requirePermission, requireCompanyContext } = require('../middleware/auth');
const Joi = require('joi');
const { logError } = require('../utils/errorLogger');
const { ensureLinkedLedgers, linkedTotals, dismissLinkedLedger, restoreLinkedLedgers, getDismissed, SOURCE_LABELS } = require('../utils/ledgerSources');

// Custom ledgers (Tally-style): user-created ledgers under fixed groups.
// A voucher side can point at one via vouchers.debit_ledger_id / credit_ledger_id.
// Balance convention matches bank accounts: Dr − Cr of posted vouchers.

router.use(authMiddleware);
router.use(requireCompanyContext);
router.use(requirePermission(
  'manage_vouchers', 'view_vouchers', 'create_vouchers', 'edit_vouchers',
  'manage_bank_accounts', 'manage_expenses', 'manage_invoices', 'view_reports'
));
const canEdit = requirePermission('manage_vouchers', 'create_vouchers', 'edit_vouchers', 'manage_bank_accounts');

const ledgerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(150).required(),
  group_id: Joi.number().integer().positive().required(),
  description: Joi.string().allow('', null).max(1000).optional(),
});

const groupSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  nature: Joi.string().valid('expense', 'income', 'asset', 'liability', 'capital').required(),
  report: Joi.string().valid('pl', 'bs').required(),
  is_direct: Joi.boolean().default(false),
});

const BALANCE_SQL = `
  COALESCE((SELECT SUM(v.amount) FROM vouchers v WHERE v.debit_ledger_id = l.id AND v.status = 'posted' AND v.company_id = l.company_id), 0) AS total_debit,
  COALESCE((SELECT SUM(v.amount) FROM vouchers v WHERE v.credit_ledger_id = l.id AND v.status = 'posted' AND v.company_id = l.company_id), 0) AS total_credit,
  (SELECT COUNT(*) FROM vouchers v WHERE (v.debit_ledger_id = l.id OR v.credit_ledger_id = l.id) AND v.company_id = l.company_id) AS voucher_count`;

function withBalance(row) {
  const dr = parseFloat(row.total_debit) || 0;
  const cr = parseFloat(row.total_credit) || 0;
  const net = Math.round((dr - cr) * 100) / 100;
  return {
    ...row,
    total_debit: dr,
    total_credit: cr,
    voucher_count: parseInt(row.voucher_count) || 0,
    balance: Math.abs(net),
    balance_side: net > 0 ? 'Dr' : net < 0 ? 'Cr' : '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The 13 built-in groups are shared rows (company_id IS NULL) so every
// business starts with them. A business can freely edit or delete them like
// any group — but since the row is shared, editing it must never change what
// other businesses see. So the first edit "forks" a private copy for that
// company (moving that company's own ledgers onto it) and the original is
// just hidden from that company's view from then on (tracked here, the same
// per-company-dismissal trick ledgerSources.js uses for auto ledgers).
// ─────────────────────────────────────────────────────────────────────────────
const DISMISSED_GROUPS_PREFIX = 'dismissed_ledger_groups';
const dismissedGroupsKey = (companyId) => `${DISMISSED_GROUPS_PREFIX}:${companyId}`;

async function getDismissedGroups(companyId) {
  try {
    const r = await query('SELECT setting_value FROM system_settings WHERE setting_key = $1', [dismissedGroupsKey(companyId)]);
    return new Set(r.rows.length ? JSON.parse(r.rows[0].setting_value || '[]') : []);
  } catch (_) { return new Set(); }
}
async function dismissGroup(id, companyId) {
  const set = await getDismissedGroups(companyId);
  set.add(id);
  await query(
    `INSERT INTO system_settings (setting_key, setting_value) VALUES ($1, $2)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [dismissedGroupsKey(companyId), JSON.stringify([...set])]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ledger-accounts/groups — the built-in default groups (minus any
// this company has edited/deleted away) plus this company's own groups
// ─────────────────────────────────────────────────────────────────────────────
router.get('/groups', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM ledger_groups WHERE company_id IS NULL OR company_id = $1 ORDER BY sort_order, name',
      [req.companyId]
    );
    const dismissed = await getDismissedGroups(req.companyId);
    const rows = result.rows
      .filter(g => !(g.company_id === null && dismissed.has(g.id)))
      .map(g => ({ ...g, is_system: g.company_id === null }));
    res.json({ success: true, data: rows });
  } catch (error) {
    logError(error, req, { feature: 'ledger-accounts' });
    res.status(500).json({ success: false, message: 'Failed to fetch ledger groups' });
  }
});

async function groupNameTaken(name, companyId, excludeId = null) {
  const r = await query(
    `SELECT id FROM ledger_groups WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND (company_id IS NULL OR company_id = $2)${excludeId ? ' AND id != $3' : ''}`,
    excludeId ? [name, companyId, excludeId] : [name, companyId]
  );
  return r.rows.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ledger-accounts/groups — create a custom group for this company
// ─────────────────────────────────────────────────────────────────────────────
router.post('/groups', canEdit, async (req, res) => {
  try {
    const { error, value } = groupSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });
    if (await groupNameTaken(value.name, req.companyId)) {
      return res.status(409).json({ success: false, message: `A group named "${value.name}" already exists` });
    }

    const maxSort = await query('SELECT MAX(sort_order) AS m FROM ledger_groups WHERE company_id IS NULL OR company_id = $1', [req.companyId]);
    const sortOrder = (parseInt(maxSort.rows[0].m) || 0) + 10;

    const result = await query(
      `INSERT INTO ledger_groups (name, nature, report, is_direct, sort_order, company_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [value.name, value.nature, value.report, value.is_direct ? 1 : 0, sortOrder, req.companyId]
    );
    res.status(201).json({ success: true, data: { ...result.rows[0], is_system: false }, message: 'Group created' });
  } catch (error) {
    logError(error, req, { feature: 'ledger-accounts' });
    res.status(500).json({ success: false, message: 'Failed to create group' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/ledger-accounts/groups/:id — update a group. If it's one of this
// company's own groups, updates it in place. If it's a shared default, forks
// a private copy for this company (see note above) instead of touching the
// shared row.
// ─────────────────────────────────────────────────────────────────────────────
router.put('/groups/:id', canEdit, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await query('SELECT * FROM ledger_groups WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: 'Group not found' });
    const current = existing.rows[0];
    if (current.company_id !== null && current.company_id !== req.companyId) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    const { error, value } = groupSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });
    if (await groupNameTaken(value.name, req.companyId, id)) {
      return res.status(409).json({ success: false, message: `A group named "${value.name}" already exists` });
    }

    if (current.company_id === req.companyId) {
      await query(
        'UPDATE ledger_groups SET name = $1, nature = $2, report = $3, is_direct = $4 WHERE id = $5 AND company_id = $6',
        [value.name, value.nature, value.report, value.is_direct ? 1 : 0, id, req.companyId]
      );
      const row = await query('SELECT * FROM ledger_groups WHERE id = $1 AND company_id = $2', [id, req.companyId]);
      return res.json({ success: true, data: { ...row.rows[0], is_system: false }, message: 'Group updated' });
    }

    // current.company_id === null: a shared default. Fork a private copy,
    // move this company's own ledgers (if any) onto it, then hide the
    // original default from this company — other businesses are untouched.
    const used = await query('SELECT COUNT(*) AS count FROM ledgers WHERE group_id = $1 AND company_id = $2', [id, req.companyId]);
    const affected = parseInt(used.rows[0].count) || 0;

    const maxSort = await query('SELECT MAX(sort_order) AS m FROM ledger_groups WHERE company_id IS NULL OR company_id = $1', [req.companyId]);
    const sortOrder = (parseInt(maxSort.rows[0].m) || 0) + 10;

    const inserted = await query(
      `INSERT INTO ledger_groups (name, nature, report, is_direct, sort_order, company_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [value.name, value.nature, value.report, value.is_direct ? 1 : 0, sortOrder, req.companyId]
    );
    const forked = inserted.rows[0];

    if (affected > 0) {
      await query('UPDATE ledgers SET group_id = $1 WHERE group_id = $2 AND company_id = $3', [forked.id, id, req.companyId]);
    }
    await dismissGroup(id, req.companyId);

    res.json({
      success: true,
      data: { ...forked, is_system: false },
      message: affected > 0 ? `Group updated — ${affected} ledger(s) under it now use the updated group` : 'Group updated',
    });
  } catch (error) {
    logError(error, req, { feature: 'ledger-accounts' });
    res.status(500).json({ success: false, message: 'Failed to update group' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/ledger-accounts/groups/:id — delete a group. Ledgers under it
// that were never used in a voucher are deleted along with it; if any have
// recorded transactions, the delete is refused (those have to be moved or
// deactivated first — editing the group instead is always still possible).
// For a shared default, the row is only hidden from this company, never
// actually removed, since other businesses still use it.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/groups/:id', canEdit, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await query('SELECT * FROM ledger_groups WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: 'Group not found' });
    const current = existing.rows[0];
    if (current.company_id !== null && current.company_id !== req.companyId) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    const ledgerRows = await query(
      `SELECT l.id, l.name, l.source_type,
              (SELECT COUNT(*) FROM vouchers v WHERE (v.debit_ledger_id = l.id OR v.credit_ledger_id = l.id) AND v.company_id = l.company_id) AS voucher_count
         FROM ledgers l WHERE l.group_id = $1 AND l.company_id = $2`,
      [id, req.companyId]
    );
    // Auto-linked ledgers (expense categories, payroll, bank entries) read
    // live from their own module and never have voucher rows of their own —
    // they still represent real data, so they block a cascade delete too.
    const hasData = ledgerRows.rows.filter(l => parseInt(l.voucher_count) > 0 || l.source_type);
    if (hasData.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Can't delete — ${hasData.length} ledger(s) under this group have data: ${hasData.map(l => l.name).join(', ')}. Deactivate or move those ledgers first, or edit this group instead of deleting it.`,
      });
    }

    const emptyIds = ledgerRows.rows.map(l => l.id);
    if (emptyIds.length > 0) {
      await query(
        `DELETE FROM ledgers WHERE company_id = $${emptyIds.length + 1} AND id IN (${emptyIds.map((_, i) => `$${i + 1}`).join(',')})`,
        [...emptyIds, req.companyId]
      );
    }

    if (current.company_id === req.companyId) {
      await query('DELETE FROM ledger_groups WHERE id = $1 AND company_id = $2', [id, req.companyId]);
    } else {
      await dismissGroup(id, req.companyId);
    }

    res.json({
      success: true,
      message: emptyIds.length > 0
        ? `Group "${current.name}" deleted, along with ${emptyIds.length} unused ledger(s) under it`
        : `Group "${current.name}" deleted`,
    });
  } catch (error) {
    logError(error, req, { feature: 'ledger-accounts' });
    res.status(500).json({ success: false, message: 'Failed to delete group' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ledger-accounts/voucher-options — Dr/Cr choices for vouchers, in
// six sections: Bank & Cash, Customers, Vendors, Expenses, Income, and
// Assets / Liabilities / Capital. Each option's description says what it is.
// value format: bank:<id> | ledger:<id> | client:<id> | vendor:<id>
// ─────────────────────────────────────────────────────────────────────────────
router.get('/voucher-options', async (req, res) => {
  try {
    await ensureLinkedLedgers(req.companyId);
    const [banks, clients, vendors, ledgers] = await Promise.all([
      query(`SELECT id, account_name, account_type, bank_name, account_number FROM bank_accounts WHERE is_active = 1 AND company_id = $1 ORDER BY account_type DESC, account_name`, [req.companyId]),
      query(`SELECT id, name, city FROM clients WHERE is_active = 1 AND company_id = $1 ORDER BY name`, [req.companyId]),
      query(`SELECT id, name FROM vendors WHERE is_active = 1 AND company_id = $1 ORDER BY name`, [req.companyId]),
      query(`SELECT l.id, l.name, g.name AS group_name, g.nature, g.sort_order
               FROM ledgers l JOIN ledger_groups g ON g.id = l.group_id
              WHERE l.is_active = 1 AND l.company_id = $1
              ORDER BY g.sort_order, l.name`, [req.companyId]),
    ]);

    const last4 = (n) => (n ? ` · ••${String(n).slice(-4)}` : '');
    const ledgerOpt = (l) => ({ value: `ledger:${l.id}`, label: l.name, description: l.group_name });
    const groups = [
      {
        key: 'bank', label: 'Bank & Cash',
        options: banks.rows.map(b => ({
          value: `bank:${b.id}`,
          label: b.account_name,
          description: b.account_type === 'cash' ? 'Cash' : `${b.bank_name || 'Bank account'}${last4(b.account_number)}`,
        })),
      },
      { key: 'customers', label: 'Customers (Sundry Debtors)', options: clients.rows.map(c => ({ value: `client:${c.id}`, label: c.name, description: c.city || 'Customer' })) },
      { key: 'vendors', label: 'Vendors (Sundry Creditors)', options: vendors.rows.map(v => ({ value: `vendor:${v.id}`, label: v.name, description: 'Vendor' })) },
      { key: 'expenses', label: 'Expenses', options: ledgers.rows.filter(l => l.nature === 'expense').map(ledgerOpt) },
      { key: 'income', label: 'Income', options: ledgers.rows.filter(l => l.nature === 'income').map(ledgerOpt) },
      { key: 'balance_sheet', label: 'Assets, Liabilities & Capital', options: ledgers.rows.filter(l => ['asset', 'liability', 'capital'].includes(l.nature)).map(ledgerOpt) },
    ].filter(g => g.options.length > 0);

    res.json({ success: true, data: groups });
  } catch (error) {
    logError(error, req, { feature: 'ledger-accounts' });
    res.status(500).json({ success: false, message: 'Failed to fetch voucher ledger options' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ledger-accounts — list ledgers with balance
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    await ensureLinkedLedgers(req.companyId);
    const { group_id, search, active_only } = req.query;
    const conditions = ['l.company_id = $1'];
    const params = [req.companyId];
    if (group_id) { params.push(group_id); conditions.push(`l.group_id = $${params.length}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`l.name LIKE $${params.length}`); }
    if (active_only === 'true') conditions.push('l.is_active = 1');
    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await query(`
      SELECT l.*, g.name AS group_name, g.nature, g.report, g.is_direct, g.sort_order,
             ${BALANCE_SQL}
        FROM ledgers l
        JOIN ledger_groups g ON g.id = l.group_id
        ${where}
       ORDER BY g.sort_order, l.name
    `, params);

    // Linked ledgers also carry what their source module recorded.
    const linked = await linkedTotals(result.rows, req.companyId);
    const rows = result.rows.map((r) => {
      const t = linked.get(r.id);
      return withBalance(t ? {
        ...r,
        total_debit: (parseFloat(r.total_debit) || 0) + t.debit,
        total_credit: (parseFloat(r.total_credit) || 0) + t.credit,
        voucher_count: (parseInt(r.voucher_count) || 0) + t.count,
      } : r);
    }).map((r) => ({
      ...r,
      source_label: r.source_type ? SOURCE_LABELS[r.source_type] : null,
      // vouchers posted directly to this ledger (blocks a hard delete)
      direct_voucher_count: parseInt(result.rows.find((x) => x.id === r.id)?.voucher_count) || 0,
    }));
    res.json({ success: true, data: rows, dismissed_auto: (await getDismissed(req.companyId)).size });
  } catch (error) {
    logError(error, req, { feature: 'ledger-accounts' });
    logger.error('Fetch ledgers error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch ledgers' });
  }
});

async function validateGroup(groupId, companyId) {
  const g = await query('SELECT id FROM ledger_groups WHERE id = $1 AND (company_id IS NULL OR company_id = $2)', [groupId, companyId]);
  return g.rows.length > 0;
}

async function nameTaken(name, companyId, excludeId = null) {
  const r = await query(
    `SELECT id FROM ledgers WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND company_id = $2${excludeId ? ' AND id != $3' : ''}`,
    excludeId ? [name, companyId, excludeId] : [name, companyId]
  );
  return r.rows.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ledger-accounts — create ledger
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', canEdit, async (req, res) => {
  try {
    const { error, value } = ledgerSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });
    if (!(await validateGroup(value.group_id, req.companyId))) return res.status(400).json({ success: false, message: 'Invalid ledger group' });
    if (await nameTaken(value.name, req.companyId)) return res.status(409).json({ success: false, message: `A ledger named "${value.name}" already exists` });

    const result = await query(
      `INSERT INTO ledgers (name, group_id, description, created_by, company_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [value.name, value.group_id, value.description || null, req.user.userId, req.companyId]
    );
    res.status(201).json({ success: true, data: result.rows[0], message: 'Ledger created' });
  } catch (error) {
    logError(error, req, { feature: 'ledger-accounts' });
    logger.error('Create ledger error:', error);
    res.status(500).json({ success: false, message: 'Failed to create ledger' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/ledger-accounts/:id — update ledger (name/group/description, is_active)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', canEdit, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await query('SELECT * FROM ledgers WHERE id = $1 AND company_id = $2', [id, req.companyId]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: 'Ledger not found' });

    // Activate / deactivate only
    if (Object.keys(req.body || {}).length === 1 && req.body.is_active !== undefined) {
      await query('UPDATE ledgers SET is_active = $1 WHERE id = $2 AND company_id = $3', [req.body.is_active ? 1 : 0, id, req.companyId]);
      const row = await query('SELECT * FROM ledgers WHERE id = $1 AND company_id = $2', [id, req.companyId]);
      return res.json({ success: true, data: row.rows[0], message: req.body.is_active ? 'Ledger activated' : 'Ledger deactivated' });
    }

    const { error, value } = ledgerSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });
    if (!(await validateGroup(value.group_id, req.companyId))) return res.status(400).json({ success: false, message: 'Invalid ledger group' });
    if (await nameTaken(value.name, req.companyId, id)) return res.status(409).json({ success: false, message: `A ledger named "${value.name}" already exists` });

    await query(
      'UPDATE ledgers SET name = $1, group_id = $2, description = $3 WHERE id = $4 AND company_id = $5',
      [value.name, value.group_id, value.description || null, id, req.companyId]
    );
    const row = await query('SELECT * FROM ledgers WHERE id = $1 AND company_id = $2', [id, req.companyId]);
    res.json({ success: true, data: row.rows[0], message: 'Ledger updated' });
  } catch (error) {
    logError(error, req, { feature: 'ledger-accounts' });
    res.status(500).json({ success: false, message: 'Failed to update ledger' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/ledger-accounts/:id — delete if unused, otherwise deactivate
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', canEdit, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await query('SELECT * FROM ledgers WHERE id = $1 AND company_id = $2', [id, req.companyId]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: 'Ledger not found' });

    const used = await query(
      'SELECT COUNT(*) AS count FROM vouchers WHERE (debit_ledger_id = $1 OR credit_ledger_id = $1) AND company_id = $2',
      [id, req.companyId]
    );
    if (parseInt(used.rows[0].count) > 0) {
      await query('UPDATE ledgers SET is_active = 0 WHERE id = $1 AND company_id = $2', [id, req.companyId]);
      return res.json({
        success: true,
        deactivated: true,
        message: 'Ledger has vouchers, so it was deactivated instead of deleted',
      });
    }

    await query('DELETE FROM ledgers WHERE id = $1 AND company_id = $2', [id, req.companyId]);
    const src = existing.rows[0];
    if (src.source_type) {
      // Auto ledger: remember it so it is not re-created. The expenses / salary /
      // bank entries it showed are untouched.
      await dismissLinkedLedger(src.source_type, src.source_key, req.companyId);
      return res.json({ success: true, deleted: true, message: `Ledger "${src.name}" deleted. Its entries are still in ${SOURCE_LABELS[src.source_type]}.` });
    }
    res.json({ success: true, deleted: true, message: 'Ledger deleted' });
  } catch (error) {
    logError(error, req, { feature: 'ledger-accounts' });
    res.status(500).json({ success: false, message: 'Failed to delete ledger' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ledger-accounts/restore-auto — bring back deleted auto ledgers
// ─────────────────────────────────────────────────────────────────────────────
router.post('/restore-auto', canEdit, async (req, res) => {
  try {
    const n = await restoreLinkedLedgers(req.companyId);
    res.json({ success: true, message: n ? `${n} auto ledger(s) restored` : 'Nothing to restore' });
  } catch (error) {
    logError(error, req, { feature: 'ledger-accounts' });
    res.status(500).json({ success: false, message: 'Failed to restore auto ledgers' });
  }
});

module.exports = router;
