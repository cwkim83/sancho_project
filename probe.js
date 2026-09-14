// probe.js — 화면 실행 검사기. 크롬을 숨겨서 띄우고 페이지를 열어 **콘솔 오류와 실제 DOM** 을 받아온다.
// 문법 검사(node --check)만으로는 "화면이 실제로 뜨는지" 를 알 수 없어서 만든 도구다(파이스에서 화면을 두 번 죽인 교훈).
// 쓰는 법:  node probe.js <주소> [기다릴ms=4000] [DOM저장경로] [시킬JS파일] [쿠키 "이름=값"]
//   예)     node probe.js http://127.0.0.1:8790/m/calendar.html 5000 out.html click.js
// 나오는 것: 콘솔 줄(오류·경고·로그) 요약 + 400 이상 응답 + DOM 길이. 오류가 하나라도 있으면 종료 코드 1.
// 시킬JS파일: 화면이 뜬 뒤 그 파일의 코드를 페이지 안에서 실행한다(await 써도 된다). 돌려준 값은 JSON 으로 찍힌다 —
//   버튼을 눌러 모달이 열리는지, 저장이 되는지까지 검사할 때 쓴다. 실행 뒤 콘솔 오류가 늘면 그것도 잡힌다.
// SSE(EventSource)처럼 연결이 끊기지 않는 화면도 검사할 수 있다 — --dump-dom 은 그런 화면에서 영영 끝나지 않는다.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2];
const waitMs = Number(process.argv[3] || 4000);
const outPath = process.argv[4] || '';
const jsPath = process.argv[5] || '';
const cookie = process.argv[6] || '';   // "이름=값" — 로그인한 화면을 검사할 때
if (!url) { console.error('쓰는 법: node probe.js <주소> [ms] [DOM저장경로] [시킬JS파일]'); process.exit(2); }

const 크롬후보 = [process.env.CHROME, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const CHROME = 크롬후보.find((p) => existsSync(p));
if (!CHROME) { console.error('크롬(또는 엣지)을 찾지 못했어요. CHROME 환경변수로 경로를 주세요.'); process.exit(2); }

const port = 9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), 'sancho-probe-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--window-size=1440,900', '--disable-features=Translate,MediaRouter', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const 청소 = () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', 청소); process.on('SIGINT', () => { 청소(); process.exit(130); });

const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));
async function 대상찾기() {
  for (let i = 0; i < 60; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) return page; } catch {}
    await 잠깐(200);
  }
  throw new Error('크롬 디버깅 포트에 붙지 못했어요');
}

const 콘솔 = [], 실패응답 = [];
const 글자 = (a) => a == null ? '' : a.value !== undefined ? String(a.value) : a.description || a.unserializableValue || (a.preview ? JSON.stringify(a.preview.properties?.map((p) => `${p.name}:${p.value}`)) : a.type);

const ws = new WebSocket((await 대상찾기()).webSocketDebuggerUrl);
let id = 0; const 대기 = new Map();
const cmd = (method, params = {}) => new Promise((ok, no) => { const n = ++id; 대기.set(n, { ok, no }); ws.send(JSON.stringify({ id: n, method, params })); setTimeout(() => { if (대기.delete(n)) no(new Error(method + ' 응답 없음')); }, 20000); });
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && 대기.has(m.id)) { const { ok, no } = 대기.get(m.id); 대기.delete(m.id); return m.error ? no(new Error(m.error.message)) : ok(m.result); }
  const p = m.params || {};
  if (m.method === 'Runtime.consoleAPICalled') 콘솔.push({ level: p.type === 'error' ? 'error' : p.type === 'warning' ? 'warn' : 'log', text: (p.args || []).map(글자).join(' ') });
  else if (m.method === 'Runtime.exceptionThrown') 콘솔.push({ level: 'error', text: '예외: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '') });
  else if (m.method === 'Log.entryAdded' && p.entry) { const lv = p.entry.level === 'error' ? 'error' : p.entry.level === 'warning' ? 'warn' : 'log'; 콘솔.push({ level: lv, text: `[${p.entry.source}] ${p.entry.text}` }); }
  else if (m.method === 'Network.responseReceived' && p.response?.status >= 400) 실패응답.push(`${p.response.status} ${p.response.url}`);
  else if (m.method === 'Network.loadingFailed' && !/net::ERR_ABORTED/.test(p.errorText || '')) 실패응답.push(`실패 ${p.errorText} ${p.type}`);
});
await new Promise((ok, no) => { ws.addEventListener('open', ok); ws.addEventListener('error', () => no(new Error('웹소켓 연결 실패'))); });

await cmd('Runtime.enable'); await cmd('Log.enable'); await cmd('Network.enable'); await cmd('Page.enable');
await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }).catch(() => {});
if (cookie) {   // 로그인 쿠키를 먼저 심는다(로그인 뒤 화면을 검사할 때)
  const [name, ...rest] = cookie.split('=');
  const u = new URL(url);
  await cmd('Network.setCookie', { name, value: rest.join('='), domain: u.hostname, path: '/', httpOnly: true });
}
await cmd('Page.navigate', { url });
await 잠깐(waitMs);
const dom = (await cmd('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true })).result?.value || '';
if (outPath) writeFileSync(outPath, dom);

let 시킨결과 = null;
if (jsPath) {
  const code = readFileSync(jsPath, 'utf8');
  const r = await cmd('Runtime.evaluate', { expression: `(async () => { ${code} })()`, awaitPromise: true, returnByValue: true, timeout: 20000 });
  시킨결과 = r.exceptionDetails ? { 오류: r.exceptionDetails.exception?.description || r.exceptionDetails.text } : r.result?.value;
  if (r.exceptionDetails) 콘솔.push({ level: 'error', text: '시킨 JS 실패: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) });
  await 잠깐(600);
  if (outPath) writeFileSync(outPath, (await cmd('Runtime.evaluate', { expression: 'document.documentElement.outerHTML', returnByValue: true })).result?.value || dom);
}

const 오류 = 콘솔.filter((c) => c.level === 'error');
const 경고 = 콘솔.filter((c) => c.level === 'warn');
console.log(`# ${url}  (${waitMs}ms 대기)`);
console.log(`DOM ${dom.length} 글자${outPath ? ` → ${outPath}` : ''} · 콘솔 ${콘솔.length}줄 · 오류 ${오류.length} · 경고 ${경고.length} · 실패 응답 ${실패응답.length}`);
for (const c of 오류) console.log('  ❌ ' + c.text.slice(0, 400));
for (const c of 경고.slice(0, 10)) console.log('  ⚠️ ' + c.text.slice(0, 200));
for (const r of 실패응답.slice(0, 10)) console.log('  🌐 ' + r.slice(0, 200));
for (const c of 콘솔.filter((c) => c.level === 'log').slice(0, 10)) console.log('  · ' + c.text.slice(0, 200));
if (시킨결과 !== null) console.log('시킨 JS 결과: ' + JSON.stringify(시킨결과, null, 1).slice(0, 2000));
청소();
process.exit(오류.length || 실패응답.length ? 1 : 0);
