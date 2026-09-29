/**
 * src/services/gst/gstComplianceService.js
 * 
 * GST Compliance Service for GSTR-1 and GSTR-3B return generation.
 * Handles:
 *  - HSN/SAC code management
 *  - Supply type classification (B2B/B2C/B2CS/B2CL/Export)
 *  - GSTR-1 JSON generation (B2B, B2CS, B2CL, HSN summary)
 *  - GSTR-3B summary generation
 *  - Filing status tracking
 */

const Decimal = require('decimal.js');
const { query } = require('../../database/connection');
const logger = require('../../utils/logger');

// Indian State Code Map (first 2 digits of GSTIN)
const STATE_CODES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
  '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
  '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam',
  '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
  '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '25': 'Daman & Diu', '26': 'Dadra & Nagar Haveli', '27': 'Maharashtra',
  '29': 'Karnataka', '30': 'Goa', '32': 'Kerala',
  '33': 'Tamil Nadu', '34': 'Puducherry', '36': 'Telangana',
  '37': 'Andhra Pradesh',
};

class GSTComplianceService {

  // ═══════════════════════════════════════════════════════════════════════════
  // HSN/SAC Code Management
  // ═══════════════════════════════════════════════════════════════════════════

  async getHSNSACCodes(filters = {}) {
    const { type, search, is_active = 1 } = filters;
    let conditions = ['is_active = $1'];
    let params = [is_active];
    let pc = 2;
    if (type) { conditions.push(`type = $${pc}`); params.push(type); pc++; }
    if (search) { conditions.push(`(code LIKE $${pc} OR description LIKE $${pc})`); params.push(`%${search}%`); pc++; }

    const result = await query(
      `SELECT * FROM hsn_sac_codes WHERE ${conditions.join(' AND ')} ORDER BY code`,
      params
    );
    return result.rows;
  }

  async addHSNSACCode(data) {
    await query(
      `INSERT INTO hsn_sac_codes (code, type, description, gst_rate, cgst_rate, sgst_rate, igst_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [data.code, data.type, data.description, data.gst_rate,
       data.cgst_rate || data.gst_rate / 2, data.sgst_rate || data.gst_rate / 2,
       data.igst_rate || data.gst_rate]
    );
    return this.getHSNSACCodes();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GST Configuration
  // ═══════════════════════════════════════════════════════════════════════════

  async getConfig() {
    const result = await query(`SELECT * FROM gst_configurations WHERE is_active = 1 ORDER BY id DESC LIMIT 1`);
    return result.rows[0] || null;
  }

  async saveConfig(data) {
    const existing = await this.getConfig();
    if (existing) {
      await query(
        `UPDATE gst_configurations SET gstin=$1, legal_name=$2, trade_name=$3, state_code=$4,
         state_name=$5, registration_type=$6, default_tax_rate=$7, financial_year=$8,
         updated_at=CURRENT_TIMESTAMP WHERE id=$9`,
        [data.gstin, data.legal_name, data.trade_name, data.state_code,
         data.state_name, data.registration_type, data.default_tax_rate,
         data.financial_year, existing.id]
      );
    } else {
      await query(
        `INSERT INTO gst_configurations (gstin, legal_name, trade_name, state_code, state_name,
         registration_type, default_tax_rate, financial_year)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [data.gstin, data.legal_name, data.trade_name, data.state_code,
         data.state_name, data.registration_type, data.default_tax_rate, data.financial_year]
      );
    }
    return this.getConfig();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Supply Type Classification
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Classify supply type based on buyer GSTIN and invoice value.
   * B2B: Registered buyer (has GSTIN)
   * B2CL: Unregistered buyer, inter-state, invoice > 2.5L
   * B2CS: Unregistered buyer, intra-state OR inter-state invoice <= 2.5L
   * EXPORT: Foreign buyer
   */
  classifySupplyType(buyerGstin, sellerStateCode, buyerStateCode, invoiceAmount) {
    if (buyerGstin && buyerGstin.length === 15) {
      return 'B2B';
    }
    if (!buyerStateCode || buyerStateCode === sellerStateCode) {
      return 'B2CS'; // intra-state unregistered
    }
    if (invoiceAmount > 250000) {
      return 'B2CL'; // inter-state unregistered > 2.5L
    }
    return 'B2CS';
  }

