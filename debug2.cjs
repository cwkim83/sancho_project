const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');
code = code.replace(
  'const [id, u] = userEntry;',
  "const [id, u] = userEntry; console.log('LOGIN CHECK:', id, u, verifyPassword(password, u.salt, u.passwordHash));"
);
fs.writeFileSync('server.js', code);
