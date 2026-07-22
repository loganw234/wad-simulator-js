// Zero-dependency test runner.  `npm test`  /  `node test/run.js [filter]`

const filter = process.argv[2];
let pass = 0, fail = 0;
const failures = [];

const fmt = (v) => {
  const s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  return s.length > 200 ? s.slice(0, 200) + `… (${s.length} chars)` : s;
};

const t = {
  ok(name, cond, detail = '') {
    if (cond) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); }
    else { fail++; failures.push(name); console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? '\n        ' + detail : ''}`); }
  },
  eq(name, got, want) {
    this.ok(name, Object.is(got, want) || got === want, `got ${fmt(got)}\n        want ${fmt(want)}`);
  },
  info(msg) { console.log(`       \x1b[2m${msg}\x1b[0m`); },
};

const SUITES = ['roundtrip.test.js'];
for (const s of SUITES) {
  if (filter && !s.includes(filter)) continue;
  console.log(`\n\x1b[1m${s}\x1b[0m`);
  try {
    const mod = await import(`./${s}`);
    await mod.run(t);
  } catch (e) {
    fail++; failures.push(`${s} (suite threw)`);
    console.log(`  \x1b[31mFAIL\x1b[0m suite threw: ${e.stack}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
