/**
 * tests/services/payroll/attendanceCalculator.test.js
 *
 * Unit tests for the shared attendance -> payable-days calculator used by both
 * individual salary-slip generation and "Batch Generate All".
 */

const {
  summarizeAttendance,
  monthBounds,
  normalizePayrollMonth,
  resolveAttendanceDays,
} = require('../../../src/services/payroll/attendanceCalculator');

const row = (status) => ({ status });

describe('normalizePayrollMonth', () => {
  test('accepts YYYY-MM', () => {
    expect(normalizePayrollMonth('2026-09')).toBe('2026-09');
  });

  test('reduces YYYY-MM-DD to its month', () => {
    expect(normalizePayrollMonth('2026-09-25')).toBe('2026-09');
  });

  test('rejects garbage', () => {
    expect(() => normalizePayrollMonth('September')).toThrow();
    expect(() => normalizePayrollMonth('')).toThrow();
    expect(() => normalizePayrollMonth(null)).toThrow();
  });
});

describe('monthBounds', () => {
  test('September 2026 has 30 days and correct range', () => {
    const b = monthBounds('2026-09');
    expect(b.totalDays).toBe(30);
    expect(b.startDate).toBe('2026-09-01');
    expect(b.endDate).toBe('2026-09-30');
  });

  test('February 2028 is a leap month (29 days)', () => {
    expect(monthBounds('2028-02').totalDays).toBe(29);
  });
});

describe('summarizeAttendance', () => {
  test('present days pay in full', () => {
    const rows = Array.from({ length: 30 }, () => row('present'));
    const s = summarizeAttendance(rows, 30);
    expect(s.payableDays).toBe(30);
    expect(s.missingDays).toBe(0);
  });

  test('half day counts as 0.5', () => {
    const rows = [
      ...Array.from({ length: 22 }, () => row('present')),
      ...Array.from({ length: 2 }, () => row('half_day')),
      ...Array.from({ length: 6 }, () => row('absent')),
    ];
    const s = summarizeAttendance(rows, 30);
    expect(s.presentDays).toBe(22);
    expect(s.halfDays).toBe(2);
    expect(s.absentDays).toBe(6);
    expect(s.payableDays).toBe(23); // 22 + 2*0.5 + 0
  });

  test('leave and absent are unpaid; holiday is paid', () => {
    const rows = [
      ...Array.from({ length: 20 }, () => row('present')),
      ...Array.from({ length: 4 }, () => row('holiday')),
      ...Array.from({ length: 3 }, () => row('leave')),
      ...Array.from({ length: 3 }, () => row('absent')),
    ];
    const s = summarizeAttendance(rows, 30);
    expect(s.payableDays).toBe(24); // 20 present + 4 holiday
  });

  test('MISSING days are NOT treated as present (default policy = unpaid)', () => {
    const rows = Array.from({ length: 10 }, () => row('present')); // only 10 of 30 marked
    const s = summarizeAttendance(rows, 30);
    expect(s.missingDays).toBe(20);
    expect(s.payableDays).toBe(10);
    expect(s.unpaidDays).toBe(20);
  });

  test('missing policy = "present" pays unmarked days (opt-in only)', () => {
    const rows = Array.from({ length: 10 }, () => row('present'));
    const s = summarizeAttendance(rows, 30, 'present');
    expect(s.payableDays).toBe(30);
    expect(s.missingDays).toBe(20);
  });

  test('no attendance at all -> 0 payable days, not a full month', () => {
    const s = summarizeAttendance([], 31);
    expect(s.payableDays).toBe(0);
    expect(s.missingDays).toBe(31);
  });

  test('unknown status is not paid', () => {
    const s = summarizeAttendance([row('present'), row('weird'), row(null)], 3);
    expect(s.presentDays).toBe(1);
    expect(s.unknownStatusDays).toBe(2);
    expect(s.payableDays).toBe(1);
  });
});

describe('resolveAttendanceDays (DB-backed) uses the selected month only', () => {
  test('queries the exact month range and never the current date / previous month', async () => {
    const calls = [];
    const fakeQuery = async (sql, params) => {
      calls.push({ sql, params });
      // caller only ever selects `status`
      return { rows: [{ status: 'present' }, { status: 'half_day' }] };
    };

    const out = await resolveAttendanceDays(fakeQuery, 42, '2026-09-25');

    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual([42, '2026-09-01', '2026-09-30']);
    expect(out.month).toBe('2026-09');
    expect(out.totalDays).toBe(30);
    expect(out.payableDays).toBe(1.5);
  });
});
