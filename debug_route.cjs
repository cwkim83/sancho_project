const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

code = code.replace(
  "  sessionContext.run(uid, async () => {\n    try {\n      if (route === 'GET /api/auth/me')",
  "  sessionContext.run(uid, async () => {\n    try {\n      fs.appendFileSync('C:/Users/USER/debug.txt', 'ROUTE: ' + route + '\\n');\n      if (route === 'GET /api/auth/me')"
);

fs.writeFileSync('server.js', code);
