// 산초(Sancho) v0.1 — 챗창 있는 대시보드.
// 두뇌는 이 컴퓨터에 설치된 Claude Code(본인 구독 로그인)다. API 키도 관문(게이트웨이)도 없다.
// 산초가 직접 하는 일은 넷뿐: 화면 · 시계(예약) · 기억 · 알림. 생각과 도구 실행은 전부 Claude Code 가 한다.
// 의존 패키지 0. Node 18 이상.
import { createServer } from 'node:http';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, existsSync, statSync, cpSync, createReadStream, unlinkSync, watch } from 'node:fs';
import { join, dirname, resolve, sep, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scryptSync, randomBytes, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.SANCHO_DATA || join(ROOT, 'data');   // 산초의 모든 상태는 이 폴더 안 텍스트 파일이다. 지우면 초기화. (SANCHO_DATA 로 위치 변경)
const JOURNAL = join(DATA, 'journal');
// 예약 실행 결과(일지)도 사용자별로 — 로그인한 사람의 일만 그 사람 알림에 쌓인다
const 일지폴더 = () => { const uid = sessionContext.getStore(); if (!uid) return JOURNAL; const d = join(DATA, 'users', uid, 'journal'); try { mkdirSync(d, { recursive: true }); } catch {} return d; };
const DB = join(DATA, 'db');   // 플랫폼 저장소: 컬렉션 하나 = db/<이름>.json 한 파일 (세종 플랫폼의 Firestore 컬렉션에 해당). 산초(두뇌)도 이 파일을 직접 고친다.
for (const d of [JOURNAL, DB, join(DATA, 'uploads'), join(DATA, 'wiki'), join(DATA, 'wbs'), join(DATA, '.claude', 'skills')]) mkdirSync(d, { recursive: true });   // 첨부 · 위키 · 스킬(Claude Code 가 cwd/.claude/skills 를 읽는다)
const PORT = Number(process.env.SANCHO_PORT || 8790);

// ---------- 파일 도우미 ----------
const sessionContext = new AsyncLocalStorage();
// 로그인 세션: 껐다 켜도(자기 수정 뒤 재시작이 잦다) 로그인이 풀리지 않게 파일에 남긴다. 30일 지난 것은 버린다.
const 세션파일 = () => join(DATA, 'sessions.json');
const 세션만료 = 30 * 24 * 3600 * 1000;
const SESSIONS = new Map(Object.entries(readJson0(세션파일(), {})).filter(([, v]) => Date.now() - (v?.at || 0) < 세션만료).map(([k, v]) => [k, v.uid]));
function readJson0(file, fallback) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } }   // 파일 도우미보다 먼저 필요해서 따로
function 세션저장() { try { const now = Date.now(); writeFileSync(세션파일(), JSON.stringify(Object.fromEntries([...SESSIONS].map(([k, uid]) => [k, { uid, at: now }])), null, 2)); } catch {} }
const p = (name) => {
  const uid = sessionContext.getStore();
  if (uid && ['settings.json', 'state.json', 'memory.md', 'schedule.json', 'history.jsonl', '.system.md'].includes(name)) {
    const dir = join(DATA, 'users', uid);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return join(dir, name);
  }
  return join(DATA, name);
};
const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, v) => writeFileSync(file, JSON.stringify(v, null, 2) + '\n');
const readText = (file) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };
const ymd = (d) => d.toLocaleDateString('sv-SE');      // YYYY-MM-DD (현지 날짜)
const hhmm = (d) => d.toTimeString().slice(0, 5);      // HH:MM

const 기본설정 = { name: '산초', model: 'sonnet', effort: 'high', allowShell: false, allowHome: false, allowSelfEdit: false, allowApps: false,
  vaultPath: '', telegramToken: '', telegramChat: '', geminiKey: '', geminiModel: 'gemini-2.5-flash', token: '',   // 연결(선택): 옵시디언 볼트 · 텔레그램 배달 · 비상두뇌(Gemini) · 외부 접속 토큰
  owner: { name: '', title: '', dept: '', company: '', email: '' },
  localNoLogin: true };   // 이 컴퓨터(127.0.0.1)에서 열 때는 로그인 없이 바로 쓴다. 밖으로 열어 두었으면(SANCHO_HOST) 이 값과 무관하게 항상 로그인.   // 주인(플랫폼 화면의 인사말·사용자 칩·결재선에 쓴다)
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
   - 감시(watcher): "10분마다 …확인해서 변하면 알려줘" 처럼 반복 확인은 {"id":"…","repeat":"every","minutes":10,"prompt":"…"} 로 넣는다(최소 5분). prompt 끝에 "변화가 없으면 '변화 없음' 한 줄만 답하라" 를 붙인다 — 그 답은 일지에 쌓이지 않는다.
   - prompt 는 주인 말을 그대로 옮기지 말고, 나중에 네가 이 대화 없이 혼자 읽고 바로 실행할 수 있는 완전한 지시문으로 쓴다.
   - 삭제 요청이면 그 항목을 배열에서 뺀다. 추가·삭제 뒤엔 결과를 한 줄로 알린다.
   - 예약 시각이 되면 ${s.name} 서버가 prompt 를 너에게 보내 실행하고 결과를 journal/ 에 쌓아 주인에게 보여준다.
