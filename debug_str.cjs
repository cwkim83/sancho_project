const fs = require('fs');
const s = fs.readFileSync('server.js', 'utf8');
const i = s.indexOf("if (route === 'GET /')");
console.log(JSON.stringify(s.substring(i - 20, i + 30)));
