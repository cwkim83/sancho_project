// 산초 브라우저 — 진짜 크롬 창을 띄우고 DevTools 프로토콜로 조종한다. 외부 패키지 없음(Node 22+ 의 WebSocket).
//
// 크롬은 산초 전용 프로필(data/chrome-profile)로 뜬다. 거기서 한 번 로그인해 두면 다음부터는 로그인이 살아 있다.
//
// 사용:
//   node tools/browser.js open <url>            창을 띄우고(이미 떠 있으면 재사용) 그 주소로 간다
//   node tools/browser.js look [파일이름]       지금 화면: 제목·주소·보이는 글·메뉴/버튼/링크 목록 + 스크린샷(data/파일함/)
//   node tools/browser.js click <글자>          그 글자가 보이는 버튼/링크/메뉴를 누른다
//   node tools/browser.js type <css선택자> <글> 입력칸에 글을 넣는다
//   node tools/browser.js eval <자바스크립트>   페이지에서 코드를 돌려 결과를 출력
//   node tools/browser.js html [파일이름]       현재 DOM 을 data/파일함/ 에 저장
//   node tools/browser.js close                 크롬 창을 닫는다

import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PROFILE = path.join(ROOT, 'data', 'chrome-profile')
const OUT = path.join(ROOT, 'data', '파일함')
const PORT = 9222
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function alive() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(800) })
    return r.ok
  } catch {
    return false
  }
}

async function launch(url) {
  if (await alive()) return
  if (!CHROME) throw new Error('크롬이나 엣지를 찾지 못했습니다.')
  fs.mkdirSync(PROFILE, { recursive: true })
  const child = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,900',
      '--lang=ko-KR',
      url || 'about:blank',
    ],
    { detached: true, stdio: 'ignore' }
  )
  child.unref()
  for (let i = 0; i < 40; i++) {
    if (await alive()) return
    await sleep(250)
  }
  throw new Error('크롬이 10초 안에 뜨지 않았습니다.')
}

async function pages() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  return (await r.json()).filter((t) => t.type === 'page')
}

// DevTools 프로토콜 — 한 탭에 붙어 명령을 보내고 답을 기다린다
class Tab {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id)
        this.pending.delete(m.id)
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
      }
    }
  }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = () => rej(new Error('탭에 연결하지 못했습니다.'))
    })
    return new Tab(ws)
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`${method} 응답이 없습니다 (20초).`))
        }
      }, 20000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '페이지 코드 오류')
    return r.result.value
  }
  close() {
    try {
      this.ws.close()
    } catch {}
  }
}

async function current() {
  const list = await pages()
  if (!list.length) throw new Error('열린 탭이 없습니다. 먼저 open 하세요.')
  const t = list[0]
  const tab = await Tab.connect(t.webSocketDebuggerUrl)
  await tab.send('Page.enable')
  await tab.send('Runtime.enable')
  return tab
}

async function settle(tab, ms = 1500) {
  // 로딩이 끝나고 잠깐 더 기다린다 — SPA 는 문서가 끝나도 화면을 뒤늦게 그린다
  for (let i = 0; i < 40; i++) {
    const st = await tab.eval('document.readyState').catch(() => 'loading')
    if (st === 'complete') break
    await sleep(250)
  }
  await sleep(ms)
}

