// 산초 자가시험 — 진짜 Claude Code 를 부르지 않는다(구독 한도를 안 쓴다).
// 이 파일 하나가 두 역할을 한다:
//   node selftest.js            → 시험 실행 (서버를 임시 폴더·8791 포트로 띄우고 검사)
//   node selftest.js -p …       → 가짜 두뇌 (server.js 가 SANCHO_CLAUDE=selftest.js 로 이 파일을 claude 대신 실행)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import assert from 'node:assert/strict';

const HERE = fileURLToPath(import.meta.url);
const today = () => new Date().toLocaleDateString('sv-SE');

if (process.argv.includes('-p')) 가짜두뇌();
else await 시험();

// ---------- 가짜 두뇌: claude -p --output-format stream-json 이 내는 줄을 흉내낸다 ----------
function 가짜두뇌() {
  let prompt = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { prompt += c; });
  process.stdin.on('end', async () => {
    const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
    out({ type: 'system', subtype: 'init', session_id: 'fake-session-1', model: 'fake' });
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'memory.md' } }] } });
    if (prompt.includes('천천히')) await new Promise((r) => setTimeout(r, 30_000));   // ■ 중지 시험용
    out({ type: 'assistant', message: { content: [{ type: 'text', text: `가짜 답: ${prompt.trim().slice(0, 40)}${prompt.includes('[첨부 파일') ? ' +첨부' : ''}` }] } });
    out({ type: 'result', subtype: 'success', is_error: false, session_id: 'fake-session-1', duration_ms: 12, total_cost_usd: 0 });
  });
}

