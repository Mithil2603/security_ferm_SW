const logger = require('./logger.js');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const formatAadhar = (val) => {
  if (!val) return 'N/A';
  const str = String(val).trim();
  const digits = str.replace(/\D/g, '');
  if (digits.length === 12) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}`;
  }
  if (str.includes('X') || str.includes('x')) {
    const clean = str.replace(/[^0-9a-zA-Z]/g, '').slice(0, 12);
    const parts = [];
    for (let i = 0; i < clean.length; i += 4) {
      parts.push(clean.substring(i, i + 4));
    }
    return parts.join('-');
  }
  return str;
};

function generatePayslipPDF(payroll, employee, client, agencySettings, dataCallback, endCallback) {
  const doc = new PDFDocument({ margin: 50 });
  
  // Using standard Helvetica font to prevent missing glyph boxes
  
  doc.on('data', dataCallback);
  doc.on('end', endCallback);
  
  // Header
  doc
    .fillColor('#334155')
    .fontSize(24)
    .font('Helvetica')
    .text('PAYSLIP', 50, 50, { align: 'right' });
    
  doc
    .fontSize(10)
    .font('Helvetica')
    .text(`Month: ${new Date(payroll.payroll_month).toLocaleString('default', { month: 'long', year: 'numeric' })}`, 50, 80, { align: 'right' })
    .text(`Date Generated: ${new Date().toLocaleDateString('en-IN')}`, 50, 95, { align: 'right' });

  // Company Info
  const companyName = agencySettings?.agency_name || 'Security Firm Services';
  const companyAddress = agencySettings?.agency_address || '123 Security Avenue, Business Park\nAhmedabad, Gujarat 380015';

  let hasLogo = false;
  if (agencySettings?.agency_logo_url) {
    const logoName = path.basename(agencySettings.agency_logo_url);
    const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
    const logoPath = path.join(uploadDir, logoName);
    if (fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, 50, 50, { fit: [80, 50], align: 'left', valign: 'top' });
        hasLogo = true;
      } catch(e) {
        logger.error('Failed to embed logo in payslip PDF:', e);
      }
    }
  }

  const companyTextY = hasLogo ? 110 : 50;

  doc
    .fontSize(20)
    .font('Helvetica')
    .fillColor('#0f172a')
    .text(companyName, 50, companyTextY);
    
  doc
    .fontSize(10)
    .font('Helvetica')
    .fillColor('#64748b')
    .text(companyAddress, 50, companyTextY + 25);

  doc.moveDown(3);

  // Employee Details (Left)
  const empTop = doc.y;
  
  doc
    .fontSize(12)
    .font('Helvetica')
    .fillColor('#334155')
    .text('Employee Details:', 50, empTop);
    
  doc
    .fontSize(10)
    .font('Helvetica')
    .fillColor('#0f172a')
    .text(`Name: ${employee.full_name}`, 50, empTop + 20)
    .text(`Employee ID: ${employee.employee_id}`, 50, empTop + 35)
    .text(`Designation: ${employee.designation}`, 50, empTop + 50)
    .text(`Assigned Site: ${client ? client.name : 'Unassigned'}`, 50, empTop + 65)
    .text(`Aadhar No: ${formatAadhar(employee.aadhar_number)}`, 50, empTop + 80)
    .text(`PAN: ${employee.pan_number || 'N/A'}`, 50, empTop + 95);

  // Attendance Details (Right)
  doc
    .fontSize(12)
    .font('Helvetica')
    .fillColor('#334155')
    .text('Attendance Summary:', 350, empTop);
    
  doc
    .fontSize(10)
    .font('Helvetica')
    .fillColor('#0f172a')
    .text(`Total Days in Month: ${payroll.days_in_month}`, 350, empTop + 20)
    .text(`Days Worked: ${payroll.days_worked}`, 350, empTop + 35)
    .text(`Days Absent: ${payroll.days_absent}`, 350, empTop + 50)
    .text(`Days Leave: ${payroll.days_leave}`, 350, empTop + 65);

  doc.moveDown(4);
  const tableTop = doc.y;

  // Earnings Table (Left half)
  doc.font('Helvetica');
  generateTableRow(doc, tableTop, 'Earnings', 'Amount', 50, 250, '#f0f9ff', '#0369a1');
  
  let leftY = tableTop + 30;
  doc.font('Helvetica');

  if (Array.isArray(payroll.earnings) && payroll.earnings.length > 0) {
    payroll.earnings.forEach(e => {
      generateTableRow(doc, leftY, e.component_name, `Rs ${Number(e.amount).toLocaleString('en-IN')}`, 50, 250, '#ffffff', '#334155');
      leftY += 25;
    });
  } else {
    generateTableRow(doc, leftY, 'Basic Salary', `Rs ${Number(payroll.base_salary || 0).toLocaleString('en-IN')}`, 50, 250, '#ffffff', '#334155');
    leftY += 25;
    if (Number(payroll.da_amount) > 0) {
      generateTableRow(doc, leftY, 'Dearness Allowance (DA)', `Rs ${Number(payroll.da_amount).toLocaleString('en-IN')}`, 50, 250, '#ffffff', '#334155');
      leftY += 25;
    }
    if (Number(payroll.hra_amount) > 0) {
      generateTableRow(doc, leftY, 'House Rent Allowance (HRA)', `Rs ${Number(payroll.hra_amount).toLocaleString('en-IN')}`, 50, 250, '#ffffff', '#334155');
      leftY += 25;
    }
    let parsedAdjustments = [];
    try {
      if (payroll.adjustments) parsedAdjustments = JSON.parse(payroll.adjustments);
    } catch (e) {}
    
    const customAdditions = parsedAdjustments.filter(a => a.type === 'addition');
    if (Number(payroll.other_allowances) > 0 || customAdditions.length > 0) {
      let otherAllowRemaining = Number(payroll.other_allowances || 0);
      customAdditions.forEach(adj => {
        const label = adj.category + (adj.description ? ` (${adj.description})` : '');
        generateTableRow(doc, leftY, label, `Rs ${Number(adj.amount).toLocaleString('en-IN')}`, 50, 250, '#ffffff', '#334155');
        leftY += 25;
        otherAllowRemaining -= Number(adj.amount);
      });
      otherAllowRemaining = Math.round(otherAllowRemaining * 100) / 100;
      if (otherAllowRemaining > 0) {
        generateTableRow(doc, leftY, 'Other Allowances', `Rs ${otherAllowRemaining.toLocaleString('en-IN')}`, 50, 250, '#ffffff', '#334155');
        leftY += 25;
      }
    }
  }

  // Deductions Table (Right half)
  doc.font('Helvetica');
  generateTableRow(doc, tableTop, 'Deductions', 'Amount', 310, 240, '#fef2f2', '#b91c1c');
  
  let rightY = tableTop + 30;
  doc.font('Helvetica');

  if (Array.isArray(payroll.deductions) && payroll.deductions.length > 0) {
    payroll.deductions.forEach(d => {
      generateTableRow(doc, rightY, d.component_name, `Rs ${Number(d.amount).toLocaleString('en-IN')}`, 310, 240, '#ffffff', '#334155');
      rightY += 25;
    });
  } else {
    if (Number(payroll.pf_deduction) > 0) {
      generateTableRow(doc, rightY, 'Provident Fund (PF)', `Rs ${Number(payroll.pf_deduction).toLocaleString('en-IN')}`, 310, 240, '#ffffff', '#334155');
      rightY += 25;
    }
    if (Number(payroll.esi_deduction) > 0) {
      generateTableRow(doc, rightY, 'ESI', `Rs ${Number(payroll.esi_deduction).toLocaleString('en-IN')}`, 310, 240, '#ffffff', '#334155');
      rightY += 25;
    }
    if (Number(payroll.tax_deduction) > 0) {
      generateTableRow(doc, rightY, 'Professional Tax / TDS', `Rs ${Number(payroll.tax_deduction).toLocaleString('en-IN')}`, 310, 240, '#ffffff', '#334155');
      rightY += 25;
    }
    let parsedAdjustments = [];
    try {
      if (payroll.adjustments) parsedAdjustments = JSON.parse(payroll.adjustments);
    } catch (e) {}
    const customDeductions = parsedAdjustments.filter(a => a.type === 'deduction');
    if (Number(payroll.other_deductions) > 0 || customDeductions.length > 0) {
      let otherDeductionsRemaining = Number(payroll.other_deductions || 0);
      customDeductions.forEach(adj => {
        const label = adj.category + (adj.description ? ` (${adj.description})` : '');
        generateTableRow(doc, rightY, label, `Rs ${Number(adj.amount).toLocaleString('en-IN')}`, 310, 240, '#ffffff', '#334155');
        rightY += 25;
        otherDeductionsRemaining -= Number(adj.amount);
      });
      otherDeductionsRemaining = Math.round(otherDeductionsRemaining * 100) / 100;
      if (otherDeductionsRemaining > 0) {
        generateTableRow(doc, rightY, 'Other Deductions / Advances', `Rs ${otherDeductionsRemaining.toLocaleString('en-IN')}`, 310, 240, '#ffffff', '#334155');
        rightY += 25;
      }
    }
  }

  const maxY = Math.max(leftY, rightY);
  const totalsTop = maxY + 10;

  const grossAmt = payroll.gross_salary || payroll.total_earnings || 0;
  const deductAmt = payroll.total_deductions || 0;

  // Gross Totals
  doc.font('Helvetica');
  generateTableRow(doc, totalsTop, 'Gross Earnings', `Rs ${Number(grossAmt).toLocaleString('en-IN')}`, 50, 250, '#f8fafc', '#0f172a');
  generateTableRow(doc, totalsTop, 'Total Deductions', `Rs ${Number(deductAmt).toLocaleString('en-IN')}`, 310, 240, '#f8fafc', '#0f172a');

  // Net Pay
  const netPayTop = totalsTop + 50;
  doc.rect(50, netPayTop, 500, 40).fill('#0f766e');
  doc.fillColor('#ffffff').fontSize(14).text('Net Payable Salary', 60, netPayTop + 13);
  doc.fillColor('#ffffff').fontSize(16).text(`Rs ${Number(payroll.net_salary).toLocaleString('en-IN')}`, 390, netPayTop + 12, { width: 150, align: 'right' });

  // Bank details
  doc.fillColor('#334155').fontSize(10).font('Helvetica').text('Bank Account Details for Transfer:', 50, netPayTop + 60);
  doc.font('Helvetica').text(`Bank Name: ${employee.bank_name || 'N/A'}`, 50, netPayTop + 75);
  doc.text(`A/C No: ${employee.bank_account_number || 'N/A'}`, 50, netPayTop + 90);
  doc.text(`IFSC: ${employee.bank_ifsc_code || 'N/A'}`, 50, netPayTop + 105);

  // Footer
  doc.fontSize(9).fillColor('#94a3b8').text('This is a computer-generated document and does not require a signature.', 50, 720, { align: 'center' });

  doc.end();
}

function generateTableRow(doc, y, label, value, x, width, bgColor, textColor) {
  if (bgColor !== '#ffffff') {
    doc.rect(x, y - 5, width, 25).fill(bgColor);
  }
  doc.fillColor(textColor).text(label, x + 10, y + 2);
  doc.text(value, x + width - 100, y + 2, { width: 90, align: 'right' });
}

module.exports = {
  generatePayslipPDF
};