// 화면에 보이는 것만 추려 낸다: 글, 메뉴/버튼/링크
const LOOK_JS = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const items = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('a,button,[role=button],[role=tab],[role=menuitem],[role=link],nav li,aside li,[class*=sidebar] li,[class*=menu] li,[class*=nav] li')) {
    if (!vis(el)) continue;
    const t = clean(el.innerText || el.getAttribute('aria-label') || el.title);
    if (!t || t.length > 60 || seen.has(t)) continue;
    seen.add(t);
    const r = el.getBoundingClientRect();
    items.push({ t, x: Math.round(r.left), y: Math.round(r.top), href: el.href || '' });
  }
  const side = [...document.querySelectorAll('aside,nav,[class*=sidebar],[class*=Sidebar],[class*=side-bar],[class*=drawer]')].filter(vis).map((e) => clean(e.innerText)).filter(Boolean);
  const heads = [...document.querySelectorAll('h1,h2,h3')].filter(vis).map((e) => clean(e.innerText)).filter(Boolean).slice(0, 40);
  const body = clean(document.body.innerText).slice(0, 4000);
  return { title: document.title, url: location.href, side, heads, items, body, w: innerWidth, h: innerHeight };
})()`

async function look(name) {
  const tab = await current()
  try {
    await settle(tab, 800)
    const d = await tab.eval(LOOK_JS)
    fs.mkdirSync(OUT, { recursive: true })
    const file = path.join(OUT, (name || 'browser') + '.png')
    const shot = await tab.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
    console.log(`제목: ${d.title}\n주소: ${d.url}\n스크린샷: ${file}`)
    if (d.side.length) console.log('\n[사이드바/내비]\n' + d.side.map((s) => '  ' + s.slice(0, 600)).join('\n'))
    if (d.heads.length) console.log('\n[제목들]\n  ' + d.heads.join(' | '))
    if (d.items.length) {
      console.log('\n[누를 수 있는 것] (왼쪽→오른쪽, 위→아래)')
      d.items.sort((a, b) => a.x - b.x || a.y - b.y)
      for (const it of d.items) console.log(`  (${it.x},${it.y}) ${it.t}${it.href ? '  → ' + it.href : ''}`)
    }
    console.log('\n[본문 글]\n' + d.body)
  } finally {
    tab.close()
  }
}

async function click(text) {
  const tab = await current()
  try {
    const ok = await tab.eval(`(() => {
      const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
      const want = ${JSON.stringify(text)};
      const els = [...document.querySelectorAll('a,button,[role=button],[role=tab],[role=menuitem],li,span,div')];
      const hit = els.find((e) => clean(e.innerText) === want) || els.find((e) => clean(e.innerText).includes(want) && clean(e.innerText).length < want.length + 20);
      if (!hit) return false;
      hit.scrollIntoView({ block: 'center' }); hit.click(); return true;
    })()`)
    if (!ok) throw new Error(`'${text}' 를 화면에서 찾지 못했습니다.`)
    await settle(tab)
    console.log(`눌렀습니다: ${text}`)
  } finally {
    tab.close()
  }
}

async function type(sel, text) {
  const tab = await current()
  try {
    const ok = await tab.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false;
      el.focus(); el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true;
    })()`)
    if (!ok) throw new Error(`'${sel}' 입력칸을 찾지 못했습니다.`)
    console.log(`입력했습니다: ${sel}`)
  } finally {
    tab.close()
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'open') {
    const url = rest[0]
    if (!url) throw new Error('주소를 적어 주세요.')
    await launch(url)
    const tab = await current()
    try {
      await tab.send('Page.navigate', { url })
      await settle(tab)
      console.log('열었습니다: ' + (await tab.eval('location.href')))
    } finally {
      tab.close()
    }
    return
  }
  if (cmd === 'look') return look(rest[0])
  if (cmd === 'click') return click(rest.join(' '))
  if (cmd === 'type') return type(rest[0], rest.slice(1).join(' '))
  if (cmd === 'eval') {
    const tab = await current()
    try {
      console.log(JSON.stringify(await tab.eval(rest.join(' ')), null, 2))
    } finally {
      tab.close()
    }
    return
  }
  if (cmd === 'html') {
    const tab = await current()
    try {
      const html = await tab.eval('document.documentElement.outerHTML')
      fs.mkdirSync(OUT, { recursive: true })
      const file = path.join(OUT, (rest[0] || 'page') + '.html')
      fs.writeFileSync(file, html)
      console.log(`저장: ${file} (${html.length}자)`)
    } finally {
      tab.close()
    }
    return
  }
  if (cmd === 'close') {
    if (await alive()) {
      const tab = await current()
      try {
        await tab.send('Browser.close')
      } catch {}
      tab.close()
    }
    console.log('닫았습니다.')
    return
  }
  throw new Error('모르는 명령입니다: open, look, click, type, eval, html, close')
}

main().catch((e) => {
  console.error(String(e.message || e))
  process.exit(1)
})
