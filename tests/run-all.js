// Runs every suite in this folder and prints one line per file.
//
//   node tests/run-all.js          -> Node suites only (no browser needed)
//   node tests/run-all.js --e2e    -> also the Playwright suites
//
// The Playwright suites need a static server on port 8793 serving the repo
// root (see tests/README.md) — they're skipped by default so the fast,
// dependency-free Node suites can be run anywhere without setup.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const withE2e = process.argv.includes('--e2e');
const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.js'))
  .filter((f) => f.startsWith('test_') || (withE2e && f.startsWith('e2e_')))
  .filter((f) => f !== 'test_env.js') // the harness itself, not a suite
  .sort();

let failed = 0;
for (const file of files) {
  let output = '';
  let ok = false;
  try {
    output = execFileSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8', stdio: 'pipe' });
    ok = output.includes('ALL PASS');
  } catch (e) {
    output = `${e.stdout || ''}${e.stderr || ''}`;
    ok = false;
  }
  if (ok) {
    console.log(`PASS  ${file}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${file}`);
    for (const line of output.split('\n')) {
      if (/^FAIL|Error/.test(line)) console.log(`      ${line.trim()}`);
    }
  }
}

console.log(failed === 0
  ? `\nALL ${files.length} SUITES PASS`
  : `\n${failed} of ${files.length} SUITES FAILED`);
process.exit(failed === 0 ? 0 : 1);
