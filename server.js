// 산초(Sancho) v0.1 — 챗창 있는 대시보드.
// 두뇌는 이 컴퓨터에 설치된 Claude Code(본인 구독 로그인)다. API 키도 관문(게이트웨이)도 없다.
// 산초가 직접 하는 일은 넷뿐: 화면 · 시계(예약) · 기억 · 알림. 생각과 도구 실행은 전부 Claude Code 가 한다.
// 의존 패키지 0. Node 18 이상.
import { createServer } from 'node:http';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, existsSync, statSync, cpSync, createReadStream } from 'node:fs';
import { join, dirname, resolve, sep, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.SANCHO_DATA || join(ROOT, 'data');   // 산초의 모든 상태는 이 폴더 안 텍스트 파일이다. 지우면 초기화. (SANCHO_DATA 로 위치 변경)
const JOURNAL = join(DATA, 'journal');
for (const d of [JOURNAL, join(DATA, 'uploads'), join(DATA, 'wiki'), join(DATA, '.claude', 'skills')]) mkdirSync(d, { recursive: true });   // 첨부 · 위키 · 스킬(Claude Code 가 cwd/.claude/skills 를 읽는다)
const PORT = Number(process.env.SANCHO_PORT || 8790);

// ---------- 파일 도우미 ----------
const p = (name) => join(DATA, name);
const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, v) => writeFileSync(file, JSON.stringify(v, null, 2) + '\n');
const readText = (file) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };
const ymd = (d) => d.toLocaleDateString('sv-SE');      // YYYY-MM-DD (현지 날짜)
const hhmm = (d) => d.toTimeString().slice(0, 5);      // HH:MM

const 기본설정 = { name: '산초', model: 'sonnet', effort: 'high', allowShell: false, allowHome: false, allowSelfEdit: false, allowApps: false,
  vaultPath: '', telegramToken: '', telegramChat: '', geminiKey: '', geminiModel: 'gemini-2.5-flash', token: '' };   // 연결(선택): 옵시디언 볼트 · 텔레그램 배달 · 비상두뇌(Gemini) · 외부 접속 토큰