3) journal/ — 예약 실행 결과가 날짜별(YYYY-MM-DD.md) 로 쌓인다. 필요하면 읽어 참고한다.
4) .claude/skills/<이름>/SKILL.md — 스킬(다시 쓸 절차). 주인이 "이거 스킬로 저장해" 하면 방금 한 절차를 SKILL.md 로 저장한다(맨 위 --- name: 이름 / description: 한 줄 --- 머리말, 그 아래 단계). URL 이나 GitHub 의 SKILL.md 를 가져오라 하면 WebFetch 로 받아 저장한다. 저장된 스킬은 다음 대화부터 자동으로 쓸 수 있다.
5) wiki/<주제>.md — 조사·정리한 지식. 나중에도 쓸 내용이면 여기 저장·갱신하고, 관련 질문엔 먼저 여기를 본다.
6) history.jsonl — 지난 대화 기록. "전에 말한 …" 을 찾을 땐 Grep 한다.
7) uploads/ — 주인이 채팅에 올린 파일. 말 끝에 [첨부 파일] 목록이 붙으면 Read 로 읽고 답한다(이미지·PDF 도 Read 로 볼 수 있다).
8) 파일함/ — 네가 만든 파일(엑셀·PPT·워드·PDF·이미지 등)은 여기 저장한다. 만든 파일은 대시보드에 카드로 떠서 주인이 바로 열 수 있다. 만드는 법은 office-docs 스킬을 따른다.
9) wbs/<프로젝트>.json — 공정표(WBS, 세종 플랫폼의 WBS 를 옮긴 것). 주인이 "WBS 만들어", "공정표에 … 추가", "… 진도율 60%로" 하면 이 파일을 만들고 고친다. 형식과 규칙은 wbs 스킬을 따른다(대단락 lv 0 · 작업 lv 1 · 세부 lv 2, 필드 code·name·lv·mgr·s·e·weight·pct·memo). 진도율은 말단 작업의 pct 만 적고 상위·전체는 대시보드가 가중 합산하며, 계획 대비(PV·EV·SPI)와 간트도 대시보드 WBS 화면이 그린다. 고친 뒤 "왼쪽 프로젝트 메뉴에서 보세요" 라고 알린다.
10) db/<컬렉션>.json — 플랫폼 화면(일정·프로젝트·메일정리·메신저·회의·목표·공수·조직·결재·로드맵)의 데이터. 형식은 { "<id>": { …필드 } } 이고, 어느 컬렉션에 어떤 필드가 있는지는 platform 스킬(.claude/skills/platform/SKILL.md)에 있다. 주인이 "일정 잡아줘", "기안서 써줘", "메일 정리해줘", "OKR 갱신" 처럼 말하면 그 스킬을 읽고 해당 파일을 Edit 한다. 화면은 파일이 바뀌면 곧바로 따라 바뀐다(id 는 짧은 영문·숫자, 날짜는 YYYY-MM-DD, 시각은 HH:MM, 시각 도장은 ISO 문자열).
자동 기억: 대화 중 주인에 관해 새로 알게 된 사실(선호·일정·사람·습관·목표)은 묻지 않아도 memory.md 에 한 줄 덧붙인다. 이미 있는 내용·사소한 것은 빼고, 적었으면 답 끝에 "(기억함)" 이라고 짧게 표시한다. 잊으라 하면 그 줄을 지운다.
프로젝트: 주인이 어떤 프로젝트(공사·과제·행사)를 이어서 말하면 wiki/프로젝트-<이름>.md 에 목표·단계·진행·다음 할 일을 유지하고, 관련 질문엔 먼저 그 파일을 본다.
큰 일은 나눠서: 조사·정리·검토처럼 갈래가 여럿인 일은 Task(하위 에이전트)로 나눠 병렬로 맡기고 결과를 합친다(파이스의 delegate 에 해당).
PC 다루기(클립보드·화면 캡처·알림·앱 열기·HWPX)는 pc-tools 스킬, 문서 만들기는 office-docs 스킬을 따른다.
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
function 예약목록() {   // daily(매일 HH:MM) · once(그 날 HH:MM) · every(N분마다 — 감시용, 최소 5분)
  const v = readJson(p('schedule.json'), []);
  return (Array.isArray(v) ? v : [])
    .filter((j) => j && j.id && j.prompt && (j.repeat === 'every' ? Number(j.minutes) >= 5 : /^\d{1,2}:\d{2}$/.test(String(j.time || '').trim())))
    .map((j) => j.repeat === 'every' ? { ...j, id: String(j.id), minutes: Number(j.minutes), time: `매 ${Number(j.minutes)}분` }
      : { ...j, id: String(j.id), time: String(j.time).trim().padStart(5, '0'), repeat: j.repeat === 'once' ? 'once' : 'daily' });
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
        const 조용 = j.repeat === 'every' && /^\s*변화 없음/.test(결과);   // 감시 결과가 "변화 없음" 이면 일지·배달 생략
        if (!조용) { appendFileSync(join(일지폴더(), `${today}.md`), `## ${hhmm(new Date())} · ${j.id}\n${결과}\n\n`); 텔레그램(`[${설정().name} · ${j.id}]\n${결과}`); }
        const st = 상태(); if (j.repeat === 'every') st.lastAt = { ...(st.lastAt || {}), [j.id]: Date.now() }; else st.runs[j.id] = today; 상태저장(st);
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
  const now = new Date(), today = ymd(now), hm = hhmm(now), st = 상태(), runs = st.runs;
  for (const j of 예약목록()) {
    if (j.repeat === 'every') { if (Date.now() - (st.lastAt?.[j.id] || 0) < j.minutes * 60000) continue; return 예약실행(j); }
    const once = j.repeat === 'once';
    if (once && j.date && j.date > today) continue;                 // 아직 그 날이 아니다
    const 지난날 = once && j.date && j.date < today;                 // 날짜를 넘겨 놓친 1회 예약은 바로
    if (!지난날 && hm < j.time) continue;                            // 오늘 아직 시간 전
    if (runs[j.id] === today) continue;                             // 오늘 이미 했다
    return 예약실행(j);                                              // 한 번에 하나
  }
}
// 사용자별로 한 번씩 — 세션 컨텍스트를 씌워야 그 사람의 schedule.json·state.json·일지를 읽고 쓴다.
function tick모두() {
  if (현재) return;
  const uids = ls(join(DATA, 'users'), (n) => { try { return statSync(join(DATA, 'users', n)).isDirectory(); } catch { return false; } });
  if (!uids.length) { tick(); 워크플로시계(); return; }               // 아직 로그인 계정이 없으면 옛 방식(공용 파일)
  for (const uid of uids) { if (현재) return; sessionContext.run(uid, () => { tick(); 워크플로시계(); }); }
}
setInterval(tick모두, 30_000);
setTimeout(tick모두, 5_000);

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

// Windows 시작 시 자동 실행(선택): 시작 프로그램 폴더에 바로가기 하나. 관리자 권한 불필요, 끄면 지운다.
const 시작바로가기 = process.platform === 'win32' && process.env.APPDATA ? join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Sancho.lnk') : null;
function 자동실행(on) {
  return new Promise((ok, no) => {
    if (!시작바로가기) return no(new Error('Windows 에서만 됩니다'));
    if (!on) { try { unlinkSync(시작바로가기); } catch {} return ok(false); }
    // 창 없이(숨김) 켠다 — 최소화 창은 실수로 닫혀서 산초가 꺼진 일이 두 번(2026-09-13). 끄는 건 ⚙ "산초 끄기".
    const 숨김 = Buffer.from(`Start-Process -FilePath 'cmd.exe' -ArgumentList '/c "${join(ROOT, 'sancho-autostart.bat')}"' -WorkingDirectory '${ROOT}' -WindowStyle Hidden`, 'utf16le').toString('base64');
    const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${시작바로가기}'); $s.TargetPath='powershell.exe'; $s.Arguments='-NoProfile -WindowStyle Hidden -EncodedCommand ${숨김}'; $s.WorkingDirectory='${ROOT}'; $s.WindowStyle=7; $s.Description='Sancho (hidden)'; $s.Save()`;
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true },   // 인코딩: 따옴표 문제 없이 넘긴다
      (e, _o, err) => e ? no(new Error(String(err || e.message).slice(0, 300))) : ok(true));
  });
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
const 제외 = new Set(['history.jsonl', 'state.json', 'settings.json', 'memory.md', 'schedule.json', 'uploads', 'journal', 'wiki', 'backups', 'wbs', 'db']);

