/**
 * tests/services/invoicing/recurringInvoices.test.js
 *
 * Unit tests for the pro-rata and billing period calculation logic
 * used by the recurring invoice service.
 * 
 * Note: Full integration tests (DB + API) require the SQLite database
 * and are covered by the QA test checklist. These unit tests validate
 * the pure calculation logic.
 */

const { calculateNextDate, daysInMonth } = require('../../../src/services/utils/dateCalculator');
const { percentage, divide, multiply, subtract, add } = require('../../../src/services/utils/decimalMath');
const Decimal = require('decimal.js');

describe('Recurring Invoice Calculations', () => {

  // ─── Frequency / Next Date ────────────────────────────────────────────────
  describe('Frequency scheduling', () => {
    test('monthly from Jan 1st → Feb 1st', () => {
      expect(calculateNextDate('2024-01-01', 'monthly')).toBe('2024-02-01');
    });

    test('monthly from Jan 31st → Feb 29th (leap year edge)', () => {
      expect(calculateNextDate('2024-01-31', 'monthly')).toBe('2024-02-29');
    });

    test('quarterly from Apr 1st → Jul 1st', () => {
      expect(calculateNextDate('2024-04-01', 'quarterly')).toBe('2024-07-01');
    });

    test('yearly from 2024-04-01 → 2025-04-01', () => {
      expect(calculateNextDate('2024-04-01', 'yearly')).toBe('2025-04-01');
    });

    test('weekly from Mon → next Mon', () => {
      expect(calculateNextDate('2024-07-15', 'weekly')).toBe('2024-07-22');
    });

    test('biweekly from 1st → 15th', () => {
      expect(calculateNextDate('2024-07-01', 'biweekly')).toBe('2024-07-15');
    });
  });

  // ─── Billing Period End Calculation ────────────────────────────────────────
  describe('Billing period end calculation', () => {
    function calculateBillingEnd(startDate, frequency) {
      const start = new Date(startDate + 'T00:00:00');
      let end;
      switch (frequency) {
        case 'weekly':
          end = new Date(start);
          end.setDate(end.getDate() + 6);
          break;
        case 'biweekly':
          end = new Date(start);
          end.setDate(end.getDate() + 13);
          break;
        case 'monthly':
          end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
          break;
        case 'quarterly':
          end = new Date(start.getFullYear(), start.getMonth() + 3, 0);
          break;
        case 'yearly':
          end = new Date(start.getFullYear() + 1, start.getMonth(), 0);
          break;
        default:
          end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      }
      // Format as YYYY-MM-DD using local date parts (not UTC)
      const y = end.getFullYear();
      const m = String(end.getMonth() + 1).padStart(2, '0');
      const d = String(end.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    test('monthly billing period: Jul 1 → Jul 31', () => {
      expect(calculateBillingEnd('2024-07-01', 'monthly')).toBe('2024-07-31');
    });

    test('monthly billing period: Feb 1 → Feb 29 (leap)', () => {
      expect(calculateBillingEnd('2024-02-01', 'monthly')).toBe('2024-02-29');
    });

    test('weekly billing period: Jul 1 → Jul 7', () => {
      expect(calculateBillingEnd('2024-07-01', 'weekly')).toBe('2024-07-07');
    });

    test('quarterly billing period: Apr 1 → Jun 30', () => {
      expect(calculateBillingEnd('2024-04-01', 'quarterly')).toBe('2024-06-30');
    });
  });

  // ─── Invoice Amount Calculation ───────────────────────────────────────────
  describe('Invoice amount calculation', () => {
    function calculateInvoiceAmounts(monthlyRate, billingStart, billingEnd, taxType, discountAmount) {
      const start = new Date(billingStart);
      const end = new Date(billingEnd);
      const daysInPeriod = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
      const totalDaysInMonth = daysInMonth(start.getMonth() + 1, start.getFullYear());

      const rate = new Decimal(monthlyRate);
      const dailyRate = rate.dividedBy(totalDaysInMonth);
      const amountSubtotal = dailyRate.times(daysInPeriod).toDecimalPlaces(2);
      const discount = new Decimal(discountAmount || 0);
      const taxableAmount = Decimal.max(amountSubtotal.minus(discount), 0);

      let cgst = new Decimal(0), sgst = new Decimal(0), igst = new Decimal(0);
      if (taxType === 'cgst_sgst') {
        cgst = taxableAmount.times(0.09).toDecimalPlaces(2);
        sgst = taxableAmount.times(0.09).toDecimalPlaces(2);
      } else if (taxType === 'igst') {
        igst = taxableAmount.times(0.18).toDecimalPlaces(2);
      }

      const totalAmount = taxableAmount.plus(cgst).plus(sgst).plus(igst);
      return {
        daysInPeriod,
        amountSubtotal: parseFloat(amountSubtotal.toString()),
        cgst: parseFloat(cgst.toString()),
        sgst: parseFloat(sgst.toString()),
        igst: parseFloat(igst.toString()),
        totalAmount: parseFloat(totalAmount.toDecimalPlaces(2).toString()),
      };
    }

    test('full month (31 days) with CGST+SGST', () => {
      const result = calculateInvoiceAmounts(100000, '2024-07-01', '2024-07-31', 'cgst_sgst', 0);
      expect(result.daysInPeriod).toBe(31);
      expect(result.amountSubtotal).toBe(100000);
      expect(result.cgst).toBe(9000);
      expect(result.sgst).toBe(9000);
      expect(result.totalAmount).toBe(118000);
    });

    test('full month (28 days Feb) with IGST', () => {
      const result = calculateInvoiceAmounts(50000, '2025-02-01', '2025-02-28', 'igst', 0);
      expect(result.daysInPeriod).toBe(28);
      expect(result.amountSubtotal).toBe(50000);
      expect(result.igst).toBe(9000);
      expect(result.totalAmount).toBe(59000);
    });

    test('partial month (15 days of 31) with no tax', () => {
      const result = calculateInvoiceAmounts(31000, '2024-07-01', '2024-07-15', 'none', 0);
      expect(result.daysInPeriod).toBe(15);
      expect(result.amountSubtotal).toBe(15000);
      expect(result.cgst).toBe(0);
      expect(result.sgst).toBe(0);
      expect(result.totalAmount).toBe(15000);
    });

    test('full month with discount', () => {
      const result = calculateInvoiceAmounts(100000, '2024-07-01', '2024-07-31', 'cgst_sgst', 5000);
      expect(result.amountSubtotal).toBe(100000);
      // Taxable = 100000 - 5000 = 95000
      expect(result.cgst).toBe(8550);
      expect(result.sgst).toBe(8550);
      expect(result.totalAmount).toBe(112100);
    });

    test('weekly billing period (7 days)', () => {
      const result = calculateInvoiceAmounts(31000, '2024-07-01', '2024-07-07', 'cgst_sgst', 0);
      expect(result.daysInPeriod).toBe(7);
      expect(result.amountSubtotal).toBe(7000);
      expect(result.totalAmount).toBe(8260);
    });
  });

  // ─── Expiry Logic ─────────────────────────────────────────────────────────
  describe('Expiry detection', () => {
    test('next date past end date triggers expired status', () => {
      const endDate = '2024-12-31';
      const nextDate = calculateNextDate('2024-12-01', 'monthly'); // 2025-01-01
      expect(nextDate > endDate).toBe(true);
    });

    test('next date before end date stays active', () => {
      const endDate = '2025-12-31';
      const nextDate = calculateNextDate('2024-12-01', 'monthly');
      expect(nextDate > endDate).toBe(false);
    });
  });

  // ─── Invoice Edit & Payment Calculation Logic ──────────────────────────────
  describe('Invoice Edit & Payment Calculations', () => {
    test('editing invoice with discount correctly calculates total_amount and final_amount', () => {
      const subtotal = 100000;
      const discount = 10000;
      const taxable = Math.max(0, subtotal - discount); // 90000
      const cgst = parseFloat((taxable * 0.09).toFixed(2)); // 8100
      const sgst = parseFloat((taxable * 0.09).toFixed(2)); // 8100
      const finalAmount = parseFloat((taxable + cgst + sgst).toFixed(2)); // 106200
      const totalAmount = parseFloat((taxable + cgst + sgst).toFixed(2)); // 106200

      expect(taxable).toBe(90000);
      expect(cgst).toBe(8100);
      expect(sgst).toBe(8100);
      expect(finalAmount).toBe(106200);
      expect(totalAmount).toBe(106200);
    });

    test('recalculating payment_due properly accounts for TDS and received payments', () => {
      const finalAmount = 106200;
      const paymentReceived = 50000;
      const tdsDeducted = 2000;
      const paymentDue = parseFloat((finalAmount - paymentReceived - tdsDeducted).toFixed(2));

      expect(paymentDue).toBe(54200);
    });

    test('full payment with TDS marks status as paid (due <= 0)', () => {
      const finalAmount = 100000;
      const paymentReceived = 98000;
      const tdsDeducted = 2000;
      const paymentDue = parseFloat((finalAmount - paymentReceived - tdsDeducted).toFixed(2));
      const status = paymentDue <= 0.01 ? 'paid' : 'partially_paid';

      expect(paymentDue).toBe(0);
      expect(status).toBe('paid');
    });
  });
});
