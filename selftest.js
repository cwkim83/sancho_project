// 산초 자가시험 — 진짜 Claude Code 를 부르지 않는다(구독 한도를 안 쓴다).
// 이 파일 하나가 두 역할을 한다:
//   node selftest.js            → 시험 실행 (서버를 임시 폴더·8791 포트로 띄우고 검사)
//   node selftest.js -p …       → 가짜 두뇌 (server.js 가 SANCHO_CLAUDE=selftest.js 로 이 파일을 claude 대신 실행)
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
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
    if (prompt.includes('파일 만들어')) { mkdirSync('파일함', { recursive: true }); writeFileSync(join('파일함', '가짜.xlsx'), 'x'); }   // 만든 파일 알아내기 시험용(cwd = 데이터 폴더)
    // 진짜 CLI 처럼 글자 스트림(stream_event) 을 먼저 흘리고, 통문장(assistant) 도 낸다 — 서버는 스트림을 받았으면 통문장을 무시해야 한다
    const full = `가짜 답: ${prompt.trim().slice(0, 40)}${prompt.includes('[첨부 파일') ? ' +첨부' : ''}`;
    out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } });
    for (const piece of [full.slice(0, 3), full.slice(3, 6), full.slice(6)]) out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: piece } } });
    out({ type: 'assistant', message: { content: [{ type: 'text', text: full }] } });
    out({ type: 'result', subtype: 'success', is_error: false, session_id: 'fake-session-1', duration_ms: 12, total_cost_usd: 0 });
  });
}