const 모델ID = { sonnet: 'sonnet', opus: 'opus', haiku: 'haiku', fable: 'claude-fable-5-1' };   // 화면 이름 → claude --model 값
const 노력 = ['low', 'medium', 'high', 'xhigh', 'max'];                                            // claude --effort 값(2.1.269 실측)
const 연결앱 = ['mcp__claude_ai_Gmail', 'mcp__claude_ai_Google_Calendar', 'mcp__claude_ai_Google_Drive', 'mcp__claude_ai_Microsoft_365'];   // claude.ai 커넥터 서버 이름(공백·점 → _)
const ls = (dir, filter = () => true) => { try { return readdirSync(dir).filter(filter); } catch { return []; } };
// 기본 스킬(산초 폴더의 skills/*) 을 data/.claude/skills 에 처음 한 번 복사한다 — 사용자가 고친 뒤엔 덮어쓰지 않는다
for (const n of ls(join(ROOT, 'skills'))) if (!existsSync(join(DATA, '.claude', 'skills', n))) cpSync(join(ROOT, 'skills', n), join(DATA, '.claude', 'skills', n), { recursive: true });
const 설정 = () => ({ ...기본설정, ...readJson(p('settings.json'), {}) });
const 상태 = () => ({ session: null, runs: {}, sessions: [], ...readJson(p('state.json'), {}) });   // session: 지금 대화 id, sessions: 대화 목록 [{id,title,ts}], runs: 예약별 마지막 실행 날짜
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
4) .claude/skills/<이름>/SKILL.md — 스킬(다시 쓸 절차). 주인이 "이거 스킬로 저장해" 하면 방금 한 절차를 SKILL.md 로 저장한다(맨 위 --- name: 이름 / description: 한 줄 --- 머리말, 그 아래 단계). URL 이나 GitHub 의 SKILL.md 를 가져오라 하면 WebFetch 로 받아 저장한다. 저장된 스킬은 다음 대화부터 자동으로 쓸 수 있다.
5) wiki/<주제>.md — 조사·정리한 지식. 나중에도 쓸 내용이면 여기 저장·갱신하고, 관련 질문엔 먼저 여기를 본다.
6) history.jsonl — 지난 대화 기록. "전에 말한 …" 을 찾을 땐 Grep 한다.
7) uploads/ — 주인이 채팅에 올린 파일. 말 끝에 [첨부 파일] 목록이 붙으면 Read 로 읽고 답한다(이미지·PDF 도 Read 로 볼 수 있다).
8) 파일함/ — 네가 만든 파일(엑셀·PPT·워드·PDF·이미지 등)은 여기 저장한다. 만든 파일은 대시보드에 카드로 떠서 주인이 바로 열 수 있다. 만드는 법은 office-docs 스킬을 따른다.
자동 기억: 대화 중 주인에 관해 새로 알게 된 사실(선호·일정·사람·습관·목표)은 묻지 않아도 memory.md 에 한 줄 덧붙인다. 이미 있는 내용·사소한 것은 빼고, 적었으면 답 끝에 "(기억함)" 이라고 짧게 표시한다.
${s.vaultPath ? `옵시디언 볼트: ${s.vaultPath} — 주인이 "노트에 적어", "볼트에서 찾아" 하면 이 폴더의 .md 파일을 Write/Grep/Read 한다. 새 노트는 볼트 안 ${s.name}/ 폴더에 만든다.` : ''}
${s.telegramToken ? `텔레그램: 주인이 "텔레그램으로 보내" 하면 settings.json 의 telegramToken·telegramChat 으로 Bash curl -s -X POST https://api.telegram.org/bot<토큰>/sendMessage -d chat_id=<chat> --data-urlencode text=<내용> 을 호출한다(명령 실행 권한 필요).` : ''}
배달: 주인이 예약 결과를 메일 등으로 받고 싶다고 하면 prompt 에 "결과를 <채널>로 보내라" 를 넣는다. ${s.allowApps ? '연결된 앱(Gmail·Google 캘린더·드라이브·Microsoft 365) 도구를 쓸 수 있다.' : '연결된 앱(Gmail 등) 도구는 꺼져 있다. 필요하면 주인에게 설정에서 켜달라고 말한다.'}
${(s.allowShell || s.allowSelfEdit) ? '명령 실행(Bash)이 허용돼 있다. 파괴적인 명령은 실행 전에 주인에게 확인한다.' : '명령 실행(Bash)은 꺼져 있다. 필요하면 주인에게 대시보드 설정에서 켜달라고 말한다.'}
${s.allowHome ? `주인의 홈 폴더(${homedir()})를 읽고 고칠 수 있다.` : '이 데이터 폴더 밖의 파일은 건드릴 수 없다.'}
${s.allowSelfEdit ? 자기수정안내(s) : ''}
지금 기억(memory.md):
${mem}
`;
}

// 자기 수정: 도구는 새로 만들지 않는다 — Claude Code 의 Edit/Bash 가 그대로 도구다.
// 절차(검사→커밋→재시작)도 Claude 에게 맡기지 않는다 — 2026-09-12 실측: "절차대로 해줘" 라고 해도 고치고 끝냈다. 답이 끝나면 서버가 한다(자기수정마무리).
const 자기수정안내 = (s) => `
[자기 수정 허용] ${s.name}의 코드는 ${ROOT} 에 있다 — server.js(서버), public/index.html(화면), selftest.js(자가시험), README.md.
주인이 ${s.name} 자체를 고치라고 하면 Edit 로 고치고, 무엇을 바꿨는지 한 줄로 알려라. 나머지는 ${s.name} 서버가 한다:
네 답이 끝나면 서버가 바뀐 코드를 관문(node --check server.js + node selftest.js)에 통과시켜 git commit 하고 재시작한다.
관문에 걸리면 변경을 되돌리고 주인에게 이유를 보여준다. 고친 뒤 그 폴더에서 스스로 node selftest.js 를 한 번 돌려 확인하면 되돌아가는 일이 줄어든다.
재시작 뒤 서버가 안 켜지면 sancho.bat 이 마지막 정상판(git tag last-good)으로 자동 복구한다. 주인이 되돌리라 하면 git reset --hard last-good.
`;

// ---------- Claude Code 실행 ----------
let 현재 = null;   // 진행 중인 실행 { proc, kind, startedAt } — 한 번에 하나만(같은 구독·같은 파일을 쓴다)

function claude실행({ prompt, resume, model, onEvent }) {
  const s = 설정();
  writeFileSync(p('.system.md'), 시스템프롬프트());
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', 모델ID[model || s.model] || model || s.model,
    '--append-system-prompt-file', p('.system.md'),
    '--allowedTools', 'Read', 'Glob', 'Grep', 'Edit', 'Write', 'WebSearch', 'WebFetch'];
  if (s.allowShell || s.allowSelfEdit) args.push('Bash', 'PowerShell');   // Windows 의 Claude Code 는 PowerShell 도구도 먼저 집는다(2026-09-13 실측)
  if (s.allowApps) args.push(...연결앱);                 // --allowedTools 목록에 이어 붙는다(다른 플래그보다 앞이어야 함)
  if (노력.includes(s.effort)) args.push('--effort', s.effort);
  if (s.allowHome) args.push('--add-dir', homedir());
  if (s.allowSelfEdit) args.push('--add-dir', ROOT);   // 자기 코드를 고칠 수 있게 산초 폴더를 열어준다
  if (s.vaultPath && existsSync(s.vaultPath)) args.push('--add-dir', s.vaultPath);   // 옵시디언 볼트
  if (resume) args.push('--resume', resume);
  const env = { ...process.env };
  // Claude Code 세션 안(데스크톱 앱 등)에서 산초를 띄우면 세션 전용 환경변수가 상속돼 자식 claude 가 "중첩 실행"에 걸리거나
  // 자기 로그인을 못 찾는다(2026-09-12 실측: Not logged in). 그 경우에만 관련 변수를 전부 지운다. 평소 실행엔 아무 영향 없다.
  if (env.CLAUDECODE || env.CLAUDE_CODE_CHILD_SESSION) for (const k of Object.keys(env)) if (/^CLAUDE/.test(k) || k === 'ANTHROPIC_BASE_URL') delete env[k];
  const [cmd, pre] = CLAUDE.endsWith('.js') ? [process.execPath, [CLAUDE]] : [CLAUDE, []];   // .js 면 node 로 실행(selftest 의 가짜 두뇌)
  const proc = spawn(cmd, [...pre, ...args], { cwd: DATA, env, windowsHide: true });
  proc.stdin.on('error', () => {});
  proc.stdin.end(prompt);                                     // 지시문은 표준입력으로 — 길이 제한·따옴표 문제가 없다

  let buf = '', err = '', done = false, sawDelta = false, textBlocks = 0;
  const emit = (e) => { try { onEvent(e); } catch {} };
  const 요약 = (input) => String(input?.command || input?.file_path || input?.pattern || input?.query || input?.url || input?.description || '').slice(0, 120);
  const 친절한오류 = (t) => /not logged in/i.test(t) ? `Claude Code 에 로그인이 안 돼 있어요. 터미널에서 claude 를 실행한 뒤 /login 으로 한 번만 로그인하면 됩니다. (${t})`
    : /limit/i.test(t) ? `구독 사용 한도에 닿았어요. 한도 창이 풀리면 다시 시도해 주세요. (${t})` : t;
  function handle(line) {
    let ev; try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === 'system' && ev.subtype === 'init') emit({ t: 'init', session: ev.session_id, model: ev.model });
    else if (ev.type === 'stream_event') {   // 글자 단위 스트리밍(--include-partial-messages)
      const d = ev.event || {};
      if (d.type === 'content_block_start' && d.content_block?.type === 'text') { if (textBlocks++ > 0) emit({ t: 'delta', text: '\n\n' }); }
      else if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta' && d.delta.text) { sawDelta = true; emit({ t: 'delta', text: d.delta.text }); }
    } else if (ev.type === 'assistant') {
      if (ev.message?.model === '<synthetic>') return;   // Claude Code 가 만든 오류 문구(로그인 안 됨 등) — result 에 다시 오니 여기선 건너뛴다
      for (const c of ev.message?.content || []) {
        if (c.type === 'text' && c.text) { if (!sawDelta) emit({ t: 'text', text: c.text }); }   // 글자 스트림을 받았으면 통문장은 중복이라 건너뛴다
        else if (c.type === 'tool_use') emit({ t: 'tool', name: c.name, input: 요약(c.input) });
      }
    } else if (ev.type === 'result') {
      done = true;
      emit({ t: 'done', ok: !ev.is_error, session: ev.session_id, text: ev.is_error ? 친절한오류(String(ev.result || ev.subtype || '오류')) : '', final: ev.is_error ? '' : String(ev.result || ''), cost: ev.total_cost_usd, ms: ev.duration_ms });
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

function 일끝() { 현재 = null; if (재시작예약) setTimeout(() => process.exit(75), 500); }   // 재시작이 예약돼 있으면 지금 일이 끝난 뒤에

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

// 텔레그램 배달(선택): 예약 결과를 휴대폰으로. 파이스의 deliver 에 해당. 토큰·chat id 는 설정에.
async function 텔레그램(text) {
  const s = 설정(); if (!s.telegramToken || !s.telegramChat) return false;
  const body = String(text).replace(/[*_`#>|]/g, '').slice(0, 3800);
  const r = await fetch(`https://api.telegram.org/bot${s.telegramToken}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: s.telegramChat, text: body }) }).catch(() => null);
  return !!(r && r.ok);
}

// 비상두뇌(선택): Claude 가 한도에 걸렸을 때 Gemini 키가 있으면 도구 없이 대신 답한다. 파이스의 비상두뇌(Gemini 직행)에 해당.
async function 비상두뇌(prompt) {
  const s = 설정(); if (!s.geminiKey) return null;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${s.geminiModel || 'gemini-2.5-flash'}:generateContent?key=${s.geminiKey}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `${시스템프롬프트()}\n(지금은 비상 두뇌라 도구를 쓸 수 없다. 아는 것만 짧게 답하라.)\n\n주인: ${prompt}` }] }] }),
  });
  const j = await r.json().catch(() => ({}));
  return j?.candidates?.[0]?.content?.parts?.map((x) => x.text || '').join('') || null;
}

function 예약실행(j) {
  const today = ymd(new Date());
  let out = '';
  const proc = claude실행({
    prompt: `[예약 실행] id=${j.id} 예정시각=${j.time}\n${j.prompt}\n\n결과는 주인이 나중에 대시보드에서 읽을 짧은 보고문으로 써라. 질문으로 끝내지 말 것.`,
    onEvent: (e) => {
      if (e.t === 'delta') out += e.text;
      else if (e.t === 'text') out += (out ? '\n\n' : '') + e.text;
      if (e.t === 'done') {
        일끝();
        // 일지엔 마지막 답(final)만 남긴다 — 중간 혼잣말("I'll check…")까지 쌓이면 읽기 어렵다(2026-09-12 실측)
        const 결과 = e.ok ? (e.final || out) : `⚠️ 실패: ${e.text}`;
        appendFileSync(join(JOURNAL, `${today}.md`), `## ${hhmm(new Date())} · ${j.id}\n${결과}\n\n`);
        텔레그램(`[${설정().name} · ${j.id}]\n${결과}`);
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

// ---------- 자가 업그레이드 ----------
// 갱신(git pull)도 자기 수정도 재시작 전에 같은 관문을 지난다: 문법 + 자가시험.
// 두뇌(Claude)가 절차를 지키길 기대하지 않고 서버가 직접 막는다 — 2026-09-11 파이스가 자기 코드를 고치다 화면을 죽인 사고의 교훈.
const git = (...args) => new Promise((ok, no) => execFile('git', args, { cwd: ROOT, windowsHide: true },
  (e, out, err) => e ? no(new Error(String(err || e.message).trim().slice(0, 600))) : ok(String(out).trim())));

function 관문() {
  return new Promise((ok, no) => {
    execFile(process.execPath, ['--check', join(ROOT, 'server.js')], { windowsHide: true }, (e, _o, err) => {
      if (e) return no(new Error(`server.js 문법 오류:\n${String(err).slice(0, 800)}`));
      if (process.env.SANCHO_SKIP_SELFTEST) return ok();   // selftest 가 재시작을 시험할 때 자기 자신을 또 부르지 않게
      execFile(process.execPath, [join(ROOT, 'selftest.js')], { cwd: ROOT, windowsHide: true, timeout: 90_000 },
        (e2, _o2, err2) => e2 ? no(new Error(`자가시험 실패:\n${String(err2 || e2.message).slice(-800)}`)) : ok());
    });
  });
}

let 재시작예약 = false;
function 재시작() {   // 종료 코드 75 = sancho.bat 에게 "다시 켜라". 직접 node 로 켰으면 그냥 꺼진다.
  if (현재) { 재시작예약 = true; return '지금 하는 일이 끝나면'; }
  setTimeout(() => process.exit(75), 500);
  return '지금';
}

// 채팅이 끝난 뒤: 산초 코드가 바뀌었으면 관문 → 커밋 → 재시작. 걸리면 되돌린다. Claude 가 절차를 지키든 말든 결과는 같다.
async function 자기수정마무리(요청) {
  const changed = await git('status', '--porcelain', '--', 'server.js', 'public', 'selftest.js', 'sancho.bat', 'package.json', 'README.md').catch(() => '');
  if (!changed.trim()) return null;
  try { await 관문(); } catch (e) {
    await git('checkout', '--', '.').catch(() => {});   // 방금 고친 것만 버린다(마지막 커밋으로)
    return { ok: false, text: `${설정().name} 코드가 바뀌었지만 관문에 걸려 되돌렸어요.\n${e.message}` };
  }
  await git('add', '-A');
  await git('commit', '-q', '-m', `산초 자기 수정: ${요청.replace(/\s+/g, ' ').slice(0, 60)}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`);
  return { ok: true, text: `${설정().name} 코드 수정이 관문(문법·자가시험)을 지나 커밋됐어요. ${재시작()} 재시작합니다 — 몇 초 뒤 화면이 돌아옵니다.` };
}

async function 갱신() {   // GitHub 의 새 판 받기. 관문에 걸리면 이전 판으로 되돌린다.
  const before = await git('rev-parse', 'HEAD');
  await git('pull', '--ff-only');
  const after = await git('rev-parse', 'HEAD');
  if (before === after) return { updated: false, note: '이미 최신이에요', head: after.slice(0, 7) };
  try { await 관문(); } catch (e) {
    await git('reset', '--hard', before).catch(() => {});   // ponytail: 커밋 안 된 로컬 변경도 같이 날아간다 — 자기 수정은 커밋해 두는 절차라 감수
    throw new Error(`새 판(${after.slice(0, 7)})이 관문에 걸려 이전 판(${before.slice(0, 7)})으로 되돌렸어요.\n${e.message}`);
  }
  return { updated: true, from: before.slice(0, 7), to: after.slice(0, 7), when: 재시작() };
}

// ---------- 기록 · 대화 목록 ----------
const 기록추가 = (role, text, sid, files) => appendFileSync(p('history.jsonl'), JSON.stringify({ ts: new Date().toISOString(), role, text, sid, ...(files?.length ? { files } : {}) }) + '\n');
const 기록 = (sid, n = 200) => readText(p('history.jsonl')).trim().split('\n').filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((h) => h && sid && h.sid === sid).slice(-n);   // 새 대화(sid 없음)는 빈 화면
// 대화 목록 도입(2026-09-12) 전 기록엔 sid 가 없다 — 지금 대화로 귀속시킨다(1회)
{ const raw = readText(p('history.jsonl')); if (raw.includes('"text"') && !raw.includes('"sid"')) writeFileSync(p('history.jsonl'), raw.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.stringify({ ...JSON.parse(l), sid: 상태().session }); } catch { return l; } }).join('\n') + '\n'); }
function 대화기록(sid, firstText) {   // 대화 목록 맨 위로(제목은 첫 말 40자, Claude 앱처럼). 고정(pinned) 표시는 유지
  const st = 상태(); const old = st.sessions.find((s) => s.id === sid);
  const list = [{ ...old, id: sid, title: old?.title || firstText.replace(/\s+/g, ' ').slice(0, 40), ts: new Date().toISOString() }, ...st.sessions.filter((s) => s.id !== sid)];
  상태저장({ session: sid, sessions: list.slice(0, 50) });
}

