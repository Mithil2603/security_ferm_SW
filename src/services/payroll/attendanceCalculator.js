/**
 * src/services/payroll/attendanceCalculator.js
 *
 * Single source of truth for turning a set of attendance rows into the number
 * of *payable days* for a payroll period.
 *
 * Both individual salary-slip generation and "Batch Generate All" go through
 * resolveAttendanceDays(), so the two paths can never diverge.
 *
 * The payroll PERIOD (`payrollMonth`, "YYYY-MM") is the only date input.
 * Nothing here reads the current system date, the previous month, or the
 * employee's joining date — so processing salary early (e.g. before Diwali)
 * never shifts the month that is actually being calculated.
 */

const { daysInMonth } = require('../utils/dateCalculator');

// Fraction of a day's wage earned for each *recorded* attendance status.
const STATUS_DAY_WEIGHT = {
  present: 1,
  half_day: 0.5,
  holiday: 1, // company holiday / weekly-off — paid
  leave: 0, // leave without pay (there is no leave-balance system yet)
  absent: 0,
};

// Weight for a day that has NO attendance record at all.
// Default is 0 — a missing day is deliberately NOT treated as "present".
// Installations that mark only exceptions can flip this to "present" via the
// `payroll_missing_attendance_policy` system setting.
const MISSING_WEIGHT = { unpaid: 0, present: 1 };

/**
 * Validate and reduce a payroll month to canonical "YYYY-MM".
 * Accepts "YYYY-MM" or "YYYY-MM-DD" (only the month part is used).
 */
function normalizePayrollMonth(payrollMonth) {
  if (!payrollMonth || typeof payrollMonth !== 'string') {
    throw new Error(`Invalid payroll month: ${JSON.stringify(payrollMonth)}`);
  }
  const m = payrollMonth.trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) {
    throw new Error(`Payroll month must be "YYYY-MM" (got "${payrollMonth}")`);
  }
  return m;
}

/**
 * Derive the exact date range for a payroll month from the month string alone.
 */
function monthBounds(payrollMonth) {
  const month = normalizePayrollMonth(payrollMonth);
  const [year, monthNumber] = month.split('-').map(Number);
  const totalDays = daysInMonth(monthNumber, year);
  return {
    month,
    year,
    monthNumber,
    totalDays,
    startDate: `${month}-01`,
    endDate: `${month}-${String(totalDays).padStart(2, '0')}`,
  };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeAttendanceStatus(statusVal) {
  if (!statusVal) return 'unknown';
  const s = String(statusVal).trim().toLowerCase();
  if (['p', 'present', 'pr', 'fullday', 'full_day', 'full', 'd', 'day', 'night', 'yes'].includes(s)) return 'present';
  if (['a', 'absent', 'ab', 'no'].includes(s)) return 'absent';
  if (['hd', 'half_day', 'half day', 'half-day', 'half', 'h/d'].includes(s)) return 'half_day';
  if (['l', 'leave', 'cl', 'pl', 'sl', 'el', 'paid_leave'].includes(s)) return 'leave';
  if (['h', 'holiday', 'wo', 'week_off', 'week-off', 'weekoff', 'off'].includes(s)) return 'holiday';
  return 'unknown';
}

/**
 * Pure: fold attendance rows into a day-level summary for one month.
 *
 * @param {Array<{status?: string}>} rows        attendance rows for the month
 * @param {number} totalDays                     calendar days in the month
 * @param {'unpaid'|'present'} missingPolicy     how to treat days with no record
 * @returns {{
 *   totalDays:number, recordedDays:number, missingDays:number,
 *   presentDays:number, halfDays:number, holidayDays:number,
 *   leaveDays:number, absentDays:number, unknownStatusDays:number,
 *   payableDays:number, unpaidDays:number, missingPolicy:'unpaid'|'present'
 * }}
 */
function summarizeAttendance(rows, totalDays, missingPolicy = 'unpaid') {
  const counts = { present: 0, half_day: 0, holiday: 0, leave: 0, absent: 0, unknown: 0 };

  for (const row of rows || []) {
    const rawStatus = row && row.status != null ? row.status : '';
    const status = normalizeAttendanceStatus(rawStatus);
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
    else counts.unknown += 1;
  }

  const recordedDays =
    counts.present + counts.half_day + counts.holiday + counts.leave + counts.absent + counts.unknown;
  const missingDays = Math.max(0, totalDays - recordedDays);

  const missingWeight = missingPolicy === 'present' ? MISSING_WEIGHT.present : MISSING_WEIGHT.unpaid;

  const payableDays = round2(
    counts.present * STATUS_DAY_WEIGHT.present +
      counts.half_day * STATUS_DAY_WEIGHT.half_day +
      counts.holiday * STATUS_DAY_WEIGHT.holiday +
      counts.leave * STATUS_DAY_WEIGHT.leave +
      counts.absent * STATUS_DAY_WEIGHT.absent +
      counts.unknown * 0 +
      missingDays * missingWeight
  );

  return {
    totalDays,
    recordedDays,
    missingDays,
    presentDays: counts.present,
    halfDays: counts.half_day,
    holidayDays: counts.holiday,
    leaveDays: counts.leave,
    absentDays: counts.absent,
    unknownStatusDays: counts.unknown,
    payableDays,
    unpaidDays: round2(totalDays - payableDays),
    missingPolicy: missingPolicy === 'present' ? 'present' : 'unpaid',
  };
}

/**
 * DB-backed: load one employee's attendance for the payroll month and summarize.
 *
 * @param {Function} query        the connection.js query() helper
 * @param {number}   employeeId
 * @param {string}   payrollMonth "YYYY-MM" (or "YYYY-MM-DD" – only the month is used)
 * @param {'unpaid'|'present'} missingPolicy
 * @param {string}   [cutOffDate] optional "YYYY-MM-DD" to evaluate attendance only up to this day
 */
async function resolveAttendanceDays(query, employeeId, payrollMonth, missingPolicy = 'unpaid', cutOffDate = null) {
  const bounds = monthBounds(payrollMonth);
  const effectiveEndDate = cutOffDate && cutOffDate >= bounds.startDate && cutOffDate <= bounds.endDate
    ? cutOffDate
    : bounds.endDate;

  const result = await query(
    `SELECT status
       FROM attendance
      WHERE employee_id = $1
        AND attendance_date >= $2
        AND attendance_date <= $3`,
    [employeeId, bounds.startDate, effectiveEndDate]
  );

  const [endYear, endMonth, endDay] = effectiveEndDate.split('-').map(Number);
  const periodDays = (effectiveEndDate !== bounds.endDate) ? endDay : bounds.totalDays;

  return {
    ...bounds,
    effectiveEndDate,
    periodDays,
    ...summarizeAttendance(result.rows, periodDays, missingPolicy),
  };
}

/**
 * Read the installation's missing-attendance policy from system_settings.
 * Defaults to "unpaid" — a day with no record is NOT auto-counted as present.
 */
async function getMissingAttendancePolicy(query) {
  try {
    const res = await query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'payroll_missing_attendance_policy'"
    );
    const value = res.rows && res.rows[0] ? res.rows[0].setting_value : null;
    return value === 'present' ? 'present' : 'unpaid';
  } catch (_) {
    return 'unpaid';
  }
}

module.exports = {
  STATUS_DAY_WEIGHT,
  MISSING_WEIGHT,
  normalizePayrollMonth,
  monthBounds,
  summarizeAttendance,
  resolveAttendanceDays,
  getMissingAttendancePolicy,
};
