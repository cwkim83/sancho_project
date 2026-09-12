// 산초 메일 도구 — 네이버·다음·네이트 등 IMAP 메일함을 읽는다. 외부 패키지 없음.
//
// 설정: data/mail.json  (data/ 는 git 에 안 올라감)
//   { "accounts": [ { "name": "naver", "user": "아이디@naver.com", "pass": "앱비밀번호" } ] }
//   host/port 는 도메인 보고 자동으로 정한다. 필요하면 직접 적어도 된다.
//
// 사용:
//   node tools/mail.js list   [--n 10] [--account naver] [--box INBOX]
//   node tools/mail.js unread [--n 20] [--account naver]
//   node tools/mail.js search <낱말> [--n 20] [--account naver]
//   node tools/mail.js read <번호>   [--account naver]
//   node tools/mail.js boxes  [--account naver]

import tls from 'node:tls'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CONFIG = path.join(ROOT, 'data', 'mail.json')

const PRESETS = {
  'naver.com': { host: 'imap.naver.com', port: 993 },
  'daum.net': { host: 'imap.daum.net', port: 993 },
  'hanmail.net': { host: 'imap.daum.net', port: 993 },
  'nate.com': { host: 'imap.nate.com', port: 993 },
  'kakao.com': { host: 'imap.kakao.com', port: 993 },
  'gmail.com': { host: 'imap.gmail.com', port: 993 },
  'outlook.com': { host: 'outlook.office365.com', port: 993 },
  'hotmail.com': { host: 'outlook.office365.com', port: 993 },
}

// ---------- 설정 ----------

function loadAccount(name) {
  if (!fs.existsSync(CONFIG)) {
    throw new Error(
      `설정 파일이 없습니다: ${CONFIG}\n` +
        `아래 내용으로 만들어 주세요.\n` +
        `{ "accounts": [ { "name": "naver", "user": "아이디@naver.com", "pass": "앱비밀번호" } ] }\n` +
        `네이버: 메일 > 환경설정 > POP3/IMAP 설정에서 IMAP 사용함으로 켜고,\n` +
        `2단계 인증을 쓰면 네이버 내정보에서 애플리케이션 비밀번호를 발급받아 pass 에 넣습니다.`
    )
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
  const list = cfg.accounts || []
  if (!list.length) throw new Error(`${CONFIG} 에 accounts 가 비어 있습니다.`)
  const acc = name ? list.find((a) => a.name === name) : list[0]
  if (!acc) throw new Error(`'${name}' 계정을 찾을 수 없습니다. 있는 계정: ${list.map((a) => a.name).join(', ')}`)
  const domain = String(acc.user || '').split('@')[1] || ''
  const preset = PRESETS[domain.toLowerCase()] || {}
  const host = acc.host || preset.host
  if (!host) throw new Error(`'${acc.name}' 에 host 를 적어 주세요 (도메인 ${domain} 은 자동 설정이 없습니다).`)
  return { ...acc, host, port: acc.port || preset.port || 993 }
}

// ---------- 글자 풀기 ----------

function decodeBytes(buf, charset) {
  const cs = String(charset || 'utf-8').toLowerCase().replace(/^ks_c_5601-1987$/, 'euc-kr')
  try {
    return new TextDecoder(cs).decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}

function decodeQP(text, forHeader) {
  const s = forHeader ? text.replace(/_/g, ' ') : text.replace(/=\r?\n/g, '')
  const out = []
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /[0-9A-Fa-f]{2}/.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16))
      i += 2
    } else out.push(s.charCodeAt(i) & 0xff)
  }
  return Buffer.from(out)
}

// =?UTF-8?B?...?= 같은 머리글 낱말을 사람 글자로 되돌린다.
function decodeMime(str) {
  if (!str) return ''
  return str
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, cs, enc, txt) => {
      const buf = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64') : decodeQP(txt, true)
      return decodeBytes(buf, cs)
    })
}

function parseHeaders(raw) {
  const h = {}
  const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ')
  for (const line of unfolded.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9-]+):\s?(.*)$/)
    if (m) h[m[1].toLowerCase()] = m[2]
  }
  return h
}

// ---------- IMAP ----------

