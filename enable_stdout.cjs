const fs = require('fs');
let code = fs.readFileSync('selftest.js', 'utf8');

code = code.replace(
  "stdio: ['ignore', 'ignore', 'inherit']",
  "stdio: ['inherit', 'inherit', 'inherit']"
);

fs.writeFileSync('selftest.js', code);
