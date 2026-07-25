#!/usr/bin/env node
/**
 * tools/generate-keypair.js
 * One-time script to generate an RSA-2048 key pair for license signing.
 * 
 * Usage:  node tools/generate-keypair.js
 * 
 * Output:
 *   tools/private.pem  — YOUR private key (NEVER distribute this!)
 *   tools/public.pem   — Public key (embedded in the app)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const toolsDir = __dirname;
const privatePath = path.join(toolsDir, 'private.pem');
const publicPath = path.join(toolsDir, 'public.pem');

// Safety check — don't overwrite existing keys
if (fs.existsSync(privatePath)) {
  console.error('❌ private.pem already exists! Delete it first if you want to regenerate.');
  console.error('   WARNING: Regenerating will invalidate ALL previously issued license keys.');
  process.exit(1);
}

console.log('🔑 Generating RSA-2048 key pair...\n');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});

fs.writeFileSync(privatePath, privateKey, { mode: 0o600 });
fs.writeFileSync(publicPath, publicKey);

console.log('✅ Key pair generated successfully!\n');
console.log(`   Private key: ${privatePath}`);
console.log(`   Public key:  ${publicPath}`);
console.log('\n⚠️  IMPORTANT:');
console.log('   • NEVER share or commit private.pem');
console.log('   • The public key is embedded in the app for verification');
console.log('   • If you lose the private key, you cannot generate new licenses');
console.log('\n📋 Next step: Copy the contents of public.pem into src/utils/licenseKeys.js');
