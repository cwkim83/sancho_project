const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

code = code.replace(
  "if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')) {",
  "if (false && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')) {"
);

fs.writeFileSync('server.js', code);
