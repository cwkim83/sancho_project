const fs = require('fs');
let code = fs.readFileSync('selftest.js', 'utf8');
code = code.replace(
  "assert.equal((await (await fetch(`${BASE}/api/state`)).json()).claude.ok",
  "const stateRes = await (await fetch(`${BASE}/api/state`)).text(); console.log('STATE:', stateRes); assert.equal(JSON.parse(stateRes).claude.ok"
);
fs.writeFileSync('selftest.js', code);