// ---------- 시험 ----------
async function 시험() {
  // 0) 화면 스크립트 문법 — 파이스에서 ')' 하나로 화면이 통째로 죽은 적이 있다(2026-09-11). 실행 중 오류까지는 못 잡는다.
  const html = readFileSync(join(dirname(HERE), 'public', 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(m[1], { filename: 'index.html' });

  const data = mkdtempSync(join(tmpdir(), 'sancho-test-'));
  const PORT = 8791, BASE = `http://127.0.0.1:${PORT}`;
  // 실행 시각이 이미 지난 예약 하나 — 서버의 첫 tick(5초 뒤)에 돌아야 한다
  writeFileSync(join(data, 'schedule.json'), JSON.stringify([{ id: 'test', time: '00:00', repeat: 'daily', prompt: '보고서를 써라' }]));
  const server = spawn(process.execPath, [join(dirname(HERE), 'server.js')], {
    env: { ...process.env, SANCHO_PORT: String(PORT), SANCHO_DATA: data, SANCHO_CLAUDE: HERE, SANCHO_SKIP_SELFTEST: '1' }, stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    await 기다림(async () => (await fetch(`${BASE}/api/state`)).ok, 5000, '서버 기동');
    assert.equal((await (await fetch(`${BASE}/api/state`)).json()).claude.ok, true, 'SANCHO_CLAUDE 로 두뇌 경로가 잡힌다');

    // 1) 채팅: init → tool → text → done 이 SSE 로 오고, 대화 id 와 기록이 남는다
    const ev = await 채팅(BASE, '안녕');
    assert.deepEqual(ev.map((e) => e.t), ['init', 'tool', 'text', 'done'], 'SSE 이벤트 순서');
    assert.ok(ev[2].text.includes('안녕') && ev[3].ok, '답과 완료');
    assert.equal(JSON.parse(readFileSync(join(data, 'state.json'), 'utf8')).session, 'fake-session-1', '대화 id 저장');
    assert.equal(readFileSync(join(data, 'history.jsonl'), 'utf8').trim().split('\n').length, 2, '기록 2줄(질문·답)');

    // 1b) 첨부: 올리면 uploads/ 에 저장되고, 채팅에 붙이면 지시문 끝에 [첨부 파일] 목록이 붙는다
    const up = await (await fetch(`${BASE}/api/upload`, { method: 'POST', headers: { 'x-name': encodeURIComponent('메모 1.txt') }, body: 'hello' })).json();
    assert.ok(up.path.startsWith('uploads/') && up.path.endsWith('-메모 1.txt'), `첨부 경로 ${up.path}`);
    assert.equal(readFileSync(join(data, up.path), 'utf8'), 'hello', '첨부 내용 저장');
    const ev1b = await 채팅(BASE, '이 파일 봐', null, [up.path]);
    assert.ok(ev1b.find((e) => e.t === 'text')?.text.includes('+첨부'), '첨부 목록이 두뇌에 전달된다');

    // 1c) 위키·스킬 목록과 파일 읽기(그 두 폴더만)
    writeFileSync(join(data, 'wiki', '시험.md'), '# 위키 시험');
    const st1 = await (await fetch(`${BASE}/api/state`)).json();
    assert.ok(Array.isArray(st1.skills) && st1.wiki.includes('시험.md'), '위키 목록');
    assert.equal((await (await fetch(`${BASE}/api/file?path=${encodeURIComponent('wiki/시험.md')}`)).json()).text, '# 위키 시험', '위키 읽기');
    assert.equal((await fetch(`${BASE}/api/file?path=${encodeURIComponent('../server.js')}`)).status, 400, '다른 파일은 막는다');

    // 2) 예약: 첫 tick 에 돌아 journal 에 쌓이고 오늘 실행으로 기록된다
    const 일지 = join(data, 'journal', `${today()}.md`);
    await 기다림(() => existsSync(일지), 12_000, '예약 실행');
    assert.ok(readFileSync(일지, 'utf8').includes('· test') && readFileSync(일지, 'utf8').includes('가짜 답'), '일지 내용');
    assert.equal(JSON.parse(readFileSync(join(data, 'state.json'), 'utf8')).runs.test, today(), '오늘 실행 기록');
    await 기다림(async () => (await (await fetch(`${BASE}/api/state`)).json()).busy === null, 3000, '예약 뒤 한가함');

    // 3) 재시작 예약 + ■ 중지: 일하는 중에 재시작을 요청하면 관문을 지나 "끝나면" 으로 예약되고,
    //    ■ 로 끊으면 3초 안에 done(ok=false) 이 오고, 일이 끝났으니 서버가 코드 75 로 종료된다(산초시작.bat 이 다시 켠다)
    const exited = new Promise((r) => server.on('exit', r));
    let tStop = 0, rr = null;
    const ev2 = await 채팅(BASE, '천천히 답해', async (e) => {
      if (e.t !== 'tool') return;
      rr = await (await fetch(`${BASE}/api/restart`, { method: 'POST' })).json();
      tStop = Date.now(); await fetch(`${BASE}/api/stop`, { method: 'POST' });
    });
    assert.equal(rr?.ok, true, `재시작 관문 통과 (${JSON.stringify(rr)})`);
    assert.ok(/끝나면/.test(rr.when), '일하는 중엔 재시작을 예약한다');
    assert.equal(ev2.at(-1).t, 'done', '중지 뒤 done');
    assert.equal(ev2.at(-1).ok, false, '중지되면 실패로 끝난다');
    assert.ok(Date.now() - tStop < 3000, `3초 안에 끊긴다 (${Date.now() - tStop}ms)`);
    assert.equal(await exited, 75, '일이 끝나면 코드 75 로 종료(재시작 요청)');

    console.log('산초 자가시험 통과: 화면 문법 · 채팅 SSE · 대화 id · 기록 · 첨부 · 위키/스킬 파일 · 예약 tick · 일지 · 재시작 관문·예약 · ■ 중지 · 종료 75');
  } finally {
    server.kill();
    rmSync(data, { recursive: true, force: true });
  }
}

async function 채팅(BASE, text, onEvent, files) {
  const r = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, files }) });
  assert.equal(r.status, 200, `채팅 응답 ${r.status}`);
  const events = [];
  let buf = '';
  for await (const chunk of r.body) {
    buf += Buffer.from(chunk).toString('utf8');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (!line.startsWith('data: ')) continue;
      const e = JSON.parse(line.slice(6)); events.push(e);
      if (onEvent) await onEvent(e);
    }
  }
  return events;
}

async function 기다림(cond, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await cond()) return; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  throw new Error(`${what}: ${ms}ms 안에 안 됨`);
}
