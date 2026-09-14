const fs = require('fs');
let code = fs.readFileSync('selftest.js', 'utf8');

code = code.replace(
  "const cookie = loginRes.headers.get('set-cookie');",
  "const cookie = loginRes.headers.get('set-cookie'); console.log('LOGIN STATUS:', loginRes.status, await loginRes.clone().text());"
);

fs.writeFileSync('selftest.js', code);
