const fs = require('fs');
let code = fs.readFileSync('selftest.js', 'utf8');

code = code.replace(
  "fs.mkdirSync",
  "mkdirSync"
);

fs.writeFileSync('selftest.js', code);
