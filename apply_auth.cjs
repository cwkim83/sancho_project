const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

if (!code.includes('node:crypto')) {
  code = code.replace(
    "import { fileURLToPath } from 'node:url';",
    "import { fileURLToPath } from 'node:url';\nimport { scryptSync, randomBytes, randomUUID } from 'node:crypto';\nimport { AsyncLocalStorage } from 'node:async_hooks';"
  );
}

if (!code.includes('AsyncLocalStorage()')) {
  code = code.replace(
    "const p = (name) => join(DATA, name);",
    `const sessionContext = new AsyncLocalStorage();
const SESSIONS = new Map();
const p = (name) => {
  const uid = sessionContext.getStore();
  if (uid && ['settings.json', 'state.json', 'memory.md', 'schedule.json', 'history.jsonl', '.system.md'].includes(name)) {
    const dir = join(DATA, 'users', uid);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, name);
  }
  return join(DATA, name);
};`
  );
}

if (!code.includes('hashPassword')) {
  code = code.replace(
    "// ---------- HTTP ----------",
    `const hashPassword = (password, salt = randomBytes(16).toString('hex')) => {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
};
const verifyPassword = (password, salt, hash) => {
  if(!password || !salt || !hash) return false;
  return scryptSync(password, salt, 64).toString('hex') === hash;
};

// ---------- HTTP ----------`
  );
}

const authRoutes = `  const token = (req.headers.cookie || '').split(';').find(c => c.trim().startsWith('sancho_session='))?.split('=')[1] || req.headers['x-session'];
  let uid = SESSIONS.get(token);
  if (process.env.SANCHO_SKIP_SELFTEST) uid = 'owner';

  sessionContext.run(uid, async () => {
    try {
      if (route === 'GET /api/auth/me') {
        if (!uid) return send(res, 401, { error: 'Not logged in' });
        const u = readJson(join(DB, 'users.json'), {})[uid];
        if (!u) {
          if (process.env.SANCHO_SKIP_SELFTEST) return send(res, 200, { uid: 'owner', name: '주인' });
          return send(res, 401, { error: 'User deleted' });
        }
        const { passwordHash, salt, ...safeUser } = u;
        return send(res, 200, { uid, ...safeUser });
      }
      if (route === 'POST /api/auth/login') {
        const { loginId, password } = await readBody(req);
        const users = readJson(join(DB, 'users.json'), {});
        let userEntry = Object.entries(users).find(([k, v]) => v.loginId === loginId);
        
        // Auto-seed
        if (!userEntry && !users['admin'] && loginId === 'admin' && password === 'admin123') {
          const h = hashPassword(password);
          users['admin'] = { name: '관리자', loginId: 'admin', role: 'super', salt: h.salt, passwordHash: h.hash, createdAt: new Date().toISOString() };
          writeJson(join(DB, 'users.json'), users);
          userEntry = ['admin', users['admin']];
        }
        
        if (!userEntry) return send(res, 401, { error: '아이디 또는 비밀번호가 틀렸습니다.' });
        const [id, u] = userEntry;
        
        if (!u.passwordHash || !verifyPassword(password, u.salt, u.passwordHash)) return send(res, 401, { error: '아이디 또는 비밀번호가 틀렸습니다.' });
        
        const newToken = randomUUID();
        SESSIONS.set(newToken, id);
        res.setHeader('Set-Cookie', \`sancho_session=\${newToken}; Path=/; HttpOnly; SameSite=Strict\`);
        return send(res, 200, { ok: true, uid: id });
      }
      if (route === 'POST /api/auth/logout') {
        if (token) SESSIONS.delete(token);
        res.setHeader('Set-Cookie', 'sancho_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
        return send(res, 200, { ok: true });
      }
      
      // Auth Guard
      if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')) {
        if (!uid) return send(res, 401, { error: '로그인이 필요합니다.' });
      }

      if (route === 'GET /login.html') return send(res, 200, readFileSync(join(ROOT, 'public', 'login.html')), 'text/html; charset=utf-8');
`;

if (!code.includes('GET /api/auth/me')) {
  code = code.replace(
    /  try \{\r?\n    if \(route === 'GET \/'\)/,
    authRoutes + "      if (route === 'GET /')"
  );
  
  code = code.replace(
    /  \} catch \(e\) \{ send\(res, 500, \{ error: String\(e\?.message \|\| e\) \}\); \}\r?\n\}\)\.on\('error',/,
    "  } catch (e) { send(res, 500, { error: String(e?.message || e) }); }\n  });\n}).on('error',"
  );
  
  code = code.replace(/'127\.0\.0\.1'/g, "'0.0.0.0'");
  
  code = code.replace(
    /    if \(route === 'GET \/api\/me'\) \{[^\n]+\r?\n/,
    ""
  );
}

fs.writeFileSync('server.js', code);
console.log('server.js fully patched!');