class Imap {
  constructor(opts) {
    this.opts = opts
    this.n = 0
    this.buf = ''
    this.pending = null
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.sock = tls.connect({ host: this.opts.host, port: this.opts.port, servername: this.opts.host })
      this.sock.setEncoding('latin1') // 바이트 길이를 그대로 지키려고 latin1 로 받는다
      this.sock.setTimeout(30000, () => this.fail(new Error('메일 서버가 응답하지 않습니다 (30초).')))
      this.sock.on('data', (d) => {
        this.buf += d
        this.check()
      })
      this.sock.on('error', (e) => this.fail(e))
      this.wait(/^\* (OK|PREAUTH)/m).then(() => resolve(), reject)
    })
  }

  fail(err) {
    if (this.pending) {
      const p = this.pending
      this.pending = null
      p.reject(err)
    }
  }

  check() {
    if (!this.pending) return
    const m = this.buf.match(this.pending.re)
    if (!m) return
    const p = this.pending
    this.pending = null
    const data = this.buf
    this.buf = ''
    p.resolve(data)
  }

  wait(re) {
    return new Promise((resolve, reject) => {
      this.pending = { re, resolve, reject }
      this.check()
    })
  }

  async cmd(line) {
    const tag = 'a' + ++this.n
    this.sock.write(tag + ' ' + line + '\r\n')
    const data = await this.wait(new RegExp('^' + tag + ' (OK|NO|BAD)(.*)$', 'm'))
    const m = data.match(new RegExp('^' + tag + ' (OK|NO|BAD)(.*)$', 'm'))
    if (m[1] !== 'OK') throw new Error(`메일 서버 거절: ${line.split(' ')[0]} — ${m[2].trim()}`)
    return data
  }

  quote(s) {
    return '"' + String(s).replace(/([\\"])/g, '\\$1') + '"'
  }

  login() {
    return this.cmd(`LOGIN ${this.quote(this.opts.user)} ${this.quote(this.opts.pass)}`)
  }

  async select(box) {
    const data = await this.cmd(`SELECT ${this.quote(box)}`)
    const m = data.match(/^\* (\d+) EXISTS/m)
    return m ? +m[1] : 0
  }

  close() {
    try {
      this.sock.end()
    } catch {}
  }
}

// FETCH 응답에서 {길이} 뒤에 오는 덩어리를 꺼낸다.
function parseFetch(data) {
  const out = []
  const re = /\* (\d+) FETCH \(/g
  let m
  while ((m = re.exec(data))) {
    const rest = data.slice(m.index)
    const lit = rest.match(/\{(\d+)\}\r\n/)
    if (!lit) continue
    const start = m.index + lit.index + lit[0].length
    const len = +lit[1]
    out.push({ seq: +m[1], raw: data.slice(start, start + len) })
  }
  return out
}

function searchNums(data) {
  const m = data.match(/^\* SEARCH([^\r\n]*)/m)
  if (!m) return []
  return m[1].trim().split(/\s+/).filter(Boolean).map(Number)
}

function briefDate(s) {
  const d = new Date(s)
  if (isNaN(d)) return (s || '').slice(0, 16)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function fetchHeaders(im, nums) {
  if (!nums.length) return []
  const data = await im.cmd(`FETCH ${nums.join(',')} (BODY.PEEK[HEADER.FIELDS (DATE FROM SUBJECT)])`)
  return parseFetch(data)
    .map(({ seq, raw }) => {
      const h = parseHeaders(Buffer.from(raw, 'latin1').toString('latin1'))
      return {
        seq,
        date: briefDate(h.date),
        from: decodeMime(h.from || '').replace(/\s*<[^>]*>\s*$/, (m) => ' ' + m.trim()),
        subject: decodeMime(h.subject || '(제목 없음)'),
      }
    })
    .sort((a, b) => b.seq - a.seq)
}

function printList(rows, label) {
  if (!rows.length) {
    console.log(`${label}: 없습니다.`)
    return
  }
  console.log(`${label}: ${rows.length}통`)
  for (const r of rows) console.log(`[${r.seq}] ${r.date}  ${r.from}\n      ${r.subject}`)
}

// 본문에서 읽을 만한 text/plain 조각을 찾아 푼다.
function extractText(rawLatin1) {
  const sep = rawLatin1.indexOf('\r\n\r\n')
  const head = parseHeaders(sep < 0 ? rawLatin1 : rawLatin1.slice(0, sep))
  let body = sep < 0 ? '' : rawLatin1.slice(sep + 4)
  let ctype = head['content-type'] || 'text/plain'
  let enc = (head['content-transfer-encoding'] || '7bit').toLowerCase()

  const boundary = (ctype.match(/boundary="?([^";]+)"?/i) || [])[1]
  if (boundary) {
    const parts = body.split('--' + boundary)
    let chosen = null
    for (const part of parts) {
      const s = part.indexOf('\r\n\r\n')
      if (s < 0) continue
      const ph = parseHeaders(part.slice(0, s))
      const pt = ph['content-type'] || ''
      if (/text\/plain/i.test(pt)) {
        chosen = { head: ph, body: part.slice(s + 4) }
        break
      }
      if (!chosen && /text\/html/i.test(pt)) chosen = { head: ph, body: part.slice(s + 4) }
    }
    if (chosen) {
      ctype = chosen.head['content-type'] || 'text/plain'
      enc = (chosen.head['content-transfer-encoding'] || '7bit').toLowerCase()
      body = chosen.body
    }
  }

  const charset = (ctype.match(/charset="?([^";\s]+)"?/i) || [])[1] || 'utf-8'
  let buf
  if (enc === 'base64') buf = Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64')
  else if (enc === 'quoted-printable') buf = decodeQP(body, false)
  else buf = Buffer.from(body, 'latin1')

  let text = decodeBytes(buf, charset)
  if (/text\/html/i.test(ctype)) {
    text = text
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
  }
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ---------- 명령 ----------

function parseArgs(argv) {
  const opts = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) opts[a.slice(2)] = argv[++i]
    else opts._.push(a)
  }
  return opts
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0] || 'list'
  const acc = loadAccount(args.account)
  const box = args.box || 'INBOX'
  const limit = Math.max(1, Math.min(50, Number(args.n) || (cmd === 'unread' || cmd === 'search' ? 20 : 10)))

  const im = new Imap(acc)
  await im.connect()
  try {
    await im.login()

    if (cmd === 'boxes') {
      const data = await im.cmd('LIST "" *')
      for (const line of data.split('\r\n')) {
        const m = line.match(/^\* LIST \([^)]*\) "[^"]*" (.+)$/)
        if (m) console.log('- ' + decodeMime(m[1].replace(/^"|"$/g, '')))
      }
      return
    }

    const total = await im.select(box)

    if (cmd === 'list') {
      if (!total) return console.log(`${box}: 비어 있습니다.`)
      const from = Math.max(1, total - limit + 1)
      const nums = []
      for (let i = from; i <= total; i++) nums.push(i)
      printList(await fetchHeaders(im, nums), `${acc.name} ${box} 최근 메일`)
      return
    }

    if (cmd === 'unread') {
      const nums = searchNums(await im.cmd('SEARCH UNSEEN')).slice(-limit)
      printList(await fetchHeaders(im, nums), `${acc.name} ${box} 안 읽은 메일`)
      return
    }

    if (cmd === 'search') {
      const term = args._[1]
      if (!term) throw new Error('찾을 낱말을 적어 주세요: node tools/mail.js search 세금계산서')
      const enc = Buffer.from(term, 'utf8')
      im.sock.write(`s${++im.n} SEARCH CHARSET UTF-8 OR SUBJECT {${enc.length}}\r\n`)
      await im.wait(/^\+/m)
      im.sock.write(enc.toString('latin1') + ` FROM {${enc.length}}\r\n`)
      await im.wait(/^\+/m)
      im.sock.write(enc.toString('latin1') + '\r\n')
      const data = await im.wait(new RegExp(`^s${im.n} (OK|NO|BAD)`, 'm'))
      const nums = searchNums(data).slice(-limit)
      printList(await fetchHeaders(im, nums), `${acc.name} '${term}' 찾기`)
      return
    }

    if (cmd === 'read') {
      const seq = Number(args._[1])
      if (!seq) throw new Error('읽을 메일 번호를 적어 주세요: node tools/mail.js read 12')
      const data = await im.cmd(`FETCH ${seq} (BODY.PEEK[])`)
      const got = parseFetch(data)[0]
      if (!got) throw new Error(`${seq} 번 메일을 찾지 못했습니다.`)
      const sep = got.raw.indexOf('\r\n\r\n')
      const h = parseHeaders(got.raw.slice(0, sep < 0 ? got.raw.length : sep))
      console.log(`보낸이: ${decodeMime(h.from || '')}`)
      console.log(`받은때: ${briefDate(h.date)}`)
      console.log(`제목  : ${decodeMime(h.subject || '')}`)
      console.log('-'.repeat(40))
      console.log(extractText(got.raw))
      return
    }

    throw new Error(`모르는 명령입니다: ${cmd} (list, unread, search, read, boxes)`)
  } finally {
    im.close()
  }
}

main().catch((e) => {
  console.error(String(e.message || e))
  process.exit(1)
})
