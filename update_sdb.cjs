const fs = require('fs');
let code = fs.readFileSync('public/m/sdb.js', 'utf8');

if (!code.includes("api('/api/auth/me')")) {
  code = code.replace(
    /api\('\/api\/me'\)\.then\(\(u\) => \{ auth\.currentUser = \{ uid: 'owner', email: u\.email \|\| '', displayName: u\.name \|\| '주인', photoURL: '', \.\.\.u \}; return auth\.currentUser; \}\)/,
    "api('/api/auth/me').then((u) => { auth.currentUser = { uid: u.uid || 'owner', email: u.email || '', displayName: u.name || '주인', photoURL: '', ...u }; return auth.currentUser; })"
  );
}

fs.writeFileSync('public/m/sdb.js', code);
console.log('sdb.js updated');
