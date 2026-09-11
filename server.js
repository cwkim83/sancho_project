// 산초(Sancho) v0.1 — 챗창 있는 대시보드.
// 두뇌는 이 컴퓨터에 설치된 Claude Code(본인 구독 로그인)다. API 키도 관문(게이트웨이)도 없다.
// 산초가 직접 하는 일은 넷뿐: 화면 · 시계(예약) · 기억 · 알림. 생각과 도구 실행은 전부 Claude Code 가 한다.
// 의존 패키지 0. Node 18 이상.
import { createServer } from 'node:http';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.SANCHO_DATA || join(ROOT, 'data');   // 산초의 모든 상태는 이 폴더 안 텍스트 파일이다. 지우면 초기화. (SANCHO_DATA 로 위치 변경)
const JOURNAL = join(DATA, 'journal');
mkdirSync(JOURNAL, { recursive: true });
const PORT = Number(process.env.SANCHO_PORT || 8790);

// ---------- 파일 도우미 ----------
const p = (name) => join(DATA, name);
const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, v) => writeFileSync(file, JSON.stringify(v, null, 2) + '\n');
const readText = (file) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };
const ymd = (d) => d.toLocaleDateString('sv-SE');      // YYYY-MM-DD (현지 날짜)
const hhmm = (d) => d.toTimeString().slice(0, 5);      // HH:MM

const 기본설정 = { name: '산초', model: 'sonnet', allowShell: false, allowHome: false };
const 설정 = () => ({ ...기본설정, ...readJson(p('settings.json'), {}) });
const 상태 = () => ({ session: null, runs: {}, ...readJson(p('state.json'), {}) });   // session: 이어가는 대화 id, runs: 예약별 마지막 실행 날짜
const 상태저장 = (patch) => writeJson(p('state.json'), { ...상태(), ...patch });

// ---------- Claude Code 찾기 ----------
function findClaude() {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
    return out.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || null;
  } catch { return null; }
}
const CLAUDE = process.env.SANCHO_CLAUDE || findClaude();   // SANCHO_CLAUDE: 다른 경로의 claude, 또는 시험용 가짜 두뇌(.js)
let CLAUDE_VERSION = '';
try { if (CLAUDE) CLAUDE_VERSION = execFileSync(CLAUDE, ['--version'], { encoding: 'utf8' }).trim(); } catch {}

// ---------- 시스템 프롬프트: 파일이 곧 도구다 ----------
function 시스템프롬프트() {
  const s = 설정();
  const mem = readText(p('memory.md')).slice(-6000) || '(아직 없음)';   // ponytail: 6천 자 넘으면 앞부분은 잘린다. 커지면 요약·검색으로
  return `너는 '${s.name}'다. 이 컴퓨터 주인의 개인 비서이고, 주인은 브라우저 대시보드의 채팅창으로 너와 이야기한다.
말투: 한국어 높임말, 짧게, 결론부터. 마크다운을 써도 된다.
지금 시각: ${new Date().toLocaleString('ko-KR')}

현재 작업 폴더는 ${s.name}의 데이터 폴더다. 여기 있는 파일이 곧 너의 도구다.
1) memory.md — 주인에 관해 다음에도 써야 할 사실을 "- " 로 시작하는 한 줄로 파일 끝에 덧붙인다(없으면 만든다). 기존 줄은 지우지 않는다. 주인이 "기억해" 라고 하면 반드시 적고, 적었다고 한 줄로 알린다.
2) schedule.json — 예약 작업 배열. 주인이 "매일 7시에 …해줘", "내일 9시에 …알려줘" 처럼 말하면 항목을 추가한다(없으면 만든다).
   형식: [{"id":"짧은영문id","time":"07:00","repeat":"daily","prompt":"실행할 때 너에게 줄 지시"}]
   - repeat 는 "daily"(매일) 또는 "once"(한 번). once 면 "date":"YYYY-MM-DD" 도 넣는다.
   - prompt 는 주인 말을 그대로 옮기지 말고, 나중에 네가 이 대화 없이 혼자 읽고 바로 실행할 수 있는 완전한 지시문으로 쓴다.
   - 삭제 요청이면 그 항목을 배열에서 뺀다. 추가·삭제 뒤엔 결과를 한 줄로 알린다.
   - 예약 시각이 되면 ${s.name} 서버가 prompt 를 너에게 보내 실행하고 결과를 journal/ 에 쌓아 주인에게 보여준다.
3) journal/ — 예약 실행 결과가 날짜별(YYYY-MM-DD.md) 로 쌓인다. 필요하면 읽어 참고한다.
${s.allowShell ? '명령 실행(Bash)이 허용돼 있다. 파괴적인 명령은 실행 전에 주인에게 확인한다.' : '명령 실행(Bash)은 꺼져 있다. 필요하면 주인에게 대시보드 설정에서 켜달라고 말한다.'}
${s.allowHome ? `주인의 홈 폴더(${homedir()})를 읽고 고칠 수 있다.` : '이 데이터 폴더 밖의 파일은 건드릴 수 없다.'}

지금 기억(memory.md):
${mem}
`;
}

