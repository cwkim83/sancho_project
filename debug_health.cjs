const fs = require('fs');
let code = fs.readFileSync('selftest.js', 'utf8');

code = code.replace(
  "await 기다림(async () => (await fetch(`${BASE}/health`)).ok, 5000, '서버 기동');",
  "await 기다림(async () => { try { const r = await fetch(`${BASE}/health`); console.log('HEALTH:', r.status); return r.ok; } catch(e) { console.log('HEALTH ERR:', e.message); return false; } }, 5000, '서버 기동');"
);

fs.writeFileSync('selftest.js', code);