// ---------- 파일: 두뇌가 만든 파일 알아내기 · 열기 · 내려받기 ----------
const 제외 = new Set(['history.jsonl', 'state.json', 'settings.json', 'memory.md', 'schedule.json', 'uploads', 'journal', 'wiki']);
function 스냅샷(dir = DATA, out = new Map(), depth = 0) {   // 데이터 폴더 안 파일들의 수정 시각(도구 파일·첨부·일지·위키는 빼고)
  for (const n of ls(dir)) {
    if (depth === 0 && (n.startsWith('.') || 제외.has(n))) continue;
    const full = join(dir, n); let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { if (depth < 3) 스냅샷(full, out, depth + 1); } else out.set(full, st.mtimeMs);
  }
  return out;
}
const 새파일 = (전) => [...스냅샷()].filter(([f, m]) => 전.get(f) !== m).map(([f]) => ({ path: f, name: basename(f), size: statSync(f).size }));   // 이번 턴에 새로 생기거나 바뀐 파일
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const 안에 = (abs, dir) => abs === dir || abs.startsWith(dir.endsWith(sep) ? dir : dir + sep);
function 허용경로(q) {   // 데이터 폴더 안, (허용했을 때) 홈 폴더·산초 폴더 안의 실제 파일만
  if (!q) return null;
  const abs = resolve(/^([a-zA-Z]:[\\/]|\/)/.test(q) ? q : join(DATA, q));
  const s = 설정();
  const ok = 안에(abs, DATA) || (s.allowHome && 안에(abs, homedir())) || (s.allowSelfEdit && 안에(abs, ROOT));
  try { return ok && statSync(abs).isFile() ? abs : null; } catch { return null; }
}
const 첨부이름 = (f) => basename(f).replace(/^[a-z0-9]{6,9}-/, '');   // uploads/mtytchox-회의메모.txt → 회의메모.txt
const 일지 = (n = 2) => readdirSync(JOURNAL).filter((f) => f.endsWith('.md')).sort().slice(-n)
  .map((f) => ({ date: f.slice(0, -3), text: readText(join(JOURNAL, f)) }));