// ---------- Claude Code 실행 ----------
let 현재 = null;   // 진행 중인 실행 { proc, kind, startedAt } — 한 번에 하나만(같은 구독·같은 파일을 쓴다)

function claude실행({ prompt, resume, onEvent }) {
  const s = 설정();
  writeFileSync(p('.system.md'), 시스템프롬프트());
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', s.model,
    '--append-system-prompt-file', p('.system.md'),
    '--allowedTools', 'Read', 'Glob', 'Grep', 'Edit', 'Write', 'WebSearch', 'WebFetch'];
  if (s.allowShell) args.push('Bash');
  if (s.allowHome) args.push('--add-dir', homedir());
  if (resume) args.push('--resume', resume);
  const env = { ...process.env };
  // Claude Code 세션 안(데스크톱 앱 등)에서 산초를 띄우면 세션 전용 환경변수가 상속돼 자식 claude 가 "중첩 실행"에 걸리거나
  // 자기 로그인을 못 찾는다(2026-09-12 실측: Not logged in). 그 경우에만 관련 변수를 전부 지운다. 평소 실행엔 아무 영향 없다.
  if (env.CLAUDECODE || env.CLAUDE_CODE_CHILD_SESSION) for (const k of Object.keys(env)) if (/^CLAUDE/.test(k) || k === 'ANTHROPIC_BASE_URL') delete env[k];
  const [cmd, pre] = CLAUDE.endsWith('.js') ? [process.execPath, [CLAUDE]] : [CLAUDE, []];   // .js 면 node 로 실행(selftest 의 가짜 두뇌)
  const proc = spawn(cmd, [...pre, ...args], { cwd: DATA, env, windowsHide: true });
  proc.stdin.on('error', () => {});
  proc.stdin.end(prompt);                                     // 지시문은 표준입력으로 — 길이 제한·따옴표 문제가 없다

  let buf = '', err = '', done = false;
  const emit = (e) => { try { onEvent(e); } catch {} };
  const 요약 = (input) => String(input?.command || input?.file_path || input?.pattern || input?.query || input?.url || input?.description || '').slice(0, 120);
  const 친절한오류 = (t) => /not logged in/i.test(t) ? `Claude Code 에 로그인이 안 돼 있어요. 터미널에서 claude 를 실행한 뒤 /login 으로 한 번만 로그인하면 됩니다. (${t})`
    : /limit/i.test(t) ? `구독 사용 한도에 닿았어요. 한도 창이 풀리면 다시 시도해 주세요. (${t})` : t;
  function handle(line) {
    let ev; try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === 'system' && ev.subtype === 'init') emit({ t: 'init', session: ev.session_id, model: ev.model });
    else if (ev.type === 'assistant') {
      if (ev.message?.model === '<synthetic>') return;   // Claude Code 가 만든 오류 문구(로그인 안 됨 등) — result 에 다시 오니 여기선 건너뛴다
      for (const c of ev.message?.content || []) {
        if (c.type === 'text' && c.text) emit({ t: 'text', text: c.text });
        else if (c.type === 'tool_use') emit({ t: 'tool', name: c.name, input: 요약(c.input) });
      }
    } else if (ev.type === 'result') {
      done = true;
      emit({ t: 'done', ok: !ev.is_error, session: ev.session_id, text: ev.is_error ? 친절한오류(String(ev.result || ev.subtype || '오류')) : '', cost: ev.total_cost_usd, ms: ev.duration_ms });
    }
  }
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(line); }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (c) => { err += c; });
  proc.on('error', (e) => { done = true; emit({ t: 'done', ok: false, text: `실행 실패: ${e.message}` }); });
  proc.on('close', (code) => {
    if (buf.trim()) handle(buf.trim());
    if (!done) emit({ t: 'done', ok: false, text: 친절한오류((err.trim() || `Claude Code 가 코드 ${code} 로 끝났어요(■ 로 중지됐거나 로그인 문제일 수 있어요)`).slice(-1500)) });
  });
  return proc;
}

