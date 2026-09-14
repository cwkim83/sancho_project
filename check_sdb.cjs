const fs = require('fs');
let code = fs.readFileSync('public/m/sdb.js', 'utf8');

// Replace fb.me
if (!code.includes("fetch('/api/auth/me')")) {
  code = code.replace(
    /me\(\) \{ return fb\._me; \}/,
    `me() { return fb._me; }`
  );
  
  // We need to fetch /api/auth/me in sdb.js init or just replace the fallback.
  // Actually, fb._me is probably populated somewhere. Let's find out.
}
fs.writeFileSync('public/m/sdb.js', code);
