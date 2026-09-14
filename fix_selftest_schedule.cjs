const fs = require('fs');
let code = fs.readFileSync('selftest.js', 'utf8');

code = code.replace(
  "writeFileSync(join(data, 'schedule.json')",
  "fs.mkdirSync(join(data, 'users', 'owner'), { recursive: true });\n  writeFileSync(join(data, 'users', 'owner', 'schedule.json')"
);

fs.writeFileSync('selftest.js', code);
