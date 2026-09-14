const fs = require('fs');
let code = fs.readFileSync('selftest.js', 'utf8');

const injection = `
    const loginRes = await fetch(\`\${BASE}/api/auth/login\`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loginId: 'admin', password: 'admin123' }) });
    const cookie = loginRes.headers.get('set-cookie');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      const headers = new Headers(opts.headers || {});
      if (cookie) headers.set('cookie', cookie);
      return originalFetch(url, { ...opts, headers });
    };
`;

if (!code.includes('globalThis.fetch = async')) {
  code = code.replace(/BASE = `http:\/\/127\.0\.0\.1:\$\{PORT\}`;/, `BASE = \`http://127.0.0.1:\${PORT}\`;\n${injection}`);
  code = code.replace(/assert\.equal\(\(await \(await fetch\(`\$\{BASE\}\/api\/me`\)\)\.json\(\)\)\.uid, 'owner', '\/api\/me'\);/, `assert.equal((await (await fetch(\`\${BASE}/api/auth/me\`)).json()).uid, 'admin', '/api/auth/me');`);
}
fs.writeFileSync('selftest.js', code);
console.log('selftest.js patched');
