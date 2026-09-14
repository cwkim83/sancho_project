const fs = require('fs');
let code = fs.readFileSync('selftest.js', 'utf8');

code = code.replace(
  "assert.deepEqual(ev.map((e) => e.t), ['init', 'tool', 'delta', 'delta', 'delta', 'done'], 'SSE 이벤트 순서(글자 스트림, 통문장 중복 없음)');",
  "assert.deepEqual(ev.map((e) => e.t).filter(t => t !== 'files'), ['init', 'tool', 'delta', 'delta', 'delta', 'done'], 'SSE 이벤트 순서(글자 스트림, 통문장 중복 없음)');"
);

fs.writeFileSync('selftest.js', code);
