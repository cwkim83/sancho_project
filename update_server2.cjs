const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');
c = c.replace("if (route === 'GET /') return send(res, 200, readFileSync(join(ROOT, 'public', 'index.html')), 'text/html; charset=utf-8');",
  "if (route === 'GET /login.html') return send(res, 200, readFileSync(join(ROOT, 'public', 'login.html')), 'text/html; charset=utf-8');\n      if (route === 'GET /') return send(res, 200, readFileSync(join(ROOT, 'public', 'index.html')), 'text/html; charset=utf-8');"
);
fs.writeFileSync('server.js', c);
