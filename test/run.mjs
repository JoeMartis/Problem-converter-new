// Dispatcher: runs all test suites and aggregates results.
//
// Usage:
//   npm test                # runs everything
//   node test/run.mjs --unit
//   node test/run.mjs --assignments

const args = new Set(process.argv.slice(2));
const runUnit = args.size === 0 || args.has('--unit');
const runAssignments = args.size === 0 || args.has('--assignments');

const suites = [];
if (runUnit)        suites.push((await import('./parser.test.mjs')).default);
if (runAssignments) suites.push((await import('./assignments.test.mjs')).default);

let allPassed = true;
for (const s of suites) {
    if (!s.report()) allPassed = false;
}

const total = suites.reduce((a, s) => a + s.passed + s.failed, 0);
const passed = suites.reduce((a, s) => a + s.passed, 0);
console.log('');
console.log(`\x1b[1m${passed}/${total} tests passed across ${suites.length} suite(s)\x1b[0m`);
process.exit(allPassed ? 0 : 1);
