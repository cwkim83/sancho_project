const fs = require('fs');
let code = fs.readFileSync('selftest.js', 'utf8');

code = code.replace(
  "await 기다림(async () => (await fetch(`${BASE}/api/state`)).ok",
  "await 기다림(async () => (await fetch(`${BASE}/health`)).ok"
);

fs.writeFileSync('selftest.js', code);
console.log('selftest fixed');
