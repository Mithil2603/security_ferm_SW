/**
 * tests/services/payroll/statutory.test.js
 *
 * resolvePfPercentage must honour an explicitly configured 0% PF and only fall
 * back to the statutory 12% when nothing is configured. Regression test for the
 * bug where `pf_percentage || 12` turned a configured 0 into a 12% deduction.
 */

const { resolvePfPercentage } = require('../../../src/services/payroll/statutory');

describe('resolvePfPercentage', () => {
  test('explicit 0 stays 0 (no PF deducted)', () => {
    expect(resolvePfPercentage(0)).toBe(0);
    expect(resolvePfPercentage('0')).toBe(0);
    expect(resolvePfPercentage('0.00')).toBe(0);
  });

  test('unset value falls back to 12', () => {
    expect(resolvePfPercentage(null)).toBe(12);
    expect(resolvePfPercentage(undefined)).toBe(12);
    expect(resolvePfPercentage('')).toBe(12);
    expect(resolvePfPercentage('abc')).toBe(12);
  });

  test('configured percentages pass through', () => {
    expect(resolvePfPercentage(12)).toBe(12);
    expect(resolvePfPercentage('10')).toBe(10);
    expect(resolvePfPercentage(8.33)).toBe(8.33);
  });

  test('negative values clamp to 0', () => {
    expect(resolvePfPercentage(-5)).toBe(0);
  });

  test('custom fallback is respected', () => {
    expect(resolvePfPercentage(null, 0)).toBe(0);
  });
});
