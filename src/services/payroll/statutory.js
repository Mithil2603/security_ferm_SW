/**
 * src/services/payroll/statutory.js
 *
 * Small helpers for statutory payroll figures where "0 configured" and
 * "nothing configured" must mean different things.
 */

/**
 * Resolve the PF percentage to apply, honouring an *explicit* 0.
 *
 * Only null / undefined / '' / NaN fall back to the statutory default (12%).
 * A structure that is deliberately configured with pf_percentage = 0 now
 * produces a PF deduction of 0.
 *
 * (The previous `pf_percentage || 12` turned a configured 0% back into 12%.)
 *
 * @param {number|string|null|undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function resolvePfPercentage(value, fallback = 12) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  if (n < 0) return 0;
  return n;
}

module.exports = { resolvePfPercentage };