// ---------- WBS(공정표) — 세종 플랫폼 wbs.html 의 계산부를 옮김: 가중 합산 진도율 · 계획 대비(EVMS: PV/EV/SV/SPI) · S-곡선 · 지연 판정 ----------
// 파일: data/wbs/<프로젝트>.json = { name, no?, items:[{code,name,lv,mgr,s,e,weight,pct,memo}] } — 순서대로 나열, 계층은 lv 로(자식은 부모 바로 뒤에 lv+1)
function wbs계산(doc) {
  const items = (Array.isArray(doc.items) ? doc.items : []).map((x) => ({ ...x, lv: Number(x.lv) || 0, pct: Math.max(0, Math.min(100, Number(x.pct) || 0)), weight: x.weight == null || x.weight === '' ? null : Number(x.weight) }));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const kids = (i) => { const o = []; for (let j = i + 1; j < items.length; j++) { if (items[j].lv <= items[i].lv) break; if (items[j].lv === items[i].lv + 1) o.push(j); } return o; };
  const desc = (i) => { const o = []; for (let j = i + 1; j < items.length; j++) { if (items[j].lv <= items[i].lv) break; o.push(j); } return o; };
  const pctOf = (i) => { const k = kids(i); if (!k.length) return items[i].pct; let w = 0, sum = 0; for (const j of k) { const wt = items[j].weight ?? 100 / k.length; w += wt; sum += wt * pctOf(j); } return w ? sum / w : 0; };   // 자식은 가중 평균(가중치 없으면 균등)
  const rangeOf = (i) => { const d = desc(i), ss = d.map((j) => items[j].s).filter(Boolean).sort(), ee = d.map((j) => items[j].e).filter(Boolean).sort(); return { s: items[i].s || ss[0] || '', e: items[i].e || ee[ee.length - 1] || '' }; };
  const plan = (s, e, t = today) => { if (!s || !e) return null; const sd = new Date(s), ed = new Date(e); if (isNaN(sd) || isNaN(ed) || ed <= sd) return null; return t <= sd ? 0 : t >= ed ? 100 : (t - sd) / (ed - sd) * 100; };   // 계획 진척 = 기간 대비 경과(직선)
  const rows = items.map((x, i) => {
    const r = rangeOf(i), pct = +pctOf(i).toFixed(1), pv = plan(r.s, r.e), late = !!r.e && today > new Date(r.e) && pct < 100;
    return { ...x, s: r.s, e: r.e, pct, plan: pv == null ? null : +pv.toFixed(1), diff: pv == null ? null : +(pct - pv).toFixed(1), status: pct >= 100 ? '완료' : late ? '지연' : pct > 0 ? '진행중' : '미시작', hasKids: kids(i).length > 0 };
  });
  const tops = rows.filter((r) => r.lv === 0); let PV = 0, EV = 0, W = 0;
  for (const t of tops) { const wt = t.weight ?? 100 / tops.length; W += wt; EV += wt * t.pct; PV += wt * (t.plan || 0); }
  const pv = W ? +(PV / W).toFixed(1) : 0, ev = W ? +(EV / W).toFixed(1) : 0;
  const dated = rows.filter((r) => r.s && r.e), sMin = dated.map((r) => r.s).sort()[0] || '', eMax = dated.map((r) => r.e).sort().slice(-1)[0] || '';
  const curve = [];
  if (sMin && eMax) { let d = new Date(new Date(sMin).getFullYear(), new Date(sMin).getMonth(), 1); const pe = new Date(eMax); let n = 0;
    while (d <= pe && n++ < 60) { const me = new Date(d.getFullYear(), d.getMonth() + 1, 0); let p = 0, w = 0; for (const t of tops) { const wt = t.weight ?? 100 / tops.length; w += wt; p += wt * (plan(t.s, t.e, me) || 0); } curve.push({ label: `${me.getFullYear()}-${String(me.getMonth() + 1).padStart(2, '0')}`, date: ymd(me), pv: w ? +(p / w).toFixed(1) : 0 }); d.setMonth(d.getMonth() + 1); } }
  return { name: doc.name || '', no: doc.no || '', rows, pv, ev, sv: +(ev - pv).toFixed(1), spi: pv > 0 ? +(ev / pv).toFixed(2) : null, late: rows.filter((r) => !r.hasKids && r.status === '지연').length, sMin, eMax, today: ymd(today), curve };
}
const wbs파일 = (name) => /^[^\\/:*?"<>|]{1,80}$/.test(name) ? join(DATA, 'wbs', `${name}.json`) : null;
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
const 일지 = (n = 2) => { const dir = 일지폴더(); return ls(dir, (f) => f.endsWith('.md')).sort().slice(-n).map((f) => ({ date: f.slice(0, -3), text: readText(join(dir, f)) })); };

// ---------- 플랫폼 저장소(/api/db) — Firestore 흉내. 컬렉션 = db/<이름>.json 한 파일 = { id: 문서 } ----------
// 화면(public/m/*.html)은 sdb.js 로 Firestore 함수 이름 그대로 쓰고, 두뇌(Claude)는 파일을 Edit 한다. 둘 다 같은 파일이라 서로 곧바로 보인다.
const 컬렉션이름 = (n) => /^[A-Za-z0-9_\-]{1,80}$/.test(String(n || '')) ? String(n) : null;
const 컬렉션 = (n) => { const v = readJson(join(DB, `${n}.json`), {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
const 컬렉션저장 = (n, map) => writeJson(join(DB, `${n}.json`), map);
const 컬렉션목록 = () => ls(DB, (f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
function 깊은병합(base, patch) {   // updateDoc: 'a.b' 점 경로 · increment · arrayUnion/Remove 지원
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    const path = k.split('.'); let o = out;
    for (let i = 0; i < path.length - 1; i++) { o[path[i]] = { ...(o[path[i]] && typeof o[path[i]] === 'object' ? o[path[i]] : {}) }; o = o[path[i]]; }
    const last = path[path.length - 1], cur = o[last];
    if (v && typeof v === 'object' && '__inc' in v) o[last] = (Number(cur) || 0) + Number(v.__inc);
    else if (v && typeof v === 'object' && '__union' in v) o[last] = [...new Set([...(Array.isArray(cur) ? cur : []), ...v.__union])];
    else if (v && typeof v === 'object' && '__remove' in v) o[last] = (Array.isArray(cur) ? cur : []).filter((x) => !v.__remove.includes(x));
    else if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) o[last] = 깊은병합(cur, v);
    else o[last] = v;
  }
  return out;
}
const 구독자 = new Set();   // SSE 로 "컬렉션이 바뀌었다" 만 알린다(내용은 화면이 다시 읽는다)
const 알림 = (m) => { const line = `data: ${JSON.stringify(m)}\n\n`; for (const r of 구독자) { try { r.write(line); } catch {} } };
function db쓰기(col, id, data, merge) {
  const map = 컬렉션(col), now = new Date().toISOString(), old = map[id];
  map[id] = merge === 'deep' ? 깊은병합(old, data) : merge ? { ...(old || {}), ...data } : { ...data };
  if (map[id] && typeof map[id] === 'object') { map[id].updatedAt = now; if (!old) map[id].createdAt = map[id].createdAt || now; }
  컬렉션저장(col, map); 알림({ col, id, op: old ? 'update' : 'add' }); return map[id];
}
function db지우기(col, id) { const map = 컬렉션(col); if (!(id in map)) return false; delete map[id]; 컬렉션저장(col, map); 알림({ col, id, op: 'delete' }); return true; }
// 두뇌(Claude)가 db/*.json 을 Edit 하면 열려 있는 화면도 따라 바뀌게 — 폴더 감시(0.3초 모아서)
{ let timer = null, 바뀐 = new Set(); try { watch(DB, (_e, f) => { if (!f || !String(f).endsWith('.json')) return; 바뀐.add(String(f).slice(0, -5)); clearTimeout(timer); timer = setTimeout(() => { for (const c of 바뀐) 알림({ col: c, op: 'external' }); 바뀐.clear(); }, 300); }); } catch {} }
const 문서제목 = (d, id) => String(d.title || d.name || d.subject || d.objective || d.text || d.code || id).slice(0, 60);
function 검색(q) {   // 헤더 검색: 플랫폼 데이터 · 공정표 · 위키 · 예약 · 지난 대화
  const needle = q.toLowerCase(), out = [], hit = (s) => String(s || '').toLowerCase().includes(needle);
  for (const col of 컬렉션목록()) for (const [id, d] of Object.entries(컬렉션(col))) { if (!d || typeof d !== 'object') continue; const text = JSON.stringify(d); if (hit(text)) { const i = text.toLowerCase().indexOf(needle); out.push({ type: col, id, title: 문서제목(d, id), sub: text.slice(Math.max(0, i - 30), i + 50).replace(/[{}"\\]/g, ' ') }); } if (out.length > 60) break; }
  for (const f of ls(join(DATA, 'wbs'), (x) => x.endsWith('.json'))) { const d = readJson(join(DATA, 'wbs', f), {}); if (hit(f) || hit(JSON.stringify(d))) out.push({ type: 'wbs', id: f.slice(0, -5), title: d.name || f.slice(0, -5), sub: '공정표' }); }
  for (const f of ls(join(DATA, 'wiki'), (x) => x.endsWith('.md'))) { const t = readText(join(DATA, 'wiki', f)); if (hit(f) || hit(t)) { const i = t.toLowerCase().indexOf(needle); out.push({ type: 'wiki', id: f, title: f.replace(/\.md$/, ''), sub: i >= 0 ? t.slice(Math.max(0, i - 30), i + 60).replace(/\s+/g, ' ') : '위키' }); } }
  for (const j of 예약목록()) if (hit(j.prompt) || hit(j.id)) out.push({ type: 'schedule', id: j.id, title: j.prompt.slice(0, 60), sub: `예약 ${j.time}` });
  const hist = readText(p('history.jsonl')).trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((h) => h && hit(h.text)).slice(-15);
  for (const h of hist) out.push({ type: 'chat', id: h.sid || '', title: String(h.text).replace(/\s+/g, ' ').slice(0, 70), sub: `${h.role === 'user' ? '나' : 설정().name} · ${String(h.ts).slice(0, 10)}` });
  return out.slice(0, 80);
}

// 옛 단일 사용자 데이터(data/settings.json · memory.md · schedule.json · state.json · history.jsonl · journal/)를
// 첫 로그인 계정 폴더로 한 번만 옮긴다 — 로그인 기능이 붙으면서 부장님 기억·예약·설정이 사라진 것처럼 보이던 문제.
const 이사한 = new Set();
function 이사(uid) {
  if (!uid) return;
  const dir = join(DATA, 'users', uid);
  try {
    mkdirSync(dir, { recursive: true });
    if (existsSync(join(dir, '.migrated'))) return;
    for (const n of ['settings.json', 'state.json', 'memory.md', 'schedule.json', 'history.jsonl']) {
      const 옛 = join(DATA, n), 새 = join(dir, n);
      if (!existsSync(옛)) continue;
      if (!existsSync(새) || statSync(새).size <= 3) cpSync(옛, 새);   // 새 폴더가 비어 있을 때만(덮어쓰지 않는다)
    }
    const 옛일지 = join(DATA, 'journal'), 새일지 = join(dir, 'journal');
    if (existsSync(옛일지) && !existsSync(새일지)) cpSync(옛일지, 새일지, { recursive: true });
    writeFileSync(join(dir, '.migrated'), new Date().toISOString());
  } catch {}
}

const 기계설정 = () => readJson(join(DATA, 'settings.json'), {});   // 로그인 전에도 읽는 컴퓨터 단위 설정
const 로컬접속 = (req) => { const a = String(req.socket?.remoteAddress || ''); return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; };
const 밖으로열림 = !['127.0.0.1', 'localhost', '', undefined].includes(process.env.SANCHO_HOST);
const 첫계정 = () => { const u = readJson(join(DB, 'users.json'), {}); const id = Object.keys(u).find((k) => u[k]?.passwordHash) || Object.keys(u)[0]; return id || 'owner'; };
const 계정있음 = () => { try { return Object.values(readJson(join(DB, 'users.json'), {})).some((u) => u && u.passwordHash); } catch { return false; } };

const hashPassword = (password, salt = randomBytes(16).toString('hex')) => {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
};
const verifyPassword = (password, salt, hash) => {
  if(!password || !salt || !hash) return false;
  return scryptSync(password, salt, 64).toString('hex') === hash;
};

// ---------- 워크플로(자동화 흐름) — n8n 처럼 노드를 이어 붙여 만든 일을 산초가 순서대로 실행한다 ----------
// 데이터: db/workflows.json = { id: { name, desc, enabled, trigger, nodes:[{id,type,name,x,y,config}], edges:[{from,to,port}] } }
//        db/workflowruns.json = 실행 기록(최근 100개) — 화면은 이걸 구독해 진행 상황을 실시간으로 본다.
const 워크플로 = () => 컬렉션('workflows');
const 흐름값 = (ctx, path) => String(path || '').trim().split('.').reduce((o, k) => (o == null ? o : o[k]), ctx);
function 채우기(text, ctx) {   // "{{steps.조사.text}} 를 정리해라" → 값으로 바꾼다
  return String(text ?? '').replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
    const key = expr.trim();
    if (key === 'now') return new Date().toLocaleString('ko-KR');
    if (key === 'today') return ymd(new Date());
    const v = 흐름값(ctx, key);
    return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}
const 참인가 = (a, op, b) => {
  const n = (x) => (x === '' || x == null || isNaN(Number(x)) ? null : Number(x));
  switch (op) {
    case '포함': return String(a).includes(String(b));
    case '미포함': return !String(a).includes(String(b));
    case '같음': return String(a).trim() === String(b).trim();
    case '다름': return String(a).trim() !== String(b).trim();
    case '큼': return (n(a) ?? 0) > (n(b) ?? 0);
    case '작음': return (n(a) ?? 0) < (n(b) ?? 0);
    case '비었음': return !String(a ?? '').trim();
    case '있음': return !!String(a ?? '').trim();
    default: return false;
  }
};
// 두뇌에게 한 단계를 시키고 답 전체를 돌려준다(워크플로 안에서만 쓴다 — 채팅과 달리 이어가기 없이 매번 새로)
function 두뇌한번({ prompt, model, onDelta }) {
  return new Promise((ok) => {
    let out = '', done = false;
    const proc = claude실행({ prompt, model, onEvent: (e) => {
      if (e.t === 'delta') { out += e.text; onDelta && onDelta(e.text); }
      else if (e.t === 'text') out += (out ? '\n\n' : '') + e.text;
      else if (e.t === 'done') { if (done) return; done = true; ok({ ok: e.ok, text: e.ok ? (e.final || out) : e.text }); }
    } });
    if (현재) 현재.proc = proc;   // ■ 중지로 끊을 수 있게
  });
}
const 기록쓰기 = (runId, run) => db쓰기('workflowruns', runId, run, false);
function 기록정리() {   // 최근 100개만 남긴다
  const all = Object.entries(컬렉션('workflowruns')).sort((a, b) => String(b[1]?.startedAt || '').localeCompare(String(a[1]?.startedAt || '')));
  if (all.length <= 100) return;
  const map = Object.fromEntries(all.slice(0, 100)); 컬렉션저장('workflowruns', map); 알림({ col: 'workflowruns', op: 'trim' });
}

async function 워크플로실행(id, 트리거 = { type: 'manual' }, 입력 = '') {
  const wf = 워크플로()[id];
  if (!wf) return { error: '없는 워크플로예요' };
  if (현재) return { error: `지금 다른 일(${현재.kind})을 하고 있어요` };
  const nodes = Object.fromEntries((wf.nodes || []).map((n) => [n.id, n]));
  const edges = (wf.edges || []).map((e) => ({ ...e, port: e.port || 'out' }));
  const 다음 = (nid, port = 'out') => edges.filter((e) => e.from === nid && (e.port || 'out') === port).map((e) => nodes[e.to]).filter(Boolean);
  const 시작 = (wf.nodes || []).filter((n) => n.type === 'start' || !edges.some((e) => e.to === n.id));
  const runId = `${id}-${Date.now().toString(36)}`;
  const run = { workflowId: id, name: wf.name || id, trigger: 트리거.type, startedAt: new Date().toISOString(), status: '실행중', steps: [] };
  기록쓰기(runId, run);
  현재 = { proc: null, kind: `워크플로 ${wf.name || id}`, startedAt: Date.now() };
  const ctx = { trigger: { ...트리거, input: 입력 }, steps: {} };
  let 멈춤 = false;
  const 단계쓰기 = (s) => { run.steps = run.steps.filter((x) => x.nodeId !== s.nodeId || x.at !== s.at).concat(s); 기록쓰기(runId, run); };

  async function 노드실행(node, depth) {
    if (멈춤 || depth > 50) return;
    const t0 = Date.now(), step = { nodeId: node.id, name: node.name || node.type, type: node.type, at: new Date().toISOString(), status: '실행중' };
    단계쓰기(step);
    const c = node.config || {};
    let 결과 = null, 다음포트 = 'out';
    try {
      if (node.type === 'start' || node.type === 'schedule' || node.type === 'watch') 결과 = ctx.trigger.input || '';
      else if (node.type === 'ai') {
        const r = await 두뇌한번({ prompt: 채우기(c.prompt || '', ctx) + (c.format ? `\n\n답은 ${c.format} 형식으로만 써라. 설명은 붙이지 마라.` : ''), model: c.model || undefined });
        if (!r.ok) throw new Error(r.text || '두뇌가 답하지 못했어요');
        결과 = r.text;
      } else if (node.type === 'dbRead') {
        const rows = Object.entries(컬렉션(컬렉션이름(c.collection) || '_')).map(([k, v]) => ({ id: k, ...v }));
        const 걸러낸 = c.field ? rows.filter((r) => 참인가(흐름값(r, c.field), c.op || '같음', 채우기(c.value || '', ctx))) : rows;
        결과 = { count: 걸러낸.length, rows: 걸러낸.slice(0, Number(c.limit) || 50) };
      } else if (node.type === 'dbWrite') {
        const col = 컬렉션이름(c.collection); if (!col) throw new Error('컬렉션 이름이 필요해요');
        let data; try { data = JSON.parse(채우기(c.data || '{}', ctx)); } catch (e) { throw new Error(`내용이 JSON 이 아니에요: ${e.message}`); }
        const docId = 채우기(c.docId || '', ctx).trim() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        결과 = db쓰기(col, docId, data, c.merge !== false ? 'deep' : false); 결과 = { id: docId, ...결과 };
      } else if (node.type === 'if') {
        const 왼 = 채우기(c.left || '', ctx);
        다음포트 = 참인가(왼, c.op || '포함', 채우기(c.right || '', ctx)) ? 'true' : 'false';
        결과 = { 판정: 다음포트 === 'true' ? '참' : '거짓', 값: 왼.slice(0, 200) };
      } else if (node.type === 'http') {
        const r = await fetch(채우기(c.url || '', ctx), {
          method: c.method || 'GET',
          headers: { ...(c.contentType ? { 'content-type': c.contentType } : {}), ...(() => { try { return JSON.parse(채우기(c.headers || '{}', ctx)); } catch { return {}; } })() },
          body: (c.method && c.method !== 'GET') ? 채우기(c.body || '', ctx) : undefined,
          signal: AbortSignal.timeout(30000),
        });
        const txt = (await r.text()).slice(0, 20000);
        결과 = { status: r.status, text: txt, json: (() => { try { return JSON.parse(txt); } catch { return null; } })() };
        if (!r.ok) throw new Error(`${r.status} 응답: ${txt.slice(0, 200)}`);
      } else if (node.type === 'telegram') {
        const 보냄 = await 텔레그램(채우기(c.text || '', ctx));
        if (!보냄) throw new Error('텔레그램 설정(봇 토큰·chat id)이 없어요');
        결과 = '보냈어요';
      } else if (node.type === 'journal') {
        appendFileSync(join(일지폴더(), `${ymd(new Date())}.md`), `## ${hhmm(new Date())} · ${wf.name || id}\n${채우기(c.text || '', ctx)}\n\n`);
        결과 = '알림에 남겼어요';
      } else if (node.type === 'message') {
        const ch = 채우기(c.channelId || '', ctx).trim() || 'c1';
        결과 = db쓰기('messages', `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, { channelId: ch, userId: 'sancho', userName: 설정().name, text: 채우기(c.text || '', ctx), ts: new Date().toISOString() }, false);
      } else if (node.type === 'wait') {
        await new Promise((r) => setTimeout(r, Math.min(300, Math.max(1, Number(c.seconds) || 5)) * 1000));
        결과 = `${c.seconds || 5}초 기다렸어요`;
      } else if (node.type === 'set') {
        결과 = 채우기(c.value || '', ctx);
      } else throw new Error(`모르는 노드 종류: ${node.type}`);

      ctx.steps[node.name || node.id] = 결과;
      단계쓰기({ ...step, status: '완료', ms: Date.now() - t0, out: typeof 결과 === 'string' ? 결과.slice(0, 2000) : JSON.stringify(결과).slice(0, 2000), port: 다음포트 });
    } catch (e) {
      단계쓰기({ ...step, status: '실패', ms: Date.now() - t0, err: String(e?.message || e).slice(0, 500) });
      if (c.continueOnFail) { ctx.steps[node.name || node.id] = { error: String(e?.message || e) }; }
      else { 멈춤 = true; return; }
    }
    for (const n of 다음(node.id, 다음포트)) await 노드실행(n, depth + 1);
  }

  try {
    for (const s of 시작) await 노드실행(s, 0);
    run.status = 멈춤 ? '실패' : '완료';
  } catch (e) { run.status = '실패'; run.error = String(e?.message || e); }
  run.finishedAt = new Date().toISOString();
  run.ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  기록쓰기(runId, run); 기록정리();
  db쓰기('workflows', id, { lastRun: run.finishedAt, lastStatus: run.status }, 'deep');
  일끝();
  return { ok: true, runId, status: run.status };
}

// 시간 트리거: 예약과 같은 시계에 얹는다(사용자별로 돈다)
function 워크플로시계() {
  if (현재) return;
  const st = 상태(), now = new Date(), hm = hhmm(now), today = ymd(now);
  const runs = st.wfRuns || {};
  for (const [id, wf] of Object.entries(워크플로())) {
    if (!wf || wf.enabled === false || !wf.trigger) continue;
    const t = wf.trigger;
    if (t.type === 'schedule') {
      if (!/^\d{1,2}:\d{2}$/.test(String(t.time || ''))) continue;
      if (hm < String(t.time).padStart(5, '0') || runs[id] === today) continue;
      상태저장({ wfRuns: { ...runs, [id]: today } });
      워크플로실행(id, { type: 'schedule' }); return;
    }
    if (t.type === 'watch') {
      const 분 = Math.max(5, Number(t.minutes) || 10), last = (st.wfLast || {})[id] || 0;
      if (Date.now() - last < 분 * 60000) continue;
      상태저장({ wfLast: { ...(st.wfLast || {}), [id]: Date.now() } });
      워크플로실행(id, { type: 'watch' }); return;
    }
  }
}

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
  const token = (req.headers.cookie || '').split(';').find(c => c.trim().startsWith('sancho_session='))?.split('=').slice(1).join('=') || req.headers['x-session'];
  let uid = SESSIONS.get(token);
  if (process.env.SANCHO_TEST_USER) uid = process.env.SANCHO_TEST_USER;   // 자가시험 전용 — 실제 실행에서는 절대 설정하지 않는다
  // 아직 계정을 하나도 만들지 않은 산초(옛 단일 사용자 판)는 그대로 열어 둔다 — 계정을 만드는 순간부터 로그인이 필요해진다
  if (!uid && !계정있음()) uid = 'owner';
  // 이 컴퓨터에서 직접 열었고(루프백) 밖으로 열어 두지 않았으면, 설정에 따라 로그인 없이 쓴다.
  // 산초는 본디 "내 PC 의 개인 비서" 라서 혼자 쓸 땐 로그인이 걸리적거린다. 여럿이 쓰거나 밖으로 열면 자동으로 꺼진다.
  if (!uid && 로컬접속(req) && !밖으로열림 && 기계설정().localNoLogin !== false) uid = 첫계정();
  if (uid && !이사한.has(uid)) { 이사한.add(uid); 이사(uid); }   // 그 사람 폴더가 비어 있으면 옛 데이터를 한 번 옮겨 준다

  sessionContext.run(uid, async () => {
    try {
      if (route === 'GET /api/auth/me') {
        if (!uid) return send(res, 401, { error: 'Not logged in' });
        const u = readJson(join(DB, 'users.json'), {})[uid];
        if (!u && 계정있음()) return send(res, 401, { error: 'User deleted' });   // 지워진 계정
        const { passwordHash, salt, ...safeUser } = u || {};
        const s2 = 설정();
        return send(res, 200, { uid, name: s2.owner?.name || '주인', ...safeUser, company: s2.owner?.company || '', sancho: s2.name });
      }
      // 처음 켰을 때: 비밀번호가 있는 사용자가 하나도 없으면 로그인 화면이 "관리자 계정 만들기"를 보여준다.
      // 기본 비밀번호(admin123 같은 것)는 절대 심지 않는다 — 그 판이 밖으로 열리면 이 컴퓨터가 통째로 남의 것이 된다.
      if (route === 'GET /api/auth/status') {
        const users = readJson(join(DB, 'users.json'), {});
        return send(res, 200, { setup: !Object.values(users).some((u) => u && u.passwordHash), loggedIn: !!uid, host: process.env.SANCHO_HOST || '127.0.0.1',
          localNoLogin: 기계설정().localNoLogin !== false, openToNetwork: 밖으로열림 });
      }
      if (route === 'POST /api/auth/setup') {
        const users = readJson(join(DB, 'users.json'), {});
        if (Object.values(users).some((u) => u && u.passwordHash)) return send(res, 409, { error: '이미 계정이 있어요. 로그인해 주세요.' });
        const { name, loginId, password } = await readBody(req);
        const 아이디 = String(loginId || '').trim();
        if (!/^[A-Za-z0-9._-]{3,32}$/.test(아이디)) return send(res, 400, { error: '아이디는 영문·숫자 3~32자로 지어 주세요' });
        if (String(password || '').length < 8) return send(res, 400, { error: '비밀번호는 8자 이상으로 해 주세요' });
        const h = hashPassword(String(password));
        const id = users.owner ? 아이디.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'admin' : 'owner';   // 첫 계정은 기존 주인 문서(owner)에 붙인다
        users[id] = { ...(users[id] || {}), name: String(name || '관리자').trim(), loginId: 아이디, role: 'super', active: true, salt: h.salt, passwordHash: h.hash, createdAt: new Date().toISOString() };
        writeJson(join(DB, 'users.json'), users);
        이사(id);   // 옛 단일 사용자 데이터(설정·기억·예약·대화)를 이 계정 폴더로 옮긴다
        const newToken = randomUUID(); SESSIONS.set(newToken, id); 세션저장();
        res.setHeader('Set-Cookie', `sancho_session=${newToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${세션만료 / 1000}`);
        return send(res, 200, { ok: true, uid: id });
      }
      if (route === 'POST /api/auth/login') {
        const { loginId, password } = await readBody(req);
        const users = readJson(join(DB, 'users.json'), {});
        const userEntry = Object.entries(users).find(([, v]) => v && v.loginId === loginId);
        if (!userEntry) return send(res, 401, { error: '아이디 또는 비밀번호가 틀렸습니다.' });
        const [id, u] = userEntry;
        if (u.active === false) return send(res, 401, { error: '사용이 중지된 계정이에요.' });
        if (!u.passwordHash || !verifyPassword(password, u.salt, u.passwordHash)) return send(res, 401, { error: '아이디 또는 비밀번호가 틀렸습니다.' });
        const newToken = randomUUID();
        SESSIONS.set(newToken, id); 세션저장();
        이사(id);
        res.setHeader('Set-Cookie', `sancho_session=${newToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${세션만료 / 1000}`);
        return send(res, 200, { ok: true, uid: id });
      }
      if (route === 'POST /api/auth/password') {   // 비밀번호 바꾸기(본인)
        if (!uid) return send(res, 401, { error: '로그인이 필요합니다.' });
        const { oldPassword, password } = await readBody(req);
        const users = readJson(join(DB, 'users.json'), {}); const u = users[uid];
        if (!u || !verifyPassword(oldPassword, u.salt, u.passwordHash)) return send(res, 401, { error: '지금 비밀번호가 틀렸어요' });
        if (String(password || '').length < 8) return send(res, 400, { error: '비밀번호는 8자 이상으로 해 주세요' });
        const h = hashPassword(String(password)); users[uid] = { ...u, salt: h.salt, passwordHash: h.hash };
        writeJson(join(DB, 'users.json'), users); return send(res, 200, { ok: true });
      }
      if (route === 'POST /api/auth/logout') {
        if (token) { SESSIONS.delete(token); 세션저장(); }
        res.setHeader('Set-Cookie', 'sancho_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
        return send(res, 200, { ok: true });
      }

      // 로그인 문지기: API 는 401, 화면은 로그인 화면으로 보낸다(화면 소스도 로그인 전에는 안 보여 준다)
      if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')) {
        if (!uid) return send(res, 401, { error: '로그인이 필요합니다.' });
      }
      if (!uid && (route === 'GET /' || url.pathname.endsWith('.html') || url.pathname.startsWith('/m/')) && route !== 'GET /login.html') {
        res.writeHead(302, { location: '/login.html?next=' + encodeURIComponent(url.pathname + url.search) }); return res.end();
      }

      if (route === 'GET /login.html') return send(res, 200, readFileSync(join(ROOT, 'public', 'login.html')), 'text/html; charset=utf-8');
      if (route === 'GET /') return send(res, 200, readFileSync(join(ROOT, 'public', 'index.html')), 'text/html; charset=utf-8');
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/m/')) {   // 플랫폼 모듈 화면(public/m/**) — iframe 으로 껍데기 안에 뜬다. HEAD 는 "있나" 확인용(부서 도구함 배지)
      const abs = resolve(join(ROOT, 'public', 'm', decodeURIComponent(url.pathname.slice(3))));
      if (!안에(abs, join(ROOT, 'public', 'm')) || !existsSync(abs) || !statSync(abs).isFile()) return send(res, 404, '없는 화면이에요', 'text/plain; charset=utf-8');
      res.writeHead(200, { 'content-type': { ...MIME, '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }[extname(abs).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
      return createReadStream(abs).pipe(res);
    }
    if (route === 'GET /health') return send(res, 200, { ok: true, busy: 현재 ? 현재.kind : null, version: CLAUDE_VERSION });
    if (route === 'GET /favicon.ico') return send(res, 200, Buffer.from('PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzFFNkZEOSIvPjx0ZXh0IHg9IjE2IiB5PSIyMiIgZm9udC1zaXplPSIxOCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiPuKcszwvdGV4dD48L3N2Zz4=', 'base64'), 'image/svg+xml');
    // 외부 접속(선택): 설정에 접속 토큰이 있으면 API 는 토큰이 있어야 한다(터널로 밖에 열 때). 화면(/)은 토큰을 묻는다.
    const 토큰 = 설정().token;
    if (토큰 && url.pathname.startsWith('/api/') && req.headers['x-token'] !== 토큰 && url.searchParams.get('token') !== 토큰) return send(res, 401, { error: '접속 토큰이 필요해요' });
    if (url.pathname.startsWith('/api/db')) {   // 플랫폼 저장소 — sdb.js(Firestore 흉내)가 쓴다
      const seg = url.pathname.split('/').slice(3).map((s) => decodeURIComponent(s)).filter(Boolean), [c, id] = seg;
      if (!seg.length) return send(res, 200, 컬렉션목록().map((n) => ({ name: n, count: Object.keys(컬렉션(n)).length })));
      if (c === '_events') {   // SSE: 어느 컬렉션이 바뀌었는지
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write('data: {"hello":true}\n\n'); 구독자.add(res); req.on('close', () => 구독자.delete(res)); return;
      }
      if (c === '_batch' && req.method === 'POST') {
        const { ops } = await readBody(req); let n = 0;
        for (const o of Array.isArray(ops) ? ops : []) { const col = 컬렉션이름(o.col); if (!col || !o.id) continue; n++; if (o.op === 'delete') db지우기(col, String(o.id)); else db쓰기(col, String(o.id), o.data || {}, o.op === 'update' ? 'deep' : !!o.merge); }
        return send(res, 200, { ok: true, n });
      }
      const col = 컬렉션이름(c); if (!col) return send(res, 400, { error: '컬렉션 이름은 영문·숫자·_·- 만' });
      if (!id) {
        if (req.method === 'GET') return send(res, 200, Object.entries(컬렉션(col)).map(([k, v]) => ({ id: k, data: v })));
        if (req.method === 'POST') { const nid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); db쓰기(col, nid, (await readBody(req)).data || {}, false); return send(res, 200, { id: nid }); }
      } else {
        if (req.method === 'GET') { const d = 컬렉션(col)[id]; return send(res, 200, d === undefined ? { id, exists: false } : { id, data: d }); }
        if (req.method === 'PUT') { const b = await readBody(req); return send(res, 200, { id, data: db쓰기(col, id, b.data || {}, b.merge) }); }
        if (req.method === 'DELETE') return send(res, 200, { ok: db지우기(col, id) });
      }
      return send(res, 405, { error: 'method' });
    }
    if (route === 'POST /api/workflow/run') {   // 화면의 ▶ 실행. 진행 상황은 db/workflowruns 구독으로 실시간으로 본다
      const { id, input } = await readBody(req);
      const r = await 워크플로실행(String(id || ''), { type: 'manual' }, String(input || ''));
      return send(res, r.error ? 409 : 200, r);
    }
    if (route === 'GET /api/journal') return send(res, 200, 일지(Math.min(60, Number(url.searchParams.get('days')) || 7)));
    if (route === 'GET /api/search') { const q = String(url.searchParams.get('q') || '').trim(); return send(res, 200, q.length < 1 ? [] : 검색(q)); }
    if (route === 'GET /api/state') {
      const st = 상태();
      return send(res, 200, {
        claude: { path: CLAUDE, version: CLAUDE_VERSION, ok: !!CLAUDE }, settings: 설정(), session: st.session, sessions: st.sessions, busy: 현재 ? 현재.kind : null, pendingRestart: 재시작예약,
        schedules: 예약목록().map((j) => ({ ...j, lastRun: st.runs[j.id] || null })), memory: readText(p('memory.md')), journal: 일지(), history: 기록(st.session),
        skills: ls(join(DATA, '.claude', 'skills')), wiki: ls(join(DATA, 'wiki'), (f) => f.endsWith('.md')),
        canAutostart: !!시작바로가기, autostart: !!(시작바로가기 && existsSync(시작바로가기)),
        // 만들어져 있는 플랫폼 화면 — 껍데기가 이걸 보고 메뉴를 켠다
        modules: ls(join(ROOT, 'public', 'm'), (f) => f.endsWith('.html')).map((f) => f.slice(0, -5)),
        wbs: ls(join(DATA, 'wbs'), (f) => f.endsWith('.json')).map((f) => { const d = readJson(join(DATA, 'wbs', f), {}); const c = wbs계산(d); return { name: f.slice(0, -5), title: d.name || f.slice(0, -5), pct: c.ev, spi: c.spi, late: c.late }; }),
      });
    }
    if (route === 'POST /api/backup') {   // 데이터 폴더 통째로 zip(파이스 backup_workspace) → data/backups/. 카드로 내려받기
      mkdirSync(p('backups'), { recursive: true });
      const zip = p(`backups/sancho-${ymd(new Date())}-${hhmm(new Date()).replace(':', '')}.zip`);
      const ps = `Get-ChildItem -LiteralPath '${DATA}' -Exclude backups | Compress-Archive -DestinationPath '${zip}' -Force`;
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true, timeout: 120000 },
        (e, _o, err) => e ? send(res, 500, { error: `백업 실패: ${String(err || e.message).slice(0, 300)}` }) : send(res, 200, { path: zip, name: basename(zip), size: statSync(zip).size }));
      return;
    }
    if (route === 'POST /api/quit') {   // 완전 종료(코드 0 → sancho.bat 루프도 끝난다). 숨겨서 돌아가니 끄는 길은 이것뿐
      send(res, 200, { ok: true, note: '산초를 끕니다. 다시 켤 때는 sancho.bat 을 실행하거나 컴퓨터를 다시 켜세요.' });
      setTimeout(() => process.exit(0), 300); return;
    }
    if (route === 'POST /api/autostart') {
      try { await 자동실행(!!(await readBody(req)).on); return send(res, 200, { autostart: existsSync(시작바로가기) }); } catch (e) { return send(res, 409, { error: e.message }); }
    }
    if (route === 'GET /neural.js') return send(res, 200, readFileSync(join(ROOT, 'public', 'neural.js')), 'application/javascript; charset=utf-8');
    if (route === 'GET /wbs.html') return send(res, 200, readFileSync(join(ROOT, 'public', 'wbs.html')), 'text/html; charset=utf-8');
    if (route === 'GET /api/wbs') {   // ?name= 없으면 프로젝트 목록(요약), 있으면 그 공정표의 계산 결과
      const name = url.searchParams.get('name');
      if (!name) return send(res, 200, ls(join(DATA, 'wbs'), (f) => f.endsWith('.json')).map((f) => { const d = readJson(join(DATA, 'wbs', f), {}); const c = wbs계산(d); return { name: f.slice(0, -5), title: d.name || f.slice(0, -5), items: c.rows.length, pct: c.ev, pv: c.pv, spi: c.spi, late: c.late }; }));
      const file = wbs파일(name); if (!file || !existsSync(file)) return send(res, 404, { error: '없는 공정표예요' });
      const raw = readJson(file, null); if (!raw) return send(res, 409, { error: `${name}.json 이 JSON 형식이 아니에요 — 산초에게 고쳐 달라고 하세요` });
      return send(res, 200, { ...wbs계산(raw), name: raw.name || name, file: name, history: ls(join(DATA, 'wbs', '_history'), (f) => f.startsWith(name + '_')).sort().reverse().slice(0, 20) });
    }
    if (route === 'POST /api/wbs/save') {   // 프로젝트 화면에서 공정표 뼈대 만들기/덮어쓰기(있던 판은 이력에 남긴다)
      const { name, doc } = await readBody(req); const file = wbs파일(String(name || '')); if (!file || !doc || typeof doc !== 'object') return send(res, 400, { error: '이름과 doc 이 필요해요' });
      if (existsSync(file)) { mkdirSync(join(DATA, 'wbs', '_history'), { recursive: true }); cpSync(file, join(DATA, 'wbs', '_history', `${name}_${ymd(new Date())}-${hhmm(new Date()).replace(':', '')}.json`)); }
      writeJson(file, { name: doc.name || name, no: doc.no || '', items: Array.isArray(doc.items) ? doc.items : [] }); return send(res, 200, { ok: true, name });
    }
    if (route === 'POST /api/wbs/snapshot') {   // 지금 판을 이력에 남긴다(플랫폼의 Rev 이력)
      const { name } = await readBody(req); const file = wbs파일(name); if (!file || !existsSync(file)) return send(res, 404, { error: '없는 공정표예요' });
      mkdirSync(join(DATA, 'wbs', '_history'), { recursive: true });
      const snap = `${name}_${ymd(new Date())}-${hhmm(new Date()).replace(':', '')}.json`; cpSync(file, join(DATA, 'wbs', '_history', snap)); return send(res, 200, { ok: true, snap });
    }
    if (route === 'POST /api/wbs/restore') {   // 이력의 판으로 되돌린다(되돌리기 전 지금 판도 이력에 남김)
      const { name, snap } = await readBody(req); const file = wbs파일(name), src = join(DATA, 'wbs', '_history', String(snap || ''));
      if (!file || !/^[^\\/]+\.json$/.test(String(snap || '')) || !existsSync(src)) return send(res, 404, { error: '없는 이력이에요' });
      if (existsSync(file)) { mkdirSync(join(DATA, 'wbs', '_history'), { recursive: true }); cpSync(file, join(DATA, 'wbs', '_history', `${name}_${ymd(new Date())}-${hhmm(new Date()).replace(':', '')}_복원전.json`)); }
      cpSync(src, file); return send(res, 200, { ok: true });
    }
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
    if (route === 'POST /api/settings') {
      const b = await readBody(req);
      writeJson(p('settings.json'), { ...설정(), ...b });
      // "이 컴퓨터에선 로그인 없이" 는 사람이 아니라 컴퓨터의 성질이라 공용 파일에도 같이 적는다(로그인 전에 읽어야 한다)
      if ('localNoLogin' in b) writeJson(join(DATA, 'settings.json'), { ...기계설정(), localNoLogin: !!b.localNoLogin });
      return send(res, 200, 설정());
    }
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
  });
}).on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log(`산초가 이미 켜져 있어요 → 브라우저에서 http://127.0.0.1:${PORT} 를 여세요`);   // sancho.bat 을 두 번 눌러도 놀라지 않게
  process.exit(0);
}).listen(PORT, process.env.SANCHO_HOST || '127.0.0.1', () => {   // 기본은 이 컴퓨터에서만. 밖으로 열려면 SANCHO_HOST 를 일부러 준다(아래 경고 참고)
  const HOST = process.env.SANCHO_HOST || '127.0.0.1';
  console.log(`산초 → http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}   두뇌: ${CLAUDE ? CLAUDE_VERSION : 'Claude Code 를 찾지 못했어요 (README 참고)'}`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.log('⚠️  밖(네트워크)으로 열려 있습니다. 산초는 이 컴퓨터의 Claude Code 로 명령을 실행할 수 있으니,');
    console.log('    반드시 ① 강한 비밀번호 ② ⚙ 설정의 접속 토큰 ③ 믿는 망에서만 — 셋을 확인하세요.');
  }
  // 잘 켜진 코드를 "마지막 정상판"으로 표시한다 — 작업 폴더가 깨끗할 때만(커밋 안 된 코드가 돌고 있으면 표시를 옮기지 않는다).
  // sancho.bat 이 비정상 종료 뒤 이 표시로 복구한다. git 이 없거나 저장소가 아니면 조용히 건너뛴다.
  git('status', '--porcelain').then((dirty) => dirty ? null : git('tag', '-f', 'last-good')).catch(() => {});
});
