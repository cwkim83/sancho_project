const fs = require('fs');
let code = fs.readFileSync('selftest.js', 'utf8');

code = code.replace(
  "assert.equal(JSON.parse(readFileSync(join(data, 'users', 'owner', 'state.json'), 'utf8')).runs.test, today(), '오늘 실행 기록');",
  "assert.equal(JSON.parse(readFileSync(join(data, 'state.json'), 'utf8')).runs.test, today(), '오늘 실행 기록');"
);

code = code.replace(
  "mkdirSync(join(data, 'users', 'owner'), { recursive: true });\n  writeFileSync(join(data, 'users', 'owner', 'schedule.json')",
  "writeFileSync(join(data, 'schedule.json')"
);

fs.writeFileSync('selftest.js', code);
