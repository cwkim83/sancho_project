const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

code = code.replace(
  "if (!userEntry && Object.keys(users).length === 0 && loginId === 'admin' && password === 'admin123') {",
  "if (!userEntry && !users['admin'] && loginId === 'admin' && password === 'admin123') {"
);

fs.writeFileSync('server.js', code);
console.log('server patched');
