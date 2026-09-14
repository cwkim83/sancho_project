const fs = require('fs');
let code = fs.readFileSync('public/index.html', 'utf8');

// 1. Auth Guard
const authGuard = `
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          window.location.href = '/login.html';
          return false;
        }
        me = await res.json();
        ownerUI();
        return true;
      } catch (e) {
        window.location.href = '/login.html';
        return false;
      }
    }
`;

if (!code.includes('checkAuth()')) {
  code = code.replace("let me = null, depts = [], 있는모듈 = [], 배지 = {};", "let me = null, depts = [], 있는모듈 = [], 배지 = {};\n" + authGuard);
  // insert checkAuth() at the very beginning of DOMContentLoaded
  code = code.replace("document.addEventListener('DOMContentLoaded', () => {", "document.addEventListener('DOMContentLoaded', async () => {\n      if (!(await checkAuth())) return;");
}

// 2. Add logout to ownerUI
if (!code.includes("로그아웃")) {
  code = code.replace(
    /document\.getElementById\('ownerChip'\)\.innerHTML = `[^`]+`;/,
    `document.getElementById('ownerChip').innerHTML = \`
      <div class="avatar" style="background: \${me.color || 'var(--primary)'}">\${(me.name || '유저').slice(0, 1)}</div>
      <div class="meta">
        <div class="name">\${me.name || ''} \${me.title || ''}</div>
        <div class="dept">\${me.dept || ''} \${me.company || ''}</div>
        <button id="logoutBtn" style="background:none;border:none;color:var(--text-muted);font-size:0.75rem;cursor:pointer;padding:0;text-align:left;margin-top:2px;">로그아웃</button>
      </div>\`;
    
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login.html';
    });`
  );
}

fs.writeFileSync('public/index.html', code);
console.log('index.html updated');
