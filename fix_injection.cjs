const fs = require('fs');
let code = fs.readFileSync('selftest.js', 'utf8');

// Move the injection
code = code.replace(
  `    const loginRes = await fetch(\`\${BASE}/api/auth/login\`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loginId: 'admin', password: 'admin123' }) });
    const cookie = loginRes.headers.get('set-cookie');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      const headers = new Headers(opts.headers || {});
      if (cookie) headers.set('cookie', cookie);
      return originalFetch(url, { ...opts, headers });
    };`,
  ""
);

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

code = code.replace(
  "await 기다림(async () => (await fetch(`${BASE}/health`)).ok, 5000, '서버 기동');",
  "await 기다림(async () => (await fetch(`${BASE}/health`)).ok, 5000, '서버 기동');\n" + injection
);

fs.writeFileSync('selftest.js', code);
console.log('selftest.js patched again');
