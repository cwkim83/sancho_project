const fs = require('fs');
let code = fs.readFileSync('selftest.js', 'utf8');

code = code.replace(
  "assert.equal((await (await fetch(`${BASE}/api/me`)).json()).uid, 'owner', '/api/me');",
  "assert.equal((await (await fetch(`${BASE}/api/auth/me`)).json()).uid, 'owner', '/api/auth/me');"
);

fs.writeFileSync('selftest.js', code);
