const fs = require('fs');
let code = fs.readFileSync('selftest.js', 'utf8');

code = code.replace(
  "console.log('HEALTH:', r.status); return r.ok;",
  "const t = await r.text(); console.log('HEALTH:', r.status, t); return r.ok;"
);

fs.writeFileSync('selftest.js', code);
