const fs = require('fs');
let code = fs.readFileSync('selftest.js', 'utf8');

code = code.replace(/join\(data, 'state\.json'\)/g, "join(data, 'users', 'owner', 'state.json')");
code = code.replace(/join\(data, 'history\.jsonl'\)/g, "join(data, 'users', 'owner', 'history.jsonl')");
code = code.replace(/join\(data, 'settings\.json'\)/g, "join(data, 'users', 'owner', 'settings.json')");

fs.writeFileSync('selftest.js', code);