function 중지() {
  if (!현재) return false;
  const { proc } = 현재;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(proc.pid), '/t', '/f'], () => {});
  else proc.kill('SIGTERM');
  return true;
}

// ---------- 예약(시계) ----------
function 예약목록() {
  const v = readJson(p('schedule.json'), []);
  return (Array.isArray(v) ? v : [])
    .filter((j) => j && j.id && j.prompt && /^\d{1,2}:\d{2}$/.test(String(j.time || '').trim()))
    .map((j) => ({ ...j, id: String(j.id), time: String(j.time).trim().padStart(5, '0'), repeat: j.repeat === 'once' ? 'once' : 'daily' }));
}

function 예약실행(j) {
  const today = ymd(new Date());
  let out = '';
  const proc = claude실행({
    prompt: `[예약 실행] id=${j.id} 예정시각=${j.time}\n${j.prompt}\n\n결과는 주인이 나중에 대시보드에서 읽을 짧은 보고문으로 써라. 질문으로 끝내지 말 것.`,
    onEvent: (e) => {
      if (e.t === 'text') out += (out ? '\n\n' : '') + e.text;
      if (e.t === 'done') {
        현재 = null;
        appendFileSync(join(JOURNAL, `${today}.md`), `## ${hhmm(new Date())} · ${j.id}\n${e.ok ? out : `⚠️ 실패: ${e.text}`}\n\n`);
        const st = 상태(); st.runs[j.id] = today; 상태저장(st);
        if (j.repeat === 'once') writeJson(p('schedule.json'), 예약목록().filter((x) => x.id !== j.id));
      }
    },
  });
  현재 = { proc, kind: `예약 ${j.id}`, startedAt: Date.now() };
}

// 30초마다 schedule.json 을 다시 읽는다(부팅 때 한 번만 읽으면 채팅으로 추가한 예약을 못 본다).
// 서버가 꺼져 있어 놓친 회차는 켜진 뒤 첫 tick 에 1회 실행한다.
function tick() {
  if (현재) return;
  const now = new Date(), today = ymd(now), hm = hhmm(now), runs = 상태().runs;
  for (const j of 예약목록()) {
    const once = j.repeat === 'once';
    if (once && j.date && j.date > today) continue;                 // 아직 그 날이 아니다
    const 지난날 = once && j.date && j.date < today;                 // 날짜를 넘겨 놓친 1회 예약은 바로
    if (!지난날 && hm < j.time) continue;                            // 오늘 아직 시간 전
    if (runs[j.id] === today) continue;                             // 오늘 이미 했다
    return 예약실행(j);                                              // 한 번에 하나
  }
}
setInterval(tick, 30_000);
setTimeout(tick, 5_000);

