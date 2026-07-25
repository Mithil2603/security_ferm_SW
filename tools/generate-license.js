#!/usr/bin/env node
/**
 * tools/generate-license.js
 * CLI tool to generate signed license keys for clients.
 * 
 * Usage:
 *   node tools/generate-license.js "Company Name"
 *   node tools/generate-license.js "Company Name" --expiry 2027-07-25
 *   node tools/generate-license.js "Company Name" --expiry 2027-07-25 --maxUsers 10
 *   node tools/generate-license.js "Company Name" --permanent
 * 
 * The generated key is a base64-encoded string you share with the client.
 * They paste it into the app's License Activation screen.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Parse CLI arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
📜 License Key Generator
========================

Usage:
  node tools/generate-license.js "Company Name" [options]

Options:
  --expiry YYYY-MM-DD   Set license expiry date (default: 1 year from now)
  --permanent           No expiry date (license never expires)
  --maxUsers N          Maximum allowed users (default: 50)

Examples:
  node tools/generate-license.js "ABC Security Pvt Ltd"
  node tools/generate-license.js "XYZ Guards" --expiry 2028-01-01 --maxUsers 20
  node tools/generate-license.js "My Company" --permanent
  `);
  process.exit(0);
}

// Load private key
const privatePath = path.join(__dirname, 'private.pem');
if (!fs.existsSync(privatePath)) {
  console.error('❌ private.pem not found! Run generate-keypair.js first.');
  process.exit(1);
}
const privateKey = fs.readFileSync(privatePath, 'utf8');

// Parse arguments
const companyName = args[0];
let expiryDate = null;
let maxUsers = 50;
let isPermanent = false;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--expiry' && args[i + 1]) {
    expiryDate = args[i + 1];
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
      console.error('❌ Invalid date format. Use YYYY-MM-DD');
      process.exit(1);
    }
    if (new Date(expiryDate) <= new Date()) {
      console.error('❌ Expiry date must be in the future');
      process.exit(1);
    }
    i++;
  } else if (args[i] === '--permanent') {
    isPermanent = true;
  } else if (args[i] === '--maxUsers' && args[i + 1]) {
    maxUsers = parseInt(args[i + 1], 10);
    if (isNaN(maxUsers) || maxUsers < 1) {
      console.error('❌ maxUsers must be a positive number');
      process.exit(1);
    }
    i++;
  }
}

// Default: 1 year from now if not specified
if (!isPermanent && !expiryDate) {
  const oneYear = new Date();
  oneYear.setFullYear(oneYear.getFullYear() + 1);
  expiryDate = oneYear.toISOString().split('T')[0];
}

// Build license payload
const payload = {
  company: companyName,
  maxUsers,
  issuedAt: new Date().toISOString(),
  licenseId: crypto.randomUUID(),
};

if (!isPermanent) {
  payload.expiresAt = expiryDate;
}

// Sign the payload
const payloadString = JSON.stringify(payload);
const sign = crypto.createSign('SHA256');
sign.update(payloadString);
sign.end();
const signature = sign.sign(privateKey, 'base64');

// Combine payload + signature into a single license key
const licenseData = {
  payload,
  signature,
};

const licenseKey = Buffer.from(JSON.stringify(licenseData)).toString('base64');

// Output
console.log('\n✅ License Key Generated Successfully!\n');
console.log('═══════════════════════════════════════════════════');
console.log(`  Company:    ${companyName}`);
console.log(`  Max Users:  ${maxUsers}`);
console.log(`  Issued:     ${payload.issuedAt}`);
console.log(`  Expires:    ${isPermanent ? '♾️  PERMANENT (never expires)' : expiryDate}`);
console.log(`  License ID: ${payload.licenseId}`);
console.log('═══════════════════════════════════════════════════\n');
console.log('📋 LICENSE KEY (share this with the client):\n');
console.log('─────────────────────────────────────────────');
console.log(licenseKey);
console.log('─────────────────────────────────────────────\n');