  /**
   * Determine tax type (CGST+SGST vs IGST).
   */
  determineTaxType(sellerStateCode, buyerStateCode) {
    if (sellerStateCode === buyerStateCode) {
      return 'cgst_sgst';
    }
    return 'igst';
  }

  /**
   * Calculate GST amounts for a given taxable value.
   */
  calculateGST(taxableValue, gstRate, taxType) {
    const D = (v) => new Decimal(v || 0);
    const val = D(taxableValue);
    const rate = D(gstRate);

    if (taxType === 'igst') {
      const igst = val.times(rate).dividedBy(100).toDecimalPlaces(2);
      return { cgst: 0, sgst: 0, igst: parseFloat(igst.toString()), total_gst: parseFloat(igst.toString()) };
    }
    const halfRate = rate.dividedBy(2);
    const cgst = val.times(halfRate).dividedBy(100).toDecimalPlaces(2);
    const sgst = val.times(halfRate).dividedBy(100).toDecimalPlaces(2);
    const total = cgst.plus(sgst).toDecimalPlaces(2);
    return {
      cgst: parseFloat(cgst.toString()),
      sgst: parseFloat(sgst.toString()),
      igst: 0,
      total_gst: parseFloat(total.toString()),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GSTR-1 Generation
  // ═══════════════════════════════════════════════════════════════════════════

  async generateGSTR1(returnPeriod) {
    const config = await this.getConfig();
    if (!config) throw new Error('GST configuration not found. Please set up GSTIN first.');

    const [year, month] = returnPeriod.split('-').map(Number);
    const fy = month >= 4 ? `${year}-${(year + 1).toString().slice(2)}` : `${year - 1}-${year.toString().slice(2)}`;

    // Get all paid/sent invoices for the period
    const invoices = await query(
      `SELECT i.*, c.name as buyer_name, c.gst_number as buyer_gstin,
              c.state_code as buyer_state_code, c.address as buyer_address
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       WHERE strftime('%Y-%m', i.invoice_date) = $1
         AND i.status IN ('sent', 'paid', 'partially_paid')
       ORDER BY i.invoice_date`,
      [returnPeriod]
    );

    // Classify and group
    const b2b = [];
    const b2cs = [];
    const b2cl = [];
    const hsnSummary = {};
    let totalTaxable = 0, totalCGST = 0, totalSGST = 0, totalIGST = 0;

    for (const inv of invoices.rows) {
      const supplyType = this.classifySupplyType(
        inv.buyer_gstin, config.state_code,
        inv.buyer_state_code || (inv.buyer_gstin ? inv.buyer_gstin.substring(0, 2) : config.state_code),
        inv.final_amount
      );
      const taxableValue = parseFloat(inv.amount_subtotal || 0);
      // Use the invoice's own stored, already-billed GST split rather than
      // recalculating from amount_subtotal × tax_rate — tax_rate is 0 on some
      // older invoices even though real GST was charged and stored in
      // cgst_amount/sgst_amount/igst_amount, so recomputing would silently
      // disagree with what the client was actually billed (and with GSTR-3B,
      // which already reads these same stored columns directly).
      const gstAmounts = {
        cgst: parseFloat(inv.cgst_amount || 0),
        sgst: parseFloat(inv.sgst_amount || 0),
        igst: parseFloat(inv.igst_amount || 0),
      };

      totalTaxable += taxableValue;
      totalCGST += gstAmounts.cgst;
      totalSGST += gstAmounts.sgst;
      totalIGST += gstAmounts.igst;

      const record = {
        invoice_number: inv.invoice_number,
        invoice_date: this._formatDate(inv.invoice_date),
        invoice_value: parseFloat(inv.final_amount || 0),
        taxable_value: taxableValue,
        tax_rate: inv.tax_rate || 18,
        cgst: gstAmounts.cgst,
        sgst: gstAmounts.sgst,
        igst: gstAmounts.igst,
        place_of_supply: inv.place_of_supply || inv.buyer_state_code || config.state_code,
        // hsn_code is what invoice creation actually populates on every real
        // invoice; sac_code is a separate, never-set column left at its
        // migration default — prefer the real value.
        sac_code: inv.hsn_code || inv.sac_code || '998525',
        supply_type: supplyType,
      };

      if (supplyType === 'B2B') {
        const existing = b2b.find(b => b.buyer_gstin === inv.buyer_gstin);
        if (existing) {
          existing.invoices.push(record);
        } else {
          b2b.push({
            buyer_gstin: inv.buyer_gstin,
            buyer_name: inv.buyer_name,
            invoices: [record],
          });
        }
      } else if (supplyType === 'B2CL') {
        b2cl.push({ ...record, buyer_name: inv.buyer_name, buyer_state: inv.buyer_state_code });
      } else {
        b2cs.push(record);
      }

      // HSN Summary
      const sac = inv.hsn_code || inv.sac_code || '998525';
      if (!hsnSummary[sac]) {
        hsnSummary[sac] = { hsn_sc: sac, desc: 'Security Services', qty: 0,
          total_val: 0, taxable_val: 0, cgst: 0, sgst: 0, igst: 0 };
      }
      hsnSummary[sac].qty++;
      hsnSummary[sac].total_val += parseFloat(inv.final_amount || 0);
      hsnSummary[sac].taxable_val += taxableValue;
      hsnSummary[sac].cgst += gstAmounts.cgst;
      hsnSummary[sac].sgst += gstAmounts.sgst;
      hsnSummary[sac].igst += gstAmounts.igst;
    }

    // Build GSTR-1 JSON (simplified government format)
    const gstr1Json = {
      gstin: config.gstin,
      fp: returnPeriod.replace('-', ''),
      gt: parseFloat((totalTaxable + totalCGST + totalSGST + totalIGST).toFixed(2)),
      b2b: b2b.map(buyer => ({
        ctin: buyer.buyer_gstin,
        inv: buyer.invoices.map(i => ({
          inum: i.invoice_number,
          idt: i.invoice_date,
          val: i.invoice_value,
          pos: i.place_of_supply,
          rchrg: 'N',
          itms: [{
            num: 1,
            itm_det: {
              txval: i.taxable_value,
              rt: i.tax_rate,
              camt: i.cgst,
              samt: i.sgst,
              iamt: i.igst,
            }
          }]
        }))
      })),
      b2cs: this._aggregateB2CS(b2cs, config.state_code),
      b2cl: b2cl.map(i => ({
        pos: i.buyer_state,
        inv: [{
          inum: i.invoice_number,
          idt: i.invoice_date,
          val: i.invoice_value,
          itms: [{
            num: 1,
            itm_det: { txval: i.taxable_value, rt: i.tax_rate, iamt: i.igst }
          }]
        }]
      })),
      hsn: { data: Object.values(hsnSummary).map((h, i) => ({ num: i + 1, ...h })) },
    };

    // Save filing record
    const existing = await query(
      `SELECT id FROM gstr_filings WHERE return_type = 'GSTR1' AND return_period = $1 AND gstin = $2`,
      [returnPeriod, config.gstin]
    );
    if (existing.rows.length > 0) {
      await query(
        `UPDATE gstr_filings SET json_data=$1, total_taxable_value=$2, total_cgst=$3,
         total_sgst=$4, total_igst=$5, total_invoices=$6, status='generated',
         generated_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$7`,
        [JSON.stringify(gstr1Json), totalTaxable, totalCGST, totalSGST, totalIGST,
         invoices.rows.length, existing.rows[0].id]
      );
    } else {
      await query(
        `INSERT INTO gstr_filings (return_type, return_period, financial_year, gstin,
         total_taxable_value, total_cgst, total_sgst, total_igst, total_invoices,
         status, json_data, generated_at)
         VALUES ('GSTR1', $1, $2, $3, $4, $5, $6, $7, $8, 'generated', $9, CURRENT_TIMESTAMP)`,
        [returnPeriod, fy, config.gstin, totalTaxable, totalCGST, totalSGST, totalIGST,
         invoices.rows.length, JSON.stringify(gstr1Json)]
      );
    }

    return {
      return_type: 'GSTR1',
      return_period: returnPeriod,
      summary: {
        total_invoices: invoices.rows.length,
        b2b_count: b2b.reduce((sum, b) => sum + b.invoices.length, 0),
        b2cs_count: b2cs.length,
        b2cl_count: b2cl.length,
        total_taxable: parseFloat(totalTaxable.toFixed(2)),
        total_cgst: parseFloat(totalCGST.toFixed(2)),
        total_sgst: parseFloat(totalSGST.toFixed(2)),
        total_igst: parseFloat(totalIGST.toFixed(2)),
        total_tax: parseFloat((totalCGST + totalSGST + totalIGST).toFixed(2)),
      },
      json: gstr1Json,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GSTR-1A Preview — read-only B2B/B2CS/B2CL breakdown for a date range, for
  // the Tax Reports screen. Unlike generateGSTR1 (which produces the official
  // filing JSON for one return period and writes a gstr_filings row), this
  // never writes anything — it's just a live reference view, and reads GST
  // straight from each invoice's own stored cgst/sgst/igst split rather than
  // recomputing it, so it can never disagree with what was actually billed.
  // ═══════════════════════════════════════════════════════════════════════════

  async previewGSTR1A(from_date, to_date) {
    const config = await this.getConfig();
    if (!config) throw new Error('GST configuration not found. Please set it up under GST Compliance → Configuration first.');

    const invoices = await query(
      `SELECT i.*, c.name as buyer_name, c.gst_number as buyer_gstin, c.state_code as buyer_state_code
       FROM invoices i
       JOIN clients c ON i.client_id = c.id
       WHERE i.invoice_date BETWEEN $1 AND $2 AND i.status != 'cancelled'
       ORDER BY i.invoice_date`,
      [from_date, to_date]
    );

    const b2b = [], b2cs = [], b2cl = [];
    let totalTaxable = 0, totalCGST = 0, totalSGST = 0, totalIGST = 0;

    for (const inv of invoices.rows) {
      const buyerState = inv.buyer_state_code || (inv.buyer_gstin ? inv.buyer_gstin.substring(0, 2) : config.state_code);
      const supplyType = this.classifySupplyType(inv.buyer_gstin, config.state_code, buyerState, inv.final_amount);

      const taxableValue = parseFloat(inv.amount_subtotal || 0);
      const cgst = parseFloat(inv.cgst_amount || 0);
      const sgst = parseFloat(inv.sgst_amount || 0);
      const igst = parseFloat(inv.igst_amount || 0);
      totalTaxable += taxableValue; totalCGST += cgst; totalSGST += sgst; totalIGST += igst;

      const record = {
        invoice_number: inv.invoice_number,
        invoice_date: this._formatDate(inv.invoice_date),
        buyer_name: inv.buyer_name,
        buyer_gstin: inv.buyer_gstin || null,
        invoice_value: parseFloat(inv.final_amount || 0),
        taxable_value: taxableValue,
        tax_rate: parseFloat(inv.tax_rate || 0),
        cgst, sgst, igst,
        place_of_supply: inv.place_of_supply || buyerState,
        supply_type: supplyType,
      };

      if (supplyType === 'B2B') b2b.push(record);
      else if (supplyType === 'B2CL') b2cl.push(record);
      else b2cs.push(record);
    }

    return {
      period: { from: from_date, to: to_date },
      b2b, b2cs, b2cl,
      summary: {
        total_invoices: invoices.rows.length,
        b2b_count: b2b.length, b2cs_count: b2cs.length, b2cl_count: b2cl.length,
        total_taxable: parseFloat(totalTaxable.toFixed(2)),
        total_cgst: parseFloat(totalCGST.toFixed(2)),
        total_sgst: parseFloat(totalSGST.toFixed(2)),
        total_igst: parseFloat(totalIGST.toFixed(2)),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GSTR-2B Preview — purchase/ITC register for a date range. Real GSTR-2B is
  // auto-drafted from what vendors report on their own GSTR-1 filings — this
  // app has no GSTN integration, so this is the self-reported equivalent:
  // every vendor bill with GST, read from the bill's own fixed split (not
  // prorated by payment), matching how a purchase register is conventionally
  // built (by bill/invoice received, not by when it was paid).
  // ═══════════════════════════════════════════════════════════════════════════

  async getGSTR2B(from_date, to_date) {
    const result = await query(
      `SELECT e.id, e.expense_date, e.description, e.amount, e.tax_type, e.tax_rate,
              e.cgst_amount, e.sgst_amount, e.igst_amount, e.is_rcm_applicable,
              v.name as vendor_name, v.tax_id as vendor_gstin
       FROM expenses e
       LEFT JOIN vendors v ON e.vendor_id = v.id
       WHERE e.expense_date BETWEEN $1 AND $2
         AND e.status != 'pending'
         AND e.tax_type IS NOT NULL AND e.tax_type != 'none'
       ORDER BY e.expense_date`,
      [from_date, to_date]
    );

    let totalTaxable = 0, totalCGST = 0, totalSGST = 0, totalIGST = 0;
    const rows = result.rows.map(r => {
      const cgst = parseFloat(r.cgst_amount || 0);
      const sgst = parseFloat(r.sgst_amount || 0);
      const igst = parseFloat(r.igst_amount || 0);
      const taxableValue = parseFloat((parseFloat(r.amount || 0) - cgst - sgst - igst).toFixed(2));
      totalTaxable += taxableValue; totalCGST += cgst; totalSGST += sgst; totalIGST += igst;
      return {
        bill_date: this._formatDate(r.expense_date),
        vendor_name: r.vendor_name || 'Unknown Vendor',
        vendor_gstin: r.vendor_gstin || 'N/A',
        description: r.description,
        taxable_value: taxableValue,
        tax_rate: parseFloat(r.tax_rate || 0),
        cgst, sgst, igst,
        is_rcm_applicable: !!r.is_rcm_applicable,
      };
    });

    return {
      period: { from: from_date, to: to_date },
      rows,
      summary: {
        bill_count: rows.length,
        total_taxable: parseFloat(totalTaxable.toFixed(2)),
        total_cgst: parseFloat(totalCGST.toFixed(2)),
        total_sgst: parseFloat(totalSGST.toFixed(2)),
        total_igst: parseFloat(totalIGST.toFixed(2)),
        total_itc: parseFloat((totalCGST + totalSGST + totalIGST).toFixed(2)),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GSTR-3B Summary
  // ═══════════════════════════════════════════════════════════════════════════

  async generateGSTR3B(returnPeriod) {
    const config = await this.getConfig();
    if (!config) throw new Error('GST configuration not found.');

    const [year, month] = returnPeriod.split('-').map(Number);
    const fy = month >= 4 ? `${year}-${(year + 1).toString().slice(2)}` : `${year - 1}-${year.toString().slice(2)}`;

    // Outward supplies
    const outward = await query(
      `SELECT 
         COALESCE(SUM(amount_subtotal), 0) as taxable,
         COALESCE(SUM(cgst_amount), 0) as cgst,
         COALESCE(SUM(sgst_amount), 0) as sgst,
         COALESCE(SUM(igst_amount), 0) as igst,
         COUNT(*) as count
       FROM invoices 
       WHERE strftime('%Y-%m', invoice_date) = $1
         AND status IN ('sent', 'paid', 'partially_paid')`,
      [returnPeriod]
    );

    // Input tax credit (from expenses/vendor bills) — expenses store the GST
    // split directly (cgst_amount/sgst_amount/igst_amount), there's no combined
    // tax_amount column to halve.
    const itc = await query(
      `SELECT
         COALESCE(SUM(cgst_amount), 0) as cgst,
         COALESCE(SUM(sgst_amount), 0) as sgst,
         COALESCE(SUM(igst_amount), 0) as igst
       FROM expenses
       WHERE strftime('%Y-%m', expense_date) = $1
         AND status != 'rejected'
         AND tax_type IS NOT NULL AND tax_type != 'none'`,
      [returnPeriod]
    );

    const out = outward.rows[0];
    const inp = itc.rows[0] || { cgst: 0, sgst: 0, igst: 0 };

    const netCGST = parseFloat(Math.max(out.cgst - inp.cgst, 0).toFixed(2));
    const netSGST = parseFloat(Math.max(out.sgst - inp.sgst, 0).toFixed(2));
    const netIGST = parseFloat(Math.max(out.igst - inp.igst, 0).toFixed(2));

    const gstr3b = {
      gstin: config.gstin,
      ret_period: returnPeriod.replace('-', ''),
      '3.1': {
        osup_det: {
          txval: parseFloat(parseFloat(out.taxable).toFixed(2)),
          camt: parseFloat(parseFloat(out.cgst).toFixed(2)),
          samt: parseFloat(parseFloat(out.sgst).toFixed(2)),
          iamt: parseFloat(parseFloat(out.igst).toFixed(2)),
        }
      },
      '4': {
        itc_avl: {
          camt: parseFloat(parseFloat(inp.cgst).toFixed(2)),
          samt: parseFloat(parseFloat(inp.sgst).toFixed(2)),
          iamt: parseFloat(parseFloat(inp.igst).toFixed(2)),
        }
      },
      '6.1': {
        tax_payable: {
          camt: netCGST,
          samt: netSGST,
          iamt: netIGST,
          total: parseFloat((netCGST + netSGST + netIGST).toFixed(2)),
        }
      }
    };

    // Save filing
    const existing = await query(
      `SELECT id FROM gstr_filings WHERE return_type = 'GSTR3B' AND return_period = $1 AND gstin = $2`,
      [returnPeriod, config.gstin]
    );
    if (existing.rows.length > 0) {
      await query(
        `UPDATE gstr_filings SET json_data=$1, total_taxable_value=$2, total_cgst=$3,
         total_sgst=$4, total_igst=$5, total_invoices=$6, status='generated',
         generated_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$7`,
        [JSON.stringify(gstr3b), out.taxable, netCGST, netSGST, netIGST, out.count, existing.rows[0].id]
      );
    } else {
      await query(
        `INSERT INTO gstr_filings (return_type, return_period, financial_year, gstin,
         total_taxable_value, total_cgst, total_sgst, total_igst, total_invoices,
         status, json_data, generated_at)
         VALUES ('GSTR3B', $1, $2, $3, $4, $5, $6, $7, $8, 'generated', $9, CURRENT_TIMESTAMP)`,
        [returnPeriod, fy, config.gstin, out.taxable, netCGST, netSGST, netIGST,
         out.count, JSON.stringify(gstr3b)]
      );
    }

    return {
      return_type: 'GSTR3B',
      return_period: returnPeriod,
      outward_supplies: {
        taxable: parseFloat(parseFloat(out.taxable).toFixed(2)),
        cgst: parseFloat(parseFloat(out.cgst).toFixed(2)),
        sgst: parseFloat(parseFloat(out.sgst).toFixed(2)),
        igst: parseFloat(parseFloat(out.igst).toFixed(2)),
      },
      input_tax_credit: {
        cgst: parseFloat(parseFloat(inp.cgst).toFixed(2)),
        sgst: parseFloat(parseFloat(inp.sgst).toFixed(2)),
        igst: parseFloat(parseFloat(inp.igst).toFixed(2)),
      },
      tax_payable: { cgst: netCGST, sgst: netSGST, igst: netIGST,
        total: parseFloat((netCGST + netSGST + netIGST).toFixed(2)) },
      json: gstr3b,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Filing Management
  // ═══════════════════════════════════════════════════════════════════════════

  async getFilings(filters = {}) {
    const { return_type, financial_year, page = 1, limit = 24 } = filters;
    let conditions = [];
    let params = [];
    let pc = 1;
    if (return_type) { conditions.push(`return_type = $${pc}`); params.push(return_type); pc++; }
    if (financial_year) { conditions.push(`financial_year = $${pc}`); params.push(financial_year); pc++; }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT id, return_type, return_period, financial_year, gstin,
              total_taxable_value, total_cgst, total_sgst, total_igst,
              total_invoices, status, filed_date, arn_number, generated_at, created_at
       FROM gstr_filings ${where}
       ORDER BY return_period DESC
       LIMIT $${pc} OFFSET $${pc + 1}`,
      [...params, parseInt(limit), offset]
    );
    return result.rows;
  }

  async getFiling(id) {
    const result = await query(`SELECT * FROM gstr_filings WHERE id = $1`, [id]);
    const filing = result.rows[0];
    if (filing && filing.json_data) {
      filing.json = JSON.parse(filing.json_data);
    }
    return filing;
  }

  async markFiled(id, arnNumber) {
    await query(
      `UPDATE gstr_filings SET status = 'filed', filed_date = CURRENT_DATE,
       arn_number = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [arnNumber, id]
    );
    return this.getFiling(id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  _aggregateB2CS(records, sellerState) {
    // B2CS is aggregated by rate + place_of_supply
    const agg = {};
    for (const r of records) {
      const key = `${r.tax_rate}-${r.place_of_supply || sellerState}`;
      if (!agg[key]) {
        agg[key] = { rt: r.tax_rate, pos: r.place_of_supply || sellerState,
          typ: 'OE', txval: 0, camt: 0, samt: 0 };
      }
      agg[key].txval += r.taxable_value;
      agg[key].camt += r.cgst;
      agg[key].samt += r.sgst;
    }
    return Object.values(agg).map(a => ({
      ...a, txval: parseFloat(a.txval.toFixed(2)),
      camt: parseFloat(a.camt.toFixed(2)), samt: parseFloat(a.samt.toFixed(2)),
    }));
  }

  _formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }
}

module.exports = new GSTComplianceService();
