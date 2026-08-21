/**
 * scripts/build.js
 * Cross-platform build script for Electron executable
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('🚀 Starting full production build...\n');

// 1. Build frontend
console.log('📦 Step 1/3: Building frontend with Vite...');
execSync('npm run build:frontend', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });

// 2. Prepare isolated temp build output directory
const tempBuildDir = path.join(os.tmpdir(), 'electron-build-output');
if (fs.existsSync(tempBuildDir)) {
  fs.rmSync(tempBuildDir, { recursive: true, force: true });
}
fs.mkdirSync(tempBuildDir, { recursive: true });

// 3. Run electron-builder
const extraArgs = process.argv.slice(2).join(' ');
console.log(`\n⚡ Step 2/3: Packaging executable with electron-builder (${extraArgs || 'default'})...`);
execSync(`npx electron-builder --config.directories.output="${tempBuildDir}" ${extraArgs}`, {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..')
});

// 4. Copy build artifacts to ./electron-dist
console.log('\n📂 Step 3/3: Copying output artifacts to ./electron-dist...');
const destDistDir = path.resolve(__dirname, '..', 'electron-dist');
if (!fs.existsSync(destDistDir)) {
  fs.mkdirSync(destDistDir, { recursive: true });
}

const files = fs.readdirSync(tempBuildDir);
for (const file of files) {
  const srcPath = path.join(tempBuildDir, file);
  const destPath = path.join(destDistDir, file);
  if (fs.statSync(srcPath).isDirectory()) {
    fs.cpSync(srcPath, destPath, { recursive: true, force: true });
  } else {
    fs.copyFileSync(srcPath, destPath);
  }
}

console.log('\n🎉 Build completed successfully!');
console.log('───────────────────────────────────────────────────────');
console.log('Installer and executable available at:');
console.log(destDistDir);
const artifactFiles = fs.readdirSync(destDistDir).filter(f => !f.startsWith('.'));
artifactFiles.forEach(art => console.log(`  ✓ ${art}`));
console.log('───────────────────────────────────────────────────────\n');