// ---------- 기록 ----------
const 기록추가 = (role, text) => appendFileSync(p('history.jsonl'), JSON.stringify({ ts: new Date().toISOString(), role, text }) + '\n');
const 기록 = (n = 60) => readText(p('history.jsonl')).trim().split('\n').filter(Boolean).slice(-n)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const 일지 = (n = 2) => readdirSync(JOURNAL).filter((f) => f.endsWith('.md')).sort().slice(-n)
  .map((f) => ({ date: f.slice(0, -3), text: readText(join(JOURNAL, f)) }));

// ---------- HTTP ----------
const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'content-type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });

async function 채팅(req, res) {
  const { text } = await readBody(req);
  if (!text?.trim()) return send(res, 400, { error: '빈 메시지예요' });
  if (!CLAUDE) return send(res, 503, { error: 'Claude Code 가 설치돼 있지 않아요. README 의 설치 순서를 보세요.' });
  if (현재) return send(res, 409, { error: `지금 다른 일(${현재.kind})을 하고 있어요. ■ 를 눌러 멈추거나 끝나길 기다려 주세요.` });
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const sse = (e) => { try { res.write(`data: ${JSON.stringify(e)}\n\n`); } catch {} };
  기록추가('user', text);
  let answer = '', finished = false;
  const proc = claude실행({
    prompt: text, resume: 상태().session,
    onEvent: (e) => {
      if (finished) return;
      if (e.t === 'text') answer += (answer ? '\n\n' : '') + e.text;
      sse(e);
      if (e.t === 'done') {
        finished = true; 현재 = null;
        if (e.ok && e.session) 상태저장({ session: e.session });                    // 성공한 답만 이어간다(실패한 실행의 id 를 resume 하면 또 실패)
        else if (!e.ok && /session|resume/i.test(e.text)) 상태저장({ session: null });   // 이어가기 자체가 실패면 다음엔 새 대화로
        기록추가('assistant', e.ok ? answer : `⚠️ ${e.text}`);
        res.end();
      }
    },
  });
  현재 = { proc, kind: '채팅', startedAt: Date.now() };
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === 'GET /') return send(res, 200, readFileSync(join(ROOT, 'public', 'index.html')), 'text/html; charset=utf-8');
    if (route === 'GET /api/state') {
      const st = 상태();
      return send(res, 200, {
        claude: { path: CLAUDE, version: CLAUDE_VERSION, ok: !!CLAUDE }, settings: 설정(), session: st.session, busy: 현재 ? 현재.kind : null,
        schedules: 예약목록().map((j) => ({ ...j, lastRun: st.runs[j.id] || null })), memory: readText(p('memory.md')), journal: 일지(), history: 기록(),
      });
    }
    if (route === 'POST /api/settings') { writeJson(p('settings.json'), { ...설정(), ...(await readBody(req)) }); return send(res, 200, 설정()); }
    if (route === 'POST /api/new') { 상태저장({ session: null }); return send(res, 200, { ok: true }); }
    if (route === 'POST /api/stop') return send(res, 200, { stopped: 중지() });
    if (route === 'POST /api/schedule/remove') { const { id } = await readBody(req); writeJson(p('schedule.json'), 예약목록().filter((j) => j.id !== id)); return send(res, 200, { ok: true }); }
    if (route === 'POST /api/schedule/run') {
      const { id } = await readBody(req);
      const j = 예약목록().find((x) => x.id === id);
      if (!j) return send(res, 404, { error: '없는 예약이에요' });
      if (현재) return send(res, 409, { error: `지금 다른 일(${현재.kind})을 하고 있어요` });
      예약실행(j); return send(res, 200, { ok: true });
    }
    if (route === 'POST /api/chat') return 채팅(req, res);
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 500, { error: String(e?.message || e) }); }
}).on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log(`산초가 이미 켜져 있어요 → 브라우저에서 http://127.0.0.1:${PORT} 를 여세요`);   // 산초시작.bat 을 두 번 눌러도 놀라지 않게
  process.exit(0);
}).listen(PORT, '127.0.0.1', () => console.log(`산초 → http://127.0.0.1:${PORT}   두뇌: ${CLAUDE ? CLAUDE_VERSION : 'Claude Code 를 찾지 못했어요 (README 참고)'}`));
