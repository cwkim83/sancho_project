const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');
code = code.replace(/join\(DATA, 'debug\.txt'\)/g, "'C:/Users/USER/debug.txt'");
fs.writeFileSync('server.js', code);