// ---------- 시험 ----------
async function 시험() {
  // 0) 화면 스크립트 문법 — 파이스에서 ')' 하나로 화면이 통째로 죽은 적이 있다(2026-09-11). 실행 중 오류까지는 못 잡는다.
  const PUB = join(dirname(HERE), 'public');
  const 화면들 = ['index.html', 'wbs.html',
    ...readdirSync(join(PUB, 'm')).filter((f) => f.endsWith('.html')).map((f) => `m/${f}`),
    ...(existsSync(join(PUB, 'm', 'tools')) ? readdirSync(join(PUB, 'm', 'tools')).filter((f) => f.endsWith('.html')).map((f) => `m/tools/${f}`) : [])];
  for (const f of 화면들) { const html = readFileSync(join(PUB, f), 'utf8'); for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) new Script(m[1], { filename: f }); }

  const data = mkdtempSync(join(tmpdir(), 'sancho-test-'));
  const PORT = 8791, BASE = `http://127.0.0.1:${PORT}`;
  // 실행 시각이 이미 지난 예약 하나 — 서버의 첫 tick(5초 뒤)에 돌아야 한다
  writeFileSync(join(data, 'schedule.json'), JSON.stringify([{ id: 'test', time: '00:00', repeat: 'daily', prompt: '보고서를 써라' }]));
  const server = spawn(process.execPath, [join(dirname(HERE), 'server.js')], {
    env: { ...process.env, SANCHO_PORT: String(PORT), SANCHO_DATA: data, SANCHO_CLAUDE: HERE, SANCHO_SKIP_SELFTEST: '1', SANCHO_TEST_USER: 'owner' }, stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    await 기다림(async () => (await fetch(`${BASE}/api/state`)).ok, 5000, '서버 기동');
    assert.equal((await (await fetch(`${BASE}/api/state`)).json()).claude.ok, true, 'SANCHO_CLAUDE 로 두뇌 경로가 잡힌다');

    // 1) 채팅: init → tool → text → done 이 SSE 로 오고, 대화 id 와 기록이 남는다
    const ev = await 채팅(BASE, '안녕');
    assert.deepEqual(ev.map((e) => e.t).filter(t => t !== 'files'), ['init', 'tool', 'delta', 'delta', 'delta', 'done'], 'SSE 이벤트 순서(글자 스트림, 통문장 중복 없음)');
    assert.equal(ev.filter((e) => e.t === 'delta').map((e) => e.text).join(''), '가짜 답: 안녕', '글자 스트림을 이으면 답 전체');
    assert.ok(ev.at(-1).ok, '완료');
    assert.equal(JSON.parse(readFileSync(join(data, 'users', 'owner', 'state.json'), 'utf8')).session, 'fake-session-1', '대화 id 저장');
    const hist = readFileSync(join(data, 'users', 'owner', 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(hist.length, 2, '기록 2줄(질문·답)'); assert.equal(hist[1].text, '가짜 답: 안녕', '기록된 답 = 글자 스트림 합');

    // 1b) 첨부: 올리면 uploads/ 에 저장되고, 채팅에 붙이면 지시문 끝에 [첨부 파일] 목록이 붙는다
    const up = await (await fetch(`${BASE}/api/upload`, { method: 'POST', headers: { 'x-name': encodeURIComponent('메모 1.txt') }, body: 'hello' })).json();
    assert.ok(up.path.startsWith('uploads/') && up.path.endsWith('-메모 1.txt'), `첨부 경로 ${up.path}`);
    assert.equal(readFileSync(join(data, up.path), 'utf8'), 'hello', '첨부 내용 저장');
    const ev1b = await 채팅(BASE, '이 파일 봐', null, [up.path]);
    assert.ok(ev1b.filter((e) => e.t === 'delta').map((e) => e.text).join('').includes('+첨부'), '첨부 목록이 두뇌에 전달된다');

    // 1b-2) 두뇌가 만든 파일은 files 이벤트로 오고, 내려받기·열기 경로는 데이터 폴더 안만 허용된다
    const ev1c = await 채팅(BASE, '파일 만들어');
    const made = ev1c.find((e) => e.t === 'files');
    assert.ok(made && made.files.some((f) => f.name === '가짜.xlsx' && f.size === 1), `만든 파일 알아내기 ${JSON.stringify(made)}`);
    assert.equal(await (await fetch(`${BASE}/api/download?path=${encodeURIComponent(up.path)}`)).text(), 'hello', '첨부 내려받기');
    assert.equal((await fetch(`${BASE}/api/download?path=${encodeURIComponent(made.files[0].path)}`)).status, 200, '만든 파일 내려받기(절대 경로)');
    assert.equal((await fetch(`${BASE}/api/download?path=${encodeURIComponent('../server.js')}`)).status, 404, '데이터 폴더 밖은 막는다');
    assert.equal((await fetch(`${BASE}/api/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '../server.js' }) })).status, 404, '밖의 파일 열기도 막는다');

    // 1d) 대화 목록: 고정·해제·삭제
    const sid0 = JSON.parse(readFileSync(join(data, 'users', 'owner', 'state.json'), 'utf8')).session;
    assert.equal((await fetch(`${BASE}/api/session/pin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: sid0, pinned: true }) })).status, 200, '고정');
    assert.equal(JSON.parse(readFileSync(join(data, 'users', 'owner', 'state.json'), 'utf8')).sessions[0].pinned, true, '고정 표시 저장');
    await fetch(`${BASE}/api/session/remove`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: sid0 }) });
    const st0 = JSON.parse(readFileSync(join(data, 'users', 'owner', 'state.json'), 'utf8'));
    assert.ok(st0.sessions.length === 0 && st0.session === null, '삭제하면 목록에서 빠지고 현재 대화도 비운다');

    // 1c) 위키·스킬 목록과 파일 읽기(그 두 폴더만)
    writeFileSync(join(data, 'wiki', '시험.md'), '# 위키 시험');
    const st1 = await (await fetch(`${BASE}/api/state`)).json();
    assert.ok(Array.isArray(st1.skills) && st1.wiki.includes('시험.md'), '위키 목록');
    assert.equal((await (await fetch(`${BASE}/api/file?path=${encodeURIComponent('wiki/시험.md')}`)).json()).text, '# 위키 시험', '위키 읽기');
    assert.equal((await fetch(`${BASE}/api/file?path=${encodeURIComponent('../server.js')}`)).status, 400, '다른 파일은 막는다');
    const g = await (await fetch(`${BASE}/api/graph`)).json();
    assert.ok(g.nodes.some((n) => n.id === '산초') && g.nodes.some((n) => n.id === 'wiki/시험.md') && g.links.length >= 2, '뇌 그래프 재료');
    assert.equal((await fetch(`${BASE}/neural.js`)).status, 200, 'neural.js 제공');

    // 1d-2) WBS: 가중 합산 진도율 · 계획 대비 · 지연 판정 · 목록 · 스냅샷/복원
    mkdirSync(join(data, 'wbs'), { recursive: true });
    writeFileSync(join(data, 'wbs', '시험공사.json'), JSON.stringify({ name: '시험 공사', items: [
      { code: '1', name: '입고', lv: 0, weight: 40 }, { code: '1.1', name: '강판', lv: 1, s: '2020-01-01', e: '2020-01-10', pct: 100 }, { code: '1.2', name: '파이프', lv: 1, s: '2020-01-01', e: '2020-01-10', pct: 50 },
      { code: '2', name: '제작', lv: 0, weight: 60 }, { code: '2.1', name: '용접', lv: 1, s: '2099-01-01', e: '2099-02-01', pct: 0 }] }));
    const w = await (await fetch(`${BASE}/api/wbs?name=${encodeURIComponent('시험공사')}`)).json();
    assert.equal(w.rows[0].pct, 75, '대단락 진도율 = 자식 균등 평균 (100+50)/2');
    assert.equal(w.ev, 30, '전체 EV = 40%×75 + 60%×0');
    assert.equal(w.pv, 40, '전체 PV = 40%×100(기간 지남) + 60%×0(미래)');
    assert.equal(w.rows[2].status, '지연', '완료일 지났는데 50% → 지연'); assert.equal(w.rows[1].status, '완료'); assert.equal(w.rows[4].status, '미시작');
    assert.equal(w.rows[0].s, '2020-01-01', '상위 기간은 후손에서'); assert.equal(w.late, 1, '지연 작업 수');
    const wl = await (await fetch(`${BASE}/api/wbs`)).json(); assert.ok(wl.length === 1 && wl[0].pct === 30, 'WBS 목록 요약');
    assert.equal((await (await fetch(`${BASE}/api/wbs/snapshot`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '시험공사' }) })).json()).ok, true, '스냅샷');
    writeFileSync(join(data, 'wbs', '시험공사.json'), JSON.stringify({ name: '시험 공사', items: [] }));
    const snap = (await (await fetch(`${BASE}/api/wbs?name=${encodeURIComponent('시험공사')}`)).json()).history[0];
    assert.equal((await (await fetch(`${BASE}/api/wbs/restore`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '시험공사', snap }) })).json()).ok, true, '복원');
    assert.equal((await (await fetch(`${BASE}/api/wbs?name=${encodeURIComponent('시험공사')}`)).json()).rows.length, 5, '복원 뒤 항목 5개');
    assert.equal((await fetch(`${BASE}/wbs.html`)).status, 200, 'wbs.html 제공');

    // 1d2) 플랫폼 저장소(/api/db) — 화면(sdb.js)과 두뇌가 같이 쓰는 곳. 쓰기·병합·목록·일괄·삭제·실시간 알림·경계
    const J = { 'content-type': 'application/json' };
    const db = (p, o) => fetch(`${BASE}/api/db${p}`, o);
    assert.equal((await db('/events/e1', { method: 'PUT', headers: J, body: JSON.stringify({ data: { title: '회의', tags: ['a'], meta: { x: 1 } } }) })).status, 200, 'db 쓰기');
    const merged = (await (await db('/events/e1', { method: 'PUT', headers: J, body: JSON.stringify({ data: { 'meta.y': 2, tags: { __union: ['b'] }, n: { __inc: 3 } }, merge: 'deep' }) })).json()).data;
    assert.deepEqual([merged.meta, merged.tags, merged.n, merged.title], [{ x: 1, y: 2 }, ['a', 'b'], 3, '회의'], 'db 깊은 병합(점 경로·배열 합치기·숫자 더하기)');
    assert.ok(merged.createdAt && merged.updatedAt, 'db 시각 도장');
    const added = await (await db('/events', { method: 'POST', headers: J, body: JSON.stringify({ data: { title: '자동 id' } }) })).json();
    assert.ok(added.id, 'db 자동 id');
    assert.equal((await (await db('/events')).json()).length, 2, 'db 목록');
    assert.equal((await (await db('/nope/x')).json()).exists, false, '없는 문서');
    assert.equal((await db('/bad%20name')).status, 400, '이상한 컬렉션 이름 거절');
    assert.equal((await (await db('/_batch', { method: 'POST', headers: J, body: JSON.stringify({ ops: [{ op: 'set', col: 'projects', id: 'p1', data: { name: '탱크' } }, { op: 'delete', col: 'events', id: 'e1' }] }) })).json()).n, 2, 'db 일괄 쓰기');
    assert.equal((await (await db('/events')).json()).length, 1, 'db 삭제 반영');
    assert.ok((await (await fetch(`${BASE}/api/search?q=${encodeURIComponent('탱크')}`)).json()).some((r) => r.type === 'projects'), '검색이 플랫폼 데이터를 찾는다');
    assert.equal((await (await fetch(`${BASE}/api/auth/me`)).json()).uid, 'owner', '/api/auth/me');
    // 실시간 알림(SSE): 구독한 뒤 쓰면 그 컬렉션 이름이 흘러온다 — 화면(onSnapshot)이 이걸로 다시 그린다
    const ac = new AbortController();
    const sse = await fetch(`${BASE}/api/db/_events`, { signal: ac.signal });
    const rdr = sse.body.getReader(), dec2 = new TextDecoder();
    let 받음 = '';
    const 읽기 = (async () => { try { while (!받음.includes('"col":"projects"')) { const { value, done } = await rdr.read(); if (done) break; 받음 += dec2.decode(value, { stream: true }); } } catch {} })();
    await db('/projects/p2', { method: 'PUT', headers: J, body: JSON.stringify({ data: { name: 'x' } }) });
    await Promise.race([읽기, new Promise((r) => setTimeout(r, 3000))]);
    assert.ok(받음.includes('"col":"projects"'), `db 변경 알림(SSE) — 받은 것: ${받음.slice(0, 120)}`);
    ac.abort();
    // 플랫폼 화면 파일 서빙과 경계
    assert.equal((await fetch(`${BASE}/m/platform.css`)).status, 200, 'platform.css 제공');
    assert.equal((await fetch(`${BASE}/m/sdb.js`)).status, 200, 'sdb.js 제공');
    assert.equal((await fetch(`${BASE}/m/../server.js`)).status, 404, '/m 밖은 못 읽는다');
    const st2 = await (await fetch(`${BASE}/api/state`)).json();
    assert.ok(Array.isArray(st2.modules) && st2.modules.includes('workflow'), '/api/state 가 만들어진 화면 목록을 준다');

    // 1d3) 로그인: 계정이 없으면 setup 모드, 기본 비밀번호는 없다. 짧은 비밀번호는 거절. 만든 뒤엔 로그인된다.
    {
      const A = (p2, b) => fetch(`${BASE}/api/auth${p2}`, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : undefined);
      assert.equal((await (await A('/status')).json()).setup, true, '계정이 없으면 setup 모드');
      assert.equal((await A('/login', { loginId: 'admin', password: 'admin123' })).status, 401, '기본 비밀번호(admin123)로는 절대 못 들어온다');
      assert.equal((await A('/setup', { name: '주인', loginId: 'boss', password: 'short' })).status, 400, '짧은 비밀번호 거절');
      const r1 = await A('/setup', { name: '주인', loginId: 'boss', password: 'longenough1' });
      assert.equal(r1.status, 200, '첫 계정 만들기');
      assert.ok(String(r1.headers.get('set-cookie') || '').includes('HttpOnly'), '세션 쿠키는 HttpOnly');
      assert.equal((await A('/setup', { name: '또', loginId: 'boss2', password: 'longenough1' })).status, 409, '계정이 생긴 뒤엔 setup 막힘');
      assert.equal((await A('/login', { loginId: 'boss', password: 'wrongpass1' })).status, 401, '틀린 비밀번호');
      assert.equal((await A('/login', { loginId: 'boss', password: 'longenough1' })).status, 200, '맞는 비밀번호');
      // 계정이 생겨도 이 컴퓨터(루프백)에서는 로그인 없이 쓸 수 있다(기본값). 스위치를 끄면 잠긴다.
      // 이 서버는 시험용 통과권(SANCHO_TEST_USER)이 있어 판정이 안 되므로, 통과권 없는 서버를 하나 더 띄워 확인한다.
      const PORT2 = PORT + 10, B2 = `http://127.0.0.1:${PORT2}`;
      const srv2 = spawn(process.execPath, [join(dirname(HERE), 'server.js')], {
        env: { ...process.env, SANCHO_PORT: String(PORT2), SANCHO_DATA: data, SANCHO_CLAUDE: HERE, SANCHO_SKIP_SELFTEST: '1', SANCHO_TEST_USER: '' }, stdio: ['ignore', 'ignore', 'ignore'],
      });
      try {
        await 기다림(async () => (await fetch(`${B2}/health`)).ok, 6000, '두 번째 서버 기동');
        assert.equal((await fetch(`${B2}/api/state`)).status, 200, '계정이 있어도 이 컴퓨터에선 쿠키 없이 열린다');
        await fetch(`${BASE}/api/settings`, { method: 'POST', headers: J, body: JSON.stringify({ localNoLogin: false }) });
        assert.equal((await fetch(`${B2}/api/state`)).status, 401, '스위치를 끄면 로그인 필요');
        assert.equal((await fetch(`${B2}/`, { redirect: 'manual' })).status, 302, '화면은 로그인 화면으로 보낸다');
        await fetch(`${BASE}/api/settings`, { method: 'POST', headers: J, body: JSON.stringify({ localNoLogin: true }) });
        assert.equal((await fetch(`${B2}/api/state`)).status, 200, '다시 켜면 열린다');
      } finally { srv2.kill(); }
    }

    // 1d4) 워크플로: 노드를 이어 붙인 흐름이 순서대로 돌고, 조건 분기·템플릿·실행 기록이 맞는지
    {
      const wf = { name: '시험 흐름', trigger: { type: 'manual' },
        nodes: [
          { id: 'n1', type: 'start', name: '시작', config: {} },
          { id: 'n2', type: 'set', name: '값', config: { value: '오늘 {{today}} / {{trigger.input}}' } },
          { id: 'n3', type: 'ai', name: '분석', config: { prompt: '정리해라: {{steps.값}}' } },
          { id: 'n4', type: 'dbWrite', name: '저장', config: { collection: 'tasks', docId: 'wf1', data: '{"title":"{{steps.분석}}"}' } },
          { id: 'n5', type: 'if', name: '판정', config: { left: '{{steps.분석}}', op: '포함', right: '가짜' } },
          { id: 'n6', type: 'journal', name: '참쪽', config: { text: '참' } },
          { id: 'n7', type: 'journal', name: '거짓쪽', config: { text: '거짓' } }],
        edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }, { from: 'n4', to: 'n5' }, { from: 'n5', to: 'n6', port: 'true' }, { from: 'n5', to: 'n7', port: 'false' }] };
      await db('/workflows/w1', { method: 'PUT', headers: J, body: JSON.stringify({ data: wf }) });
      const r = await (await fetch(`${BASE}/api/workflow/run`, { method: 'POST', headers: J, body: JSON.stringify({ id: 'w1', input: '입력값' }) })).json();
      assert.equal(r.status, '완료', `워크플로 실행 (${JSON.stringify(r)})`);
      const run = (await (await db('/workflowruns')).json()).map((x) => x.data).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
      assert.equal(run.steps.filter((s2) => s2.status === '완료').length, 6, '여섯 단계 완료(거짓쪽은 안 간다)');
      assert.ok(!run.steps.some((s2) => s2.name === '거짓쪽'), '조건이 참이면 거짓 가지는 실행하지 않는다');
      assert.ok(run.steps[1].out.includes(today()) && run.steps[1].out.includes('입력값'), '템플릿 {{today}}·{{trigger.input}} 치환');
      const saved = (await (await db('/tasks/wf1')).json()).data;
      assert.ok(String(saved.title).includes('가짜 답'), '워크플로가 만든 문서');
      assert.equal((await (await fetch(`${BASE}/api/workflow/run`, { method: 'POST', headers: J, body: JSON.stringify({ id: '없음' }) })).json()).error != null, true, '없는 워크플로는 오류');
    }

    // 1e) 접속 토큰: 설정에 있으면 API 는 토큰 없이 401, 토큰 있으면 200 (화면과 /health 는 그대로)
    writeFileSync(join(data, 'users', 'owner', 'settings.json'), JSON.stringify({ token: 't1' }));
    assert.equal((await fetch(`${BASE}/api/state`)).status, 401, '토큰 없으면 401');
    assert.equal((await fetch(`${BASE}/api/state`, { headers: { 'x-token': 't1' } })).status, 200, '토큰 있으면 200');
    assert.equal((await fetch(`${BASE}/api/state?token=t1`)).status, 200, '쿼리 토큰도 된다');
    assert.equal((await fetch(`${BASE}/health`)).status, 200, '/health 는 열려 있다');
    writeFileSync(join(data, 'users', 'owner', 'settings.json'), '{}');

    // 2) 예약: 첫 tick 에 돌아 journal 에 쌓이고 오늘 실행으로 기록된다
    const 일지 = join(data, 'users', 'owner', 'journal', `${today()}.md`);   // 예약·일지는 사용자별 폴더
    await 기다림(() => existsSync(일지) && readFileSync(일지, 'utf8').includes('· test'), 12_000, '예약 실행');   // 워크플로가 먼저 남긴 줄과 섞이지 않게 내용으로 기다린다
    assert.ok(readFileSync(일지, 'utf8').includes('· test') && readFileSync(일지, 'utf8').includes('가짜 답'), '일지 내용');
    assert.equal(JSON.parse(readFileSync(join(data, 'users', 'owner', 'state.json'), 'utf8')).runs.test, today(), '오늘 실행 기록');
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

    console.log(`산초 자가시험 통과: 화면 문법(${화면들.length}장) · 글자 스트림 · 대화 id · 기록 · 첨부 · 만든 파일·내려받기·열기 경계 · 대화 고정/삭제 · WBS(합산·EVMS·지연·이력) · 플랫폼 저장소(쓰기·병합·일괄·SSE 알림·경계) · 로그인(기본 비번 거부·setup) · 워크플로(분기·템플릿·기록) · 검색 · 위키/스킬 파일 · 뇌 그래프 · 접속 토큰 · 예약 tick · 일지 · 재시작 관문·예약 · ■ 중지 · 종료 75`);
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