// ---------- HTTP ----------
const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'content-type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });

async function 채팅(req, res) {
  const body = await readBody(req);
  const files = Array.isArray(body.files) ? body.files.filter((f) => typeof f === 'string' && f.startsWith('uploads/')) : [];
  const text = String(body.text || '').trim() || (files.length ? '첨부한 파일을 확인해 주세요.' : '');
  if (!text) return send(res, 400, { error: '빈 메시지예요' });
  const prompt = text + (files.length ? `\n\n[첨부 파일 — Read 도구로 읽어라]\n${files.map((f) => '- ' + f).join('\n')}` : '')
    + (body.voice ? '\n\n(지금은 음성 대화 중이다. 두세 문장으로 짧게, 표·코드·목록 없이 말로 답하라.)' : '');
  const 첨부 = files.map((f) => ({ path: f, name: 첨부이름(f) }));
  const 전 = 스냅샷();   // 답이 끝난 뒤 새로 생긴 파일을 알아내기 위해
  if (!CLAUDE) return send(res, 503, { error: 'Claude Code 가 설치돼 있지 않아요. README 의 설치 순서를 보세요.' });
  if (현재) return send(res, 409, { error: `지금 다른 일(${현재.kind})을 하고 있어요. ■ 를 눌러 멈추거나 끝나길 기다려 주세요.` });
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const sse = (e) => { try { res.write(`data: ${JSON.stringify(e)}\n\n`); } catch {} };
  let answer = '', finished = false, 재시도 = false;
  const 마무리 = (e) => {   // 끝: 대화 목록 · 만든 파일 카드 · 기록 · 자기 수정 → 응답 닫기
    finished = true;
    if (e.ok && e.session) 대화기록(e.session, text);                                // 성공한 답만 이어간다(실패한 실행의 id 를 resume 하면 또 실패)
    else if (!e.ok && /session|resume/i.test(e.text)) 상태저장({ session: null });   // 이어가기 자체가 실패면 다음엔 새 대화로
    const sid = 상태().session, made = e.ok ? 새파일(전) : [];
    if (made.length) sse({ t: 'files', files: made });   // 두뇌가 만든 파일 → 카드(열기·보기·내려받기)
    sse(e);
    기록추가('user', text, sid, 첨부); 기록추가('assistant', e.ok ? answer : `⚠️ ${e.text}`, sid, made);
    (설정().allowSelfEdit && e.ok && !e.emergency ? 자기수정마무리(text) : Promise.resolve(null))
      .catch((err) => ({ ok: false, text: `자기 수정 마무리 실패: ${err.message}` }))
      .then((r) => { if (r) { sse({ t: 'selfedit', ...r }); 기록추가('assistant', `🔁 ${r.text}`, sid); } res.end(); 일끝(); });
  };
  const 시도 = (model) => claude실행({
    prompt, resume: 상태().session, model,
    onEvent: async (e) => {
      if (finished) return;
      if (e.t === 'delta') answer += e.text;
      else if (e.t === 'text') answer += (answer ? '\n\n' : '') + e.text;
      if (e.t !== 'done') return sse(e);
      // 비상 경로(파이스의 안전모델·비상두뇌): 한도에 걸리면 Gemini 키가 있을 때 대신 답하고, 본모델이 거부되면 Sonnet 으로 한 번 다시 시도한다
      if (!e.ok && !재시도) {
        재시도 = true;
        if (/limit|429|overloaded|529|quota/i.test(e.text)) {
          const g = await 비상두뇌(prompt).catch(() => null);
          if (g) { answer = `⚠️ [비상두뇌 · Gemini] 본두뇌(Claude)가 한도에 걸려 대신 답합니다. 도구 없이 아는 것만.\n\n${g}`; sse({ t: 'text', text: answer }); return 마무리({ ...e, ok: true, emergency: true, text: '' }); }
        } else if ((model || 설정().model) !== 'sonnet' && /model|credit|not found|invalid|400|403/i.test(e.text)) {
          sse({ t: 'note', text: `본모델이 답하지 못해 Sonnet 으로 다시 시도합니다 (${e.text.slice(0, 80)})` }); answer = '';
          현재 = { proc: 시도('sonnet'), kind: '채팅', startedAt: Date.now() }; return;
        }
      }
      마무리(e);
    },
  });
  현재 = { proc: 시도(), kind: '채팅', startedAt: Date.now() };
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === 'GET /') return send(res, 200, readFileSync(join(ROOT, 'public', 'index.html')), 'text/html; charset=utf-8');
    if (route === 'GET /health') return send(res, 200, { ok: true, busy: 현재 ? 현재.kind : null, version: CLAUDE_VERSION });
    // 외부 접속(선택): 설정에 접속 토큰이 있으면 API 는 토큰이 있어야 한다(터널로 밖에 열 때). 화면(/)은 토큰을 묻는다.
    const 토큰 = 설정().token;
    if (토큰 && url.pathname.startsWith('/api/') && req.headers['x-token'] !== 토큰 && url.searchParams.get('token') !== 토큰) return send(res, 401, { error: '접속 토큰이 필요해요' });
    if (route === 'GET /api/state') {
      const st = 상태();
      return send(res, 200, {
        claude: { path: CLAUDE, version: CLAUDE_VERSION, ok: !!CLAUDE }, settings: 설정(), session: st.session, sessions: st.sessions, busy: 현재 ? 현재.kind : null, pendingRestart: 재시작예약,
        schedules: 예약목록().map((j) => ({ ...j, lastRun: st.runs[j.id] || null })), memory: readText(p('memory.md')), journal: 일지(), history: 기록(st.session),
        skills: ls(join(DATA, '.claude', 'skills')), wiki: ls(join(DATA, 'wiki'), (f) => f.endsWith('.md')),
      });
    }
    if (route === 'GET /neural.js') return send(res, 200, readFileSync(join(ROOT, 'public', 'neural.js')), 'application/javascript; charset=utf-8');
    if (route === 'GET /api/graph') {   // 뇌 그래프 재료(파이스 neural.js 용): 산초 → 기억·위키·스킬·대화·예약 → 항목, 위키 [[링크]]는 서로 연결
      const nodes = [{ id: '산초', name: 설정().name, deg: 8 }], links = [];
      const cat = (name) => { nodes.push({ id: 'cat:' + name, name, folder: name, deg: 4 }); links.push({ source: '산초', target: 'cat:' + name }); };
      const add = (id, name, folder, extra = {}) => { nodes.push({ id, name, folder, deg: 1, ...extra }); links.push({ source: 'cat:' + folder, target: id }); };
      const mem = readText(p('memory.md')).split('\n').map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean);
      if (mem.length) { cat('기억'); mem.slice(-40).forEach((l, i) => add('memory:' + i, l.slice(0, 40), '기억', { text: l })); }
      const wiki = ls(join(DATA, 'wiki'), (f) => f.endsWith('.md'));
      if (wiki.length) {
        cat('위키'); for (const f of wiki) add('wiki/' + f, f.replace(/\.md$/, ''), '위키');
        for (const f of wiki) for (const m of readText(join(DATA, 'wiki', f)).matchAll(/\[\[([^\]|#]+)/g)) { const t = m[1].trim() + '.md'; if (t !== f && wiki.includes(t)) links.push({ source: 'wiki/' + f, target: 'wiki/' + t }); }
      }
      const skills = ls(join(DATA, '.claude', 'skills'));
      if (skills.length) { cat('스킬'); for (const n of skills) add(`.claude/skills/${n}/SKILL.md`, n, '스킬'); }
      const st = 상태();
      if (st.sessions.length) { cat('대화'); for (const x of st.sessions.slice(0, 15)) add('session:' + x.id, x.title, '대화', { text: x.title }); }
      const sch = 예약목록();
      if (sch.length) { cat('예약'); for (const j of sch) add('sched:' + j.id, `${j.time} ${j.prompt.slice(0, 30)}`, '예약', { text: j.prompt }); }
      return send(res, 200, { nodes, links });
    }
    if (route === 'GET /api/file') {   // 위키·스킬 파일 읽기(그 두 폴더만)
      const rel = String(url.searchParams.get('path') || '');
      if (!/^(wiki\/[^/\\]+\.md|\.claude\/skills\/[^/\\]+\/SKILL\.md)$/.test(rel)) return send(res, 400, { error: '위키·스킬 파일만 볼 수 있어요' });
      return send(res, 200, { path: rel, text: readText(p(rel)) });
    }
    if (route === 'POST /api/upload') {   // 채팅 첨부: 본문 = 파일 그대로, 이름은 x-name 헤더(URI 인코딩)
      const name = decodeURIComponent(String(req.headers['x-name'] || 'file')).replace(/[\\/:*?"<>|]/g, '_').slice(-80);
      const chunks = []; let size = 0;
      req.on('data', (c) => { size += c.length; if (size > 50e6) req.destroy(); else chunks.push(c); });
      req.on('end', () => { const rel = `uploads/${Date.now().toString(36)}-${name}`; writeFileSync(p(rel), Buffer.concat(chunks)); send(res, 200, { path: rel, size }); });
      return;
    }
    if (route === 'POST /api/settings') { writeJson(p('settings.json'), { ...설정(), ...(await readBody(req)) }); return send(res, 200, 설정()); }
    if (route === 'POST /api/new') { 상태저장({ session: null }); return send(res, 200, { ok: true }); }
    if (route === 'POST /api/session') {   // 대화 목록에서 이전 대화로 돌아가기(Claude Code 가 그 대화를 --resume 한다)
      const { id } = await readBody(req);
      if (!상태().sessions.some((s) => s.id === id)) return send(res, 404, { error: '없는 대화예요' });
      상태저장({ session: id }); return send(res, 200, { ok: true });
    }
    if (route === 'POST /api/session/pin') {   // 고정(Claude 앱의 "고정됨") — 3개까지
      const { id, pinned } = await readBody(req); const st = 상태();
      if (pinned && st.sessions.filter((s) => s.pinned && s.id !== id).length >= 3) return send(res, 409, { error: '고정은 3개까지예요. 하나를 풀고 다시 하세요.' });
      상태저장({ sessions: st.sessions.map((s) => s.id === id ? { ...s, pinned: !!pinned } : s) }); return send(res, 200, { ok: true });
    }
    if (route === 'POST /api/session/remove') {
      const { id } = await readBody(req); const st = 상태();
      상태저장({ sessions: st.sessions.filter((s) => s.id !== id), session: st.session === id ? null : st.session }); return send(res, 200, { ok: true });
    }
    if (route === 'GET /api/download') {   // 보기·내려받기(브라우저가 그릴 수 있는 건 그대로 보여준다)
      const abs = 허용경로(String(url.searchParams.get('path') || ''));
      if (!abs) return send(res, 404, { error: '볼 수 없는 파일이에요' });
      res.writeHead(200, { 'content-type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(basename(abs))}` });
      return createReadStream(abs).pipe(res);
    }
    if (route === 'POST /api/open') {   // 이 컴퓨터의 기본 앱으로 열기(엑셀·파워포인트·워드 …)
      const abs = 허용경로(String((await readBody(req)).path || ''));
      if (!abs) return send(res, 404, { error: '열 수 없는 파일이에요' });
      if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', abs], { windowsHide: true }, () => {});
      else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [abs], () => {});
      return send(res, 200, { ok: true });
    }
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
    if (route === 'POST /api/restart') {
      try { await 관문(); } catch (e) { return send(res, 409, { error: `관문에 걸려 재시작하지 않았어요.\n${e.message}` }); }
      return send(res, 200, { ok: true, when: 재시작(), note: 'sancho.bat 으로 켠 경우에만 자동으로 다시 켜져요' });
    }
    if (route === 'POST /api/update') {
      try { return send(res, 200, await 갱신()); } catch (e) { return send(res, 409, { error: e.message }); }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 500, { error: String(e?.message || e) }); }
}).on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log(`산초가 이미 켜져 있어요 → 브라우저에서 http://127.0.0.1:${PORT} 를 여세요`);   // sancho.bat 을 두 번 눌러도 놀라지 않게
  process.exit(0);
}).listen(PORT, process.env.SANCHO_HOST || '127.0.0.1', () => {   // SANCHO_HOST=0.0.0.0 으로 열 때는 반드시 접속 토큰을 설정한다
  console.log(`산초 → http://${process.env.SANCHO_HOST || '127.0.0.1'}:${PORT}   두뇌: ${CLAUDE ? CLAUDE_VERSION : 'Claude Code 를 찾지 못했어요 (README 참고)'}`);
  // 잘 켜진 코드를 "마지막 정상판"으로 표시한다 — 작업 폴더가 깨끗할 때만(커밋 안 된 코드가 돌고 있으면 표시를 옮기지 않는다).
  // sancho.bat 이 비정상 종료 뒤 이 표시로 복구한다. git 이 없거나 저장소가 아니면 조용히 건너뛴다.
  git('status', '--porcelain').then((dirty) => dirty ? null : git('tag', '-f', 'last-good')).catch(() => {});
});
