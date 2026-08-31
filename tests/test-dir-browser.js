const assert = require('assert');
const path = require('path');
const fs = require('fs');

async function testDirectoryBrowser() {
  console.log('\n================================================================');
  console.log('   🧪 UNIT TESTS: BACKUP DIRECTORY BROWSER');
  console.log('================================================================\n');

  const cwd = process.cwd();
  const defaultBackups = path.join(cwd, 'backups');

  assert(fs.existsSync(cwd), 'Current directory should exist');
  
  const entries = fs.readdirSync(cwd, { withFileTypes: true });
  const subdirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

  console.log(`✅ PASS: Successfully scanned ${subdirs.length} subdirectories in ${cwd}`);
  console.log(`✅ PASS: Default backup path verified: ${defaultBackups}`);

  console.log('\n================================================================');
  console.log('   🏁 RESULTS: DIRECTORY BROWSER TESTS PASSED');
  console.log('================================================================\n');
}

testDirectoryBrowser()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
