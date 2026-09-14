const fs = require('fs');
const path = require('path');
let code = fs.readFileSync('server.js', 'utf8');

// 1. Imports
if (!code.includes('node:crypto')) {
  code = code.replace(
    "import { fileURLToPath } from 'node:url';",
    "import { fileURLToPath } from 'node:url';\nimport { scryptSync, randomBytes, randomUUID } from 'node:crypto';\nimport { AsyncLocalStorage } from 'node:async_hooks';"
  );
}

// 2. AsyncLocalStorage
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

// 3. Hash functions
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

// 4. Wrap with sessionContext
if (!code.includes('const token = (req.headers.cookie')) {
  // Find where try { starts
  code = code.replace(
    "  try {\n    if (route === 'GET /')",
    `  const token = (req.headers.cookie || '').split(';').find(c => c.trim().startsWith('sancho_session='))?.split('=')[1] || req.headers['x-session'];
  let uid = SESSIONS.get(token);

  sessionContext.run(uid, async () => {
    try {
      if (route === 'GET /api/auth/me') {
        if (!uid) return send(res, 401, { error: 'Not logged in' });
        const u = readJson(join(DB, 'users.json'), {})[uid];
        if (!u) return send(res, 401, { error: 'User deleted' });
        const { passwordHash, salt, ...safeUser } = u;
        return send(res, 200, { uid, ...safeUser });
      }
      if (route === 'POST /api/auth/login') {
        const { loginId, password } = await readBody(req);
        const users = readJson(join(DB, 'users.json'), {});
        let userEntry = Object.entries(users).find(([k, v]) => v.loginId === loginId);
        
        // Auto-seed
        if (!userEntry && Object.keys(users).length === 0 && loginId === 'admin' && password === 'admin123') {
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

      if (route === 'GET /')`
  );
  
  // replace the closing bracket of the try-catch for createServer
  code = code.replace(
    "  } catch (e) { send(res, 500, { error: String(e?.message || e) }); }\n}).on('error',",
    "  } catch (e) { send(res, 500, { error: String(e?.message || e) }); }\n  });\n}).on('error',"
  );
}

// 5. Replace 127.0.0.1 with 0.0.0.0
code = code.replace(/'127\.0\.0\.1'/g, "'0.0.0.0'");

// Remove /api/me as it's replaced by /api/auth/me
// We need to carefully match it.
code = code.replace(
  /    if \(route === 'GET \/api\/me'\) \{ const s = 설정\(\); return send\(res, 200, \{ uid: 'owner', name: s.owner\?\.name \|\| '주인', title: s.owner\?\.title \|\| '', dept: s.owner\?\.dept \|\| '', company: s.owner\?\.company \|\| '', email: s.owner\?\.email \|\| '', sancho: s.name \}\); \}\n/,
  ""
);

fs.writeFileSync('server.js', code);
console.log('server.js updated');
