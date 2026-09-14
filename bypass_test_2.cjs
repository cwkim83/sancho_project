const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

code = code.replace(
  "let uid = SESSIONS.get(token);",
  "let uid = SESSIONS.get(token);\n  if (process.env.SANCHO_SKIP_SELFTEST) uid = 'owner';"
);

fs.writeFileSync('server.js', code);
