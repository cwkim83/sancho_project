const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

code = code.replace(
  "const [id, u] = userEntry; console.log('L",
  "const [id, u] = userEntry; fs.appendFileSync(join(DATA, 'debug.txt'), 'LOGIN: ' + JSON.stringify({loginId, password, id, u, verify: verifyPassword(password, u.salt, u.passwordHash)}) + '\\n'); console.log('L"
);
code = code.replace(
  "if (!userEntry) return send(res, 401, { error: '아이디 또는 비밀번호가 틀렸습니다.' });",
  "if (!userEntry) { fs.appendFileSync(join(DATA, 'debug.txt'), 'LOGIN FAIL NO ENTRY: ' + JSON.stringify({loginId, password}) + '\\n'); return send(res, 401, { error: '아이디 또는 비밀번호가 틀렸습니다.' }); }"
);

fs.writeFileSync('server.js', code);
