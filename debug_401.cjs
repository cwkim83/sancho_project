const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

code = code.replace(
  "if (!uid) return send(res, 401, { error: '로그인이 필요합니다.' });",
  "if (!uid) return send(res, 401, { error: '로그인이 필요합니다.', env: process.env.SANCHO_SKIP_SELFTEST });"
);

fs.writeFileSync('server.js', code);
