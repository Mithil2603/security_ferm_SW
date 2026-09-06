/**
 * Payroll Adjustment Category helpers.
 *
 * A category is `{ name: string, type: 'addition' | 'deduction' }`.
 * Older builds stored categories as bare strings or as `{ name }` without a
 * type. normalizeAdjustmentCategories() upgrades any such legacy value so the
 * Settings UI and the Employee Ledger always have an explicit Addition/Deduction
 * classification to work with.
 */

export const ADJUSTMENT_TYPES = ['addition', 'deduction'];

export function normalizeAdjustmentCategory(raw) {
  if (raw == null) return null;

  if (typeof raw === 'string') {
    const name = raw.trim();
    return name ? { name, type: 'deduction' } : null;
  }

  if (typeof raw === 'object') {
    const name = String(raw.name ?? '').trim();
    if (!name) return null;
    const type = ADJUSTMENT_TYPES.includes(raw.type) ? raw.type : 'deduction';
    return { name, type };
  }

  return null;
}

/**
 * Parse + normalize whatever the `payroll_adjustment_categories` system setting
 * holds (a JSON string, an array, or null) into a clean array of
 * `{ name, type }` objects.
 */
export function normalizeAdjustmentCategories(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value || '[]');
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeAdjustmentCategory).filter(Boolean);
}
